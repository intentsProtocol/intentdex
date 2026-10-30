/**
 * TransferWorker — drives every non-terminal transfer through the state machine.
 *
 *   CREATED → BURN_SUBMITTED → BURN_CONFIRMED → ATTESTED → MINT_SUBMITTED → COMPLETED
 *   terminal: COMPLETED | COMPLETED_EXTERNAL | FAILED | EXPIRED
 *
 * Rules: persist before every external action; each transfer is processed by at most one task
 * (inFlight); transient errors back off exponentially (retryAfter); a restart resumes from the store.
 */
import { config, getChain, getChainByDomain } from '../config.js';
import { ZERO_BYTES32, bytes32ToEvm, bytes32ToSolana, parseBurnBody, parseMessage } from '../cctp/encoding.js';
import { isAttestationReady, type IrisApi, type IrisMessage } from '../cctp/iris.js';
import { MintError, type ChainAdapter } from '../chains/adapter.js';
import type { TransferStore } from '../store/TransferStore.js';
import { TERMINAL_STATUSES, type ParsedBurn, type Transfer } from '../types.js';
import { errMsg, logger } from '../log.js';

const log = logger('worker');

export const MAX_MINT_ATTEMPTS = 8;
const RESEND_AFTER_MS = 3 * 60_000;

export class TransferWorker {
    private timer?: ReturnType<typeof setInterval>;
    private inFlight = new Set<string>();
    private turn = 0;
    private lastTurn = new Map<string, number>();   // when each open transfer last had a slot

    constructor(
        private store: TransferStore,
        private adapters: Map<string, ChainAdapter>,
        private iris: IrisApi,
        private opts = config.worker,
        private limits = config.limits,
        private relayEnabled: () => boolean = () => true,   // admin switch: false leaves attested transfers waiting
        private feeEnforced: () => boolean = () => true,    // admin switch: true holds the mint until our fee is seen
    ) {}

    /**
     * Our fee, if this transfer has one: seen on chain → relay; not seen and enforced → hold (the user can still
     * mint themselves); not seen and not enforced → relay and record it as unpaid.
     */
    private async feeSettled(t: Transfer): Promise<boolean> {
        if (!t.protocolFee || t.protocolFee === '0' || t.feeStatus === 'paid' || t.feeStatus === 'unpaid') return true;
        const src = this.adapter(t.src);
        const proof = src.chain.kind === 'solana' ? t.burnTxHash : t.feeTxHash;
        if (proof && t.feeRecipient) {
            const r = await src.checkFee(proof, { from: t.sender, to: t.feeRecipient, amount: BigInt(t.protocolFee) });
            if (r === 'paid') { this.store.update(t.id, { feeStatus: 'paid', feePaidAt: Date.now(), lastError: undefined }); return true; }
            if (r === 'pending') { this.store.update(t.id, { retryAfter: Date.now() + 5_000, lastError: 'waiting for the fee transaction to confirm' }); return false; }
        }
        if (!this.feeEnforced()) { this.store.update(t.id, { feeStatus: 'unpaid' }); return true; }
        this.store.update(t.id, {
            feeStatus: 'awaiting', retryAfter: Date.now() + 15_000,
            lastError: proof ? 'the fee transaction did not pay the service fee to the treasury' : 'waiting for the service fee (POST /transfers/:id/fee); the user can also mint this transfer themselves',
        });
        return false;
    }

    start() {
        this.timer = setInterval(() => this.tick(), this.opts.pollIntervalMs);
        this.tick();
        log.info('started', { pollIntervalMs: this.opts.pollIntervalMs });
    }

    async stop(timeoutMs = 15_000) {
        if (this.timer) clearInterval(this.timer);
        const until = Date.now() + timeoutMs;
        while (this.inFlight.size > 0 && Date.now() < until) await new Promise(r => setTimeout(r, 200));
        log.info('stopped', { stillInFlight: this.inFlight.size });
    }

    private due(): Transfer[] {
        const now = Date.now();
        return this.store.active().filter(t => !this.inFlight.has(t.id) && (!t.retryAfter || t.retryAfter <= now));
    }

