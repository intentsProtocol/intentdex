/**
 * A site talking to the wallet through window.bchIntents: the whole pipeline
 * page → inpage provider → content script → service worker → approval window → back.
 *
 * Signing a message needs no funds, so the signature path runs for real. Sending is taken as far as the
 * approval screen and its checks; broadcasting needs a funded wallet and is listed in docs/internal/testing.md.
 */
import type { Page } from '@playwright/test';
import { test, expect, launchWallet, createWallet, DAPP_URL, PASSWORD, type Wallet } from './fixtures';

test.describe.configure({ mode: 'serial' });

let wallet: Wallet & { close: () => Promise<void> };
let walletPage: Page;
let dapp: Page;

// libauth is an ES module with top-level await: Playwright's loader can import() it, not require it.
const libauth = () => import('@bitauth/libauth');
const last = (p: Page) => p.evaluate(() => (window as any).__last);
const lastOf = async (p: Page, label: string) => {
  await expect.poll(async () => (await last(p))?.label, { timeout: 30_000 }).toBe(label);
  return last(p);
};
/** Click something on the dapp that opens the approval window, and return that window. */
async function approvalFor(click: () => Promise<void>): Promise<Page> {
  const [approval] = await Promise.all([wallet.context.waitForEvent('page'), click()]);
  await expect(approval.getByTestId('approval')).toBeVisible({ timeout: 60_000 });
  return approval;
}

test.beforeAll(async () => {
  wallet = await launchWallet();
  walletPage = await createWallet(wallet);
  // Leave no wallet view open: with none, a request opens its own approval window.
  await walletPage.close();
  dapp = await wallet.context.newPage();
  await dapp.goto(DAPP_URL);
});
test.afterAll(async () => { await wallet?.close(); });

test('the provider is injected and answers read-only calls without a prompt', async () => {
  await expect(dapp.locator('#status')).toHaveText('detected');
  expect(await dapp.evaluate(() => (window as any).bchIntents.isBCHIntents)).toBe(true);
  await expect(dapp.locator('#network')).toHaveText('chipnet');
  // Not connected yet: no account is revealed.
  await dapp.locator('#accounts').click();
  expect((await lastOf(dapp, 'bch_accounts')).value).toEqual([]);
  expect(await dapp.evaluate(() => (window as any).bchIntents.isConnected())).toBe(false);
});

test('a page cannot replace the provider', async () => {
  const replaced = await dapp.evaluate(() => {
    try { (window as any).bchIntents = { fake: true }; } catch { /* strict mode throws */ }
    try { (window as any).bchIntents.request = () => 'hijacked'; } catch { /* frozen */ }
    return (window as any).bchIntents.isBCHIntents === true && String((window as any).bchIntents.request).includes('hijacked') === false;
  });
  expect(replaced).toBe(true);
});

test('an unconnected site cannot ask for a signature or a balance', async () => {
  await dapp.locator('#sign').click();
  expect((await lastOf(dapp, 'personal_sign')).value.code).toBe(4100);
  await dapp.locator('#balance').click();
  expect((await lastOf(dapp, 'bch_getBalance')).value.code).toBe(4100);
});

test('an unsupported method is refused with 4200', async () => {
  await dapp.locator('#unsupported').click();
  expect((await lastOf(dapp, 'eth_chainId')).value.code).toBe(4200);
});

test('rejecting a connection gives the site 4001 and no account', async () => {
  const approval = await approvalFor(() => dapp.locator('#connect').click());
  await expect(approval.getByTestId('approval-origin')).toHaveText('localhost:4173');
  await approval.getByTestId('approval-reject').click();
  const res = await lastOf(dapp, 'bch_requestAccounts');
  expect(res.ok).toBe(false);
  expect(res.value.code).toBe(4001);
  await expect(dapp.locator('#account')).toHaveText('none');
});

test('closing the approval window is a rejection too', async () => {
  const approval = await approvalFor(() => dapp.locator('#connect').click());
  await approval.close();
  expect((await lastOf(dapp, 'bch_requestAccounts')).value.code).toBe(4001);
});

test('approving a connection returns the address and fires the events', async () => {
  const approval = await approvalFor(() => dapp.locator('#connect').click());
  await approval.getByTestId('approval-approve').click();
  const res = await lastOf(dapp, 'bch_requestAccounts');
  expect(res.ok).toBe(true);
  expect(res.value).toHaveLength(1);
  expect(res.value[0]).toMatch(/^bchtest:q/);
  await expect(dapp.locator('#account')).toHaveText(res.value[0]);
  const events = await dapp.evaluate(() => (window as any).__events.map((e: any[]) => e[0]));
  expect(events).toEqual(expect.arrayContaining(['accountsChanged', 'connect']));
});

