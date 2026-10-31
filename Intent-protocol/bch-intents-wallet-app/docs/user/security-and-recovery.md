# Security and recovery

This wallet is **self-custodial**: your keys are created on your phone and never leave it. There is no account, no server holding a copy, and no support desk that can let you back in. That is what makes the funds yours, and it puts two things in your hands.

## The recovery phrase

12 words (or 24, if you imported one) that *are* your wallet. Every account on every chain is derived from them.

- **Anyone who has the phrase has your funds.** Never type it into a website, a chat or an email. Nobody from this project will ever ask for it.
- **Without the phrase, a lost phone or a forgotten PIN means lost funds.**

Write it on paper and keep the paper somewhere only you can reach. A photo or a note in a cloud app is not a safe backup. The wallet blocks screenshots of the phrase for that reason.

### See it again, or finish backing up

**Settings → Recovery phrase.** The wallet asks for your PIN, then lets you reveal the words. Tap **I have written it down** to clear the reminder on the Wallet tab.

## The PIN

The PIN opens the wallet **on this phone**.

- It is not your recovery phrase, and it does not travel with you: another phone asks you to choose a new one.
- It cannot be recovered or reset by anyone.
- After five wrong tries the wallet makes you wait before the next one, and longer each time.
- Change it in **Settings → Change PIN**. Your addresses and phrase stay the same.

Your phone's own lock matters too. The recovery phrase is stored in the phone's secure keychain, which is only as strong as the phone's screen lock. Use one.

### If you forget the PIN

Tap **Forgot your PIN?** on the unlock screen. The only way back in is to remove the wallet from this phone and import it again **with your recovery phrase**, choosing a new PIN. If you do not have the phrase, do not remove the wallet: keep trying to remember the PIN, because removing it deletes the only copy.

## Fingerprint and face unlock

**Settings → Biometric unlock.** The wallet asks your phone to check your fingerprint or face; it never sees them itself. The PIN keeps working, so a finger that will not scan does not lock you out. Anyone whose fingerprint is enrolled on the phone can open the wallet this way.

## Locking

- The wallet locks after it has been in the background for the time you choose in **Settings → Auto-lock**: at once, or after 1, 5, 15 or 60 minutes. The default is 5.
- Lock it at once with the padlock at the top of the Wallet tab, or **Settings → Lock wallet**.

While locked, nothing can be signed and connected apps get no answer.

## Restoring your wallet

On a new phone: install the wallet, choose **I already have a recovery phrase**, enter the words and choose a PIN.

- Your balances reappear, because they live on the blockchains, not in the wallet.
- Additional accounts are restored by tapping **Add account** until they are back, in the order you created them.
- Account names, connected apps, hidden tokens and the activity list are stored on the phone and are not restored.

The phrase also works in other wallets: the BCH Intents browser extension, MetaMask for Ethereum-family networks, Phantom for Solana. For Bitcoin Cash, Electron Cash needs the derivation path set to `m/44'/0'/0'` to show the same address.

## Removing the wallet

**Settings → Remove wallet** deletes the wallet, its accounts, connected apps and activity from this phone, after asking for your PIN and a typed confirmation. The funds stay on the blockchains; only the recovery phrase reaches them again.

## Staying safe

- **Check the app's name and address** on every approval sheet. Fake sites copy real ones exactly.
- **Check the network button.** Mainnet is real money.
- **Be wary of tokens you did not expect.** A token that appears in your wallet uninvited, or one marked *unverified*, may be bait. Hide it from its detail screen.
- **Start small on mainnet.** This is alpha software and has not been audited.
- **Keep your phone updated**, and do not install the wallet on a rooted or jailbroken phone.

## What the wallet stores, and where

| What | Where | Protected by |
|---|---|---|
| Recovery phrase | The phone's secure keychain | The phone's hardware and screen lock |
| PIN | The phone's secure store, as a salted hash | Never stored as digits |
| Settings, account names, connected apps, activity | App storage on this phone | Not secret |

The swap services the wallet talks to receive your public addresses and the trades you ask for. They never receive keys: every transaction is signed in the wallet.
