/**
 * tests/unit/lendbch_service.ts — unit tests for LendBchService & REST routes (/lendbch/*).
 * Tests quote calculation, auto-collateral derivation, builder routing, input validations,
 * and Fastify route handling via app.inject.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import fastify from 'fastify';
import { ElectrumNetworkProvider, Network, type Utxo } from 'cashscript';
import { MAINNET_V1, deriveDeployment } from '../../src/lendbch/deployment.js';
import { LendBchService } from '../../src/lendbch/LendBchService.js';
import { LendBchSettingsStore } from '../../src/lendbch/SettingsStore.js';
import { registerLendBch } from '../../src/lendbch/routes.js';
import { le } from '../../src/lendbch/builders/index.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/lendbch_service');

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `lendbch-${name}-`));
const tdir = tmp('service');
const settings = new LendBchSettingsStore(tdir);

// Fake ChainClient for offline testing
const dummyPriceCommitment = '00' + le(174, 4) + le(30000, 4); // $300.00
const dummyLoanCommitment = '01' + le(10000n, 6) + le(0n, 6) + '00' + le(174, 4) + le(137, 2) + le(137, 2) + '0000000000';
const dummyGenesisTxid = '1111111111111111111111111111111111111111111111111111111111111111';

const dummyPriceUtxo: Utxo = {
    txid: '5555555555555555555555555555555555555555555555555555555555555555',
    vout: 1,
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.paryonTokenId,
        amount: 0n,
        nft: { capability: 'mutable', commitment: dummyPriceCommitment },
    },
};
const dummyBorrowingUtxo: Utxo = {
    txid: '4444444444444444444444444444444444444444444444444444444444444444',
    vout: 0,
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.paryonTokenId,
        amount: 100000000000n,
        nft: { capability: 'minting', commitment: le(174, 4) },
    },
};
const dummyFactoryUtxo: Utxo = {
    txid: '2222222222222222222222222222222222222222222222222222222222222222',
    vout: 1,
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.loanKeyFactoryTokenId,
        amount: 0n,
        nft: { capability: 'minting', commitment: '' },
    },
};
const dummyManageUtxo: Utxo = {
    txid: '9999999999999999999999999999999999999999999999999999999999999999',
    vout: 1,
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.paryonTokenId,
        amount: 0n,
        nft: { capability: 'none', commitment: '02' },
    },
};
const dummyLoanUtxo: Utxo = {
    txid: '8888888888888888888888888888888888888888888888888888888888888888',
    vout: 2,
    satoshis: 100_000_000n,
    token: {
        category: MAINNET_V1.tokenIds.paryonTokenId,
        amount: 0n,
        nft: { capability: 'mutable', commitment: dummyLoanCommitment },
    },
};
const dummySidecarUtxo: Utxo = {
    txid: '8888888888888888888888888888888888888888888888888888888888888888',
    vout: 3,
    satoshis: 1000n,
    token: {
        category: dummyGenesisTxid,
        amount: 0n,
        nft: { capability: 'none', commitment: '01' },
    },
};

import { deriveFullDeployment } from '../../src/lendbch/deployFull.js';

const dummyGenesisUtxo: Utxo = {
    txid: dummyGenesisTxid,
    vout: 0,
    satoshis: 100_000_000n, // 1 BCH
};
const dummyFeeUtxo: Utxo = {
    txid: '3333333333333333333333333333333333333333333333333333333333333333',
    vout: 1,
    satoshis: 100_000_000n, // 1 BCH
};
const dummyChangeRateUtxo: Utxo = {
    txid: '7777777777777777777777777777777777777777777777777777777777777777',
    vout: 1,
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.paryonTokenId,
        amount: 0n,
        nft: { capability: 'none', commitment: '08' },
    },
};
const dummyUserLoanKeyUtxo: Utxo = {
    txid: '6666666666666666666666666666666666666666666666666666666666666666',
    vout: 1,
    satoshis: 1000n,
    token: {
        category: dummyGenesisTxid,
        amount: 0n,
        nft: { capability: 'minting', commitment: '' },
    },
};

const userAddress = 'bitcoincash:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zye3kwllue';
const userTokenAddress = 'bitcoincash:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy7m9s3er2';

// Build the deployment so we can map addresses → correct UTXOs
const _provider = new ElectrumNetworkProvider(Network.MAINNET);
const _dep = deriveDeployment(MAINNET_V1, _provider);
const _full = deriveFullDeployment(MAINNET_V1, _provider);
const _c = _dep.contracts;

const mockChain: any = {
    network: 'mainnet',
    getProvider: () => _provider,
    getBlockHeight: async () => 850000,
    getUtxos: async (address: string) => {
        // Route UTXOs by contract address so pickThread always finds the right thread
        if (address === _c.borrowing.address) return [dummyBorrowingUtxo];
        if (address === _c.manage.address) return [dummyManageUtxo];
        if (address === _c.loan.address) return [dummyLoanUtxo];
        if (address === _c.loanSidecar.address) return [dummySidecarUtxo];
        if (address === _c.loanKeyFactory.address) return [dummyFactoryUtxo];
        if (address === _full.loanFunctions[7].address) return [dummyChangeRateUtxo];
        // Price variants — check all of them
        if (_dep.priceVariants.some((v: any) => v.address === address)) return [dummyPriceUtxo];
        // User addresses
        if (address === userAddress || address === userTokenAddress) {
            return [dummyGenesisUtxo, dummyFeeUtxo, dummyUserLoanKeyUtxo];
        }
        return [dummyGenesisUtxo, dummyFeeUtxo];
    },
    broadcast: async () => 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
};

const service = new LendBchService({
    params: MAINNET_V1,
    settings,
    chain: mockChain,
    cacheMs: 0,
});

// Must pass self-check before any quote/build calls (service starts paused until check passes)
const sc = await service.selfCheck();
check('selfCheck: passes with mock chain data',
    sc.ok && sc.priceContract != null
);

// ── 1. quoteBorrow ──
const quote1 = await service.quoteBorrow({
    borrowCents: 10000, // 100 PUSD
    collateralSats: 100_000_000, // 1 BCH (at $300 = 300% ratio)
});

check('quoteBorrow: valid quote returns price, fees, and safety metrics',
    quote1.allowed &&
    quote1.priceCents === '30000' &&
    quote1.collateralRatioPct === 300 &&
    quote1.protocolFeeSats === '83333' && // 0.25% of 0.333 BCH
    !quote1.warnLowRatio
);

// Auto-collateral derivation at target ratio (150%)
const quoteAutoCol = await service.quoteBorrow({
    borrowCents: 10000, // 100 PUSD
});
check('quoteBorrow: auto-derives minimum collateral at target ratio (150%)',
    quoteAutoCol.allowed &&
    quoteAutoCol.collateralRatioPct === 150 &&
    BigInt(quoteAutoCol.collateralSats) >= 50_000_000n
);

// Low ratio warning between 150% and 200%
const quoteWarn = await service.quoteBorrow({
    borrowCents: 10000,
    collateralSats: 55_000_000, // ~165% ratio
});
check('quoteBorrow: flags warnLowRatio when ratio is between 150% and 200%',
    quoteWarn.allowed && quoteWarn.warnLowRatio
);

// Rejected borrow under 100 PUSD minimum
const quoteBelowMin = await service.quoteBorrow({
    borrowCents: 9900,
    collateralSats: 100_000_000,
});
check('quoteBorrow: disallows borrow under 100.00 PUSD minimum',
    !quoteBelowMin.allowed && !!quoteBelowMin.reason?.includes('at least 100.00 PUSD')
);

// Rejected borrow violating minimum opening ratio (e.g. 150%)
const quoteBelowRatio = await service.quoteBorrow({
    borrowCents: 25000, // $250 on 1 BCH ($300) = 120% ratio (< 150%)
    collateralSats: 100_000_000,
});
check('quoteBorrow: disallows borrow below opening policy ratio (150%)',
    !quoteBelowRatio.allowed && !!quoteBelowRatio.reason?.includes('opening policy minimum')
);

// ── 2. buildCreateLoanKey ──
const lkRes = await service.buildCreateLoanKey({
    userAddress,
    genesisUtxo: dummyGenesisUtxo,
    factoryUtxo: dummyFactoryUtxo,
    feeUtxos: [dummyFeeUtxo],
});
check('buildCreateLoanKey: service builds loan key tx and outputs',
    lkRes.txHex.length > 100 && lkRes.reservedTokenId === dummyGenesisTxid
);

// ── 3. broadcast ──
const bcast = await service.broadcast('020000000100');
check('broadcast: returns transaction id',
    bcast.txid.length === 64
);

// ── 4. Fastify route endpoints via inject ──
const app = fastify();
await registerLendBch(app, {
    dataDir: tdir,
    params: MAINNET_V1,
    chain: mockChain,
    cacheMs: 0,
});

// GET /lendbch/market
const resMarket = await app.inject({ method: 'GET', url: '/lendbch/market' });
check('GET /lendbch/market: returns 200 with market structure',
    resMarket.statusCode === 200 &&
    resMarket.json().network === 'mainnet' &&
    resMarket.json().fees.frontendFeeBps === 25
);

// POST /lendbch/borrow/quote
const resQuote = await app.inject({
    method: 'POST',
    url: '/lendbch/borrow/quote',
    payload: { borrowCents: 10000, collateralSats: 100_000_000 },
});
check('POST /lendbch/borrow/quote: returns 200 with quote result',
    resQuote.statusCode === 200 &&
    resQuote.json().allowed === true &&
    resQuote.json().priceCents === '30000'
);

// Helper to serialize UTXO for JSON HTTP requests (numbers instead of bigints)
const toJsonUtxo = (u: any) => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: Number(u.satoshis),
    token: u.token ? {
        category: u.token.category,
        amount: Number(u.token.amount),
        nft: u.token.nft,
    } : undefined,
});

// POST /lendbch/loan-key/build
const resLkBuild = await app.inject({
    method: 'POST',
    url: '/lendbch/loan-key/build',
    payload: {
        userAddress,
        genesisUtxo: toJsonUtxo(dummyGenesisUtxo),
        factoryUtxo: toJsonUtxo(dummyFactoryUtxo),
        feeUtxos: [toJsonUtxo(dummyFeeUtxo)],
    },
});
check('POST /lendbch/loan-key/build: returns 200 with tx hex',
    resLkBuild.statusCode === 200 &&
    resLkBuild.json().reservedTokenId === dummyGenesisTxid
);

// POST /lendbch/loan-key/build missing params -> 400
const resLkBad = await app.inject({
    method: 'POST',
    url: '/lendbch/loan-key/build',
    payload: { userAddress },
});
check('POST /lendbch/loan-key/build: returns 400 on missing params',
    resLkBad.statusCode === 400
);

// POST /lendbch/broadcast missing hex -> 400
const resBcastBad = await app.inject({
    method: 'POST',
    url: '/lendbch/broadcast',
    payload: {},
});
check('POST /lendbch/broadcast: returns 400 on missing txHex',
    resBcastBad.statusCode === 400
);

// GET /lendbch/loans/:loanTokenId invalid hex -> 400
const resLoanBad = await app.inject({
    method: 'GET',
    url: '/lendbch/loans/not-a-valid-hex',
});
check('GET /lendbch/loans/:id: returns 400 on invalid hex ID',
    resLoanBad.statusCode === 400
);

// ── 5. prepareBorrow, prepareManage, prepareRate, submit, pollHealth ──

const prepBorrow = await service.prepareBorrow({
    userAddress,
    userTokenAddress,
    borrowCents: 10000,
    collateralSats: 100_000_000,
});
check('prepareBorrow: produces 2-step bundle (create_loan_key and borrow)',
    prepBorrow.steps.length === 2 &&
    prepBorrow.steps[0].name === 'create_loan_key' &&
    prepBorrow.steps[1].name === 'borrow' &&
    prepBorrow.loanTokenId === dummyGenesisTxid &&
    prepBorrow.steps[0].txHex.length > 100 &&
    prepBorrow.steps[1].txHex.length > 100
);

const prepManage = await service.prepareManage({
    userAddress,
    userTokenAddress,
    loanTokenId: dummyGenesisTxid,
    actionType: 'add',
    collateralDeltaSats: 10_000_000,
});
check('prepareManage: produces manage transaction',
    prepManage.loanTokenId === dummyGenesisTxid && prepManage.txHex.length > 100
);

const prepRate = await service.prepareRate({
    userAddress,
    userTokenAddress,
    loanTokenId: dummyGenesisTxid,
    nextRate: 200,
});
check('prepareRate: produces changeRate transaction',
    prepRate.loanTokenId === dummyGenesisTxid && prepRate.txHex.length > 100
);

const submitRes = await service.submit({
    kind: 'borrow',
    signedTxs: [prepBorrow.steps[0].txHex, prepBorrow.steps[1].txHex],
    loanTokenId: prepBorrow.loanTokenId,
    userAddress,
    userTokenAddress,
    borrowCents: '10000',
    collateralSats: '100000000',
});
check('submit: broadcasts transactions and records tracked loan',
    submitRes.txids.length === 2 &&
    submitRes.loanTokenId === prepBorrow.loanTokenId &&
    service.getTrackedLoan(prepBorrow.loanTokenId)?.status === 'active'
);

const health = await service.pollHealth();
check('pollHealth: runs checks over loans',
    health.checked >= 0
);

// ── 6. REST API prepare and submit endpoints ──

// POST /lendbch/quote (alias)
const resQuoteAlias = await app.inject({
    method: 'POST',
    url: '/lendbch/quote',
    payload: { borrowCents: 10000, collateralSats: 100_000_000 },
});
check('POST /lendbch/quote: returns 200 via alias',
    resQuoteAlias.statusCode === 200 && resQuoteAlias.json().allowed === true
);

// POST /lendbch/prepare/borrow
const resPrepBorrow = await app.inject({
    method: 'POST',
    url: '/lendbch/prepare/borrow',
    payload: {
        userAddress,
        userTokenAddress,
        borrowCents: 10000,
        collateralSats: 100_000_000,
    },
});
check('POST /lendbch/prepare/borrow: returns 200 with 2 steps',
    resPrepBorrow.statusCode === 200 &&
    resPrepBorrow.json().steps.length === 2 &&
    resPrepBorrow.json().loanTokenId === dummyGenesisTxid
);

// POST /lendbch/submit
const resSubmit = await app.inject({
    method: 'POST',
    url: '/lendbch/submit',
    payload: {
        kind: 'borrow',
        signedTxs: [prepBorrow.steps[0].txHex],
        loanTokenId: prepBorrow.loanTokenId,
        userAddress,
        userTokenAddress,
    },
});
check('POST /lendbch/submit: returns 200 with txids',
    resSubmit.statusCode === 200 && resSubmit.json().txids.length === 1
);

finish();
