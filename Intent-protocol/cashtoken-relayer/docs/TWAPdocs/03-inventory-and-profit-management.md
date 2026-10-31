# 03 — Inventory & Profit Management

## 1. Relayer Inventory & Capital Cycling

When executing a TWAP order, the relayer can operate in two distinct modes:

### Mode A: Non-Custodial Passthrough (Direct User Signing)
- The user provides their own signed inputs or delegated pre-authorization.
- The relayer only provides miner fees and dust satoshis.
- Zero capital lockup for the relayer.

### Mode B: Relayer Solver Execution (Instant Fill & Settlement)
- The relayer uses its own working inventory (BCH and CashTokens) to instantly fill each slice against the user's intent.
- The relayer simultaneously routes against the cheapest BCHMesh pool to replenish its inventory.
- The spread between the user's TWAP limit price and the covenant execution price represents the **Relayer Solver Profit**.

---

## 2. Profit Ledgering (`ProfitLedger.ts`)

Every executed slice reports its financial metrics into the relayer's `ProfitLedger`:

```typescript
export interface TwapProfitMetrics {
  twapOrderId:        string;
  sliceIndex:         number;
  txid:               string;
  
  // Volume & Values
  grossVolumeSats:    bigint;
  netBchDelivered:    bigint;
  
  // Fees
  networkTxFeeSats:   bigint; // ~1,000 sats
  makerFeePaidSats:   bigint; // Paid to StrategyCovenant maker
  relayerFeeEarnedSats: bigint; // Relayer operator compensation
  
  // Net Accounting
  netProfitSats:      bigint; // relayerFeeEarnedSats - networkTxFeeSats
  timestamp:          number;
}
```

---

## 3. Dust & UTXO Optimization

In Bitcoin Cash, standard transaction rules require outputs to exceed dust thresholds:
- **Pure BCH Outputs**: Minimum 546 satoshis.
- **CashToken Outputs**: Minimum 1,000 satoshis (standard convention).

For a 10-slice TWAP order:
- 10 slices $\times$ 1,000 satoshis miner fee = **10,000 satoshis (~$0.035 USD) total execution cost**.
- Dust satoshis on maker token payouts (Output 2) are automatically claimed by the maker when they dock/withdraw their pool.
- Relayer change outputs are coalesced in periodic background sweep cycles to prevent wallet UTXO fragmentation.
