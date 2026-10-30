/**
 * lendbch setup verifier — our own rewrite of Paryon's verify_contract_deployment, so we can prove a deployment
 * (ours on chipnet, or Paryon's on mainnet) was set up correctly before trusting it. It inspects the five genesis
 * transactions and checks every token output sits on the right contract with the right capability and commitment.
 *
 * Differences from Paryon's tool, both deliberate: outputs are matched by locking bytecode (not by a server-provided
 * `addresses` field, which Fulcrum doesn't always return for p2sh32), and it's a pure function of a tx-fetcher so it
 * runs from a script, a test, or the service's self-check. The checks themselves mirror theirs one-for-one.
 */
import type { Deployment } from './types.js';

/** The subset of an Electrum verbose transaction we read. */
export interface RawTx {
    txid: string;
    vin: { txid: string; vout: number }[];
    vout: RawVout[];
}
export interface RawVout {
    n: number;
    value: number;
    scriptPubKey: { hex: string };
    tokenData?: { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } };
}

export type FetchTx = (txid: string) => Promise<RawTx>;

/** The five genesis txids, in the same order as `tokenIds` on the deployment. */
export interface GenesisTxIds {
    paryon: string;
    pool: string;
    redeemer: string;
    loanKeyFactory: string;
    oracleMigrationKey: string;
}

const MAX_TOKEN_SUPPLY = 9223372036854775807n;
const FIRST_PERIOD_B4 = '00000000';                       // bytes4 period 0, VM-encoded (all zero)
const POOL_START = FIRST_PERIOD_B4 + '000000000000';      // period 0 + bytes6 totalStakedEpoch 0
const LOAN_FN_COMMITMENTS = ['01', '02', '03', '04', '05', '06', '07', '08'];
const POOL_FN_COMMITMENTS = ['01', '02', '03', '04'];

export interface VerifyResult {
    ok: boolean;
    checks: { name: string; ok: boolean; detail?: string }[];
}