    /**
     * Fire-and-forget scheduling, bounded by the concurrency cap. Two rules keep one transfer from holding up
     * another: an unsigned transfer needs no I/O, only its expiry check, so it never takes a slot; and the
     * slots go to whoever waited longest, so a queue longer than the cap is served in turns instead of the
     * oldest transfers being retried on every tick.
     */
    tick() {
        const due = this.due();
        for (const t of due) if (t.status === 'CREATED') this.onCreated(t);
        const waiting = due.filter(t => t.status !== 'CREATED')
            .sort((a, b) => (this.lastTurn.get(a.id) ?? 0) - (this.lastTurn.get(b.id) ?? 0));
        for (const t of waiting) {
            if (this.inFlight.size >= this.opts.concurrency) break;
            void this.process(t.id);
        }
    }

    /** Process every due transfer once and wait (tests / scripts). */
    async runOnce() {
        for (const t of this.due()) await this.process(t.id);
    }

    async process(id: string) {
        if (this.inFlight.has(id)) return;
        this.inFlight.add(id);
        this.lastTurn.set(id, ++this.turn);
        try {
            const t = this.store.get(id);
            if (t) await this.step(t);
        } catch (e) {
            this.backoff(id, errMsg(e));
        } finally {
            this.inFlight.delete(id);
            const after = this.store.get(id);
            if (!after || TERMINAL_STATUSES.has(after.status)) this.lastTurn.delete(id);
        }
    }

    private backoff(id: string, err: string) {
        const t = this.store.get(id);
        if (!t) return;
        const failCount = t.failCount + 1;
        const delay = Math.min(5_000 * 2 ** Math.min(failCount, 10), this.opts.maxBackoffMs);
        this.store.update(id, { failCount, retryAfter: Date.now() + delay, lastError: err });
        log.warn('transient error, backing off', { id, status: t.status, failCount, delayMs: delay, err });
    }

    private fail(t: Transfer, reason: string) {
        this.store.update(t.id, { status: 'FAILED', failReason: reason, retryAfter: undefined });
        log.warn('transfer failed', { id: t.id, reason });
    }

    private adapter(key: string): ChainAdapter {
        const a = this.adapters.get(key);
        if (!a) throw new Error(`no adapter for chain ${key}`);
        return a;
    }

    private async step(t: Transfer) {
        switch (t.status) {
            case 'CREATED': return this.onCreated(t);
            case 'BURN_SUBMITTED': return this.onBurnSubmitted(t);
            case 'BURN_CONFIRMED': return this.onBurnConfirmed(t);
            case 'ATTESTED': return this.onAttested(t);
            case 'MINT_SUBMITTED': return this.onMintSubmitted(t);
        }
    }

    private onCreated(t: Transfer) {
        if (Date.now() - t.createdAt > this.limits.createdTtlMin * 60_000) {
            this.store.update(t.id, { status: 'EXPIRED' });
        }
    }

    private async onBurnSubmitted(t: Transfer) {
        const src = this.adapter(t.src);
        const res = await src.checkBurn(t.burnTxHash!, { eventAccount: t.eventAccount });
        if (res.state === 'pending') {
            if (Date.now() - (t.burnSubmittedAt ?? t.createdAt) > this.limits.burnNotFoundMin * 60_000) {
                this.fail(t, 'burn transaction not found / not confirmed in time');
            }
            return;
        }
        if (res.state === 'failed') return this.fail(t, res.reason);

        if (t.origin === 'track') {
            if (res.burn) {
                const filled = this.fillFromBurn(t, res.burn);
                if (typeof filled === 'string') return this.fail(t, filled);
                this.store.update(t.id, { ...filled, status: 'BURN_CONFIRMED', burnConfirmedAt: Date.now() });
            } else {
                this.store.update(t.id, { status: 'BURN_CONFIRMED', burnConfirmedAt: Date.now() });
            }
            return;
        }

        if (res.burn) {
            const mismatch = this.compareBurn(t, res.burn);
            if (mismatch) return this.fail(t, `burn does not match transfer: ${mismatch}`);
        }
        const patch: Partial<Transfer> = { status: 'BURN_CONFIRMED', burnConfirmedAt: Date.now(), failCount: 0, lastError: undefined };
        if (res.burn) {
            patch.maxFee = res.burn.maxFee.toString();
            patch.minFinalityThreshold = res.burn.minFinalityThreshold;
        }
        this.store.update(t.id, patch);
        // Solana destination: create the recipient token account while Circle attests (retried before minting).
        const dst = this.adapter(t.dst);
        if (dst.prepareMint) {
            await dst.prepareMint(this.store.get(t.id)!).catch(e => log.warn('prepareMint failed; will retry before mint', { id: t.id, err: errMsg(e) }));
        }
    }

