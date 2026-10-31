/**
 * Signing on every chain, through the provider, verified outside the wallet.
 *
 * The wallet is imported from the public Hardhat test phrase, so the expected addresses are known and each
 * signature can be checked against them with an independent library:
 *
 *   EVM      ethers.verifyMessage recovers MetaMask's address for the phrase
 *   Solana   ed25519 verification with Node's crypto against the address's public key
 *   Bitcoin  bitcoinjs-message verifies the BIP-137 signature against the tb1q address
 *   BCH      a 65-byte recoverable signature (the format is checked; see docs/internal/testing.md)
 *
 * The test phrase holds public testnet funds. No test here approves a send.
 */
import type { Page } from '@playwright/test';
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { verifyMessage } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { test, expect, launchWallet, importWallet, DAPP_URL, TEST_EVM_ADDRESS, type Wallet } from './fixtures';

test.describe.configure({ mode: 'serial' });

// One line: the test page's message field is a single-line input, which would drop a line break.
const MESSAGE = 'Sign in to the test dapp, nonce 7f3a';
/** Hardhat account #1: m/44'/60'/0'/0/1, which is what MetaMask calls "Account 2". */
const SECOND_EVM_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

let wallet: Wallet & { close: () => Promise<void> };
let dapp: Page;
let addresses: { bch: string; evm: string; solana: string; btc: string; network: string };

const last = (p: Page) => p.evaluate(() => (window as any).__last);
const lastOf = async (label: string) => {
  await expect.poll(async () => (await last(dapp))?.label, { timeout: 30_000 }).toBe(label);
  return last(dapp);
};
const clear = () => dapp.evaluate(() => { (window as any).__last = undefined; });
async function approvalFor(click: () => Promise<unknown>): Promise<Page> {
  const [approval] = await Promise.all([wallet.context.waitForEvent('page'), click()]);
  await expect(approval.getByTestId('approval')).toBeVisible({ timeout: 60_000 });
  return approval;
}
async function signOn(chain: 'bch' | 'evm' | 'solana' | 'btc') {
  await clear();
  await dapp.locator('#message').fill(MESSAGE);
  await dapp.locator('#chain').selectOption(chain);
  const approval = await approvalFor(() => dapp.locator('#signAny').click());
  await expect(approval.getByTestId('approval-chain')).toHaveAttribute('data-chain', chain);
  await expect(approval.getByTestId('approval-message')).toHaveText(MESSAGE);
  await approval.getByTestId('approval-approve').click();
  const res = await lastOf('wallet_signMessage');
  expect(res.ok, JSON.stringify(res.value)).toBe(true);
  expect(res.value.chain).toBe(chain);
  return res.value as { signature: string; address: string; chain: string };
}
const request = (args: unknown) => dapp.evaluate(a => { (window as any).bchIntents.request(a).catch(() => {}); }, args);

test.beforeAll(async () => {
  wallet = await launchWallet();
  const w = await importWallet(wallet);
  await w.close();
  dapp = await wallet.context.newPage();
  await dapp.goto(DAPP_URL);
  const approval = await approvalFor(() => dapp.locator('#connect').click());
  await approval.getByTestId('approval-approve').click();
  await lastOf('bch_requestAccounts');
});
test.afterAll(async () => { await wallet?.close(); });

test('wallet_getAddresses: one address per chain, in the standard form for each', async () => {
  await clear();
  await dapp.locator('#addresses').click();
  const res = await lastOf('wallet_getAddresses');
  expect(res.ok).toBe(true);
  addresses = res.value;
  expect(addresses.evm).toBe(TEST_EVM_ADDRESS);
  expect(addresses.bch).toMatch(/^bchtest:q[a-z0-9]{41}$/);
  expect(addresses.btc).toMatch(/^tb1q[a-z0-9]{38}$/);
  expect(() => new PublicKey(addresses.solana)).not.toThrow();
  expect(addresses.network).toBe('testnet');
});

test('EVM: the signature recovers to the MetaMask address', async () => {
  const { signature, address } = await signOn('evm');
  expect(address).toBe(TEST_EVM_ADDRESS);
  expect(verifyMessage(MESSAGE, signature)).toBe(TEST_EVM_ADDRESS);
});

