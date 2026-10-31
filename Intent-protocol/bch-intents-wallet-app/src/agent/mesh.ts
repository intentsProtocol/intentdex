/**
 * Creating a Mesh V4 position from the phone, after the user approved it with the PIN.
 *
 *   seed      a plain coin at output 0 of its transaction; its txid becomes the position's category. If the
 *             wallet has none, it pays itself a small amount (a payment's first output is the recipient).
 *   plan      the Mesh server lays out the outputs for that seed.
 *   check     the plan is verified on the phone (shared verifyPlan): bins rebuilt from their parameters, NFT
 *             to this wallet, nothing taken beyond the deposit, nothing paid elsewhere.
 *   send      the WDK worklet pays exactly those outputs with the seed at input 0 (sendOutputs) and signs.
 *   register  the server is told, so it watches the bins; the metadata is pinned. Best effort: the position
 *             exists on chain either way.
 */
import { genesisOutputs, pinPositionMetadata, previewPosition, registerPosition, verifyPlan, MeshServerError, type V4Plan } from '@bch-intents/wallet-core/mesh/plan';
import { cashAddressToLockingBytecode } from '@bch-intents/wallet-core/validation';
import type { MeshDraft } from '@bch-intents/wallet-core/agent';
import { call } from '@/wdk/bridge';

export type MeshStep = 'seed' | 'plan' | 'check' | 'send' | 'register';
export const MESH_STEPS: MeshStep[] = ['seed', 'plan', 'check', 'send', 'register'];

interface RawUtxo { txid: string; vout: number; satoshis: string; token?: unknown }

export interface MeshRunDeps {
  networkKey: string;
  net: 'chipnet' | 'mainnet';
  accountIndex: number;
  /** The wallet's BCH address (plain form): where the seed payment goes. */
  address: string;
  /** Its token-aware form: where the position NFT goes. */
  tokenAddress: string;
  onStep: (step: MeshStep, state: 'active' | 'done' | 'failed', note?: string) => void;
}

export interface MeshResult { txid: string; category: string; registered: boolean }

/** Bins that sell carry 1,000 sats each next to their tokens: part of what the user pays. */
const ASK_CARRIER_SATS = 1000n;
const SEED_SATS = '2000';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function findSeed(d: MeshRunDeps, exclude?: string): Promise<RawUtxo | null> {
  const utxos = await call<RawUtxo[]>(d.networkKey, d.accountIndex, 'getUtxos');
  return utxos.filter(u => !u.token && u.vout === 0 && u.txid !== exclude).sort((a, b) => (BigInt(b.satoshis) > BigInt(a.satoshis) ? 1 : -1))[0] ?? null;
}

async function makeSeed(d: MeshRunDeps): Promise<RawUtxo> {
  const sent = await call<{ hash: string }>(d.networkKey, d.accountIndex, 'sendTransaction', { to: d.address, value: SEED_SATS });
  // The server sees the new coin in the mempool within seconds; wait until the wallet does too.
  for (let i = 0; i < 20; i++) {
    await wait(1500);
    const utxos = await call<RawUtxo[]>(d.networkKey, d.accountIndex, 'getUtxos').catch(() => [] as RawUtxo[]);
    const seed = utxos.find(u => u.txid === sent.hash && u.vout === 0);
    if (seed) return seed;
  }
  throw new Error('The seed payment was sent but has not appeared yet. Try again in a minute.');
}

export async function createMeshPosition(draft: MeshDraft, d: MeshRunDeps): Promise<MeshResult> {
  const ownerLock = cashAddressToLockingBytecode(d.tokenAddress);
  if (!ownerLock) throw new Error('The wallet address could not be read.');

  d.onStep('seed', 'active');
  let seed = await findSeed(d) ?? await makeSeed(d);
  d.onStep('seed', 'done');

  d.onStep('plan', 'active');
  const ask = (seedTxid: string) => previewPosition(d.net, {
    tokenCat: draft.token.category, binStepBps: draft.binStepBps,
    lowIndex: draft.lowIndex, highIndex: draft.highIndex, marketIndex: draft.marketIndex,
    depositSats: draft.depositSats, depositTokens: draft.depositTokens,
    shape: draft.shape, strength: draft.strength, seedTxid, owner: d.tokenAddress,
    name: `${draft.token.symbol} ${draft.style}`,
  });
  let plan: V4Plan;
  try {
    plan = await ask(seed.txid);
  } catch (e) {
    // 409: that seed already made a position. Make a fresh one and ask once more.
    if (!(e instanceof MeshServerError) || e.status !== 409) throw e;
    seed = await findSeed(d, seed.txid) ?? await makeSeed(d);
    plan = await ask(seed.txid);
  }
  d.onStep('plan', 'done');

  d.onStep('check', 'active');
  verifyPlan(plan, {
    category: seed.txid, tokenCat: draft.token.category, ownerLock, binStepBps: draft.binStepBps,
    maxSats: BigInt(draft.depositSats) + BigInt(draft.sellBins) * ASK_CARRIER_SATS,
    maxTokens: BigInt(draft.depositTokens),
    lowIndex: draft.lowIndex, highIndex: draft.highIndex,
  });
  d.onStep('check', 'done');

  d.onStep('send', 'active');
  const sent = await call<{ hash: string }>(d.networkKey, d.accountIndex, 'sendOutputs', {
    outputs: genesisOutputs(plan), firstInput: { txid: seed.txid, vout: 0 },
  });
  d.onStep('send', 'done');

  d.onStep('register', 'active');
  await pinPositionMetadata(d.net, plan.category).catch(() => null);
  let registered = false;
  for (let i = 0; i < 4 && !registered; i++) {
    try { await registerPosition(d.net, plan, sent.hash, `${draft.token.symbol}/BCH`); registered = true; } catch { await wait(2500); }
  }
  d.onStep('register', registered ? 'done' : 'failed', registered ? undefined : 'later');
  return { txid: sent.hash, category: plan.category, registered };
}
