/**
 * Sending an asset, on any of the four families. The rules are the browser extension's (lib/send.ts there);
 * what differs is who signs: here it is the wallet module for the asset's network, inside the worklet.
 */
import type { Asset } from '@bch-intents/wallet-core/assets';
import type { NftHolding } from '@bch-intents/wallet-core/nfts';
import { isEvmAddress, isSolAddress, normalizeRecipient, validateAddress, type AddressProblem } from '@bch-intents/wallet-core/validation';
import type { BchFunder } from '@bch-intents/wallet-core/swap/cashtoken';
import { account, addressOf, type TxResult } from '@/wdk/bridge';
import { quoteEvmSend, sendEvm } from './evm';
import { solRpc } from './rpc';

export { validateAddress, normalizeRecipient, type AddressProblem };

export interface SendQuote {
  /** Network fee in base units of the network's native asset. */
  fee: bigint;
  /** The most of this asset that can be sent, after the fee where the fee is paid in the same asset. */
  max: bigint;
  /** False when the native balance cannot pay the fee (for a token send). */
  canPayFee: boolean;
}

const BCH_FEE_ESTIMATE = 400n;      // sats; a one-input, two-output P2PKH is ~220 bytes at 1 sat/byte
const BCH_TOKEN_FEE_ESTIMATE = 1200n;
export const BCH_DUST = 546n;
const TOKEN_OUTPUT_SATS = 1000n;

export const SOL_TRANSFER_FEE = 5000n;
/** Rent a new token account costs the sender when the recipient has never held the token. */
export const SOL_ATA_RENT = 2_039_280n;
export const SOL_RENT_EXEMPT_MIN = 890_880n;

const hashOf = (res: TxResult | null | undefined): string => {
  if (!res?.hash) throw new Error('The network did not accept the transaction.');
  return res.hash;
};

/** Transfers a CashToken NFT (the whole coin moves). The recipient must be a token-aware BCH address. */
export async function sendNft(nft: NftHolding, accountIndex: number, recipient: string): Promise<string> {
  const wallet = account(nft.network.key, accountIndex);
  return hashOf(await wallet.transferNft({ token: nft.category, commitment: nft.commitment, recipient }));
}

/** Quotes the network fee of an NFT transfer. Throws the worklet's error (e.g. a non-token-aware recipient). */
export async function quoteNftTransfer(nft: NftHolding, accountIndex: number, recipient: string): Promise<bigint> {
  const wallet = account(nft.network.key, accountIndex);
  const { fee } = await wallet.quoteTransferNft({ token: nft.category, commitment: nft.commitment, recipient });
  return BigInt(fee);
}

/** The two payments a BCH swap can need, made by the active account's wallet module. */
export function bchFunder(network: string, accountIndex: number): BchFunder {
  const wallet = account(network, accountIndex);
  return {
    sendBch: async (cashaddr, satoshis) => hashOf(await wallet.sendTransaction({ to: cashaddr, value: satoshis.toString() })),
    sendToken: async (cashaddr, category, amount, satoshis) =>
      hashOf(await wallet.transfer({ token: category, recipient: cashaddr, amount: amount.toString(), value: satoshis.toString() })),
  };
}

