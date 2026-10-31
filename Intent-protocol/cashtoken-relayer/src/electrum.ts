/**
 * electrum.ts — shared, persistent Electrum connections.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ElectrumNetworkProvider` defaults to `manualConnectionManagement: false`,
 * which makes `performRequest()` open AND close the socket around every single
 * request whenever no other request is in flight:
 *
 *     if (shouldConnect())    await electrum.connect();      // concurrentRequests === 0
 *     result = await electrum.request(...)
 *     if (shouldDisconnect()) await electrum.disconnect();   // concurrentRequests === 1
 *
 * In a serial scan loop that is a full TCP+TLS handshake per address. Measured
 * against chipnet.bch.ninja (Fulcrum 2.1.1):
 *
 *     listunspent on a warm persistent socket ....  229 ms
 *     the same call through a default provider ... 1143 ms   ← ~80% is connection churn
 *
 * Holding one connection open per network removes that overhead and is also the
 * prerequisite for push subscriptions later.
 *
 * THE CATCH
 * ---------
 * A long-lived socket must be supervised. This relayer has previously wedged
 * into a permanent "disconnected server" state, and a persistent connection
 * makes that failure mode worse if nothing is watching. `ElectrumSupervisor`
 * polls connection health and reconnects with exponential backoff, logging
 * every transition so a wedge is visible in the logs rather than silent.
 */

import { ElectrumClient, ConnectionStatus } from '@electrum-cash/network';
import { ElectrumNetworkProvider } from 'cashscript';

export type BchNetwork = 'chipnet' | 'mainnet';

/** Same hosts CashScript's provider would pick by default. */
const DEFAULT_HOSTS: Record<BchNetwork, string> = {
    chipnet: process.env.ELECTRUM_HOST_CHIPNET ?? 'chipnet.bch.ninja',
    mainnet: process.env.ELECTRUM_HOST_MAINNET ?? 'bch.imaginary.cash',
};

const APPLICATION = 'bch-intents-relayer';
const PROTOCOL_VERSION = '1.5.3';

const HEALTH_INTERVAL_MS = 15_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;

export class ElectrumSupervisor {
    readonly client: ElectrumClient<any>;
    readonly provider: ElectrumNetworkProvider;

    private timer?: NodeJS.Timeout;
    private reconnectAttempts = 0;
    private reconnecting = false;
    private lastStatus?: ConnectionStatus;

    constructor(readonly network: BchNetwork, hostname: string = DEFAULT_HOSTS[network]) {
        this.client = new ElectrumClient(APPLICATION, PROTOCOL_VERSION, hostname, {
            // Node process — no browser visibility API to react to.
            disableBrowserVisibilityHandling: true,
        } as any);

        // Injecting our own client AND taking manual control is what actually
        // keeps the socket open; without the flag the provider still tears the
        // connection down after every request.
        this.provider = new ElectrumNetworkProvider(network as any, {
            electrum: this.client,
            manualConnectionManagement: true,
        } as any);
    }

    /** Open the connection and start the health watchdog. */
    async start(): Promise<void> {
        await this.connectOnce();
        this.timer = setInterval(() => { void this.checkHealth(); }, HEALTH_INTERVAL_MS);
        // Never let the watchdog alone hold the process open.
        this.timer.unref?.();
    }

    async stop(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        try {
            await this.client.disconnect(true);
        } catch { /* already down */ }
    }

    get status(): ConnectionStatus {
        return this.client.status;
    }

    /** Seconds since the server last sent us anything (Infinity if never). */
    get idleSec(): number {
        const last = this.client.lastReceivedTimestamp;
        if (!last) return Infinity;
        return (Date.now() - last) / 1000;
    }

    private async connectOnce(): Promise<void> {
        await this.client.connect();
        this.reconnectAttempts = 0;
        this.lastStatus = this.client.status;
        console.log(`[Electrum:${this.network}] connected to ${DEFAULT_HOSTS[this.network]} (${this.client.software || 'unknown server'})`);
    }

    /**
     * Watchdog tick. Reconnects when the socket is not in a connected state.
     *
     * Deliberately does NOT force-reconnect on idle time alone: a quiet server
     * is normal when the relayer has nothing to scan, and tearing down a
     * healthy connection is how flapping starts.
     */
    private async checkHealth(): Promise<void> {
        if (this.reconnecting) return;

        const status = this.client.status;
        if (status !== this.lastStatus) {
            console.log(`[Electrum:${this.network}] status ${this.lastStatus ?? 'init'} → ${status}`);
            this.lastStatus = status;
        }
        if (status === ConnectionStatus.CONNECTED) return;

        this.reconnecting = true;
        try {
            const delay = Math.min(
                BACKOFF_BASE_MS * Math.pow(2, this.reconnectAttempts),
                BACKOFF_CAP_MS,
            );
            this.reconnectAttempts += 1;
            console.warn(`[Electrum:${this.network}] not connected (status=${status}); reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));

            // Drop any half-open socket first, retaining subscriptions so that
            // once push-based discovery lands they are restored automatically.
            try { await this.client.disconnect(true, true); } catch { /* nothing to close */ }
            await this.connectOnce();
        } catch (e: any) {
            console.error(`[Electrum:${this.network}] reconnect failed: ${e?.message ?? e}`);
        } finally {
            this.reconnecting = false;
        }
    }
}

/** Build (but do not connect) one supervisor per network. */
export function createSupervisors(): Record<BchNetwork, ElectrumSupervisor> {
    return {
        chipnet: new ElectrumSupervisor('chipnet'),
        mainnet: new ElectrumSupervisor('mainnet'),
    };
}
