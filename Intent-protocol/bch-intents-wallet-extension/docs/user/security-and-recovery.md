# Security and recovery

This wallet is **self-custodial**: your keys are created on your device and never leave it. There is no account, no server holding a copy, and no support desk that can let you back in. That is what makes the funds yours, and it puts two things in your hands.

## The recovery phrase

12 words (or 24, if you imported one) that *are* your wallet. Every account on every chain is derived from them.

- **Anyone who has the phrase has your funds.** Never type it into a website, a chat or an email. Nobody from this project will ever ask for it.
- **Without the phrase, a lost device or a forgotten password means lost funds.**

Write it on paper and keep the paper somewhere only you can reach. A screenshot, a photo or a note in a cloud app is not a safe backup.

### See it again, or finish backing up

**Settings → Recovery phrase.** The wallet asks for your password, then lets you reveal the words. Click **I have written it down** to clear the reminder on the home screen.

## The password

The password protects the wallet **on this device**. It encrypts the recovery phrase where it is stored in the browser.

- It is not your recovery phrase, and it does not travel with you: another device asks you to choose a new one.
- It cannot be recovered or reset by anyone.
- Change it in **Settings → Change password**. Your addresses and phrase stay the same.

### If you forget the password

Click **Forgot password?** on the unlock screen. The only way back in is to remove the wallet from this browser and import it again **with your recovery phrase**, choosing a new password. If you do not have the phrase, do not remove the wallet: keep trying to remember the password, because removing it deletes the only copy.

## Locking

- The wallet locks itself after a period without activity: 15 minutes by default. Change it in **Settings → Auto-lock** (5, 15, 30 or 60 minutes).
- Lock it at once with the padlock at the top of the wallet, or **Settings → Lock wallet**.
- Closing the browser locks it.

While locked, nothing can be signed. Connected sites can still see your address, as it is public information.

## Restoring your wallet

On a new device or browser: install the wallet, choose **I already have a recovery phrase**, enter the words and set a password.

- Your balances reappear, because they live on the blockchains, not in the wallet.
- Additional accounts are restored by clicking **Add account** until they are back, in the order you created them.
- Account names, connected sites, hidden tokens and the activity list are stored in the browser and are not restored.

The phrase also works in other wallets: MetaMask for Ethereum-family networks, Phantom for Solana. For Bitcoin Cash, Electron Cash needs the derivation path set to `m/44'/0'/0'` to show the same address.

## Removing the wallet

**Settings → Remove wallet** deletes the wallet, its accounts, connected sites and activity from this browser, after asking for your password and a typed confirmation. The funds stay on the blockchains; only the recovery phrase reaches them again.

## Staying safe

- **Check the site name** on every approval screen. Fake sites copy real ones exactly.
- **Check the network pill.** Mainnet is real money.
- **Be wary of tokens you did not expect.** A token that appears in your wallet uninvited, or one marked *unverified*, may be bait. The wallet warns you; hide it from its detail sheet.
- **Start small on mainnet.** This is alpha software and has not been audited.
- **Keep your browser and computer clean.** A wallet cannot protect keys on a device that is already compromised.

## What the wallet stores, and where

| What | Where | Protected by |
|---|---|---|
| Recovery phrase | In the browser, on this device | Encrypted with your password |
| Recovery phrase while unlocked | In the browser's memory | Cleared on lock and when the browser closes |
| Settings, account names, connected sites, activity | In the browser, on this device | Not secret |

The swap services the wallet talks to receive your public addresses and the trades you ask for. They never receive keys: every transaction is signed in the wallet.
