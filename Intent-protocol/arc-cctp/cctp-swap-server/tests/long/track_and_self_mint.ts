/**
 * The "funds can't get stuck because of us" property, live:
 *   1. the user burns TRACK_SRC → TRACK_DST directly (no API; default Base Sepolia → Arc),
 *   2. fetches Circle's attestation and mints on the destination themselves (needs gas there),
 *   3. registers the burn with POST /track → the server must end in COMPLETED_EXTERNAL without minting.
 */
import { getChain, config } from '../../src/config.js';
import { formatUsdc, parseUsdc } from '../../src/cctp/encoding.js';
import { IrisClient, isAttestationReady } from '../../src/cctp/iris.js';
import { computeQuote } from '../../src/cctp/quote.js';
import { EvmAdapter } from '../../src/evm/EvmAdapter.js';
import { TxSender } from '../../src/evm/TxSender.js';
import { e2eWallets } from '../../scripts/e2e_lib.js';
import { http, serverUp } from '../lib/env.js';
import { check, finish, skip, suite } from '../lib/report.js';
import { ethers } from 'ethers';

suite('long/track_and_self_mint');
if (!(await serverUp())) { skip('track + self-mint', 'server not running'); process.exit(finish()); }

const src = getChain(process.env.TRACK_SRC || 'base-sepolia')!, dst = getChain(process.env.TRACK_DST || 'arc-testnet')!;
const srcA = new EvmAdapter(src), dstA = new EvmAdapter(dst);
const w = e2eWallets();
const iris = new IrisClient(config.irisBaseUrl);
const amount = parseUsdc(process.env.AMOUNT || '1');
const sendAs = (a: EvmAdapter, chainKey: string) => new TxSender(w.evm.connect(a.provider), getChain(chainKey)!.chainId!, {
    floorGwei: getChain(chainKey)!.minMaxFeePerGasGwei, waitTimeoutMs: 120_000, maxBumps: 2, chainKey: `e2e:${chainKey}`,
});

try {
    const quote = computeQuote({
        src, dst, amount, pref: 'fast', fees: await iris.getFees(src.domain, dst.domain),
        fastAllowanceUsdc: await iris.getFastAllowance(), onchainMinFee: await srcA.minFeeAmount(amount),
    });
    const txs = await srcA.buildBurn({
        owner: w.evm.address, amount, dstDomain: dst.domain, mintRecipient: dstA.mintRecipientFor(w.evm.address).mintRecipient,
        maxFee: BigInt(quote.maxFee), minFinalityThreshold: quote.minFinalityThreshold,
    });
    let burnTx = '';
    for (const tx of txs) {
        if (tx.chain !== 'evm') continue;
        const r = await sendAs(srcA, src.key).send({ to: tx.to, data: tx.data }, () => undefined);
        if (tx.kind === 'burn') burnTx = r.hash;
    }
    check('direct burn (outside the API) confirmed', !!burnTx, { severity: 'HIGH', evidence: burnTx });

    let msg;
    for (const until = Date.now() + 5 * 60_000; Date.now() < until;) {
        msg = (await iris.getMessages(src.domain, burnTx))?.find(isAttestationReady);
        if (msg) break;
        await new Promise(r => setTimeout(r, 3_000));
    }
    check('attestation fetched directly from Iris', !!msg, { severity: 'HIGH' });

    const before = await dstA.usdcBalance(w.evm.address);
    const iface = new ethers.Interface(['function receiveMessage(bytes message, bytes attestation) returns (bool)']);
    const mint = await sendAs(dstA, dst.key).send({ to: dst.messageTransmitter!, data: iface.encodeFunctionData('receiveMessage', [msg!.message, msg!.attestation]) }, () => undefined);
    const after = await dstA.usdcBalance(w.evm.address);
    check(`user self-minted on ${dst.name} (destinationCaller = 0)`, mint.status === 1 && after > before, {
        severity: 'CRITICAL', detail: `+${formatUsdc(after - before)} USDC (net of Arc gas, paid in USDC)`, evidence: mint.hash,
    });

    const tracked = await http('POST', '/track', { src: src.key, txHash: burnTx });
    check('POST /track accepted', tracked.status === 201, { detail: JSON.stringify(tracked.json).slice(0, 200) });
    let t: any;
    for (const until = Date.now() + 3 * 60_000; Date.now() < until;) {
        t = (await http('GET', `/transfers/${tracked.json.id}`)).json;
        if (['COMPLETED', 'COMPLETED_EXTERNAL', 'FAILED'].includes(t.status)) break;
        await new Promise(r => setTimeout(r, 2_000));
    }
    check('server detects the external mint → COMPLETED_EXTERNAL', t?.status === 'COMPLETED_EXTERNAL', {
        severity: 'CRITICAL', detail: `status ${t?.status} ${t?.failReason ?? ''}`,
    });
    check('tracked record filled from the burn', t?.dst === dst.key && t?.amount === amount.toString(), { severity: 'HIGH' });
} catch (e: any) {
    check('track + self-mint flow ran', false, { severity: 'HIGH', detail: e.message });
}
process.exit(finish());
