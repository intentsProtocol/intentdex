import { ExchangeLab } from '@cashlab/cauldron';
import { NATIVE_BCH_TOKEN_ID, SpendableCoinType, PayoutAmountRuleType } from '@cashlab/common';
import type { SpendableCoin, PayoutRule, Output } from '@cashlab/common';
import type { TradeResult, PoolV0 } from '@cashlab/cauldron';
import { ElectrumNetworkProvider } from 'cashscript';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { CauldronPoolCache } from './CauldronPoolCache.js';
import type { AuctionSolution } from './DutchAuctionSolver.js';
import * as SpreadQuant from './SpreadQuant.js';
import * as Policy from './ProfitPolicy.js';
import type { PolicyConfig } from './ProfitPolicy.js';
import { reserveOutpoints, filterAvailable } from './UtxoReservation.js';
import { ENV } from '../config.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface WalletInfo {
    privateKey: Uint8Array;         // 32-byte secp256k1 raw private key
    publicKeyHash: Uint8Array;      // 20-byte P2PKH hash
    cashaddr: string;
    tokenaddr: string;
}

export type RouteType = 'DIRECT' | 'BCH_TO_TOKEN' | 'TOKEN_TO_BCH' | 'TOKEN_TO_TOKEN' | 'INVENTORY_TO_TOKEN';

export interface RouteQuote {
    profitable: boolean;
    routeType: RouteType;
    netProfitSats: bigint;
    preFillTrade: TradeResult | null;   // null → solver already holds the buy token
    postFillTrade: TradeResult | null;  // null → no rebalance needed
    preFillTokenId: string | null;      // token category to acquire before fill
    postFillTokenId: string | null;     // token category to sell after fill
    /** Second-hop trade for INVENTORY_TO_TOKEN: first hop sells held token→BCH, this buys BCH→buyToken. */
    preFillTrade2?: TradeResult | null;
    /** The inventory token being spent as supply in the first hop of INVENTORY_TO_TOKEN. */
    preFillSourceTokenId?: string | null;
    reason: string;                     // human-readable explanation
    slippageBps: number;                // 0 for DIRECT, marginal-vs-spot for Cauldron routes
    effectiveBps: number;               // profit / tradeValue in bps
    candidatesConsidered: number;       // for diagnostics
}

export interface RouteRecord {
    intentId?: string;
    timestamp: number;
    routeType: RouteType;
    preFillTxid?: string;
    fillTxid?: string;
    postFillTxid?: string;
    netProfitSats: bigint;
    preFillExplorerUrl?: string;
    fillExplorerUrl?: string;
    postFillExplorerUrl?: string;
    error?: string;
    slippageBps?: number;
    effectiveBps?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TX_FEE_PER_BYTE          = 2n;       // sats/byte — conservative estimate

/**
 * A token UTXO needs ≥ this many sats to cover the fee in a 2-input fill.
 *
 * Read from config so the executor's token-change floor is the SAME number. They
 * used to disagree — 3500 here versus a hardcoded 1000 in the executor — which
 * meant every fill minted change below this bar, permanently starving the solver
 * out of the DIRECT route. See ENV.MIN_TOKEN_UTXO_DUST_SATS.
 */
const MIN_DIRECT_TOKEN_BCH_DUST = ENV.MIN_TOKEN_UTXO_DUST_SATS;

/**
 * Estimate Cauldron pre-fill / rebalance tx fee from pool count.
 *   bytes ≈ header(80) + 150 per pool input + funding-input(150) + ~2 outputs(160) = 540 + 150 × pools
 * For typical 1-3 pool routes this gives 1,300 – 2,000 sats (vs the old flat 3,000-sat over-estimate).
 */
function estimateCauldronTxFee(numPools: number): bigint {
    const bytes = 540n + 150n * BigInt(Math.max(1, numPools));
    return bytes * TX_FEE_PER_BYTE;
}

/**
 * Estimate the covenant-fill tx fee.
 *   2 inputs (covenant unlock ≈ 250 bytes, funding ≈ 150 bytes) + 2-3 outputs (maker, claim, optional change).
 *   Token outputs add ~30 bytes each; profit-segregation output adds ~80 bytes.
 */
export function estimateFillTxFee(opts: { hasTokenChange?: boolean; hasProfitOutput?: boolean } = {}): bigint {
    let bytes = 80n + 250n + 150n + 80n + 80n;     // header + covenant + funding + maker + claim
    if (opts.hasTokenChange)  bytes += 110n;
    if (opts.hasProfitOutput) bytes += 80n;
    return bytes * TX_FEE_PER_BYTE;
}

// ─── Internal candidate type ──────────────────────────────────────────────────

interface RouteCandidate {
    routeType: RouteType;
    profitSats: bigint;
    tradeValueSats: bigint;
    slippageBps: number;
    preFillTrade: TradeResult | null;
    postFillTrade: TradeResult | null;
    preFillTokenId: string | null;
    postFillTokenId: string | null;
    preFillTrade2?: TradeResult | null;
    preFillSourceTokenId?: string | null;
    description: string;
    policyEval?: Policy.EvalResult;
}

// ─── CauldronRouter ───────────────────────────────────────────────────────────

export class CauldronRouter {
    private readonly lab = new ExchangeLab();
    paused = false;

