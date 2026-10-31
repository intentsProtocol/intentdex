# Connecting to sites

Sites built for Bitcoin Cash can ask to use your wallet: to see your address, to ask you to sign a message, or to ask you to send a transaction. Nothing happens without you approving it in the wallet.

In this alpha, sites can use your **Bitcoin Cash** account. Ethereum, Solana and Bitcoin are for use inside the wallet only.

## Connecting

When a site asks to connect, the wallet shows the request. If the wallet is docked at the side, it appears there; otherwise a small window opens.

A connected site **can**:

- see your Bitcoin Cash address and balance
- ask you to approve transactions and signatures

A connected site **cannot**:

- move funds or sign anything without your approval
- see your recovery phrase, password or keys
- see your addresses on other chains

Click **Connect** to allow it, or **Reject**.

## Before you approve anything, check three things

1. **The site name at the top.** It is the address your browser is really on, not what the page claims. If it is not the site you meant to use, reject.
2. **The network pill.** A request on *Mainnet* spends real money.
3. **What is being asked**, in the wallet's own words: the amount, the recipient, the message.

## Requests to send

The wallet shows the amount, the token if any, the recipient address and the network. It refuses to continue, and explains why, if:

- the address is for a different network than the wallet is on
- the account does not hold enough to cover the amount and the fee
- the request is malformed

## Requests to sign a message

Signing a message proves you control your address, which is how many sites log you in. It does not move funds. Still, only sign messages you understand: the text is shown exactly as it will be signed.

## Several requests at once

They wait in line and are shown one at a time. The toolbar icon shows how many are waiting. Closing the request window without answering counts as rejecting them.

## If the wallet is locked

The wallet asks for your password first, then shows the request.

## Disconnecting

**Settings → Connected sites** lists every site you have connected, with when it was last used. Click **Disconnect** to remove one, or **Disconnect all**. The site is told straight away and has to ask again next time.

Disconnecting does not undo anything you already approved.

## Switching account or network

Connected sites are told when you switch account or network, so they can update. A site sees only the account that is active.
