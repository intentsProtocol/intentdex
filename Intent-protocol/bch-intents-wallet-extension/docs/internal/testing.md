# Testing: what is verified and what is not

Last full run: 2026-10-09, on the `alpha` branch. Typecheck clean, 63 unit tests, production build, 47 end-to-end tests, all passing.

How to run them: [`../developers/building-and-testing.md`](../developers/building-and-testing.md).

## Verified by automated tests

### Unit (`tests/unit/`, 63 tests)

| Area | What is checked |
|---|---|
| Amounts | Parse and format round-trip without floating point; refuses non-decimals and too many fraction digits; a non-zero balance never displays as zero; display cuts rather than rounds up |
| Settings | Defaults; a damaged record falls back field by field; a patch persists and keeps the rest |
| Translations | Chinese has exactly the English keys and placeholders; nothing empty; no unused key |
| Swap routing | Which product a pair goes to; closed routes; cross-product pairs never fall through to an executor; a server on the wrong network contributes nothing; Arc's 18-decimal USDC counted as 6; stocks filtered out |
| Network table | Every row has explorers, and EVM rows a chain id, HTTPS RPC and USDC address; both modes cover all four families |
| Address validation | Each chain refuses the others' addresses; BCH refuses the other network's prefix; CashTokens need a token-aware address |
| Activity log | Order, in-place update, cap at 200 |
| Dapp store | Connect and disconnect; a wrongly shaped record reads as empty; abandoned requests expire |
| Signing journal | An entry is on disk when `set()` resolves; survives reload; expires after a day |
| Relayer client | Request shape; errors carry the relayer's sentence; unreachable is reported as such; a BCH sale funds the covenant address with exactly the sell amount; nothing is signed when no order comes back |
| Swap server client | Error codes; decimal-USDC query shape |
| Bitcoin client | Balance, coins and fee estimates mapped to what WDK expects |

### End-to-end (`tests/e2e/`, 47 tests, real Chromium with the built extension)

