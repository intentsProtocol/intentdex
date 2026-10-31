import { describe, expect, it } from 'vitest';
import {
  base58, bytesToHex, encodeErc20Allowance, encodeErc20Approve, encodeErc20BalanceOf, encodeErc20Transfer,
  encodeReceiveMessage, evmTxHash, fromBase64, hexToBytes, toBase64,
  loadJournal, resumeBridge, runSolanaSwap, startBridge, BurnNotReported, FeeNotSent, SwapServerError,
  type BridgeDeps, type CctpChain, type EvmSender, type Transfer,
} from '../src';

const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const B = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Expected values were produced with ethers 6 (Interface.encodeFunctionData, keccak256 of a signed transaction).
describe('EVM calls, encoded by hand', () => {
  it('matches ethers for the ERC-20 calls', () => {
    expect(encodeErc20Transfer(A, 1234567n)).toBe('0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000000000000000000000000000000000000012d687');
    expect(encodeErc20Approve(A, 2n ** 256n - 1n)).toBe('0x095ea7b300000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    expect(encodeErc20Allowance(B, A)).toBe('0xdd62ed3e000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8');
    expect(encodeErc20BalanceOf(B)).toBe('0x70a08231000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  });

  it('matches ethers for receiveMessage, whose two arguments are dynamic', () => {
    expect(encodeReceiveMessage(`0x${'ab'.repeat(70)}`, `0x${'cd'.repeat(65)}`)).toBe(
      '0x57ecfd28'
      + '0000000000000000000000000000000000000000000000000000000000000040'
      + '00000000000000000000000000000000000000000000000000000000000000c0'
      + '0000000000000000000000000000000000000000000000000000000000000046'
      + 'ab'.repeat(70) + '00'.repeat(26)
      + '0000000000000000000000000000000000000000000000000000000000000041'
      + 'cd'.repeat(65) + '00'.repeat(31));
    expect(encodeReceiveMessage('0x', `0x${'11'.repeat(32)}`)).toBe(
      '0x57ecfd28'
      + '0000000000000000000000000000000000000000000000000000000000000040'
      + '0000000000000000000000000000000000000000000000000000000000000060'
      + '0000000000000000000000000000000000000000000000000000000000000000'
      + '0000000000000000000000000000000000000000000000000000000000000020'
      + '11'.repeat(32));
  });

  it('refuses what is not an address', () => {
    expect(() => encodeErc20Transfer('0x1234', 1n)).toThrow(/not an EVM address/);
  });

  it('hashes a signed transaction the way the network does', () => {
    expect(evmTxHash('0x02f86d83014a3403843b9aca00843b9aca008252089470997970c51812dc3a010c7d01b50e0d17dc79c80180c001a0fb5b739600764fde1b02b1b842295cb59eed0f8de6773105df4d1928ac16e52fa012d6ad05b9206940a050bbd54b2a60ec7b6eb1eb54593ed4b4f254fdf67ed111'))
      .toBe('0xa6d367c8ff86003fb067c4b295d4ed01d59315f265416446bf59aaf5db35ace0');
  });
});

describe('encodings', () => {
  it('base64 round-trips every length, with and without padding', () => {
    for (let n = 0; n < 70; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const text = toBase64(bytes);
      expect(text).toBe(btoa(String.fromCharCode(...bytes)));
      expect(bytesToHex(fromBase64(text))).toBe(bytesToHex(bytes));
    }
  });

  it('base58 keeps leading zero bytes and writes zero as one digit per byte', () => {
    expect(base58(hexToBytes('00'))).toBe('1');
    expect(base58(hexToBytes('0000'))).toBe('11');
    expect(base58(hexToBytes('0005'))).toBe('16');
    // The System Program: 32 zero bytes.
    expect(base58(new Uint8Array(32))).toBe('11111111111111111111111111111111');
    expect(base58(hexToBytes('ff'))).toBe('5Q');
  });
});

// ── the bridge flow, with a server and wallets that only record what they were asked ──

const evmChain = { key: 'base-sepolia', kind: 'evm', chainId: 84532, name: 'Base Sepolia', usdc: A } as unknown as CctpChain;
const solChain = { key: 'solana-devnet', kind: 'solana', name: 'Solana Devnet', usdc: 'mint' } as unknown as CctpChain;
const record = (patch: Partial<Transfer> = {}) => ({ id: 't1', status: 'CREATED', src: 'base-sepolia', dst: 'arb-sepolia', ...patch }) as Transfer;
const memory = () => { let v: string | null = null; return { read: async () => v, write: async (x: string) => { v = x; } }; };

function harness(opts: { failBroadcastOf?: string; failReportOf?: string } = {}) {
  const log: string[] = [];
  const api = {
    createTransfer: async () => ({
      transfer: record(), quote: {} as never,
      txs: [
        { kind: 'approve', chain: 'evm', chainId: 84532, to: A, data: '0x01', value: '0' },
        { kind: 'burn', chain: 'evm', chainId: 84532, to: A, data: '0x02', value: '0' },
        { kind: 'fee', chain: 'evm', chainId: 84532, to: A, data: '0x03', value: '0' },
      ],
    }),
    rebuildTransfer: async () => { log.push('rebuild'); return { transfer: record(), txs: [{ kind: 'burn', chain: 'evm', chainId: 84532, to: A, data: '0x02', value: '0' }] }; },
    submitBurn: async (_id: string, hash: string) => {
      if (opts.failReportOf === 'burn') throw new SwapServerError(0, 'NETWORK', 'no answer');
      log.push(`report burn ${hash}`); return record({ status: 'BURN_SUBMITTED', burnTxHash: hash } as Partial<Transfer>);
    },
    submitFee: async (_id: string, hash: string) => { log.push(`report fee ${hash}`); return record({ feeTxHash: hash } as Partial<Transfer>); },
    getTransfer: async () => record(),
    trackBurn: async () => record(),
  };
  const sender: EvmSender = {
    send: async (tx, o) => {
      const hash = `0xhash${tx.data.slice(2)}`;
      await o?.onHash?.(hash);
      log.push(`journal at broadcast of ${tx.data}: ${JSON.stringify(journalView())}`);
      if (opts.failBroadcastOf === tx.data) throw new Error('nonce too low');
      log.push(`broadcast ${tx.data}`);
      return { hash, wait: async () => { log.push(`mined ${tx.data}`); } };
    },
  };
  let journalView: () => unknown = () => ({});
  const build = async (): Promise<BridgeDeps> => {
    const journal = await loadJournal(memory(), () => 1000);
    journalView = () => Object.fromEntries(Object.entries(journal.all()).map(([k, v]) => [k, { burn: v.burn, fee: v.fee }]));
    return { api: api as unknown as BridgeDeps['api'], journal, evm: () => sender, retryDelayMs: 0 };
  };
  return { log, build };
}

const input = { src: evmChain, dst: evmChain, amount: '1', sender: B, recipient: B };

describe('the bridge flow', () => {
  it('signs approve, burn and fee in order, and writes each hash down before it is broadcast', async () => {
    const h = harness();
    const deps = await h.build();
    await startBridge(input, deps);
    expect(h.log).toEqual([
      'journal at broadcast of 0x01: {}',
      'broadcast 0x01', 'mined 0x01',
      'journal at broadcast of 0x02: {"t1":{"burn":"0xhash02"}}',
      'broadcast 0x02', 'report burn 0xhash02', 'mined 0x02',
      'journal at broadcast of 0x03: {"t1":{"burn":"0xhash02","fee":"0xhash03"}}',
      'broadcast 0x03', 'report fee 0xhash03', 'mined 0x03',
    ]);
    expect(deps.journal.all()).toEqual({});
  });

  it('a fee that fails after the burn is a FeeNotSent, and the burn stays in the journal', async () => {
    const h = harness({ failBroadcastOf: '0x03' });
    const deps = await h.build();
    await expect(startBridge(input, deps)).rejects.toBeInstanceOf(FeeNotSent);
    expect(deps.journal.get('t1')?.burn).toBe('0xhash02');
  });

  it('a burn the server could not be told about is kept, and resuming reports it instead of signing again', async () => {
    const h = harness({ failReportOf: 'burn' });
    const deps = await h.build();
    await expect(startBridge(input, deps)).rejects.toBeInstanceOf(BurnNotReported);
    expect(deps.journal.get('t1')?.burn).toBe('0xhash02');

    const reported: string[] = [];
    const later: BridgeDeps = {
      ...deps,
      api: { ...deps.api, submitBurn: async (_id: string, hash: string) => { reported.push(hash); return record({ status: 'BURN_SUBMITTED' } as Partial<Transfer>); } } as BridgeDeps['api'],
      evm: () => { throw new Error('must not sign again'); },
    };
    await resumeBridge('t1', evmChain, later);
    expect(reported).toEqual(['0xhash02']);
    expect(later.journal.all()).toEqual({});
  });

  it('a Solana burn is signed by the wallet and sent through the caller', async () => {
    const calls: string[] = [];
    const journal = await loadJournal(memory());
    const deps: BridgeDeps = {
      journal, retryDelayMs: 0,
      api: {
        createTransfer: async () => ({ transfer: record({ src: 'solana-devnet' }), quote: {} as never, txs: [{ kind: 'burn', chain: 'solana', serializedTx: 'AAAA' }] }),
        submitBurn: async (_id: string, sig: string) => { calls.push(`report ${sig}`); return record({ status: 'BURN_SUBMITTED' } as Partial<Transfer>); },
      } as unknown as BridgeDeps['api'],
      solana: {
        sign: async b64 => { calls.push(`sign ${b64}`); return { raw: Uint8Array.of(1, 2, 3), signature: 'sig1', blockhash: 'bh' }; },
        send: async raw => { calls.push(`send ${raw.length} (journal ${journal.get('t1')?.burn})`); return 'sig1'; },
      },
    };
    await startBridge({ ...input, src: solChain }, deps);
    expect(calls).toEqual(['sign AAAA', 'send 3 (journal sig1)', 'report sig1']);
  });
});

describe('a Solana swap', () => {
  it('hands the signed transaction back to the server and never sends it itself', async () => {
    const seen: string[] = [];
    const swap = await runSolanaSwap(
      { inputMint: 'a', outputMint: 'b', amount: '1', taker: 'me' },
      {
        api: {
          createSolSwap: async () => ({ swap: { id: 's1' }, tx: { serializedTx: 'BBBB' } }),
          executeSolSwap: async (id: string, signed: string) => { seen.push(`${id} ${signed}`); return { id, terminal: true }; },
          getSolSwap: async () => ({ id: 's1', terminal: true }),
        } as never,
        sign: async () => ({ raw: Uint8Array.of(9, 9, 9), signature: 's', blockhash: 'b' }),
      },
    );
    expect(seen).toEqual(['s1 CQkJ']);
    expect(swap.id).toBe('s1');
  });
});
