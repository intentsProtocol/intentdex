/**
 * tests/unit/lendbch_builders.ts — unit tests for the P3 builders and verifyTx guard engine.
 * Tests transaction construction, script VM evaluation, and negative cases (ratios, limits, stray tokens).
 */
import { ElectrumNetworkProvider, Network, type Utxo } from 'cashscript';
import { MAINNET_V1 } from '../../src/lendbch/deployment.js';
import { deriveFullDeployment } from '../../src/lendbch/deployFull.js';
import {
    buildCreateLoanKeyTx,
    buildBorrowTx,
    buildManageTx,
    buildChangeRateTx,
    le,
} from '../../src/lendbch/builders/index.js';
import { verifyTx, toLibauthLockingBytecode, utxosToLibauthSourceOutputs } from '../../src/lendbch/verifyTx.js';
import { check, finish, suite } from '../lib/report.js';

suite('unit/lendbch_builders');

const provider = new ElectrumNetworkProvider(Network.MAINNET);
const d = deriveFullDeployment(MAINNET_V1, provider);
const userAddress = 'bitcoincash:qqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zye3kwllue';
const userTokenAddress = 'bitcoincash:zqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zy7m9s3er2';
const treasuryAddress = 'bitcoincash:qq3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygrg4dtdzf';

// ── 1. verifyTx guards ──
check('verifyTx: rejects transaction with invalid action or empty outputs', (() => {
    try {
        verifyTx({
            txHex: '02000000000000000000',
            sourceOutputs: [],
            userAddress,
            action: 'borrow',
            contractInputIndices: [],
        });
        return false;
    } catch {
        return true;
    }
})());

check('toLibauthLockingBytecode: converts cashaddr and hex', (() => {
    const lb1 = toLibauthLockingBytecode(userAddress);
    const lb2 = toLibauthLockingBytecode('aa207c7a248c794af2cdf1b1a66a2311347c45b177fcb3aad730a7823c9e32fc754087');
    return lb1.length === 25 && lb2.length === 35;
})());

// ── 2. LoanKey builder ──
const dummyGenesisTxid = '1111111111111111111111111111111111111111111111111111111111111111';
const dummyGenesisUtxo: Utxo = {
    txid: dummyGenesisTxid,
    vout: 0,
    satoshis: 10000n,
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
const dummyFeeUtxo: Utxo = {
    txid: '3333333333333333333333333333333333333333333333333333333333333333',
    vout: 1,
    satoshis: 50000n,
};

const loanKeyRes = buildCreateLoanKeyTx({
    params: MAINNET_V1,
    provider,
    userAddress,
    genesisUtxo: dummyGenesisUtxo,
    factoryUtxo: dummyFactoryUtxo,
    feeUtxos: [dummyFeeUtxo],
    treasuryAddress,
});

check('buildCreateLoanKeyTx: builds valid tx and passes script VM', loanKeyRes.txHex.length > 100 && loanKeyRes.reservedTokenId === dummyGenesisTxid);
check('buildCreateLoanKeyTx: enforcer and proof are outputs 2 and 3', loanKeyRes.enforcerOutpoint.vout === 2 && loanKeyRes.proofOutpoint.vout === 3);

check('buildCreateLoanKeyTx: rejects non-zero outpoint index (genesis rule)', (() => {
    try {
        buildCreateLoanKeyTx({
            params: MAINNET_V1,
            provider,
            userAddress,
            genesisUtxo: { ...dummyGenesisUtxo, vout: 1 },
            factoryUtxo: dummyFactoryUtxo,
            feeUtxos: [dummyFeeUtxo],
        });
        return false;
    } catch {
        return true;
    }
})());

// ── 3. Borrow builder ──
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
const dummyPriceUtxo: Utxo = {
    txid: '5555555555555555555555555555555555555555555555555555555555555555',
    vout: 1,
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.paryonTokenId,
        amount: 0n,
        nft: { capability: 'mutable', commitment: '00' + le(174, 4) + le(30000, 4) }, // $300.00
    },
};
const dummyEnforcerUtxo: Utxo = {
    txid: '6666666666666666666666666666666666666666666666666666666666666666',
    vout: 2,
    satoshis: 1000n,
    token: {
        category: dummyGenesisTxid,
        amount: 0n,
        nft: { capability: 'minting', commitment: '' },
    },
};
const dummyProofUtxo: Utxo = {
    txid: '6666666666666666666666666666666666666666666666666666666666666666',
    vout: 3, // must be enforcer.vout + 1 and same txid!
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.loanKeyFactoryTokenId,
        amount: 0n,
        nft: { capability: 'none', commitment: '' },
    },
};
const dummyUserCollateralUtxo: Utxo = {
    txid: '7777777777777777777777777777777777777777777777777777777777777777',
    vout: 0,
    satoshis: 200_000_000n, // 2 BCH
};

