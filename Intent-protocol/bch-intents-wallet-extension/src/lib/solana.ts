/**
 * Solana reads and sends for the in-wallet key.
 *
 * Token transfers are built by hand (the two instructions needed are small and stable) so the extension does not
 * carry @solana/spl-token. Both token programs are handled: the program that owns the mint decides.
 */

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import type { NetworkDef } from '@/lib/chains';

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const connections = new Map<string, Connection>();
export function solConnection(net: NetworkDef): Connection {
  let c = connections.get(net.key);
  if (!c) {
    c = new Connection(net.rpc, 'confirmed');
    connections.set(net.key, c);
  }
  return c;
}

export function isSolAddress(a: string): boolean {
  try { return a.length >= 32 && a.length <= 44 && new PublicKey(a).toBase58() === a; } catch { return false; }
}

/** The wallet's Solana keypair from the 64-byte secret WDKProvider derives. */
export const keypairFrom = (secretKey: Uint8Array) => Keypair.fromSecretKey(secretKey);

export async function solBalance(net: NetworkDef, owner: string): Promise<bigint> {
  return BigInt(await solConnection(net).getBalance(new PublicKey(owner)));
}

export interface SplHolding { mint: string; amount: bigint; decimals: number; program: string }

/** Every fungible token account the owner has with a balance, summed per mint, across both token programs. */
export async function splHoldings(net: NetworkDef, owner: string): Promise<SplHolding[]> {
  const conn = solConnection(net);
  const pk = new PublicKey(owner);
  const byMint = new Map<string, SplHolding>();
  for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const res = await conn.getParsedTokenAccountsByOwner(pk, { programId: program }).catch(() => null);
    for (const { account } of res?.value ?? []) {
      const info = (account.data as any)?.parsed?.info;
      const amount = BigInt(info?.tokenAmount?.amount ?? '0');
      const decimals = Number(info?.tokenAmount?.decimals ?? 0);
      if (!info?.mint || amount === 0n || (decimals === 0 && amount === 1n)) continue;   // empty, or an NFT
      const prev = byMint.get(info.mint);
      byMint.set(info.mint, { mint: info.mint, decimals, program: program.toBase58(), amount: (prev?.amount ?? 0n) + amount });
    }
  }
  return [...byMint.values()];
}

const ata = (owner: PublicKey, mint: PublicKey, program: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), program.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

/** CreateIdempotent: makes the recipient's token account if it is missing, and is a no-op otherwise. */
function createAtaIx(payer: PublicKey, account: PublicKey, owner: PublicKey, mint: PublicKey, program: PublicKey) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: program, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** TransferChecked: the amount is checked against the mint's decimals by the program. */
function transferCheckedIx(source: PublicKey, mint: PublicKey, dest: PublicKey, owner: PublicKey, amount: bigint, decimals: number, program: PublicKey) {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

export interface SolSend {
  net: NetworkDef;
  to: string;
  amount: bigint;
  /** Token mint; omit to send SOL. */
  mint?: string;
  decimals?: number;
}

/** What a plain SOL transfer costs, and the rent a token send pays when the recipient has no account yet. */
export const SOL_TRANSFER_FEE = 5000n;
export const SOL_ATA_RENT = 2_039_280n;
export const SOL_RENT_EXEMPT_MIN = 890_880n;

async function buildSolTx(keypair: Keypair, s: SolSend): Promise<{ tx: Transaction; createsAccount: boolean; lastValidBlockHeight: number }> {
  const conn = solConnection(s.net);
  const to = new PublicKey(s.to);
  const tx = new Transaction();
  let createsAccount = false;

  if (!s.mint) {
    tx.add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: to, lamports: s.amount }));
  } else {
    const mint = new PublicKey(s.mint);
    const mintInfo = await conn.getAccountInfo(mint);
    if (!mintInfo) throw new Error('This token does not exist on this network.');
    const program = mintInfo.owner.equals(TOKEN_2022_PROGRAM) ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
    const source = ata(keypair.publicKey, mint, program);
    const dest = ata(to, mint, program);
    createsAccount = !(await conn.getAccountInfo(dest));
    if (createsAccount) tx.add(createAtaIx(keypair.publicKey, dest, to, mint, program));
    tx.add(transferCheckedIx(source, mint, dest, keypair.publicKey, s.amount, s.decimals ?? 0, program));
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  return { tx, createsAccount, lastValidBlockHeight };
}

/** Lamports the send will cost on top of the amount. */
export async function quoteSolSend(keypair: Keypair, s: SolSend): Promise<bigint> {
  const { createsAccount } = await buildSolTx(keypair, s);
  return SOL_TRANSFER_FEE + (createsAccount ? SOL_ATA_RENT : 0n);
}

export async function sendSol(keypair: Keypair, s: SolSend): Promise<string> {
  const conn = solConnection(s.net);
  const { tx, lastValidBlockHeight } = await buildSolTx(keypair, s);
  tx.sign(keypair);
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  // Confirmation is followed in the background by the caller; a slow RPC must not make a sent transfer look failed.
  void conn.confirmTransaction({ signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight }, 'confirmed').catch(() => {});
  return signature;
}

export async function solTxStatus(net: NetworkDef, signature: string): Promise<'confirmed' | 'failed' | 'pending'> {
  try {
    const { value } = await solConnection(net).getSignatureStatuses([signature], { searchTransactionHistory: true });
    const st = value[0];
    if (!st) return 'pending';
    if (st.err) return 'failed';
    return st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized' ? 'confirmed' : 'pending';
  } catch {
    return 'pending';
  }
}

export { LAMPORTS_PER_SOL };
