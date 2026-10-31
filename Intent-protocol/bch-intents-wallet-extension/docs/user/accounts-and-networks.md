# Accounts and networks

## Accounts

An account is a set of addresses, one per chain, that belong together. You can have as many as you like, and they all come from your one recovery phrase: restoring the phrase restores every account.

Click your account name (top left) to:

- **Switch** to another account: click its row.
- **Rename** one: click the pencil next to its name.
- **See its addresses**: click *Addresses* on its row. Addresses of an account you have not opened yet appear after you switch to it once.
- **Add account**: creates the next one.

Balances, activity and connected sites' view of your address all follow the active account.

Accounts line up with the usual wallet for each chain: your second account here is **Account 2 in MetaMask** and the second account in **Phantom**.

Bitcoin Cash is the exception. Your BCH address here is the same as in the BCH Intents web app, but it is **not** the address Electron Cash shows for the same phrase by default. To reach it from Electron Cash, restore the phrase there with the derivation path `m/44'/0'/0'`.

## Networks

The wallet has one switch: **Testnet** or **Mainnet**. Every chain follows it.

| Chain | Testnet | Mainnet |
|---|---|---|
| Bitcoin Cash | Chipnet | Bitcoin Cash |
| Ethereum | Sepolia | Ethereum |
| Base | Base Sepolia | Base |
| Arbitrum | Arbitrum Sepolia | Arbitrum |
| Optimism | OP Sepolia | OP Mainnet |
| Arc | Arc Testnet | Arc |
| Solana | Devnet | Solana |
| Bitcoin | Testnet | Bitcoin |

To switch, click the network pill (top right) or use **Settings → Mode**. Switching to mainnet asks you to confirm, because mainnet uses real money.

### What you will see on each

- **Testnet:** balances are shown as amounts, with no dollar value. The funds are free and worthless, which is the point.
- **Mainnet:** balances are shown in US dollars, with the amount underneath.

### Your addresses

- On **Ethereum-family networks** your address is the same everywhere, testnet or mainnet.
- On **Solana** it is the same on devnet and mainnet.
- On **Bitcoin Cash** and **Bitcoin** the testnet address looks different from the mainnet one (`bchtest:` and `tb1` rather than `bitcoincash:` and `bc1`). They are the same account; the format tells wallets which network it is for.

## What each chain supports

| | See balance | Send / receive | Swap | Connect to sites |
|---|---|---|---|---|
| Bitcoin Cash and CashTokens | Yes | Yes | Yes | Yes |
| Ethereum-family: gas token and USDC | Yes | Yes | USDC between chains | Not yet |
| Solana: SOL and tokens | Yes | Yes | On mainnet | Not yet |
| Bitcoin | Yes | Yes | No | Not yet |

On Ethereum-family networks the wallet lists the network's gas token and USDC. Other tokens you hold there are safe but not shown yet.

**Arc** is a little different: its gas token *is* USDC, so you see one USDC balance there and pay fees from it.