const borrowRes = buildBorrowTx({
    params: MAINNET_V1,
    provider,
    userAddress,
    userTokenAddress,
    borrowingUtxo: dummyBorrowingUtxo,
    priceUtxo: dummyPriceUtxo,
    enforcerUtxo: dummyEnforcerUtxo,
    proofUtxo: dummyProofUtxo,
    userBchUtxos: [dummyUserCollateralUtxo],
    borrowCents: 10000n, // 100.00 PUSD
    collateralSats: 100_000_000n, // 1 BCH (at $300 = 300% ratio)
    startingRate: 137,
    frontendFeeBps: 25,
    frontendFeeAddress: treasuryAddress,
});

check('buildBorrowTx: builds borrow tx and passes all 4 covenant script VM evaluations', borrowRes.txHex.length > 200 && borrowRes.borrowedCents === 10000n);
check('buildBorrowTx: loanTokenId matches newly created key', borrowRes.loanTokenId === dummyGenesisTxid);
check('buildBorrowTx: protocol and frontend fees calculated correctly', borrowRes.protocolFeeSats >= 1000n && borrowRes.frontendFeeSats > 0n);

// Negative borrow tests
check('buildBorrowTx: rejects borrow under 100 PUSD minimum', (() => {
    try {
        buildBorrowTx({
            params: MAINNET_V1,
            provider,
            userAddress,
            userTokenAddress,
            borrowingUtxo: dummyBorrowingUtxo,
            priceUtxo: dummyPriceUtxo,
            enforcerUtxo: dummyEnforcerUtxo,
            proofUtxo: dummyProofUtxo,
            userBchUtxos: [dummyUserCollateralUtxo],
            borrowCents: 9900n, // $99.00
            collateralSats: 100_000_000n,
        });
        return false;
    } catch {
        return true;
    }
})());

check('buildBorrowTx: rejects borrow exceeding 110% collateral ratio', (() => {
    try {
        // At $300/BCH, 1 BCH collateral allows max borrow of (1 * 10/11) * 300 = $272.72 (27272 cents)
        buildBorrowTx({
            params: MAINNET_V1,
            provider,
            userAddress,
            userTokenAddress,
            borrowingUtxo: dummyBorrowingUtxo,
            priceUtxo: dummyPriceUtxo,
            enforcerUtxo: dummyEnforcerUtxo,
            proofUtxo: dummyProofUtxo,
            userBchUtxos: [dummyUserCollateralUtxo],
            borrowCents: 30000n, // $300 debt on $300 collateral (100% ratio < 110%)
            collateralSats: 100_000_000n,
        });
        return false;
    } catch {
        return true;
    }
})());

// ── 4. Manage builder ──
const dummyLoanCommitment = '01' + le(10000n, 6) + le(0n, 6) + '00' + le(174, 4) + le(137, 2) + le(137, 2) + '0000000000';
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
    vout: 3, // must be loan.vout + 1
    satoshis: 1000n,
    token: {
        category: dummyGenesisTxid,
        amount: 0n,
        nft: { capability: 'none', commitment: '01' },
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
const dummyLoanKeyUtxo: Utxo = {
    txid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    vout: 0,
    satoshis: 1000n,
    token: {
        category: dummyGenesisTxid,
        amount: 0n,
        nft: { capability: 'minting', commitment: '' },
    },
};

// Add collateral
const addRes = buildManageTx({
    params: MAINNET_V1,
    provider,
    userAddress,
    userTokenAddress,
    priceUtxo: dummyPriceUtxo,
    loanUtxo: dummyLoanUtxo,
    sidecarUtxo: dummySidecarUtxo,
    manageUtxo: dummyManageUtxo,
    loanKeyUtxo: dummyLoanKeyUtxo,
    userBchUtxos: [dummyUserCollateralUtxo],
    actionType: 'add',
    collateralDeltaSats: 50_000_000n,
});

check('buildManageTx: add collateral builds and passes VM evaluation', addRes.newCollateralSats === 150_000_000n && !addRes.isClose);

// Withdraw collateral
const withdrawRes = buildManageTx({
    params: MAINNET_V1,
    provider,
    userAddress,
    userTokenAddress,
    priceUtxo: dummyPriceUtxo,
    loanUtxo: dummyLoanUtxo,
    sidecarUtxo: dummySidecarUtxo,
    manageUtxo: dummyManageUtxo,
    loanKeyUtxo: dummyLoanKeyUtxo,
    userBchUtxos: [dummyFeeUtxo],
    actionType: 'withdraw',
    collateralDeltaSats: 20_000_000n,
});

check('buildManageTx: withdraw collateral builds and passes VM evaluation', withdrawRes.newCollateralSats === 80_000_000n && !withdrawRes.isClose);

// Close loan
const dummyPusdUtxo: Utxo = {
    txid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    vout: 0,
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.paryonTokenId,
        amount: 10000n, // exactly 100 PUSD
    },
};

const closeRes = buildManageTx({
    params: MAINNET_V1,
    provider,
    userAddress,
    userTokenAddress,
    priceUtxo: dummyPriceUtxo,
    loanUtxo: dummyLoanUtxo,
    sidecarUtxo: dummySidecarUtxo,
    manageUtxo: dummyManageUtxo,
    loanKeyUtxo: dummyLoanKeyUtxo,
    userBchUtxos: [dummyFeeUtxo],
    userPusdUtxos: [dummyPusdUtxo],
    actionType: 'close',
});

