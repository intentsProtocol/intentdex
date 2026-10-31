# Using the wallet

## Receive

**Receive** shows your address as a QR code and as text. Pick the chain at the top: BCH, EVM, Solana or BTC.

- **Bitcoin Cash** has two forms of the same address. Use *BCH address* for Bitcoin Cash and *CashToken address* (it starts with `z`) for CashTokens.
- **EVM** is one address for every Ethereum-family network the wallet supports. Make sure the sender uses one of the networks listed.
- **Copy** puts the address on the clipboard; **Share** sends it through any app.

On testnet the screen says so. A testnet address must not be given to someone sending real funds.

## Send

1. **Send**, then choose the asset.
2. Enter the recipient: type it, **paste** it, or **scan** its QR code.
3. Enter the amount, or tap **MAX** to send everything the fee allows.
4. **Review**: check the amount, the address and the network.
5. **Confirm and send.**

The wallet checks the address belongs to the asset's network before it lets you continue, and tells you when the address is one of your own. A sent transaction cannot be recalled.

To send a token you need a little of the network's own coin for the fee: ETH for USDC on Base, SOL for a Solana token, BCH for a CashToken. On Arc the fee is paid in USDC.

## Scan

The scanner reads two things:

- **An address or payment link.** It opens Send with the address filled in. For an Ethereum-family address the wallet asks which network, because the same address exists on all of them.
- **A WalletConnect code.** It starts connecting to the app that showed it.

If the camera is not available, **Paste from clipboard** does the same.

## Swap

The Swap tab has one card. Pick what you pay with and what you receive; the wallet chooses the service by the pair:

| You swap | How |
|---|---|
| BCH and CashTokens | A short Dutch auction: a solver fills your order at or near the quoted amount, or your funds return. |
| USDC on one chain to USDC on another | Circle's CCTP bridge. |
| Solana tokens (mainnet) | Jupiter. |

A pair the wallet cannot swap disables the button and says why. Before you confirm, the card shows what you receive, the fees and how long it takes.

After you confirm, a sheet shows each step. You can leave it: the swap continues, and **Activity** follows it. If a bridge transfer was interrupted, open its row in Activity and tap **Resume this transfer** or **Pay the service fee**.

## NFTs and liquidity positions

The Wallet tab shows the CashToken NFTs this account holds, in two places:

- **Collectibles** — one row per NFT category, with its name and icon from its registry (BCMR). Tap to see a single NFT, or open a category that holds several.
- **Liquidity positions** — Mesh V4 positions. Each position *is* an NFT: whoever holds it controls the position's bins. The card shows the shape, the price range, the bin step, how many bins hold funds, and the value at the bids. On mainnet that value is added to your portfolio total.

A position renders from the NFT alone, so it still shows its range and step when the Mesh server cannot be reached — only the live value and bins wait for the server.

Open an NFT and tap **Send** to transfer it. The recipient must be a *CashToken address* (it starts with `z`). Sending a position NFT hands over the funds it controls and **cannot be undone**, so the review step repeats the warning and the position's current value.

To receive an NFT, share your *CashToken address* from **Receive** — the same address CashTokens arrive at.

## Connect to an app

**Settings → Connected apps**, or the scanner. Scan the WalletConnect code an app or site shows you (or paste its link). The wallet shows which app is asking and which networks it wants; approve to connect.

From then on the app can ask you to sign a message or a transaction. Every request appears as a sheet with the app's name, the network and what is asked. Nothing is signed until you approve.

- Check the app's address on every request.
- **Disconnect** an app in *Connected apps* when you are done with it.
- Switching account or network mode tells connected apps about the change.

## Accounts

Tap the account name on the Wallet tab. **Add account** gives you another account from the same recovery phrase; there is nothing new to back up. Tap the pencil to rename one.

## Activity

Everything this account sent, swapped, bridged and signed, and for Bitcoin Cash and Bitcoin also what it received. Tap a row for details and a link to the block explorer. Pull down to refresh.

## Settings

| Setting | What it does |
|---|---|
| Theme | Auto follows the phone; or always light or dark. |
| Language | English or 简体中文. |
| Trading defaults | Slippage for Solana swaps, and the auction length for Bitcoin Cash swaps. |
| Networks | Testnet or mainnet, and the list of networks in that mode. |
| Services | Whether the swap services this build uses can be reached. |
| Addresses | The active account's address on each chain, with its derivation path. |
| Hidden tokens | Tokens you hid from the Wallet tab; show them again here. |
| Biometric unlock | Open the wallet with your fingerprint or face. |
| Auto-lock | How long the wallet may stay in the background before it locks. |
| Recovery phrase | See the phrase again, after your PIN. |
| Change PIN | |
| Remove wallet | Deletes the wallet from this phone. |
