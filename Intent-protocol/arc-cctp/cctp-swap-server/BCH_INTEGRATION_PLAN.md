# Implementation Plan: Bitcoin Cash (BCH) Swaps via NEAR Intents

## Executive Summary
This engineering plan specifies the exact implementation steps for adding bidirectional **Bitcoin Cash (BCH)** cross-chain swaps to `cctp-swap-server`.

By integrating the **NEAR Intents 1Click API** (`https://1click.chaindefuser.com/v0`), `cctp-swap-server` gains turnkey, high-liquidity cross-chain swapping between BCH and all supported networks (Base, Arbitrum, Ethereum, Solana, Optimism, Polygon, BSC, etc.) with up to **$25,000 USD** capacity per swap and <0.45% all-in effective cost.

---

## 1. Architectural Principles

1. **Isolation & Modularity:**
   All BCH-specific logic is encapsulated in `src/bch/`, following the existing patterns established by `src/jupiter/` (Solana swaps) and `src/cctp/` (Circle CCTP).
2. **Strict Server-Side Custody Boundaries:**
   The server never holds user funds or private keys for user swaps. It wraps 1Click's quote and deposit address creation, stores the swap state locally, tracks execution, notifies 1Click of deposit hashes, and relays updates.
3. **Unified Experience:**
   BCH swaps participate in:
   - `GET /config` (public feature flags, limits, and fees).
   - `GET /activity` (unified multi-chain activity feed).
   - `data/events.jsonl` (audit trail).
   - `data/settings.json` (real-time admin toggles).
   - `data/treasury.json` (monetization and fee tracking).
4. **Resilience & Polling Worker:**
   An active polling worker monitors pending deposits and solver execution with exponential backoff and watchdog alerts for stuck swaps.

---

## 2. Directory & File Manifest (`src/bch/`)

```
cctp-swap-server/src/bch/
├── types.ts              # Domain interfaces, status enums, DTOs
├── OneClickClient.ts     # Resilient HTTP client for 1Click API
├── TokenCatalog.ts       # In-memory cached token registry with auto-refresh
├── BchSwapStore.ts       # Atomic JSON persistence (data/bch-swaps.json)
├── BchSwapService.ts     # Business logic, address validation, quote calculation
├── BchSwapWorker.ts      # Background polling & deadline expiration worker
└── routes.ts             # Fastify route definitions mounted at /bch/*
```

---

## 3. Data Structures & State Machine

### 3.1 Swap Record Interface (`src/bch/types.ts`)
```typescript
export type BchSwapStatus =
  | 'PENDING_DEPOSIT'     // Quote created, waiting for user deposit on origin chain
  | 'KNOWN_DEPOSIT_TX'    // Deposit transaction hash registered
  | 'PROCESSING'          // Deposit confirmed, solvers fulfilling
  | 'SUCCESS'             // Target asset delivered to recipient
  | 'REFUNDED'            // Failed/timeout, funds refunded to refundTo
  | 'FAILED'              // Irrecoverable failure
  | 'EXPIRED';            // Deadline passed without deposit

export interface BchSwapRecord {
  id: string;                      // e.g. "bch-swp_8f93e2b10a"
  status: BchSwapStatus;
  fromAsset: string;               // 1Click assetId or friendly key
  toAsset: string;
  fromChain: string;
  toChain: string;
  depositAddress: string;
  depositMemo?: string;
  amountIn: string;                // base units
  amountInFormatted: string;
  amountInUsd: number;
  expectedOut: string;             // base units
  expectedOutFormatted: string;
  expectedOutUsd: number;
  minAmountOut: string;
  sender?: string;
  recipient: string;               // destination address
  refundTo: string;                // refund address on origin chain
  depositTxHash?: string;
  settleTxHash?: string;
  depositExplorerUrl?: string;
  settleExplorerUrl?: string;
  deadline: string;                // ISO timestamp
  timeEstimateSec: number;
  ourFeeBps: number;
  ourFeeUsd?: number;
  createdAt: number;
  updatedAt: number;
  lastPolledAt?: number;
  lastError?: string;
}
```