    private compareBurn(t: Transfer, b: ParsedBurn): string | null {
        if (b.amount !== BigInt(t.amount)) return `amount ${b.amount} != ${t.amount}`;
        if (b.destinationDomain !== t.dstDomain) return `destination domain ${b.destinationDomain} != ${t.dstDomain}`;
        if (b.mintRecipient.toLowerCase() !== t.mintRecipient.toLowerCase()) return 'mint recipient differs';
        if (b.destinationCaller.toLowerCase() !== ZERO_BYTES32) return 'destinationCaller is restricted; relayer cannot mint';
        return null;
    }

    /** Tracked burns: derive the record from the burn itself. Returns an error string if unsupported. */
    private fillFromBurn(t: Transfer, b: ParsedBurn): Partial<Transfer> | string {
        const dst = getChainByDomain(b.destinationDomain);
        if (!dst || !this.adapters.has(dst.key)) return `destination domain ${b.destinationDomain} is not enabled`;
        if (b.destinationCaller.toLowerCase() !== ZERO_BYTES32) return 'destinationCaller is restricted; relayer cannot mint';
        if (b.amount < BigInt(Math.round(this.limits.minTransferUsdc * 1e6))) return 'amount below minimum';
        const src = getChain(t.src)!;
        const sender = src.kind === 'evm' ? bytes32ToEvm(b.sender) : bytes32ToSolana(b.sender);
        const recipient = dst.kind === 'evm' ? bytes32ToEvm(b.mintRecipient) : bytes32ToSolana(b.mintRecipient);
        return {
            dst: dst.key, dstDomain: dst.domain, sender,
            recipient: dst.kind === 'evm' ? recipient : '',
            recipientTokenAccount: dst.kind === 'solana' ? recipient : undefined,
            mintRecipient: b.mintRecipient, amount: b.amount.toString(), maxFee: b.maxFee.toString(),
            minFinalityThreshold: b.minFinalityThreshold, speed: b.minFinalityThreshold <= 1000 ? 'fast' : 'standard',
        };
    }

    private pickMessage(t: Transfer, msgs: IrisMessage[]): IrisMessage | undefined {
        const ready = msgs.filter(isAttestationReady);
        if (!t.mintRecipient) return ready[0];
        return ready.find(m => {
            try {
                const body = parseBurnBody(parseMessage(m.message).body);
                return body.mintRecipient.toLowerCase() === t.mintRecipient.toLowerCase() && body.amount === BigInt(t.amount);
            } catch { return false; }
        });
    }

    private async onBurnConfirmed(t: Transfer) {
        const msgs = await this.iris.getMessages(t.srcDomain, t.burnTxHash!);
        const msg = msgs ? this.pickMessage(t, msgs) : undefined;
        if (!msg) {
            const delay = msgs?.find(m => m.delayReason)?.delayReason ?? undefined;
            const src = getChain(t.src);
            const slow = t.speed === 'standard' && (src?.standardEtaSec ?? 0) > config.quote.standardFastEnoughSec;
            this.store.update(t.id, {
                lastError: delay ? `Circle delay: ${delay}` : t.lastError,
                retryAfter: slow ? Date.now() + this.opts.slowAttestationPollMs : undefined,
            });
            return;
        }
        const parsed = parseMessage(msg.message);
        const body = parseBurnBody(parsed.body);
        let rec = t;
        if (t.origin === 'track' && !t.mintRecipient) {
            const filled = this.fillFromBurn(t, {
                amount: body.amount, destinationDomain: parsed.destinationDomain, mintRecipient: body.mintRecipient,
                destinationCaller: parsed.destinationCaller, maxFee: body.maxFee, minFinalityThreshold: parsed.minFinalityThreshold,
                burnToken: body.burnToken, sender: body.messageSender,
            });
            if (typeof filled === 'string') return this.fail(t, filled);
            rec = this.store.update(t.id, filled);
        }
        const mismatch = this.compareBurn(rec, {
            amount: body.amount, destinationDomain: parsed.destinationDomain, mintRecipient: body.mintRecipient,
            destinationCaller: parsed.destinationCaller, maxFee: body.maxFee, minFinalityThreshold: parsed.minFinalityThreshold,
            burnToken: body.burnToken, sender: body.messageSender,
        });
        if (mismatch) return this.fail(rec, `attested message does not match transfer: ${mismatch}`);

        this.store.update(t.id, {
            status: 'ATTESTED', message: msg.message, attestation: msg.attestation!, nonce: parsed.nonce,
            feeExecuted: body.feeExecuted.toString(), attestedAt: Date.now(), failCount: 0, lastError: undefined, retryAfter: undefined,
        });
    }

