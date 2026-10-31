// The module against two independent implementations:
//
//   mainnet-js   what the browser extension uses today. Addresses and message signatures must be identical.
//   libauth      the reference Bitcoin Cash library. Its virtual machine must accept every transaction we sign.
//
// Both are loaded from the extension's install next door, so this package's own dependency tree stays small.
// Without that install the comparison tests are skipped and say so.

import { describe, expect, it } from 'vitest'

import WalletManagerBch, {
  WalletAccountReadOnlyBch, decodeCashAddress, encodeCashAddress, AddressType, decodeTransaction, encodeTransaction, signMessage, verifyMessage
} from '../index.js'
import { encodeTokenPrefix, decodeTokenPrefix, hash160, lockingBytecodeOf } from '../src/transaction.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

const PHRASE = 'test test test test test test test test test test test junk'
// Resolved through aliases in vitest.config.js; null when the neighbouring install is not there.
const mainnet = await import('mainnet-js').catch(() => null)
const libauth = await import('@bitauth/libauth').catch(() => null)

const CATEGORY = 'ab'.repeat(32)
const OTHER = 'cd'.repeat(32)

/** A stand-in for the Electrum server: fixed coins, and it remembers what was broadcast. */
function fakeClient (utxos, feeRate = 1) {
  const sent = []
  return {
    sent,
    listUnspent: async () => utxos,
    getHistory: async () => [],
    getTransactionDetails: async () => null,
    relayFeeRate: async () => feeRate,
    broadcast: async hex => { sent.push(hex); return bytesToHex(Uint8Array.from(libauthHash(hex)).reverse()) },
    close: async () => {}
  }
}
// The id the "server" answers with is computed independently of the module's own transactionId().
const libauthHash = hex => {
  if (libauth) return libauth.hash256(hexToBytes(hex))
  throw new Error('libauth is needed for the transaction tests')
}

const coin = (n, satoshis, token) => ({ txid: n.toString(16).padStart(64, '0'), vout: n % 3, satoshis: BigInt(satoshis), height: 100, ...(token ? { token } : {}) })

/** Run a signed transaction through libauth's virtual machine with the outputs it spends. */
function vmAccepts (hex, account, utxos) {
  const tx = libauth.decodeTransaction(hexToBytes(hex))
  expect(typeof tx).not.toBe('string')
  const byOutpoint = new Map(utxos.map(u => [`${u.txid}:${u.vout}`, u]))
  const sourceOutputs = tx.inputs.map(input => {
    const u = byOutpoint.get(`${bytesToHex(input.outpointTransactionHash)}:${input.outpointIndex}`)
    return {
      lockingBytecode: account._lockingBytecode,
      valueSatoshis: u.satoshis,
      ...(u.token ? { token: { category: hexToBytes(u.token.category), amount: u.token.amount, ...(u.token.nft ? { nft: { capability: u.token.nft.capability, commitment: hexToBytes(u.token.nft.commitment) } } : {}) } } : {})
    }
  })
  const vm = libauth.createVirtualMachineBch2025 ? libauth.createVirtualMachineBch2025(true) : libauth.createVirtualMachineBCH(true)
  return { result: vm.verify({ sourceOutputs, transaction: tx }), tx, sourceOutputs }
}

