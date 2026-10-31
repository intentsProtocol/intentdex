'use strict'

import { HDKey } from '@scure/bip32'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import * as bip39 from 'bip39'

import { AddressType, encodeCashAddress, prefixOf } from './cashaddr.js'
import { signMessage } from './message.js'
import {
  SIGHASH_ALL, SIGHASH_FORKID, SIGHASH_UTXOS, decodeTransaction, encodeTransaction, hash160, signP2pkhInputs, transactionId
} from './transaction.js'
import WalletAccountReadOnlyBch from './wallet-account-read-only-bch.js'

/** @typedef {import('./wallet-account-read-only-bch.js').BchWalletConfig} BchWalletConfig */
/** @typedef {import('./transaction.js').Output} Output */

/** The BIP-44 coin type registered for Bitcoin Cash. Electron Cash and most BCH wallets derive under it. */
export const BCH_COIN_TYPE = 145

/**
 * The derivation prefix for a configuration.
 *
 * The coin type is configurable for one reason: mainnet-js, the library the BCH Intents frontend and browser
 * extension are built on, derives its default wallet under Bitcoin's coin type (m/44'/0'/0'/0/0). A wallet that
 * must show the same address as those apps sets `coinType: 0`.
 *
 * @param {{ coinType?: number }} [config]
 */
export function derivationPrefix (config = {}) {
  const coinType = config.coinType ?? BCH_COIN_TYPE
  if (!Number.isInteger(coinType) || coinType < 0) throw new Error('The coin type must be a non-negative integer.')
  return `m/44'/${coinType}'`
}

function seedBytes (seed) {
  if (typeof seed !== 'string') return seed
  if (!bip39.validateMnemonic(seed)) throw new Error('The seed phrase is invalid.')
  return bip39.mnemonicToSeedSync(seed)
}

export default class WalletAccountBch extends WalletAccountReadOnlyBch {
  /**
   * Creates a Bitcoin Cash account.
   *
   * @param {string | Uint8Array} seed - The wallet's BIP-39 seed phrase, or the seed bytes.
   * @param {string} path - The derivation path suffix (e.g. "0'/0/0").
   * @param {BchWalletConfig} [config]
   */
  constructor (seed, path, config = {}) {
    const fullPath = `${derivationPrefix(config)}/${path}`
    const node = HDKey.fromMasterSeed(seedBytes(seed)).derive(fullPath)
    if (!node.privateKey || !node.publicKey) throw new Error('The account key could not be derived.')
    super(encodeCashAddress(prefixOf(config.network ?? 'mainnet'), AddressType.P2PKH, hash160(node.publicKey)), config)

    /** @private */
    this._path = fullPath
    /** @private */
    this._privateKey = node.privateKey
    /** @private */
    this._publicKey = node.publicKey
  }

  /** The last number of the derivation path. */
  get index () {
    return +this._path.split('/').pop()
  }

  /** The full derivation path. */
  get path () {
    return this._path
  }

  /**
   * The account's key pair. Treat the arrays as read-only views of the keys.
   *
   * @type {{ privateKey: Uint8Array | null, publicKey: Uint8Array }}
   */
  get keyPair () {
    return { privateKey: this._privateKey, publicKey: this._publicKey }
  }

  /** @private */
  _key () {
    if (!this._privateKey) throw new Error('The wallet account has been disposed.')
    return this._privateKey
  }

  /**
   * Signs a message, in the format Bitcoin Cash wallets verify.
   *
   * @param {string} message
   * @returns {Promise<string>} The signature, base64.
   */
  async sign (message) {
    return signMessage(message, this._key())
  }

  /** @private */
  _build (plan) {
    const tx = {
      version: 2,
      locktime: 0,
      inputs: plan.inputs.map(u => ({ txid: u.txid, vout: u.vout, sequenceNumber: 0 })),
      outputs: plan.outputs
    }
    const sourceOutputs = plan.inputs.map(u => ({ lockingBytecode: this._lockingBytecode, valueSatoshis: u.satoshis, token: u.token }))
    const { transaction } = signP2pkhInputs(tx, sourceOutputs, this._key(), this._publicKey, SIGHASH_ALL | SIGHASH_FORKID)
    const encoded = encodeTransaction(transaction)
    return { hex: bytesToHex(encoded), hash: transactionId(encoded), fee: plan.fee }
  }

  /** @private */
  async _broadcast (built) {
    const accepted = await this._client.broadcast(built.hex)
    if (typeof accepted !== 'string' || accepted.toLowerCase() !== built.hash) {
      throw new Error('The network did not accept the transaction.')
    }
    return { hash: built.hash, fee: built.fee }
  }

  /**
   * Builds and signs a payment without sending it.
   *
   * @param {{ to: string, value: number | bigint }} tx
   * @returns {Promise<string>} The signed transaction, hex.
   */
  async signTransaction (tx) {
    return this._build(await this._planSend(tx)).hex
  }

