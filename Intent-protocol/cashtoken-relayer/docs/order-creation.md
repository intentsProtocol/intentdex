# CashToken Relayer: Order Creation Lifecycle

Order creation is a collaborative process between the User's Wallet (frontend/SDK) and the Relayer API. It requires off-chain communication (via HTTP) and on-chain action (funding the covenant).

The Relayer supports two primary order types:
1. **Limit Orders** (`orderType: "limit"`): Fixed price execution.
2. **Market Orders / Dutch Auctions** (`orderType: "market"`): Price decays linearly to guarantee execution (market-making).

Here is the exact lifecycle of how an order is created and becomes active.

---

## 1. API Submission (Relayer Side)

Before locking funds on-chain, the frontend submits the trade parameters to the Relayer via an HTTP API call to `POST /intent/create`. The payload differs based on the order type.

### Option A: Limit Order
A limit order requests a fixed amount of the `buyToken` in exchange for the `sellAmount` of the `sellToken`. It expires at a specific Unix timestamp.

```http
POST /intent/create
{
  "orderType": "limit",
  "makerAddress": "bchtest:qrnkm6...",
  "sellToken": "BCH",
  "buyToken": "b4863d5773c7a269b6fe3b9f7ce2ce1098ab71c0b046ef2a39058d5e30b1f353",
  "sellAmount": "5000",
  "buyAmount": "4500",
  "expiryTime": 1781738000
}
```

### Option B: Market Order (Dutch Auction)
A market order uses a Dutch Auction mechanism to guarantee a fill. The price starts high (`buyAmount` + a premium) and decays over the `duration` to a minimum floor. The relayer API automatically configures the decay curve.

```http
POST /intent/create
{
  "orderType": "market",
  "makerAddress": "bchtest:qrnkm6...",
  "sellToken": "b4863d5773c7a269b6fe3b9f7ce2ce1098ab71c0b046ef2a39058d5e30b1f353",
  "buyToken": "BCH",
  "sellAmount": "1000",
  "buyAmount": "5000",
  "duration": 600
}
```
*Note: For market orders, the backend automatically sets the `startBuy` to the `buyAmount` requested, and sets the `endBuy` to a 50% decay (e.g., `buyAmount / 2`) over the `duration`.*

### API Processing
When the Fastify server receives either payload, it:
1. Compiles the specific CashScript artifact (`LIMIT_ARTIFACT` or `DUTCH_ARTIFACT`) using the exact parameters.
2. Generates a unique `intent_id`.
3. Returns the resulting `contractAddress` and `tokenAddress` to the client.
4. Saves the intent into the local `intents.json` database.
5. Injects the `contractAddress` into the `WATCH_ADDRESSES` set.

At this point, the intent is `pending`. The relayer's scanner is now actively watching this address on the blockchain.

---

## 2. On-Chain Funding (User Side)

With the relayer successfully notified and the `contractAddress` returned by the API, the user's wallet broadcasts a standard Bitcoin Cash transfer transaction.
- It sends the exactly specified `sellAmount` of the `sellToken` to the `contractAddress`.
- *Crucially:* For CashTokens, the user must send to the `tokenAddress` format (which starts with `z` or `r`) to properly attach the token UTXOs.

---

## 3. Activation (Relayer Side)

Within seconds, the Relayer's `Scanner` detects a new unspent UTXO appearing at the watched `contractAddress`.
- The bot loop pulls the parameters from the database.
- It verifies the UTXO balances match the `sellAmount`.
- It hands the UTXO to the Solver (either the Limit Order solver or the Dutch Auction solver).
- The order is now **Live**, and the relayer will continuously attempt to route and fill it until it either becomes profitable or expires.
