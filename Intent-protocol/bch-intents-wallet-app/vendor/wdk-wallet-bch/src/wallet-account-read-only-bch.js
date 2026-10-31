'use strict'

import { WalletAccountReadOnly } from '@tetherto/wdk-wallet'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

import { AddressType, acceptsTokens, decodeCashAddress, encodeCashAddress, prefixOf } from './cashaddr.js'
import ElectrumClient, { DEFAULT_SERVERS } from './electrum-client.js'
import { verifyMessage } from './message.js'
import {
  DUST_LIMIT, TOKEN_OUTPUT_VALUE, decodeTransaction, estimateSize, lockingBytecodeOf
} from './transaction.js'

/** @typedef {import('./transaction.js').Output} Output */
/** @typedef {import('./transaction.js').TokenData} TokenData */
/** @typedef {import('./electrum-client.js').ElectrumUtxo} ElectrumUtxo */

/**
 * @typedef {Object} BchWalletConfig
 * @property {'mainnet' | 'chipnet'} [network] - The network (default: "mainnet").
 * @property {Object} [client] - An Electrum client, or anything with the same methods. Mostly for tests.
 * @property {string[]} [servers] - Electrum WebSocket URLs, replacing the public defaults.
 * @property {typeof WebSocket} [WebSocket] - The WebSocket constructor, where there is no global one.
 * @property {number} [coinType] - The BIP-44 coin type to derive under (default: 145). Set 0 to match mainnet-js's default wallet.
 * @property {number | bigint} [feeRate] - Satoshis per byte. Defaults to what the server relays at (at least 1).
 */

/**
 * @typedef {Object} BchTransfer
 * @property {string} txid
 * @property {number} height - 0 while unconfirmed.
 * @property {number} [timestamp] - Block time in seconds, when confirmed.
 * @property {bigint} delta - Satoshis gained (positive) or spent (negative) by this address.
 * @property {{ category: string, delta: bigint }[]} tokens - Fungible token changes.
 * @property {{ category: string, delta: number }[]} nfts - NFT count changes (+1 received, −1 sent) per category.
 */

const normalizeCategory = category => String(category).replace(/^0x/, '').toLowerCase()
const normalizeCommitment = commitment => String(commitment ?? '').replace(/^0x/, '').toLowerCase()

/**
 * An output as a caller plans it (JSON-safe: hex strings, integers as decimal strings or bigints).
 *
 * @typedef {Object} PlannedOutput
 * @property {string} lockingBytecode - Hex.
 * @property {string | number | bigint} valueSatoshis
 * @property {{ category: string, amount?: string | number | bigint, nft?: { capability: 'none' | 'mutable' | 'minting', commitment: string } }} [token]
 */

const HEX = /^([0-9a-f]{2})*$/

/** @param {PlannedOutput} o @returns {Output} */
function toOutput (o) {
  const lock = String(o?.lockingBytecode ?? '').toLowerCase()
  if (!lock || !HEX.test(lock)) throw new Error('An output has no valid locking bytecode.')
  const value = BigInt(o.valueSatoshis)
  if (value < 0n) throw new Error('An output pays a negative amount.')
  const isData = lock.startsWith('6a')
  if (!isData && value < DUST_LIMIT) throw new Error(`An output pays less than ${DUST_LIMIT} satoshis.`)
  if (isData && (value !== 0n || o.token)) throw new Error('A data output must carry nothing.')
  const out = { lockingBytecode: hexToBytes(lock), valueSatoshis: value }
  if (!o.token) return out
  const category = normalizeCategory(o.token.category)
  if (!/^[0-9a-f]{64}$/.test(category)) throw new Error('An output names a malformed token category.')
  const amount = BigInt(o.token.amount ?? 0)
  if (amount < 0n) throw new Error('An output carries a negative token amount.')
  const nft = o.token.nft
  if (nft && !['none', 'mutable', 'minting'].includes(nft.capability)) throw new Error('An output carries an NFT of unknown capability.')
  const commitment = nft ? normalizeCommitment(nft.commitment) : ''
  if (nft && !HEX.test(commitment)) throw new Error('An output carries a malformed NFT commitment.')
  return { ...out, token: { category, amount, ...(nft ? { nft: { capability: nft.capability, commitment } } : {}) } }
}