test('Solana: the ed25519 signature verifies against the address', async () => {
  const { signature, address } = await signOn('solana');
  expect(address).toBe(addresses.solana);
  // An ed25519 public key in SubjectPublicKeyInfo form is this 12-byte prefix followed by the 32 key bytes.
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(new PublicKey(address).toBytes())]);
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  expect(Buffer.from(signature, 'hex')).toHaveLength(64);
  expect(edVerify(null, Buffer.from(MESSAGE, 'utf8'), key, Buffer.from(signature, 'hex'))).toBe(true);
  expect(edVerify(null, Buffer.from('another message', 'utf8'), key, Buffer.from(signature, 'hex'))).toBe(false);
});

test('Bitcoin: the signed message verifies against the SegWit address', async () => {
  const { signature, address } = await signOn('btc');
  expect(address).toBe(addresses.btc);
  // The library WDK itself signs with; it is installed under WDK's own node_modules.
  const bitcoinMessage = createRequire(join(process.cwd(), 'node_modules/@tetherto/wdk-wallet-btc/'))('bitcoinjs-message');
  expect(bitcoinMessage.verify(MESSAGE, address, signature, undefined, true)).toBe(true);
  expect(bitcoinMessage.verify('another message', address, signature, undefined, true)).toBe(false);
});

test('Bitcoin Cash: a 65-byte recoverable signature, the same from both methods', async () => {
  const any = await signOn('bch');
  expect(any.address).toBe(addresses.bch);
  expect(Buffer.from(any.signature, 'base64')).toHaveLength(65);

  await clear();
  const approval = await approvalFor(() => dapp.locator('#sign').click());
  await approval.getByTestId('approval-approve').click();
  const legacy = await lastOf('personal_sign');
  // Bitcoin message signatures are deterministic (RFC 6979): the same key and message give the same bytes.
  expect(legacy.value.signature).toBe(any.signature);
});

test('an unknown chain never reaches a key', async () => {
  const approval = await approvalFor(() => request({ method: 'wallet_signMessage', params: [{ chain: 'dogecoin', message: 'x' }] }));
  await expect(approval.getByTestId('approval-invalid')).toContainText('Unknown chain');
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('approval-reject').click();
});

test('wallet_sendTransaction: shows the asset, amount and network; blocks what the account cannot pay', async () => {
  // 0.000001 ETH on Base Sepolia, to the account itself.
  let approval = await approvalFor(() => request({ method: 'wallet_sendTransaction', params: [{ network: 'base-sepolia', to: TEST_EVM_ADDRESS, amount: '1000000000000' }] }));
  await expect(approval.getByTestId('approval-network')).toHaveText('Base Sepolia');
  await expect(approval.getByTestId('approval-amount')).toContainText('0.000001');
  await expect(approval.getByTestId('approval-amount')).toContainText('ETH');
  await expect(approval.getByTestId('approval-to')).toHaveText(TEST_EVM_ADDRESS);
  await approval.getByTestId('approval-reject').click();

  // A million ETH.
  approval = await approvalFor(() => request({ method: 'wallet_sendTransaction', params: [{ network: 'base-sepolia', to: TEST_EVM_ADDRESS, amount: '1000000000000000000000000' }] }));
  await expect(approval.getByTestId('approval-short')).toBeVisible();
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('approval-reject').click();
});

test('wallet_sendTransaction: a recipient for another chain, and a network of the other mode, are refused', async () => {
  let approval = await approvalFor(() => request({ method: 'wallet_sendTransaction', params: [{ network: 'base-sepolia', to: 'bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k', amount: '1' }] }));
  await expect(approval.getByTestId('approval-short')).toContainText('not a valid EVM address');
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('approval-reject').click();

  approval = await approvalFor(() => request({ method: 'wallet_sendTransaction', params: [{ network: 'base', to: TEST_EVM_ADDRESS, amount: '1' }] }));
  await expect(approval.getByTestId('approval-invalid')).toContainText('mainnet network');
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('approval-reject').click();
});

test('the second account is the one MetaMask derives, and sites are told about the switch', async () => {
  const w = await wallet.open('panel');
  await w.getByTestId('account-trigger').click();
  await w.getByTestId('add-account').click();
  await expect(w.getByTestId('account-trigger')).toContainText('Account 2', { timeout: 60_000 });
  await w.close();

  await expect.poll(async () => {
    await clear();
    await dapp.locator('#addresses').click();
    return (await lastOf('wallet_getAddresses')).value.evm;
  }, { timeout: 30_000 }).toBe(SECOND_EVM_ADDRESS);

  const { signature } = await signOn('evm');
  expect(verifyMessage(MESSAGE, signature)).toBe(SECOND_EVM_ADDRESS);
});