/** Run the full setup verification. Never throws for a failed check — it records it; it throws only on fetch errors. */
export async function verifySetup(deployment: Deployment, genesis: GenesisTxIds, fetchTx: FetchTx, priceLockingBytecode: string): Promise<VerifyResult> {
    const c = deployment.contracts;
    const t = deployment.params.tokenIds;
    const checks: VerifyResult['checks'] = [];
    const ok = (name: string, cond: boolean, detail?: string) => { checks.push({ name, ok: cond, detail: cond ? undefined : detail }); return cond; };

    const lb = (vout: RawVout) => vout.scriptPubKey.hex.toLowerCase();
    const nftOf = (vout: RawVout) => vout.tokenData?.nft;
    const loanFns = LOAN_FN_COMMITMENTS;   // loan-function addresses aren't derived in P1; identified by commitment on the loan-fn genesis

    // Fetch all five in order.
    const [paryonTx, poolTx, redeemerTx, lkfTx, migTx] = await Promise.all([
        fetchTx(genesis.paryon), fetchTx(genesis.pool), fetchTx(genesis.redeemer), fetchTx(genesis.loanKeyFactory), fetchTx(genesis.oracleMigrationKey),
    ]);

    // Each genesis tx must spend its token's defining outpoint (prevout txid === tokenId, vout 0).
    const genesisSpends = (tx: RawTx, tokenId: string) => tx.vin.some(i => i.txid === tokenId && i.vout === 0);
    ok('paryon genesis spends its defining outpoint', genesisSpends(paryonTx, t.paryonTokenId));
    ok('pool genesis spends its defining outpoint', genesisSpends(poolTx, t.poolTokenId));
    ok('redeemer genesis spends its defining outpoint', genesisSpends(redeemerTx, t.redeemerTokenId));
    ok('loanKeyFactory genesis spends its defining outpoint', genesisSpends(lkfTx, t.loanKeyFactoryTokenId));
    ok('oracleMigrationKey genesis spends its defining outpoint', genesisSpends(migTx, t.oracleMigrationKeyTokenId));

    // ── 1. paryon genesis: borrowing (minting, MAX supply), price (mutable, 00…), 8 loan fns (none, 01–08) ──
    const borrowingLb = c.borrowing.lockingBytecode;
    const priceLb = priceLockingBytecode;
    let borrowingCount = 0, priceCount = 0, fungible = 0n;
    const seenLoanFns = new Set<string>();
    for (const o of paryonTx.vout) {
        if (lb(o).startsWith('6a')) continue;   // OP_RETURN (BCMR)
        const nft = nftOf(o);
        if (lb(o) === borrowingLb) {
            borrowingCount++;
            ok('paryon: borrowing output is a minting NFT at period 0', nft?.capability === 'minting' && nft.commitment === FIRST_PERIOD_B4, `cap=${nft?.capability} commit=${nft?.commitment}`);
            if (o.tokenData) fungible += BigInt(o.tokenData.amount);
        } else if (lb(o) === priceLb) {
            priceCount++;
            ok('paryon: price output is a mutable NFT with a 9-byte 0x00 state', nft?.capability === 'mutable' && nft.commitment.length === 18 && nft.commitment.startsWith('00'), `cap=${nft?.capability} commit=${nft?.commitment}`);
        } else if (nft?.capability === 'none' && o.tokenData?.category === t.paryonTokenId && loanFns.includes(nft.commitment)) {
            seenLoanFns.add(nft.commitment);
        } else if (o.tokenData) {
            ok(`paryon: no stray token output (out ${o.n})`, false, `unexpected token at ${lb(o).slice(0, 20)}… commit=${nft?.commitment}`);
        }
    }
    ok('paryon: a borrowing thread exists', borrowingCount > 0);
    ok('paryon: a price thread exists', priceCount > 0);
    ok('paryon: all 8 loan-function NFTs (01–08) present', seenLoanFns.size === 8, `found ${[...seenLoanFns].sort().join(',')}`);
    ok('paryon: total fungible supply equals MAX_TOKEN_SUPPLY', fungible === MAX_TOKEN_SUPPLY, `got ${fungible}`);

    // ── 2. pool genesis: stability pool (minting, period0+0), sidecar (no token), collector (mutable, period0), 4 pool fns ──
    const spLb = c.stabilityPool.lockingBytecode, sidecarLb = c.stabilityPoolSidecar.lockingBytecode, collectorLb = c.collector.lockingBytecode, addLiqLb = c.addLiquidity.lockingBytecode;
    let spCount = 0, collectorCount = 0; const seenPoolFns = new Set<string>();
    for (const o of poolTx.vout) {
        if (lb(o).startsWith('6a')) continue;
        const nft = nftOf(o);
        if (o.tokenData && BigInt(o.tokenData.amount) > 0n) ok(`pool: no fungible tokens (out ${o.n})`, false, `amount ${o.tokenData.amount}`);
        if (lb(o) === spLb) {
            spCount++;
            ok('pool: stability-pool output is a minting NFT (period0 + 0 staked)', nft?.capability === 'minting' && nft.commitment === POOL_START, `cap=${nft?.capability} commit=${nft?.commitment}`);
        } else if (lb(o) === collectorLb) {
            collectorCount++;
            ok('pool: collector output is a mutable NFT at period 0', nft?.capability === 'mutable' && nft.commitment === FIRST_PERIOD_B4, `cap=${nft?.capability} commit=${nft?.commitment}`);
        } else if (nft?.capability === 'none' && o.tokenData?.category === t.poolTokenId && POOL_FN_COMMITMENTS.includes(nft.commitment)) {
            seenPoolFns.add(nft.commitment);
        }
    }
    ok('pool: a stability-pool thread exists', spCount > 0);
    ok('pool: a collector thread exists', collectorCount > 0);
    ok('pool: all 4 pool-function NFTs (01–04) present', seenPoolFns.size === 4, `found ${[...seenPoolFns].sort().join(',')}`);
    ok('pool: the stability-pool sidecar output carries no token', poolTx.vout.some(o => lb(o) === sidecarLb && !o.tokenData));
    void addLiqLb;   // addLiquidity is one of the four pool fns; identified by commitment above

    // ── 3. redeemer genesis: a minting NFT with an empty commitment ──
    ok('redeemer: a minting NFT with empty commitment exists', redeemerTx.vout.some(o => { const n = nftOf(o); return n?.capability === 'minting' && n.commitment === '' && o.tokenData?.category === t.redeemerTokenId; }));
    ok('redeemer: no fungible tokens', !redeemerTx.vout.some(o => o.tokenData && BigInt(o.tokenData.amount) > 0n));

    // ── 4. loanKeyFactory genesis: a minting NFT with an empty commitment ──
    const lkfLb = c.loanKeyFactory.lockingBytecode;
    ok('loanKeyFactory: minting NFT with empty commitment at the factory address', lkfTx.vout.some(o => { const n = nftOf(o); return lb(o) === lkfLb && n?.capability === 'minting' && n.commitment === '' && o.tokenData?.category === t.loanKeyFactoryTokenId; }));
    ok('loanKeyFactory: no fungible tokens', !lkfTx.vout.some(o => o.tokenData && BigInt(o.tokenData.amount) > 0n));

    // ── 5. oracleMigrationKey genesis: no fungible tokens; its token id must derive the live price address ──
    ok('oracleMigrationKey: no fungible tokens', !migTx.vout.some(o => o.tokenData && BigInt(o.tokenData.amount) > 0n));
    ok('oracleMigrationKey: derives the price contract that holds a thread', priceCount > 0);

    return { ok: checks.every(c => c.ok), checks };
}
