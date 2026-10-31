import { TestNetWallet, Wallet } from 'mainnet-js';
import { ElectrumNetworkProvider, SignatureTemplate, TransactionBuilder } from 'cashscript';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import { AuctionSolution } from './DutchAuctionSolver.js';
import { filterAvailable, reserveOutpoint } from './UtxoReservation.js';
import { ENV } from '../config.js';
import { getSpendLocktime } from './CovenantClock.js';
import * as fs from 'fs';

const EXEC_LOG = 'executor_debug.log';
function execLog(msg: string) { fs.appendFileSync(EXEC_LOG, msg + '\n'); }

// Minimum sats a profit-segregation output is worth creating
const PROFIT_OUTPUT_MIN_SATS = 546n;

const FEE_PER_BYTE = 2n;

/**
 * Fee for a BCH-buy covenant fill, derived from transaction size.
 *
 * Shape: 2 inputs (covenant unlock ≈ 250 B, P2PKH funding ≈ 150 B) + maker output
 * (~34 B) + resolver output (~34 B) + change (~34 B) + header/locktime (~14 B),
 * plus an optional profit-segregation output.
 *
 * A generous floor is applied because a fill that fails min-relay is worse than one
 * that overpays slightly — but nowhere near the flat 3000 this replaced, which
 * overpaid a ~370-byte transaction by ~2260 sats every time.
 */
export function estimateBchFillFee(opts: { hasProfitOutput?: boolean } = {}): bigint {
    let bytes = 14n + 250n + 150n + 34n + 34n + 34n;
    if (opts.hasProfitOutput) bytes += 34n;
    const fee = bytes * FEE_PER_BYTE;
    const FLOOR = 800n;   // comfortably clears 1 sat/byte min-relay for this shape
    return fee > FLOOR ? fee : FLOOR;
}

export class RelayerExecutor {
    private wallet!: TestNetWallet | Wallet;
    public network: string = 'chipnet';
    public profitLockingBytecode: Uint8Array | null = null;
    public profitAddress: string | null = null;

    constructor() { }

    public async init(wallet: TestNetWallet | Wallet, network: string = 'chipnet') {
        this.wallet = wallet;
        this.network = network;
    }

    /** Configure a separate BCH address that the predicted-profit slice of each fill will be sent to. */
    public setProfitAddress(address: string | null) {
        if (!address) {
            this.profitAddress = null;
            this.profitLockingBytecode = null;
            return;
        }
        const result = cashAddressToLockingBytecode(address);
        if (typeof result === 'string') {
            console.warn(`[Executor] Invalid profit address (${result}); segregation disabled`);
            this.profitAddress = null;
            this.profitLockingBytecode = null;
            return;
        }
        this.profitAddress = address;
        this.profitLockingBytecode = result.bytecode;
        console.log(`[Executor] Profit segregation ON → ${address}`);
    }

