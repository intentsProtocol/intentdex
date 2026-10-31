# The Agent

**Agent** is an assistant that runs on your phone. You write what you want ("swap 0.01 BCH for MESH", "keep buying
MESH if it dips"), and it prepares a card: your balances, a swap, a Mesh strategy, a loan plan or an explanation.
It never moves funds on its own. Every action waits for you to review it and enter your PIN.

## First time: download the model

The assistant is a language model (Qwen3, by QVAC) that lives on the phone. The first time you open **Agent**:

1. Choose **Standard** (about 1.06 GB, understands requests better) or **Light** (about 380 MB, faster, for phones
   with less memory).
2. Tap **Download model**. Use Wi-Fi and keep the app open until it finishes.

After that the model is on your phone. It does not need the internet again.

## Asking

Type a request, or tap one of the suggestions. Some things you can ask:

| Ask | You get |
|---|---|
| "What do I hold?" | Your balances, with the time they were last saved |
| "Show my Mesh positions" | Your positions, with their price ranges |
| "Swap 0.01 BCH for MESH", "Bridge all my USDC on Base to Ethereum" | A swap card to review |
| "Use a quarter of my BCH to keep buying MESH if it dips" | A Mesh strategy: range, bins, deposit, risk |
| "Sell half my MESH as the price rises" | A take-profit ladder |
| "How much USDC could I borrow against my BTC?" | A loan plan: amount, liquidation price, health |
| "What is a Dutch auction?", "What does LTV mean?" | A short explanation |

You can say amounts in words: "half", "a quarter", "25%", "all", or a number. The wallet works out the exact amount
from your balance; the assistant never does the arithmetic.

The chip under the title says where things stand: **On this phone · offline** means the assistant can answer and
plan, but actions will wait for the network.

## With no internet

Everything the assistant does itself works offline: understanding you, reading your saved balances and prices,
designing strategies, working out loans, explaining. Your balances are saved each time the wallet refreshes online,
so "Saved 2 hours ago" on a card tells you how fresh they are.

What needs the network: quotes, sending anything, and the services that run swaps and Mesh positions. When you
approve an action offline, tap **Approve when online**. It goes into your outbox with **Waiting for network**.

## Back online

When the phone is online again:

- in the app, a **Back online** banner says how many actions are ready;
- outside the app, a notification says the same (allow notifications when the wallet asks the first time).

Open the action and tap **Review and approve**. The wallet gets a fresh quote and shows what you would receive now,
which may differ from when you planned it. **Approve with PIN** runs it. The card in the chat then shows **In
progress**, **Done** with a link to the transaction, or **Did not complete** with the reason.

**Dismiss** removes a draft you no longer want; **Cancel** takes a queued action out of the outbox.

## Chats

Chats are saved on the phone, encrypted, separately for each account and for testnet and mainnet. **Chats** (the
speech-bubbles button) lists them; the pencil starts a new one. Long chats stay readable: the assistant keeps a short
summary of older messages so it remembers what you talked about.

Locking the wallet hides the chats and unloads the model. **Remove wallet** deletes them.

## What it will not do

- It cannot see or use your recovery phrase or keys.
- It cannot send, sign or approve anything. Only you can, with your PIN.
- It only knows tokens the wallet already lists. If it does not understand, it says so instead of guessing.
- Loans are plans only for now: the wallet cannot open a loan yet.
