'use strict'

/** @typedef {import('./src/wallet-account-read-only-bch.js').BchWalletConfig} BchWalletConfig */
/** @typedef {import('./src/wallet-account-read-only-bch.js').BchTransfer} BchTransfer */

export { default } from './src/wallet-manager-bch.js'
export { NAMED_BRANCHES } from './src/wallet-manager-bch.js'
export { default as WalletAccountBch, BCH_COIN_TYPE } from './src/wallet-account-bch.js'
export { default as WalletAccountReadOnlyBch } from './src/wallet-account-read-only-bch.js'
export { default as ElectrumClient, DEFAULT_SERVERS, scriptHashOf } from './src/electrum-client.js'
export { AddressType, decodeCashAddress, encodeCashAddress } from './src/cashaddr.js'
export { decodeTransaction, encodeTransaction, transactionId, DUST_LIMIT, TOKEN_OUTPUT_VALUE } from './src/transaction.js'
export { signMessage, verifyMessage } from './src/message.js'
