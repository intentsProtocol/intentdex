import { ENV } from './config.js';
import { Scanner } from './scanner.js';
import type { ScannedUtxo } from './scanner.js';
import { RelayerSolver, isNotYetStarted } from './bot/DutchAuctionSolver.js';
import { RelayerExecutor } from './bot/DutchAuctionExecutor.js';
import { CauldronPoolCache } from './bot/CauldronPoolCache.js';
import { CauldronRouter, estimateFillTxFee } from './bot/CauldronRouter.js';
import type { RouteRecord, RouteQuote } from './bot/CauldronRouter.js';
import { loadPolicy } from './bot/ProfitPolicy.js';
import { covenantNow, getSpendLocktime, checkClockSafety, backdateFor } from './bot/CovenantClock.js';
import { buildInventoryConfig, isWhitelisted, describeInventoryConfig } from './bot/InventoryConfig.js';
import * as Inventory from './bot/InventoryMaintenance.js';
import type { InventoryConfig, Network } from './bot/InventoryConfig.js';
import { ExchangeLab } from '@cashlab/cauldron';
import { NATIVE_BCH_TOKEN_ID } from '@cashlab/common';
import { ProfitLedger } from './bot/ProfitLedger.js';
import { shouldFillNow } from './bot/DutchAuctionScheduler.js';
import { reserveOutpoint, filterAvailable, pruneExpired } from './bot/UtxoReservation.js';
import { KNOWN_LIMIT_ORDERS, KNOWN_AUCTIONS } from './registry.js';
import { addIntent, getIntent, getIntentByContract, updateIntent, getActiveIntents, getCompletedIntents, getAllIntents, StoredIntent, queryIntents, IntentQuery, TERMINAL_STATUSES,
         pickIntentForOutpoint, hasOpenIntentsAt, isNonTerminalStatus } from './intentStore.js';
import type { Outpoint } from './intentStore.js';
import { TestNetWallet, Wallet } from 'mainnet-js';
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import { createSupervisors } from './electrum.js';
import { cashAddressToLockingBytecode, decodeTransaction, hexToBin, binToHex } from '@bitauth/libauth';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Load Artifacts
// ============================================================================
const LIMIT_ARTIFACT = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, './artifacts/LimitOrderSwap.json'), 'utf8'
));
const DUTCH_ARTIFACT = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, './artifacts/DutchAuctionSwap.json'), 'utf8'
));

// ============================================================================
// Helpers
// ============================================================================
const reverseHex = (hex: string) => hex.match(/.{2}/g)!.reverse().join('');
const stripHex = (s: string) => s.startsWith('0x') ? s.slice(2) : s;

/**
 * Normalize a BCH cashaddr to ensure it has the correct prefix.
 * Wallets sometimes omit "bitcoincash:" / "bchtest:" from the address they
 * return — libauth requires the full "prefix:payload" form to decode correctly.
 *
 * Detection logic:
 *   - Already has a colon → leave as-is.
 *   - q… / p… (lowercase) → cashaddr payload; prepend network prefix.
 *   - We try chipnet prefix first (bchtest:) if ENV.NETWORK === 'chipnet',
 *     otherwise bitcoincash:.  If the first attempt fails we try the other.
 */
function normalizeCashAddr(address: string): string {
    if (address.includes(':')) return address;          // already prefixed

    const isChipnet = ENV.NETWORK === 'chipnet';
    const primary   = isChipnet ? 'bchtest' : 'bitcoincash';
    const secondary = isChipnet ? 'bitcoincash' : 'bchtest';

    // Try primary network first, fall back to secondary.
    const candidate1 = `${primary}:${address}`;
    const result1 = cashAddressToLockingBytecode(candidate1);
    if (typeof result1 !== 'string') return candidate1;

    const candidate2 = `${secondary}:${address}`;
    const result2 = cashAddressToLockingBytecode(candidate2);
    if (typeof result2 !== 'string') return candidate2;

    // Neither prefix worked — return original and let the caller throw a useful error.
    return address;
}

/**
 * Derive the 20-byte PKH from a BCH cashaddr using libauth.
 * Works for both `bchtest:qp...` and `bitcoincash:qp...` formats,
 * and also accepts bare payload strings (no prefix).
 */
function derivePkhFromAddress(address: string): Uint8Array {
    const normalized = normalizeCashAddr(address);
    const result = cashAddressToLockingBytecode(normalized);
    if (typeof result === 'string') {
        throw new Error(`Invalid BCH address: ${result}`);
    }

    const bytecode = result.bytecode;
    // P2PKH: 76 a9 14 <20-byte-hash> 88 ac
    if (bytecode.length === 25 && bytecode[0] === 0x76 && bytecode[1] === 0xa9 && bytecode[2] === 0x14) {
        return bytecode.slice(3, 23);
    }
    throw new Error(`Not a standard P2PKH address (bytecode length=${bytecode.length})`);
}

// ============================================================================
// Fastify Server & WebSocket
// ============================================================================
const server = Fastify({ logger: false });
server.register(cors, { origin: true });
server.register(fastifyWebsocket);

const PORT = parseInt(process.env.PORT || '3005', 10);

server.register(swagger, {
    openapi: {
        info: {
            title: 'BCH Intents Relayer API',
            description: 'API for creating and querying CashToken swap intents (Dutch Auctions & Limit Orders) akin to CoW Protocol.',
            version: '1.0.0'
        },
        servers: [{ url: `http://localhost:${PORT}` }, { url: 'https://relayer.bch-intents.org' }]
    }
});

server.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
        docExpansion: 'list',
        deepLinking: false
    }
});

// Shared state.
// One supervised, persistent Electrum connection per network — see electrum.ts.
// Every provider handed to the scanner, solver, router and executor is one of
// these two, so the whole process reuses a single socket per network instead of
// reconnecting per request (measured 1143ms → ~230ms per getUtxos).
const electrum = createSupervisors();
const chipnetProvider = electrum.chipnet.provider;
const mainnetProvider = electrum.mainnet.provider;
let relayerWallet: TestNetWallet;

// ── Profit policy + Cauldron router (one cache+router per network) ──
const PROFIT_POLICY = loadPolicy();
console.log(`[Policy] floor=${PROFIT_POLICY.minAbsoluteSats} sats / ${PROFIT_POLICY.minBps} bps, max slippage=${PROFIT_POLICY.maxSlippageBps} bps`);
if (!ENV.RELAYER_PROFIT_ADDRESS) {
    console.warn('[Policy] RELAYER_PROFIT_ADDRESS not set — profit will land in operating wallet (segregation off)');
}
const cauldronCacheMainnet = CauldronPoolCache.forNetwork('mainnet');
const cauldronCacheChipnet = CauldronPoolCache.forNetwork('chipnet');
const profitOutputEnabled = !!process.env.RELAYER_PROFIT_ADDRESS;
const cauldronRouterMainnet = new CauldronRouter(cauldronCacheMainnet, PROFIT_POLICY, profitOutputEnabled);
const cauldronRouterChipnet = new CauldronRouter(cauldronCacheChipnet, PROFIT_POLICY, profitOutputEnabled);

// ── Fill whitelist, per network, memoized per scan cycle ────────────────────
// Previously rebuilt inside processMatchedUtxo for every matched UTXO — a fresh
// Set over every pooled token, per UTXO, per cycle. It also took no network
// argument, so one env list gated both chains: pointed at chipnet categories, a
// mainnet relayer would have filled nothing at all.
const invConfigCache = new Map<Network, InventoryConfig>();

function getInventoryConfig(network: Network): InventoryConfig {
    const hit = invConfigCache.get(network);
    if (hit) return hit;
    const cache = network === 'mainnet' ? cauldronCacheMainnet : cauldronCacheChipnet;
    const cfg = buildInventoryConfig(network, cache.getTokensWithPoolsAboveTvl(ENV.MIN_POOL_TVL_SATS));
    invConfigCache.set(network, cfg);
    return cfg;
}

/** Drop the memo so the next cycle re-derives from a freshly refreshed pool cache. */
function invalidateInventoryConfig(): void {
    invConfigCache.clear();
}

// Router state: pause flag + last 50 route records for tracking
const routerState = {
    paused: false,
    recentRoutes: [] as RouteRecord[],
    totalFills: 0,
    totalProfitSats: 0n,
};

// Profit ledger — populated after wallets initialize in botLoop()
let profitLedger: ProfitLedger | undefined;

function addRouteRecord(record: RouteRecord) {
    routerState.recentRoutes.unshift(record);
    if (routerState.recentRoutes.length > 50) routerState.recentRoutes.pop();
    if (record.fillTxid && !record.error) {
        routerState.totalFills++;
        routerState.totalProfitSats += record.netProfitSats;
    }
}

// Global connected WS clients
const connectedClients = new Set<any>();

function broadcastWsEvent(type: string, data: any) {
    const payload = JSON.stringify({ type, data });
    for (const client of connectedClients) {
        if (client.readyState === 1) { // OPEN
            client.send(payload);
        }
    }
}

server.register(async (fastify) => {
    fastify.get('/ws', { websocket: true }, (connection, req) => {
        connectedClients.add(connection);
        connection.on('close', () => {
            connectedClients.delete(connection);
        });
    });
});

// ============================================================================
// Cauldron Router API
// ============================================================================

server.get('/router/status', {
    schema: {
        description: 'Get Cauldron router status, pool counts, and recent route records.',
        tags: ['Router'],
    }
}, async () => ({
    paused: routerState.paused,
    mainnetPoolCount: cauldronCacheMainnet.getPoolCount(),
    chipnetPoolCount: cauldronCacheChipnet.getPoolCount(),
    mainnetCacheAgeMs: cauldronCacheMainnet.getLastFetchAge(),
    totalFills: routerState.totalFills,
    totalProfitSats: routerState.totalProfitSats.toString(),
    recentRoutes: routerState.recentRoutes.map(r => ({
        ...r,
        netProfitSats: r.netProfitSats.toString(),
    })),
}));

server.post('/router/pause', {
    schema: {
        description: 'Pause Cauldron routing. The bot will still scan and log opportunities but will not execute swaps.',
        tags: ['Router'],
    }
}, async () => {
    cauldronRouterMainnet.paused = true;
    cauldronRouterChipnet.paused = true;
    routerState.paused = true;
    console.log('[Router] Paused');
    broadcastWsEvent('router:paused', { paused: true });
    return { success: true, paused: true };
});

