/**
 * MeshBinV4 bins: encoding, locking bytecode, owner unlocking. Pure JS (noble), no libauth.
 *
 * Port of frontend/src/lib/mesh/v4/binV4.ts (itself a port of meshserver src/pools/v4/binV4.ts and the
 * contracts' v4_encode.ts). The template bodies are the audited contracts' compiled bytecode after the
 * parameter prefix; they are checked byte for byte against the contracts repo's vectors in tests.
 *
 * The wallet uses this to recompute every bin address a Mesh server plan names before it pays one: the
 * server is never trusted with where money goes.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export const BIN_MIN_SATS = 1000n;
export const NO_MANAGER = '00'.repeat(32);
export const VARIANTS = ['default', 'locked', 'vesting', 'feeSchedule', 'sizeFee'] as const;
export type BinVariant = (typeof VARIANTS)[number];

/** Compiled template bodies (MeshBinV4*.json debug.bytecode). */
const BODIES: Record<BinVariant, string> = {
  default: '5879009c63c076cd78c78876ce78d1785479877b00879b6976537a877c00879b6976d2008876cc02e803a26976d378d09478cc7bc694707c5379009f6356797b757c577977687c817c816ea300a0697b957b7b959300a2697b817b81957c817b8195a2696d6d51675879519c63597a567a78ce7601207f757b8882777ccf8277930120a0696d6d6d6d5167587a529d567a00c702aa207b7e01877e88567a81b16d6d6d75516868',
  locked: '5879009c63c076cd78c78876ce78d1785479877b00879b6976537a877c00879b6976d2008876cc02e803a26976d378d09478cc7bc694707c5379009f6356797b757c577977687c817c816ea300a0697b957b7b959300a2697b817b81957c817b8195a269827701209c77777767587a519d567a00c702aa207b7e01877e88567a81b16d6d6d755168',
  vesting: '5979009c63c076cd78c78876ce78d1785479877b00879b6976537a877c00879b6976d2008876cc02e803a26976d378d09478cc7bc694707c5379009f6356797b757c577977687c817c816ea300a0697b957b7b959300a2697b817b81957c817b8195a2696d6d7551675979519c635a7a567a78ce7601207f757b8882777ccf8277930120a069577a81b16d6d6d6d755167597a529d567a00c702aa207b7e01877e88567a81b16d6d6d6d516868',
  feeSchedule: '5d79009c63c076cd78c78876ce78d1785479877b00879b6976537a877c00879b6976d2008876cc02e803a26976d378d09478cc7bc694597a5f79519c635a7981b1755b7977675f79529c635c7981b1755d7977675f79009d6868817600021027a569537955790210275379945579009f63587972777b59797b757c02102754799377687b817b816ea300a069547a9502102795547a7b957b959300a269537a81537a81957b81537a8195a2696d6d6d6d6d51675d79519c635e7a567a78ce7601207f757b8882777ccf8277930120a0696d6d6d6d6d6d7551675d7a529d567a00c702aa207b7e01877e88567a81b16d6d6d6d6d6d516868',
  sizeFee: '5c79009c63c076cd78c78876ce78d1785479877b00879b6976537a877c00879b6976d2008876cc02e803a26976d378d09478cc7bc6945b7a815c7a815b7a815c7a81537900a069527900021027a569780054798ba5697600a2697b5379957b5379957b00567990557994a49593a3547956790210275479955379945679009f63597972777b5a797b757c02102755799554799377687b817b816ea300a069557a9502102795547a95547a7b957b959300a269537a81537a81957b81537a8195a2696d6d7551675c79519c635d7a567a78ce7601207f757b8882777ccf8277930120a0696d6d6d6d6d6d51675c7a529d567a00c702aa207b7e01877e88567a81b16d6d6d6d6d75516868',
};

/** Function selectors in ABI order (locked has no owner path). */
const SELECTOR: Record<BinVariant, { fill: number; owner?: number; manage: number }> = {
  default: { fill: 0, owner: 1, manage: 2 }, locked: { fill: 0, manage: 1 }, vesting: { fill: 0, owner: 1, manage: 2 },
  feeSchedule: { fill: 0, owner: 1, manage: 2 }, sizeFee: { fill: 0, owner: 1, manage: 2 },
};

export interface FeeSchedule { fee0: number; h1: number; fee1: number; h2: number; fee2: number }
export interface SizeFee { baseFee: number; slope: number; refSize: bigint; maxFee: number }

export interface BinV4Params {
  variant?: BinVariant;
  tokenCat: string;          // display order, 64 hex
  bidNum: bigint; bidDen: bigint;
  askNum: bigint; askDen: bigint;
  ownerCat: string;          // display order, 64 hex: the position NFT category
  managerHash?: string;      // 64 hex; zero = no manager
  manageAfter?: number;      // block height
  unlockHeight?: number;     // vesting
  fees?: FeeSchedule;        // feeSchedule
  sizeFee?: SizeFee;         // sizeFee
}

