import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNetwork, networkOf } from '@/lib/chains';
import type { Asset } from '@/lib/assets';
import { bchFunder, normalizeRecipient, validateAddress } from '@/lib/send';
import { addActivity, readActivity, updateActivity } from '@/lib/activity';
import { connectSite, disconnectSite, isConnected, readQueue, readSites, writeQueue } from '@/lib/dapp';
import { REQUEST_TTL_MS } from '@/shared/messages';
import { loadJournal } from '@/swap/journal';
import { auctionFloor, createRelayerApi, RelayerError, startCashTokenSwap } from '@/swap/cashtoken';
import { createSwapServerApi, SwapServerError, describeError } from '@/swap/api';
import { EsploraClient } from '@/lib/btc-esplora';

beforeEach(() => (globalThis as any).resetChrome());

const asset = (key: string, kind: Asset['kind'] = 'native'): Asset => {
  const network = getNetwork(key)!;
  return { id: `${key}:x`, network, kind, ref: 'native', symbol: network.native.symbol, name: '', decimals: network.native.decimals, balance: 1n, verified: true };
};
// One key hash, encoded for each network and address form. The checksum differs with the prefix.
const MAIN_Q = 'bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2';
const TEST_Q = 'bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k';
const TEST_Z = 'bchtest:zr6m7j9njldwwzlg9v7v53unlr4jkmx6eyupk748s9';
const bare = (a: string) => a.slice(a.indexOf(':') + 1);

