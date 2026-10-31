# Swaps

The **Swap** tab does three kinds of trade. You do not choose between them: pick the two tokens and the wallet uses the one that fits. The line under the title tells you which.

| You pick | What happens | Where |
|---|---|---|
| BCH and a CashToken (or two CashTokens) | A Bitcoin Cash swap | Testnet and mainnet |
| USDC on one chain and USDC on another | A USDC bridge | Testnet and mainnet |
| Two Solana tokens | A Solana swap | Mainnet only |

If the two tokens you pick cannot be traded for each other (BCH for USDC, say), the button says so and stays disabled.

## How to swap

1. Open **Swap**.
2. Click the token on the **You pay** side and choose one. Use the search box, or the filter chips to narrow by kind. Tokens you hold are listed first.
3. Choose the **You receive** token. When you pick a token on one side, the other side moves to a token that can be traded for it.
4. Type the amount. A quote appears with the details below it.
5. Click **Swap** (or **Bridge USDC**).
6. A progress panel shows each step. You can close it: the swap continues, and **Activity** shows where it is.

The button tells you if something is in the way: not enough balance, not enough of the fee coin, a route that is closed, or a service that is unavailable.

## Bitcoin Cash swaps

Your order is a short **auction** held by a contract on the Bitcoin Cash chain.

- The quote is what you should expect to receive.
- The **auction floor** is the least the contract can pay: half the quote. The price starts at the quote and slides toward the floor while the auction runs; a solver normally fills it right away, near the quote.
- If nobody fills it before the auction ends, **your funds are returned** to your wallet. The entry in Activity changes to *Refunded*.
- **Auction length** is 60 seconds by default. Change it in **Settings → Trading defaults**.

The steps you will see: *Creating the order*, *Funding the order from your wallet* (this is the one transaction you sign), *Waiting for a solver to fill it*.

Very small amounts cannot be filled, because the cost of the transactions would exceed the trade. The wallet tells you when an amount is too small.

## Moving USDC between chains

USDC is moved with Circle's cross-chain protocol: it is taken out of circulation on the source chain and issued on the destination. You send USDC and receive USDC.

Supported chains: Ethereum, Base, Arbitrum, Optimism, Arc and Solana (and their test networks on testnet).

The details show:

- **Service fee** and **Network fee**, both in USDC, already taken out of what you receive.
- **Arrives in:** usually under a minute, longer from some chains.
- The limits per transfer, shown under the card.

The steps: *Approve USDC* (only the first time on a chain), *Send USDC*, *Pay the service fee*, then the bridge takes over: *Confirming*, *Circle attestation*, *Delivering*.

You need the source chain's gas coin for the transactions you sign (ETH on Ethereum, Base, Arbitrum and Optimism; SOL on Solana; nothing extra on Arc).

### If you close the wallet halfway

Nothing is lost.

- If the transfer was sent but the service fee was not, the bridge waits for it. **Activity** shows *Pay the service fee to finish delivery*.
- If the transfer was prepared but never sent, **Activity** shows *Resume this transfer*. If you leave it, it expires and nothing was sent.

## Solana swaps (mainnet)

Swaps between Solana tokens use Jupiter, which finds the best route across Solana's exchanges.

- **Minimum received** is the least you get after slippage. If the price moves further than that before your trade lands, the trade is cancelled and you keep your tokens.
- **Max slippage** is 1% by default. Change it in **Settings → Trading defaults**.
- **Price impact** shows how much your own trade moves the price. A large negative number means the pool is small for the size of your trade.

You can search for any token by name, symbol or address. Be careful with what you find:

- A token marked **unverified** has not been vetted by the token registry. Anyone can create a token with any name.
- A token marked **suspicious** has been flagged. It may be a copy of a real token, or impossible to sell.

Check the token's address against a source you trust before buying.

## If a swap fails

The progress panel and the Activity entry say what happened. A swap that fails before you signed anything cost nothing. One that fails after is described in its entry, with a link to the transaction.

If the Swap tab says a service cannot be reached, that kind of swap is unavailable for now; the other kinds still work. **Settings → Services** shows which services are reachable.