describe('addresses', () => {
  it('round-trips every address type and hash size', () => {
    const h20 = hexToBytes('f5bf48b397dae70be82b3cca4793f8eb2b6cdac9')
    const h32 = hexToBytes('11'.repeat(32))
    for (const [type, hash] of [[AddressType.P2PKH, h20], [AddressType.P2SH, h20], [AddressType.P2PKH_TOKENS, h20], [AddressType.P2SH_TOKENS, h32], [AddressType.P2SH, h32]]) {
      for (const prefix of ['bitcoincash', 'bchtest']) {
        const address = encodeCashAddress(prefix, type, hash)
        expect(decodeCashAddress(address)).toEqual({ prefix, type, hash })
      }
    }
  })

  it('matches the specification vector', () => {
    // From the CashAddr specification's test vectors (20-byte hash, type 0).
    expect(encodeCashAddress('bitcoincash', 0, hexToBytes('F5BF48B397DAE70BE82B3CCA4793F8EB2B6CDAC9'.toLowerCase())))
      .toBe('bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2')
  })

  it('refuses a mistyped character, mixed case, and a missing prefix', () => {
    expect(() => decodeCashAddress('bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg3')).toThrow(/checksum/)
    expect(() => decodeCashAddress('bitcoincash:Qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2')).toThrow(/case/)
    expect(() => decodeCashAddress('qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2')).toThrow(/prefix/)
    // A bare address is accepted when the caller says which network it is for, and the checksum still binds it.
    expect(decodeCashAddress('qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2', 'bitcoincash').type).toBe(0)
    expect(() => decodeCashAddress('qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2', 'bchtest')).toThrow(/checksum/)
  })

  it.skipIf(!mainnet)('account 0 matches mainnet-js on the standard path, and its default wallet with coinType 0', async () => {
    for (const [network, Cls] of [['mainnet', mainnet.Wallet], ['chipnet', mainnet.TestNetWallet]]) {
      // The standard Bitcoin Cash path.
      const reference = await Cls.fromSeed(PHRASE, "m/44'/145'/0'/0/0")
      const account = await new WalletManagerBch(PHRASE, { network, client: fakeClient([]) }).getAccount(0)
      expect(await account.getAddress()).toBe(reference.cashaddr)
      expect(await account.getTokenAddress()).toBe(reference.tokenaddr)
      expect(account.path).toBe("m/44'/145'/0'/0/0")

      // mainnet-js's own default (what the frontend and the extension show) is under coin type 0.
      const legacy = await Cls.fromSeed(PHRASE)
      const compatible = await new WalletManagerBch(PHRASE, { network, coinType: 0, client: fakeClient([]) }).getAccount(0)
      expect(await compatible.getAddress()).toBe(legacy.cashaddr)
      expect(compatible.path).toBe("m/44'/0'/0'/0/0")
      expect(await compatible.getAddress()).not.toBe(await account.getAddress())
    }
  })

  it.skipIf(!mainnet)('accounts 1 to 3 are addresses 1 to 3 of the same branch', async () => {
    const manager = new WalletManagerBch(PHRASE, { network: 'chipnet', client: fakeClient([]) })
    for (const n of [1, 2, 3]) {
      const reference = await mainnet.TestNetWallet.fromSeed(PHRASE, `m/44'/145'/0'/0/${n}`)
      const account = await manager.getAccount(n)
      expect(await account.getAddress()).toBe(reference.cashaddr)
      expect(account.index).toBe(n)
    }
  })

  it('the extended public key of the receive branch derives the account addresses', async () => {
    const { HDKey } = await import('@scure/bip32')
    const manager = new WalletManagerBch(PHRASE, { network: 'mainnet', client: fakeClient([]) })
    const branch = HDKey.fromExtendedKey(manager.getExtendedPublicKey('receive'))
    for (const n of [0, 5]) {
      const derived = encodeCashAddress('bitcoincash', AddressType.P2PKH, hash160(branch.deriveChild(n).publicKey))
      expect(derived).toBe(await (await manager.getAccount(n)).getAddress())
    }
    expect(branch.privateKey).toBeNull()
    expect(() => manager.getExtendedPublicKey('secret')).toThrow(/Unknown branch/)
  })

  it('a read-only account refuses an address of the other network', () => {
    expect(() => new WalletAccountReadOnlyBch('bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2', { network: 'chipnet', client: fakeClient([]) })).toThrow(/chipnet/)
  })
})

