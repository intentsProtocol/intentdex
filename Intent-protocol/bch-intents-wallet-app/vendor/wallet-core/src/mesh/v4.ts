/**
 * Mesh V4 position NFTs: the commitment codec, the price grid, and a read-only client for the Mesh server.
 *
 * The commitment carries everything needed to render a position, so `decodeCommitment` lets the wallet show a
 * position offline, from the NFT alone. The client only adds live value, bins and fills when a Mesh server is
 * reachable; every call returns a safe empty answer instead of throwing, so a dead server never blanks the UI.
 *
 * Port of meshserver `src/pools/v4/{grid,position}.ts` and `frontend/src/lib/mesh/v4/position.ts`, checked
 * against the shared fixture `tests/fixtures/positionNft.vectors.json`. No libauth: this package is pure JS.
 */
import { hexToBytes } from '@noble/hashes/utils';
import { meshServerUrl } from '../platform';
import type { BchNet } from '../cashtokens';

// ── Commitment ──────────────────────────────────────────────────────────────

export const COMMITMENT_V1_LEN = 82;
export const SHAPES = ['spot', 'curve', 'bidAsk', 'custom'] as const;
export type Shape = (typeof SHAPES)[number];
/** Bin variants, in the bitfield order the commitment flags encode (bits 3–5). */
export const VARIANTS = ['default', 'locked', 'vesting', 'feeSchedule', 'sizeFee'] as const;
export type BinVariant = (typeof VARIANTS)[number];

export interface PositionCommitment {
  version: 1;
  shape: Shape;
  variant: BinVariant;
  tokenCat: string;
  binStepBps: number;
  lowIndex: number;
  highIndex: number;
  binCount: number;
  managerHash: string;
  createdHeight: number;
}

export class PositionError extends Error {}

const is64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const isInt = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
const leN = (v: number, bytes: number) => { let x = v, out = ''; for (let i = 0; i < bytes; i++) { out += (x % 256).toString(16).padStart(2, '0'); x = Math.floor(x / 256); } return out; };
/** 4-byte sign-magnitude VM number. */
const sle4 = (v: number) => { const h = leN(Math.abs(v), 4); return v < 0 ? h.slice(0, 6) + (parseInt(h.slice(6), 16) | 0x80).toString(16).padStart(2, '0') : h; };

export function validateCommitment(c: PositionCommitment): void {
  const fail = (m: string): never => { throw new PositionError(`invalid position commitment: ${m}`); };
  if (c.version !== 1) fail('version must be 1');
  if (!SHAPES.includes(c.shape)) fail(`unknown shape ${c.shape}`);
  if (!VARIANTS.includes(c.variant)) fail(`unknown variant ${c.variant}`);
  if (!is64(c.tokenCat)) fail('tokenCat must be 64 lowercase hex');
  if (!isInt(c.binStepBps, 1, 10_000)) fail('binStepBps must be 1..10000');
  if (!isInt(c.lowIndex, -(2 ** 31 - 1), 2 ** 31 - 1) || !isInt(c.highIndex, -(2 ** 31 - 1), 2 ** 31 - 1)) fail('indexes must fit a 4-byte VM number');
  if (c.lowIndex > c.highIndex) fail('lowIndex must be ≤ highIndex');
  if (!isInt(c.binCount, 1, 32_767)) fail('binCount must be 1..32767');
  if (!is64(c.managerHash)) fail('managerHash must be 64 lowercase hex (zeros for none)');
  if (!isInt(c.createdHeight, 0, 499_999_999)) fail('createdHeight must be a block height');
}

export function encodeCommitment(c: PositionCommitment): string {
  validateCommitment(c);
  const flags = SHAPES.indexOf(c.shape) | (VARIANTS.indexOf(c.variant) << 3);
  return '01' + flags.toString(16).padStart(2, '0') + c.tokenCat + leN(c.binStepBps, 2)
    + sle4(c.lowIndex) + sle4(c.highIndex) + leN(c.binCount, 2) + c.managerHash + leN(c.createdHeight, 4);
}

/** Strict decoder: anything but a well-formed v1 commitment throws. */
export function decodeCommitment(hex: string): PositionCommitment {
  const fail = (m: string): never => { throw new PositionError(`invalid position commitment: ${m}`); };
  if (!/^([0-9a-f]{2})*$/.test(hex)) fail('not lowercase hex');
  if (hex.length !== COMMITMENT_V1_LEN * 2) fail(`length ${hex.length / 2}, expected ${COMMITMENT_V1_LEN}`);
  const b = hexToBytes(hex);
  if (b[0] !== 1) fail(`version ${b[0]}`);
  const flags = b[1]!;
  if (flags & 0xc0) fail('reserved flag bits set');
  if ((flags & 7) >= SHAPES.length) fail('unknown shape');
  if (((flags >> 3) & 7) >= VARIANTS.length) fail('unknown variant');
  const u = (o: number, n: number) => { let x = 0; for (let i = n - 1; i >= 0; i--) x = x * 256 + b[o + i]!; return x; };
  const s4 = (o: number) => { const mag = u(o, 4) % 0x80000000; return b[o + 3]! & 0x80 ? -mag : mag; };
  const c: PositionCommitment = {
    version: 1, shape: SHAPES[flags & 7]!, variant: VARIANTS[(flags >> 3) & 7]!,
    tokenCat: hex.slice(4, 68), binStepBps: u(34, 2), lowIndex: s4(36), highIndex: s4(40),
    binCount: u(44, 2), managerHash: hex.slice(92, 156), createdHeight: u(78, 4),
  };
  if (Object.is(c.lowIndex, -0) || Object.is(c.highIndex, -0)) fail('negative zero index');
  validateCommitment(c);
  return c;
}

