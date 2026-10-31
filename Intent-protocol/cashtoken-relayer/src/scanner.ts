import { ElectrumNetworkProvider } from 'cashscript';
import { ENV } from './config.js';

export interface ScannedUtxo {
    address: string;
    txid: string;
    vout: number;
    satoshis: bigint;
    token?: {
        amount: bigint;
        category: string;
        nft?: {
            capability: 'none' | 'mutable' | 'minting';
            commitment: string;
        };
    };
}

export class Scanner {
    private chipnetProvider: ElectrumNetworkProvider;
    private mainnetProvider: ElectrumNetworkProvider;

    constructor(chipnetProvider?: ElectrumNetworkProvider, mainnetProvider?: ElectrumNetworkProvider) {
        this.chipnetProvider = chipnetProvider ?? new ElectrumNetworkProvider('chipnet');
        this.mainnetProvider = mainnetProvider ?? new ElectrumNetworkProvider('mainnet');
    }

    /**
     * Query every watched address for UTXOs.
     *
     * Runs with bounded concurrency (ENV.SCAN_CONCURRENCY): each Electrum call is
     * latency-bound (~230ms on a warm socket), not throughput-bound, so issuing
     * them serially made the sweep scale linearly with the watch list — measured
     * at 97.9s for 85 addresses, which became the floor on time-to-fill. The same
     * sweep with 8 in flight measured ~3s.
     *
     * A failed address is logged and skipped, never fatal to the cycle.
     */
    public async scanAddresses(): Promise<ScannedUtxo[]> {
        const addresses = ENV.WATCH_ADDRESSES;
        if (addresses.length === 0) return [];

        const started = Date.now();
        const results: ScannedUtxo[] = [];
        let withUtxos = 0;
        let failures = 0;

        const scanOne = async (addr: string): Promise<void> => {
            try {
                const provider = addr.startsWith('bitcoincash:') ? this.mainnetProvider : this.chipnetProvider;
                const utxos = await provider.getUtxos(addr);
                if (utxos.length === 0) return;
                withUtxos++;

                for (const u of utxos) {
                    results.push({
                        address: addr,
                        txid: u.txid,
                        vout: u.vout,
                        satoshis: BigInt(u.satoshis),
                        token: u.token ? {
                            amount: BigInt(u.token.amount),
                            category: u.token.category,
                            nft: u.token.nft ? {
                                capability: u.token.nft.capability as any,
                                commitment: u.token.nft.commitment
                            } : undefined
                        } : undefined
                    });
                }
            } catch (e: any) {
                failures++;
                console.error(`Failed to scan ${addr}: ${e?.message ?? e}`);
            }
        };

        // Worker pool: `idx++` is synchronous, so no two workers claim the same address.
        let idx = 0;
        const width = Math.max(1, Math.min(ENV.SCAN_CONCURRENCY, addresses.length));
        await Promise.all(Array.from({ length: width }, async () => {
            while (idx < addresses.length) {
                await scanOne(addresses[idx++]);
            }
        }));

        const elapsed = Date.now() - started;
        console.log(
            `Scanned ${addresses.length} addresses in ${elapsed}ms (concurrency ${width})` +
            ` — ${withUtxos} funded, ${results.length} UTXOs` +
            (failures ? `, ${failures} failed` : '')
        );

        return results;
    }
}