    constructor(
        readonly poolCache: CauldronPoolCache,
        readonly policy: PolicyConfig = Policy.DEFAULT_POLICY,
        /** Set true when a profit address is configured so fee estimates include the profit output. */
        readonly profitOutputEnabled: boolean = false,
    ) {}

    // ── Quote ─────────────────────────────────────────────────────────────────

    async quote(solution: AuctionSolution, solverUtxos: ElectrumUtxo[]): Promise<RouteQuote> {
        const stripHex = (s: string) => s.startsWith('0x') ? s.slice(2) : s;
        const buyTokenCat = stripHex(solution.params.buyTokenCategory);
        const sellTokenCat = stripHex(solution.params.sellTokenCategory);
        const isBchBuy = !buyTokenCat;
        const isBchSell = !sellTokenCat;
        const price = solution.currentPrice;        // tokens (BCH→Token) or sats (Token→BCH) to send to maker
        const sellAmt = BigInt(solution.params.sellAmount);  // what covenant gives the solver

        // ── BCH→BCH: no routing needed, but the spread is still real ─────────
        //
        // This used to report profitSats: 0n. The spread was captured on-chain all
        // the same (~7000 sats/fill measured), but because the *predicted* figure was
        // zero: predictedProfitSats was zero, so the executor never emitted a
        // profit-segregation output, and the ledger compared realized against zero
        // and produced nonsense. Twelve live fills segregated 0 sats between them.
        //
        // So compute it properly. `overrideOK` is deliberately retained: the policy
        // floor has never applied to this route, and switching it on here would stop
        // thin-spread BCH pairs filling at all. Measure first, gate later — the log
        // line below is the evidence needed to decide.
        if (isBchBuy && isBchSell) {
            const fillFee = estimateFillTxFee({ hasProfitOutput: this.profitOutputEnabled });
            const profit = sellAmt - price - fillFee;
            return finalize({
                routeType: 'DIRECT', profitSats: profit, tradeValueSats: sellAmt, slippageBps: 0,
                preFillTrade: null, postFillTrade: null, preFillTokenId: null, postFillTokenId: null,
                description: `BCH→BCH direct fill: recv=${sellAmt} pay=${price} fee=${fillFee} → profit=${profit}`,
            }, this.policy, /*candidates=*/1, /*overrideOK=*/true);
        }

        const tokenBalance = (tokenId: string) =>
            solverUtxos
                .filter((u: any) => u.token?.category === tokenId)
                .reduce((s: bigint, u: any) => s + BigInt(u.token!.amount), 0n);

        // ── BCH→Token: compare DIRECT (inventory) vs CAULDRON (pre-fill swap) ─
        if (isBchSell && !isBchBuy) {
            const tokenId = buyTokenCat;
            const candidates: RouteCandidate[] = [];
            const pools = await this.poolCache.getPools();
            const relevantPools = pools.length ? this.poolCache.getPoolsForPair(NATIVE_BCH_TOKEN_ID, tokenId) : [];

            // Candidate A: DIRECT (relayer already holds the buy token in a single UTXO with enough BCH dust)
            const inventory = tokenBalance(tokenId);
            const directViableUtxo = solverUtxos.find((u: any) =>
                u.token?.category === tokenId
                && BigInt(u.token!.amount) >= price
                && BigInt(u.satoshis) >= MIN_DIRECT_TOKEN_BCH_DUST
            );
            if (inventory >= price && directViableUtxo) {
                const fairValue = relevantPools.length
                    ? SpreadQuant.fairValueSats(relevantPools, tokenId, price)
                    : price;
                // DIRECT route: token input has change output → carry that into fee estimate
                const hasTokenChange = BigInt((directViableUtxo as any).token!.amount) > price;
                const profit = sellAmt - fairValue - estimateFillTxFee({ hasTokenChange, hasProfitOutput: this.profitOutputEnabled });
                candidates.push({
                    routeType: 'DIRECT', profitSats: profit, tradeValueSats: sellAmt, slippageBps: 0,
                    preFillTrade: null, postFillTrade: null,
                    preFillTokenId: null, postFillTokenId: null,
                    description: `DIRECT: ${inventory} inventory, fairValue=${fairValue} sats, profit=${profit}`,
                });
            } else if (inventory >= price && !directViableUtxo) {
                // Have enough tokens, but no single UTXO has enough BCH dust to cover the fill fee → must use Cauldron
                candidates.push(failedCandidate('DIRECT',
                    `inventory ${inventory} exists but no single UTXO has ≥${price} tokens AND ≥${MIN_DIRECT_TOKEN_BCH_DUST} sats dust`,
                    sellAmt));
            }

            // Candidate B: CAULDRON pre-fill swap (BCH → buyToken)
            if (relevantPools.length) {
                try {
                    const trade = this.lab.constructTradeBestRateForTargetDemand(
                        NATIVE_BCH_TOKEN_ID, tokenId, price, relevantPools, TX_FEE_PER_BYTE
                    );
                    const swapFee = estimateCauldronTxFee(trade.entries.length);
                    const fillFee = estimateFillTxFee({ hasTokenChange: true, hasProfitOutput: this.profitOutputEnabled });
                    const cauldronCost = trade.summary.supply + trade.summary.trade_fee + swapFee + fillFee;
                    const profit = sellAmt - cauldronCost;
                    const marginal = SpreadQuant.marginalPriceForTrade(relevantPools, 'BCH', tokenId, price);
                    candidates.push({
                        routeType: 'BCH_TO_TOKEN', profitSats: profit, tradeValueSats: sellAmt,
                        slippageBps: marginal.slippageBps,
                        preFillTrade: trade, postFillTrade: null,
                        preFillTokenId: tokenId, postFillTokenId: null,
                        description: `CAULDRON: cost=${cauldronCost} (supply=${trade.summary.supply}+lp=${trade.summary.trade_fee}+swap=${swapFee}+fill=${fillFee}, ${trade.entries.length} pool${trade.entries.length>1?'s':''}), slip=${marginal.slippageBps}bps`,
                    });
                } catch (e: any) {
                    candidates.push(failedCandidate('BCH_TO_TOKEN', `quote failed: ${e.message}`, sellAmt));
                }
            }

            // Candidate C: INVENTORY_TO_TOKEN — use held CashToken inventory as Cauldron supply
            // For each non-BCH token the solver holds (other than the target), try a 2-hop:
            //   Step 1: sell heldToken → BCH (Cauldron)
            //   Step 2: buy BCH → buyToken (Cauldron)
            // This lets solvers with accumulated token inventory fill orders without spending BCH.
            if (relevantPools.length) {
                const heldTokenIds = [...new Set(
                    solverUtxos
                        .filter((u: any) => u.token?.category && u.token.category !== tokenId)
                        .map((u: any) => u.token!.category as string),
                )];
                for (const heldId of heldTokenIds) {
                    const heldBal = tokenBalance(heldId);
                    if (heldBal === 0n) continue;
                    const heldPools = this.poolCache.getPoolsForPair(heldId, NATIVE_BCH_TOKEN_ID);
                    if (!heldPools.length) continue;
                    try {
                        // Quote step 2 first to find BCH needed
                        const buyTrade = this.lab.constructTradeBestRateForTargetDemand(
                            NATIVE_BCH_TOKEN_ID, tokenId, price, relevantPools, TX_FEE_PER_BYTE
                        );
                        const buySwapFee = estimateCauldronTxFee(buyTrade.entries.length);
                        const bchNeeded = buyTrade.summary.supply + buyTrade.summary.trade_fee + buySwapFee;
                        // Quote step 1: how much heldToken to sell to get bchNeeded
                        const sellTrade = this.lab.constructTradeBestRateForTargetDemand(
                            heldId, NATIVE_BCH_TOKEN_ID, bchNeeded, heldPools, TX_FEE_PER_BYTE
                        );
                        const sellSwapFee = estimateCauldronTxFee(sellTrade.entries.length);
                        const fillFee = estimateFillTxFee({ hasTokenChange: true, hasProfitOutput: this.profitOutputEnabled });
                        const heldSpent = sellTrade.summary.supply + sellTrade.summary.trade_fee;
                        // Only viable if solver actually holds enough of heldToken
                        if (heldBal < heldSpent) continue;
                        const heldFairBch = SpreadQuant.fairValueSats(heldPools, heldId, heldSpent);
                        const totalCost = heldFairBch + sellSwapFee + buySwapFee + fillFee;
                        const profit = sellAmt - totalCost;
                        const sellMarg = SpreadQuant.marginalPriceForTrade(heldPools, heldId, 'BCH', heldSpent);
                        const buyMarg = SpreadQuant.marginalPriceForTrade(relevantPools, 'BCH', tokenId, price);
                        const worstSlip = Math.max(sellMarg.slippageBps, buyMarg.slippageBps);
                        candidates.push({
                            routeType: 'INVENTORY_TO_TOKEN',
                            profitSats: profit, tradeValueSats: sellAmt, slippageBps: worstSlip,
                            preFillTrade: sellTrade, preFillTrade2: buyTrade, postFillTrade: null,
                            preFillTokenId: tokenId, preFillSourceTokenId: heldId, postFillTokenId: null,
                            description: `INV_TO_TOKEN: sell ${heldSpent}×${heldId.slice(0,8)}→BCH then buy ${price}×${tokenId.slice(0,8)}, fairCost=${totalCost}, profit=${profit}, slip=${worstSlip}bps`,
                        });
                    } catch (e: any) {
                        candidates.push(failedCandidate('INVENTORY_TO_TOKEN',
                            `inv-to-token ${heldId.slice(0,8)}: ${e.message}`, sellAmt));
                    }
                }
            }

            if (candidates.length === 0) {
                return noRouteWithCtx(`No inventory (${inventory}/${price} units of ${tokenId.slice(0, 8)}…) and no Cauldron pool — fund relayer token address to enable direct fills`, this.policy);
            }

            return pickBest(candidates, this.policy);
        }

        // ── Token→BCH: post-fill rebalance via Cauldron ──────────────────────
        if (!isBchSell && isBchBuy) {
            const tokenId = sellTokenCat;
            const candidates: RouteCandidate[] = [];
            const pools = await this.poolCache.getPools();
            const relevantPools = pools.length ? this.poolCache.getPoolsForPair(tokenId, NATIVE_BCH_TOKEN_ID) : [];

            if (!relevantPools.length) {
                return noRouteWithCtx(`No ${tokenId.slice(0, 8)}… pool for Token→BCH rebalance`, this.policy);
            }

            try {
                const trade = this.lab.constructTradeBestRateForTargetSupply(
                    tokenId, NATIVE_BCH_TOKEN_ID, sellAmt, relevantPools, TX_FEE_PER_BYTE
                );
                const swapFee = estimateCauldronTxFee(trade.entries.length);
                const fillFee = estimateFillTxFee({ hasTokenChange: false, hasProfitOutput: this.profitOutputEnabled });
                const bchReceived = trade.summary.demand - trade.summary.trade_fee - swapFee - fillFee;
                const profit = bchReceived - price;
                const marginal = SpreadQuant.marginalPriceForTrade(relevantPools, tokenId, 'BCH', price);
                candidates.push({
                    routeType: 'TOKEN_TO_BCH', profitSats: profit, tradeValueSats: price,
                    slippageBps: marginal.slippageBps,
                    preFillTrade: null, postFillTrade: trade,
                    preFillTokenId: null, postFillTokenId: tokenId,
                    description: `CAULDRON sell: bchReceived=${bchReceived} (demand=${trade.summary.demand}−lp=${trade.summary.trade_fee}−swap=${swapFee}−fill=${fillFee}, ${trade.entries.length} pool${trade.entries.length>1?'s':''}) − maker=${price} = ${profit}, slip=${marginal.slippageBps}bps`,
                });
            } catch (e: any) {
                return noRouteWithCtx(`Token→BCH quote failed: ${e.message}`, this.policy);
            }

            return pickBest(candidates, this.policy);
        }

        // ── Token→Token: two-hop ─────────────────────────────────────────────
        if (!isBchSell && !isBchBuy) {
            const buyId = buyTokenCat;
            const sellId = sellTokenCat;
            const candidates: RouteCandidate[] = [];
            const pools = await this.poolCache.getPools();
            const buyPools  = pools.length ? this.poolCache.getPoolsForPair(NATIVE_BCH_TOKEN_ID, buyId)  : [];
            const sellPools = pools.length ? this.poolCache.getPoolsForPair(sellId, NATIVE_BCH_TOKEN_ID) : [];

            if (!buyPools.length)  return noRouteWithCtx(`No pool for buy token ${buyId.slice(0, 8)}…`,  this.policy);
            if (!sellPools.length) return noRouteWithCtx(`No pool for sell token ${sellId.slice(0, 8)}…`, this.policy);

            try {
                const buyTrade  = this.lab.constructTradeBestRateForTargetDemand(NATIVE_BCH_TOKEN_ID, buyId,  price,   buyPools,  TX_FEE_PER_BYTE);
                const sellTrade = this.lab.constructTradeBestRateForTargetSupply(sellId, NATIVE_BCH_TOKEN_ID, sellAmt, sellPools, TX_FEE_PER_BYTE);
                const buySwapFee  = estimateCauldronTxFee(buyTrade.entries.length);
                const sellSwapFee = estimateCauldronTxFee(sellTrade.entries.length);
                const fillFee     = estimateFillTxFee({ hasTokenChange: true, hasProfitOutput: this.profitOutputEnabled });
                const bchSpent    = buyTrade.summary.supply  + buyTrade.summary.trade_fee  + buySwapFee;
                const bchGained   = sellTrade.summary.demand - sellTrade.summary.trade_fee - sellSwapFee - fillFee;
                const profit      = bchGained - bchSpent;
                const buyMarg   = SpreadQuant.marginalPriceForTrade(buyPools,  'BCH', buyId,  price);
                const sellMarg  = SpreadQuant.marginalPriceForTrade(sellPools, sellId, 'BCH', sellAmt);
                const worstSlip = Math.max(buyMarg.slippageBps, sellMarg.slippageBps);
                candidates.push({
                    routeType: 'TOKEN_TO_TOKEN', profitSats: profit, tradeValueSats: bchSpent + bchGained,
                    slippageBps: worstSlip,
                    preFillTrade: buyTrade, postFillTrade: sellTrade,
                    preFillTokenId: buyId, postFillTokenId: sellId,
                    description: `2-HOP: spent=${bchSpent} gained=${bchGained} → profit=${profit}, slip=${worstSlip}bps`,
                });
            } catch (e: any) {
                return noRouteWithCtx(`Two-hop quote failed: ${e.message}`, this.policy);
            }

            return pickBest(candidates, this.policy);
        }

        return noRouteWithCtx('Unrecognized intent type', this.policy);
    }