describe('message signing', () => {
  it.skipIf(!mainnet)('produces the same bytes as mainnet-js', async () => {
    const reference = await mainnet.TestNetWallet.fromSeed(PHRASE)
    const account = await new WalletManagerBch(PHRASE, { network: 'chipnet', coinType: 0, client: fakeClient([]) }).getAccount(0)
    for (const message of ['hello', 'Sign in to example.com\nNonce: 42', '', 'ünïcödé ✓', 'x'.repeat(300)]) {
      expect(await account.sign(message), JSON.stringify(message)).toBe(reference.sign(message).signature)
    }
  })

  it('verifies its own signatures and nothing else', async () => {
    const manager = new WalletManagerBch(PHRASE, { network: 'chipnet', client: fakeClient([]) })
    const a = await manager.getAccount(0)
    const b = await manager.getAccount(1)
    const signature = await a.sign('pay me')
    expect(await a.verify('pay me', signature)).toBe(true)
    expect(await a.verify('pay you', signature)).toBe(false)
    expect(await b.verify('pay me', signature)).toBe(false)
    expect(await a.verify('pay me', 'not base64 at all')).toBe(false)
    expect(verifyMessage('pay me', signMessage('pay me', a.keyPair.privateKey), hash160(a.keyPair.publicKey))).toBe(true)
  })

  it.skipIf(!mainnet)('mainnet-js accepts our signature', async () => {
    const account = await new WalletManagerBch(PHRASE, { network: 'chipnet', client: fakeClient([]) }).getAccount(0)
    const signature = await account.sign('cross-check')
    const verdict = mainnet.SignedMessage.verify('cross-check', signature, await account.getAddress())
    expect(verdict.valid).toBe(true)
  })
})

describe('token prefix', () => {
  it.skipIf(!libauth)('encodes exactly as libauth does', () => {
    const cases = [
      { category: CATEGORY, amount: 1n },
      { category: CATEGORY, amount: 252n },
      { category: CATEGORY, amount: 253n },
      { category: CATEGORY, amount: 9223372036854775807n },
      { category: OTHER, amount: 0n, nft: { capability: 'none', commitment: '' } },
      { category: OTHER, amount: 5n, nft: { capability: 'minting', commitment: 'beef' } }
    ]
    for (const token of cases) {
      const reference = libauth.encodeTokenPrefix({
        category: hexToBytes(token.category), amount: token.amount,
        ...(token.nft ? { nft: { capability: token.nft.capability, commitment: hexToBytes(token.nft.commitment) } } : {})
      })
      expect(bytesToHex(encodeTokenPrefix(token))).toBe(bytesToHex(reference))
      const lock = hexToBytes('76a914' + '00'.repeat(20) + '88ac')
      const decoded = decodeTokenPrefix(Uint8Array.from([...reference, ...lock]))
      expect(decoded.token).toEqual(token)
      expect(bytesToHex(decoded.lockingBytecode)).toBe(bytesToHex(lock))
    }
  })

  it('refuses an output with neither an amount nor an NFT, and a malformed category', () => {
    expect(() => encodeTokenPrefix({ category: CATEGORY, amount: 0n })).toThrow()
    expect(() => encodeTokenPrefix({ category: 'abc', amount: 1n })).toThrow()
  })
})

