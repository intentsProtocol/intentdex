/**
 * Sending an asset, on whichever chain it lives. One entry point so the Send screen and the dapp approval
 * screen cannot drift apart.
 *
 * `quote` answers what a send will cost and the most that can be sent; `send` signs and broadcasts and returns
 * the transaction id as soon as the network has it.
 */

import type { Asset } from '@/lib/assets';
import { quoteEvmSend, sendEvm, isEvmAddress } from '@/lib/evm';
import { keypairFrom, quoteSolSend, sendSol, isSolAddress, solBalance, SOL_TRANSFER_FEE, SOL_RENT_EXEMPT_MIN } from '@/lib/solana';
import { EsploraClient } from '@/lib/btc-esplora';
import { translate } from '@/lib/i18n';
import { validateAddress, normalizeRecipient } from '@bch-intents/wallet-core/validation';
import type { BchFunder } from '@bch-intents/wallet-core/swap/cashtoken';

/** The signing material of the active account, as WDKProvider holds it. */
export interface Signers {
  bchWallet: any | null;
  evmSigner: any | null;
  solanaSecretKey: Uint8Array | null;
  btcAccount: any | null;
  addresses: { bch: string | null; evm: string | null; solana: string | null; btc: string | null };
}

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

export { validateAddress, normalizeRecipient, type AddressProblem } from '@bch-intents/wallet-core/validation';

/** The two payments a BCH swap can need, made with the active account's mainnet-js wallet. */
export function bchFunder(wallet: any): BchFunder {
  const txid = (res: any): string => {
    const id = res?.txId ?? res?.txid;
    if (!id) throw new Error('The funding transaction was not accepted by the network.');
    return id;
  };
  return {
    sendBch: async (cashaddr, satoshis) => txid(await wallet.send([{ cashaddr, value: satoshis }])),
    sendToken: async (cashaddr, category, amount, satoshis) => {
      const { TokenSendRequest } = await import('mainnet-js');
      return txid(await wallet.send([new TokenSendRequest({ cashaddr, category, amount, value: satoshis })]));
    },
  };
}

export async function quoteSend(asset: Asset, signers: Signers, to: string, amount: bigint, nativeBalance: bigint): Promise<SendQuote> {
  const net = asset.network;
  switch (net.family) {
    case 'bch': {
      if (asset.kind === 'cashtoken') {
        const fee = BCH_TOKEN_FEE_ESTIMATE + TOKEN_OUTPUT_SATS;
        return { fee, max: asset.balance, canPayFee: nativeBalance >= fee };
      }
      let max = asset.balance > BCH_FEE_ESTIMATE ? asset.balance - BCH_FEE_ESTIMATE : 0n;
      try { max = BigInt(await signers.bchWallet.getMaxAmountToSend()); } catch { /* keep the estimate */ }
      return { fee: asset.balance > max ? asset.balance - max : BCH_FEE_ESTIMATE, max, canPayFee: true };
    }
    case 'evm': {
      const from = signers.addresses.evm!;
      const probe = amount > 0n ? amount : 1n;
      const q = await quoteEvmSend({ net, from, to: isEvmAddress(to) ? to : from, amount: asset.kind === 'native' ? 0n : probe, token: asset.kind === 'erc20' ? asset.ref : undefined });
      if (asset.kind === 'native') return { fee: q.feeWei, max: asset.balance > q.feeWei ? asset.balance - q.feeWei : 0n, canPayFee: asset.balance > q.feeWei };
      return { fee: q.feeWei, max: asset.balance, canPayFee: nativeBalance >= q.feeWei };
    }
    case 'solana': {
      let fee = SOL_TRANSFER_FEE;
      if (asset.kind === 'spl' && isSolAddress(to) && signers.solanaSecretKey) {
        fee = await quoteSolSend(keypairFrom(signers.solanaSecretKey), { net, to, amount: amount || 1n, mint: asset.ref, decimals: asset.decimals }).catch(() => SOL_TRANSFER_FEE);
      }
      if (asset.kind === 'native') {
        // Leaving less than the rent-exempt minimum behind makes the network reject the transfer, unless it is all of it.
        const max = asset.balance > fee ? asset.balance - fee : 0n;
        return { fee, max, canPayFee: asset.balance > fee };
      }
      return { fee, max: asset.balance, canPayFee: nativeBalance >= fee };
    }
    case 'btc': {
      const account = signers.btcAccount;
      try {
        const m = await account.getMaxSpendable?.();
        if (m && m.amount !== undefined) return { fee: BigInt(m.fee ?? 0), max: BigInt(m.amount), canPayFee: BigInt(m.amount) > 0n };
      } catch { /* fall through to an estimate */ }
      const rate = BigInt(await new EsploraClient(net.rpc).feeRate(3).catch(() => 2));
      const fee = rate * 141n;   // one P2WPKH input, two outputs
      return { fee, max: asset.balance > fee ? asset.balance - fee : 0n, canPayFee: asset.balance > fee };
    }
  }
}