    /**
     * Re-run the quote with a hypothetical maker-side price (used by the
     * DutchAuctionScheduler to project profit at a future decay point).
     */
    async requoteAtPrice(
        solution: AuctionSolution,
        solverUtxos: ElectrumUtxo[],
        projectedPrice: bigint,
    ): Promise<RouteQuote> {
        const projected: AuctionSolution = {
            ...solution,
            currentPrice: projectedPrice,
        };
        return this.quote(projected, solverUtxos);
    }

    // ── Execute pre-fill swap (BCH → buyToken, or heldToken → BCH → buyToken) ─

    async executePrefill(
        quote: RouteQuote,
        solverUtxos: ElectrumUtxo[],
        wallet: WalletInfo,
        provider: ElectrumNetworkProvider
    ): Promise<{ txid: string; consumedOutpoints: string[] }> {
        if (!quote.preFillTrade || !quote.preFillTokenId) {
            throw new Error('executePrefill called but quote has no preFillTrade');
        }
        const p2pkhBytecode = buildP2PKH(wallet.publicKeyHash);

        // INVENTORY_TO_TOKEN: two hops — first sell heldToken→BCH, then buy BCH→buyToken
        if (quote.routeType === 'INVENTORY_TO_TOKEN' && quote.preFillTrade2 && quote.preFillSourceTokenId) {
            return this._executeTwoHopPrefill(quote, solverUtxos, wallet, provider, p2pkhBytecode);
        }

        // BCH_TO_TOKEN: single hop — BCH UTXOs → buyToken
        const bchUtxos = solverUtxos.filter((u: any) => !u.token);
        if (!bchUtxos.length) throw new Error('No BCH UTXOs for pre-fill swap');
        // Claim these before broadcasting so no other concurrently-running fill
        // picks the same coins as candidate inputs (see UtxoReservation.ts).
        reserveOutpoints(bchUtxos.map((u: any) => `${u.txid}:${u.vout}`));

        const inputCoins: SpendableCoin[] = bchUtxos.map(u =>
            toSpendableCoin(u, wallet.privateKey, p2pkhBytecode)
        );

        const payoutRules: PayoutRule[] = [
            {
                // Allocate generous BCH dust (5000 sats) on the token output so future
                // direct fills using this UTXO can cover their tx fee.
                type: PayoutAmountRuleType.FIXED,
                locking_bytecode: buildP2PKH(wallet.publicKeyHash),
                token: { amount: quote.preFillTrade.summary.demand, token_id: quote.preFillTokenId },
                amount: 5000n,
            },
            { type: PayoutAmountRuleType.CHANGE, locking_bytecode: p2pkhBytecode },
        ];

        const result = this.lab.createTradeTx(
            quote.preFillTrade.entries, inputCoins, payoutRules, null, TX_FEE_PER_BYTE
        );
        this.lab.verifyTradeTx(result);
        const txhex = Buffer.from(result.txbin).toString('hex');
        const txid = await provider.sendRawTransaction(txhex);
        console.log(`[CauldronRouter] Pre-fill swap: ${txid}`);
        // Every BCH UTXO we wrapped as a SpendableCoin was spent by this tx.
        const consumedOutpoints = bchUtxos.map((u: any) => `${u.txid}:${u.vout}`);
        return { txid, consumedOutpoints };
    }

