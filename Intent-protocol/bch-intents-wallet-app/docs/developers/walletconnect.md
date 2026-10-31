# Connecting a dapp to the wallet

The wallet speaks WalletConnect v2. A dapp shows a pairing code; the user scans it; the dapp can then request signatures, and the user approves each one in the wallet.

## Namespaces

| Namespace | Chains | Methods |
|---|---|---|
| `eip155` | testnet mode: `eip155:11155111`, `84532`, `421614`, `11155420`, `5042002` · mainnet mode: `1`, `8453`, `42161`, `10`, `5042` | `personal_sign`, `eth_signTypedData_v4`, `eth_signTypedData`, `eth_sendTransaction`, `wallet_switchEthereumChain` |
| `solana` | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet), `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet) | `solana_signMessage`, `solana_signTransaction` |
| `bch` | `bch:bchtest` (chipnet), `bch:bitcoincash` (mainnet) | `bch_getAddresses`, `bch_signMessage`, `bch_signTransaction` |

The wallet is in one mode at a time and offers that mode's chains only. A proposal that *requires* a chain or a method outside this table is refused, and the user is told which. Put chains you can live without under `optionalNamespaces`.

The session gets the active account's address on each approved chain. When the user switches account or mode the wallet updates the session, or ends it if none of its chains exist in the new mode.

## EVM

- **`personal_sign`** `[message, address]`. The message is a UTF-8 string or `0x` hex of UTF-8 bytes. Bytes that are not text are refused. The result is an EIP-191 signature.
- **`eth_signTypedData_v4`** `[address, typedDataJson]`. EIP-712.
- **`eth_sendTransaction`** `[{ from, to, data?, value? }]`. The wallet sets nonce, gas and fees itself and ignores any the dapp sends. It estimates gas first, so a transaction that would revert is refused before it is signed. `to` is required. The result is the transaction hash.
- **`wallet_switchEthereumChain`** succeeds for a chain in the session's mode. The wallet has no "current chain": every request names its own.
- `eth_sign` is not offered.

`from` and the address argument must be the session's account, or the request is refused.

## Solana

- **`solana_signMessage`** `{ message, pubkey }`, with `message` base58. It must decode to UTF-8 text. Result: `{ signature }`, base58.
- **`solana_signTransaction`** `{ transaction }`, base64 of a legacy or v0 transaction whose fee payer is the wallet's account. Result: `{ signature, transaction }`: the fee payer's signature in base58 and the fully signed transaction in base64. The wallet does not broadcast; the dapp does.

## Bitcoin Cash

The `bch` namespace follows the wc2-bch-bcr convention used by Cashonize, Paytaca and CashScript.

- **`bch_getAddresses`** → `[cashaddr]`. Answered without a prompt.
- **`bch_signMessage`** `{ message }` → a Bitcoin signed message, base64.
- **`bch_signTransaction`** `{ transaction, sourceOutputs, broadcast?, userPrompt? }` → `{ signedTransaction, signedTransactionHash }`.

`transaction` is hex, or a libauth transaction object as `stringify` writes it (`"<Uint8Array: 0x…>"`, `"<bigint: 1n>"`). `sourceOutputs` has one entry per input: the output it spends, with `lockingBytecode`, `valueSatoshis` and `token` if any.

The wallet signs every input whose source output is locked to its own P2PKH address, with `SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID` (`0x61`), and leaves the other inputs as they are. It shows the user how much leaves the wallet and each output. With `broadcast: true` it also sends the transaction.

Not supported: a contract input that expects the wallet's public key or signature inside its unlocking script (the zero-filled placeholders). Such a request is refused as a whole.

## Errors

| Code | Meaning |
|---|---|
| `5000` | The user rejected the request |
| `5101` | The method, chain or account is not supported |

## Testing your dapp

1. Put the wallet in the mode your dapp targets (testnet by default).
2. Scan the pairing code from **Settings → Connected apps**, or paste the `wc:` link there.
3. Watch **Activity** in the wallet: connections and signatures are recorded with the dapp's host.
