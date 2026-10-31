// A small Electrum Cash client: JSON-RPC over a WebSocket, to a Fulcrum server.
//
// It does what a wallet needs and nothing more: coins, history, broadcast, and looking a transaction up.
// The WebSocket constructor can be injected, because the runtimes this module runs in differ: browsers and
// Node have a global `WebSocket`; a Bare worklet is given one (bare-ws) by its host.

'use strict'

import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

/** Public Fulcrum servers with WebSocket endpoints. The first that answers is used. */
export const DEFAULT_SERVERS = Object.freeze({
  mainnet: ['wss://bch.imaginary.cash:50004', 'wss://blackie.c3-soft.com:50004', 'wss://electroncash.de:60002'],
  chipnet: ['wss://chipnet.imaginary.cash:50004', 'wss://chipnet.bch.ninja:50004']
})

/** The script hash Electrum indexes an output by: SHA-256 of its locking bytecode, reversed. */
export const scriptHashOf = lockingBytecode => bytesToHex(Uint8Array.from(sha256(lockingBytecode)).reverse())

/**
 * @typedef {Object} ElectrumUtxo
 * @property {string} txid
 * @property {number} vout
 * @property {bigint} satoshis
 * @property {number} height - 0 while unconfirmed.
 * @property {import('./transaction.js').TokenData} [token]
 */

/**
 * @typedef {Object} ElectrumClientConfig
 * @property {string[]} servers - WebSocket URLs, tried in order.
 * @property {typeof WebSocket} [WebSocket] - The WebSocket constructor. Defaults to the global one.
 * @property {number} [timeout] - Milliseconds to wait for a connection or an answer (default 15000).
 */

export default class ElectrumClient {
  /** @param {ElectrumClientConfig} config */
  constructor (config) {
    if (!config?.servers?.length) throw new Error('At least one Electrum server is needed.')
    this._servers = config.servers
    this._WebSocket = config.WebSocket ?? globalThis.WebSocket
    this._timeout = config.timeout ?? 15_000
    this._socket = null
    this._connecting = null
    this._nextId = 1
    this._pending = new Map()
    this._serverIndex = 0
  }

  /** Opens a connection to the first server that completes the handshake. */
  async connect () {
    if (this._socket) return
    if (this._connecting) return this._connecting
    if (!this._WebSocket) throw new Error('No WebSocket implementation is available. Pass one in the client configuration.')
    this._connecting = (async () => {
      let lastError
      for (let attempt = 0; attempt < this._servers.length; attempt++) {
        const url = this._servers[(this._serverIndex + attempt) % this._servers.length]
        try {
          await this._open(url)
          this._serverIndex = (this._serverIndex + attempt) % this._servers.length
          await this._call('server.version', ['wdk-wallet-bch', ['1.4.1', '1.5.3']])
          return
        } catch (error) {
          lastError = error
          this._drop(error)
        }
      }
      throw new Error(`No Bitcoin Cash server could be reached. ${lastError?.message ?? ''}`.trim())
    })()
    try { await this._connecting } finally { this._connecting = null }
  }

