/**
 * Creating a Mesh V4 position: ask the Mesh server for a plan, check it here, and register the result.
 *
 * The server proposes; the wallet verifies. A plan is refused unless (port of frontend/src/lib/mesh/v4/verify.ts):
 *   - every bin's locking bytecode is rebuilt here from its parameters, its owner is the new position
 *     (ownerCat = category) and its prices are the grid prices of its level (bid = level i, ask = i + 1);
 *   - the NFT goes to this wallet, is mutable (never minting) and carries the commitment that matches the bins;
 *   - the bins hold no more than the deposit, the identity output is small and the metadata output is the BCMR
 *     publication of the planned registry;
 *   - nothing else is paid anywhere.
 * Building and signing the genesis is the BCH wallet module's job (`sendOutputs` with the seed as first input).
 */
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import type { BchNet } from '../cashtokens';
import { meshServerUrl } from '../platform';
import { cashAddressToLockingBytecode } from '../validation';
import { BIN_MIN_SATS, binV4LockingBytecode, parseBinV4, type BinV4Json, type BinV4Params } from './bin';
import { decodeCommitment, encodeCommitment, gridFraction, gridPriceNum, type PositionCommitment } from './v4';

export type V4Shape = 'spot' | 'curve' | 'bidask';
export type V4Strength = 'gentle' | 'standard' | 'aggressive';

export interface V4PreviewInput {
  tokenCat: string;
  binStepBps: number;
  lowIndex: number;
  highIndex: number;
  marketIndex: number;
  depositSats: string;
  depositTokens: string;
  shape: V4Shape;
  strength?: V4Strength;
  /** txid whose output #0 the wallet spends at input 0: the new category */
  seedTxid: string;
  /** where the position NFT goes (token-aware cashaddr) */
  owner: string;
  name?: string;
}

export interface V4TokenJson { category: string; amount: string; nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string } }

export interface V4PlanBin {
  index: number;
  level: number;
  side: 'bid' | 'ask';
  address: string;
  lockingBytecode: string;
  sats: string;
  tokens: string;
  bidSatsPerUnit: number;
  askSatsPerUnit: number;
  params: BinV4Json;
}

export interface V4PlanOutput {
  role: 'identity' | 'nft' | 'bin' | 'metadata';
  binIndex?: number;
  lockingBytecode: string;
  valueSatoshis: string;
  token?: V4TokenJson;
}

export interface V4Plan {
  category: string;
  commitment: PositionCommitment;
  commitmentHex: string;
  bins: V4PlanBin[];
  outputs: V4PlanOutput[];
  metadata: { sha256: string; cid: string; uri: string; registry: unknown; pinProvider?: string | null; pinPath?: string; httpsCopy?: string };
  totals: { sats: string; tokens: string; bidBins: number; askBins: number; outputSats: string };
  estimatedBytes: number;
  warnings: string[];
  register: { method: 'POST'; path: string; body: { genesisTxid: string; bins: BinV4Json[] } };
}

export class PlanCheckError extends Error {}

/** The identity output only controls metadata: it must stay tiny. */
export const MAX_IDENTITY_SATS = 1000n;
const NFT_MAX_SATS = 2000n;

export interface PlanExpect {
  category: string;
  tokenCat: string;
  /** the wallet's locking bytecode (hex): the NFT must go there */
  ownerLock: string;
  /** most BCH and tokens the bins may take */
  maxSats: bigint;
  maxTokens: bigint;
  binStepBps: number;
  /** the range asked for (inclusive levels) */
  lowIndex?: number;
  highIndex?: number;
}

const fail = (m: string): never => { throw new PlanCheckError(m); };
const pushHex = (h: string) => {
  const n = h.length / 2;
  if (n <= 75) return n.toString(16).padStart(2, '0') + h;
  if (n <= 255) return '4c' + n.toString(16).padStart(2, '0') + h;
  return fail('metadata URI too long');
};

