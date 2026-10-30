/** Unit tests for the Bitcoin Cash (BCH) swap module via NEAR Intents 1Click. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BchSwapService } from '../../src/bch/BchSwapService.js';
import { BchSwapStore } from '../../src/bch/BchSwapStore.js';
import { TokenCatalog } from '../../src/bch/TokenCatalog.js';
import { BchSwapWorker } from '../../src/bch/BchSwapWorker.js';
import type { OneClickClient } from '../../src/bch/OneClickClient.js';
import type {
    OneClickQuoteRequest,
    OneClickQuoteResponse,
    OneClickDepositAddressRequest,
    OneClickDepositAddressResponse,
    OneClickStatusResponse,
    OneClickToken,
} from '../../src/bch/types.js';
import { bchItem, parseAddresses } from '../../src/activity.js';
import { Settings } from '../../src/settings.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/bch');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bch-test-'));

class MockOneClickClient implements Partial<OneClickClient> {
    lastQuoteReq?: OneClickQuoteRequest;
    statusReply: OneClickStatusResponse = { status: 'PENDING_DEPOSIT' };

    async getTokens(): Promise<OneClickToken[]> {
        return [
            { assetId: 'nep141:bch.omft.near', symbol: 'BCH', name: 'Bitcoin Cash', decimals: 8, chain: 'bch' },
            { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', symbol: 'USDC', name: 'USD Coin', decimals: 6, chain: 'base' },
        ];
    }

    async getQuote(req: OneClickQuoteRequest): Promise<OneClickQuoteResponse> {
        this.lastQuoteReq = req;
        return {
            amountIn: req.amount,
            amountOut: '368000000', // 3.68 BCH (in 8 decimals)
            minAmountOut: '365000000',
            timeEstimate: 120,
            priceImpact: 0.05,
        };
    }

    async getDepositAddress(req: OneClickDepositAddressRequest): Promise<OneClickDepositAddressResponse> {
        return {
            address: '0x1234567890abcdef1234567890abcdef12345678',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        };
    }

    async getStatus(_depositAddress: string): Promise<OneClickStatusResponse> {
        return this.statusReply;
    }

    async submitDepositTx(_depositAddress: string, _txHash: string): Promise<any> {
        return { ok: true };
    }
}

const mockClient = new MockOneClickClient() as unknown as OneClickClient;
const catalog = new TokenCatalog(mockClient);
await catalog.init();
const settings = new Settings(tmpDir);
const store = new BchSwapStore(tmpDir);
const service = new BchSwapService({
    client: mockClient,
    catalog,
    store,
    settings,
    defaultFeeBps: 25,
    feeRecipientNear: 'bchintents.near',
});
const worker = new BchSwapWorker({
    client: mockClient,
    store,
    service,
    pollIntervalMs: 1000,
});

// 1. Address Validation
const validBchCashAddr = 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';
const validBchNoPrefix = 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';
const validBchLegacy = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const invalidBch = 'not-a-valid-bch-address';
const validEvm = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

check('validate BCH CashAddr with prefix', service.validateAddress(validBchCashAddr, 'bch'));
check('validate BCH CashAddr without prefix', service.validateAddress(validBchNoPrefix, 'bch'));
check('validate BCH legacy address', service.validateAddress(validBchLegacy, 'bch'));
check('reject invalid BCH address', !service.validateAddress(invalidBch, 'bch'));
check('validate EVM address for Base', service.validateAddress(validEvm, 'base'));
check('reject invalid EVM address for Base', !service.validateAddress(validBchNoPrefix, 'base'));

// 2. Amount formatting & parsing
const parsedUnits = BchSwapService.parseUnits('1.5', 8);
check('parseUnits: 1.5 BCH -> 150000000', parsedUnits === '150000000');
const formattedUnits = BchSwapService.formatUnits('150000000', 8);
check('formatUnits: 150000000 -> 1.5', formattedUnits === '1.5');
const parsedUsdc = BchSwapService.parseUnits('100.25', 6);
check('parseUnits: 100.25 USDC -> 100250000', parsedUsdc === '100250000');
const formattedUsdc = BchSwapService.formatUnits('100250000', 6);
check('formatUnits: 100250000 -> 100.25', formattedUsdc === '100.25');

// 3. Token Resolution
const bchToken = catalog.resolve('BCH');
check('catalog resolves BCH token', bchToken?.symbol === 'BCH' && bchToken.decimals === 8);
const baseUsdc = catalog.resolve('USDC', 'base');
check('catalog resolves USDC on Base', baseUsdc?.symbol === 'USDC' && baseUsdc.chain === 'base');
const combinedAlias = catalog.resolve('base:USDC');
check('catalog resolves base:USDC alias', combinedAlias?.symbol === 'USDC');

// 4. Quote generation and fee injection
const quote = await service.getQuote({
    fromAsset: 'USDC',
    fromChain: 'base',
    toAsset: 'BCH',
    toChain: 'bch',
    amount: '100',
    slippageBps: 50,
});
check('quote: returns amountIn and amountOut', quote.amountIn === '100000000' && quote.amountOut === '368000000');
check('quote: includes ourFeeBps', quote.ourFeeBps === 25);
check('quote: injected appFees into 1Click request', (mockClient as any).lastQuoteReq?.appFees?.[0]?.fee === 25);

// 5. Swap Creation
const swap = await service.createSwap({
    fromAsset: 'USDC',
    fromChain: 'base',
    toAsset: 'BCH',
    toChain: 'bch',
    amount: '100',
    recipient: validBchNoPrefix,
    refundTo: validEvm,
});
check('createSwap: generated swap id and PENDING_DEPOSIT', swap.id.startsWith('bch-swp_') && swap.status === 'PENDING_DEPOSIT');
check('createSwap: generated depositAddress', !!swap.depositAddress);
check('store: swap persisted and retrievable by id', store.get(swap.id)?.id === swap.id);
check('store: swap retrievable by deposit address', store.getByDepositAddress(swap.depositAddress)?.id === swap.id);

// 6. Register Deposit Tx
const updatedWithTx = await service.registerDepositTx(swap.id, '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba');
check('registerDepositTx: updates status to KNOWN_DEPOSIT_TX', updatedWithTx.status === 'KNOWN_DEPOSIT_TX' && !!updatedWithTx.depositTxHash);

// 7. Polling Worker status updates
(mockClient as any).statusReply = {
    status: 'SUCCESS',
    depositTxHash: updatedWithTx.depositTxHash,
    settleTxHash: '3a4b5c6d7e8f1234567890abcdef1234567890abcdef1234567890abcdef1234',
};
await worker.tick();
const finishedSwap = store.get(swap.id);
check('worker tick: updates swap status to SUCCESS', finishedSwap?.status === 'SUCCESS');
check('worker tick: records settleTxHash', !!finishedSwap?.settleTxHash);

// 8. Activity Item mapping & address parsing
const activity = bchItem(finishedSwap!);
check('bchItem: maps product as bch', activity.product === 'bch');
check('bchItem: maps phase as completed', activity.phase === 'completed' && activity.terminal === true);
check('bchItem: formats sell and buy sides', activity.sell.symbol === 'USDC' && activity.buy.symbol === 'BCH');

const parsedAddrs = parseAddresses([validBchNoPrefix, validEvm]);
check('parseAddresses: parses BCH CashAddr and EVM addresses', parsedAddrs.length === 2);

// Cleanup
worker.stop();
catalog.stop();
fs.rmSync(tmpDir, { recursive: true, force: true });

process.exit(finish());