  _open (url) {
    return new Promise((resolve, reject) => {
      const raw = new this._WebSocket(url)
      // Two shapes of socket exist. Browsers, Node and React Native give the W3C one (onopen, onmessage, send).
      // A Bare worklet's global `WebSocket` is bare-ws, a duplex stream (on('open'), on('data'), write).
      const isStream = typeof raw.on === 'function' && typeof raw.write === 'function' && typeof raw.send !== 'function'
      const socket = isStream
        ? { send: data => raw.write(data), close: () => raw.destroy() }
        : { send: data => raw.send(data), close: () => raw.close() }
      const lost = new Error('The connection to the Bitcoin Cash server was lost.')
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { socket.close() } catch {}
        reject(new Error(`Timed out connecting to ${url}.`))
      }, this._timeout)
      const opened = () => { if (settled) return; settled = true; clearTimeout(timer); this._socket = socket; resolve() }
      const closed = () => { if (this._socket === socket) this._drop(lost) }
      const failed = () => {
        if (this._socket === socket) { this._drop(lost); return }
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`Could not connect to ${url}.`))
      }
      if (isStream) {
        raw.on('open', opened)
        raw.on('error', failed)
        raw.on('close', closed)
        raw.on('data', data => this._onMessage(data))
      } else {
        raw.onopen = opened
        raw.onerror = failed
        raw.onclose = closed
        raw.onmessage = event => this._onMessage(event.data)
      }
    })
  }

  _onMessage (data) {
    let message
    try { message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) } catch { return }
    const pending = this._pending.get(message.id)
    if (!pending) return
    this._pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(typeof message.error === 'string' ? message.error : message.error.message ?? 'The Bitcoin Cash server refused the request.'))
    else pending.resolve(message.result)
  }

  _drop (error) {
    const socket = this._socket
    this._socket = null
    try { socket?.close() } catch {}
    for (const pending of this._pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this._pending.clear()
  }

  _call (method, params) {
    return new Promise((resolve, reject) => {
      if (!this._socket) { reject(new Error('Not connected to a Bitcoin Cash server.')); return }
      const id = this._nextId++
      const timer = setTimeout(() => { this._pending.delete(id); reject(new Error(`The Bitcoin Cash server did not answer ${method} in time.`)) }, this._timeout)
      this._pending.set(id, { resolve, reject, timer })
      try { this._socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })) } catch (error) { clearTimeout(timer); this._pending.delete(id); reject(error) }
    })
  }

  /** Sends a request, connecting first if needed. A dropped connection is retried once on the next server. */
  async request (method, params = []) {
    await this.connect()
    try {
      return await this._call(method, params)
    } catch (error) {
      if (this._socket) throw error
      this._serverIndex = (this._serverIndex + 1) % this._servers.length
      await this.connect()
      return this._call(method, params)
    }
  }

  /** Closes the connection. The client reconnects on the next request. */
  async close () {
    this._drop(new Error('The client was closed.'))
  }

  /**
   * The unspent outputs locked by a script, token-carrying ones included.
   *
   * @param {Uint8Array} lockingBytecode
   * @returns {Promise<ElectrumUtxo[]>}
   */
  async listUnspent (lockingBytecode) {
    const rows = await this.request('blockchain.scripthash.listunspent', [scriptHashOf(lockingBytecode), 'include_tokens'])
    return rows.map(row => ({
      txid: row.tx_hash,
      vout: row.tx_pos,
      satoshis: BigInt(row.value),
      height: row.height > 0 ? row.height : 0,
      ...(row.token_data
        ? {
            token: {
              category: row.token_data.category,
              amount: BigInt(row.token_data.amount ?? 0),
              ...(row.token_data.nft ? { nft: { capability: row.token_data.nft.capability ?? 'none', commitment: row.token_data.nft.commitment ?? '' } } : {})
            }
          }
        : {})
    }))
  }

  /** @returns {Promise<{ txid: string, height: number }[]>} Oldest first; height 0 while unconfirmed. */
  async getHistory (lockingBytecode) {
    const rows = await this.request('blockchain.scripthash.get_history', [scriptHashOf(lockingBytecode)])
    return rows.map(row => ({ txid: row.tx_hash, height: row.height > 0 ? row.height : 0 }))
  }

  /** @returns {Promise<string>} The raw transaction, hex. */
  getTransaction (txid) {
    return this.request('blockchain.transaction.get', [txid, false])
  }

  /** @returns {Promise<{ confirmations: number, blocktime?: number, hex: string } | null>} */
  async getTransactionDetails (txid) {
    try {
      const tx = await this.request('blockchain.transaction.get', [txid, true])
      return { confirmations: tx.confirmations ?? 0, blocktime: tx.blocktime, hex: tx.hex }
    } catch {
      return null
    }
  }

  /** @returns {Promise<string>} The id of the accepted transaction. */
  broadcast (hex) {
    return this.request('blockchain.transaction.broadcast', [hex])
  }

  /** @returns {Promise<number>} The fee rate nodes relay at, in satoshis per byte (at least 1). */
  async relayFeeRate () {
    try {
      const bchPerKb = Number(await this.request('blockchain.relayfee'))
      return Math.max(1, Math.ceil((bchPerKb * 1e8) / 1000))
    } catch {
      return 1
    }
  }
}