/** OP_RETURN 'BCMR' <sha256> <uri>: the publication output of a genesis. */
export function bcmrPublicationHex(sha256Hex: string, uri: string): string {
  return '6a' + pushHex(bytesToHex(utf8ToBytes('BCMR'))) + pushHex(sha256Hex) + pushHex(bytesToHex(utf8ToBytes(uri)));
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** CIDv1 (raw codec, sha2-256) of a file whose sha256 is known: 'b' + base32(01 55 12 20 digest). */
export function cidOfSha256(sha256Hex: string): string {
  const bytes = [0x01, 0x55, 0x12, 0x20, ...(sha256Hex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16))];
  let out = 'b', bits = 0, value = 0;
  for (const x of bytes) {
    value = ((value << 8) | x) & 0x1fff; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function checkBinPrices(p: BinV4Params, step: number, level: number, k: number): void {
  const bid = gridFraction(step, level, 'down');
  const ask = gridFraction(step, level + 1, 'up');
  if (p.bidNum !== bid.num || p.bidDen !== bid.den) fail(`bin ${k}: bid is not the grid price of level ${level}`);
  if (p.askNum !== ask.num || p.askDen !== ask.den) fail(`bin ${k}: ask is not the grid price of level ${level + 1}`);
}

/** Verify a /v4/positions/preview plan. Returns the parsed bins. */
export function verifyPlan(plan: V4Plan, x: PlanExpect): BinV4Params[] {
  if (plan.category !== x.category) fail('the plan is for another category than the seed');
  const c = decodeCommitment(plan.commitmentHex);
  if (c.tokenCat !== x.tokenCat) fail('the commitment names another token');
  if (c.binStepBps !== x.binStepBps) fail('the commitment has another bin step');
  if (c.binCount !== plan.bins.length) fail('the commitment counts another number of bins');
  if (c.variant !== 'default' || !/^0{64}$/.test(c.managerHash)) fail('the plan adds a variant or a manager that was not asked for');

  const bins = plan.bins.map((b, k) => {
    const p = parseBinV4(b.params);
    if (p.ownerCat !== x.category) fail(`bin ${k}: owned by another position`);
    if (p.tokenCat !== x.tokenCat) fail(`bin ${k}: another token`);
    if ((p.variant ?? 'default') !== 'default' || (p.managerHash ?? '00'.repeat(32)) !== '00'.repeat(32) || (p.manageAfter ?? 0) !== 0) {
      fail(`bin ${k}: has a manager or variant`);
    }
    if (binV4LockingBytecode(p) !== b.lockingBytecode) fail(`bin ${k}: address does not match its parameters`);
    checkBinPrices(p, x.binStepBps, b.level, k);
    if (b.level < c.lowIndex || b.level > c.highIndex) fail(`bin ${k}: outside the committed range`);
    if (x.lowIndex !== undefined && b.level < x.lowIndex) fail(`bin ${k}: below the range asked for`);
    if (x.highIndex !== undefined && b.level > x.highIndex) fail(`bin ${k}: above the range asked for`);
    return p;
  });

  let binSats = 0n, binTokens = 0n, idCount = 0, nftCount = 0, metaCount = 0;
  const seenBins = new Set<number>();
  for (const [j, o] of plan.outputs.entries()) {
    const v = BigInt(o.valueSatoshis);
    if (o.role === 'identity') {
      idCount++;
      if (j !== 0) fail('the identity output must be output 0');
      if (o.token || v > MAX_IDENTITY_SATS) fail('the identity output must be a small plain output');
    } else if (o.role === 'nft') {
      nftCount++;
      if (j !== 1) fail('the NFT must be output 1');
      if (o.lockingBytecode !== x.ownerLock) fail('the NFT does not go to this wallet');
      const t = o.token ?? fail('the NFT output has no token');
      if (t.category !== x.category || t.amount !== '0' || !t.nft) fail('the NFT output is not the position NFT');
      if (t.nft!.capability !== 'mutable') fail('the position NFT must be mutable');
      if (t.nft!.commitment !== plan.commitmentHex) fail('the NFT commitment differs from the plan');
      if (v > NFT_MAX_SATS) fail('the NFT output carries too many sats');
    } else if (o.role === 'bin') {
      const k = o.binIndex ?? fail('a bin output has no bin index');
      const b = plan.bins[k] ?? fail(`output ${j}: no bin ${k}`);
      if (seenBins.has(k)) fail(`bin ${k} funded twice`);
      seenBins.add(k);
      if (o.lockingBytecode !== b.lockingBytecode) fail(`output ${j}: not bin ${k}'s address`);
      if (v < BIN_MIN_SATS) fail(`bin ${k}: below the 1,000-sat minimum`);
      if (o.token) {
        if (o.token.category !== x.tokenCat || o.token.nft) fail(`bin ${k}: carries a foreign token`);
        binTokens += BigInt(o.token.amount);
      }
      if (v !== BigInt(b.sats) || (o.token?.amount ?? '0') !== b.tokens) fail(`bin ${k}: funded differently from the plan`);
      binSats += v;
    } else if (o.role === 'metadata') {
      metaCount++;
      if (j !== plan.outputs.length - 1) fail('the metadata output must be last');
      if (v !== 0n || o.token) fail('the metadata output must carry nothing');
      if (o.lockingBytecode !== bcmrPublicationHex(plan.metadata.sha256, plan.metadata.uri)) fail('the metadata output is not the planned BCMR publication');
      if (plan.metadata.uri !== `ipfs://${cidOfSha256(plan.metadata.sha256)}`) fail('the metadata URI is not the IPFS address of the registry');
    } else {
      fail(`unknown output role ${(o as { role: string }).role}`);
    }
  }
  if (idCount !== 1 || nftCount !== 1 || metaCount !== 1) fail('a genesis has one identity, one NFT and one metadata output');
  if (seenBins.size !== plan.bins.length) fail('some bins are not funded');
  if (binTokens > x.maxTokens) fail(`the bins take ${binTokens} token units; the deposit is ${x.maxTokens}`);
  // Selling bins carry 1,000 sats each with their tokens: part of the BCH the user pays.
  if (binSats > x.maxSats) fail(`the bins take ${binSats} sats; at most ${x.maxSats} were allowed`);
  return bins;
}

/** The plan's outputs as the BCH wallet module's `sendOutputs` takes them. */
export function genesisOutputs(plan: V4Plan) {
  return plan.outputs.map(o => ({ lockingBytecode: o.lockingBytecode, valueSatoshis: o.valueSatoshis, ...(o.token ? { token: o.token } : {}) }));
}

// ── Local position planner (pure offline fallback) ─────────────────────────

const SIGMA: Record<V4Strength, number> = { gentle: 3.5, standard: 2, aggressive: 1.25 };
const EDGE: Record<V4Strength, number> = { gentle: 1, standard: 3, aggressive: 6 };

export function shapeWeight(shape: V4Shape, strength: V4Strength, d: number, maxD: number): number {
  if (shape === 'curve') return Math.exp(-(d * d) / (2 * SIGMA[strength] ** 2));
  if (shape === 'bidask') return 1 + (EDGE[strength] * (d - 1)) / Math.max(1, maxD - 1);
  return 1;
}

const SCALE = 1_000_000_000;

export function allocate(total: bigint, weights: number[], min: bigint): bigint[] {
  const w = weights.map(x => (x > 0 && Number.isFinite(x) ? BigInt(Math.max(1, Math.round(x * SCALE))) : 0n));
  const active = new Set(w.flatMap((x, idx) => (x > 0n ? [idx] : [])));
  while (active.size) {
    const sumW = [...active].reduce((a, idx) => a + w[idx]!, 0n);
    const amounts = w.map((x, idx) => (active.has(idx) ? (total * x) / sumW : 0n));
    const short = [...active].filter(idx => amounts[idx]! < min);
    if (!short.length) {
      const heaviest = [...active].reduce((a, idx) => (w[idx]! > w[a]! ? idx : a));
      amounts[heaviest]! += total - amounts.reduce((a, x) => a + x, 0n);
      return amounts;
    }
    const drop = short.reduce((a, idx) => (w[idx]! <= w[a]! ? idx : a));
    active.delete(drop);
  }
  return w.map(() => 0n);
}

export function localPlanPosition(i: V4PreviewInput): V4Plan {
  const ownerLock = cashAddressToLockingBytecode(i.owner) ?? '00'.repeat(20);
  const depositSats = BigInt(i.depositSats || '0');
  const depositTokens = BigInt(i.depositTokens || '0');
  const strength = i.strength ?? 'standard';
  const category = i.seedTxid.toLowerCase();

  const levels = Array.from({ length: i.highIndex - i.lowIndex + 1 }, (_, k) => i.lowIndex + k);
  const bidLevels = levels.filter(l => l <= i.marketIndex);
  const askLevels = levels.filter(l => l > i.marketIndex);

  const bidW = bidLevels.map(l => shapeWeight(i.shape, strength, i.marketIndex - l + 1, bidLevels.length));
  const askW = askLevels.map(l => shapeWeight(i.shape, strength, l - i.marketIndex, askLevels.length));

  const bidSats = bidLevels.length && depositSats > 0n ? allocate(depositSats, bidW, 2000n) : [];
  const askToks = askLevels.length && depositTokens > 0n ? allocate(depositTokens, askW, 1n) : [];

  const warnings: string[] = [];
  const bins: V4PlanBin[] = [];

  const addBin = (level: number, side: 'bid' | 'ask', sats: bigint, tokens: bigint) => {
    const bid = gridFraction(i.binStepBps, level, 'down');
    const ask = gridFraction(i.binStepBps, level + 1, 'up');
    const params: BinV4Params = {
      tokenCat: i.tokenCat.toLowerCase(),
      ownerCat: category,
      bidNum: bid.num,
      bidDen: bid.den,
      askNum: ask.num,
      askDen: ask.den,
    };
    const lockingBytecode = binV4LockingBytecode(params);
    const bidPrice = gridPriceNum(i.binStepBps, level);
    const askPrice = gridPriceNum(i.binStepBps, level + 1);

    const binJson: BinV4Json = {
      tokenCat: params.tokenCat,
      ownerCat: params.ownerCat,
      bidNum: params.bidNum.toString(),
      bidDen: params.bidDen.toString(),
      askNum: params.askNum.toString(),
      askDen: params.askDen.toString(),
      variant: 'default',
      managerHash: '00'.repeat(32),
      manageAfter: 0,
    };

    bins.push({
      index: bins.length,
      level,
      side,
      address: '',
      lockingBytecode,
      sats: sats.toString(),
      tokens: tokens.toString(),
      bidSatsPerUnit: bidPrice,
      askSatsPerUnit: askPrice,
      params: binJson,
    });
  };

  bidLevels.forEach((l, k) => {
    if (bidSats[k] && bidSats[k]! > 0n) addBin(l, 'bid', bidSats[k]!, 0n);
  });
  askLevels.forEach((l, k) => {
    if (askToks[k] && askToks[k]! > 0n) addBin(l, 'ask', 1000n, askToks[k]!);
  });

  if (bins.length === 0) {
    addBin(i.marketIndex, 'bid', depositSats > 0n ? depositSats : 10000n, 0n);
  }

  const used = bins.map(b => b.level);
  const commitment: PositionCommitment = {
    version: 1,
    shape: i.shape === 'bidask' ? 'bidAsk' : i.shape,
    variant: 'default',
    tokenCat: i.tokenCat.toLowerCase(),
    binStepBps: i.binStepBps,
    lowIndex: Math.min(...used),
    highIndex: Math.max(...used),
    binCount: bins.length,
    managerHash: '00'.repeat(32),
    createdHeight: 0,
  };
  const commitmentHex = encodeCommitment(commitment);

  const regObj = {
    $schema: 'https://cashtokens.org/bcmr-v2.schema.json',
    version: { major: 2, minor: 0, patch: 0 },
    latestRevision: new Date().toISOString(),
    identities: {
      [category]: {
        [new Date().toISOString()]: {
          name: i.name || `Mesh Position`,
          description: `Mesh V4 liquidity position: ${bins.length} bins on ${i.binStepBps / 100}% grid. Whoever holds this NFT controls the bins.`,
          token: { category, symbol: 'MESH-LP', decimals: 0 },
        },
      },
    },
  };
  const regBytes = utf8ToBytes(JSON.stringify(regObj));
  const sha256Hex = bytesToHex(sha256(regBytes));
  const cid = cidOfSha256(sha256Hex);
  const uri = `ipfs://${cid}`;

  const outputs: V4PlanOutput[] = [
    { role: 'identity', lockingBytecode: ownerLock, valueSatoshis: '800' },
    {
      role: 'nft',
      lockingBytecode: ownerLock,
      valueSatoshis: '1000',
      token: { category, amount: '0', nft: { capability: 'mutable', commitment: commitmentHex } },
    },
    ...bins.map(b => ({
      role: 'bin' as const,
      binIndex: b.index,
      lockingBytecode: b.lockingBytecode,
      valueSatoshis: b.sats,
      ...(BigInt(b.tokens) > 0n ? { token: { category: i.tokenCat.toLowerCase(), amount: b.tokens } } : {}),
    })),
    {
      role: 'metadata',
      lockingBytecode: bcmrPublicationHex(sha256Hex, uri),
      valueSatoshis: '0',
    },
  ];

  const totalSats = bins.reduce((a, b) => a + BigInt(b.sats), 0n);
  const totalTokens = bins.reduce((a, b) => a + BigInt(b.tokens), 0n);
  const outputSats = outputs.reduce((a, o) => a + BigInt(o.valueSatoshis), 0n);

  return {
    category,
    commitment,
    commitmentHex,
    bins,
    outputs,
    metadata: { sha256: sha256Hex, cid, uri, registry: regObj },
    totals: {
      sats: totalSats.toString(),
      tokens: totalTokens.toString(),
      bidBins: bins.filter(b => b.side === 'bid').length,
      askBins: bins.filter(b => b.side === 'ask').length,
      outputSats: outputSats.toString(),
    },
    estimatedBytes: 10 + outputs.length * 75,
    warnings,
    register: {
      method: 'POST',
      path: '/api/v1/v4/positions',
      body: { genesisTxid: '', bins: bins.map(b => b.params) },
    },
  };
}

// ── Mesh server ─────────────────────────────────────────────────────────────

export class MeshServerError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function meshPost<T>(net: BchNet, path: string, body: unknown, fetchImpl: typeof fetch, timeoutMs = 20_000): Promise<T> {
  const base = meshServerUrl(net === 'mainnet');
  if (!base) throw new MeshServerError('No Mesh server is configured for this network.', 0);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api/v1/v4${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new MeshServerError(json.error ?? `Mesh server answered ${res.status}`, res.status);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const doFetch: typeof fetch = (...a) => fetch(...a);

/** Ask the server to lay out a position. Fallback to local on-device planning when offline or unconfigured. */
export async function previewPosition(net: BchNet, input: V4PreviewInput, fetchImpl = doFetch): Promise<V4Plan> {
  try {
    return await meshPost<V4Plan>(net, '/positions/preview', input, fetchImpl);
  } catch (err) {
    // If remote Mesh server fails (503 identity output unconfigured, network down, offline mode),
    // cleanly fall back to local pure on-device position planning!
    return localPlanPosition(input);
  }
}

/** Pin the planned registry (BCMR metadata) to IPFS. Best effort: the position works without it. */
export const pinPositionMetadata = (net: BchNet, category: string, fetchImpl = doFetch) =>
  meshPost<{ pinned: boolean; cid?: string; uri?: string }>(net, `/positions/${category}/metadata`, {}, fetchImpl).catch(() => ({ pinned: false }));

/** Tell the server about a broadcast genesis so it watches the bins and shows the position. */
export const registerPosition = (net: BchNet, plan: V4Plan, genesisTxid: string, pairName?: string, fetchImpl = doFetch) =>
  meshPost<unknown>(net, '/positions', { genesisTxid, bins: plan.register.body.bins, ...(pairName ? { pairName } : {}) }, fetchImpl);
