/**
 * TxSender — one relayer signer per EVM chain, transactions sent strictly one at a time.
 *
 * - explicit nonce from the 'pending' count (safe because sends are serialized)
 * - EIP-1559 fees with a per-chain floor (Arc drops txs with maxFeePerGas < 20 gwei, silently)
 * - bounded wait; on timeout, re-broadcast the same nonce with +25% fees, up to maxBumps
 * - onSent(hash) fires before waiting so the caller can persist every hash
 */
import { ethers } from 'ethers';
import { errMsg, logger } from '../log.js';

const GWEI = 1_000_000_000n;

export class TxSender {
    private queue: Promise<unknown> = Promise.resolve();
    private log;

    constructor(
        private wallet: ethers.Wallet,
        private chainId: number,
        private opts: { floorGwei?: number; waitTimeoutMs: number; maxBumps: number; chainKey: string },
    ) {
        this.log = logger(`tx:${opts.chainKey}`);
    }

    get address() { return this.wallet.address; }

    send(req: { to: string; data: string }, onSent: (hash: string) => void): Promise<ethers.TransactionReceipt> {
        const run = () => this.sendNow(req, onSent);
        const p = this.queue.then(run, run);
        this.queue = p.catch(() => undefined);
        return p;
    }

    private async fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
        const fd = await this.wallet.provider!.getFeeData();
        let prio = fd.maxPriorityFeePerGas ?? GWEI;
        let max = fd.maxFeePerGas ?? (fd.gasPrice ? fd.gasPrice * 2n : 30n * GWEI);
        const floor = this.opts.floorGwei ? BigInt(this.opts.floorGwei) * GWEI : 0n;
        if (max < floor) max = floor;
        if (max < prio) max = prio;
        return { maxFeePerGas: max, maxPriorityFeePerGas: prio > max ? max : prio };
    }

    private async sendNow(req: { to: string; data: string }, onSent: (hash: string) => void): Promise<ethers.TransactionReceipt> {
        const provider = this.wallet.provider!;
        // estimateGas surfaces reverts ("Nonce already used", "Message expired…") before we pay for them.
        const est = await provider.estimateGas({ ...req, from: this.wallet.address });
        const gasLimit = (est * 13n) / 10n;
        const nonce = await provider.getTransactionCount(this.wallet.address, 'pending');
        let fees = await this.fees();
        const sent: string[] = [];

        for (let attempt = 0; attempt <= this.opts.maxBumps; attempt++) {
            const tx = await this.wallet.sendTransaction({
                ...req, gasLimit, nonce, chainId: this.chainId, type: 2, ...fees,
            });
            sent.push(tx.hash);
            onSent(tx.hash);
            this.log.info('broadcast', { hash: tx.hash, nonce, attempt, maxFeeGwei: Number(fees.maxFeePerGas / GWEI) });

            try {
                const r = await provider.waitForTransaction(tx.hash, 1, this.opts.waitTimeoutMs);
                if (r) return r;
            } catch (e) {
                if (!/timeout/i.test(errMsg(e))) throw e;
            }
            for (const h of sent) {
                const r = await provider.getTransactionReceipt(h);
                if (r) return r;
            }
            fees = {
                maxFeePerGas: (fees.maxFeePerGas * 125n) / 100n,
                maxPriorityFeePerGas: (fees.maxPriorityFeePerGas * 125n) / 100n + 1n,
            };
            this.log.warn('not mined in time, bumping fees', { nonce, attempt });
        }
        throw new Error(`tx at nonce ${nonce} not mined after ${this.opts.maxBumps} fee bumps (hashes: ${sent.join(',')})`);
    }
}