    /** Two-hop pre-fill: step 1 sells heldToken→BCH, step 2 buys BCH→buyToken. */
    private async _executeTwoHopPrefill(
        quote: RouteQuote,
        solverUtxos: ElectrumUtxo[],
        wallet: WalletInfo,
        provider: ElectrumNetworkProvider,
        p2pkhBytecode: Uint8Array,
    ): Promise<{ txid: string; consumedOutpoints: string[] }> {
        const sourceId = quote.preFillSourceTokenId!;
        const targetId = quote.preFillTokenId!;

        // Step 1: sell heldToken → BCH
        const sourceUtxos = solverUtxos.filter((u: any) => u.token?.category === sourceId);
        if (!sourceUtxos.length) throw new Error(`No ${sourceId.slice(0, 8)}… UTXOs for INVENTORY_TO_TOKEN step 1`);
        reserveOutpoints(sourceUtxos.map((u: any) => `${u.txid}:${u.vout}`));
        const step1Coins: SpendableCoin[] = sourceUtxos.map(u =>
            toSpendableCoin(u, wallet.privateKey, p2pkhBytecode)
        );
        const step1Rules: PayoutRule[] = [
            { type: PayoutAmountRuleType.CHANGE, locking_bytecode: p2pkhBytecode },
        ];
        const step1Result = this.lab.createTradeTx(
            quote.preFillTrade!.entries, step1Coins, step1Rules, null, TX_FEE_PER_BYTE
        );
        this.lab.verifyTradeTx(step1Result);
        const step1Txid = await provider.sendRawTransaction(Buffer.from(step1Result.txbin).toString('hex'));
        console.log(`[CauldronRouter] INVENTORY_TO_TOKEN step 1 (${sourceId.slice(0,8)}→BCH): ${step1Txid}`);
        const step1Consumed = sourceUtxos.map((u: any) => `${u.txid}:${u.vout}`);

        // Wait for step 1 BCH to appear before step 2
        const appeared = await this.waitForUtxo(step1Txid, wallet.cashaddr, provider, 60_000);
        if (!appeared) throw new Error(`INVENTORY_TO_TOKEN step 1 UTXO not found in mempool (${step1Txid})`);

        // Step 2: buy BCH → buyToken using fresh BCH UTXOs
        const freshUtxos = filterAvailable((await provider.getUtxos(wallet.cashaddr)).filter(
            (u: any) => !step1Consumed.includes(`${u.txid}:${u.vout}`)
        ));
        const bchUtxos = freshUtxos.filter((u: any) => !u.token);
        if (!bchUtxos.length) throw new Error('No BCH UTXOs after step 1 for INVENTORY_TO_TOKEN step 2');
        reserveOutpoints(bchUtxos.map((u: any) => `${u.txid}:${u.vout}`));
        const step2Coins: SpendableCoin[] = bchUtxos.map(u =>
            toSpendableCoin(u, wallet.privateKey, p2pkhBytecode)
        );
        const step2Rules: PayoutRule[] = [
            {
                type: PayoutAmountRuleType.FIXED,
                locking_bytecode: p2pkhBytecode,
                token: { amount: quote.preFillTrade2!.summary.demand, token_id: targetId },
                amount: 5000n,
            },
            { type: PayoutAmountRuleType.CHANGE, locking_bytecode: p2pkhBytecode },
        ];
        const step2Result = this.lab.createTradeTx(
            quote.preFillTrade2!.entries, step2Coins, step2Rules, null, TX_FEE_PER_BYTE
        );
        this.lab.verifyTradeTx(step2Result);
        const step2Txid = await provider.sendRawTransaction(Buffer.from(step2Result.txbin).toString('hex'));
        console.log(`[CauldronRouter] INVENTORY_TO_TOKEN step 2 (BCH→${targetId.slice(0,8)}): ${step2Txid}`);

        return { txid: step2Txid, consumedOutpoints: step1Consumed };
    }