test('a connected site gets its account back without a prompt, also after a reload', async () => {
  await dapp.reload();
  await expect(dapp.locator('#account')).toHaveText(/^bchtest:q/);
  const pagesBefore = wallet.context.pages().length;
  await dapp.locator('#connect').click();
  expect((await lastOf(dapp, 'bch_requestAccounts')).ok).toBe(true);
  expect(wallet.context.pages().length).toBe(pagesBefore);
  await dapp.locator('#balance').click();
  expect((await lastOf(dapp, 'bch_getBalance')).value).toHaveProperty('satoshis');
});

test('signing a message: shown as text, signed on approval, verifiable', async () => {
  await dapp.locator('#message').fill('Sign in to the test dapp\nnonce: 42');
  const approval = await approvalFor(() => dapp.locator('#sign').click());
  await expect(approval.getByTestId('approval-message')).toHaveText('Sign in to the test dapp nonce: 42');
  await approval.getByTestId('approval-approve').click();
  const res = await lastOf(dapp, 'personal_sign');
  expect(res.ok).toBe(true);
  // A Bitcoin signed message: 65 bytes, base64.
  expect(Buffer.from(res.value.signature, 'base64')).toHaveLength(65);
});

test('a hex message is decoded for the user', async () => {
  const hex = '0x' + Buffer.from('hello hex', 'utf8').toString('hex');
  const approval = await approvalFor(() => dapp.evaluate(h => { (window as any).bchIntents.request({ method: 'personal_sign', params: [h] }).catch(() => {}); }, hex));
  await expect(approval.getByTestId('approval-message')).toHaveText('hello hex');
  await approval.getByTestId('approval-reject').click();
});

test('a send request shows the amount and recipient, and cannot be approved without funds', async () => {
  await dapp.locator('#to').fill('bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k');
  await dapp.locator('#satoshis').fill('150000');
  const approval = await approvalFor(() => dapp.locator('#send').click());
  await expect(approval.getByTestId('approval-amount')).toContainText('0.0015');
  await expect(approval.getByTestId('approval-to')).toHaveText('bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k');
  await expect(approval.getByTestId('approval-short')).toBeVisible();
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('approval-reject').click();
  expect((await lastOf(dapp, 'bch_sendTransaction')).value.code).toBe(4001);
});

test('a send to the other network is flagged and blocked', async () => {
  await dapp.locator('#to').fill('bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2');
  const approval = await approvalFor(() => dapp.locator('#send').click());
  await expect(approval.getByTestId('approval-wrong-network')).toBeVisible();
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('approval-reject').click();
  await lastOf(dapp, 'bch_sendTransaction');
});

test('malformed parameters never reach a signature', async () => {
  const approval = await approvalFor(() => dapp.evaluate(() => {
    (window as any).bchIntents.request({ method: 'bch_sendTransaction', params: [{ to: 'not an address', satoshis: 'lots' }] }).catch(() => {});
  }));
  await expect(approval.getByTestId('approval-invalid')).toBeVisible();
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('approval-reject').click();
});

test('a transaction the site built is summarised from the transaction, signed on approval, and valid', async () => {
  const { cashAddressToLockingBytecode, createVirtualMachineBch, decodeTransaction, hexToBin, stringify } = await libauth();
  const [address] = await dapp.evaluate(() => (window as any).bchIntents.request({ method: 'bch_accounts' })) as string[];
  const locking = (a: string) => (cashAddressToLockingBytecode(a) as { bytecode: Uint8Array }).bytecode;
  const recipient = 'bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k';
  // An output of this account that does not exist on chain: signing needs no network, only sending does.
  const transaction = {
    version: 2, locktime: 0,
    inputs: [{ outpointIndex: 0, outpointTransactionHash: hexToBin('11'.repeat(32)), sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array(0) }],
    outputs: [{ lockingBytecode: locking(recipient), valueSatoshis: 60_000n }, { lockingBytecode: locking(address), valueSatoshis: 39_000n }],
  };
  const sourceOutputs = [{ ...transaction.inputs[0], lockingBytecode: locking(address), valueSatoshis: 100_000n }];
  const payload = JSON.parse(stringify({ transaction, sourceOutputs, broadcast: false, userPrompt: 'Fund the swap' }));

  const approval = await approvalFor(() => dapp.evaluate(p => {
    (window as any).__signed = (window as any).bchIntents.request({ method: 'bch_signTransaction', params: [p] });
  }, payload));
  await expect(approval.getByTestId('approval')).toHaveAttribute('data-method', 'bch_signTransaction');
  await expect(approval.getByTestId('approval-amount')).toContainText('0.00061');
  await expect(approval.getByTestId('approval-output')).toContainText(recipient);
  await expect(approval.getByTestId('approval-fee')).toContainText('0.00001');
  await approval.getByTestId('approval-approve').click();

  const result = await dapp.evaluate(() => (window as any).__signed);
  expect(result.signedTransactionHash).toMatch(/^[0-9a-f]{64}$/);
  const signed = decodeTransaction(hexToBin(result.signedTransaction));
  expect(createVirtualMachineBch(false).verify({ sourceOutputs, transaction: signed as any })).toBe(true);
});