server.post('/router/resume', {
    schema: {
        description: 'Resume Cauldron routing after a pause.',
        tags: ['Router'],
    }
}, async () => {
    cauldronRouterMainnet.paused = false;
    cauldronRouterChipnet.paused = false;
    routerState.paused = false;
    console.log('[Router] Resumed');
    broadcastWsEvent('router:resumed', { paused: false });
    return { success: true, paused: false };
});

// Force a fresh pool cache fetch
server.post('/router/refresh-pools', {
    schema: {
        description: 'Force an immediate refresh of the Cauldron pool cache.',
        tags: ['Router'],
    }
}, async () => {
    await Promise.all([
        cauldronCacheMainnet.refresh(),
        cauldronCacheChipnet.refresh(),
    ]);
    return {
        success: true,
        mainnetPools: cauldronCacheMainnet.getPoolCount(),
        chipnetPools: cauldronCacheChipnet.getPoolCount(),
    };
});

// Quote a swap based on Cauldron AMM prices + margin
server.post('/router/quote', {
    schema: {
        description: 'Get a quote for a swap to guarantee it meets the relayer profit margin.',
        tags: ['Router'],
        body: {
            type: 'object',
            required: ['sellToken', 'buyToken', 'sellAmount'],
            properties: {
                sellToken: { type: 'string' },
                buyToken: { type: 'string' },
                sellAmount: { type: 'string' },
                network: { type: 'string' }
            }
        }
    }
}, async (request, reply) => {
    try {
        const body = request.body as any;
        const { sellToken, buyToken, sellAmount, network } = body;
        const isMainnet = (network === 'mainnet') || ENV.NETWORK === 'mainnet';
        const cache = isMainnet ? cauldronCacheMainnet : cauldronCacheChipnet;
        const pools = await cache.getPools();
        const lab = new ExchangeLab();
        
        const TX_FEE_PER_BYTE = 2n;

        const stripHex = (s: string) => s.startsWith('0x') ? s.slice(2) : s;
        const normToken = (t: string) => (t === 'BCH' || t === '') ? NATIVE_BCH_TOKEN_ID : stripHex(t);
        const sellId = normToken(sellToken);
        const buyId = normToken(buyToken);
        const sellAmt = BigInt(sellAmount);
        
        const minBps = BigInt(PROFIT_POLICY.minBps);
        const minSats = PROFIT_POLICY.minAbsoluteSats;

        /**
         * Sats to hold back from the maker's side so the resulting order is actually
         * fillable: the policy floor PLUS the transaction costs the fill will incur.
         *
         * Reserving only the floor is not enough, and quietly produces orders that can
         * never fill. Observed: a 50,000-sat BCH→Token order quoted at the floor came
         * back with a fill-time profit of 741 sats against a 1,500 floor, because the
         * ~1,660-sat covenant fill fee was never reserved. The maker sees a price, funds
         * it, and the solver correctly refuses it forever.
         *
         * `extraTxCosts` covers whatever additional on-chain steps the route needs — a
         * Cauldron pre-fill or rebalance transaction on the token routes.
         */
        const reserveFor = (tradeValueSats: bigint, extraTxCosts: bigint): bigint => {
            const bpsFloor = (tradeValueSats * minBps) / 10000n;
            const policyFloor = bpsFloor > minSats ? bpsFloor : minSats;
            // Conservative on hasTokenChange: over-reserving makes an order MORE fillable,
            // under-reserving makes it permanently unfillable.
            return policyFloor
                + estimateFillTxFee({ hasTokenChange: true, hasProfitOutput: profitOutputEnabled })
                + extraTxCosts;
        };
        // A Cauldron leg costs its own transaction; mirror CauldronRouter's estimate.
        const CAULDRON_LEG_SATS = 1700n;

        if (pools.length === 0) {
            return reply.code(503).send({ error: 'Pool cache not yet populated — try again in a few seconds' });
        }
        
        // BCH → BCH (trivial)
        if (sellId === NATIVE_BCH_TOKEN_ID && buyId === NATIVE_BCH_TOKEN_ID) {
             // One transaction, no Cauldron leg.
             const buyAmount = sellAmt - reserveFor(sellAmt, 0n);
             return { buyAmount: buyAmount > 0n ? buyAmount.toString() : '0' };
        }
        
        if (buyId === NATIVE_BCH_TOKEN_ID) {
            // Token → BCH: sell exact tokens, get BCH
            const sellPools = cache.getPoolsForPair(sellId, NATIVE_BCH_TOKEN_ID);
            if (!sellPools.length) return reply.code(400).send({ error: `No pool for token ${sellId.slice(0, 8)}` });
            
            const trade = lab.constructTradeBestRateForTargetSupply(sellId, NATIVE_BCH_TOKEN_ID, sellAmt, sellPools, TX_FEE_PER_BYTE);
            const bchReceived = trade.summary.demand - trade.summary.trade_fee;
            // Needs a post-fill rebalance to turn the received tokens back into BCH.
            const buyAmount = bchReceived - reserveFor(bchReceived, CAULDRON_LEG_SATS);

            return { buyAmount: buyAmount > 0n ? buyAmount.toString() : '0' };

        } else if (sellId === NATIVE_BCH_TOKEN_ID) {
            // BCH → Token: reserve margin first, then buy token with remaining BCH
            const buyPools = cache.getPoolsForPair(NATIVE_BCH_TOKEN_ID, buyId);
            if (!buyPools.length) return reply.code(400).send({ error: `No pool for token ${buyId.slice(0, 8)}` });
            
            // A DIRECT fill from inventory needs no Cauldron leg; BCH_TO_TOKEN needs one.
            // Reserve for the cheaper case so inventory-backed orders are not
            // over-priced, and let the router pick whichever route clears the floor.
            const availableBch = sellAmt - reserveFor(sellAmt, 0n);
            if (availableBch <= 0n) return { buyAmount: '0' };
            
            // Use TargetSupply: ask how many tokens we get when spending exactly availableBch sats
            const trade = lab.constructTradeBestRateForTargetSupply(NATIVE_BCH_TOKEN_ID, buyId, availableBch, buyPools, TX_FEE_PER_BYTE);
            const tokensBought = trade.summary.demand; // Demand is tokens. LP fee was taken from our BCH supply.
            
            return { buyAmount: tokensBought > 0n ? tokensBought.toString() : '0' };

        } else {
            // Token → Token (2-hop through BCH)
            const sellPools = cache.getPoolsForPair(sellId, NATIVE_BCH_TOKEN_ID);
            const buyPools = cache.getPoolsForPair(NATIVE_BCH_TOKEN_ID, buyId);
            if (!sellPools.length) return reply.code(400).send({ error: `No pool for sell token ${sellId.slice(0, 8)}` });
            if (!buyPools.length) return reply.code(400).send({ error: `No pool for buy token ${buyId.slice(0, 8)}` });
            
            const trade1 = lab.constructTradeBestRateForTargetSupply(sellId, NATIVE_BCH_TOKEN_ID, sellAmt, sellPools, TX_FEE_PER_BYTE);
            const bchReceived = trade1.summary.demand - trade1.summary.trade_fee;
            // Two Cauldron legs: sell the covenant's token, then buy the maker's.
            const availableBch = bchReceived - reserveFor(bchReceived, CAULDRON_LEG_SATS * 2n);
            if (availableBch <= 0n) return { buyAmount: '0' };
            
            const trade2 = lab.constructTradeBestRateForTargetSupply(NATIVE_BCH_TOKEN_ID, buyId, availableBch, buyPools, TX_FEE_PER_BYTE);
            const tokensBought = trade2.summary.demand;
            return { buyAmount: tokensBought > 0n ? tokensBought.toString() : '0' };
        }
    } catch (e: any) {
        console.error('[/router/quote] error:', e.message);
        return reply.code(500).send({ error: e.message });
    }
});