/** Sign and broadcast. Returns the transaction id. */
export async function sendAsset(asset: Asset, signers: Signers, toRaw: string, amount: bigint): Promise<string> {
  const net = asset.network;
  const to = normalizeRecipient(asset, toRaw);
  const invalid = validateAddress(asset, to);
  if (invalid) throw new Error(translate('en', invalid.key, invalid.vars));
  if (amount <= 0n) throw new Error('Enter an amount above zero');
  if (amount > asset.balance) throw new Error(`Not enough ${asset.symbol}`);

  switch (net.family) {
    case 'bch': {
      const wallet = signers.bchWallet;
      if (!wallet) throw new Error('The Bitcoin Cash wallet is not ready');
      let res: any;
      if (asset.kind === 'cashtoken') {
        const { TokenSendRequest } = await import('mainnet-js');
        res = await wallet.send([new TokenSendRequest({ cashaddr: to, category: asset.ref, amount, value: TOKEN_OUTPUT_SATS })]);
      } else {
        if (amount < BCH_DUST) throw new Error(`The smallest amount that can be sent is ${BCH_DUST} satoshis`);
        const max = BigInt(await wallet.getMaxAmountToSend().catch(() => asset.balance));
        // Sending the maximum: let the library spend every coin, so no dust is left behind as unspendable change.
        res = amount >= max ? await wallet.sendMax(to) : await wallet.send([{ cashaddr: to, value: amount }]);
      }
      const txid = res?.txId ?? res?.txid;
      if (!txid) throw new Error('The network did not accept the transaction');
      return txid;
    }
    case 'evm': {
      if (!signers.evmSigner || !signers.addresses.evm) throw new Error('The EVM wallet is not ready');
      return sendEvm(signers.evmSigner, { net, from: signers.addresses.evm, to, amount, token: asset.kind === 'erc20' ? asset.ref : undefined });
    }
    case 'solana': {
      if (!signers.solanaSecretKey) throw new Error('The Solana wallet is not ready');
      const keypair = keypairFrom(signers.solanaSecretKey);
      if (asset.kind === 'native') {
        const left = (await solBalance(net, keypair.publicKey.toBase58())) - amount - SOL_TRANSFER_FEE;
        if (left < 0n) throw new Error('Not enough SOL to cover the amount and the network fee.');
        if (left > 0n && left < SOL_RENT_EXEMPT_MIN) throw new Error('This would leave less SOL than the network allows an account to hold. Send the maximum, or leave at least 0.00089 SOL.');
      }
      return sendSol(keypair, { net, to, amount, mint: asset.kind === 'spl' ? asset.ref : undefined, decimals: asset.decimals });
    }
    case 'btc': {
      if (!signers.btcAccount) throw new Error('The Bitcoin wallet is not ready');
      const res = await signers.btcAccount.sendTransaction({ to, value: amount, confirmationTarget: 3 });
      const hash = res?.hash ?? res?.txid;
      if (!hash) throw new Error('The network did not accept the transaction');
      return hash;
    }
  }
}
