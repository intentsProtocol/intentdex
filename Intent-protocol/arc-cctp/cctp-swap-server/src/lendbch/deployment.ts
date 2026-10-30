/**
 * lendbch deployment — turns a set of token IDs and parameters into every contract address lendbch reads.
 *
 * The derivation mirrors Paryon's own verify_contract_deployment tool exactly (same argument order, same
 * reverseHex of token-id args, same p2sh32 locking bytecode for address-type args), so the derived addresses
 * match the live deployment. P1 only needs the read-side contracts; the builders (P3) reuse these same Contract
 * instances. A `provider` is required for the address prefix only — no network call happens at derivation time.
 *
 * The live price contract is `PriceContractGuarded`, but the original `PriceContract` shares its constructor and
 * was the first deployment, so both are derived and kept in `priceVariants` (Guarded first). chain.ts probes them
 * and uses whichever still has thread UTXOs; see the price-migration self-check.
 */
import { Contract, type NetworkProvider } from 'cashscript';
import { paryonArtifacts } from '@paryonusd/contracts';
import { cashAddressToLockingBytecode, binToHex } from '@bitauth/libauth';
import type { Deployment, DeploymentParams, DerivedContract } from './types.js';

/** Paryon's mainnet-v1 deployment, copied verbatim from their verify tool (verify_contract_deployment/config.ts). */
export const MAINNET_V1: DeploymentParams = {
    id: 'mainnet-v1',
    network: 'mainnet',
    tokenIds: {
        paryonTokenId: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
        poolTokenId: '7708645a7f30e97003573d9322202960a560a87527bef3666a30044a0dfdfa81',
        redeemerTokenId: '649b2d862f01a904addf9095ae64860a59071544ee4a3695f14cbbc75571f930',
        loanKeyFactoryTokenId: 'f07165f2c3448ced3bf0b33f9048ceb7567a2c07adb60d8f11b301c42db97405',
        oracleMigrationKeyTokenId: '7776202e8f4eca51d5e634799c66c6a87076cc6efcc64c1322e7e880c71f6d30',
    },
    contractParams: {
        oraclePublicKey: '02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818',
        protocolFeeLockingBytecode: 'aa207c7a248c794af2cdf1b1a66a2311347c45b177fcb3aad730a7823c9e32fc754087',
        startBlockHeight: 948406,
        periodLengthBlocks: 144,
        timeLockRedemption: 12,
    },
};

/** Reverse a hex string byte-wise, as token-id constructor args require (Paryon's reverseHex). */
export function reverseHex(hex: string): string {
    const pairs = hex.match(/../g);
    if (!pairs) throw new Error(`cannot reverse hex: ${hex}`);
    return pairs.reverse().join('');
}

/** p2sh32 locking bytecode (hex) of a cashaddr — the value the contracts compare `lockingBytecode` against. */
export function lockingBytecodeOf(address: string): string {
    const result = cashAddressToLockingBytecode(address);
    if (typeof result === 'string') throw new Error(result);
    return binToHex(result.bytecode);
}

function derived(name: string, contract: Contract): DerivedContract {
    return { name, address: contract.address, tokenAddress: contract.tokenAddress, lockingBytecode: lockingBytecodeOf(contract.address) };
}

/**
 * Derive the full deployment from its parameters. `provider` only supplies the network prefix; all addresses are
 * computed locally. Throws if the artifacts and parameters don't produce valid addresses.
 */
export function deriveDeployment(params: DeploymentParams, provider: NetworkProvider): Deployment {
    const A = paryonArtifacts;
    const { paryonTokenId, loanKeyFactoryTokenId, oracleMigrationKeyTokenId } = params.tokenIds;
    const { oraclePublicKey, protocolFeeLockingBytecode, startBlockHeight, periodLengthBlocks } = params.contractParams;
    // cashscript defaults to p2sh32, which is what Paryon deployed; the verify tool omits the option too.
    const mk = (artifact: unknown, args: readonly unknown[]) => new Contract(artifact as any, [...args], { provider });

    // No-arg contracts first; their locking bytecode feeds the ones that reference them.
    const loan = mk(A.artifactLoan, []);
    const loanSidecar = mk(A.artifactLoanSidecar, []);
    const loanKeyOriginProof = mk(A.loanKey.artifactLoanKeyOriginProof, []);

    const loanKeyOriginEnforcer = mk(A.loanKey.artifactLoanKeyOriginEnforcer, [reverseHex(loanKeyFactoryTokenId), reverseHex(paryonTokenId)]);

    const borrowing = mk(A.artifactBorrowing, [
        lockingBytecodeOf(loan.address),
        lockingBytecodeOf(loanSidecar.address),
        protocolFeeLockingBytecode,
        lockingBytecodeOf(loanKeyOriginEnforcer.address),
        BigInt(startBlockHeight),
        BigInt(periodLengthBlocks),
    ]);

    const priceArgs = [oraclePublicKey, reverseHex(oracleMigrationKeyTokenId)] as const;
    const priceGuarded = mk(A.artifactPriceContractGuarded, priceArgs);
    const priceOriginal = mk(A.artifactPriceContract, priceArgs);

    const stabilityPool = mk(A.stabilityPool.artifactStabilityPool, []);
    const stabilityPoolSidecar = mk(A.stabilityPool.artifactStabilityPoolSidecar, [reverseHex(paryonTokenId)]);
    const payout = mk(A.stabilityPool.artifactPayout, []);
    const collector = mk(A.stabilityPool.artifactCollector, [reverseHex(paryonTokenId), protocolFeeLockingBytecode]);
    const addLiquidity = mk(A.stabilityPool.poolContractFunctions.artifactFunctionAddLiquidity, [reverseHex(paryonTokenId)]);
    const loanKeyFactory = mk(A.loanKey.artifactLoanKeyFactory, [lockingBytecodeOf(loanKeyOriginEnforcer.address), lockingBytecodeOf(loanKeyOriginProof.address)]);
    const manage = mk(A.loanContractFunctions.artifactFunctionManage, []);

    return {
        params,
        contracts: {
            borrowing: derived('borrowing', borrowing),
            loan: derived('loan', loan),
            loanSidecar: derived('loanSidecar', loanSidecar),
            loanKeyFactory: derived('loanKeyFactory', loanKeyFactory),
            loanKeyOriginEnforcer: derived('loanKeyOriginEnforcer', loanKeyOriginEnforcer),
            loanKeyOriginProof: derived('loanKeyOriginProof', loanKeyOriginProof),
            stabilityPool: derived('stabilityPool', stabilityPool),
            stabilityPoolSidecar: derived('stabilityPoolSidecar', stabilityPoolSidecar),
            collector: derived('collector', collector),
            payout: derived('payout', payout),
            addLiquidity: derived('addLiquidity', addLiquidity),
            manage: derived('manage', manage),
        },
        priceVariants: [derived('priceContractGuarded', priceGuarded), derived('priceContract', priceOriginal)],
    };
}