// Solver wallet balances — used by the explorer dashboard's inventory panel.
// Returns the wallet's BCH balance + per-token balances aggregated across the
// cashaddr and tokenaddr (Electrum returns the same script-hash UTXOs at both,
// so we dedup by txid:vout).
server.get('/router/wallet', {
    schema: {
        description: "Solver wallet addresses + live BCH and CashToken balances aggregated from Electrum.",
        tags: ['Router'],
    }
}, async (request, reply) => {
    try {
        const isMainnet = (request.query as any)?.network === 'mainnet'
            || ENV.NETWORK === 'mainnet';
        const provider = isMainnet ? mainnetProvider : chipnetProvider;
        const wallet = isMainnet ? undefined : relayerWallet;
        if (!isMainnet && !wallet) {
            return reply.code(503).send({ ready: false, reason: 'chipnet wallet not initialized yet' });
        }
        // For mainnet, the wallet is loaded inside botLoop and not exposed here unless MAINNET_PRIVATE_KEY_WIF is set.
        // If you need mainnet inventory in the explorer, run a separate mainnet relayer instance.
        const w = (wallet ?? relayerWallet) as any;
        if (!w?.cashaddr) return reply.code(503).send({ ready: false, reason: 'wallet not loaded' });

        const cashaddr  = w.cashaddr  as string;
        const tokenaddr = w.tokenaddr as string;
        const [utxos1, utxos2] = await Promise.all([
            provider.getUtxos(cashaddr),
            provider.getUtxos(tokenaddr),
        ]);
        const seen = new Set<string>();
        const utxos = [...utxos1, ...utxos2].filter((u: any) => {
            const k = `${u.txid}:${u.vout}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });

        let bchSats = 0n;
        const tokenBalances: Record<string, bigint> = {};
        const tokenUtxoCounts: Record<string, number> = {};
        for (const u of utxos as any[]) {
            bchSats += BigInt(u.satoshis);
            if (u.token) {
                const cat = u.token.category;
                tokenBalances[cat] = (tokenBalances[cat] ?? 0n) + BigInt(u.token.amount);
                tokenUtxoCounts[cat] = (tokenUtxoCounts[cat] ?? 0) + 1;
            }
        }

        // Raw unit balances are misleading on their own: a token UTXO below the dust
        // floor cannot fund a DIRECT fill (the covenant allows only 2 inputs, so the
        // fee must come from that UTXO's own sats). Inventory can therefore read as
        // healthy while being entirely unusable — which is exactly what happened.
        // Report both figures so the difference is visible.
        const inventory = await Inventory.summarize(provider, { cashaddr, tokenaddr });

        return {
            ready: true,
            network:   isMainnet ? 'mainnet' : 'chipnet',
            cashaddr,
            tokenaddr,
            profitAddress: ENV.RELAYER_PROFIT_ADDRESS ?? null,
            utxoCount:     utxos.length,
            bchSats:       bchSats.toString(),
            tokenBalances: Object.fromEntries(Object.entries(tokenBalances).map(([k, v]) => [k, v.toString()])),
            tokenUtxoCounts,
            // DIRECT-fill usability, per token
            dustFloorSats: inventory.dustFloorSats.toString(),
            tokenInventory: inventory.holdings.map(h => ({
                tokenId: h.tokenId,
                units:              h.units.toString(),
                usableUnits:        h.usableUnits.toString(),
                largestUsableUnits: h.largestUsableUnits.toString(),
                utxoCount:          h.utxoCount,
                usableUtxoCount:    h.usableUtxoCount,
            })),
            starvedTokenIds: inventory.starvedTokenIds,
            updatedAt:     Date.now(),
        };
    } catch (e: any) {
        return reply.code(500).send({ ready: false, reason: e.message ?? String(e) });
    }
});

// Profit metrics — predicted vs realized, hit rate, slippage histogram, by route type
server.get('/router/metrics', {
    schema: {
        description: 'Profit metrics: predicted vs realized BCH, hit rate, slippage, breakdown by route type.',
        tags: ['Router'],
    }
}, async () => {
    if (!profitLedger) {
        return { ready: false, reason: 'Bot loop not yet initialized' };
    }
    return {
        ready: true,
        policy: {
            minAbsoluteSats: PROFIT_POLICY.minAbsoluteSats.toString(),
            minBps:          PROFIT_POLICY.minBps,
            maxSlippageBps:  PROFIT_POLICY.maxSlippageBps,
            profitAddress:   ENV.RELAYER_PROFIT_ADDRESS ?? null,
        },
        ...profitLedger.metrics(),
    };
});

// --- Health ---
server.get('/health', async () => ({
    status: 'ok',
    network: ENV.NETWORK,
    watching: ENV.WATCH_ADDRESSES.length,
    activeIntents: getActiveIntents().length,
    routerPaused: routerState.paused,
    cauldronPools: cauldronCacheMainnet.getPoolCount(),
}));

// --- List Intents ---
server.get('/intents', {
    schema: {
        description: 'Query for active and completed intents with optional filters.',
        tags: ['Order Book'],
        querystring: {
            type: 'object',
            properties: {
                maker: { type: 'string', description: 'Filter by Maker Address (cashaddr)' },
                status: { type: 'string', enum: ['pending', 'active', 'filled', 'failed', 'cancelled', 'expired', 'refunded', 'abandoned'] },
                sellToken: { type: 'string', description: 'Category Hex of Sell Token' },
                buyToken: { type: 'string', description: 'Category Hex of Buy Token' },
                type: { type: 'string', enum: ['LIMIT_ORDER', 'DUTCH_AUCTION'], description: 'Intent type filter' },
                limit: { type: 'number', description: 'Pagination limit' },
                offset: { type: 'number', description: 'Pagination offset' }
            }
        }
    }
}, async (request, reply) => {
    const query = request.query as any;

    // Legacy route: no query filters, return active/completed split
    if (Object.keys(query).length === 0) {
        return {
            active: getActiveIntents(),
            completed: getCompletedIntents().slice(-50),
        };
    }

    // New API: robust querying
    const parsedQuery: IntentQuery = {};
    if (query.maker) parsedQuery.maker = query.maker;
    if (query.status) parsedQuery.status = query.status;
    if (query.sellToken) parsedQuery.sellToken = query.sellToken;
    if (query.buyToken) parsedQuery.buyToken = query.buyToken;
    if (query.limit) parsedQuery.limit = parseInt(query.limit, 10);
    if (query.offset) parsedQuery.offset = parseInt(query.offset, 10);

    return queryIntents(parsedQuery);
});

// --- Get Intent ---
server.get('/intent/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const intent = getIntent(id);
    if (!intent) return reply.code(404).send({ error: 'Intent not found' });
    return intent;
});

// --- Create Intent ---
server.post('/intent/create', {
    schema: {
        description: 'Submit an intent to compile a Limit Order or Dutch Auction smart contract on-chain.',
        tags: ['Order Book'],
        body: {
            type: 'object',
            required: ['makerAddress', 'sellToken', 'buyToken', 'sellAmount', 'buyAmount'],
            properties: {
                makerAddress: { type: 'string' },
                sellToken: { type: 'string' },
                buyToken: { type: 'string' },
                sellAmount: { type: 'string' },
                buyAmount: { type: 'string' },
                orderType: { type: 'string', enum: ['limit', 'dutch'] },
                duration: { type: 'number' },
                expiryTime: { type: 'number' },
                network: { type: 'string' }
            }
        }
    }
}, async (request, reply) => {
    try {
        const body = request.body as any;
        const {
            makerAddress,
            sellToken,     // category ID hex (raw, no 0x) or 'BCH'
            buyToken,      // category ID hex (raw, no 0x) or 'BCH'
            sellAmount,
            buyAmount,
            orderType,     // 'limit' or 'market'
            duration,      // seconds (for dutch auction)
            expiryTime,    // unix timestamp (for limit order)
        } = body;

        if (!makerAddress || !sellToken || !buyToken || !sellAmount || !buyAmount) {
            return reply.code(400).send({ error: 'Missing required fields' });
        }

        console.log(`\n=== INTENT CREATE ===`);
        console.log(`  makerAddress: ${makerAddress}`);
        console.log(`  sellToken: ${sellToken}`);
        console.log(`  buyToken: ${buyToken}`);
        console.log(`  sellAmount: ${sellAmount}`);
        console.log(`  buyAmount: ${buyAmount}`);
        console.log(`  orderType: ${orderType}`);

        // Derive maker PKH from their cashaddr using libauth
        const makerPkh = derivePkhFromAddress(makerAddress);
        console.log(`  makerPkh: ${Buffer.from(makerPkh).toString('hex')}`);

        // Category IDs: raw hex from user (no 0x prefix), '' for BCH
        const sellCategoryRaw = (sellToken === 'BCH' || sellToken === '') ? '' : stripHex(sellToken);
        const buyCategoryRaw = (buyToken === 'BCH' || buyToken === '') ? '' : stripHex(buyToken);

        // Contract constructor needs LE (little-endian reversed) categories
        const sellCatLE = sellCategoryRaw ? `0x${reverseHex(sellCategoryRaw)}` : '0x';
        const buyCatLE = buyCategoryRaw ? `0x${reverseHex(buyCategoryRaw)}` : '0x';

        console.log(`  sellCategoryRaw: ${sellCategoryRaw || '(BCH)'}`);
        console.log(`  buyCategoryRaw: ${buyCategoryRaw || '(BCH)'}`);
        console.log(`  sellCatLE (contract): ${sellCatLE}`);
        console.log(`  buyCatLE (contract): ${buyCatLE}`);

        const sellAmountBig = BigInt(sellAmount);
        const buyAmountBig = BigInt(buyAmount);

        let contract: Contract;
        let intentType: 'LIMIT_ORDER' | 'DUTCH_AUCTION';
        const intentId = `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Registry stores categories with 0x prefix in BIG-ENDIAN (raw form)
        // This matches what the scanner returns (utxo.token.category is raw BE hex)
        // The solver compares: `0x${utxo.token.category}` vs registry.sellTokenCategory
        const registrySellCat = sellCategoryRaw ? `0x${sellCategoryRaw}` : '0x';
        const registryBuyCat = buyCategoryRaw ? `0x${buyCategoryRaw}` : '0x';

        const reqNetwork = body.network || ENV.NETWORK;
        const providerToUse = reqNetwork === 'mainnet' ? mainnetProvider : chipnetProvider;

        // Deadlines are written on the covenant clock — the same clock the locktime is
        // stamped from. Because it is one clock the backdate cancels out of every
        // duration, so a maker's "1 hour" really is an hour. Writing deadlines in wall
        // clock while backdating the locktime is what made it three. See CovenantClock.ts.
        const nowClock = covenantNow(reqNetwork);
        const nowSec = Math.floor(Date.now() / 1000);
        let limitExpiryMtp = 0n;   // set in the limit branch; used for the display window
        let dutchStartBuy: bigint | undefined;
        let dutchEndBuy: bigint | undefined;

        if (orderType === 'limit') {
            intentType = 'LIMIT_ORDER';
            // Convert the requested wall-clock expiry into the same MTP-space the
            // covenant will evaluate it in, preserving the duration the maker chose.
            const requestedSec = Number(expiryTime || nowSec + 3600);
            const expiry = BigInt(nowClock + Math.max(60, requestedSec - nowSec));
            limitExpiryMtp = expiry;

            contract = new Contract(LIMIT_ARTIFACT, [
                makerPkh,
                sellCatLE,
                buyCatLE,
                sellAmountBig,
                buyAmountBig,
                expiry,
            ], { provider: providerToUse });

            console.log(`  Contract address: ${contract.address}`);
            console.log(`  Token address: ${contract.tokenAddress}`);

            // Register in bot registry — categories in BE (matches utxo.token.category)
            KNOWN_LIMIT_ORDERS.push({
                address: contract.address,
                makerPkh,
                sellTokenCategory: registrySellCat,
                buyTokenCategory: registryBuyCat,
                sellAmount: sellAmountBig,
                buyAmount: buyAmountBig,
                expiryTime: expiry,
            });

        } else {
            intentType = 'DUTCH_AUCTION';
            // "Now" on the covenant clock, so decay starts at zero and advances in real
            // seconds. fill() requires `locktime >= startTime`, and the locktime is read
            // from this same clock, so a fresh auction is immediately fillable — no
            // safety margin needed on either side.
            const startTime = BigInt(nowClock);
            const dur = BigInt(duration || 3600);
            const startBuy = buyAmountBig;
            const endBuy = buyAmountBig / 2n; // 50% decay default
            dutchStartBuy = startBuy;
            dutchEndBuy = endBuy;

            contract = new Contract(DUTCH_ARTIFACT, [
                makerPkh,
                sellCatLE,
                buyCatLE,
                sellAmountBig,
                startBuy,
                endBuy,
                startTime,
                dur,
            ], { provider: providerToUse });

            console.log(`  Contract address: ${contract.address}`);
            console.log(`  Token address: ${contract.tokenAddress}`);

            KNOWN_AUCTIONS.push({
                address: contract.address,
                makerPkh,
                sellTokenCategory: registrySellCat,
                buyTokenCategory: registryBuyCat,
                sellAmount: sellAmountBig,
                startBuyAmount: startBuy,
                endBuyAmount: endBuy,
                startTime,
                duration: dur,
            });
        }

        // Add to watch addresses dynamically
        if (!ENV.WATCH_ADDRESSES.includes(contract.address)) {
            ENV.WATCH_ADDRESSES.push(contract.address);
        }

        // On-chain windows, translated back into wall-clock for display.
        //
        // The covenant evaluates its deadlines in MTP-space, and MTP advances at roughly
        // the wall-clock rate, so the remaining MTP distance is a good estimate of
        // remaining real time. Approximate by nature — a slow run of blocks stretches
        // these, a fast run compresses them.
        //
        // Both are now the duration the maker actually asked for. Previously a limit
        // order reported expiry + 7200, i.e. a "1H" order that was really fillable for
        // three hours; that skew is gone rather than merely disclosed.
        const { fillableUntil, refundableFrom } = intentType === 'LIMIT_ORDER'
            // fill() holds while locktime < expiryTime, cancel() from >= expiryTime —
            // exactly complementary, so one instant flips both.
            // The clock advances 1:1 with wall time, so a deadline's distance in clock
            // seconds IS its distance in real seconds — these are exact now, not the
            // estimates they were when the clock moved in block-sized jumps.
            ? (() => {
                const flip = nowSec + (Number(limitExpiryMtp) - nowClock);
                return { fillableUntil: flip, refundableFrom: flip };
            })()
            // Dutch: refundable once MTP advances `duration` past startTime; the bot
            // keeps trying to fill at floor price for the grace window beyond that.
            : {
                refundableFrom: nowSec + (duration || 3600),
                fillableUntil:  nowSec + (duration || 3600) + ENV.DUTCH_FLOOR_GRACE_SEC,
            };

        const storedIntent: StoredIntent = {
            id: intentId,
            type: intentType,
            makerAddress,
            contractAddress: contract.address,
            tokenAddress: contract.tokenAddress,
            sellToken: sellCategoryRaw || 'BCH',
            buyToken: buyCategoryRaw || 'BCH',
            sellAmount: sellAmount.toString(),
            buyAmount: buyAmount.toString(),
            status: 'pending',
            createdAt: Date.now(),
            // The maker's chosen wall-clock expiry, kept for display and ordering.
            // The covenant's own deadline lives in MTP-space; fillableUntil /
            // refundableFrom above are that deadline translated back to wall-clock.
            expiryTime: expiryTime || Math.floor(Date.now() / 1000) + 3600,
            duration,
            // Exact covenant constructor args (MTP-space). Stored, never re-derived:
            // the address is a hash of these, so recomputing them on restart yields a
            // different address and the order stops being recognised.
            ...(intentType === 'DUTCH_AUCTION'
                ? { covenantStartTime: nowClock, startBuyAmount: dutchStartBuy?.toString(), endBuyAmount: dutchEndBuy?.toString() }
                : { covenantExpiry: Number(limitExpiryMtp) }),
            fillableUntil,
            refundableFrom,
            explorerUrl: reqNetwork === 'mainnet'
                ? `https://blockchair.com/bitcoin-cash/address/${contract.address}`
                : `https://chipnet.chaingraph.cash/address/${contract.address}`,
        };

        addIntent(storedIntent);

        console.log(`✅ Intent created: ${intentId} (${intentType})`);
        console.log(`   Contract: ${contract.address}`);
        console.log(`   Token Address: ${contract.tokenAddress}`);
        console.log(`   sellAmount: ${sellAmountBig} units`);
        console.log(`   buyAmount: ${buyAmountBig} sats/units`);

        // Broadcast to WS clients
        broadcastWsEvent('intent:created', storedIntent);

        return {
            success: true,
            intentId,
            contractAddress: contract.address,
            tokenAddress: contract.tokenAddress,
            explorerUrl: storedIntent.explorerUrl,
        };

    } catch (e: any) {
        console.error('Intent creation failed:', e);
        return reply.code(500).send({ error: e.message });
    }
});

// ============================================================================
// Cancel Intent (Limit Orders only) — maker-initiated early cancellation
// ============================================================================
//
// The maker builds, signs (via the LimitOrderSwap `cancelEarly()` covenant
// branch), and broadcasts the refund transaction themselves — the relayer
// never holds or needs the maker's key. This endpoint's job is purely to:
//   1. Independently verify the broadcast tx really is a legitimate
//      cancelEarly()-shaped spend of THIS intent's covenant (so a buggy or
//      malicious client can't corrupt the order book with a bogus claim).
//   2. Update the stored intent status and stop the solver from continuing
//      to watch/attempt to fill an address that's no longer fillable.
//
// Fund safety never depends on this endpoint — the covenant itself already
// guarantees the maker gets their funds back correctly on-chain regardless
// of what this endpoint records.
server.post('/intent/:id/cancel', {
    schema: {
        description: "Maker-initiated early cancellation for a Limit Order (not available for Dutch Auctions). The maker must independently build/sign/broadcast the covenant's cancelEarly() spend; this endpoint verifies the broadcast txid on-chain and updates the order book.",
        tags: ['Order Book'],
        params: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' } },
        },
        body: {
            type: 'object',
            required: ['txid'],
            properties: {
                txid: { type: 'string', description: 'Txid of the already-broadcast cancelEarly() transaction' },
            },
        },
    },
}, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { txid } = request.body as { txid: string };

    const intent = getIntent(id);
    if (!intent) return reply.code(404).send({ error: 'Intent not found' });

    if (intent.type !== 'LIMIT_ORDER') {
        return reply.code(400).send({
            error: 'Early cancellation is only supported for Limit Orders. Dutch Auctions can only be reclaimed via the trustless post-auction cancel().',
        });
    }
    if (intent.status !== 'pending' && intent.status !== 'active') {
        return reply.code(409).send({ error: `Cannot cancel — intent status is already '${intent.status}'` });
    }

    const isMainnet = intent.contractAddress.startsWith('bitcoincash:');
    const provider = isMainnet ? mainnetProvider : chipnetProvider;

    try {
        const rawTx = await provider.getRawTransaction(txid);
        const decoded = decodeTransaction(hexToBin(rawTx));
        if (typeof decoded === 'string') {
            return reply.code(400).send({ error: `Could not decode txid ${txid}: ${decoded}` });
        }

        // Preferred check: when we know the exact covenant outpoint this order was
        // last seen live at, require this tx to actually spend THAT outpoint. This is
        // both stricter and correct for collided addresses, where several intents
        // share one covenant address and each owns a different UTXO.
        const knowsOutpoint = !!intent.fundingTxid && intent.fundingVout !== undefined;
        if (knowsOutpoint) {
            const spendsCovenant = decoded.inputs.some(inp =>
                binToHex(inp.outpointTransactionHash) === intent.fundingTxid
                && inp.outpointIndex === intent.fundingVout
            );
            if (!spendsCovenant) {
                return reply.code(400).send({
                    error: `Txid ${txid} does not spend this intent's known covenant outpoint (${intent.fundingTxid}:${intent.fundingVout})`,
                });
            }
        } else {
            // Fallback for a cancel that raced ahead of the bot's first scan, so no
            // outpoint was ever attributed: require the address to be empty.
            //
            // This must NOT run when the outpoint IS known. Contract addresses are
            // not unique per intent — identical orders created in the same second
            // collide, and a 25-order live run put them on just 10 addresses, one
            // holding 6 intents. Demanding a globally empty address there rejects a
            // perfectly valid cancel purely because a sibling's UTXO is still
            // unspent, which is exactly what happened in the matrix run.
            const remaining = await provider.getUtxos(intent.contractAddress);
            if (remaining.length > 0) {
                return reply.code(400).send({
                    error: `Covenant address still has an unspent UTXO and no funding outpoint is on record — cannot attribute ${txid} to this intent yet.`,
                });
            }
        }

        // Shape check: output[0] must pay the maker exactly their locked sellAmount
        // back (in sellToken), which is what distinguishes a cancel-shaped spend
        // (cancel()/cancelEarly()) from a fill() (which pays the maker in buyToken).
        const out0 = decoded.outputs[0];
        const makerPkh = derivePkhFromAddress(intent.makerAddress);
        const expectedLockingBytecode = Uint8Array.from(Buffer.from(`76a914${Buffer.from(makerPkh).toString('hex')}88ac`, 'hex'));
        if (!out0 || binToHex(out0.lockingBytecode) !== binToHex(expectedLockingBytecode)) {
            return reply.code(400).send({ error: `Txid ${txid} output[0] does not pay the maker's address — this does not look like a valid cancel.` });
        }
        const isBchSell = intent.sellToken === 'BCH' || !intent.sellToken;
        if (isBchSell) {
            if (out0.valueSatoshis < BigInt(intent.sellAmount)) {
                return reply.code(400).send({ error: `Txid ${txid} pays the maker less than the locked sellAmount (${intent.sellAmount} sats).` });
            }
        } else {
            if (!out0.token || binToHex(out0.token.category) !== intent.sellToken || out0.token.amount < BigInt(intent.sellAmount)) {
                return reply.code(400).send({ error: `Txid ${txid} does not pay the maker back the full locked sellToken amount.` });
            }
        }

        // Verified — update the order book and stop watching this address.
        updateIntent(id, { status: 'cancelled', cancelTxid: txid, fillExplorerUrl: explorerTx(txid, isMainnet) });
        ENV.WATCH_ADDRESSES = ENV.WATCH_ADDRESSES.filter(a => a !== intent.contractAddress);
        const idx = KNOWN_LIMIT_ORDERS.findIndex(l => l.address === intent.contractAddress);
        if (idx !== -1) KNOWN_LIMIT_ORDERS.splice(idx, 1);

        console.log(`✅ Intent ${id} → cancelled early by maker (tx: ${txid})`);
        broadcastWsEvent('intent:cancelled', getIntent(id));

        return { success: true, intentId: id, cancelTxid: txid };
    } catch (e: any) {
        console.error(`Cancel verification failed for intent ${id}:`, e.message);
        return reply.code(400).send({ error: `Could not verify cancellation: ${e.message}` });
    }
});

