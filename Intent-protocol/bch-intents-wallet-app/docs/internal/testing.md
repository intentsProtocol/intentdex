# Testing: what is verified, and what is not

A wallet's documentation should not claim more than was checked. This page separates the two.

## Verified by automated checks

Run them with:

```bash
npm run typecheck
npm test
npm run sync:check
npx bare scripts/bare-smoke.cjs      # needs network access
```

### Unit tests (`npm test`, 40 tests)

| File | Covers |
|---|---|
| `tests/logic.test.ts` | `wdk.config.js` names a module for every network of the chain table and nothing else. EVM fee rules, including Arc's floor. What a scanned code is: cashaddr with checksum and network, EVM (EIP-55, EIP-681), Solana, Bitcoin, WalletConnect. Settings fall back field by field. The PIN: format, weak PINs, stored as a salted hash, attempt counting and escalating waits. Activity merge. |
| `tests/connect.test.ts` | WalletConnect: which chains a session gets per mode, refusal of unsupported chains and methods, account mismatch, `personal_sign` in both argument orders, typed data, transactions, chain switch, Solana and BCH messages. Strict UTF-8 decoding, compared with the platform decoder on edge cases and random bytes. Bitcoin Cash sign requests: libauth's tagged JSON, which inputs are ours, amounts spent and returned, byte-for-byte agreement with the wallet module's encoder, refusal of contract inputs. |

### The shared package (`../bch-intents-wallet-core`, 94 tests)

The agent (`tests/agent.test.ts`): amounts in words and numbers; Mesh strategy plans on the server's grid rules
(only buying bins for accumulate, only selling for take-profit, both around the market for range, refusal of a
budget too small for its bins); loan maths; every tool on a sample snapshot, including the refusals (unknown
token, too much, same token, no route); the turn loop with a scripted model (tool call → card without a second
pass, think tags dropped, a failing model, an invented tool ignored); chat windows and summaries.

Mesh creation (`tests/mesh-plan.test.ts`): the bin covenant encoder against the audited contracts' vectors, byte
for byte; `verifyPlan` accepts the Mesh server planner's own plan and refuses tampered copies (NFT elsewhere,
minting NFT, a bin address that is not its parameters, an off-grid price, more than the deposit, a fat identity
output, a forged metadata output, a bin funded twice or not at all, a manager nobody asked for).


The swap flows the app runs: every hash is written to the journal before its transaction is broadcast; the fee goes last; a burn the server was not told about is reported on resume and never signed twice. Hand-written ABI encoding and the transaction hash match ethers. The Solana wire format matches `@solana/web3.js` for legacy and v0 transactions.

### The Bitcoin Cash module (`../wdk-wallet-bch`, 43 tests)

`sendOutputs` (a Mesh genesis): libauth's virtual machine accepts a transaction that spends the seed at input 0
and mints the position NFT in the seed's category, with the planned outputs in order and change last; token
deposits come from the account's coins; NFT coins, unknown categories and dust are refused.

Addresses match mainnet-js. Signed transactions are accepted by libauth's virtual machine. Message signatures are byte-equal to mainnet-js. The Electrum client works over both kinds of socket: the W3C one and the stream that Bare provides.

### Under the Bare runtime (`scripts/bare-smoke.cjs`)

Each of the four wallet modules is loaded the way the worklet loads it, on a desktop build of the same runtime the phone uses. For the public Hardhat test phrase it derives account 0, signs a message, and reads the balance from a live testnet:

```
ok   bch-chipnet    bchtest:qztxr3rvj3cqktxgjygfll7r5jdjd50h3clhvqfvg0   (and its CashTokens)
ok   base-sepolia   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ok   solana-devnet  oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96
ok   btc-testnet    tb1qquv9lg5g2r4jkr0ahun0ddfg5xntxjelvmc7t8
```

The EVM address is the one MetaMask derives for that phrase. This run is what shows the Bitcoin Cash module works over Bare's WebSocket against a real Fulcrum server.

### Build

- The worklet bundle builds with all four modules (`npm run bundle:worklet`, about 10 MB).
- The JavaScript bundles for Android with Metro (`npx expo export --platform android`).

## Not verified

None of the following has been exercised. Each is a thing to check on the first device build.

### On a device

- [ ] The app starts, the worklet starts, and the welcome screen shows
- [ ] Create a wallet: phrase shown, three-word check, PIN set, wallet opens
- [ ] Import the Hardhat test phrase: the four addresses equal the ones above
- [ ] Lock and unlock with the PIN; five wrong PINs start the wait
- [ ] Biometric unlock, and whether the phone asks once or twice
- [ ] Auto-lock after the chosen time in the background
- [ ] Balances load for each family; pull to refresh
- [ ] Receive: the QR code scans from another phone
- [ ] Scanner: camera permission, an address, a WalletConnect code
- [ ] Send on chipnet, Sepolia, devnet and Bitcoin testnet
- [ ] Light and dark themes; language switch
- [ ] The glass surfaces, the tab bar and Cham's animations look right
- [ ] The recovery phrase screen is blank in the app switcher and screenshots

### Money paths

- **No send has been broadcast from this app**, on any chain.
- **No swap has been run end to end** from the app or the extension. The flows are tested against a stand-in server, and the clients against the real servers' response shapes only as far as the extension's tests go.
- **No WalletConnect session has been made** with a real dapp. The request handling is tested; the client library has only been bundled.

### Platforms

- iOS: not built.
- Android below API 29 is not supported by the build settings.

## The agent on a device

Checked by a local `expo prebuild`: QVAC's worker bundles with only the llama.cpp plugin, and the addons folder
holds both workers' libraries (42 files from QVAC, then the 20 the WDK worklet bundle records).

Not yet checked on the phone at the time of writing: the model download, load (GPU or CPU fallback), tool calling
quality on real requests, speed, memory beside the WDK worklet, the notification path, and a Mesh genesis on
chipnet through the phone. Record the results here.