    private async onAttested(t: Transfer) {
        const dst = this.adapter(t.dst);
        if (await dst.isNonceUsed(t.nonce!)) return this.resolveAlreadyMinted(t);
        if (!(await this.feeSettled(t))) return;
        if (!this.relayEnabled()) {
            this.store.update(t.id, { retryAfter: Date.now() + 30_000, lastError: 'relaying is switched off by an admin; the user can self-mint' });
            return;
        }
        if (dst.prepareMint) await dst.prepareMint(t);

        const hashes = [...(t.mintTxHashes ?? [])];
        try {
            const res = await dst.mint({ message: t.message!, attestation: t.attestation! }, (hash) => {
                hashes.push(hash);
                this.store.update(t.id, { status: 'MINT_SUBMITTED', mintTxHash: hash, mintTxHashes: [...hashes], mintSubmittedAt: Date.now() });
            });
            this.store.update(t.id, {
                status: 'COMPLETED', mintTxHash: res.txHash, completedAt: Date.now(),
                received: res.received?.toString() ?? t.expectedReceive,
                feeExecuted: res.feeCollected?.toString() ?? t.feeExecuted, relayCost: res.gasCost,
                lastError: undefined, retryAfter: undefined,
            });
            log.info('completed', { id: t.id, src: t.src, dst: t.dst, mintTx: res.txHash });
        } catch (e) {
            const kind = e instanceof MintError ? e.kind : 'transient';
            const msg = errMsg(e);
            const cur = this.store.get(t.id)!;
            if (kind === 'nonce_used') return this.resolveAlreadyMinted(cur);
            if (kind === 'expired' && !cur.reattestRequested) {
                await this.iris.reattest(cur.nonce!);
                this.store.update(t.id, { status: 'BURN_CONFIRMED', reattestRequested: true, message: undefined, attestation: undefined, lastError: msg });
                return;
            }
            if (kind === 'bad_attestation') {
                this.store.update(t.id, { status: 'BURN_CONFIRMED', message: undefined, attestation: undefined });
            }
            if (cur.failCount + 1 >= MAX_MINT_ATTEMPTS) {
                return this.fail(cur, `relayer gave up after ${MAX_MINT_ATTEMPTS} attempts (${msg}); message + attestation remain available for a manual mint`);
            }
            this.backoff(t.id, msg);
        }
    }

    /** The nonce is used: either one of our own broadcasts landed, or someone else minted. */
    private async resolveAlreadyMinted(t: Transfer) {
        const dst = this.adapter(t.dst);
        for (const h of t.mintTxHashes ?? []) {
            const c = await dst.checkMint(h);
            if (c.state === 'success') {
                this.store.update(t.id, {
                    status: 'COMPLETED', mintTxHash: h, completedAt: Date.now(),
                    received: c.result.received?.toString() ?? t.expectedReceive, retryAfter: undefined,
                });
                return;
            }
        }
        const unpaid = t.feeStatus === 'pending' || t.feeStatus === 'awaiting';
        this.store.update(t.id, { status: 'COMPLETED_EXTERNAL', completedAt: Date.now(), received: t.expectedReceive, retryAfter: undefined, ...(unpaid ? { feeStatus: 'unpaid' as const } : {}) });
        log.info('completed externally (nonce already used)', { id: t.id });
    }

    private async onMintSubmitted(t: Transfer) {
        const dst = this.adapter(t.dst);
        for (const h of t.mintTxHashes ?? (t.mintTxHash ? [t.mintTxHash] : [])) {
            const c = await dst.checkMint(h);
            if (c.state === 'success') {
                this.store.update(t.id, {
                    status: 'COMPLETED', mintTxHash: h, completedAt: Date.now(),
                    received: c.result.received?.toString() ?? t.expectedReceive, retryAfter: undefined, lastError: undefined,
                });
                return;
            }
            if (c.state === 'pending') return;
        }
        if (await dst.isNonceUsed(t.nonce!)) return this.resolveAlreadyMinted(t);
        if (Date.now() - (t.mintSubmittedAt ?? 0) > RESEND_AFTER_MS) {
            this.store.update(t.id, { status: 'ATTESTED', lastError: 'mint tx not found; resending' });
        }
    }
}