// ============================================================================
// Rehydrate solver registry from persisted intents.json on startup
// ============================================================================
function rehydrateRegistry() {
    // Restore every NON-TERMINAL intent, not just 'pending':
    //   active  — process died mid-execution; the covenant may still be live
    //   failed  — funded covenant that wore out its retry budget (still holds maker money)
    //   expired — past its window with the refund not yet broadcast
    // Restoring only 'pending' permanently orphaned all three across restarts.
    //
    // Every non-terminal intent is restored, including ones that look never-funded
    // and past deadline. Reaping is deliberately NOT done here: deciding on the
    // `fundingTxid` proxy alone can abandon a covenant that actually holds funds
    // (see isReapCandidate), and rehydrate has no chain access yet. The bot loop's
    // reaper is the single place that abandons, and it confirms on-chain first. The
    // cost is one scan cycle over the zombie backlog before it gets pruned.
    const toRestore = getAllIntents().filter(i => !TERMINAL_STATUSES.has(i.status));
    let auctions = 0, limits = 0;

    for (const intent of toRestore) {
        const makerPkh = derivePkhFromAddress(intent.makerAddress);
        const sellCatRaw = (intent.sellToken === 'BCH' || !intent.sellToken) ? '' : intent.sellToken;
        const buyCatRaw  = (intent.buyToken  === 'BCH' || !intent.buyToken)  ? '' : intent.buyToken;
        const sellCatLE  = sellCatRaw ? `0x${reverseHex(sellCatRaw)}` : '0x';
        const buyCatLE   = buyCatRaw  ? `0x${reverseHex(buyCatRaw)}`  : '0x';
        const regSell    = sellCatRaw ? `0x${sellCatRaw}` : '0x';
        const regBuy     = buyCatRaw  ? `0x${buyCatRaw}`  : '0x';
        const network    = intent.contractAddress?.startsWith('bitcoincash:') ? 'mainnet' : 'chipnet';
        const provider   = network === 'mainnet' ? mainnetProvider : chipnetProvider;

        // Backfill the on-chain windows for intents created before these existed,
        // so /intents reports them consistently for old and new orders alike.
        if (intent.fillableUntil === undefined || intent.refundableFrom === undefined) {
            const createdSec = Math.floor(intent.createdAt / 1000);
            if (intent.type === 'LIMIT_ORDER') {
                const exp = intent.expiryTime ?? createdSec + 3600;
                updateIntent(intent.id, { fillableUntil: exp + 7200, refundableFrom: exp + 7200 });
            } else {
                const refundAt = createdSec + (intent.duration || 3600);
                updateIntent(intent.id, {
                    refundableFrom: refundAt,
                    fillableUntil:  refundAt + ENV.DUTCH_FLOOR_GRACE_SEC,
                });
            }
        }

        try {
            if (intent.type === 'DUTCH_AUCTION') {
                // Prefer the stored covenant argument. Re-deriving it is what produced
                // the "[rehydrate] address mismatch" warnings: the address is a hash of
                // these arguments, so any drift in how they are computed orphans the
                // order. The legacy fallback reproduces the old `createdAt − 7200`
                // convention for intents created before covenantStartTime existed.
                const startTime = intent.covenantStartTime !== undefined
                    ? BigInt(intent.covenantStartTime)
                    : BigInt(Math.floor((intent.createdAt ?? Date.now()) / 1000) - 7200);
                const dur       = BigInt(intent.duration || 3600);
                const startBuy  = BigInt(intent.startBuyAmount || intent.buyAmount);
                const endBuy    = BigInt(intent.endBuyAmount   || BigInt(intent.buyAmount) / 2n);
                const sellAmt   = BigInt(intent.sellAmount);

                const contract = new Contract(DUTCH_ARTIFACT, [
                    makerPkh, sellCatLE, buyCatLE, sellAmt, startBuy, endBuy, startTime, dur,
                ], { provider });

                if (contract.address === intent.contractAddress) {
                    if (!KNOWN_AUCTIONS.find(a => a.address === intent.contractAddress)) {
                        KNOWN_AUCTIONS.push({
                            address: contract.address,
                            makerPkh, sellTokenCategory: regSell, buyTokenCategory: regBuy,
                            sellAmount: sellAmt, startBuyAmount: startBuy, endBuyAmount: endBuy,
                            startTime, duration: dur,
                        });
                        if (!ENV.WATCH_ADDRESSES.includes(contract.address))
                            ENV.WATCH_ADDRESSES.push(contract.address);
                        auctions++;
                    }
                } else {
                    console.warn(`[rehydrate] Dutch address mismatch for ${intent.id}: stored=${intent.contractAddress} rebuilt=${contract.address}`);
                }
            } else {
                // Same reasoning as the Dutch branch: use the stored covenant argument.
                // intent.expiryTime is the maker's WALL-CLOCK choice, which is not what
                // the covenant was constructed with once deadlines moved to MTP-space.
                const expiry  = intent.covenantExpiry !== undefined
                    ? BigInt(intent.covenantExpiry)
                    : BigInt(intent.expiryTime || Math.floor(Date.now() / 1000) + 3600);
                const sellAmt = BigInt(intent.sellAmount);
                const buyAmt  = BigInt(intent.buyAmount);

                const contract = new Contract(LIMIT_ARTIFACT, [
                    makerPkh, sellCatLE, buyCatLE, sellAmt, buyAmt, expiry,
                ], { provider });

                if (contract.address === intent.contractAddress) {
                    if (!KNOWN_LIMIT_ORDERS.find(l => l.address === intent.contractAddress)) {
                        KNOWN_LIMIT_ORDERS.push({
                            address: contract.address,
                            makerPkh, sellTokenCategory: regSell, buyTokenCategory: regBuy,
                            sellAmount: sellAmt, buyAmount: buyAmt, expiryTime: expiry,
                        });
                        if (!ENV.WATCH_ADDRESSES.includes(contract.address))
                            ENV.WATCH_ADDRESSES.push(contract.address);
                        limits++;
                    }
                } else {
                    console.warn(`[rehydrate] Limit address mismatch for ${intent.id}: stored=${intent.contractAddress} rebuilt=${contract.address}`);
                }
            }
        } catch (e: any) {
            console.warn(`[rehydrate] Skipped intent ${intent.id}: ${e.message}`);
        }
    }

    console.log(`[rehydrate] Restored ${auctions} auctions + ${limits} limit orders from intents.json`);
    console.log(`[rehydrate] Watching ${ENV.WATCH_ADDRESSES.length} addresses total`);
}

