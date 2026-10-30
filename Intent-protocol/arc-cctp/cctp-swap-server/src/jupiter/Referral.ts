/**
 * Referral — our Jupiter referral account on Solana mainnet: where the Solana swap fee lands.
 *
 * Setup follows Jupiter's docs (developers.jup.ag/docs/swap/order-and-execute#fees) with @jup-ag/referral-sdk:
 *   1. a referral account under the "Jupiter Ultra Referral Project", partner = our treasury wallet;
 *   2. one referral token account per mint fees are taken in (Jupiter picks SOL first, then stablecoins …);
 *      without the account for an order's fee mint, the swap still runs but pays us nothing;
 *   3. fees accumulate in those token accounts; claiming moves them to the partner wallet.
 * Jupiter keeps 20 % of the fee. Signing needs a treasury wallet generated on this server with SOL for rent.
 */
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { ReferralProvider } from '@jup-ag/referral-sdk';
import { errMsg, logger } from '../log.js';
import { HttpError } from '../types.js';
import type { TokenCatalog } from './TokenCatalog.js';
import { WSOL_MINT } from './TokenCatalog.js';

const log = logger('referral');

/** Jupiter's referral project for Ultra / Swap API v2 orders. */
export const JUPITER_REFERRAL_PROJECT = 'DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc';
/** Fee mints set up by default: Jupiter takes fees in SOL first, then stablecoins. */
export const DEFAULT_FEE_SYMBOLS = ['SOL', 'USDC', 'USDT'];

export interface ReferralTokenAccount { mint: string; symbol?: string; decimals?: number; address: string; exists: boolean; balance: string }
export interface ReferralStatus {
    account?: string;
    exists: boolean;
    partner?: string;
    name?: string;
    tokenAccounts: ReferralTokenAccount[];
    error?: string;
}

export class ReferralManager {
    private provider: ReferralProvider;

    constructor(private conn: Connection, private catalog: TokenCatalog) {
        this.provider = new ReferralProvider(conn);
    }

    /** Mints we expect fees in: SOL plus the verified USDC and USDT (looked up, not typed). */
    feeMints(extra: string[] = []): Array<{ mint: string; symbol?: string; decimals?: number }> {
        const out = new Map<string, { mint: string; symbol?: string; decimals?: number }>();
        out.set(WSOL_MINT, { mint: WSOL_MINT, symbol: 'SOL', decimals: 9 });
        for (const sym of DEFAULT_FEE_SYMBOLS.slice(1)) {
            const t = this.catalog.find(sym);
            if (t) out.set(t.mint, { mint: t.mint, symbol: t.symbol, decimals: t.decimals });
        }
        for (const m of extra) if (!out.has(m)) { const t = this.catalog.cached(m); out.set(m, { mint: m, symbol: t?.symbol, decimals: t?.decimals }); }
        return [...out.values()];
    }

    tokenAccountOf(account: string, mint: string): string {
        return this.provider.getReferralTokenAccountPubKey({ referralAccountPubKey: new PublicKey(account), mint: new PublicKey(mint) }).toBase58();
    }

    async status(account: string | undefined, extraMints: string[] = []): Promise<ReferralStatus> {
        if (!account) return { exists: false, tokenAccounts: [] };
        try {
            const info = await this.provider.getReferralAccount(new PublicKey(account)).catch(() => undefined);
            const tokenAccounts = await Promise.all(this.feeMints(extraMints).map(async m => {
                const address = this.tokenAccountOf(account, m.mint);
                const bal = await this.conn.getTokenAccountBalance(new PublicKey(address)).catch(() => null);
                return { ...m, address, exists: !!bal, balance: bal?.value.amount ?? '0' };
            }));
            return { account, exists: !!info, partner: info?.partner.toBase58(), name: info?.name, tokenAccounts };
        } catch (e) {
            return { account, exists: false, tokenAccounts: [], error: errMsg(e) };
        }
    }

    private async send(tx: Transaction, signer: Keypair): Promise<string> {
        const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = signer.publicKey;
        tx.sign(signer);
        const sig = await this.conn.sendRawTransaction(tx.serialize());
        const r = await this.conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        if (r.value.err) throw new Error(`transaction failed: ${JSON.stringify(r.value.err)}`);
        return sig;
    }

    private async needSol(signer: Keypair, lamports: number) {
        const bal = await this.conn.getBalance(signer.publicKey);
        if (bal < lamports) throw new HttpError(400, `the treasury wallet ${signer.publicKey.toBase58()} has ${bal / 1e9} SOL on mainnet; it needs about ${lamports / 1e9} SOL for rent and fees`);
    }

    /** Create our referral account, with the treasury wallet as partner and payer. */
    async create(name: string, signer: Keypair): Promise<{ account: string; signature: string }> {
        if (!/^[a-z0-9-]{3,32}$/.test(name)) throw new HttpError(400, 'name must be 3-32 lowercase letters, digits or dashes');
        await this.needSol(signer, 5_000_000);
        const { tx, referralAccountPubKey } = await this.provider.initializeReferralAccountWithName({
            projectPubKey: new PublicKey(JUPITER_REFERRAL_PROJECT), partnerPubKey: signer.publicKey, payerPubKey: signer.publicKey, name,
        });
        const account = referralAccountPubKey.toBase58();
        if (await this.conn.getAccountInfo(referralAccountPubKey)) throw new HttpError(409, `a referral account named '${name}' already exists: ${account}`);
        const signature = await this.send(tx, signer);
        log.info('referral account created', { account, signature });
        return { account, signature };
    }

    /** Create the token account that receives fees in `mint`. */
    async addTokenAccount(account: string, mint: string, signer: Keypair): Promise<{ tokenAccount: string; signature?: string }> {
        const existing = this.tokenAccountOf(account, mint);
        if (await this.conn.getAccountInfo(new PublicKey(existing))) return { tokenAccount: existing };
        await this.needSol(signer, 3_000_000);
        const { tx, referralTokenAccountPubKey } = await this.provider.initializeReferralTokenAccount({
            payerPubKey: signer.publicKey, referralAccountPubKey: new PublicKey(account), mint: new PublicKey(mint),
        });
        const signature = await this.send(tx, signer);
        log.info('referral token account created', { account, mint, tokenAccount: referralTokenAccountPubKey.toBase58(), signature });
        return { tokenAccount: referralTokenAccountPubKey.toBase58(), signature };
    }

    /** Move every accrued fee to the partner (treasury) wallet. */
    async claimAll(account: string, signer: Keypair): Promise<string[]> {
        await this.needSol(signer, 1_000_000);
        const txs: VersionedTransaction[] = await this.provider.claimAll({ payerPubKey: signer.publicKey, referralAccountPubKey: new PublicKey(account) });
        const sigs: string[] = [];
        for (const tx of txs) {
            tx.sign([signer]);
            const sig = await this.conn.sendRawTransaction(tx.serialize());
            const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('confirmed');
            await this.conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
            sigs.push(sig);
        }
        log.info('referral fees claimed', { account, txs: sigs.length });
        return sigs;
    }
}
