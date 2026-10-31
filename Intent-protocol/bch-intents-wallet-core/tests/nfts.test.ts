import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configure, decodeCommitment, encodeCommitment, tryDecodeCommitment, gridPriceNum, priceRange,
  getNftMetas, groupNfts, nftId, isPosition, networkOf, meshPositionsHeldBy,
  type NftHolding, type PositionCommitment,
} from '../src';
import vectors from './fixtures/positionNft.vectors.json';

const BCH = networkOf('testnet', 'bch');
const CAT = 'dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b';

afterEach(() => { vi.restoreAllMocks(); });

describe('V4 position commitment codec', () => {
  for (const v of vectors.vectors as Array<{ name: string; fields: PositionCommitment; hex: string }>) {
    it(`decodes and re-encodes "${v.name}"`, () => {
      expect(decodeCommitment(v.hex)).toEqual(v.fields);
      expect(encodeCommitment(v.fields)).toBe(v.hex);
    });
  }

  it('returns null for bytes that are not a v1 commitment', () => {
    expect(tryDecodeCommitment('')).toBeNull();
    expect(tryDecodeCommitment('deadbeef')).toBeNull();        // wrong length
    expect(tryDecodeCommitment('02' + '00'.repeat(81))).toBeNull(); // wrong version
    expect(tryDecodeCommitment('zz'.repeat(82))).toBeNull();   // not hex
  });

  it('a decoded position has a sensible price range', () => {
    const c = decodeCommitment((vectors.vectors as any)[0].hex);
    const { lowSatsPerUnit, highSatsPerUnit } = priceRange(c);
    expect(highSatsPerUnit).toBeGreaterThan(lowSatsPerUnit);
    expect(gridPriceNum(c.binStepBps, c.lowIndex)).toBe(lowSatsPerUnit);
  });
});

describe('NFT model', () => {
  const holding = (commitment: string, name = 'X', position?: NftHolding['position']): NftHolding => ({
    id: nftId(BCH, CAT, commitment), network: BCH, category: CAT, commitment, capability: 'none',
    amount: 0n, utxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1000n }, name, verified: true, position,
  });

  it('builds a stable id and reads positions', () => {
    expect(nftId(BCH, CAT, 'ab')).toBe(`${BCH.key}:${CAT}:ab`);
    expect(isPosition(holding('ab'))).toBe(false);
    expect(isPosition(holding('ab', 'P', { commitment: {} as PositionCommitment }))).toBe(true);
  });

  it('groups by category in first-seen order', () => {
    const OTHER = 'cd'.repeat(32);
    const groups = groupNfts([
      holding('01'), holding('02'),
      { ...holding('03'), category: OTHER, id: nftId(BCH, OTHER, '03') },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].category).toBe(CAT);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].category).toBe(OTHER);
  });
});

describe('getNftMetas', () => {
  it('reads per-commitment metadata and falls back to a placeholder', async () => {
    configure({ storage: memoryStore() });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/deadbeef/')) return json({ type_metadata: { name: 'Golden Key', description: 'A key', uris: { icon: 'ipfs://cid' } } });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const metas = await getNftMetas(CAT, ['deadbeef', 'ffff'], 'chipnet');
    expect(metas.deadbeef).toMatchObject({ name: 'Golden Key', description: 'A key', icon: 'https://ipfs.io/ipfs/cid', known: true });
    expect(metas.ffff).toMatchObject({ known: false });
    expect(metas.ffff.name).toContain('NFT');
  });
});

describe('meshPositionsHeldBy', () => {
  it('returns [] when no Mesh server is configured', async () => {
    configure({ storage: memoryStore(), services: { meshServer: '' } });
    const r = await meshPositionsHeldBy('bchtest:zexample', 'chipnet');
    expect(r).toEqual([]);
  });

  it('returns [] when the server is unreachable, never throws', async () => {
    configure({ storage: memoryStore(), services: { meshServer: 'http://localhost:3001' } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await meshPositionsHeldBy('bchtest:zexample', 'chipnet');
    expect(r).toEqual([]);
  });

  it('reads the positions array on success', async () => {
    configure({ storage: memoryStore(), services: { meshServer: 'http://localhost:3001' } });
    vi.stubGlobal('fetch', vi.fn(async () => json({ holder: 'x', positions: [{ category: CAT }] })));
    const r = await meshPositionsHeldBy('bchtest:zexample', 'chipnet');
    expect(r).toHaveLength(1);
    expect(r[0].category).toBe(CAT);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => { m.set(k, v); }, removeItem: async (k: string) => { m.delete(k); } };
}
