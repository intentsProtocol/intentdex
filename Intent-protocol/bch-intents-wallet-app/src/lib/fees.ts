/**
 * The fees an EVM transaction offers, from what the chain reported. Pure, so it is tested without a network.
 */

const GWEI = 1_000_000_000n;

export interface EvmFees { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

/** EIP-1559 fees: twice the base fee plus the tip, never under the chain's floor (Arc drops anything under 20 gwei). */
export function feesFrom(reported: { baseFee: bigint | null; priority: bigint | null; gasPrice: bigint | null }, floorGwei?: number): EvmFees {
  const prio = reported.priority ?? GWEI;
  let max = reported.baseFee !== null ? reported.baseFee * 2n + prio : reported.gasPrice !== null ? reported.gasPrice * 2n : 30n * GWEI;
  const floor = floorGwei ? BigInt(floorGwei) * GWEI : 0n;
  if (max < floor) max = floor;
  if (max < prio) max = prio;
  return { maxFeePerGas: max, maxPriorityFeePerGas: prio > max ? max : prio };
}