/** A Mesh V4 position commitment, or null when the bytes are not one (every other NFT). Never throws. */
export function tryDecodeCommitment(hex: string): PositionCommitment | null {
  try { return decodeCommitment(hex); } catch { return null; }
}

// ── Grid ──────────────────────────────────────────────────────────────────────

export const Q = 64n;
export const ONE = 1n << Q;

/** Q64 grid price: the same integer the covenant computes (exponentiation by squaring, floor after every multiply). */
export function gridPrice(step: bigint | number, index: bigint | number): bigint {
  const s = BigInt(step);
  let e = BigInt(index);
  let base = (ONE * (10000n + s)) / 10000n;
  if (e < 0n) { base = (ONE * 10000n) / (10000n + s); e = -e; }
  let result = ONE;
  while (e > 0n) {
    if (e % 2n === 1n) result = (result * base) >> Q;
    base = (base * base) >> Q;
    e >>= 1n;
  }
  return result;
}

/**
 * A grid price as a bytes8 fraction num/den (both < 2^63), as a bin stores it: `down` for a bid, `up` for an
 * ask. Port of frontend/src/lib/mesh/v4/position.ts#gridFraction.
 */
export function gridFraction(step: number, index: number, round: 'down' | 'up'): { num: bigint; den: bigint } {
  const p = gridPrice(step, index);
  let shift = 0n;
  while ((p >> shift) >= 1n << 62n) shift++;
  const den = ONE >> shift;
  if (den === 0n) throw new RangeError('price too large for a bytes8 fraction');
  const floor = p >> shift;
  const num = round === 'up' && (floor << shift) !== p ? floor + 1n : floor;
  // den = 2^(64-shift) must also fit bytes8 (< 2^63): drop one more bit of precision if needed.
  if (den >= 1n << 63n) {
    const n2 = round === 'up' ? (num + 1n) >> 1n : num >> 1n;
    return { num: n2, den: den >> 1n };
  }
  return { num, den };
}

/** Grid price in sats per token unit, as a number (display). */
export const gridPriceNum = (step: number, i: number) => Number(gridPrice(step, i)) / Number(ONE);

/** The price range a position spans, in sats per token unit: the lowest bin's bid to the highest bin's ask. */
export function priceRange(c: PositionCommitment): { lowSatsPerUnit: number; highSatsPerUnit: number } {
  return { lowSatsPerUnit: gridPriceNum(c.binStepBps, c.lowIndex), highSatsPerUnit: gridPriceNum(c.binStepBps, c.highIndex + 1) };
}

// ── Mesh server client (read-only) ──────────────────────────────────────────

/** A bin of a V4 position, as the server reports it (integers that can exceed 2^53 are decimal strings). */
export interface MeshBinView {
  index: number;
  address: string;
  variant: string;
  bid: { num: string; den: string; satsPerUnit: number };
  ask: { num: string; den: string; satsPerUnit: number };
  utxos: Array<{ txid: string; vout: number; sats: string; tokens: string }>;
  sats: string;
  tokens: string;
}

export interface MeshPositionView {
  category: string;
  genesisTxid: string;
  nftOutput: number;
  pairName: string | null;
  commitment: PositionCommitment;
  metadata: { sha256: string; uri: string; uris?: string[] } | null;
  holder: { address?: string; lockingBytecode: string } | null;
  totals: { sats: string; tokens: string; valueAtBidSats: string; bins: number; binsWithTokens: number };
  bins: MeshBinView[];
  registeredAt: string;
  nft?: { txid: string; vout: number; commitment: string; capability: string };
}

export type MeshActivityKind = 'deposit' | 'buy' | 'sell' | 'top-up' | 'withdraw';
export interface MeshActivityEvent {
  txid: string;
  height: number;
  bin: number;
  kind: MeshActivityKind;
  dSats: string;
  dTokens: string;
  satsPerUnit: number | null;
}

async function meshGet<T>(net: BchNet, path: string, fallback: T, timeoutMs = 8000): Promise<T> {
  const base = meshServerUrl(net === 'mainnet');
  if (!base) return fallback;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/v1/v4${path}`, { signal: ctrl.signal });
    if (!res.ok) return fallback;
    return ((await res.json()) as T) ?? fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** Positions whose NFT `tokenAddress` holds (ownership follows the NFT). Empty when no Mesh server is set or reachable. */
export async function meshPositionsHeldBy(tokenAddress: string, net: BchNet): Promise<MeshPositionView[]> {
  const body = await meshGet<{ positions?: MeshPositionView[] }>(net, `/positions?holder=${encodeURIComponent(tokenAddress)}`, {});
  return body.positions ?? [];
}

/** One position with live bins, or null. */
export async function meshPosition(category: string, net: BchNet): Promise<MeshPositionView | null> {
  const body = await meshGet<MeshPositionView | { error: string } | null>(net, `/positions/${category}`, null);
  return body && !('error' in body) ? body : null;
}

/** A position's deposits, fills and withdrawals, newest first. Empty on failure. */
export async function meshPositionActivity(category: string, net: BchNet, limit = 100): Promise<MeshActivityEvent[]> {
  const body = await meshGet<{ events?: MeshActivityEvent[] }>(net, `/positions/${category}/activity?limit=${limit}`, {});
  return body.events ?? [];
}