export default class WalletAccountReadOnlyBch extends WalletAccountReadOnly {
  /**
   * Creates a read-only Bitcoin Cash account.
   *
   * @param {string} address - The account's address (either form).
   * @param {BchWalletConfig} [config]
   */
  constructor (address, config = {}) {
    const network = config.network ?? 'mainnet'
    const decoded = decodeCashAddress(address, prefixOf(network))
    if (decoded.prefix !== prefixOf(network)) throw new Error(`The address is not a ${network} address.`)
    if (decoded.type !== AddressType.P2PKH && decoded.type !== AddressType.P2PKH_TOKENS) {
      throw new Error('Only pay-to-public-key-hash accounts are supported.')
    }
    super(encodeCashAddress(decoded.prefix, AddressType.P2PKH, decoded.hash))

    /** @protected */
    this._config = config
    /** @protected */
    this._network = network
    /** @protected */
    this._publicKeyHash = decoded.hash
    /** @protected */
    this._lockingBytecode = lockingBytecodeOf({ type: AddressType.P2PKH, hash: decoded.hash })
    /** @protected */
    this._client = config.client ?? new ElectrumClient({ servers: config.servers ?? DEFAULT_SERVERS[network], WebSocket: config.WebSocket })
    /** @private */
    this._ownsClient = !config.client
  }

  /** The address tokens are sent to: the same key, in the token-aware form ("z…"). */
  async getTokenAddress () {
    return encodeCashAddress(prefixOf(this._network), AddressType.P2PKH_TOKENS, this._publicKeyHash)
  }

  /**
   * Every unspent output of the account.
   *
   * @returns {Promise<ElectrumUtxo[]>}
   */
  async getUtxos () {
    return this._client.listUnspent(this._lockingBytecode)
  }

  /**
   * The spendable balance: satoshis on outputs that carry no token. The small amounts that travel with tokens
   * are left out, because spending them would mean moving the tokens.
   *
   * @returns {Promise<bigint>}
   */
  async getBalance () {
    const utxos = await this.getUtxos()
    return utxos.reduce((sum, u) => (u.token ? sum : sum + u.satoshis), 0n)
  }

  /**
   * The fungible balance of one token.
   *
   * @param {string} category - The token category.
   * @returns {Promise<bigint>}
   */
  async getTokenBalance (category) {
    return (await this.getTokenBalances())[normalizeCategory(category)] ?? 0n
  }

  /**
   * The fungible balance of every token the account holds.
   *
   * @returns {Promise<Record<string, bigint>>} Amounts by category.
   */
  async getTokenBalances () {
    const balances = {}
    for (const u of await this.getUtxos()) {
      if (!u.token || u.token.amount === 0n) continue
      balances[u.token.category] = (balances[u.token.category] ?? 0n) + u.token.amount
    }
    return balances
  }

  /**
   * Every NFT the account holds: one entry per unspent output whose token carries an NFT. A coin can hold an
   * NFT and a fungible amount of the same category at once; `amount` and `satoshis` are what rides on that coin.
   *
   * @returns {Promise<{ category: string, commitment: string, capability: 'none' | 'mutable' | 'minting', amount: bigint, txid: string, vout: number, satoshis: bigint }[]>}
   */
  async getNftHoldings () {
    const out = []
    for (const u of await this.getUtxos()) {
      if (!u.token?.nft) continue
      out.push({
        category: u.token.category,
        commitment: u.token.nft.commitment ?? '',
        capability: u.token.nft.capability ?? 'none',
        amount: u.token.amount ?? 0n,
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis
      })
    }
    return out
  }

  /** @protected */
  async _feeRate () {
    if (this._config.feeRate !== undefined) return BigInt(this._config.feeRate)
    return BigInt(await this._client.relayFeeRate())
  }

  /**
   * Decodes a destination and checks it belongs to this network.
   *
   * @protected
   * @param {string} address
   * @param {boolean} forTokens
   * @returns {Uint8Array} The locking bytecode.
   */
  _destination (address, forTokens) {
    const decoded = decodeCashAddress(address, prefixOf(this._network))
    if (decoded.prefix !== prefixOf(this._network)) throw new Error(`The recipient is not a ${this._network} address.`)
    if (forTokens && !acceptsTokens(decoded.type)) throw new Error('Tokens must be sent to a token-aware address (it starts with "z" or "r").')
    return lockingBytecodeOf(decoded)
  }