**Wallet (12)**
- An invalid phrase is refused before a password is asked.
- Create: password mismatch blocks; phrase hidden until revealed; wrong backup words refused; right ones create the wallet.
- After creation, local storage holds the encrypted wallet and neither the phrase nor the password.
- Lock removes the session seed; a wrong password shows an error; the right one unlocks.
- Remove wallet needs the password and a typed confirmation.
- Importing the Hardhat test phrase gives `0xf39F…2266` for EVM (MetaMask's address for it), a `bchtest:q…` address, a `tb1q…` address and a Solana address.
- Theme and language apply at once and survive a reload.
- Trading defaults, auto-lock and hide-balances persist.
- The recovery phrase needs the password again.
- Changing the password makes the old one stop working.
- Adding an account gives different addresses; switching back restores the first.
- Mainnet asks for confirmation; BCH and BTC addresses change format with it.
- Receive shows a real QR code and the right address per chain.
- The popup is 360 × 600; the panel fills its window.

**Dapp pipeline (17)**, with a real page on `http://localhost:4173`
- The provider is injected, frozen, and answers read-only calls without a prompt.
- An unconnected site gets no account and 4100 for signing and balance; an unknown method gets 4200.
- Rejecting, and closing the approval window, both give 4001.
- Approving returns the address and fires `accountsChanged` and `connect`.
- A connected site gets its account back with no prompt, also after a reload.
- A message is signed for real: a 65-byte signature comes back. Hex input is decoded for display.
- A send request shows the amount and recipient and cannot be approved without funds; one to the other network is blocked; malformed parameters never reach a signature.
- Two requests sent together are both shown, in order.
- A locked wallet asks for the password, then shows the request.
- Disconnecting in settings fires `accountsChanged` and `disconnect` on the page, and the site then gets 4100.
- Connections and signatures appear in Activity.

**Signing on every chain (9)**, through the provider, each signature checked outside the wallet
- `wallet_getAddresses` returns one address per chain in its standard form.
- EVM: `ethers.verifyMessage` recovers MetaMask's address for the test phrase.
- Solana: the signature verifies as ed25519 against the address, and fails for a different message.
- Bitcoin: `bitcoinjs-message` verifies the signature against the `tb1q` address, and rejects a different message.
- Bitcoin Cash: a 65-byte signature, identical from `wallet_signMessage` and `personal_sign`. Its validity against the address is not checked by a second library here.
- An unknown chain is refused before any key is used.
- `wallet_sendTransaction` shows the asset, amount, network and recipient; blocks an amount the account cannot pay, a recipient of another chain, and a network of the other mode.
- The second account is `0x7099…79C8`, the address MetaMask derives as Account 2, and a connected site sees the switch.

**Swap card (9)**, with both services mocked at the network layer
- Opens on BCH against a CashToken; the relayer is asked with the right body; the auction floor is shown.
- An empty wallet cannot submit and the button says why.
- A too-small amount is explained, not quoted as zero.
- Picking bridge USDC moves the other side to USDC on another chain and asks the swap server.
- The server's refusal is shown in its own words.
- A closed route is named as closed.
- With the swap server down, BCH swaps still quote and the outage is stated.
- Settings → Services reports reachability.

### Bugs these tests found

Each was real and is fixed:

1. **Solana and Bitcoin did not derive at all** (`sodium_memzero is not a function`). WDK needs `sodium-native` aliased to `sodium-javascript` in a browser build.
2. **A wrong password showed no error**: the app's loading screen replaced the unlock screen mid-attempt.
3. **Two simultaneous dapp requests lost the first**: unsynchronised read-then-write of the queue.
4. **Bitcoin message signing threw** (`Cannot read properties of undefined (reading 'call')`). WDK's Bitcoin stack needs Node's `stream` and `events`, which the build left empty. Polyfilled for the wallet page. This very likely affected Bitcoin sends as well; a send has still not been run.

## Verified by hand

- Loading the extension in Chrome and using it on chipnet, by the project owner. Reported as working; this was before fixes 1 and 3, so Solana and Bitcoin were not part of it.
- Balances: an end-to-end debug run with the public test phrase showed real testnet balances for BCH, a CashToken, and ETH and USDC across the EVM testnets, so those readers work against live endpoints.

## Not verified

Nothing below has been run. Each needs funds, running services, or both.

| What | Needs |
|---|---|
| **Any swap signed and settled from the extension** (BCH, bridge, Solana) | The two services running, a funded wallet |
| Interrupted bridge: pay-fee and resume from Activity | A real transfer stopped halfway |
| Sending ETH, ERC-20 USDC, USDC on Arc | Testnet gas and USDC |
| Sending SOL and an SPL token, including to a recipient without a token account | Devnet SOL and a token |
| **Sending BTC.** The Esplora client is unit-tested and message signing now works; WDK building, signing and broadcasting a transaction has never run. | Testnet BTC |
| `wallet_sendTransaction` approved and broadcast, on any chain | Funds. The tests stop at the approval screen: the test phrase holds public testnet funds and no test spends them. |
| Sending a CashToken from the Send screen | A CashToken on chipnet |
| A dapp send that broadcasts | Chipnet BCH |
| Solana and Bitcoin balances against live endpoints | Reload after fix 1; funds to see a non-zero value |
| Mainnet anything | Real funds |
| The side panel itself, and the toolbar icon switching between panel and popup | A person: Playwright opens the same document in a tab, not in Chrome's side panel |
| First-install opening the onboarding tab | A fresh manual install |
| Auto-lock by the service worker's alarm with no view open | Waiting out the timer |
| Light theme, and Chinese, on every screen | A visual pass. Tests check they switch, not that each screen looks right. |
| Narrow panel widths (320 to 360) | A visual pass |
| Browsers other than Chromium | Not built for |

## Suggested order for a funded test session

1. Reload the extension. Check SOL and BTC rows and Receive addresses appear.
2. Faucet tBCH; send BCH to yourself; send from `test-extension.html`.
3. Start the cashtoken relayer; swap a little BCH for a token; watch it fill. Swap a tiny amount with a 5-second auction and confirm the refund path.
4. Faucet USDC and gas on Base Sepolia; send USDC; start `cctp-swap-server`; bridge to Arbitrum Sepolia.
5. Bridge again and close the wallet right after "Send USDC"; reopen and finish from Activity.
6. Devnet SOL: send. Testnet BTC: send.
7. Mainnet with small amounts, including one Solana swap.