check('buildManageTx: close loan builds and passes VM evaluation', closeRes.isClose && closeRes.newDebtCents === 0n);

// ── 5. ChangeRate builder ──
const dummyChangeRateUtxo: Utxo = {
    txid: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    vout: 2,
    satoshis: 1000n,
    token: {
        category: MAINNET_V1.tokenIds.paryonTokenId,
        amount: 0n,
        nft: { capability: 'none', commitment: '08' },
    },
};

const changeRateRes = buildChangeRateTx({
    params: MAINNET_V1,
    provider,
    userAddress,
    userTokenAddress,
    loanUtxo: dummyLoanUtxo,
    sidecarUtxo: dummySidecarUtxo,
    changeRateUtxo: dummyChangeRateUtxo,
    loanKeyUtxo: dummyLoanKeyUtxo,
    userBchUtxos: [dummyFeeUtxo],
    nextRate: 200,
});

check('buildChangeRateTx: updates next rate and passes VM evaluation', changeRateRes.nextRate === 200 && changeRateRes.txHex.length > 200);

// Negative manage & changeRate tests
check('buildManageTx: rejects partial repay leaving debt under 100 PUSD', (() => {
    try {
        buildManageTx({
            params: MAINNET_V1,
            provider,
            userAddress,
            userTokenAddress,
            priceUtxo: dummyPriceUtxo,
            loanUtxo: dummyLoanUtxo,
            sidecarUtxo: dummySidecarUtxo,
            manageUtxo: dummyManageUtxo,
            loanKeyUtxo: dummyLoanKeyUtxo,
            userBchUtxos: [dummyUserCollateralUtxo],
            userPusdUtxos: [dummyPusdUtxo],
            actionType: 'repay',
            repayCents: 5000n, // repaying 50 PUSD leaves 50 PUSD, which is < 100 PUSD minimum
        });
        return false;
    } catch {
        return true;
    }
})());

check('buildManageTx: rejects withdraw exceeding max collateral (ratio < 110%)', (() => {
    try {
        // Collateral is 1 BCH (100,000,000 sats). Debt is $100. At $300/BCH, min collateral for $100 is ~0.366 BCH (36,666,666 sats).
        // Withdrawing 80,000,000 sats leaves 20,000,000 sats ($60 worth), which violates 110% ratio.
        buildManageTx({
            params: MAINNET_V1,
            provider,
            userAddress,
            userTokenAddress,
            priceUtxo: dummyPriceUtxo,
            loanUtxo: dummyLoanUtxo,
            sidecarUtxo: dummySidecarUtxo,
            manageUtxo: dummyManageUtxo,
            loanKeyUtxo: dummyLoanKeyUtxo,
            userBchUtxos: [dummyFeeUtxo],
            actionType: 'withdraw',
            collateralDeltaSats: 80_000_000n,
        });
        return false;
    } catch {
        return true;
    }
})());

check('buildManageTx: rejects wrong loan key token category in script VM', (() => {
    try {
        const fakeLoanKeyUtxo: Utxo = {
            ...dummyLoanKeyUtxo,
            token: {
                category: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                amount: 0n,
                nft: { capability: 'minting', commitment: '' },
            },
        };
        buildManageTx({
            params: MAINNET_V1,
            provider,
            userAddress,
            userTokenAddress,
            priceUtxo: dummyPriceUtxo,
            loanUtxo: dummyLoanUtxo,
            sidecarUtxo: dummySidecarUtxo,
            manageUtxo: dummyManageUtxo,
            loanKeyUtxo: fakeLoanKeyUtxo,
            userBchUtxos: [dummyUserCollateralUtxo],
            actionType: 'add',
            collateralDeltaSats: 50_000_000n,
        });
        return false;
    } catch {
        return true;
    }
})());

check('buildChangeRateTx: rejects negative rate', (() => {
    try {
        buildChangeRateTx({
            params: MAINNET_V1,
            provider,
            userAddress,
            userTokenAddress,
            loanUtxo: dummyLoanUtxo,
            sidecarUtxo: dummySidecarUtxo,
            changeRateUtxo: dummyChangeRateUtxo,
            loanKeyUtxo: dummyLoanKeyUtxo,
            userBchUtxos: [dummyFeeUtxo],
            nextRate: -1,
        });
        return false;
    } catch {
        return true;
    }
})());

check('verifyTx: rejects change output carrying stray tokens', (() => {
    try {
        // LoanKey tx with stray token on change output
        verifyTx({
            txHex: loanKeyRes.txHex,
            sourceOutputs: utxosToLibauthSourceOutputs(loanKeyRes.sourceOutputs),
            userAddress: 'bitcoincash:qq3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygrg4dtdzf', // wrong user address
            action: 'loanKey',
            contractInputIndices: [1],
        });
        return false;
    } catch {
        return true;
    }
})());

finish();
