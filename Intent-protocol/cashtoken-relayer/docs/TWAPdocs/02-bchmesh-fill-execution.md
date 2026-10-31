# 02 — BCHMesh Fill Execution & Covenant Introspection

## 1. On-Chain Transaction Structure for Each TWAP Slice

Each TWAP slice is an atomic partial fill against a live `StrategyCovenant` UTXO. The relayer constructs a multi-input, multi-output transaction matching the covenant's strict CashScript introspection requirements.

---

## 2. Transaction Blueprint

```
══════════════════════════════════════════════════════════════════════════════
  Bitcoin Cash TWAP Slice Transaction Layout
══════════════════════════════════════════════════════════════════════════════

[INPUTS]
├─ Input 0: StrategyCovenant UTXO
│           • Unlocked via: contract.unlock.fill(sliceAmountIn)
│           • Contains: Current BCH Reserve (or CashToken Reserve)
│
├─ Input 1: Taker / Relayer Token UTXO (P2PKH)
│           • Unlocked via: P2PKH SignatureTemplate
│           • Contains: CashTokens (e.g. pUSD) being sold
│
└─ Input 2: Relayer Fee UTXO (P2PKH)
            • Unlocked via: Relayer Fee SignatureTemplate
            • Contains: Pure BCH for transaction fees & dust outputs

[OUTPUTS]
├─ Output 0: Recreated StrategyCovenant (MANDATORY per bytecode rule)
│           • Locking Bytecode: MATCHES Input 0 exactly
│           • Value: currentReserve - amountOut
│
├─ Output 1: Taker / Relayer Net BCH Payout
│           • Destination: Taker / User CashAddress
│           • Value: >= amountOut (Gross Output - Maker Fee)
│
├─ Output 2: Maker Token Deposit Output
│           • Destination: Maker Token Address (bchtest:z...)
│           • Token: Category matching tokenCategoryIn, Amount: sliceAmountIn
│           • Value: 1,000 sats (dust)
│
├─ Output 3: Token Change Output (if Input 1 > sliceAmountIn)
│           • Destination: Taker / User Token Address
│           • Token: Category matching tokenCategoryIn, Amount: inputTokenAmount - sliceAmountIn
│           • Value: 1,000 sats (dust)
│
└─ Output 4: BCH Fee Change Output (Returned to Relayer)
            • Destination: Relayer Funding Address
            • Value: Remaining unspent BCH satoshis
```

---

## 3. Mathematical Verification in TypeScript

```typescript
import { Contract, TransactionBuilder, SignatureTemplate, ElectrumNetworkProvider } from 'cashscript';

export async function executeTwapSliceFill(params: {
  provider: ElectrumNetworkProvider;
  covenantAddress: string;
  covenantUtxo: any;
  strategyArtifact: any;
  ownerPkh: string;
  tokenCategoryIn: string;
  tokenCategoryOut: string;
  priceNum: bigint;
  priceDen: bigint;
  feeBps: bigint;
  sliceAmountIn: bigint;
  takerTokenUtxo: any;
  takerTokenWif: string;
  relayerFeeUtxo: any;
  relayerWif: string;
  takerPayoutAddress: string;
  makerTokenAddress: string;
}): Promise<string> {
  const {
    provider, covenantAddress, covenantUtxo, strategyArtifact,
    ownerPkh, tokenCategoryIn, tokenCategoryOut,
    priceNum, priceDen, feeBps, sliceAmountIn,
    takerTokenUtxo, takerTokenWif, relayerFeeUtxo, relayerWif,
    takerPayoutAddress, makerTokenAddress
  } = params;

  // 1. Calculate covenant math
  const currentReserve = BigInt(covenantUtxo.satoshis);
  const amountOut = (sliceAmountIn * priceNum * (10000n - feeBps)) / (priceDen * 10000n);
  const remainingReserve = currentReserve - amountOut;

  if (remainingReserve < 546n) {
    throw new Error(`Covenant reserve too small for slice. Remaining: ${remainingReserve}`);
  }

  // 2. Instantiate CashScript Contract
  const contract = new Contract(
    strategyArtifact,
    [
      Buffer.from(ownerPkh, 'hex'),
      tokenCategoryIn === '0x' ? '0x' : `0x${reverseHex(tokenCategoryIn)}`,
      tokenCategoryOut === '0x' ? '0x' : `0x${reverseHex(tokenCategoryOut)}`,
      priceNum,
      priceDen,
      feeBps
    ],
    { provider }
  );

  const txBuilder = new TransactionBuilder({ provider });

  // 3. Assemble Inputs
  txBuilder.addInput(covenantUtxo, contract.unlock.fill(sliceAmountIn));
  txBuilder.addInput(takerTokenUtxo, new SignatureTemplate(takerTokenWif).unlockP2PKH());
  txBuilder.addInput(relayerFeeUtxo, new SignatureTemplate(relayerWif).unlockP2PKH());

  const DUST_SATS = 1000n;
  const TX_FEE_SATS = 1000n;

  // 4. Output 0: Recreated Covenant
  txBuilder.addOutput({ to: covenantAddress, amount: remainingReserve });

  // 5. Output 1: Taker BCH payout
  txBuilder.addOutput({ to: takerPayoutAddress, amount: amountOut });

  // 6. Output 2: Maker token payment
  txBuilder.addOutput({
    to: makerTokenAddress,
    amount: DUST_SATS,
    token: { category: tokenCategoryIn, amount: sliceAmountIn }
  });

  // 7. Output 3: Token Change (if any)
  const tokenChange = BigInt(takerTokenUtxo.token.amount) - sliceAmountIn;
  if (tokenChange > 0n) {
    txBuilder.addOutput({
      to: takerTokenUtxo.address,
      amount: DUST_SATS,
      token: { category: tokenCategoryIn, amount: tokenChange }
    });
  }

  // 8. Output 4: Relayer BCH Change
  const totalBchIn = currentReserve + BigInt(takerTokenUtxo.satoshis) + BigInt(relayerFeeUtxo.satoshis);
  const totalBchOut = remainingReserve + amountOut + DUST_SATS + (tokenChange > 0n ? DUST_SATS : 0n);
  const bchChange = totalBchIn - totalBchOut - TX_FEE_SATS;

  if (bchChange > 546n) {
    txBuilder.addOutput({ to: relayerFeeUtxo.address, amount: bchChange });
  }

  // 9. Send transaction to Bitcoin Cash network
  const tx = await txBuilder.send();
  return tx.txid || (tx as any).txId;
}
```

---

## 4. Chained 0-Conf TWAP Fills

Because Bitcoin Cash supports standard ancestor chaining in the mempool:
- Slice $N+1$ can spend the Output 0 UTXO created by Slice $N$ immediately.
- The relayer does not need to wait for 10-minute block confirmations between slices.
- Slices can execute at rapid intervals (e.g. 5 seconds, 15 seconds, 30 seconds) while remaining fully secure.