/**
 * Candidate for reaping: created, handed a covenant address, and no funding has
 * ever been recorded against it within the deadline.
 *
 * `fundingTxid` is a *proxy*, not proof. markIntentActive() stamps it the first
 * time the scanner attributes a UTXO to this record, so its absence usually means
 * no UTXO ever appeared. But a record can also lack it while its covenant is very
 * much funded: colliding intents share one address, and any record that never had
 * an outpoint attributed to it — because a sibling claimed them all, or because the
 * bot was down across the deadline — looks identical to a never-funded one.
 *
 * That is not hypothetical. Three intents collided on one address; the pre-fix code
 * stamped all three UTXOs onto the first record; the other two were later reaped as
 * "never funded" while the covenant held 100,000 sats.
 *
 * So this only selects candidates. `reapUnfundedIntents()` confirms on-chain before
 * abandoning anything.
 */
function isReapCandidate(intent: StoredIntent, deadlineMs: number): boolean {
    if (intent.status !== 'pending') return false;   // active/failed/expired have been funded
    if (intent.fundingTxid) return false;            // funded at some point
    return Date.now() - intent.createdAt > deadlineMs;
}

/**
 * Drop never-funded intents from the live scan set.
 *
 * Candidate selection is in-memory, but each candidate address is confirmed empty
 * on-chain before its intents are abandoned — abandoning is irreversible for the
 * scan set, and getting it wrong strands maker funds. Cost is one getUtxos per
 * distinct candidate address, once: the set is small, shrinks to zero as intents
 * are reaped, and on a persistent connection each call is ~230ms.
 */
async function reapUnfundedIntents(): Promise<number> {
    const deadlineMs = ENV.FUNDING_DEADLINE_SEC * 1000;
    const candidates = getAllIntents().filter(i => isReapCandidate(i, deadlineMs));
    if (candidates.length === 0) return 0;

    // One probe per address, not per intent — collided intents share one.
    const addresses = [...new Set(candidates.map(i => i.contractAddress))];
    const funded = new Set<string>();
    for (const addr of addresses) {
        const provider = addr.startsWith('bitcoincash:') ? mainnetProvider : chipnetProvider;
        try {
            const utxos = await provider.getUtxos(addr);
            if (utxos.length > 0) {
                funded.add(addr);
                const sats = (utxos as any[]).reduce((s, u) => s + BigInt(u.satoshis), 0n);
                console.warn(`[reaper] ${addr.slice(0, 22)}… looks unfunded on record but holds ` +
                    `${utxos.length} UTXO(s) / ${sats} sats — NOT abandoning; re-watching instead`);
                if (!ENV.WATCH_ADDRESSES.includes(addr)) ENV.WATCH_ADDRESSES.push(addr);
            }
        } catch (e: any) {
            // Probe failed — treat as possibly funded. Reaping is an optimisation;
            // never abandon on the strength of a failed lookup.
            funded.add(addr);
            console.warn(`[reaper] could not probe ${addr.slice(0, 22)}…: ${e.message}; leaving it alone`);
        }
    }

    let reaped = 0;
    for (const intent of candidates) {
        if (funded.has(intent.contractAddress)) continue;

        updateIntent(intent.id, { status: 'abandoned' });

        // Colliding intents share one covenant address. If a sibling record is
        // still open — e.g. 3 records but only 1 funded UTXO, so 2 look
        // "never funded" — dropping the address from the scan set and the registry
        // here would orphan the funded one. Only tear down when nothing else needs
        // the address; the registry entry is what solve() matches on.
        if (!addressHasOpenIntents(intent.contractAddress)) {
            ENV.WATCH_ADDRESSES = ENV.WATCH_ADDRESSES.filter(a => a !== intent.contractAddress);

            const ai = KNOWN_AUCTIONS.findIndex(a => a.address === intent.contractAddress);
            if (ai !== -1) KNOWN_AUCTIONS.splice(ai, 1);
            const li = KNOWN_LIMIT_ORDERS.findIndex(l => l.address === intent.contractAddress);
            if (li !== -1) KNOWN_LIMIT_ORDERS.splice(li, 1);
        }

        broadcastWsEvent('intent:abandoned', getIntent(intent.id));
        reaped++;
    }

    if (reaped) {
        console.log(`[reaper] ${reaped} never-funded intent(s) → abandoned; now watching ${ENV.WATCH_ADDRESSES.length} addresses`);
    }
    return reaped;
}