export async function quoteSend(asset: Asset, accountIndex: number, to: string, amount: bigint, nativeBalance: bigint): Promise<SendQuote> {
  const net = asset.network;
  const wallet = account(net.key, accountIndex);
  switch (net.family) {
    case 'bch': {
      if (asset.kind === 'cashtoken') {
        const fee = BCH_TOKEN_FEE_ESTIMATE + TOKEN_OUTPUT_SATS;
        return { fee, max: asset.balance, canPayFee: nativeBalance >= fee };
      }
      let max = asset.balance > BCH_FEE_ESTIMATE ? asset.balance - BCH_FEE_ESTIMATE : 0n;
      let fee = BCH_FEE_ESTIMATE;
      try {
        const m = await wallet.call<{ amount: string; fee: string }>('getMaxSpendable');
        max = BigInt(m.amount);
        fee = BigInt(m.fee) || fee;
      } catch { /* keep the estimate */ }
      return { fee, max, canPayFee: true };
    }
    case 'evm': {
      const from = await addressOf(net.key, accountIndex);
      const probe = amount > 0n ? amount : 1n;
      const q = await quoteEvmSend({ net, from, to: isEvmAddress(to) ? to : from, amount: asset.kind === 'native' ? 0n : probe, token: asset.kind === 'erc20' ? asset.ref : undefined });
      if (asset.kind === 'native') return { fee: q.feeWei, max: asset.balance > q.feeWei ? asset.balance - q.feeWei : 0n, canPayFee: asset.balance > q.feeWei };
      return { fee: q.feeWei, max: asset.balance, canPayFee: nativeBalance >= q.feeWei };
    }
    case 'solana': {
      let fee = SOL_TRANSFER_FEE;
      if (asset.kind === 'spl' && isSolAddress(to)) {
        fee = await wallet.quoteTransfer({ token: asset.ref, recipient: to, amount: (amount || 1n).toString() }).then(q => BigInt(q.fee)).catch(() => SOL_TRANSFER_FEE);
      }
      if (asset.kind === 'native') return { fee, max: asset.balance > fee ? asset.balance - fee : 0n, canPayFee: asset.balance > fee };
      return { fee, max: asset.balance, canPayFee: nativeBalance >= fee };
    }
    case 'btc': {
      try {
        const m = await wallet.call<{ amount: string; fee: string }>('getMaxSpendable');
        return { fee: BigInt(m.fee ?? 0), max: BigInt(m.amount), canPayFee: BigInt(m.amount) > 0n };
      } catch {
        const fee = 141n * 3n;   // one P2WPKH input, two outputs, at a modest rate
        return { fee, max: asset.balance > fee ? asset.balance - fee : 0n, canPayFee: asset.balance > fee };
      }
    }
  }
}

/** A sentence the Send screen can show: the error's key in the catalogue, when it has one. */
export class SendError extends Error {
  constructor(message: string, public problem?: AddressProblem) {
    super(message);
    this.name = 'SendError';
  }
}

/** Sign and broadcast. Returns the transaction id. */
export async function sendAsset(asset: Asset, accountIndex: number, toRaw: string, amount: bigint): Promise<string> {
  const net = asset.network;
  const to = normalizeRecipient(asset, toRaw);
  const invalid = validateAddress(asset, to);
  if (invalid) throw new SendError('The address is not valid for this network.', invalid);
  if (amount <= 0n) throw new SendError('Enter an amount above zero.');
  if (amount > asset.balance) throw new SendError(`Not enough ${asset.symbol}.`);
  const wallet = account(net.key, accountIndex);

  switch (net.family) {
    case 'bch': {
      if (asset.kind === 'cashtoken') {
        return hashOf(await wallet.transfer({ token: asset.ref, recipient: to, amount: amount.toString(), value: TOKEN_OUTPUT_SATS.toString() }));
      }
      if (amount < BCH_DUST) throw new SendError(`The smallest amount that can be sent is ${BCH_DUST} satoshis.`);
      const max = await wallet.call<{ amount: string }>('getMaxSpendable').then(m => BigInt(m.amount)).catch(() => asset.balance);
      // Sending the maximum: spend every coin, so no dust is left behind as unspendable change.
      if (amount >= max) return hashOf(await wallet.call<TxResult>('sendMax', to));
      return hashOf(await wallet.sendTransaction({ to, value: amount.toString() }));
    }
    case 'evm': {
      const from = await addressOf(net.key, accountIndex);
      return sendEvm(accountIndex, { net, from, to, amount, token: asset.kind === 'erc20' ? asset.ref : undefined });
    }
    case 'solana': {
      if (asset.kind === 'native') {
        const owner = await addressOf(net.key, accountIndex);
        const left = (await solRpc(net).balance(owner)) - amount - SOL_TRANSFER_FEE;
        if (left < 0n) throw new SendError('Not enough SOL to cover the amount and the network fee.');
        if (left > 0n && left < SOL_RENT_EXEMPT_MIN) throw new SendError('This would leave less SOL than the network allows an account to hold. Send the maximum, or leave at least 0.00089 SOL.');
        return hashOf(await wallet.sendTransaction({ to, value: amount.toString() }));
      }
      return hashOf(await wallet.transfer({ token: asset.ref, recipient: to, amount: amount.toString() }));
    }
    case 'btc':
      return hashOf(await wallet.call<TxResult>('sendTransaction', { to, value: amount.toString(), confirmationTarget: 3 }));
  }
}