    public async execute(solution: AuctionSolution): Promise<{ txid: string; consumedOutpoints: string[] } | undefined> {
        try {
            if (!this.wallet) throw new Error("Wallet not initialized");

            execLog(`=== EXECUTE CALLED ===`);
            execLog(`Solution structure keys: ${Object.keys(solution).join(', ')}`);
            execLog(`Solution.currentPrice: ${solution.currentPrice} (type: ${typeof solution.currentPrice})`);

            // Defensive extraction
            const price = solution.currentPrice;
            if (price === undefined || price === null) {
                const msg = `CRITICAL: Price is ${price} - solution object corrupted`;
                execLog(msg);
                throw new Error(msg);
            }
            execLog(`Price variable: ${price} (type: ${typeof price})`);

            console.log(`Executing Swap for ${solution.utxo.address}...`);

            if (solution.isExpired) {
                console.log(`Intent at ${solution.utxo.address} is expired. Executing refund...`);
                return await this.executeRefund(solution);
            }

            const contract = solution.contract as any;
            const utxo = solution.utxo;
            const params = solution.params;
            // const price = solution.currentPrice; // This line is now redundant due to the defensive extraction above

            // --- Relayer Details ---
            const relayerAddr = (this.wallet as any).cashaddr;
            if (!relayerAddr) throw new Error("Cannot get Relayer Address from wallet");
            const relayerTokenAddr = (this.wallet as any).tokenaddr;
            if (!relayerTokenAddr) throw new Error("Cannot get Relayer Token Address from wallet");
            console.log(`   Relayer Address: ${relayerAddr}`);
            console.log(`   Relayer Token Address: ${relayerTokenAddr}`);

            // Public Key (use compressed key - BCH addresses are derived from compressed key hash160)
            const relayerPkRaw: Uint8Array = (this.wallet as any).publicKeyCompressed || (this.wallet as any).publicKey;
            if (!relayerPkRaw) throw new Error("Cannot get Relayer Public Key from wallet");
            const relayerPkHex = Buffer.from(relayerPkRaw).toString('hex');
            console.log(`   Relayer PK (${relayerPkRaw.length} bytes): ${relayerPkHex}`);

            // Private Key WIF for signing
            const privKeyWif = (this.wallet as any).privateKeyWif;
            if (!privKeyWif) throw new Error("Cannot get private key WIF from wallet");

            const sigTemplate = new SignatureTemplate(privKeyWif);

            // Helper to strip 0x prefix from hex strings
            const stripHex = (s: string) => s.startsWith('0x') ? s.slice(2) : s;

            // --- Contract UTXO (CashScript format) ---
            const contractUtxo = {
                txid: utxo.txid,
                vout: utxo.vout,
                satoshis: BigInt(utxo.satoshis),
                token: utxo.token ? {
                    amount: BigInt(utxo.token.amount),
                    category: stripHex(utxo.token.category),
                } : undefined
            };

            // --- Maker Output Address (P2PKH locking script) ---
            const toHex = (arr: Uint8Array) => Buffer.from(arr).toString('hex');
            const makerPkhHex = toHex(params.makerPkh);
            // Build raw P2PKH locking bytecode: OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
            const makerLockingBytecode = Uint8Array.from(
                Buffer.from(`76a914${makerPkhHex}88ac`, 'hex')
            );


            // --- Build Transaction using TransactionBuilder ---
            const provider = contract.provider as ElectrumNetworkProvider;
            const tb = new TransactionBuilder({ provider });

            // --- Fetch relayer UTXOs (both P2PKH and token addresses) ---
            execLog(`   Fetching UTXOs via Electrum provider for ${relayerAddr}...`);
            const fundingUtxos1 = await provider.getUtxos(relayerAddr);
            const fundingUtxos2 = await provider.getUtxos(relayerTokenAddr);
            // Deduplicate by txid:vout
            const seenKeys = new Set<string>();
            const dedupedUtxos = [...fundingUtxos1, ...fundingUtxos2].filter((u: any) => {
                const k = `${u.txid}:${u.vout}`;
                if (seenKeys.has(k)) return false;
                seenKeys.add(k);
                return true;
            });
            // Drop any outpoint another concurrently-running fill has already claimed
            // as an input this cycle (see UtxoReservation.ts) — prevents two parallel
            // fills from picking the same funding UTXO before either has broadcast.
            const allRelayerUtxos = filterAvailable(dedupedUtxos);
            execLog(`   Got ${allRelayerUtxos.length} total deduplicated UTXOs (${dedupedUtxos.length - allRelayerUtxos.length} reserved by other in-flight fills)`);

            const bchUtxos = allRelayerUtxos.filter((u: any) => !u.token);
            const totalBalance = bchUtxos.reduce((acc: bigint, u: any) => acc + BigInt(u.satoshis), 0n);
            execLog(`   Relayer BCH Balance: ${totalBalance} sats`);

            // P2PKH locking bytecode for relayer outputs
            const relayerPKHText = Buffer.from((this.wallet as any).publicKeyHash).toString('hex');
            const p2pkhLockingBytecode = Uint8Array.from(
                Buffer.from(`76a914${relayerPKHText}88ac`, 'hex')
            );

            const buyTokenCatRaw = stripHex(params.buyTokenCategory); // BE hex, no 0x
            const isBchBuy = !buyTokenCatRaw || buyTokenCatRaw === '';
            const sellTokenCatRaw = stripHex(params.sellTokenCategory);
            const isBchSell = !sellTokenCatRaw || sellTokenCatRaw === '';

            // Guard: for BCH→Token fills, the contract must hold >= sellAmount sats
            if (!isBchBuy && isBchSell) {
                const contractSatsCheck = BigInt(utxo.satoshis);
                if (contractSatsCheck < BigInt(params.sellAmount)) {
                    const msg = `Skipping under-funded BCH→Token intent: contract has ${contractSatsCheck} sats but sellAmount=${params.sellAmount}`;
                    console.warn(msg); execLog(msg); return;
                }
            }

            // 1. Add contract input
            const contractUnlocker = contract.unlock.fill(relayerPkHex, sigTemplate);
            tb.addInput(contractUtxo, contractUnlocker);

            // 2. Add exactly 1 P2PKH funding input from relayer wallet
            //    Contract enforces require(tx.inputs.length == 2): covenant + 1 funding
            const p2pkhUnlocker = sigTemplate.unlockP2PKH();
            // Fee for the BCH-buy fill path, derived from actual transaction size.
            //
            // This was a flat 3000n. A BCH→BCH fill is ~370 bytes, so at 2 sat/byte it
            // needs ~740 — the constant was overpaying miners by ~2260 sats on every
            // such fill, roughly a quarter of the spread on a 10k-spread order
            // (verified by decoding 12 live fills, each of which paid exactly 3000).
            // The token-buy path below computes its own fee from what is available.
            const approxFee = estimateBchFillFee({ hasProfitOutput: !!this.profitLockingBytecode });
            let relayerUtxoSatoshis: bigint;
            // Hoisted so the change-output stage can re-use the *same* token UTXO that was added as input[1].
            let pickedTokenUtxo: any = null;
            // Track the relayer-owned funding input we spend, so the bot loop can filter it out of
            // the next iteration's solverUtxos before Electrum has propagated the broadcast.
            let fundingOutpoint: string | null = null;

            if (isBchBuy) {
                // BCH→BCH or Token→BCH: relayer pays BCH price, use a plain BCH UTXO
                if (bchUtxos.length === 0) {
                    execLog('No BCH UTXOs for funding!'); return;
                }
                const sortedBch = [...bchUtxos].sort((a: any, b: any) =>
                    Number(BigInt(a.satoshis) - BigInt(b.satoshis))
                );
                const u = sortedBch.find((u: any) => BigInt(u.satoshis) >= price + approxFee)
                    || sortedBch[sortedBch.length - 1];
                relayerUtxoSatoshis = BigInt(u.satoshis);
                if (relayerUtxoSatoshis < price + approxFee) {
                    const msg = `No BCH UTXO covers fill price (${price} + fee). Consolidate UTXOs.`;
                    console.error(msg); execLog(msg); return;
                }
                tb.addInput({ txid: u.txid, vout: u.vout, satoshis: relayerUtxoSatoshis }, p2pkhUnlocker);
                fundingOutpoint = `${u.txid}:${u.vout}`;
                reserveOutpoint(fundingOutpoint); // claim before any other concurrent fill can pick it
            } else {
                // BCH→Token: relayer must supply the buyToken from a token UTXO as input[1]
                // The token UTXO also carries BCH sats; fee comes from those sats.
                const buyTokenUtxos = allRelayerUtxos.filter(
                    (u: any) => u.token?.category === buyTokenCatRaw
                );
                const totalBuyTokens = buyTokenUtxos.reduce(
                    (s: bigint, u: any) => s + BigInt(u.token!.amount), 0n
                );
                execLog(`   Buy token (${buyTokenCatRaw}): ${buyTokenUtxos.length} UTXOs, ${totalBuyTokens} units`);

                if (totalBuyTokens < price) {
                    const msg = `Insufficient buy token balance! Need ${price}, have ${totalBuyTokens}`;
                    console.error(msg); execLog(msg); return;
                }
                // Pick a single UTXO that has BOTH ≥ price tokens AND enough BCH dust to cover
                // the tx fee (contract enforces exactly 2 inputs, so the funding sats must come
                // from this token UTXO's own dust budget). Sort viable candidates by tokens-desc.
                const MIN_DUST_SATS = 3500n;
                const viable = buyTokenUtxos
                    .filter((u: any) => BigInt(u.token!.amount) >= price && BigInt(u.satoshis) >= MIN_DUST_SATS)
                    .sort((a: any, b: any) => Number(BigInt(b.token!.amount) - BigInt(a.token!.amount)));
                if (viable.length === 0) {
                    const msg = `No single token UTXO has ≥${price} tokens AND ≥${MIN_DUST_SATS} sats dust. Inventory exists but is fragmented; route should have fallen back to Cauldron.`;
                    console.error(msg); execLog(msg); return;
                }
                pickedTokenUtxo = viable[0];
                relayerUtxoSatoshis = BigInt(pickedTokenUtxo.satoshis);
                fundingOutpoint = `${pickedTokenUtxo.txid}:${pickedTokenUtxo.vout}`;
                reserveOutpoint(fundingOutpoint); // claim before any other concurrent fill can pick it
                tb.addInput({
                    txid: pickedTokenUtxo.txid, vout: pickedTokenUtxo.vout, satoshis: relayerUtxoSatoshis,
                    token: { amount: BigInt(pickedTokenUtxo.token!.amount), category: buyTokenCatRaw },
                }, p2pkhUnlocker);
                execLog(`   Using token UTXO: ${pickedTokenUtxo.txid}:${pickedTokenUtxo.vout} (${pickedTokenUtxo.token!.amount} units, ${relayerUtxoSatoshis} sats)`);
            }

            // 3. Output 0: pay buyToken (or BCH) to maker
            if (isBchBuy) {
                tb.addOutput({ to: makerLockingBytecode, amount: price });
            } else {
                // Token buy: send `price` units of buyToken to maker + 1000 dust BCH
                tb.addOutput({
                    to: makerLockingBytecode,
                    amount: 1000n,
                    token: { amount: price, category: buyTokenCatRaw },
                });
            }

            // 4. Output 1: return sell tokens (or BCH) to relayer
            console.log(`   Sell token category: ${sellTokenCatRaw || '(BCH)'}`);
            if (!isBchSell) {
                tb.addOutput({
                    to: p2pkhLockingBytecode,
                    amount: 1000n,
                    token: { amount: BigInt(params.sellAmount), category: sellTokenCatRaw },
                });
            } else {
                tb.addOutput({ to: p2pkhLockingBytecode, amount: BigInt(params.sellAmount) });
            }

            // 5. Change output: return excess sats/tokens to relayer (+ optional profit-address slice)
            const predictedProfit = solution.predictedProfitSats ?? 0n;
            if (isBchBuy) {
                // BCH buy: change = relayerBchInput - price - fee
                const change = relayerUtxoSatoshis - price - approxFee;
                const { profitSlice, operatingChange } = splitProfit(change, predictedProfit, !!this.profitLockingBytecode);
                if (operatingChange > 546n) {
                    tb.addOutput({ to: p2pkhLockingBytecode, amount: operatingChange });
                    execLog(`   BCH change (operating): ${operatingChange} sats`);
                }
                if (profitSlice > 0n && this.profitLockingBytecode) {
                    tb.addOutput({ to: this.profitLockingBytecode, amount: profitSlice });
                    execLog(`   BCH profit slice: ${profitSlice} sats → ${this.profitAddress}`);
                }
            } else {
                // Token buy: return leftover tokens + leftover sats to relayer.
                // IMPORTANT: Contract enforces require(tx.inputs.length == 2),
                // so we CANNOT add a 3rd input. Fee must come from existing sats.
                // CRITICAL: use the SAME token UTXO that was added as input[1] above
                // (the `viable` filter picked it). Re-finding here can pick a
                // different UTXO and corrupt token conservation.
                if (!pickedTokenUtxo) throw new Error('pickedTokenUtxo is null — should be set in input stage');
                const tokenInputAmount = BigInt(pickedTokenUtxo.token!.amount);
                const tokenChange = tokenInputAmount - price;

                const contractSats = BigInt(utxo.satoshis);
                const out1Sats = isBchSell ? BigInt(params.sellAmount) : 1000n;
                const totalSatIn = contractSats + relayerUtxoSatoshis;

                // Dynamic fee: use whatever sats are left after required outputs
                const requiredOut = 1000n + out1Sats; // maker dust + sell output
                const availableForFee = totalSatIn - requiredOut;
                if (availableForFee < 500n) {
                    const msg = `Not enough sats for fee: have ${totalSatIn}, need ${requiredOut} + fee. Token UTXO needs more BCH.`;
                    console.error(msg); execLog(msg); return;
                }
                // Cap fee at 2000 sats, use the rest as change
                const actualFee = availableForFee > 2000n ? 2000n : availableForFee;
                execLog(`   Dynamic fee: ${actualFee} sats (available: ${availableForFee})`);

                const satChange = totalSatIn - requiredOut - actualFee;

                // Split satChange into [operating change, profit slice]
                const { profitSlice, operatingChange } = splitProfit(satChange, predictedProfit, !!this.profitLockingBytecode);

                if (tokenChange > 0n) {
                    // Token change MUST land with at least MIN_TOKEN_UTXO_DUST_SATS, the
                    // same bar CauldronRouter uses to decide whether a DIRECT fill is
                    // possible at all.
                    //
                    // This used to floor at 1000 while the router required 3500, which
                    // made inventory a one-way ratchet: a Cauldron pre-fill mints a
                    // viable 5000-sat token UTXO, the fill consumes it and hands back
                    // change below the router's own bar, so the next fill has to go
                    // through Cauldron again — minting one viable UTXO and one more dead
                    // one, forever. Live inventory showed exactly that: 14444 units on
                    // 657 sats and 9 units on 1000 sats, neither usable, while the
                    // dashboard reported a healthy token balance.
                    //
                    // The dust comes out of the profit slice (below). That is the right
                    // trade: it is working capital that unlocks a route saving ~1680 sats
                    // of swap fee plus LP fees on every subsequent token fill, and the
                    // sats stay in the operating wallet either way.
                    const dustFloor = ENV.MIN_TOKEN_UTXO_DUST_SATS;
                    const tokenOutSats = operatingChange > dustFloor ? operatingChange : dustFloor;
                    if (totalSatIn - requiredOut - actualFee < tokenOutSats) {
                        // Cannot reach the floor even by giving up the whole profit slice.
                        // Emit what we can rather than failing the fill outright — a
                        // starved UTXO is still worth more than an unfilled order.
                        execLog(`   WARN: only ${satChange} sats for token change, below dust floor ${dustFloor}`);
                    }
                    tb.addOutput({
                        to: p2pkhLockingBytecode,
                        amount: tokenOutSats > satChange ? satChange : tokenOutSats,
                        token: { amount: tokenChange, category: buyTokenCatRaw },
                    });
                    execLog(`   Token change: ${tokenChange} units, ${tokenOutSats} sats (floor ${dustFloor})`);
                    // Whatever the token output borrowed above `operatingChange` is taken
                    // off the profit slice, so the transaction still balances.
                    const bundledExtra = tokenOutSats > operatingChange ? tokenOutSats - operatingChange : 0n;
                    const adjustedProfit = profitSlice > bundledExtra ? profitSlice - bundledExtra : 0n;
                    if (adjustedProfit > 0n && this.profitLockingBytecode) {
                        tb.addOutput({ to: this.profitLockingBytecode, amount: adjustedProfit });
                        execLog(`   BCH profit slice: ${adjustedProfit} sats → ${this.profitAddress}`);
                    }
                } else {
                    if (operatingChange > 546n) {
                        tb.addOutput({ to: p2pkhLockingBytecode, amount: operatingChange });
                        execLog(`   Sats change (operating): ${operatingChange}`);
                    }
                    if (profitSlice > 0n && this.profitLockingBytecode) {
                        tb.addOutput({ to: this.profitLockingBytecode, amount: profitSlice });
                        execLog(`   BCH profit slice: ${profitSlice} sats → ${this.profitAddress}`);
                    }
                }
            }

            // 5. Locktime, read from the chain's real median-time-past.
            //    A timestamp locktime is only final once locktime <= MTP (BIP113), so it
            //    must sit in the past — but "how far past" is a property of recent block
            //    intervals, not a constant. See CovenantClock.ts: the clock advances
            //    1:1 with wall time so the decay curve is continuous, and MTP is read
            //    from the chain to verify the backdate still clears the real lag.
            // The value the solver priced against. Re-deriving it here — even from the
            // same MTP a moment later — is what produced a fill the covenant rejected.
            const locktime = solution.lockTimeSec;
            tb.setLocktime(locktime);

            // Debug: Print category info
            const outputCategory = stripHex(params.sellTokenCategory);
            console.log(`   Output token category (stripped): ${outputCategory}`);
            console.log(`   Contract sellTokenCategory (raw): ${params.sellTokenCategory}`);
            console.log(`   UTXO token category: ${utxo.token?.category}`);
            console.log(`   Contract address: ${contract.address}`);

            // Debug: Build raw transaction hex
            try {
                const rawHex = tb.build();
                console.log(`   Raw TX (first 500 chars): ${rawHex.slice(0, 500)}`);
            } catch (buildErr: any) {
                console.log("   Build error (pre-check):", buildErr.message?.slice(0, 500));
            }

            console.log("Broadcasting Execute Transaction...");
            const txDetails = await tb.send();
            console.log("✅ Swap Executed! TXID:", txDetails.txid);
            return {
                txid: txDetails.txid,
                consumedOutpoints: fundingOutpoint ? [fundingOutpoint] : [],
            };

        } catch (e: any) {
            console.error("Executor Failed:", e);
            execLog(`Executor Failed: ${e.message}`);
            if (e.message) console.error(e.message);
        }
    }