test('a transaction with nothing for this account to sign cannot be approved', async () => {
  const { cashAddressToLockingBytecode, hexToBin, stringify } = await libauth();
  const other = (cashAddressToLockingBytecode('bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k') as { bytecode: Uint8Array }).bytecode;
  const transaction = {
    version: 2, locktime: 0,
    inputs: [{ outpointIndex: 0, outpointTransactionHash: hexToBin('22'.repeat(32)), sequenceNumber: 0xfffffffe, unlockingBytecode: new Uint8Array(0) }],
    outputs: [{ lockingBytecode: other, valueSatoshis: 9_000n }],
  };
  const payload = JSON.parse(stringify({ transaction, sourceOutputs: [{ ...transaction.inputs[0], lockingBytecode: other, valueSatoshis: 10_000n }], broadcast: true }));
  const approval = await approvalFor(() => dapp.evaluate(p => {
    (window as any).bchIntents.request({ method: 'bch_signTransaction', params: [p] }).catch(() => {});
  }, payload));
  await expect(approval.getByTestId('approval-nothing')).toBeVisible();
  await expect(approval.getByTestId('approval-approve')).toBeDisabled();
  await approval.getByTestId('approval-reject').click();
});

test('requests queue and are answered in order', async () => {
  await dapp.evaluate(() => {
    const p = (window as any).bchIntents;
    (window as any).__queue = Promise.allSettled([
      p.request({ method: 'personal_sign', params: ['first'] }),
      p.request({ method: 'personal_sign', params: ['second'] }),
    ]);
  });
  const approval = await wallet.context.waitForEvent('page');
  await expect(approval.getByTestId('approval-message')).toHaveText('first', { timeout: 60_000 });
  await approval.getByTestId('approval-approve').click();
  await expect(approval.getByTestId('approval-message')).toHaveText('second');
  await approval.getByTestId('approval-reject').click();
  const results = await dapp.evaluate(async () => (await (window as any).__queue).map((r: any) => r.status));
  expect(results).toEqual(['fulfilled', 'rejected']);
});

test('a locked wallet asks for the password before showing the request', async () => {
  const w = await wallet.open('panel');
  await w.getByTestId('lock-button').click();
  await expect(w.getByTestId('unlock-password')).toBeVisible();
  await w.close();

  const [approval] = await Promise.all([wallet.context.waitForEvent('page'), dapp.locator('#sign').click()]);
  await expect(approval.getByTestId('unlock-password')).toBeVisible({ timeout: 60_000 });
  await approval.getByTestId('unlock-password').fill(PASSWORD);
  await approval.getByTestId('unlock-submit').click();
  await expect(approval.getByTestId('approval')).toBeVisible({ timeout: 60_000 });
  await approval.getByTestId('approval-approve').click();
  expect((await lastOf(dapp, 'personal_sign')).ok).toBe(true);
});

test('the wallet lists the site, and disconnecting it there tells the page', async () => {
  const w = await wallet.open('panel');
  await w.getByTestId('nav-settings').click();
  await w.getByTestId('open-sites').click();
  await expect(w.getByTestId('site-row')).toContainText('localhost:4173');
  await dapp.evaluate(() => { (window as any).__events.length = 0; });
  await w.getByTestId('site-disconnect').click();
  await expect(w.getByTestId('site-row')).toHaveCount(0);
  await expect.poll(() => dapp.evaluate(() => (window as any).__events.map((e: any[]) => e[0]))).toEqual(expect.arrayContaining(['accountsChanged', 'disconnect']));
  await expect(dapp.locator('#account')).toHaveText('none');

  // What the site did is in the activity list.
  await w.getByTestId('back').click();
  await w.getByTestId('nav-activity').click();
  await expect(w.getByTestId('activity-connect').first()).toBeVisible();
  await expect(w.getByTestId('activity-sign').first()).toBeVisible();
  await w.close();
});

test('after a disconnect the site has to ask again', async () => {
  await dapp.locator('#balance').click();
  expect((await lastOf(dapp, 'bch_getBalance')).value.code).toBe(4100);
});