    // ── Execute post-fill rebalance (sellToken → BCH) ─────────────────────────

    /**
     * @param profitAddress  Optional BCH address to receive the predicted profit slice.
     *                       When provided, a FIXED payout rule is inserted before CHANGE
     *                       so profit is segregated on-chain (Bug 1 fix).
     * @param predictedProfit  Sats to send to profitAddress. Should be ≤ net rebalance yield
     *                         minus dust (546 sats) to ensure CHANGE is never negative.
     */
    async executeRebalance(
        quote: RouteQuote,
        solverUtxos: ElectrumUtxo[],
        wallet: WalletInfo,
        provider: ElectrumNetworkProvider,
        profitAddress?: string | null,
        predictedProfit?: bigint,
    ): Promise<{ txid: string; consumedOutpoints: string[] }> {
        if (!quote.postFillTrade || !quote.postFillTokenId) {
            throw new Error('executeRebalance called but quote has no postFillTrade');
        }
        const tokenId = quote.postFillTokenId;
        const p2pkhBytecode = buildP2PKH(wallet.publicKeyHash);

        const tokenUtxos = solverUtxos.filter((u: any) => u.token?.category === tokenId);
        if (!tokenUtxos.length) throw new Error(`No ${tokenId.slice(0, 8)}… UTXOs for rebalance`);
        reserveOutpoints(tokenUtxos.map((u: any) => `${u.txid}:${u.vout}`));

        const inputCoins: SpendableCoin[] = tokenUtxos.map(u =>
            toSpendableCoin(u, wallet.privateKey, p2pkhBytecode)
        );

        // Build profit locking bytecode if segregation is requested (Bug 1 fix)
        let profitBytecode: Uint8Array | null = null;
        if (profitAddress && predictedProfit && predictedProfit > 546n) {
            const r = cashAddressToLockingBytecode(profitAddress);
            if (typeof r !== 'string') profitBytecode = r.bytecode;
        }

        const payoutRules: PayoutRule[] = [];
        // FIXED profit output must come before CHANGE so CashLab reserves it first
        if (profitBytecode && predictedProfit) {
            payoutRules.push({
                type: PayoutAmountRuleType.FIXED,
                locking_bytecode: profitBytecode,
                amount: predictedProfit,
            });
        }
        payoutRules.push({
            type: PayoutAmountRuleType.CHANGE,
            locking_bytecode: p2pkhBytecode,
            add_change_to_txfee_when_bch_change_is_dust: true,
        });

        const result = this.lab.createTradeTx(
            quote.postFillTrade.entries, inputCoins, payoutRules, null, TX_FEE_PER_BYTE
        );
        this.lab.verifyTradeTx(result);
        const txhex = Buffer.from(result.txbin).toString('hex');
        const txid = await provider.sendRawTransaction(txhex);
        console.log(`[CauldronRouter] Rebalance swap: ${txid}${profitBytecode ? ` (profit ${predictedProfit} sats → ${profitAddress})` : ''}`);
        const consumedOutpoints = tokenUtxos.map((u: any) => `${u.txid}:${u.vout}`);
        return { txid, consumedOutpoints };
    }