    private async executeRefund(solution: AuctionSolution) {
        try {
            const contract = solution.contract as any;
            const utxo = solution.utxo;
            const params = solution.params;
            const provider = contract.provider as ElectrumNetworkProvider;
            const tb = new TransactionBuilder({ provider });

            // 1. Contract input with cancel()
            const contractUnlocker = contract.unlock.cancel();
            
            const stripHex = (s: string) => s.startsWith('0x') ? s.slice(2) : s;
            const contractUtxo = {
                txid: utxo.txid,
                vout: utxo.vout,
                satoshis: BigInt(utxo.satoshis),
                token: utxo.token ? {
                    amount: BigInt(utxo.token.amount),
                    category: stripHex(utxo.token.category),
                } : undefined
            };

            tb.addInput(contractUtxo, contractUnlocker);

            // 2. Add funding input for miner fee (use provider for network-aware UTXO fetch).
            //    Pick the SMALLEST viable BCH UTXO — the cancel() contract clause only
            //    constrains output[0], so we add a change output to recover the rest.
            //    Picking the smallest still minimises the dust we burn if change drops
            //    below the 546-sat floor.
            const relayerAddr = (this.wallet as any).cashaddr;
            const REFUND_TX_FEE = 1500n;       // ~700 bytes × 2 sats/byte, conservative
            const refundUtxos = filterAvailable(await provider.getUtxos(relayerAddr));
            const bchUtxos = refundUtxos.filter((u: any) => !u.token);
            if (bchUtxos.length === 0) throw new Error("No BCH UTXOs for refund fee");

            // Funding budget = fee (everything else flows back as change).
            // For BCH-sell refunds we don't even need the funding input to cover sellAmount —
            // the covenant input already carries it. We just need ≥ REFUND_TX_FEE sats.
            const sortedBch = [...bchUtxos].sort((a: any, b: any) =>
                Number(BigInt(a.satoshis) - BigInt(b.satoshis))
            );
            const u = sortedBch.find((u: any) => BigInt(u.satoshis) >= REFUND_TX_FEE + 546n)
                || sortedBch[sortedBch.length - 1];
            reserveOutpoint(`${u.txid}:${u.vout}`); // claim before any other concurrent fill can pick it
            const fundingSats = BigInt(u.satoshis);
            if (fundingSats < REFUND_TX_FEE) {
                throw new Error(`No BCH UTXO covers refund fee (need ≥${REFUND_TX_FEE} sats)`);
            }

            const privKeyWif = (this.wallet as any).privateKeyWif;
            const sigTemplate = new SignatureTemplate(privKeyWif);
            const p2pkhUnlocker = sigTemplate.unlockP2PKH();
            tb.addInput({ txid: u.txid, vout: u.vout, satoshis: fundingSats }, p2pkhUnlocker);

            // 3. Output 0: Return locked funds to maker (contract enforces this)
            const toHex = (arr: Uint8Array) => Buffer.from(arr).toString('hex');
            const makerPkhHex = toHex(params.makerPkh);
            const makerLockingBytecode = Uint8Array.from(Buffer.from(`76a914${makerPkhHex}88ac`, 'hex'));
            const relayerPkhHex = Buffer.from((this.wallet as any).publicKeyHash).toString('hex');
            const relayerLockingBytecode = Uint8Array.from(Buffer.from(`76a914${relayerPkhHex}88ac`, 'hex'));

            let changeBeforeFee: bigint;
            if (utxo.token) {
                tb.addOutput({
                    to: makerLockingBytecode,
                    amount: 1000n,           // dust for token output
                    token: {
                        amount: BigInt(utxo.token.amount),
                        category: stripHex(utxo.token.category),
                    },
                });
                // Funding sats + (covenantSats - 1000 dust) → all available for change
                changeBeforeFee = fundingSats + BigInt(utxo.satoshis) - 1000n;
            } else {
                tb.addOutput({
                    to: makerLockingBytecode,
                    amount: BigInt(params.sellAmount),
                });
                changeBeforeFee = fundingSats + BigInt(utxo.satoshis) - BigInt(params.sellAmount);
            }

            // 4. Output 1: Refund relayer change (contract leaves outputs[1+] unconstrained).
            //    Without this, the full funding UTXO would be burned as miner fee.
            const change = changeBeforeFee - REFUND_TX_FEE;
            if (change >= 546n) {
                tb.addOutput({ to: relayerLockingBytecode, amount: change });
                execLog(`   Refund change: ${change} sats back to relayer`);
            }

            // Locktime must satisfy BOTH:
            //   (a) contract:  tx.time >= expiryTime  (cancel() guard)
            //   (b) consensus: locktime <= MTP for the node to consider the tx "final"
            // Read from real MTP rather than a fixed backdate — same clock the fill path
            // and the solver use, which is what keeps the covenant's own time checks and
            // our decisions in agreement. See CovenantClock.ts.
            const locktime = solution.lockTimeSec;
            // Guard: locktime must have reached the covenant's cancel() threshold.
            //   LIMIT: cancel() requires tx.time >= expiryTime
            //   DUTCH: cancel() requires tx.time >= startTime + duration
            // (DutchAuctionIntent has no expiryTime field — deriving the Dutch bound
            // from startTime+duration is required, otherwise the guard silently
            // evaluates to 0 and we broadcast an invalid transaction.)
            const p: any = params;
            const cancelThreshold = p.expiryTime !== undefined
                ? Number(p.expiryTime)
                : (p.duration !== undefined ? Number(p.startTime) + Number(p.duration) : 0);
            if (cancelThreshold && locktime < cancelThreshold) {
                throw new Error(`Refund not yet broadcastable: locktime ${locktime} < cancel threshold ${cancelThreshold}. Try again in ${cancelThreshold - locktime}s.`);
            }
            tb.setLocktime(locktime);

            const txDetails = await tb.send();
            console.log("✅ Refund Executed! TXID:", txDetails.txid);
            // Refund consumes only the relayer's BCH fee-funding input; surface it for the spent-set.
            return { txid: txDetails.txid, consumedOutpoints: [`${u.txid}:${u.vout}`] };

        } catch (e: any) {
            console.error("Refund Executor Failed:", e.message);
        }
    }
}

/**
 * Split a single change amount into [operating change, profit slice].
 *
 * - Operating change always retains ≥ 546 sats of dust to remain spendable.
 * - Profit slice is min(predictedProfit, change − 546) and is only emitted
 *   when both `profitEnabled` is true AND the slice clears the dust floor.
 * - Predicted profit is clamped to non-negative.
 */
export function splitProfit(
    change: bigint,
    predictedProfit: bigint,
    profitEnabled: boolean,
): { profitSlice: bigint; operatingChange: bigint } {
    if (change <= 0n) return { profitSlice: 0n, operatingChange: 0n };
    if (!profitEnabled || predictedProfit <= 0n) {
        return { profitSlice: 0n, operatingChange: change };
    }
    const maxProfit = change - PROFIT_OUTPUT_MIN_SATS;
    if (maxProfit < PROFIT_OUTPUT_MIN_SATS) {
        return { profitSlice: 0n, operatingChange: change };
    }
    const slice = predictedProfit > maxProfit ? maxProfit : predictedProfit;
    return { profitSlice: slice, operatingChange: change - slice };
}