/** Bin parameters as the API sends them (integers as decimal strings). */
export type BinV4Json = Record<string, unknown>;

export class BinV4ParamError extends Error {}

const is64 = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const isHeight = (h: unknown) => Number.isInteger(h) && (h as number) >= 0 && (h as number) < 500_000_000;
const isBps = (f: unknown) => Number.isInteger(f) && (f as number) >= 0 && (f as number) < 10_000;

/** Little-endian positive integer of exactly `bytes` bytes (top bit clear), as hex. */
export function le(v: bigint | number, bytes: number): string {
  let x = BigInt(v);
  if (x < 0n || x >= 1n << BigInt(bytes * 8 - 1)) throw new BinV4ParamError(`value ${v} does not fit ${bytes} signed bytes`);
  let out = '';
  for (let i = 0; i < bytes; i++) { out += (x & 0xffn).toString(16).padStart(2, '0'); x >>= 8n; }
  return out;
}
/** Display-order category → the order the VM's introspection pushes. */
export const catVm = (c: string) => c.match(/.{2}/g)!.reverse().join('');

export function validateBinV4(p: BinV4Params): void {
  const fail = (m: string): never => { throw new BinV4ParamError(`invalid V4 bin: ${m}`); };
  const v = p.variant ?? 'default';
  if (!VARIANTS.includes(v)) fail(`unknown variant ${v}`);
  if (!is64(p.tokenCat)) fail('tokenCat must be 64 lowercase hex');
  if (!is64(p.ownerCat)) fail('ownerCat must be 64 lowercase hex');
  if (p.tokenCat === p.ownerCat) fail('ownerCat must differ from tokenCat');
  if (/^0{64}$/.test(p.tokenCat)) fail('tokenCat must be a token, not zero');
  if (p.managerHash !== undefined && !is64(p.managerHash)) fail('managerHash must be 64 lowercase hex');
  if (!isHeight(p.manageAfter ?? 0)) fail('manageAfter must be a block height (0..499,999,999)');
  for (const [k, x] of Object.entries({ bidNum: p.bidNum, bidDen: p.bidDen, askNum: p.askNum, askDen: p.askDen })) {
    if (typeof x !== 'bigint' || x <= 0n || x >= 1n << 63n) fail(`${k} must be 1..2^63-1`);
  }
  if (p.askNum * p.bidDen < p.bidNum * p.askDen) fail('ask must be ≥ bid');
  if (v === 'vesting' && !isHeight(p.unlockHeight)) fail('vesting needs unlockHeight, a block height');
  if (v === 'feeSchedule') {
    const f = p.fees ?? fail('feeSchedule needs fees');
    if (![f.fee0, f.fee1, f.fee2].every(isBps)) fail('fees must be 0..9999 bps');
    if (!(f.fee0 >= f.fee1 && f.fee1 >= f.fee2)) fail('fees must not rise over time (fee0 ≥ fee1 ≥ fee2)');
    if (!isHeight(f.h1) || !isHeight(f.h2) || f.h1 > f.h2) fail('h1 ≤ h2, both block heights');
  }
  if (v === 'sizeFee') {
    const s = p.sizeFee ?? fail('sizeFee needs sizeFee');
    if (!isBps(s.maxFee) || !isBps(s.baseFee) || s.baseFee > s.maxFee) fail('0 ≤ baseFee ≤ maxFee < 10000');
    if (!Number.isInteger(s.slope) || s.slope < 0 || s.slope >= 1 << 15) fail('slope must be 0..32767');
    if (typeof s.refSize !== 'bigint' || s.refSize <= 0n || s.refSize >= 1n << 63n) fail('refSize must be 1..2^63-1');
  }
  if (v !== 'vesting' && p.unlockHeight !== undefined) fail('unlockHeight is only for vesting');
  if (v !== 'feeSchedule' && p.fees !== undefined) fail('fees are only for feeSchedule');
  if (v !== 'sizeFee' && p.sizeFee !== undefined) fail('sizeFee is only for sizeFee');
}

/** Constructor arguments as hex, in declaration order. */
export function binV4Args(p: BinV4Params): string[] {
  const v = p.variant ?? 'default';
  const args = [
    catVm(p.tokenCat), le(p.bidNum, 8), le(p.bidDen, 8), le(p.askNum, 8), le(p.askDen, 8),
    catVm(p.ownerCat), p.managerHash ?? NO_MANAGER, le(p.manageAfter ?? 0, 4),
  ];
  if (v === 'vesting') args.push(le(p.unlockHeight!, 4));
  if (v === 'feeSchedule') { const f = p.fees!; args.push(le(f.fee0, 2), le(f.h1, 4), le(f.fee1, 2), le(f.h2, 4), le(f.fee2, 2)); }
  if (v === 'sizeFee') { const s = p.sizeFee!; args.push(le(s.baseFee, 2), le(s.slope, 2), le(s.refSize, 8), le(s.maxFee, 2)); }
  return args;
}