  /**
   * Sends BCH.
   *
   * @param {{ to: string, value: number | bigint }} tx - The recipient and the amount in satoshis.
   * @returns {Promise<{ hash: string, fee: bigint }>}
   */
  async sendTransaction (tx) {
    return this._broadcast(this._build(await this._planSend(tx)))
  }

  /**
   * Sends every satoshi that is not attached to a token.
   *
   * @param {string} to
   * @returns {Promise<{ hash: string, fee: bigint }>}
   */
  async sendMax (to) {
    return this._broadcast(this._build(await this._planSendMax(to)))
  }

  /**
   * Sends a fungible CashToken.
   *
   * @param {{ token: string, recipient: string, amount: number | bigint, value?: number | bigint }} options -
   *   The category, a token-aware recipient, the amount in base units, and optionally the satoshis that travel
   *   with the tokens (default 1000).
   * @returns {Promise<{ hash: string, fee: bigint }>}
   */
  async transfer (options) {
    return this._broadcast(this._build(await this._planTransfer(options)))
  }

  /**
   * Sends a CashToken NFT. The whole coin moves, so its capability, commitment and any fungible amount riding
   * on it are preserved. When the category holds more than one NFT, `commitment` picks which one.
   *
   * @param {{ token: string, commitment?: string, recipient: string, value?: number | bigint }} options -
   *   The category, the NFT's commitment (empty string for none), a token-aware recipient, and optionally the
   *   satoshis that travel with the NFT (default 1000).
   * @returns {Promise<{ hash: string, fee: bigint }>}
   */
  async transferNft (options) {
    return this._broadcast(this._build(await this._planTransferNft(options)))
  }

  /**
   * Pays a list of outputs exactly as planned, in order, with this account's coins, and broadcasts it. For a
   * transaction another party laid out and the wallet checked, such as a Mesh position's genesis.
   *
   * @param {{ outputs: import('./wallet-account-read-only-bch.js').PlannedOutput[], firstInput?: { txid: string, vout: number } }} options -
   *   The outputs; and the coin to spend at input 0, when its transaction id matters (a CashToken genesis).
   * @returns {Promise<{ hash: string, fee: bigint }>}
   */
  async sendOutputs (options) {
    return this._broadcast(this._build(await this._planOutputs(options)))
  }

  /**
   * Signs a transaction someone else built (a dapp, through WalletConnect or WizardConnect).
   * Only inputs that spend this account's own outputs are signed; the rest are returned as they came.
   *
   * @param {Object} request
   * @param {string} request.transaction - The unsigned transaction, hex.
   * @param {{ lockingBytecode: string, valueSatoshis: number | bigint | string, token?: { category: string, amount: number | bigint | string, nft?: { capability: string, commitment: string } } }[]} request.sourceOutputs -
   *   The output each input spends, in input order.
   * @param {boolean} [request.sighashUtxos] - Commit to every spent output (SIGHASH_UTXOS). Default true.
   * @returns {Promise<{ transaction: string, hash: string, signedInputs: number[] }>}
   */
  async signPreparedTransaction ({ transaction, sourceOutputs, sighashUtxos = true }) {
    const tx = decodeTransaction(hexToBytes(transaction))
    if (!Array.isArray(sourceOutputs) || sourceOutputs.length !== tx.inputs.length) {
      throw new Error('One source output is needed for every input of the transaction.')
    }
    /** @type {Output[]} */
    const sources = sourceOutputs.map(o => ({
      lockingBytecode: hexToBytes(o.lockingBytecode),
      valueSatoshis: BigInt(o.valueSatoshis),
      ...(o.token ? { token: { category: o.token.category, amount: BigInt(o.token.amount ?? 0), ...(o.token.nft ? { nft: o.token.nft } : {}) } } : {})
    }))
    const sighash = SIGHASH_ALL | SIGHASH_FORKID | (sighashUtxos ? SIGHASH_UTXOS : 0)
    const { transaction: signed, signed: signedInputs } = signP2pkhInputs(tx, sources, this._key(), this._publicKey, sighash)
    if (!signedInputs.length) throw new Error('None of the inputs belong to this account.')
    const encoded = encodeTransaction(signed)
    return { transaction: bytesToHex(encoded), hash: transactionId(encoded), signedInputs }
  }

  /**
   * A read-only copy of the account.
   *
   * @returns {Promise<WalletAccountReadOnlyBch>}
   */
  /**
   * Broadcasts a transaction that is already signed, for instance one returned by signPreparedTransaction.
   *
   * @param {string} transaction - The signed transaction, as hex.
   * @returns {Promise<{ hash: string, fee: bigint }>} The transaction id. The fee is not known here and is 0.
   */
  async broadcastTransaction (transaction) {
    const hex = String(transaction).toLowerCase()
    return this._broadcast({ hex, hash: transactionId(hexToBytes(hex)), fee: 0n })
  }

  async toReadOnlyAccount () {
    return new WalletAccountReadOnlyBch(await this.getAddress(), this._config)
  }

  /** Erases the private key from memory and closes the connection this account opened. */
  dispose () {
    this._privateKey?.fill(0)
    this._privateKey = null
    super.dispose()
  }
}