---

## 4. Subsystem Modifications

### 4.1 Configuration (`src/config.ts`)
Add 1Click / NEAR Intents configuration properties:
```typescript
bch: {
  enabled: process.env.BCH_SWAPS_ENABLED !== 'false',
  oneClickBaseUrl: process.env.ONECLICK_BASE_URL || 'https://1click.chaindefuser.com/v0',
  partnerJwt: process.env.ONECLICK_PARTNER_JWT || '',
  feeRecipientNear: process.env.ONECLICK_FEE_RECIPIENT || 'antony.near',
  defaultFeeBps: num('BCH_DEFAULT_FEE_BPS', 25),
  minSwapUsd: num('BCH_MIN_SWAP_USDC', 10),
  maxSwapUsd: num('BCH_MAX_SWAP_USDC', 25000),
  tokenRefreshMin: num('BCH_TOKEN_REFRESH_MIN', 10),
  pollIntervalMs: num('BCH_POLL_INTERVAL_MS', 5000),
}
```

### 4.2 Runtime Settings (`src/settings.ts`)
Extend `SettingsData` with runtime-adjustable BCH controls:
```typescript
export interface BchSettings {
  enabled: boolean;
  paused: boolean;
  pauseReason: string | null;
  feeBps: number;
  feeRecipientNear: string;
  minSwapUsd: number;
  maxSwapUsd: number;
}
```

### 4.3 Activity Feed (`src/activity.ts`)
Update `selectActivity` and `parseAddresses`:
- Support Bitcoin Cash CashAddr addresses (`bitcoincash:...` or `q...`) in `?address=` queries.
- Format BCH swap activity items with chain badges, logos, amounts, and explorer links alongside CCTP transfers and Jupiter swaps.

### 4.4 Admin Console (`src/adminRoutes.ts` & `src/adminProfitRoutes.ts`)
- Add `/admin/bch/pause`, `/admin/bch/resume`, `/admin/bch/settings`.
- Include BCH volume, swap counts, and fee earnings in profit analytics.

### 4.5 App Initialization (`src/index.ts`)
- Instantiate `OneClickClient`, `TokenCatalog`, `BchSwapStore`, `BchSwapService`, and `BchSwapWorker`.
- Register `/bch/*` routes.
- Hook into server lifecycle for graceful startup and shutdown.

---

## 5. Step-by-Step Implementation Sequence

1. **Step 1: Domain Models & Client (`src/bch/types.ts` & `src/bch/OneClickClient.ts`)**
   Implement the typed 1Click client with retry and error handling.
2. **Step 2: Token Catalog (`src/bch/TokenCatalog.ts`)**
   Implement runtime caching of 1Click tokens, mapping chain:symbol to assetId.
3. **Step 3: State Storage (`src/bch/BchSwapStore.ts`)**
   Implement atomic file-based persistence for BCH swap records in `data/bch-swaps.json`.
4. **Step 4: Service Logic (`src/bch/BchSwapService.ts`)**
   Implement address validation (CashAddr vs EVM/Solana), quote generation, limit enforcement, and swap creation.
5. **Step 5: Background Polling Worker (`src/bch/BchSwapWorker.ts`)**
   Implement status polling loop, deadline expiration, and event logging.
6. **Step 6: Route Handlers (`src/bch/routes.ts`)**
   Expose `/bch/tokens`, `/bch/quote`, `/bch/swaps`, `/bch/swaps/:id`, and `/bch/swaps/:id/deposit-tx`.
7. **Step 7: Wire into Server Subsystems (`src/index.ts`, `src/config.ts`, `src/settings.ts`, `src/activity.ts`)**
   Connect BCH swaps to the server's lifecycle, public config, settings, and activity feeds.
8. **Step 8: Automated Tests & Validation**
   Add unit tests in `tests/unit/bch.test.ts` and REST tests in `tests/short/bch_routes.test.ts`.