// ============================================================================
// Bot Loop (runs alongside HTTP server)
// ============================================================================
async function botLoop() {
    const scanner = new Scanner(chipnetProvider, mainnetProvider);
    const solverChipnet = new RelayerSolver('chipnet', chipnetProvider);
    const solverMainnet = new RelayerSolver('mainnet', mainnetProvider);
    
    const executorChipnet = new RelayerExecutor();
    const executorMainnet = new RelayerExecutor();

    // Initialize chipnet wallet
    if (ENV.RELAYER_PRIVATE_KEY_WIF) {
        relayerWallet = await TestNetWallet.fromWIF(ENV.RELAYER_PRIVATE_KEY_WIF);
    } else {
        const walletData = JSON.parse(fs.readFileSync(ENV.WALLET_PATH, 'utf8'));
        relayerWallet = await TestNetWallet.fromWIF(walletData.wif);
    }
    await executorChipnet.init(relayerWallet, 'chipnet');
    executorChipnet.setProfitAddress(ENV.RELAYER_PROFIT_ADDRESS ?? null);

    // Initialize mainnet wallet if available
    let mainnetWallet: Wallet | undefined;
    if (ENV.MAINNET_PRIVATE_KEY_WIF) {
        try {
            mainnetWallet = await Wallet.fromWIF(ENV.MAINNET_PRIVATE_KEY_WIF);
            await executorMainnet.init(mainnetWallet, 'mainnet');
            executorMainnet.setProfitAddress(ENV.RELAYER_PROFIT_ADDRESS ?? null);
        } catch(e: any) {
            console.error("Failed to initialize mainnet wallet:", e.message);
        }
    }

    // Profit ledger spans both networks (snapshot is by address list)
    const ledgerAddrs = [
        (relayerWallet as any).cashaddr as string,
        (relayerWallet as any).tokenaddr as string,
    ];
    if (mainnetWallet) {
        ledgerAddrs.push((mainnetWallet as any).cashaddr, (mainnetWallet as any).tokenaddr);
    }
    if (ENV.RELAYER_PROFIT_ADDRESS) ledgerAddrs.push(ENV.RELAYER_PROFIT_ADDRESS);
    profitLedger = new ProfitLedger(ledgerAddrs);

    console.log(`🤖 Bot loop started. Watching ${ENV.WATCH_ADDRESSES.length} addresses.`);
    console.log(`   Chipnet Relayer address: ${(relayerWallet as any).cashaddr}`);
    if (mainnetWallet) console.log(`   Mainnet Relayer address: ${(mainnetWallet as any).cashaddr}`);
    else console.log(`   Mainnet: Read-only mode (No MAINNET_PRIVATE_KEY_WIF)`);

    // Warm the pool cache before deriving the whitelist, otherwise a cold cache
    // resolves to 'unrestricted' on the first cycle and the log is misleading.
    await Promise.allSettled([
        cauldronCacheChipnet.refresh(),
        ...(mainnetWallet ? [cauldronCacheMainnet.refresh()] : []),
    ]);
    invalidateInventoryConfig();
    // ── Covenant clock safety ────────────────────────────────────────────────
    // The backdate must exceed the real MTP lag or every covenant spend would be
    // non-final and rejected. Verified against the chain rather than assumed.
    for (const net of (mainnetWallet ? ['chipnet', 'mainnet'] : ['chipnet'])) {
        try {
            const provider = net === 'mainnet' ? mainnetProvider : chipnetProvider;
            const c = await checkClockSafety(provider, net);
            const line = `   Covenant clock ${net}: backdate ${c.backdate}s, MTP lag ${c.lagSec}s, margin ${c.marginSec}s`;
            if (!c.safe) {
                console.error(`${line} — UNSAFE: spends would be non-final. Raise LOCKTIME_BACKDATE_${net.toUpperCase()}_SEC.`);
            } else if (c.marginSec < c.backdate * 0.25) {
                console.warn(`${line} — margin is thin; blocks are slow on ${net}.`);
            } else {
                console.log(line);
            }
        } catch (e: any) {
            console.warn(`   Covenant clock ${net}: could not verify (${e.message})`);
        }
    }

    console.log(`   Min pool TVL for auto-whitelist: ${ENV.MIN_POOL_TVL_SATS} sats`);
    console.log(`   ${describeInventoryConfig('chipnet', getInventoryConfig('chipnet'))}`);
    if (mainnetWallet) console.log(`   ${describeInventoryConfig('mainnet', getInventoryConfig('mainnet'))}`);

    // Pre-warm Cauldron pool cache in background
    cauldronCacheMainnet.refresh().catch(() => {});

    // ── Process one matched UTXO end-to-end (solve → quote → fill) ───────────
    // Extracted to its own function so a batch of matches can run with bounded
    // concurrency (ENV.SOLVER_CONCURRENCY) instead of one-at-a-time. UTXO
    // selection safety across concurrent calls is handled by UtxoReservation.ts
    // (reserve the instant a coin is picked, before any broadcast) — every
    // `spentThisCycle.add(op)` call from the old serial loop is now
    // `reserveOutpoint(op)`, and every `provider.getUtxos(...)` result that
    // feeds a coin-selection decision is passed through `filterAvailable()`.
    const processMatchedUtxo = async (u: ScannedUtxo): Promise<void> => {
        const isMainnet = u.address.startsWith('bitcoincash:');
        const solver   = isMainnet ? solverMainnet   : solverChipnet;
        const executor = isMainnet ? executorMainnet : executorChipnet;
        const router   = isMainnet ? cauldronRouterMainnet : cauldronRouterChipnet;
        const provider = isMainnet ? mainnetProvider : chipnetProvider;

        // The exact locktime this pass will stamp. Pricing, the patience scheduler and
        // the executor all key off this one value — deriving it separately at any step
        // reintroduces the solver/contract price mismatch it exists to prevent.
        const cycleLocktime = await getSpendLocktime(provider, isMainnet ? 'mainnet' : 'chipnet');

        const solved = solver.solve(u, cycleLocktime);
        if (!solved) return;
        if (isNotYetStarted(solved)) {
            // Auction opens later on the covenant clock — record the wait so the maker
            // sees "hasn't opened yet" rather than an unexplained silence.
            recordSkipReason(u.address, `auction opens in ${solved.opensInSec}s`, { txid: u.txid, vout: u.vout });
            return;
        }
        const solution = solved;

        // Exponential-backoff gate for repeatedly-failing (but funded) intents:
        // markIntentFailed sets retryAfter; until it passes, don't burn a worker
        // slot re-attempting an execution that just failed.
        const stored = getAllIntents().find(
            i => i.contractAddress === u.address
                && (i.status === 'pending' || i.status === 'active' || i.status === 'failed' || i.status === 'expired')
        );
        if (stored?.retryAfter && Date.now() < stored.retryAfter) {
            return;
        }

        if (isMainnet && !mainnetWallet) {
            console.log(`   [SKIP] Mainnet match — no mainnet wallet configured.`);
            return;
        }

        // Expired intents → refund directly (no routing needed).
        // MUST run BEFORE the whitelist gate: a refund needs no Cauldron pool,
        // and gating it on pool existence would strand maker funds in covenants
        // whose token lost (or never had) liquidity.
        if (solution.isExpired) {
            console.log(`\n⏰ Expired intent at ${u.address} (${solution.type}) — refunding maker`);
            const refundResult = await executor.execute(solution);
            if (refundResult) {
                markIntentDone(u.address, 'refunded', refundResult.txid, isMainnet,
                    undefined, undefined, undefined, { txid: u.txid, vout: u.vout });
                for (const op of refundResult.consumedOutpoints) reserveOutpoint(op);
            } else {
                // Refund built/broadcast failed (e.g. threshold not reached yet on a
                // race, transient Electrum error). Surface the true state: past its
                // window, refund pending — retried automatically next cycle.
                markIntentExpired(u.address, { txid: u.txid, vout: u.vout });
            }
            return;
        }

        // ── Whitelist check ────────────────────────────────────────────
        // Per-network (a mainnet relayer must never inherit chipnet categories) and
        // memoized per scan cycle rather than rebuilt for every matched UTXO.
        const invConfig = getInventoryConfig(isMainnet ? 'mainnet' : 'chipnet');
        const intentTokenId = stripHex(solution.params.buyTokenCategory)
            || stripHex(solution.params.sellTokenCategory);
        if (intentTokenId && !isWhitelisted(intentTokenId, invConfig)) {
            console.log(`   [SKIP whitelist] token ${intentTokenId.slice(0, 12)}… not fillable ` +
                `(whitelist source: ${invConfig.source})`);
            return;
        }

        console.log(`\n✅ Match found at ${u.address}`);
        console.log(`   Type: ${solution.type}`);
        console.log(`   Price: ${solution.currentPrice} sats/units`);
        console.log(`   UTXO token: ${u.token ? `${u.token.amount} of ${u.token.category}` : 'BCH'}`);

        const activeWallet = isMainnet ? mainnetWallet! : relayerWallet;
        const walletInfo = {
            privateKey:    (activeWallet as any).privateKey as Uint8Array,
            publicKeyHash: (activeWallet as any).publicKeyHash as Uint8Array,
            cashaddr:      (activeWallet as any).cashaddr as string,
            tokenaddr:     (activeWallet as any).tokenaddr as string,
        };

        const solverUtxos = filterAvailable(dedupUtxos([
            ...await provider.getUtxos(walletInfo.cashaddr),
            ...await provider.getUtxos(walletInfo.tokenaddr),
        ]));

        // Ask the router: is this intent routable + profitable?
        const quote = await router.quote(solution, solverUtxos);
        console.log(`   Route: ${quote.routeType} | Profitable: ${quote.profitable} | profit=${quote.netProfitSats} (${quote.effectiveBps}bps, slip ${quote.slippageBps}bps) | ${quote.reason}`);

        if (!quote.profitable) {
            console.log(`   [SKIP] ${quote.reason}`);
            recordSkipReason(u.address, quote.reason, { txid: u.txid, vout: u.vout });
            const buyTokenCat = stripHex(solution.params.buyTokenCategory);
            if (buyTokenCat && walletInfo.tokenaddr) {
                console.log(`   [INFO] To enable direct fills for token ${buyTokenCat.slice(0, 12)}…:`);
                console.log(`          Send the token to relayer token address: ${walletInfo.tokenaddr}`);
            }
            return;
        }

        // ── Dutch auction patience: defer if waiting strictly improves edge ──
        if (solution.type === 'DUTCH_AUCTION') {
            const decision = await shouldFillNow({
                solution, currentQuote: quote, policy: PROFIT_POLICY,
                requoteAt: (p) => router.requoteAtPrice(solution, solverUtxos, p),
                nowMTPSec: BigInt(cycleLocktime),
            });
            if (!decision.fill) {
                console.log(`   [DEFER] ${decision.reason}`);
                return;
            }
            console.log(`   [SCHED] ${decision.reason}`);
        }

        // Pass predicted profit into executor so segregation output knows the slice size
        solution.predictedProfitSats = quote.netProfitSats > 0n ? quote.netProfitSats : 0n;

        // Record the prediction. Realized profit is measured afterwards by decoding
        // this fill's own transactions (see below) rather than by snapshotting wallet
        // balance, which cannot be attributed under concurrency.
        const intentForLedger = `${u.address}:${u.txid}:${u.vout}`;
        profitLedger?.recordPredicted(intentForLedger, quote.routeType, quote.netProfitSats, quote.slippageBps);

        const routeRecord: RouteRecord = {
            intentId:    undefined,
            timestamp:   Date.now(),
            routeType:   quote.routeType,
            netProfitSats: quote.netProfitSats,
            slippageBps: quote.slippageBps,
            effectiveBps: quote.effectiveBps,
        };

        // Mark intent as in-flight before any on-chain action
        markIntentActive(u.address, quote.routeType, { txid: u.txid, vout: u.vout });

        try {
            // ── Step 1: Pre-fill (acquire buyToken if needed) ──────────
            if (quote.preFillTrade && !router.paused) {
                // Refetch immediately before selecting coins — `solverUtxos` was
                // captured before quote()/markIntentActive() above, and under
                // concurrency another in-flight task can have reserved coins in
                // that window. executePrefill's own coin-select+reserve is
                // synchronous once this resolves, so refetching this close to
                // the call is what actually closes the race (see UtxoReservation.ts).
                const freshForPrefill = filterAvailable(dedupUtxos([
                    ...await provider.getUtxos(walletInfo.cashaddr),
                    ...await provider.getUtxos(walletInfo.tokenaddr),
                ]));
                const preResult = await router.executePrefill(quote, freshForPrefill, walletInfo, provider);
                const preTxid = preResult.txid;
                for (const op of preResult.consumedOutpoints) reserveOutpoint(op);
                routeRecord.preFillTxid = preTxid;
                routeRecord.preFillExplorerUrl = explorerTx(preTxid, isMainnet);
                console.log(`   Pre-fill tx: ${preTxid}`);
                console.log(`   Explorer:    ${routeRecord.preFillExplorerUrl}`);

                // Wait for pre-fill UTXO to appear in mempool before filling
                const appeared = await router.waitForUtxo(preTxid, walletInfo.cashaddr, provider, 60_000)
                    || await router.waitForUtxo(preTxid, walletInfo.tokenaddr, provider, 30_000);
                if (!appeared) {
                    throw new Error(`Pre-fill UTXO not found in mempool within timeout (${preTxid})`);
                }

                // Re-verify intent is still open (another solver may have filled it during the wait)
                const covenantUtxos = await provider.getUtxos(u.address);
                if (covenantUtxos.length === 0) {
                    console.log(`   Intent already filled by another solver. Pre-fill tokens held as inventory.`);
                    addRouteRecord({ ...routeRecord, error: 'Intent sniped after pre-fill' });
                    broadcastWsEvent('router:sniped', { address: u.address, preFillTxid: preTxid });
                    return;
                }
            } else if (quote.preFillTrade && router.paused) {
                console.log(`   [Router paused] Would have pre-filled — skipping`);
                return;
            }

            // Router pause must stop ALL execution, not just pre-fill/rebalance —
            // a DIRECT route (no pre-fill trade) would otherwise still fill while
            // "paused", defeating the emergency-stop purpose of /router/pause.
            if (router.paused) {
                console.log(`   [Router paused] Would have filled — skipping`);
                return;
            }

            // ── Step 2: Fill the intent ────────────────────────────────
            // Re-fetch UTXOs so executor has the freshest state (includes pre-fill output)
            const fillResult = await executor.execute(solution);
            if (!fillResult) {
                throw new Error('Executor returned no txid');
            }
            const fillTxid = fillResult.txid;
            for (const op of fillResult.consumedOutpoints) reserveOutpoint(op);
            routeRecord.fillTxid = fillTxid;
            routeRecord.fillExplorerUrl = explorerTx(fillTxid, isMainnet);
            console.log(`   Fill tx:  ${fillTxid}`);
            console.log(`   Explorer: ${routeRecord.fillExplorerUrl}`);

            // ── Step 3: Post-fill rebalance (sell received token back to BCH) ──
            if (quote.postFillTrade && !router.paused) {
                // Wait for fill UTXO to appear before rebalancing
                await router.waitForUtxo(fillTxid, walletInfo.cashaddr, provider, 60_000);
                const freshUtxos = filterAvailable(dedupUtxos([
                    ...await provider.getUtxos(walletInfo.cashaddr),
                    ...await provider.getUtxos(walletInfo.tokenaddr),
                ]));
                // Bug 1 fix: pass profit address + predicted profit so rebalance
                // tx segregates profit on-chain (not just the fill tx).
                const rebalanceProfitSats = quote.routeType === 'TOKEN_TO_BCH'
                    ? (quote.netProfitSats > 0n ? quote.netProfitSats : 0n)
                    : 0n;
                const rebalanceResult = await router.executeRebalance(
                    quote, freshUtxos, walletInfo, provider,
                    executor.profitAddress,
                    rebalanceProfitSats,
                );
                for (const op of rebalanceResult.consumedOutpoints) reserveOutpoint(op);
                routeRecord.postFillTxid = rebalanceResult.txid;
                routeRecord.postFillExplorerUrl = explorerTx(rebalanceResult.txid, isMainnet);
                console.log(`   Rebalance tx: ${rebalanceResult.txid}`);
                console.log(`   Explorer:     ${routeRecord.postFillExplorerUrl}`);
            }

            // ── Mark intent filled ────────────────────────────────────
            const storedIntent = markIntentDone(
                u.address,
                'filled',
                fillTxid,
                isMainnet,
                routeRecord.netProfitSats.toString(),
                routeRecord.postFillTxid ?? fillTxid,
                {
                    preFillTxid:    routeRecord.preFillTxid,
                    rebalanceTxid:  routeRecord.postFillTxid,
                    pnlSats:        Number(quote.netProfitSats),
                },
                { txid: u.txid, vout: u.vout },
            );
            if (storedIntent) routeRecord.intentId = storedIntent.id;

            // ── Measure realized profit from this fill's own transactions ──
            // Decoded per-transaction, summed across pre-fill + fill + rebalance.
            // The previous balance-snapshot approach could not attribute anything
            // under concurrency: 12 parallel fills reported 4,427,058 sats against
            // ~84,000 actual, and a single rebalanced fill reported 4,784 against a
            // real 523,239. A transaction's effect on our addresses is a property of
            // the transaction, so this is immune to both.
            if (profitLedger) {
                try {
                    const txids = {
                        preFillTxid:  routeRecord.preFillTxid,
                        fillTxid:     routeRecord.fillTxid,
                        postFillTxid: routeRecord.postFillTxid,
                    };
                    profitLedger.attachTxids(intentForLedger, txids);
                    const { netSats, incomplete } = await profitLedger.measureRealized(provider, txids);
                    const rec = profitLedger.recordRealized(intentForLedger, netSats);
                    if (rec) {
                        console.log(`   [LEDGER] predicted=${rec.predictedSats} realized=${rec.realizedSats} ` +
                            `delta=${rec.deltaBps}bps${incomplete ? ' (partial: a parent tx was unavailable)' : ''}`);
                    }
                } catch (ledgerErr: any) {
                    console.warn(`   [LEDGER] realized measurement failed: ${ledgerErr.message}`);
                }
            }

            addRouteRecord(routeRecord);
            broadcastWsEvent('router:fill', {
                intentId:           routeRecord.intentId,
                routeType:          routeRecord.routeType,
                preFillTxid:        routeRecord.preFillTxid,
                fillTxid:           routeRecord.fillTxid,
                postFillTxid:       routeRecord.postFillTxid,
                netProfitSats:      routeRecord.netProfitSats.toString(),
                preFillExplorerUrl: routeRecord.preFillExplorerUrl,
                fillExplorerUrl:    routeRecord.fillExplorerUrl,
                postFillExplorerUrl: routeRecord.postFillExplorerUrl,
            });

        } catch (routeErr: any) {
            console.error(`   [Router] Error: ${routeErr.message}`);
            routeRecord.error = routeErr.message;
            addRouteRecord(routeRecord);
            markIntentFailed(u.address, routeErr.message, { txid: u.txid, vout: u.vout });
        }
    };

    while (true) {
        // Prune reservations older than the TTL — they've either fully propagated or been dropped from mempool
        pruneExpired();
        // Drop never-funded intents before scanning so the sweep only pays for
        // addresses that can actually still produce a fill.
        await reapUnfundedIntents();
        // Re-derive the fill whitelist once per cycle (pool cache TTL is 30s, so
        // the token set genuinely moves) instead of once per matched UTXO.
        invalidateInventoryConfig();
        try {
            if (ENV.WATCH_ADDRESSES.length > 0) {
                const utxos = await scanner.scanAddresses();
                await mapWithConcurrency(utxos, ENV.SOLVER_CONCURRENCY, processMatchedUtxo);
            }
        } catch (e: any) {
            console.error('Bot loop error:', e.message);
        }

        await new Promise(r => setTimeout(r, ENV.SLEEP_MS));
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Dedup an array of Electrum UTXOs by (txid, vout). A token UTXO can be
 * reported by both the operating cashaddr and the token-aware tokenaddr;
 * including it twice breaks Cauldron tx construction (same outpoint in
 * multiple inputs).
 */
function dedupUtxos(utxos: any[]): any[] {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const u of utxos) {
        const key = `${u.txid}:${u.vout}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(u);
    }
    return out;
}

function explorerTx(txid: string, isMainnet: boolean): string {
    return isMainnet
        ? `https://blockchair.com/bitcoin-cash/transaction/${txid}`
        : `https://chipnet.chaingraph.cash/tx/${txid}`;
}

/**
 * Run `worker` over `items` with at most `limit` concurrent in-flight calls.
 * A small worker-pool: each worker pulls the next index off a shared counter
 * until the list is exhausted. `idx++` is synchronous JS, so no two workers
 * can ever claim the same item.
 */
async function mapWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    if (items.length === 0) return;
    let idx = 0;
    const runNext = async (): Promise<void> => {
        while (idx < items.length) {
            const item = items[idx++];
            try {
                await worker(item);
            } catch (e: any) {
                console.error('[Concurrency] Unhandled worker error:', e.message);
            }
        }
    };
    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => runNext()));
}