const pushHex = (h: string) => (h.length / 2).toString(16).padStart(2, '0') + h;   // every arg is ≤ 75 bytes

/** The parameter prefix of the redeem script (pushes run last argument first). */
export function binV4Prefix(p: BinV4Params): string {
  return binV4Args(p).slice().reverse().map(pushHex).join('');
}

export function binV4RedeemHex(p: BinV4Params): string {
  validateBinV4(p);
  return binV4Prefix(p) + BODIES[p.variant ?? 'default'];
}

export const hash256Hex = (hex: string) => bytesToHex(sha256(sha256(hexToBytes(hex))));

export function binV4ScriptHash(p: BinV4Params): string {
  return hash256Hex(binV4RedeemHex(p));
}

/** P2SH32 locking bytecode, hex. */
export function binV4LockingBytecode(p: BinV4Params): string {
  return `aa20${binV4ScriptHash(p)}87`;
}

/** Minimal push of a script number (OP_0, OP_1..OP_16, else a minimal VM-number push). */
export function pushNumberHex(n: bigint | number): string {
  const x = BigInt(n);
  if (x === 0n) return '00';
  if (x >= 1n && x <= 16n) return (0x50 + Number(x)).toString(16);
  if (x === -1n) return '4f';
  const neg = x < 0n;
  let m = neg ? -x : x;
  const bytes: number[] = [];
  while (m > 0n) { bytes.push(Number(m & 0xffn)); m >>= 8n; }
  if (bytes[bytes.length - 1]! & 0x80) bytes.push(neg ? 0x80 : 0x00);
  else if (neg) bytes[bytes.length - 1]! |= 0x80;
  return pushHex(bytesToHex(Uint8Array.from(bytes)));
}

/** Push of arbitrary data with the smallest opcode (used for the redeem script). */
export function pushDataHex(hex: string): string {
  const n = hex.length / 2;
  if (n <= 75) return pushHex(hex);
  if (n <= 0xff) return '4c' + n.toString(16).padStart(2, '0') + hex;
  if (n <= 0xffff) return '4d' + le(n, 3).slice(0, 4) + hex;
  return '4e' + le(n, 5).slice(0, 8) + hex;
}

/** Unlocking bytecode for fill() (or fill(tier) on the fee-schedule variant). */
export function binV4FillUnlocking(p: BinV4Params, tier = 0): string {
  const v = p.variant ?? 'default';
  const args = v === 'feeSchedule' ? pushNumberHex(tier) : '';
  return args + pushNumberHex(SELECTOR[v].fill) + pushDataHex(binV4RedeemHex(p));
}

/** Unlocking bytecode for owner(k): input k carries the position NFT. */
export function binV4OwnerUnlocking(p: BinV4Params, k: number): string {
  const v = p.variant ?? 'default';
  const sel = SELECTOR[v].owner;
  if (sel === undefined) throw new BinV4ParamError(`the ${v} variant has no owner path`);
  return pushNumberHex(k) + pushNumberHex(sel) + pushDataHex(binV4RedeemHex(p));
}

/** Unlocking bytecode for manage() (manager at input 0, locktime ≥ manageAfter). */
export function binV4ManageUnlocking(p: BinV4Params): string {
  const v = p.variant ?? 'default';
  return pushNumberHex(SELECTOR[v].manage) + pushDataHex(binV4RedeemHex(p));
}

const big = (v: unknown, f: string): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  throw new BinV4ParamError(`${f} must be a non-negative integer (number or decimal string)`);
};

/** Parse API/JSON bin parameters (integers as numbers or decimal strings) and validate. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseBinV4(body: any): BinV4Params {
  const p: BinV4Params = {
    ...(body?.variant !== undefined ? { variant: body.variant } : {}),
    tokenCat: String(body?.tokenCat ?? '').toLowerCase(),
    bidNum: big(body?.bidNum, 'bidNum'), bidDen: big(body?.bidDen, 'bidDen'),
    askNum: big(body?.askNum, 'askNum'), askDen: big(body?.askDen, 'askDen'),
    ownerCat: String(body?.ownerCat ?? '').toLowerCase(),
    ...(body?.managerHash !== undefined ? { managerHash: String(body.managerHash).toLowerCase() } : {}),
    ...(body?.manageAfter !== undefined ? { manageAfter: Number(body.manageAfter) } : {}),
    ...(body?.unlockHeight !== undefined ? { unlockHeight: Number(body.unlockHeight) } : {}),
    ...(body?.fees !== undefined ? { fees: { fee0: Number(body.fees.fee0), h1: Number(body.fees.h1), fee1: Number(body.fees.fee1), h2: Number(body.fees.h2), fee2: Number(body.fees.fee2) } } : {}),
    ...(body?.sizeFee !== undefined ? { sizeFee: { baseFee: Number(body.sizeFee.baseFee), slope: Number(body.sizeFee.slope), refSize: big(body.sizeFee.refSize, 'refSize'), maxFee: Number(body.sizeFee.maxFee) } } : {}),
  };
  validateBinV4(p);
  return p;
}
