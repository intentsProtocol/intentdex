/**
 * SolanaAdapter — CCTP V2 on Solana (devnet or mainnet: the programs have the same ids on both).
 *
 * PDA seeds and the receive_message remaining-account order follow Circle's reference code
 * (circlefin/solana-cctp-contracts examples/v2/{solana,utilsV2}.ts, Apache-2.0). IDLs vendored in ./idl.
 *
 * Source:      the user signs a tx we build; it is pre-signed by a fresh MessageSent event keypair.
 * Destination: mintRecipient is the recipient's USDC token account (ATA). The relayer creates it if missing.
 *
 * receive_message names 19 accounts and carries the 376-byte message plus the attestation, which is more than
 * a legacy transaction's 1232 bytes. The mint is therefore a v0 transaction with an address lookup table that
 * the relayer creates once (data/solana-lut-<chain>.json) and extends when a new source domain appears.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
    AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, Connection, Keypair, PublicKey,
    SystemProgram, Transaction, TransactionMessage, VersionedTransaction, type TransactionInstruction,
} from '@solana/web3.js';
import {
    TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';
import type { ChainConfig } from '../config.js';
import { SOLANA_PROGRAMS, config } from '../config.js';
import { hexToBuf, parseBurnBody, parseMessage, solanaToBytes32 } from '../cctp/encoding.js';
import { HttpError, type BuiltTx, type BurnCheck, type FeeCheck, type MintCheck, type MintResult, type Transfer } from '../types.js';
import { MintError, classifyMintError, type BuildBurnParams, type ChainAdapter } from '../chains/adapter.js';
import { errMsg, logger } from '../log.js';

const loadIdl = (name: string) =>
    JSON.parse(fs.readFileSync(new URL(`./idl/${name}.json`, import.meta.url), 'utf8')) as anchor.Idl;

const MIN_FEE_MULTIPLIER = 10_000_000n;

export function parseSolanaSecret(s: string): Keypair {
    const t = s.trim();
    if (t.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
    return Keypair.fromSecretKey(bs58.decode(t));
}

function pda(label: string, programId: PublicKey, extra: (string | Buffer | PublicKey)[] = []): PublicKey {
    const seeds = [Buffer.from(label, 'utf8'), ...extra.map(e =>
        typeof e === 'string' ? Buffer.from(e, 'utf8') : Buffer.isBuffer(e) ? e : e.toBuffer())];
    return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export class SolanaAdapter implements ChainAdapter {
    readonly connection: Connection;
    private relayer?: Keypair;
    private mt: anchor.Program;
    private tmm: anchor.Program;
    private usdcMint: PublicKey;
    private tokenMessengerCache?: { at: number; feeRecipient: PublicKey; minFee: bigint };
    private log = logger('solana');
    private lut?: AddressLookupTableAccount;

    constructor(readonly chain: ChainConfig, relayerSecret?: string) {
        this.connection = new Connection(chain.rpcUrl, 'confirmed');
        if (relayerSecret) this.relayer = parseSolanaSecret(relayerSecret);
        const payer = this.relayer ?? Keypair.generate();
        const wallet = {
            publicKey: payer.publicKey,
            signTransaction: async <T extends Transaction>(tx: T) => { tx.partialSign(payer); return tx; },
            signAllTransactions: async <T extends Transaction>(txs: T[]) => { txs.forEach(t => t.partialSign(payer)); return txs; },
        } as unknown as anchor.Wallet;
        const provider = new anchor.AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });
        this.mt = new anchor.Program(loadIdl('message_transmitter_v2'), provider);
        this.tmm = new anchor.Program(loadIdl('token_messenger_minter_v2'), provider);
        if (this.mt.programId.toBase58() !== SOLANA_PROGRAMS.messageTransmitter
            || this.tmm.programId.toBase58() !== SOLANA_PROGRAMS.tokenMessengerMinter) {
            throw new Error('Solana CCTP IDL program ids do not match config');
        }
        this.usdcMint = new PublicKey(chain.usdc);
    }

    validateAddress(a: string): boolean {
        try { const pk = new PublicKey(a); return PublicKey.isOnCurve(pk.toBytes()) && pk.toBase58() === a; }
        catch { return false; }
    }

    isValidTxHash(h: string): boolean {
        try { return bs58.decode(h).length === 64; } catch { return false; }
    }

    mintRecipientFor(wallet: string) {
        const ata = getAssociatedTokenAddressSync(this.usdcMint, new PublicKey(wallet));
        return { mintRecipient: solanaToBytes32(ata.toBase58()), tokenAccount: ata.toBase58() };
    }

    private async tokenMessenger() {
        if (this.tokenMessengerCache && Date.now() - this.tokenMessengerCache.at < 5 * 60_000) return this.tokenMessengerCache;
        const acct: any = await (this.tmm.account as any).tokenMessenger.fetch(pda('token_messenger', this.tmm.programId));
        this.tokenMessengerCache = { at: Date.now(), feeRecipient: acct.feeRecipient as PublicKey, minFee: BigInt(acct.minFee.toString()) };
        return this.tokenMessengerCache;
    }

    // ── source ──────────────────────────────────────────────────────────────

    async buildBurn(p: BuildBurnParams): Promise<BuiltTx[]> {
        const owner = new PublicKey(p.owner);
        const burnTokenAccount = getAssociatedTokenAddressSync(this.usdcMint, owner);
        const bal = await this.connection.getTokenAccountBalance(burnTokenAccount).catch(() => null);
        const need = p.amount + (p.fee?.amount ?? 0n);
        if (!bal || BigInt(bal.value.amount) < need) {
            throw new HttpError(400, `insufficient USDC on ${this.chain.name}: have ${bal?.value.amount ?? 0}, need ${need} (base units)`, 'INSUFFICIENT_FUNDS');
        }
        const eventKp = Keypair.generate();
        const ix = await this.burnInstruction(owner, eventKp.publicKey, p);

        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
        // Our fee rides in the same transaction as the burn: both happen or neither does.
        if (p.fee && p.fee.amount > 0n) {
            const treasury = new PublicKey(p.fee.recipient);
            const treasuryAta = getAssociatedTokenAddressSync(this.usdcMint, treasury, true);
            tx.add(
                createAssociatedTokenAccountIdempotentInstruction(owner, treasuryAta, treasury, this.usdcMint),
                createTransferCheckedInstruction(burnTokenAccount, this.usdcMint, treasuryAta, owner, p.fee.amount, 6),
            );
        }
        tx.add(ix);
        tx.partialSign(eventKp);
        return [{
            kind: 'burn', chain: 'solana',
            serializedTx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
            eventAccount: eventKp.publicKey.toBase58(),
            lastValidBlockHeight,
        }];
    }

    /** deposit_for_burn instruction (no balance checks) — also used by the read-only spike. */
    async burnInstruction(owner: PublicKey, eventAccount: PublicKey, p: BuildBurnParams): Promise<TransactionInstruction> {
        const burnTokenAccount = getAssociatedTokenAddressSync(this.usdcMint, owner);
        return this.tmm.methods
            .depositForBurn({
                amount: new BN(p.amount.toString()),
                destinationDomain: p.dstDomain,
                mintRecipient: new PublicKey(hexToBuf(p.mintRecipient)),
                maxFee: new BN(p.maxFee.toString()),
                minFinalityThreshold: p.minFinalityThreshold,
                destinationCaller: PublicKey.default,
            })
            .accountsPartial({
                owner,
                eventRentPayer: owner,
                senderAuthorityPda: pda('sender_authority', this.tmm.programId),
                burnTokenAccount,
                messageTransmitter: pda('message_transmitter', this.mt.programId),
                tokenMessenger: pda('token_messenger', this.tmm.programId),
                remoteTokenMessenger: pda('remote_token_messenger', this.tmm.programId, [String(p.dstDomain)]),
                tokenMinter: pda('token_minter', this.tmm.programId),
                localToken: pda('local_token', this.tmm.programId, [this.usdcMint]),
                burnTokenMint: this.usdcMint,
                messageSentEventData: eventAccount,
                messageTransmitterProgram: this.mt.programId,
                tokenMessengerMinterProgram: this.tmm.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .instruction();
    }

    async checkBurn(sig: string, hint?: { eventAccount?: string }): Promise<BurnCheck> {
        const st = await this.connection.getSignatureStatus(sig, { searchTransactionHistory: true });
        if (!st.value || st.value.confirmationStatus === 'processed') return { state: 'pending' };
        if (st.value.err) return { state: 'failed', reason: `burn transaction failed: ${JSON.stringify(st.value.err)}` };
        if (!hint?.eventAccount) return { state: 'confirmed' };
        const acct: any = await (this.mt.account as any).messageSent.fetchNullable(new PublicKey(hint.eventAccount));
        if (!acct) return { state: 'confirmed' };  // verified later from the Iris message
        const msg = parseMessage('0x' + Buffer.from(acct.message).toString('hex'));
        const body = parseBurnBody(msg.body);
        return {
            state: 'confirmed',
            burn: {
                amount: body.amount,
                destinationDomain: msg.destinationDomain,
                mintRecipient: body.mintRecipient,
                destinationCaller: msg.destinationCaller,
                maxFee: body.maxFee,
                minFinalityThreshold: msg.minFinalityThreshold,
                burnToken: body.burnToken,
                sender: body.messageSender,
            },
        };
    }

    /** The fee is inside the burn transaction: compare the treasury's USDC balance before and after it. */
    async checkFee(txHash: string, f: { from: string; to: string; amount: bigint }): Promise<FeeCheck> {
        const tx = await this.connection.getTransaction(txHash, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (!tx) return 'pending';
        if (tx.meta?.err) return 'missing';
        const mint = this.usdcMint.toBase58();
        const post = tx.meta?.postTokenBalances?.find(b => b.owner === f.to && b.mint === mint);
        if (!post) return 'missing';
        const pre = tx.meta?.preTokenBalances?.find(b => b.accountIndex === post.accountIndex);
        const delta = BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? '0');
        return delta >= f.amount ? 'paid' : 'missing';
    }

    /** Create `owner`'s USDC token account if it is missing (the relayer pays the rent once). */
    async ensureUsdcAccount(owner: string): Promise<void> {
        const o = new PublicKey(owner);
        const ata = getAssociatedTokenAddressSync(this.usdcMint, o, true);
        if (await this.connection.getAccountInfo(ata)) return;
        if (!this.relayer) throw new Error('relayer key not configured');
        await this.sendLegacy([createAssociatedTokenAccountIdempotentInstruction(this.relayer.publicKey, ata, o, this.usdcMint)]);
        this.log.info('created treasury USDC account', { owner, ata: ata.toBase58() });
    }

    async minFeeAmount(amount: bigint): Promise<bigint> {
        const { minFee } = await this.tokenMessenger();
        if (minFee === 0n) return 0n;
        const f = (amount * minFee) / MIN_FEE_MULTIPLIER;
        return f === 0n ? 1n : f;
    }

    // ── destination ─────────────────────────────────────────────────────────

    async prepareMint(t: Transfer): Promise<void> {
        if (!t.recipientTokenAccount || !t.recipient) return;
        const ata = new PublicKey(t.recipientTokenAccount);
        if (await this.connection.getAccountInfo(ata)) return;
        if (!this.relayer) throw new Error('relayer key not configured');
        const ix = createAssociatedTokenAccountIdempotentInstruction(
            this.relayer.publicKey, ata, new PublicKey(t.recipient), this.usdcMint);
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: this.relayer.publicKey, blockhash, lastValidBlockHeight }).add(ix);
        tx.sign(this.relayer);
        const sig = await this.connection.sendRawTransaction(tx.serialize());
        await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        this.log.info('created recipient USDC account', { ata: ata.toBase58(), sig });
    }

    private usedNoncePda(nonceHex: string): PublicKey {
        return pda('used_nonce', this.mt.programId, [hexToBuf(nonceHex)]);
    }

    async isNonceUsed(nonce: string): Promise<boolean> {
        const acct: any = await (this.mt.account as any).usedNonce.fetchNullable(this.usedNoncePda(nonce));
        return !!acct?.isUsed;
    }

    private get lutFile() { return path.join(config.dataDir, `solana-lut-${this.chain.key}.json`); }

    private async sendLegacy(ixs: TransactionInstruction[]): Promise<void> {
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
        const tx = new Transaction({ feePayer: this.relayer!.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
        tx.sign(this.relayer!);
        const sig = await this.connection.sendRawTransaction(tx.serialize());
        const res = await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        if (res.value.err) throw new Error(`lookup table transaction failed: ${JSON.stringify(res.value.err)}`);
    }

    /**
     * The relayer's lookup table holding every address in `need`. Creates the table on first use and extends it
     * when addresses are missing; new addresses are usable from the slot after the extension.
     */
    private async lookupTable(need: PublicKey[]): Promise<AddressLookupTableAccount> {
        const relayer = this.relayer!;
        const has = (t: AddressLookupTableAccount | undefined, k: PublicKey) => !!t?.state.addresses.some(a => a.equals(k));
        if (this.lut && need.every(k => has(this.lut, k))) return this.lut;

        let address: PublicKey | undefined;
        try {
            const saved = JSON.parse(fs.readFileSync(this.lutFile, 'utf8'));
            if (saved.authority === relayer.publicKey.toBase58()) address = new PublicKey(saved.address);
        } catch { /* no table yet */ }
        let table = address ? (await this.connection.getAddressLookupTable(address)).value ?? undefined : undefined;

        const missing = need.filter(k => !has(table, k));
        if (missing.length) {
            const ixs: TransactionInstruction[] = [];
            if (!table) {
                const [createIx, created] = AddressLookupTableProgram.createLookupTable({
                    authority: relayer.publicKey, payer: relayer.publicKey, recentSlot: await this.connection.getSlot('finalized'),
                });
                address = created;
                ixs.push(createIx);
            }
            ixs.push(AddressLookupTableProgram.extendLookupTable({ lookupTable: address!, authority: relayer.publicKey, payer: relayer.publicKey, addresses: missing }));
            await this.sendLegacy(ixs);
            fs.mkdirSync(path.dirname(this.lutFile), { recursive: true });
            fs.writeFileSync(this.lutFile, JSON.stringify({ address: address!.toBase58(), authority: relayer.publicKey.toBase58() }));
            this.log.info('lookup table updated', { table: address!.toBase58(), added: missing.length });
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                table = (await this.connection.getAddressLookupTable(address!)).value ?? undefined;
                if (table && need.every(k => has(table, k)) && (await this.connection.getSlot('confirmed')) > table.state.lastExtendedSlot) break;
            }
        }
        if (!table || !need.every(k => has(table, k))) throw new Error('lookup table is not ready yet');
        this.lut = table;
        return table;
    }

    async mint(m: { message: string; attestation: string }, onSent: (h: string) => void): Promise<MintResult> {
        if (!this.relayer) throw new MintError('relayer key not configured', 'transient');
        const msg = parseMessage(m.message);
        const body = parseBurnBody(msg.body);
        const remoteDomain = String(msg.sourceDomain);
        const remoteToken = new PublicKey(hexToBuf(body.burnToken));
        const userTokenAccount = new PublicKey(hexToBuf(body.mintRecipient));
        const tmmId = this.tmm.programId;
        const { feeRecipient } = await this.tokenMessenger();

        const remaining = [
            { pubkey: pda('token_messenger', tmmId), isWritable: false },
            { pubkey: pda('remote_token_messenger', tmmId, [remoteDomain]), isWritable: false },
            { pubkey: pda('token_minter', tmmId), isWritable: true },
            { pubkey: pda('local_token', tmmId, [this.usdcMint]), isWritable: true },
            { pubkey: pda('token_pair', tmmId, [remoteDomain, remoteToken]), isWritable: false },
            { pubkey: getAssociatedTokenAddressSync(this.usdcMint, feeRecipient, true), isWritable: true },
            { pubkey: userTokenAccount, isWritable: true },
            { pubkey: pda('custody', tmmId, [this.usdcMint]), isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false },
            { pubkey: pda('__event_authority', tmmId), isWritable: false },
            { pubkey: tmmId, isWritable: false },
        ].map(a => ({ ...a, isSigner: false }));

        let sig: string | undefined;
        try {
            const ix = await this.mt.methods
                .receiveMessage({ message: hexToBuf(m.message), attestation: hexToBuf(m.attestation) })
                .accountsPartial({
                    payer: this.relayer.publicKey,
                    caller: this.relayer.publicKey,
                    authorityPda: pda('message_transmitter_authority', this.mt.programId, [tmmId]),
                    messageTransmitter: pda('message_transmitter', this.mt.programId),
                    usedNonce: this.usedNoncePda(msg.nonce),
                    receiver: tmmId,
                    systemProgram: SystemProgram.programId,
                })
                .remainingAccounts(remaining)
                .instruction();
            // Everything except the signer and the two per-transfer accounts goes through the lookup table.
            const usedNonce = this.usedNoncePda(msg.nonce);
            const shared = ix.keys.filter(k => !k.isSigner && !k.pubkey.equals(usedNonce) && !k.pubkey.equals(userTokenAccount)
                && !k.pubkey.equals(ix.programId)).map(k => k.pubkey);
            const table = await this.lookupTable(shared.filter((k, i) => shared.findIndex(x => x.equals(k)) === i));
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
            const tx = new VersionedTransaction(new TransactionMessage({
                payerKey: this.relayer.publicKey, recentBlockhash: blockhash,
                instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix],
            }).compileToV0Message([table]));
            tx.sign([this.relayer]);
            sig = await this.connection.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
            onSent(sig);
            const res = await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
            if (res.value.err) throw new Error(`receive_message failed: ${JSON.stringify(res.value.err)}`);
        } catch (e) {
            const logs = ((e as any)?.logs as string[] | undefined)?.join(' | ') ?? '';
            const msgText = `${errMsg(e)} ${logs}`.trim();
            throw new MintError(msgText.slice(0, 500), classifyMintError(msgText));
        }
        return { txHash: sig!, ...(await this.readMintAmounts(sig!, userTokenAccount, body.feeExecuted)) };
    }

    private async readMintAmounts(sig: string, tokenAccount: PublicKey, feeExecuted: bigint) {
        const tx = await this.connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        const keys = tx?.transaction.message.staticAccountKeys ?? [];   // the token account is never in the lookup table
        const idx = keys.findIndex(k => k.equals(tokenAccount));
        const pre = tx?.meta?.preTokenBalances?.find(b => b.accountIndex === idx)?.uiTokenAmount.amount ?? '0';
        const post = tx?.meta?.postTokenBalances?.find(b => b.accountIndex === idx)?.uiTokenAmount.amount;
        const gasCost = tx?.meta ? { amount: (tx.meta.fee / 1e9).toFixed(9), symbol: 'SOL' } : undefined;
        return { received: post !== undefined ? BigInt(post) - BigInt(pre) : undefined, feeCollected: feeExecuted, gasCost };
    }

    async checkMint(sig: string): Promise<MintCheck> {
        const st = await this.connection.getSignatureStatus(sig, { searchTransactionHistory: true });
        if (!st.value) return { state: 'unknown' };
        if (st.value.err) return { state: 'reverted', reason: JSON.stringify(st.value.err) };
        if (st.value.confirmationStatus === 'processed') return { state: 'pending' };
        return { state: 'success', result: { txHash: sig } };
    }

    // ── ops ─────────────────────────────────────────────────────────────────

    relayerAddress() { return this.relayer?.publicKey.toBase58(); }

    async relayerBalance() {
        if (!this.relayer) return { amount: '0', symbol: 'n/a' };
        const lamports = await this.connection.getBalance(this.relayer.publicKey);
        return { amount: (lamports / 1e9).toFixed(4), symbol: 'SOL' };
    }

    async usdcBalance(wallet: string): Promise<bigint> {
        const ata = getAssociatedTokenAddressSync(this.usdcMint, new PublicKey(wallet));
        const bal = await this.connection.getTokenAccountBalance(ata).catch(() => null);
        return bal ? BigInt(bal.value.amount) : 0n;
    }
}
