# Troubleshooting

## Opening the wallet

**Clicking the icon does nothing, or opens the wrong thing.**
Check **Settings → Open wallet as**. If the side panel does not appear, right-click the toolbar icon and choose *Open side panel*, or switch to *Popup*. Browsers other than Chrome-family ones do not have a side panel and always use the popup.

**The wallet asks for my password every time.**
It locks when the browser closes and after the auto-lock time. Lengthen it in **Settings → Auto-lock**.

**I forgot my password.**
See [Security and recovery](security-and-recovery.md#if-you-forget-the-password). You need your recovery phrase.

## Balances

**A balance is missing or out of date.**
Click the refresh arrow on the portfolio card. If a banner says a chain could not be refreshed, the network's public endpoint did not answer; the wallet shows the last balance it knew and tries again every 20 seconds.

**I received funds but do not see them.**

- Check the **network pill**: testnet and mainnet are separate.
- Check the **account**: each account has its own addresses.
- On Ethereum-family networks, the wallet shows the gas coin and USDC. Other tokens are safe but not listed.
- Funds sent on a network the wallet does not list (BNB Chain or Polygon, say) are at the same Ethereum address; import your recovery phrase into a wallet that supports that network to reach them.

**A token I do not recognise appeared.**
Anyone can send you a token. Unknown ones are marked *unverified*. Do not interact with sites they advertise. Hide it from its detail sheet.

**Everything shows a dash instead of a dollar value.**
Prices could not be fetched. Balances are still correct. On testnet there are never dollar values.

## Sending

**"You need ETH on … to pay the network fee."**
Fees are paid in the network's own coin. Get a little of it on that same network.

**"This address is for another network."**
You pasted a mainnet address while on testnet, or the reverse. Switch network, or get the right address.

**"CashTokens must go to a token-aware address."**
Ask the recipient for their CashToken address (it starts with `z`).

**A Solana send says it would leave too little SOL.**
Solana requires an account to hold either nothing or at least about 0.00089 SOL. Use MAX, or leave more.

**A send stays "Pending".**
Open it in **Activity** and follow the explorer link. Ethereum-family transactions can wait when the network is busy. A Solana transaction that has not landed in a few minutes will not land; it is marked failed and your funds are untouched.

## Swaps

**"The swap service cannot be reached."**
That service is down or not configured in this build. Check **Settings → Services**. Other kinds of swap may still work.

**"No quote available."**
The message under the card says why: the amount is too small or too large, the route is closed, or the token has no market.

**"This amount is too small to cover the cost of filling the order."**
Bitcoin Cash swaps have a minimum set by transaction costs. Try a larger amount.

**A Bitcoin Cash swap says "Refunded".**
No solver filled the order before its auction ended, and the contract returned your funds. Try again, perhaps with a longer auction (**Settings → Trading defaults**).

**A bridge shows "Pay the service fee to finish delivery".**
The transfer was sent but its fee was not, usually because the wallet was closed in between. Click the button in **Activity**.

**A bridge shows "Resume this transfer".**
It was prepared but never sent. Resume it, or leave it to expire: nothing has left your wallet.

## Sites

**A site says the wallet is not installed.**
Reload the page after installing or updating the wallet. The wallet works on `http` and `https` pages, not on files opened from disk.

**Nothing appears when a site asks to connect.**
Look for a small separate window (it may be behind the browser), or open the wallet: a waiting request is shown first. The toolbar icon shows a number when requests are waiting.

**A site still shows my address after I disconnected it.**
Reload the site. It has no access; it is showing what it remembered.

## Starting over

**Settings → Remove wallet** deletes everything from this browser. Make sure you have your recovery phrase first.

## Reporting a problem

Include the version (**Settings → About**), the network mode, what you did, and what you saw. Never include your recovery phrase or password.