describe.skipIf(!libauth)('transactions the reference virtual machine accepts', () => {
  const setup = async utxos => {
    const client = fakeClient(utxos)
    const account = await new WalletManagerBch(PHRASE, { network: 'chipnet', client }).getAccount(0)
    return { client, account }
  }
  const to = encodeCashAddress('bchtest', AddressType.P2PKH, hexToBytes('f5bf48b397dae70be82b3cca4793f8eb2b6cdac9'))
  const toTokens = encodeCashAddress('bchtest', AddressType.P2PKH_TOKENS, hexToBytes('f5bf48b397dae70be82b3cca4793f8eb2b6cdac9'))

  it('a payment with change', async () => {
    const utxos = [coin(1, 50_000), coin(2, 20_000), coin(3, 1000, { category: CATEGORY, amount: 7n })]
    const { client, account } = await setup(utxos)
    const { hash, fee } = await account.sendTransaction({ to, value: 30_000n })
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // The largest coin covers it alone; the token coin is never touched.
    expect(tx.inputs).toHaveLength(1)
    expect(tx.outputs).toHaveLength(2)
    expect(tx.outputs[0].valueSatoshis).toBe(30_000n)
    expect(tx.outputs[0].token).toBeUndefined()
    expect(tx.outputs[1].valueSatoshis).toBe(50_000n - 30_000n - fee)
    // One satoshi per byte, and the estimate is never below the real size.
    expect(fee).toBeGreaterThanOrEqual(BigInt(client.sent[0].length / 2))
    expect(fee).toBeLessThan(400n)
  })

  it('a payment that needs several coins', async () => {
    const utxos = [coin(1, 6000), coin(2, 5000), coin(4, 4000)]
    const { client, account } = await setup(utxos)
    await account.sendTransaction({ to, value: 12_000n })
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    expect(tx.inputs).toHaveLength(3)
  })

  it('leftover too small for a change output goes to the fee, not to a dust output', async () => {
    const utxos = [coin(1, 10_600)]
    const { client, account } = await setup(utxos)
    const { fee } = await account.sendTransaction({ to, value: 10_000n })
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    expect(tx.outputs).toHaveLength(1)
    expect(fee).toBe(600n)
  })

  it('refuses to overspend, and to send dust', async () => {
    const { client, account } = await setup([coin(1, 5000), coin(3, 100_000, { category: CATEGORY, amount: 1n })])
    await expect(account.sendTransaction({ to, value: 5000n })).rejects.toThrow(/Not enough/)
    await expect(account.sendTransaction({ to, value: 100n })).rejects.toThrow(/smallest amount/)
    expect(client.sent).toHaveLength(0)
    // The spendable balance leaves out what is attached to tokens.
    expect(await account.getBalance()).toBe(5000n)
  })

  it('sending the maximum empties the plain coins and keeps the tokens', async () => {
    const utxos = [coin(1, 6000), coin(2, 5000), coin(3, 1000, { category: CATEGORY, amount: 7n })]
    const { client, account } = await setup(utxos)
    const max = await account.getMaxSpendable()
    const { fee } = await account.sendMax(to)
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    expect(tx.inputs).toHaveLength(2)
    expect(tx.outputs).toHaveLength(1)
    expect(tx.outputs[0].valueSatoshis).toBe(11_000n - fee)
    expect(max).toEqual({ amount: 11_000n - fee, fee })
  })

  it('a token transfer with token change and BCH change', async () => {
    const utxos = [coin(1, 1000, { category: CATEGORY, amount: 100n }), coin(2, 1000, { category: OTHER, amount: 9n }), coin(4, 20_000)]
    const { client, account } = await setup(utxos)
    await account.transfer({ token: CATEGORY, recipient: toTokens, amount: 30n })
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    expect(tx.outputs.map(o => [o.token ? bytesToHex(o.token.category) : null, o.token?.amount ?? null])).toEqual([[CATEGORY, 30n], [CATEGORY, 70n], [null, null]])
    // Tokens are conserved, and the other category was not spent.
    expect(tx.inputs).toHaveLength(2)
    expect(await account.getTokenBalance(CATEGORY)).toBe(100n)
    expect(await account.getTokenBalances()).toEqual({ [CATEGORY]: 100n, [OTHER]: 9n })
  })

  it('a token transfer of the whole balance has no token change', async () => {
    const utxos = [coin(1, 1000, { category: CATEGORY, amount: 40n }), coin(2, 1000, { category: CATEGORY, amount: 60n }), coin(4, 20_000)]
    const { client, account } = await setup(utxos)
    await account.transfer({ token: '0x' + CATEGORY, recipient: toTokens, amount: 100n })
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    expect(tx.outputs.filter(o => o.token)).toHaveLength(1)
  })

  it('refuses a token transfer to a plain address, more tokens than held, and one with no BCH for the fee', async () => {
    const { client, account } = await setup([coin(1, 1000, { category: CATEGORY, amount: 10n })])
    await expect(account.transfer({ token: CATEGORY, recipient: to, amount: 1n })).rejects.toThrow(/token-aware/)
    await expect(account.transfer({ token: CATEGORY, recipient: toTokens, amount: 11n })).rejects.toThrow(/Not enough of this token/)
    await expect(account.transfer({ token: CATEGORY, recipient: toTokens, amount: 5n })).rejects.toThrow(/network fee/)
    expect(client.sent).toHaveLength(0)
  })

  it('an NFT-carrying coin is never used to pay fungible tokens', async () => {
    const nft = coin(1, 1000, { category: CATEGORY, amount: 50n, nft: { capability: 'none', commitment: '01' } })
    const { account } = await setup([nft, coin(4, 20_000)])
    await expect(account.transfer({ token: CATEGORY, recipient: toTokens, amount: 10n })).rejects.toThrow(/Not enough of this token/)
  })

  it('transfers an NFT, preserving its capability, commitment and any fungible amount', async () => {
    const nft = coin(1, 1000, { category: CATEGORY, amount: 50n, nft: { capability: 'mutable', commitment: 'deadbeef' } })
    const utxos = [nft, coin(4, 20_000)]
    const { client, account } = await setup(utxos)
    const { fee } = await account.transferNft({ token: CATEGORY, commitment: 'deadbeef', recipient: toTokens })
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    // One NFT output to the recipient, unchanged, then BCH change. A plain coin funds the fee.
    const moved = tx.outputs[0]
    expect(bytesToHex(moved.token.category)).toBe(CATEGORY)
    expect(moved.token.amount).toBe(50n)
    expect(moved.token.nft.capability).toBe('mutable')
    expect(bytesToHex(moved.token.nft.commitment)).toBe('deadbeef')
    expect(moved.valueSatoshis).toBe(1000n)
    expect(tx.outputs.filter(o => o.token?.nft)).toHaveLength(1)
    expect(fee).toBeGreaterThan(0n)
  })

  it('transfers an NFT with an empty commitment and no fungible amount', async () => {
    const nft = coin(1, 1200, { category: CATEGORY, amount: 0n, nft: { capability: 'none', commitment: '' } })
    const utxos = [nft, coin(4, 20_000)]
    const { client, account } = await setup(utxos)
    await account.transferNft({ token: CATEGORY, recipient: toTokens })
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    expect(tx.outputs[0].token.nft.capability).toBe('none')
    expect(tx.outputs[0].token.nft.commitment).toHaveLength(0)
    expect(tx.outputs[0].token.amount).toBe(0n)
  })

  it('lists held NFTs, fungible amount and sats included', async () => {
    const utxos = [
      coin(1, 1000, { category: CATEGORY, amount: 50n, nft: { capability: 'mutable', commitment: 'deadbeef' } }),
      coin(2, 1000, { category: CATEGORY, amount: 9n }),         // fungible-only: not an NFT
      coin(4, 20_000)                                            // plain BCH
    ]
    const { account } = await setup(utxos)
    const held = await account.getNftHoldings()
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ category: CATEGORY, commitment: 'deadbeef', capability: 'mutable', amount: 50n, satoshis: 1000n })
    expect(held[0].txid).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses an NFT transfer to a plain address and for an NFT it does not hold', async () => {
    const utxos = [coin(1, 1000, { category: CATEGORY, amount: 0n, nft: { capability: 'none', commitment: '01' } }), coin(4, 20_000)]
    const { client, account } = await setup(utxos)
    await expect(account.transferNft({ token: CATEGORY, commitment: '01', recipient: to })).rejects.toThrow(/token-aware/)
    await expect(account.transferNft({ token: CATEGORY, commitment: 'ff', recipient: toTokens })).rejects.toThrow(/not in the wallet/)
    expect(client.sent).toHaveLength(0)
  })

  it('refuses an NFT transfer when the commitment is ambiguous', async () => {
    const two = [
      coin(1, 1000, { category: CATEGORY, amount: 0n, nft: { capability: 'none', commitment: '' } }),
      coin(2, 1000, { category: CATEGORY, amount: 0n, nft: { capability: 'none', commitment: '' } }),
      coin(4, 20_000)
    ]
    const { client, account } = await setup(two)
    await expect(account.transferNft({ token: CATEGORY, recipient: toTokens })).rejects.toThrow(/More than one/)
    expect(client.sent).toHaveLength(0)
  })

  it('refuses an NFT transfer with no BCH for the fee', async () => {
    const { account } = await setup([coin(1, 1000, { category: CATEGORY, amount: 0n, nft: { capability: 'none', commitment: '01' } })])
    await expect(account.transferNft({ token: CATEGORY, commitment: '01', recipient: toTokens })).rejects.toThrow(/Not enough Bitcoin Cash/)
  })

  it('pays a pay-to-script-hash-32 address (where a swap covenant lives)', async () => {
    const covenant = encodeCashAddress('bchtest', AddressType.P2SH, hexToBytes('77'.repeat(32)))
    const utxos = [coin(1, 50_000)]
    const { client, account } = await setup(utxos)
    await account.sendTransaction({ to: covenant, value: 20_000n })
    const { result, tx } = vmAccepts(client.sent[0], account, utxos)
    expect(result).toBe(true)
    expect(bytesToHex(tx.outputs[0].lockingBytecode)).toBe('aa20' + '77'.repeat(32) + '87')
  })

  it('refuses a recipient of the other network', async () => {
    const { account } = await setup([coin(1, 50_000)])
    await expect(account.sendTransaction({ to: 'bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2', value: 1000n })).rejects.toThrow(/chipnet/)
  })

  it('signs a transaction a dapp built, committing to every spent output', async () => {
    const utxos = [coin(1, 30_000), coin(2, 1000, { category: CATEGORY, amount: 5n })]
    const { account } = await setup(utxos)
    const lock = account._lockingBytecode
    const unsigned = encodeTransaction({
      version: 2, locktime: 0,
      inputs: utxos.map(u => ({ txid: u.txid, vout: u.vout, sequenceNumber: 0 })),
      outputs: [
        { lockingBytecode: lockingBytecodeOf(decodeCashAddress(toTokens)), valueSatoshis: 1000n, token: { category: CATEGORY, amount: 5n } },
        { lockingBytecode: lock, valueSatoshis: 29_000n }
      ]
    })
    const sourceOutputs = utxos.map(u => ({
      lockingBytecode: bytesToHex(lock), valueSatoshis: u.satoshis.toString(),
      ...(u.token ? { token: { category: u.token.category, amount: u.token.amount.toString() } } : {})
    }))
    const signed = await account.signPreparedTransaction({ transaction: bytesToHex(unsigned), sourceOutputs })
    expect(signed.signedInputs).toEqual([0, 1])
    expect(vmAccepts(signed.transaction, account, utxos).result).toBe(true)
    // SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID is the last byte of each signature.
    for (const input of decodeTransaction(hexToBytes(signed.transaction)).inputs) {
      const sigLength = input.unlockingBytecode[0]
      expect(input.unlockingBytecode[sigLength]).toBe(0x61)
    }
    // Lying about what an input spends produces a signature the network rejects.
    const lied = await account.signPreparedTransaction({ transaction: bytesToHex(unsigned), sourceOutputs: [{ ...sourceOutputs[0], valueSatoshis: '99999' }, sourceOutputs[1]] })
    expect(vmAccepts(lied.transaction, account, utxos).result).not.toBe(true)
  })

  it('does not sign inputs that are not its own', async () => {
    const { account } = await setup([])
    const foreign = '76a914' + '99'.repeat(20) + '88ac'
    const unsigned = encodeTransaction({ inputs: [{ txid: '11'.repeat(32), vout: 0 }], outputs: [{ lockingBytecode: hexToBytes(foreign), valueSatoshis: 1000n }] })
    await expect(account.signPreparedTransaction({ transaction: bytesToHex(unsigned), sourceOutputs: [{ lockingBytecode: foreign, valueSatoshis: 2000 }] })).rejects.toThrow(/None of the inputs/)
    await expect(account.signPreparedTransaction({ transaction: bytesToHex(unsigned), sourceOutputs: [] })).rejects.toThrow(/One source output/)
  })

  it.skipIf(!libauth)('broadcasts a transaction signed earlier, and reports its id', async () => {
    const utxos = [coin(1, 50_000)]
    const { account, client } = await setup(utxos)
    const hex = await account.signTransaction({ to, value: 10_000n })
    expect(client.sent).toHaveLength(0)
    const { hash } = await account.broadcastTransaction(hex.toUpperCase())
    expect(client.sent).toEqual([hex])
    expect(hash).toBe(bytesToHex(Uint8Array.from(libauthHash(hex)).reverse()))
  })

  describe('planned outputs (a Mesh genesis)', () => {
    const BIN = 'aa20' + '77'.repeat(32) + '87'
    const DATA = '6a04' + '42434d52'
    const p2pkh = 'f5bf48b397dae70be82b3cca4793f8eb2b6cdac9'
    const identity = { lockingBytecode: '76a914' + p2pkh + '88ac', valueSatoshis: '800' }

    it('spends the seed at input 0 and mints the position NFT in its category, outputs in order', async () => {
      const seed = coin(3, 5000)            // vout 3 % 3 = 0: output 0 of its transaction
      const utxos = [coin(1, 100_000), seed]
      const { client, account } = await setup(utxos)
      const own = bytesToHex(account._lockingBytecode)
      const outputs = [
        identity,
        { lockingBytecode: own, valueSatoshis: '1000', token: { category: seed.txid, amount: '0', nft: { capability: 'mutable', commitment: '01ff' } } },
        { lockingBytecode: BIN, valueSatoshis: '20000' },
        { lockingBytecode: DATA, valueSatoshis: '0' }
      ]
      await account.sendOutputs({ outputs, firstInput: { txid: seed.txid, vout: 0 } })
      const { result, tx } = vmAccepts(client.sent[0], account, utxos)
      expect(result).toBe(true)
      expect(bytesToHex(tx.inputs[0].outpointTransactionHash)).toBe(seed.txid)
      expect(tx.outputs.slice(0, 4).map(o => bytesToHex(o.lockingBytecode))).toEqual([identity.lockingBytecode, own, BIN, DATA])
      expect(bytesToHex(tx.outputs[1].token.category)).toBe(seed.txid)
      expect(tx.outputs[1].token.nft.capability).toBe('mutable')
      // BCH change comes last, to the account.
      expect(tx.outputs).toHaveLength(5)
      expect(bytesToHex(tx.outputs[4].lockingBytecode)).toBe(own)
    })

    it('takes the token deposit from the account and returns token change after the outputs', async () => {
      const seed = coin(3, 5000)
      const utxos = [seed, coin(1, 50_000), coin(4, 1000, { category: CATEGORY, amount: 500n })]
      const { client, account } = await setup(utxos)
      const outputs = [{ lockingBytecode: BIN, valueSatoshis: '1000', token: { category: CATEGORY, amount: '120' } }]
      await account.sendOutputs({ outputs, firstInput: { txid: seed.txid, vout: 0 } })
      const { result, tx } = vmAccepts(client.sent[0], account, utxos)
      expect(result).toBe(true)
      expect(tx.outputs.map(o => o.token?.amount ?? null)).toEqual([120n, 380n, null])
    })

    it('refuses what it cannot or must not do', async () => {
      const seed = coin(3, 5000)
      const tokenCoin = coin(6, 1000, { category: CATEGORY, amount: 5n })
      const { account } = await setup([seed, coin(1, 50_000), tokenCoin])
      const pay = [{ lockingBytecode: BIN, valueSatoshis: '20000' }]
      await expect(account.sendOutputs({ outputs: pay, firstInput: { txid: 'ee'.repeat(32), vout: 0 } })).rejects.toThrow(/first input/)
      await expect(account.sendOutputs({ outputs: pay, firstInput: { txid: tokenCoin.txid, vout: tokenCoin.vout } })).rejects.toThrow(/carries no token/)
      // A category the seed does not create, and more tokens than held.
      await expect(account.sendOutputs({ outputs: [{ lockingBytecode: BIN, valueSatoshis: '1000', token: { category: OTHER, amount: '1' } }] })).rejects.toThrow(/Not enough/)
      await expect(account.sendOutputs({ outputs: [{ lockingBytecode: BIN, valueSatoshis: '1000', token: { category: CATEGORY, amount: '6' } }] })).rejects.toThrow(/Not enough/)
      await expect(account.sendOutputs({ outputs: [{ lockingBytecode: BIN, valueSatoshis: '1000', token: { category: CATEGORY, amount: '0', nft: { capability: 'none', commitment: '' } } }] })).rejects.toThrow(/NFT/)
      await expect(account.sendOutputs({ outputs: [{ lockingBytecode: BIN, valueSatoshis: '100' }] })).rejects.toThrow(/less than/)
      await expect(account.sendOutputs({ outputs: [{ lockingBytecode: DATA, valueSatoshis: '5' }] })).rejects.toThrow(/data output/)
      await expect(account.sendOutputs({ outputs: [{ lockingBytecode: BIN, valueSatoshis: '9000000' }] })).rejects.toThrow(/Not enough Bitcoin Cash/)
      await expect(account.sendOutputs({ outputs: [] })).rejects.toThrow(/no outputs/)
    })

    it('quotes the fee without sending', async () => {
      const { client, account } = await setup([coin(1, 50_000)])
      const { fee } = await account.quoteOutputs({ outputs: [{ lockingBytecode: BIN, valueSatoshis: '20000' }] })
      expect(fee > 0n && fee < 1000n).toBe(true)
      expect(client.sent).toHaveLength(0)
    })
  })

  it('a disposed account cannot sign', async () => {
    const { account } = await setup([coin(1, 50_000)])
    account.dispose()
    await expect(account.sign('x')).rejects.toThrow(/disposed/)
    await expect(account.sendTransaction({ to, value: 1000n })).rejects.toThrow(/disposed/)
    expect(account.keyPair.privateKey).toBeNull()
  })
})