    // ── Wait for a UTXO to appear in mempool/confirmed ────────────────────────

    async waitForUtxo(
        txid: string,
        address: string,
        provider: ElectrumNetworkProvider,
        timeoutMs = 60_000
    ): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const utxos = await provider.getUtxos(address);
            if (utxos.some((u: any) => u.txid === txid)) return true;
            await sleep(3000);
        }
        console.warn(`[CauldronRouter] Timed out waiting for ${txid} (${timeoutMs}ms)`);
        return false;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a RouteQuote out of a single accepted candidate. */
function finalize(c: RouteCandidate, policy: PolicyConfig, candidatesConsidered: number, overrideOK = false): RouteQuote {
    const tokenIdForPolicy = c.preFillTokenId ?? c.postFillTokenId ?? undefined;
    const evalResult = overrideOK
        ? { acceptable: true, reason: 'override', effectiveBps: 0, appliedFloor: policy } as Policy.EvalResult
        : Policy.evaluate({
            profitSats: c.profitSats,
            tradeValueSats: c.tradeValueSats,
            slippageBps: c.slippageBps,
            tokenId: tokenIdForPolicy,
          }, policy);
    return {
        profitable: evalResult.acceptable,
        routeType: c.routeType,
        netProfitSats: c.profitSats,
        preFillTrade: c.preFillTrade,
        postFillTrade: c.postFillTrade,
        preFillTokenId: c.preFillTokenId,
        postFillTokenId: c.postFillTokenId,
        preFillTrade2: c.preFillTrade2 ?? null,
        preFillSourceTokenId: c.preFillSourceTokenId ?? null,
        reason: evalResult.acceptable
            ? `${c.routeType}: ${c.description}`
            : `rejected ${c.routeType} — ${evalResult.reason} (${c.description})`,
        slippageBps: c.slippageBps,
        effectiveBps: evalResult.effectiveBps,
        candidatesConsidered,
    };
}

function pickBest(candidates: RouteCandidate[], policy: PolicyConfig): RouteQuote {
    if (candidates.length === 0) return noRouteWithCtx('No routes available', policy);

    // Evaluate each candidate, then pick highest-profit ACCEPTED, falling
    // back to highest-profit overall (to surface the rejection reason).
    const evaluated = candidates.map(c => {
        const tokenIdForPolicy = c.preFillTokenId ?? c.postFillTokenId ?? undefined;
        const evalRes = Policy.evaluate({
            profitSats: c.profitSats, tradeValueSats: c.tradeValueSats,
            slippageBps: c.slippageBps, tokenId: tokenIdForPolicy,
        }, policy);
        return { ...c, policyEval: evalRes };
    });

    const accepted = evaluated.filter(c => c.policyEval!.acceptable);
    const ranked = (accepted.length ? accepted : evaluated)
        .slice()
        .sort((a, b) => (a.profitSats > b.profitSats ? -1 : a.profitSats < b.profitSats ? 1 : 0));

    const best = ranked[0];
    const quote = finalize(best, policy, candidates.length);

    // Override reason to include diagnostic listing
    if (candidates.length > 1) {
        const listing = evaluated
            .map(c => `${c.routeType}[${c.policyEval!.acceptable ? 'OK' : 'NO'}] +${c.profitSats}s/${c.policyEval!.effectiveBps}bps`)
            .join(' | ');
        quote.reason = `${quote.reason}  [candidates: ${listing}]`;
    }
    return quote;
}

function failedCandidate(routeType: RouteType, reason: string, tradeValue: bigint): RouteCandidate {
    return {
        routeType, profitSats: -1n << 60n, tradeValueSats: tradeValue, slippageBps: 0,
        preFillTrade: null, postFillTrade: null, preFillTokenId: null, postFillTokenId: null,
        description: reason,
    };
}

function noRouteWithCtx(reason: string, _policy: PolicyConfig): RouteQuote {
    return {
        profitable: false, routeType: 'DIRECT', netProfitSats: 0n,
        preFillTrade: null, postFillTrade: null,
        preFillTokenId: null, postFillTokenId: null,
        reason, slippageBps: 0, effectiveBps: 0, candidatesConsidered: 0,
    };
}

function buildP2PKH(pkh: Uint8Array): Uint8Array {
    const hex = Buffer.from(pkh).toString('hex');
    return Uint8Array.from(Buffer.from(`76a914${hex}88ac`, 'hex'));
}

function toSpendableCoin(u: ElectrumUtxo, privateKey: Uint8Array, p2pkhBytecode: Uint8Array): SpendableCoin {
    const output: Output = {
        locking_bytecode: p2pkhBytecode,
        amount: BigInt((u as any).satoshis),
        token: (u as any).token ? {
            amount: BigInt((u as any).token.amount),
            token_id: (u as any).token.category,
        } : undefined,
    };
    return {
        type: SpendableCoinType.P2PKH,
        key: privateKey,
        output,
        outpoint: {
            txhash: Uint8Array.from(Buffer.from((u as any).txid, 'hex')),
            index: Number((u as any).vout),
        },
    };
}

type ElectrumUtxo = { txid: string; vout: number; satoshis: bigint | number; token?: { amount: bigint | number; category: string } };

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}
