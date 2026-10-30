/**
 * lendbch full derivation — every one of the 26 contract addresses, in the exact argument order of Paryon's
 * verify_contract_deployment/contractAddresses.ts. P1's deployment.ts derives only the read-side contracts; the
 * chipnet deployer and keeper need the complete set (all 8 loan functions, 4 pool functions, the redeemer trio).
 *
 * The loan- and pool-function arrays are returned in their commitment order (loan 01–08, pool 01–04), which is how
 * the genesis transactions tag each function NFT. Validated against Paryon mainnet (see scripts/lendbch/derive-check).
 */
import { Contract, type NetworkProvider } from 'cashscript';
import { paryonArtifacts } from '@paryonusd/contracts';
import { reverseHex, lockingBytecodeOf } from './deployment.js';
import type { DeploymentParams } from './types.js';

export interface FullContract { name: string; address: string; tokenAddress: string; lockingBytecode: string; }
export interface FullDeployment {
    params: DeploymentParams;
    borrowing: FullContract;
    priceGuarded: FullContract;
    priceOriginal: FullContract;
    loan: FullContract;
    loanSidecar: FullContract;
    loanKeyOriginEnforcer: FullContract;
    loanKeyOriginProof: FullContract;
    loanKeyFactory: FullContract;
    stabilityPool: FullContract;
    stabilityPoolSidecar: FullContract;
    payout: FullContract;
    collector: FullContract;
    redeemer: FullContract;
    redemption: FullContract;
    redemptionSidecar: FullContract;
    /** liquidate(01), manage(02), redeem(03), startRedemption(04), swapIn(05), swapOut(06), payInterest(07), changeInterest(08). */
    loanFunctions: FullContract[];
    /** addLiquidity(01), liquidateLoan(02), newPeriodPool(03), withdrawFromPool(04). */
    poolFunctions: FullContract[];
}

export function deriveFullDeployment(params: DeploymentParams, provider: NetworkProvider): FullDeployment {
    const A = paryonArtifacts;
    const { paryonTokenId, poolTokenId, redeemerTokenId, loanKeyFactoryTokenId, oracleMigrationKeyTokenId } = params.tokenIds;
    const { oraclePublicKey, protocolFeeLockingBytecode, startBlockHeight, periodLengthBlocks, timeLockRedemption } = params.contractParams;
    const mk = (artifact: unknown, args: readonly unknown[]) => new Contract(artifact as any, [...args], { provider });
    const fc = (name: string, c: Contract): FullContract => ({ name, address: c.address, tokenAddress: c.tokenAddress, lockingBytecode: lockingBytecodeOf(c.address) });
    const start = BigInt(startBlockHeight), period = BigInt(periodLengthBlocks), timeLock = BigInt(timeLockRedemption);

    // paryonTokenId contracts
    const loan = mk(A.artifactLoan, []);
    const loanSidecar = mk(A.artifactLoanSidecar, []);
    const proof = mk(A.loanKey.artifactLoanKeyOriginProof, []);
    const enforcer = mk(A.loanKey.artifactLoanKeyOriginEnforcer, [reverseHex(loanKeyFactoryTokenId), reverseHex(paryonTokenId)]);
    const borrowing = mk(A.artifactBorrowing, [lockingBytecodeOf(loan.address), lockingBytecodeOf(loanSidecar.address), protocolFeeLockingBytecode, lockingBytecodeOf(enforcer.address), start, period]);
    const priceArgs = [oraclePublicKey, reverseHex(oracleMigrationKeyTokenId)] as const;
    const priceGuarded = mk(A.artifactPriceContractGuarded, priceArgs);
    const priceOriginal = mk(A.artifactPriceContract, priceArgs);
    const lf = A.loanContractFunctions;
    const loanFunctions = [
        fc('liquidate', mk(lf.artifactFunctionLiquidate, [reverseHex(poolTokenId)])),
        fc('manage', mk(lf.artifactFunctionManage, [])),
        fc('redeem', mk(lf.artifactFunctionRedeem, [reverseHex(redeemerTokenId), timeLock, start, period])),
        fc('startRedemption', mk(lf.artifactFunctionStartRedemption, [reverseHex(redeemerTokenId)])),
        fc('swapInRedemption', mk(lf.artifactFunctionSwapInRedemption, [reverseHex(redeemerTokenId)])),
        fc('swapOutRedemption', mk(lf.artifactFunctionSwapOutRedemption, [reverseHex(redeemerTokenId)])),
        fc('payInterest', mk(lf.artifactFunctionPayInterest, [reverseHex(poolTokenId)])),
        fc('changeInterest', mk(lf.artifactFunctionChangeInterest, [])),
    ];

    // poolTokenId contracts
    const sp = A.stabilityPool;
    const stabilityPool = mk(sp.artifactStabilityPool, []);
    const stabilityPoolSidecar = mk(sp.artifactStabilityPoolSidecar, [reverseHex(paryonTokenId)]);
    const payout = mk(sp.artifactPayout, []);
    const collector = mk(sp.artifactCollector, [reverseHex(paryonTokenId), protocolFeeLockingBytecode]);
    const pf = sp.poolContractFunctions;
    const poolFunctions = [
        fc('addLiquidity', mk(pf.artifactFunctionAddLiquidity, [reverseHex(paryonTokenId)])),
        fc('liquidateLoan', mk(pf.artifactFunctionLiquidateLoan, [reverseHex(paryonTokenId)])),
        fc('newPeriodPool', mk(pf.artifactFunctionNewPeriodPool, [lockingBytecodeOf(payout.address), lockingBytecodeOf(collector.address), start, period])),
        fc('withdrawFromPool', mk(pf.artifactFunctionWithdrawFromPool, [])),
    ];

    // redeemerTokenId contracts
    const rd = A.redeemer;
    const redemptionSidecar = mk(rd.artifactRedemptionSidecar, []);
    const redemption = mk(rd.artifactRedemption, [reverseHex(paryonTokenId)]);
    const redeemer = mk(rd.artifactRedeemer, [reverseHex(paryonTokenId), lockingBytecodeOf(redemption.address), lockingBytecodeOf(redemptionSidecar.address)]);

    // loanKeyFactoryTokenId contract
    const loanKeyFactory = mk(A.loanKey.artifactLoanKeyFactory, [lockingBytecodeOf(enforcer.address), lockingBytecodeOf(proof.address)]);

    return {
        params,
        borrowing: fc('borrowing', borrowing),
        priceGuarded: fc('priceContractGuarded', priceGuarded),
        priceOriginal: fc('priceContract', priceOriginal),
        loan: fc('loan', loan),
        loanSidecar: fc('loanSidecar', loanSidecar),
        loanKeyOriginEnforcer: fc('loanKeyOriginEnforcer', enforcer),
        loanKeyOriginProof: fc('loanKeyOriginProof', proof),
        loanKeyFactory: fc('loanKeyFactory', loanKeyFactory),
        stabilityPool: fc('stabilityPool', stabilityPool),
        stabilityPoolSidecar: fc('stabilityPoolSidecar', stabilityPoolSidecar),
        payout: fc('payout', payout),
        collector: fc('collector', collector),
        redeemer: fc('redeemer', redeemer),
        redemption: fc('redemption', redemption),
        redemptionSidecar: fc('redemptionSidecar', redemptionSidecar),
        loanFunctions,
        poolFunctions,
    };
}