describe('transaction encoding', () => {
  it.skipIf(!libauth)('decodes and re-encodes to the same bytes, and agrees with libauth', async () => {
    const utxos = [coin(1, 1000, { category: CATEGORY, amount: 100n }), coin(4, 20_000)]
    const client = fakeClient(utxos)
    const account = await new WalletManagerBch(PHRASE, { network: 'chipnet', client }).getAccount(0)
    const toTokens = encodeCashAddress('bchtest', AddressType.P2PKH_TOKENS, hexToBytes('f5bf48b397dae70be82b3cca4793f8eb2b6cdac9'))
    await account.transfer({ token: CATEGORY, recipient: toTokens, amount: 30n })
    const hex = client.sent[0]
    expect(bytesToHex(encodeTransaction(decodeTransaction(hexToBytes(hex))))).toBe(hex)
    expect(bytesToHex(libauth.encodeTransaction(libauth.decodeTransaction(hexToBytes(hex))))).toBe(hex)
  })

  it('refuses truncated and padded input', () => {
    const tx = bytesToHex(encodeTransaction({ inputs: [{ txid: '11'.repeat(32), vout: 0 }], outputs: [{ lockingBytecode: hexToBytes('6a'), valueSatoshis: 0n }] }))
    expect(() => decodeTransaction(hexToBytes(tx.slice(0, -4)))).toThrow()
    expect(() => decodeTransaction(hexToBytes(tx + '00'))).toThrow(/trailing/)
  })
})