/**
 * Classify a router's human-readable skip reason into a stable category the
 * frontend can key off of, and stash it on the intent so `/intent/:id` /
 * `/intents` expose *why* a still-open order hasn't filled yet.
 */
function classifySkipReason(reason: string): NonNullable<StoredIntent['lastSkipCategory']> {
    if (/no .*pool|no pool for/i.test(reason)) return 'no_pool';
    if (/no inventory|no single utxo|fragmented/i.test(reason)) return 'insufficient_capital';
    if (/profit .* sats? < floor|margin .* bps < floor/i.test(reason)) return 'unprofitable_spread';
    if (/slippage .* bps > cap/i.test(reason)) return 'slippage_too_high';
    if (/auction opens in/i.test(reason)) return 'not_yet_started';
    if (/quote failed/i.test(reason)) return 'quote_error';
    return 'other';
}

/** Thin bindings over the pure resolvers in intentStore.ts. */
const resolveIntent = (
    contractAddress: string,
    outpoint?: Outpoint,
    statuses?: ReadonlyArray<StoredIntent['status']>,
): StoredIntent | undefined =>
    pickIntentForOutpoint(getAllIntents(), contractAddress, outpoint, statuses);

/**
 * True while any non-terminal intent still points at this address — i.e. work
 * could still land there. Guards the unwatch in markIntentDone and the reaper so
 * that settling one UTXO of a collided address cannot orphan its siblings.
 */
