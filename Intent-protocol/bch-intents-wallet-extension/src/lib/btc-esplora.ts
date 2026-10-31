/**
 * A Bitcoin client for WDK backed by an Esplora REST API (blockstream.info, mempool.space).
 *
 * WDK's own transports speak the Electrum protocol over TCP, TLS or a WebSocket. An extension page has no raw
 * sockets, and public Electrum WebSocket endpoints come and go. Esplora is plain HTTPS and is what the public
 * explorers serve, so the wallet uses it for balances, coin selection and broadcasting; WDK still does the
 * derivation, coin selection and signing.
 *
 * Implements WDK's IBtcClient.
 */

interface EsploraUtxo { txid: string; vout: number; value: number; status: { confirmed: boolean; block_height?: number } }
interface EsploraStats { funded_txo_sum: number; spent_txo_sum: number }
interface EsploraAddress { chain_stats: EsploraStats; mempool_stats: EsploraStats }
export interface EsploraTx {
  txid: string;
  fee: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: { prevout?: { scriptpubkey_address?: string; value: number } }[];
  vout: { scriptpubkey_address?: string; value: number }[];
}

export class EsploraClient {
  constructor(private baseUrl: string, private timeoutMs = 15_000) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Bitcoin API answered ${res.status}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  // Nothing to hold open: every call is its own request.
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  async reconnect(): Promise<void> {}

  async getBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
    const a = (await (await this.request(`/address/${address}`)).json()) as EsploraAddress;
    return {
      confirmed: a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum,
      unconfirmed: a.mempool_stats.funded_txo_sum - a.mempool_stats.spent_txo_sum,
    };
  }

  async listUnspent(address: string): Promise<{ tx_hash: string; tx_pos: number; value: number; height: number }[]> {
    const utxos = (await (await this.request(`/address/${address}/utxo`)).json()) as EsploraUtxo[];
    return utxos.map(u => ({ tx_hash: u.txid, tx_pos: u.vout, value: u.value, height: u.status.block_height ?? 0 }));
  }

  async getHistory(address: string): Promise<{ tx_hash: string; height: number }[]> {
    return (await this.getTransactions(address)).map(t => ({ tx_hash: t.txid, height: t.status.block_height ?? 0 }));
  }

  /** The newest transactions of an address (Esplora pages them 25 at a time; the first page is enough here). */
  async getTransactions(address: string): Promise<EsploraTx[]> {
    return (await (await this.request(`/address/${address}/txs`)).json()) as EsploraTx[];
  }

  async getTransaction(txHash: string): Promise<string> {
    return (await this.request(`/tx/${txHash}/hex`)).text();
  }

  async broadcast(rawTx: string): Promise<string> {
    return (await (await this.request('/tx', { method: 'POST', body: rawTx })).text()).trim();
  }

  /** BTC per kB, the unit WDK expects. Esplora answers sat/vB keyed by confirmation target. */
  async estimateFee(blocks: number): Promise<number> {
    const estimates = (await (await this.request('/fee-estimates')).json()) as Record<string, number>;
    const targets = Object.keys(estimates).map(Number).sort((a, b) => a - b);
    const target = targets.find(t => t >= blocks) ?? targets[targets.length - 1];
    const satPerVb = target !== undefined ? estimates[String(target)] : 1;
    return Math.max(satPerVb, 1) / 100_000;
  }

  /** Fee rate in sat/vB for a confirmation target. */
  async feeRate(blocks = 3): Promise<number> {
    return Math.max(1, Math.ceil((await this.estimateFee(blocks)) * 100_000));
  }
}
