# Send and receive

## Receive

1. Click **Receive**.
2. Pick the chain: **BCH**, **ETH** (all Ethereum-family networks), **SOL** or **BTC**.
3. Share the address or the QR code. Click the address to copy it.

Things to get right:

- **Bitcoin Cash has two address types.** Use the **BCH address** (starts with `q`) for plain BCH and the **CashToken address** (starts with `z`) for tokens. The token address also accepts BCH.
- **One Ethereum address covers every Ethereum-family network.** Make sure the sender uses a network the wallet supports (the screen lists them), or you will not see the funds here.
- **Bitcoin and Bitcoin Cash are different coins.** A BTC address cannot receive BCH, and the other way round.
- **On testnet** the screen says *Testnet only*. Do not give a testnet address to someone sending real coins.

## Send

1. Click **Send** (or open a token and click *Send*).
2. **Asset:** choose what to send. The list shows what this account holds.
3. **To:** paste the address. The wallet checks it is the right kind for the asset's chain and network and tells you if it is not.
4. **Amount:** type it, or click **MAX** to send as much as possible after the fee.
5. **Review:** check the amount, the address and the network.
6. **Confirm and send.**

You get the transaction ID and a link to a block explorer. The send also appears under **Activity**.

### Fees

Every chain charges a network fee, paid in that chain's own coin:

| Sending | Fee is paid in |
|---|---|
| BCH or a CashToken | BCH |
| ETH or USDC on Ethereum, Base, Arbitrum, Optimism | ETH on that same network |
| USDC on Arc | USDC |
| SOL or a Solana token | SOL |
| BTC | BTC |

So to send USDC on Base you need a little ETH on Base. If you have none, the wallet tells you before you reach the review step.

Two details:

- **Sending a Solana token to someone who has never held it** costs about 0.002 SOL extra, once, to open their token account.
- **Solana does not let an account hold a tiny leftover.** If a send would leave less than about 0.00089 SOL, the wallet asks you to send the maximum or leave a bit more.

### A send cannot be undone

Blockchains have no "cancel". A wrong address or the wrong network usually means the funds are gone. On mainnet the review screen reminds you of this. If the amount matters, send a small test first.

## Activity

**Activity** lists what this account sent, received, swapped and approved for sites, newest first. Click an entry for its details and explorer link.

- *Pending* means the network has it but has not confirmed it.
- Incoming payments are listed for Bitcoin Cash and Bitcoin. For Ethereum-family networks and Solana you see the balance change on the home screen; incoming transfers are not itemised yet.
