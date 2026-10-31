/**
 * Calls into the wallet worklet from outside React.
 *
 * WDK's hooks (`useAccount`) are bound to one network and one account each. The wallet works across sixteen
 * networks, and its swap flows are plain functions, so this module reaches the same service the hooks use:
 * `AccountService.callAccountMethod(network, accountIndex, method, ...args)`.
 *
 * What crosses the boundary is JSON. Arguments are stringified on the way in and results on the way out, with
 * bigints as decimal strings: pass amounts as strings and convert what comes back. A method that returns
 * nothing is reported by WDK as an error, so every method called here returns a value.
 *
 * Keys never cross: the seed is decrypted inside the worklet and stays there.
 *
 * The two imports reach into the package's source because it does not export these services. Metro resolves
 * them with a warning; tsconfig.json maps the path for the type checker.
 */
import { AccountService } from '@tetherto/wdk-react-native-core/src/services/accountService';
import { AddressService } from '@tetherto/wdk-react-native-core/src/services/addressService';

const service = AccountService as unknown as {
  callAccountMethod(network: string, accountIndex: number, method: string, ...args: unknown[]): Promise<unknown>;
};

/** Run `method` of the account at `accountIndex` on `network` inside the worklet. */
export async function call<T = unknown>(network: string, accountIndex: number, method: string, ...args: unknown[]): Promise<T> {
  return (await service.callAccountMethod(network, accountIndex, method, ...args)) as T;
}

/** The account's address on a network. Cached by WDK after the first call. */
export const addressOf = (network: string, accountIndex: number): Promise<string> => AddressService.getAddress(network, accountIndex);

export interface TxResult { hash: string; fee: string }

/** What the wallet modules have in common, typed. Amounts are decimal strings of base units. */
export const account = (network: string, accountIndex: number) => ({
  address: () => addressOf(network, accountIndex),
  balance: async () => BigInt(await call<string>(network, accountIndex, 'getBalance')),
  tokenBalance: async (token: string) => BigInt(await call<string>(network, accountIndex, 'getTokenBalance', token)),
  sign: (message: string) => call<string>(network, accountIndex, 'sign', message),
  sendTransaction: (tx: { to: string; value: string }) => call<TxResult>(network, accountIndex, 'sendTransaction', tx),
  quoteSendTransaction: (tx: { to: string; value: string }) => call<{ fee: string }>(network, accountIndex, 'quoteSendTransaction', tx),
  transfer: (t: { token: string; recipient: string; amount: string; value?: string }) => call<TxResult>(network, accountIndex, 'transfer', t),
  quoteTransfer: (t: { token: string; recipient: string; amount: string }) => call<{ fee: string }>(network, accountIndex, 'quoteTransfer', t),
  transferNft: (t: { token: string; commitment: string; recipient: string; value?: string }) => call<TxResult>(network, accountIndex, 'transferNft', t),
  quoteTransferNft: (t: { token: string; commitment: string; recipient: string }) => call<{ fee: string }>(network, accountIndex, 'quoteTransferNft', t),
  call: <T = unknown>(method: string, ...args: unknown[]) => call<T>(network, accountIndex, method, ...args),
});