describe('validateAddress', () => {
  it('BCH: accepts the active network, refuses the other one by its prefix', () => {
    expect(validateAddress(asset('bch-chipnet'), TEST_Q)).toBeNull();
    expect(validateAddress(asset('bch-chipnet'), bare(TEST_Q))).toBeNull();
    expect(validateAddress(asset('bch-chipnet'), MAIN_Q)?.key).toBe('address.bchNetwork');
    expect(validateAddress(asset('bch-mainnet'), MAIN_Q)).toBeNull();
    expect(validateAddress(asset('bch-mainnet'), TEST_Q)?.key).toBe('address.bchNetwork');
    expect(validateAddress(asset('bch-mainnet'), '0xabc')?.key).toBe('address.bch');
  });
  it('BCH: one wrong character, or the other network\'s address without its prefix, fails the checksum', () => {
    expect(validateAddress(asset('bch-chipnet'), TEST_Q.replace(/k$/, 'l'))?.key).toBe('address.bch');
    // A bare mainnet address pasted into a chipnet send: the prefix is not there to give it away, the checksum is.
    expect(validateAddress(asset('bch-chipnet'), bare(MAIN_Q))?.key).toBe('address.bch');
  });
  it('a CashToken must go to a token-aware address', () => {
    expect(validateAddress(asset('bch-chipnet', 'cashtoken'), TEST_Q)?.key).toBe('address.token');
    expect(validateAddress(asset('bch-chipnet', 'cashtoken'), TEST_Z)).toBeNull();
  });
  it('EVM, Solana and Bitcoin each refuse the others', () => {
    const evm = '0x318a63dEd371020d25670edeeCeD1E193E8D947E';
    const sol = 'VBmpGVzabx8AsptQXrA2okEwqFVjbuosHvR2NkuBoaS';
    expect(validateAddress(asset('base-sepolia'), evm)).toBeNull();
    expect(validateAddress(asset('base-sepolia'), sol)?.key).toBe('address.evm');
    expect(validateAddress(asset('solana-devnet'), sol)).toBeNull();
    expect(validateAddress(asset('solana-devnet'), evm)?.key).toBe('address.solana');
    expect(validateAddress(asset('btc-testnet'), 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBeNull();
    expect(validateAddress(asset('btc-testnet'), 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')?.key).toBe('address.btc');
    expect(validateAddress(asset('btc-mainnet'), 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBeNull();
  });
  it('an empty address is a problem, not a crash', () => {
    expect(validateAddress(asset('ethereum'), '   ')?.key).toBe('address.empty');
  });
  it('normalizeRecipient adds the prefix a bare cashaddr lacks', () => {
    expect(normalizeRecipient(asset('bch-chipnet'), bare(TEST_Q))).toBe(TEST_Q);
    expect(normalizeRecipient(asset('bch-mainnet'), ` ${bare(MAIN_Q)} `)).toBe(MAIN_Q);
    expect(normalizeRecipient(asset('ethereum'), ' 0xabc ')).toBe('0xabc');
  });
});

describe('activity log', () => {
  it('newest first, updated in place, account lower-cased', async () => {
    const a = await addActivity({ kind: 'send', status: 'pending', network: 'bch-chipnet', account: '0xABC', sent: '1 BCH' });
    await addActivity({ kind: 'swap', status: 'pending', network: 'bch-chipnet', account: '0xabc' });
    await updateActivity(a.id, { status: 'confirmed', txid: 'ff' });
    const all = await readActivity();
    expect(all.map(e => e.kind)).toEqual(['swap', 'send']);
    expect(all[1]).toMatchObject({ status: 'confirmed', txid: 'ff', account: '0xabc' });
  });
  it('is capped so storage cannot grow without bound', async () => {
    for (let i = 0; i < 205; i++) await addActivity({ kind: 'send', status: 'confirmed', network: 'bch-chipnet', account: 'a', id: `e${i}` });
    expect(await readActivity()).toHaveLength(200);
  });
});

describe('connected sites and the request queue', () => {
  it('connect, read, disconnect', async () => {
    expect(await isConnected('https://a.example')).toBe(false);
    await connectSite({ origin: 'https://a.example', title: 'A' });
    expect(await isConnected('https://a.example')).toBe(true);
    expect(Object.keys(await readSites())).toEqual(['https://a.example']);
    await disconnectSite('https://a.example');
    expect(await isConnected('https://a.example')).toBe(false);
  });
  it('a stored value of the wrong shape reads as no sites', async () => {
    (globalThis as any).__store.local.connected_sites = ['https://old.example'];
    expect(await readSites()).toEqual({});
  });
  it('requests their page abandoned drop out of the queue', async () => {
    const base = { origin: 'https://a.example', method: 'bch_requestAccounts', tabId: 1 };
    await writeQueue([{ ...base, requestId: 'old', createdAt: Date.now() - REQUEST_TTL_MS - 1 }, { ...base, requestId: 'new', createdAt: Date.now() }]);
    expect((await readQueue()).map(r => r.requestId)).toEqual(['new']);
  });
});

describe('signing journal', () => {
  it('an entry is on disk when set() resolves, and survives a reload', async () => {
    const j = await loadJournal();
    await j.set('t1', { burn: '0xaa' });
    expect(JSON.parse((globalThis as any).__store.local.swap_server_journal_v1).t1.burn).toBe('0xaa');
    await j.set('t1', { fee: '0xbb' });
    const again = await loadJournal();
    expect(again.get('t1')).toMatchObject({ burn: '0xaa', fee: '0xbb' });
    await again.delete('t1');
    expect((await loadJournal()).all()).toEqual({});
  });
  it('forgets entries older than a day', async () => {
    let now = 1_000_000;
    const mem: { v: string | null } = { v: null };
    const store = { read: async () => mem.v, write: async (v: string) => { mem.v = v; } };
    const j = await loadJournal(store, () => now);
    await j.set('t1', { burn: 'x' });
    now += 25 * 60 * 60_000;
    expect(j.get('t1')).toBeUndefined();
  });
});

describe('cashtoken relayer client', () => {
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  it('quotes in base units and always names the network', async () => {
    const fetchImpl = vi.fn(() => ok({ buyAmount: '12345' }));
    const api = createRelayerApi('chipnet', 'http://relayer', fetchImpl as any);
    expect(await api.quote({ sellToken: 'BCH', buyToken: 'c'.repeat(64), sellAmount: '100000' })).toBe(12345n);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://relayer/router/quote');
    expect(JSON.parse(init.body as string)).toMatchObject({ network: 'chipnet', sellAmount: '100000' });
  });
  it('turns a refusal into an error with the relayer sentence, and silence into "cannot be reached"', async () => {
    const refused = createRelayerApi('chipnet', 'http://relayer', (() => Promise.resolve(new Response(JSON.stringify({ error: 'No pool for token abc' }), { status: 400 }))) as any);
    await expect(refused.quote({ sellToken: 'BCH', buyToken: 'x', sellAmount: '1' })).rejects.toMatchObject({ status: 400, message: 'No pool for token abc' });
    const down = createRelayerApi('chipnet', 'http://relayer', (() => Promise.reject(new TypeError('Failed to fetch'))) as any);
    await expect(down.health()).rejects.toBeInstanceOf(RelayerError);
    await expect(down.health()).rejects.toMatchObject({ status: 0 });
  });
  it('the auction floor is half the quote, as the relayer builds it', () => {
    expect(auctionFloor(1001n)).toBe(500n);
  });
  it('a BCH sale funds the covenant address with exactly the sell amount', async () => {
    const send = vi.fn(async () => ({ txId: 'fundtx' }));
    const stages: string[] = [];
    const res = await startCashTokenSwap(
      { sellToken: 'BCH', buyToken: 'c'.repeat(64), sellAmount: 50_000n, buyAmount: 900n, duration: 60, makerAddress: 'bchtest:q' },
      { api: { createIntent: async () => ({ intentId: 'i1', contractAddress: 'bchtest:pcontract', tokenAddress: 'bchtest:rtoken' }) }, fund: bchFunder({ send }), onStage: s => stages.push(s) },
    );
    expect(res.fundTxId).toBe('fundtx');
    expect(send).toHaveBeenCalledWith([{ cashaddr: 'bchtest:pcontract', value: 50_000n }]);
    expect(stages).toEqual(['create', 'fund', 'filling']);
  });
  it('nothing is signed when the relayer returns no order', async () => {
    const send = vi.fn();
    await expect(startCashTokenSwap(
      { sellToken: 'BCH', buyToken: 'x', sellAmount: 1n, buyAmount: 1n, duration: 60, makerAddress: 'a' },
      { api: { createIntent: async () => ({}) as any }, fund: bchFunder({ send }) },
    )).rejects.toBeInstanceOf(RelayerError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('swap server client', () => {
  it('carries the server code, and reports an unreachable server as such', async () => {
    const paused = createSwapServerApi('http://swap', (() => Promise.resolve(new Response(JSON.stringify({ error: 'paused', code: 'PAUSED' }), { status: 503 }))) as any);
    const err = await paused.getConfig().catch(e => e);
    expect(err).toBeInstanceOf(SwapServerError);
    expect(err.code).toBe('PAUSED');
    expect(describeError(err)).toBe('This service is temporarily unavailable.');
    const down = createSwapServerApi('http://swap', (() => Promise.reject(new TypeError('x'))) as any);
    await expect(down.getConfig()).rejects.toMatchObject({ status: 0, code: 'UNREACHABLE' });
  });
  it('sends bridge amounts as decimal USDC in the query', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    await createSwapServerApi('http://swap', fetchImpl as any).getQuote({ src: 'base-sepolia', dst: 'arb-sepolia', amount: '1.5' });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('http://swap/quote?src=base-sepolia&dst=arb-sepolia&amount=1.5');
  });
});

describe('Esplora Bitcoin client', () => {
  it('maps balances, coins and fee estimates to what WDK expects', async () => {
    const answers: Record<string, unknown> = {
      '/address/tb1x': { chain_stats: { funded_txo_sum: 5000, spent_txo_sum: 1000 }, mempool_stats: { funded_txo_sum: 300, spent_txo_sum: 0 } },
      '/address/tb1x/utxo': [{ txid: 'aa', vout: 1, value: 4000, status: { confirmed: true, block_height: 10 } }, { txid: 'bb', vout: 0, value: 300, status: { confirmed: false } }],
      '/fee-estimates': { '1': 12.5, '3': 4.2, '6': 1.01 },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(answers[url.replace('http://esplora', '')]), { status: 200 })));
    const c = new EsploraClient('http://esplora');
    expect(await c.getBalance('tb1x')).toEqual({ confirmed: 4000, unconfirmed: 300 });
    expect(await c.listUnspent('tb1x')).toEqual([{ tx_hash: 'aa', tx_pos: 1, value: 4000, height: 10 }, { tx_hash: 'bb', tx_pos: 0, value: 300, height: 0 }]);
    // WDK multiplies by 100_000 to get sat/vB.
    expect(await c.estimateFee(3)).toBeCloseTo(4.2 / 100_000, 12);
    expect(await c.estimateFee(2)).toBeCloseTo(4.2 / 100_000, 12);
    expect(await c.feeRate(6)).toBe(2);
    vi.unstubAllGlobals();
  });
});

describe('network lookup', () => {
  it('networkOf gives the single network of a family in a mode', () => {
    expect(networkOf('testnet', 'bch').key).toBe('bch-chipnet');
    expect(networkOf('mainnet', 'solana').key).toBe('solana');
  });
});
