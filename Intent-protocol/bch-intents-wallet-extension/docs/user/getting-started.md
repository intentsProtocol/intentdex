# Getting started

BCH Intents Wallet is a self-custodial wallet for your browser. One recovery phrase gives you addresses on Bitcoin Cash, Ethereum and its networks, Solana and Bitcoin. Nobody else holds your keys, which also means nobody else can restore them: please read [Security and recovery](security-and-recovery.md) before you put real money in.

> **Alpha software.** The wallet has not been audited. Use testnet freely. On mainnet, use amounts you could afford to lose.

## Install

The alpha is installed by hand in Chrome (or another Chromium browser: Brave, Edge, Arc).

1. Get the wallet's `dist` folder (from a release, or by building it: see the [developer guide](../developers/building-and-testing.md)).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `dist` folder.

A tab opens with the welcome screen. Click the puzzle-piece icon in the toolbar and pin **BCH Intents Wallet** so its icon is always there.

## Create a new wallet

1. **Create a new wallet.**
2. **Choose a password.** It unlocks the wallet on this device. At least 8 characters; the bar shows how strong it is. Tick the box to confirm you understand it cannot be recovered.
3. **Write down your recovery phrase.** Tap to reveal the 12 words and write them on paper, in order. This is the only backup of your wallet.
4. **Check your backup.** Type the three words the wallet asks for. If you would rather do this later, choose *Skip for now*: the wallet works, and a reminder stays on the home screen until you back up.
5. **Open wallet.**

## Import a wallet you already have

1. **I already have a recovery phrase.**
2. Type or paste your 12 or 24 words. The wallet checks the phrase before going further.
3. Choose a password for this device.

The same phrase gives the same addresses here as in MetaMask (Ethereum) and Phantom (Solana), and the same Bitcoin Cash address as the BCH Intents web app.

## Where the wallet opens

Clicking the toolbar icon opens the wallet **docked at the side of the browser**, so it stays in view while you use a site. If you prefer the classic small popup, change **Settings → Open wallet as**.

## A first look

| Area | What it is |
|---|---|
| **Account** (top left) | Your current account. Click it to switch, rename or add accounts. |
| **Network** (top right) | *Testnet* or *Mainnet*. Click to switch. New wallets start on testnet. |
| **Lock** (top right) | Locks the wallet now. |
| **Portfolio card** | Your balance, the four chains, and Send, Receive, Swap. |
| **Tokens** | Everything this account holds. Click a token for details and actions. |
| **Bottom bar** | Wallet, Swap, Activity, Settings. |

## Try it on testnet

New wallets start on testnet, where coins are free and worth nothing. The home screen links to faucets while the wallet is empty:

- **tBCH** for Bitcoin Cash chipnet
- **USDC** on the Ethereum test networks (Circle's faucet)
- **SOL** on Solana devnet
- **BTC** on Bitcoin testnet

Get some, then try [sending](send-and-receive.md) and [swapping](swaps.md). When you are comfortable, switch to mainnet from the network pill.

## Meet Cham

The chameleon is Cham. Its eye follows your pointer, it looks away while you type a password, and it takes the colour of the chain you are working with.