  /**
   * Chooses coins and lays out the outputs of a payment in BCH.
   * Token-carrying coins are never spent here.
   *
   * @protected
   * @returns {Promise<{ inputs: ElectrumUtxo[], outputs: Output[], fee: bigint }>}
   */
  async _planSend ({ to, value }) {
    const amount = BigInt(value)
    if (amount < DUST_LIMIT) throw new Error(`The smallest amount that can be sent is ${DUST_LIMIT} satoshis.`)
    const recipient = { lockingBytecode: this._destination(to, false), valueSatoshis: amount }
    const change = { lockingBytecode: this._lockingBytecode, valueSatoshis: 0n }
    const rate = await this._feeRate()
    const coins = (await this.getUtxos()).filter(u => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : a.satoshis > b.satoshis ? -1 : 0))

    const inputs = []
    let total = 0n
    for (const coin of coins) {
      inputs.push(coin)
      total += coin.satoshis
      const feeWithChange = BigInt(estimateSize(inputs.length, [recipient, change])) * rate
      if (total >= amount + feeWithChange + DUST_LIMIT) {
        return { inputs, outputs: [recipient, { ...change, valueSatoshis: total - amount - feeWithChange }], fee: feeWithChange }
      }
      // No room for a change output worth having: whatever is left over goes to the miners.
      const feeAlone = BigInt(estimateSize(inputs.length, [recipient])) * rate
      if (total >= amount + feeAlone && total - amount - feeAlone < DUST_LIMIT + BigInt(34) * rate) {
        return { inputs, outputs: [recipient], fee: total - amount }
      }
    }
    throw new Error('Not enough Bitcoin Cash to cover the amount and the network fee.')
  }

  /**
   * Lays out a payment that empties the account of BCH (tokens stay).
   *
   * @protected
   */
  async _planSendMax (to) {
    const coins = (await this.getUtxos()).filter(u => !u.token)
    const total = coins.reduce((sum, u) => sum + u.satoshis, 0n)
    const lockingBytecode = this._destination(to, false)
    const fee = BigInt(estimateSize(coins.length, [{ lockingBytecode, valueSatoshis: total }])) * (await this._feeRate())
    if (!coins.length || total - fee < DUST_LIMIT) throw new Error('Not enough Bitcoin Cash to send.')
    return { inputs: coins, outputs: [{ lockingBytecode, valueSatoshis: total - fee }], fee }
  }

  /**
   * Chooses coins and lays out the outputs of a fungible token transfer.
   *
   * @protected
   * @returns {Promise<{ inputs: ElectrumUtxo[], outputs: Output[], fee: bigint }>}
   */
  async _planTransfer ({ token, recipient, amount, value }) {
    const category = normalizeCategory(token)
    const tokens = BigInt(amount)
    if (tokens <= 0n) throw new Error('The token amount must be above zero.')
    const carried = value === undefined ? TOKEN_OUTPUT_VALUE : BigInt(value)
    if (carried < DUST_LIMIT) throw new Error(`A token output must carry at least ${DUST_LIMIT} satoshis.`)
    const rate = await this._feeRate()
    const utxos = await this.getUtxos()

    // Fungible-only coins of this category. A coin that also holds an NFT is left alone: moving it would move the NFT.
    const tokenCoins = utxos.filter(u => u.token?.category === category && !u.token.nft && u.token.amount > 0n)
      .sort((a, b) => (a.token.amount < b.token.amount ? 1 : -1))
    const inputs = []
    let tokenTotal = 0n
    let satTotal = 0n
    for (const coin of tokenCoins) {
      if (tokenTotal >= tokens) break
      inputs.push(coin)
      tokenTotal += coin.token.amount
      satTotal += coin.satoshis
    }
    if (tokenTotal < tokens) throw new Error('Not enough of this token.')

    const outputs = [{ lockingBytecode: this._destination(recipient, true), valueSatoshis: carried, token: { category, amount: tokens } }]
    if (tokenTotal > tokens) {
      outputs.push({ lockingBytecode: this._lockingBytecode, valueSatoshis: TOKEN_OUTPUT_VALUE, token: { category, amount: tokenTotal - tokens } })
    }
    const committed = outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n)
    const change = { lockingBytecode: this._lockingBytecode, valueSatoshis: 0n }
    const plainCoins = utxos.filter(u => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))

    for (let i = 0; i <= plainCoins.length; i++) {
      const feeWithChange = BigInt(estimateSize(inputs.length, [...outputs, change])) * rate
      if (satTotal >= committed + feeWithChange + DUST_LIMIT) {
        return { inputs, outputs: [...outputs, { ...change, valueSatoshis: satTotal - committed - feeWithChange }], fee: feeWithChange }
      }
      const feeAlone = BigInt(estimateSize(inputs.length, outputs)) * rate
      if (satTotal >= committed + feeAlone && satTotal - committed - feeAlone < DUST_LIMIT + BigInt(34) * rate) {
        return { inputs, outputs, fee: satTotal - committed }
      }
      if (i === plainCoins.length) break
      inputs.push(plainCoins[i])
      satTotal += plainCoins[i].satoshis
    }
    throw new Error('Not enough Bitcoin Cash to pay the network fee for this token transfer.')
  }

  /**
   * Chooses coins and lays out the outputs of an NFT transfer. The whole NFT coin moves, so its capability,
   * commitment and any fungible amount riding on it are preserved exactly. When the category holds more than
   * one NFT, `commitment` picks which one; an empty commitment is "" (or "0x").
   *
   * @protected
   * @param {{ token: string, commitment?: string, recipient: string, value?: number | bigint }} options
   * @returns {Promise<{ inputs: ElectrumUtxo[], outputs: Output[], fee: bigint }>}
   */
  async _planTransferNft ({ token, commitment, recipient, value }) {
    const category = normalizeCategory(token)
    const wanted = normalizeCommitment(commitment)
    const carried = value === undefined ? TOKEN_OUTPUT_VALUE : BigInt(value)
    if (carried < DUST_LIMIT) throw new Error(`A token output must carry at least ${DUST_LIMIT} satoshis.`)
    const rate = await this._feeRate()
    const utxos = await this.getUtxos()

    const matches = utxos.filter(u => u.token?.category === category && u.token.nft && normalizeCommitment(u.token.nft.commitment) === wanted)
    if (matches.length === 0) throw new Error('This NFT is not in the wallet.')
    if (matches.length > 1) throw new Error('More than one NFT of this category carries that commitment; this is not supported.')
    const nftCoin = matches[0]

    // The NFT output moves the coin whole: the same category, fungible amount, capability and commitment.
    const out = {
      lockingBytecode: this._destination(recipient, true),
      valueSatoshis: carried,
      token: { category, amount: nftCoin.token.amount, nft: { capability: nftCoin.token.nft.capability, commitment: nftCoin.token.nft.commitment } }
    }
    const inputs = [nftCoin]
    let satTotal = nftCoin.satoshis
    const committed = carried
    const change = { lockingBytecode: this._lockingBytecode, valueSatoshis: 0n }
    const plainCoins = utxos.filter(u => !u.token).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))

    for (let i = 0; i <= plainCoins.length; i++) {
      const feeWithChange = BigInt(estimateSize(inputs.length, [out, change])) * rate
      if (satTotal >= committed + feeWithChange + DUST_LIMIT) {
        return { inputs, outputs: [out, { ...change, valueSatoshis: satTotal - committed - feeWithChange }], fee: feeWithChange }
      }
      const feeAlone = BigInt(estimateSize(inputs.length, [out])) * rate
      if (satTotal >= committed + feeAlone && satTotal - committed - feeAlone < DUST_LIMIT + BigInt(34) * rate) {
        return { inputs, outputs: [out], fee: satTotal - committed }
      }
      if (i === plainCoins.length) break
      inputs.push(plainCoins[i])
      satTotal += plainCoins[i].satoshis
    }
    throw new Error('Not enough Bitcoin Cash to pay the network fee for this NFT transfer.')
  }

  /**
   * Lays out a transaction that pays exactly the given outputs, in the given order, from this account's coins.
   * For transactions another party planned, such as a Mesh position's genesis: the outputs come first, then
   * token change, then BCH change.
   *
   * - `firstInput`, when given, must be one of this account's plain coins and is spent at input 0. When it is
   *   output 0 of its transaction, the outputs may create tokens whose category is that transaction's id
   *   (a CashToken genesis); no other new category is accepted.
   * - Fungible tokens the outputs carry are taken from the account's coins of that category; NFT coins are
   *   never spent, so an NFT is never moved by accident.
   *
   * @protected
   * @param {{ outputs: PlannedOutput[], firstInput?: { txid: string, vout: number } }} options
   * @returns {Promise<{ inputs: ElectrumUtxo[], outputs: Output[], fee: bigint }>}
   */
  async _planOutputs ({ outputs, firstInput }) {
    if (!Array.isArray(outputs) || outputs.length === 0) throw new Error('There are no outputs to pay.')
    const planned = outputs.map(toOutput)
    const rate = await this._feeRate()
    const utxos = await this.getUtxos()

    const inputs = []
    let genesisCategory = null
    if (firstInput) {
      const seed = utxos.find(u => u.txid === String(firstInput.txid).toLowerCase() && u.vout === Number(firstInput.vout))
      if (!seed) throw new Error('The first input is not one of this account\'s coins (has it confirmed or been spent?).')
      if (seed.token) throw new Error('The first input must be a coin that carries no token.')
      inputs.push(seed)
      if (seed.vout === 0) genesisCategory = seed.txid
    }

    // Tokens the outputs carry, by category. A new category may only be the one the first input creates.
    const needed = new Map()
    for (const o of planned) {
      if (!o.token) continue
      if (o.token.category === genesisCategory) continue
      if (o.token.nft) throw new Error('The outputs move an NFT the wallet would have to spend; this is not supported.')
      needed.set(o.token.category, (needed.get(o.token.category) ?? 0n) + o.token.amount)
    }
    const tokenChange = []
    for (const [category, amount] of needed) {
      const coins = utxos.filter(u => u.token?.category === category && !u.token.nft && u.token.amount > 0n)
        .sort((a, b) => (a.token.amount < b.token.amount ? 1 : -1))
      let got = 0n
      for (const c of coins) {
        if (got >= amount) break
        inputs.push(c)
        got += c.token.amount
      }
      if (got < amount) throw new Error('Not enough of a token the outputs carry.')
      if (got > amount) tokenChange.push({ lockingBytecode: this._lockingBytecode, valueSatoshis: TOKEN_OUTPUT_VALUE, token: { category, amount: got - amount } })
    }

    const fixed = [...planned, ...tokenChange]
    const committed = fixed.reduce((sum, o) => sum + o.valueSatoshis, 0n)
    let satTotal = inputs.reduce((sum, u) => sum + u.satoshis, 0n)
    const used = new Set(inputs.map(u => `${u.txid}:${u.vout}`))
    const plainCoins = utxos.filter(u => !u.token && !used.has(`${u.txid}:${u.vout}`)).sort((a, b) => (a.satoshis < b.satoshis ? 1 : -1))
    const change = { lockingBytecode: this._lockingBytecode, valueSatoshis: 0n }

    for (let i = 0; i <= plainCoins.length; i++) {
      const feeWithChange = BigInt(estimateSize(inputs.length, [...fixed, change])) * rate
      if (satTotal >= committed + feeWithChange + DUST_LIMIT) {
        return { inputs, outputs: [...fixed, { ...change, valueSatoshis: satTotal - committed - feeWithChange }], fee: feeWithChange }
      }
      const feeAlone = BigInt(estimateSize(inputs.length, fixed)) * rate
      if (satTotal >= committed + feeAlone && satTotal - committed - feeAlone < DUST_LIMIT + BigInt(34) * rate) {
        return { inputs, outputs: fixed, fee: satTotal - committed }
      }
      if (i === plainCoins.length) break
      inputs.push(plainCoins[i])
      satTotal += plainCoins[i].satoshis
    }
    throw new Error('Not enough Bitcoin Cash to pay these outputs and the network fee.')
  }

  /**
   * Quotes the network fee of paying planned outputs.
   *
   * @param {{ outputs: PlannedOutput[], firstInput?: { txid: string, vout: number } }} options
   * @returns {Promise<{ fee: bigint }>}
   */
  async quoteOutputs (options) {
    return { fee: (await this._planOutputs(options)).fee }
  }

  /**
   * Quotes the cost of a payment.
   *
   * @param {{ to: string, value: number | bigint }} tx
   * @returns {Promise<{ fee: bigint }>}
   */
  async quoteSendTransaction (tx) {
    return { fee: (await this._planSend(tx)).fee }
  }

  /**
   * Quotes the cost of a token transfer.
   *
   * @param {{ token: string, recipient: string, amount: number | bigint }} options
   * @returns {Promise<{ fee: bigint }>}
   */
  async quoteTransfer (options) {
    return { fee: (await this._planTransfer(options)).fee }
  }

  /**
   * Quotes the cost of an NFT transfer.
   *
   * @param {{ token: string, commitment?: string, recipient: string, value?: number | bigint }} options
   * @returns {Promise<{ fee: bigint }>}
   */
  async quoteTransferNft (options) {
    return { fee: (await this._planTransferNft(options)).fee }
  }

  /**
   * The most BCH that can be sent in one payment, and what it costs.
   *
   * @returns {Promise<{ amount: bigint, fee: bigint }>}
   */
  async getMaxSpendable () {
    try {
      const address = await this.getAddress()
      const plan = await this._planSendMax(address)
      return { amount: plan.outputs[0].valueSatoshis, fee: plan.fee }
    } catch {
      return { amount: 0n, fee: 0n }
    }
  }

  /**
   * Verifies a message signature made by this account.
   *
   * @param {string} message
   * @param {string} signature - Base64.
   * @returns {Promise<boolean>}
   */
  async verify (message, signature) {
    return verifyMessage(message, signature, this._publicKeyHash)
  }

  /**
   * Looks a transaction up.
   *
   * @param {string} hash - The transaction id.
   * @returns {Promise<{ txid: string, confirmations: number, timestamp?: number } | null>} Null while the network does not know it.
   */
  async getTransactionReceipt (hash) {
    const details = await this._client.getTransactionDetails(hash)
    if (!details) return null
    return { txid: hash, confirmations: details.confirmations, timestamp: details.blocktime }
  }

  /**
   * Recent transactions and what each changed for this address, newest first.
   *
   * @param {{ limit?: number }} [options]
   * @returns {Promise<BchTransfer[]>}
   */
  async getTransfers ({ limit = 15 } = {}) {
    const history = (await this._client.getHistory(this._lockingBytecode)).reverse()
    // Unconfirmed first, then newest block first.
    history.sort((a, b) => (a.height === 0 ? -1 : b.height === 0 ? 1 : b.height - a.height))
    const mine = bytesToHex(this._lockingBytecode)
    const cache = new Map()
    const load = async txid => {
      if (!cache.has(txid)) cache.set(txid, this._client.getTransactionDetails(txid))
      return cache.get(txid)
    }

    const out = []
    for (const { txid, height } of history.slice(0, limit)) {
      const details = await load(txid)
      if (!details) continue
      const tx = decodeTransaction(hexToBytes(details.hex))
      let delta = 0n
      const tokens = new Map()
      const nfts = new Map()
      const apply = (output, sign) => {
        if (bytesToHex(output.lockingBytecode) !== mine) return
        delta += sign * output.valueSatoshis
        if (output.token?.amount) tokens.set(output.token.category, (tokens.get(output.token.category) ?? 0n) + sign * output.token.amount)
        // NFTs are not fungible, so they are counted (±1), not summed by amount: a pure NFT carries amount 0.
        if (output.token?.nft) nfts.set(output.token.category, (nfts.get(output.token.category) ?? 0) + Number(sign))
      }
      for (const output of tx.outputs) apply(output, 1n)
      for (const input of tx.inputs) {
        const previous = await load(input.txid)
        if (!previous) continue
        const spent = decodeTransaction(hexToBytes(previous.hex)).outputs[input.vout]
        if (spent) apply(spent, -1n)
      }
      out.push({
        txid, height, timestamp: details.blocktime, delta,
        tokens: [...tokens].filter(([, d]) => d !== 0n).map(([category, d]) => ({ category, delta: d })),
        nfts: [...nfts].filter(([, d]) => d !== 0).map(([category, d]) => ({ category, delta: d }))
      })
    }
    return out
  }

  /** Closes the connection this account opened. */
  dispose () {
    if (this._ownsClient) this._client.close?.()
  }
}
