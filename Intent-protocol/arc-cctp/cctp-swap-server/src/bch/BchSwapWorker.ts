/** Background polling worker monitoring active BCH swaps against 1Click API. */
import type { OneClickClient } from './OneClickClient.js';
import type { BchSwapStore } from './BchSwapStore.js';
import type { BchSwapService } from './BchSwapService.js';
import { type BchSwapRecord, type BchSwapStatus } from './types.js';
import { logger } from '../log.js';

const log = logger('bch-worker');

export interface BchWorkerConfig {
    client: OneClickClient;
    store: BchSwapStore;
    service: BchSwapService;
    pollIntervalMs?: number;
}

export class BchSwapWorker {
    private client: OneClickClient;
    private store: BchSwapStore;
    private service: BchSwapService;
    private pollIntervalMs: number;
    private timer?: NodeJS.Timeout;
    private running = false;
    private isTickInProgress = false;

    constructor(cfg: BchWorkerConfig) {
        this.client = cfg.client;
        this.store = cfg.store;
        this.service = cfg.service;
        this.pollIntervalMs = cfg.pollIntervalMs ?? 5_000;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.timer = setInterval(() => {
            this.tick().catch(err => {
                log.error('[bch-worker] unexpected tick error', { err: (err as Error).message });
            });
        }, this.pollIntervalMs);
        log.info('[bch-worker] worker started', { pollIntervalMs: this.pollIntervalMs });
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        log.info('[bch-worker] worker stopped');
    }

    async tick(): Promise<void> {
        if (this.isTickInProgress) return;
        this.isTickInProgress = true;
        try {
            const pending = this.store.getPendingSwaps();
            if (pending.length === 0) return;

            const now = Date.now();
            for (const swap of pending) {
                // Check deadline expiration for non-deposited swaps
                if (swap.status === 'PENDING_DEPOSIT') {
                    const deadlineMs = Date.parse(swap.deadline);
                    if (!isNaN(deadlineMs) && now > deadlineMs) {
                        this.store.update(swap.id, {
                            status: 'EXPIRED',
                            lastPolledAt: now,
                        });
                        log.info('[bch-worker] swap expired without deposit', { id: swap.id });
                        continue;
                    }
                }

                try {
                    await this.pollSwap(swap);
                } catch (err) {
                    log.warn('[bch-worker] failed polling swap status', {
                        id: swap.id,
                        err: (err as Error).message,
                    });
                    this.store.update(swap.id, {
                        lastPolledAt: now,
                        lastError: (err as Error).message,
                    });
                }
            }
        } finally {
            this.isTickInProgress = false;
        }
    }

    private async pollSwap(swap: BchSwapRecord): Promise<void> {
        const now = Date.now();
        const res = await this.client.getStatus(swap.depositAddress);
        if (!res || !res.status) {
            this.store.update(swap.id, { lastPolledAt: now });
            return;
        }

        const patch: Partial<BchSwapRecord> = { lastPolledAt: now };

        if (res.depositTxHash && !swap.depositTxHash) {
            patch.depositTxHash = res.depositTxHash;
            patch.depositExplorerUrl = this.service.getExplorerUrl(swap.fromChain, 'tx', res.depositTxHash);
        }

        if (res.settleTxHash && !swap.settleTxHash) {
            patch.settleTxHash = res.settleTxHash;
            patch.settleExplorerUrl = this.service.getExplorerUrl(swap.toChain, 'tx', res.settleTxHash);
        }

        // Map status transition
        const remoteStatus = res.status as BchSwapStatus;
        if (remoteStatus !== swap.status) {
            patch.status = remoteStatus;
            log.info('[bch-worker] swap status transitioned', {
                id: swap.id,
                prev: swap.status,
                next: remoteStatus,
            });
        }

        if (Object.keys(patch).length > 1) { // more than just lastPolledAt
            this.store.update(swap.id, patch);
        }
    }
}