const addressHasOpenIntents = (contractAddress: string): boolean =>
    hasOpenIntentsAt(getAllIntents(), contractAddress);

const isNonTerminal = (i: StoredIntent) => isNonTerminalStatus(i.status);

function recordSkipReason(contractAddress: string, reason: string, outpoint?: Outpoint): void {
    const matched = resolveIntent(contractAddress, outpoint, ['pending', 'active']);
    if (!matched) return;
    updateIntent(matched.id, {
        lastSkipCategory: classifySkipReason(reason),
        lastSkipReason: reason,
        lastSkipAt: Date.now(),
    });
}

/** Mark an in-flight intent as active (bot is executing). */
function markIntentActive(
    contractAddress: string,
    routeType?: string,
    utxo?: Outpoint,
): StoredIntent | undefined {
    // 'failed' included: a funded covenant that wore out its retry budget is
    // still watched (see markIntentFailed) — when a later attempt gets this
    // far, it transitions back to active and the failure streak resets.
    const matched = resolveIntent(contractAddress, utxo, ['pending', 'active', 'failed']);
    if (matched) {
        updateIntent(matched.id, {
            status: 'active',
            failCount: 0, // any successful attempt resets the transient-failure streak
            retryAfter: undefined,
            ...(routeType ? { routeType } : {}),
            // Claim this outpoint for this record. resolveIntent() hands out
            // unclaimed records first, so N colliding UTXOs map 1:1 onto N
            // records instead of all piling onto the first. The covenant UTXO is
            // stable until spent, so this also doubles as the exact outpoint a
            // maker-initiated cancelEarly() must spend — used by
            // POST /intent/:id/cancel to verify the claim on-chain.
            ...(utxo ? { fundingTxid: utxo.txid, fundingVout: utxo.vout } : {}),
        });
        console.log(`   Intent ${matched.id} → active (route: ${routeType ?? '?'}` +
            `${utxo ? `, outpoint ${utxo.txid.slice(0, 8)}…:${utxo.vout}` : ''})`);
        broadcastWsEvent('intent:updated', getIntent(matched.id));
    }
    return matched;
}

/**
 * A single failed execution attempt (broadcast race, transient Electrum
 * error, momentary insufficient capital, ...) does NOT permanently kill an
 * order that may still be perfectly fillable next cycle — especially under
 * concurrency, where an occasional broadcast collision is expected, not
 * fatal. Past MAX_CONSECUTIVE_FAILURES the intent is *labelled* 'failed' for
 * the frontend, but the address is NEVER unwatched: markIntentFailed is only
 * reachable from processMatchedUtxo, which by construction runs on a covenant
 * with a live UTXO — i.e. a 'failed' intent is a FUNDED covenant holding
 * maker money. Dropping it would orphan those funds (and rehydrate would not
 * bring it back). Instead, retries continue on exponential backoff:
 * FAIL_BACKOFF_BASE_MS × 2^(failCount−1), capped at 1 hour.
 */
const MAX_CONSECUTIVE_FAILURES = 5;
const FAIL_BACKOFF_CAP_MS = 60 * 60 * 1000;

/** Record an execution failure; keeps the funded covenant watched and backs off retries. */
function markIntentFailed(
    contractAddress: string,
    reason: string,
    outpoint?: Outpoint,
): StoredIntent | undefined {
    const matched = resolveIntent(contractAddress, outpoint);
    if (matched) {
        const failCount = (matched.failCount ?? 0) + 1;
        const wornOut = failCount >= MAX_CONSECUTIVE_FAILURES;
        const backoffMs = Math.min(
            ENV.FAIL_BACKOFF_BASE_MS * Math.pow(2, failCount - 1),
            FAIL_BACKOFF_CAP_MS,
        );
        updateIntent(matched.id, {
            status: wornOut ? 'failed' : 'active',
            failReason: reason,
            failCount,
            retryAfter: Date.now() + backoffMs,
        });
        console.error(`   Intent ${matched.id} → ${wornOut ? `failed (retrying in ${Math.round(backoffMs / 1000)}s)` : `retry ${failCount}/${MAX_CONSECUTIVE_FAILURES}`}: ${reason}`);
        broadcastWsEvent(wornOut ? 'intent:failed' : 'intent:updated', getIntent(matched.id));
    }
    return matched;
}

/**
 * Mark an intent as 'expired' — past its fill window, refund attempted but not
 * yet broadcast (e.g. transient Electrum error, or a race where the cancel
 * threshold hasn't quite been reached). The address STAYS watched: the bot
 * retries the refund on every subsequent cycle until it lands, at which point
 * markIntentDone(..., 'refunded', ...) takes over.
 */
function markIntentExpired(contractAddress: string, outpoint?: Outpoint): StoredIntent | undefined {
    const matched = resolveIntent(contractAddress, outpoint, ['pending', 'active']);
    if (matched) {
        updateIntent(matched.id, { status: 'expired' });
        console.log(`   Intent ${matched.id} → expired (refund pending, will retry)`);
        broadcastWsEvent('intent:updated', getIntent(matched.id));
    }
    return matched;
}

function markIntentDone(
    contractAddress: string,
    status: 'filled' | 'refunded',
    txid: string,
    isMainnet: boolean,
    profitAmount?: string,
    profitTx?: string,
    extra?: { fillPrice?: string; pnlSats?: number; preFillTxid?: string; rebalanceTxid?: string },
    outpoint?: Outpoint,
): StoredIntent | undefined {
    // Resolved by spent outpoint where available. 'expired' is included so a refund
    // that failed once (parked by markIntentExpired) completes on a later retry;
    // 'failed' so a worn-out-but-funded intent that finally settles reaches a
    // terminal state.
    const matched = resolveIntent(contractAddress, outpoint);
    if (matched) {
        const isRefund = status === 'refunded';
        updateIntent(matched.id, {
            status,
            [isRefund ? 'refundTxid' : 'fillTxid']: txid,
            fillExplorerUrl: explorerTx(txid, isMainnet),
            ...(profitAmount ? { expectedProfitAmount: profitAmount } : {}),
            ...(profitTx ? { profitTx } : {}),
            ...(extra?.fillPrice ? { fillPrice: extra.fillPrice } : {}),
            ...(extra?.pnlSats !== undefined ? { pnlSats: extra.pnlSats } : {}),
            ...(extra?.preFillTxid ? { preFillTxid: extra.preFillTxid } : {}),
            ...(extra?.rebalanceTxid ? { rebalanceTxid: extra.rebalanceTxid } : {}),
        });
        console.log(`   Intent ${matched.id} → ${status} (tx: ${txid})`);
        broadcastWsEvent(isRefund ? 'intent:refunded' : 'intent:filled', getIntent(matched.id));

        // Only stop watching once nothing else is still pointing at this address.
        // Colliding intents share one covenant address, so unwatching on the first
        // settlement orphaned the siblings' funded UTXOs — the address went out of
        // the scan set while still holding maker money, and rehydrate would not
        // bring it back either. Keep watching while any non-terminal record remains.
        if (addressHasOpenIntents(contractAddress)) {
            const open = getAllIntents().filter(
                i => i.contractAddress === contractAddress && isNonTerminal(i),
            ).length;
            console.log(`   Still watching ${contractAddress.slice(0, 22)}… — ${open} other open intent(s) share it`);
        } else {
            ENV.WATCH_ADDRESSES = ENV.WATCH_ADDRESSES.filter(a => a !== contractAddress);
        }
    }
    return matched;
}

// ============================================================================
// Start
// ============================================================================
async function main() {
    console.log('=== CashToken Relayer Service ===');
    console.log(`Network: ${ENV.NETWORK}`);

    // Start HTTP server
    await server.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 HTTP API running on port ${PORT}`);

    // Open the persistent Electrum connections + start their reconnect watchdogs
    // BEFORE anything issues a request. Mainnet is best-effort: a chipnet-only
    // deployment should not fail to boot because the mainnet host is unreachable.
    await electrum.chipnet.start();
    await electrum.mainnet.start().catch(e =>
        console.warn(`[Electrum:mainnet] initial connect failed (${e?.message ?? e}); watchdog will keep retrying`)
    );

    // Rebuild in-memory solver registry from persisted intents.json
    rehydrateRegistry();

    // Start bot loop in background
    botLoop().catch(e => console.error('Bot loop crashed:', e));
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
