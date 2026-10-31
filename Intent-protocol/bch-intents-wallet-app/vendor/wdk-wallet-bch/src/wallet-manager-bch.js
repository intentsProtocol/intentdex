'use strict'

import WalletManager from '@tetherto/wdk-wallet'
import { HDKey } from '@scure/bip32'

import ElectrumClient, { DEFAULT_SERVERS } from './electrum-client.js'
import WalletAccountBch, { derivationPrefix } from './wallet-account-bch.js'

/** @typedef {import('./wallet-account-read-only-bch.js').BchWalletConfig} BchWalletConfig */

/**
 * The derivation branches a dapp may ask for by name (WizardConnect's naming).
 * "receive" is the branch this wallet's accounts live on.
 */
export const NAMED_BRANCHES = Object.freeze({
  receive: "0'/0",
  change: "0'/1",
  defi: "0'/7"
})

export default class WalletManagerBch extends WalletManager {
  /**
   * Creates a wallet manager for Bitcoin Cash.
   *
   * @param {string | Uint8Array} seed - The wallet's BIP-39 seed phrase, or the seed bytes.
   * @param {BchWalletConfig} [config]
   */
  constructor (seed, config = {}) {
    super(seed, config)
    const network = config.network ?? 'mainnet'
    // One connection for every account of the wallet.
    /** @private */
    this._client = config.client ?? new ElectrumClient({ servers: config.servers ?? DEFAULT_SERVERS[network], WebSocket: config.WebSocket })
    /** @private */
    this._ownsClient = !config.client
  }

  /**
   * The account at an index.
   *
   * Account n is address n of the first BIP-44 account: m/44'/145'/0'/0/n, the branch Electron Cash derives its
   * receiving addresses on. With `coinType: 0` it is m/44'/0'/0'/0/n, whose index 0 is mainnet-js's default wallet.
   *
   * @param {number} [index] - The account's index (default: 0).
   * @returns {Promise<WalletAccountBch>}
   */
  async getAccount (index = 0) {
    return this.getAccountByPath(`0'/0/${index}`)
  }

  /**
   * The account at a derivation path.
   *
   * @param {string} path - The path suffix under m/44'/145' (e.g. "0'/0/1").
   * @returns {Promise<WalletAccountBch>}
   */
  async getAccountByPath (path) {
    if (!this._accounts[path]) {
      this._accounts[path] = new WalletAccountBch(this.seed, path, { ...this._config, client: this._client })
    }
    return this._accounts[path]
  }

  /**
   * The extended public key of a named branch, for a dapp that derives addresses itself.
   * It reveals every address on that branch, so it is given only to a dapp the user connected.
   *
   * @param {'receive' | 'change' | 'defi'} branch
   * @returns {string} The base58 xpub.
   */
  getExtendedPublicKey (branch) {
    const suffix = NAMED_BRANCHES[branch]
    if (!suffix) throw new Error(`Unknown branch: ${branch}.`)
    return HDKey.fromMasterSeed(this.seed).derive(`${derivationPrefix(this._config)}/${suffix}`).publicExtendedKey
  }

  /**
   * Current fee rates, in satoshis per byte. Bitcoin Cash blocks are not congested, so both are the relay rate.
   *
   * @returns {Promise<{ normal: bigint, fast: bigint }>}
   */
  async getFeeRates () {
    const rate = BigInt(await this._client.relayFeeRate())
    return { normal: rate, fast: rate }
  }

  /** Erases every account's key and closes the connection. */
  dispose () {
    super.dispose()
    if (this._ownsClient) this._client.close?.()
  }
}
