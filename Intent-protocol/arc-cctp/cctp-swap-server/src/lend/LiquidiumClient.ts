/**
 * LiquidiumClient — the lending protocol behind /lend/*, through @liquidium/client (pinned to an exact version:
 * it is a 0.x SDK and has renamed things between releases).
 *
 * Simple Loans only: no account, no signature. Creating a loan returns a deposit address; the user's own wallet
 * sends the collateral there, and later the repayment to the repayment address. Mainnet only: the SDK has no
 * testnet.
 */
import { Chain, LiquidiumClient as Sdk, SimpleLoanCreatedError } from '@liquidium/client';
import type { LendProtocol, RawCreate, RawLoan, RawLtv, RawPool, RawPrices } from './types.js';

export class LiquidiumClient implements LendProtocol {
    // No `headers` option: the API's CORS policy allows only content-type and x-request-id.
    private sdk = new Sdk();

    async listPools(): Promise<RawPool[]> {
        return (await this.sdk.market.listPools()) as unknown as RawPool[];
    }

    async getPrices(): Promise<RawPrices> {
        return (await this.sdk.market.getAssetPrices()) as unknown as RawPrices;
    }

    calculateLtv(req: Parameters<LendProtocol['calculateLtv']>[0], pools: RawPool[], prices: RawPrices): RawLtv {
        return this.sdk.quote.calculateLtv(req as never, pools as never, prices as never) as unknown as RawLtv;
    }

    async create(req: RawCreate): Promise<RawLoan> {
        try {
            return (await this.sdk.simpleLoans.create(req as never)) as unknown as RawLoan;
        } catch (e) {
            // The loan exists remotely; only reading it back failed. Creating again would make a second loan.
            if (e instanceof SimpleLoanCreatedError) return (await this.sdk.simpleLoans.get({ loanId: e.loanId })) as unknown as RawLoan;
            throw e;
        }
    }

    async get(ref: string): Promise<RawLoan> {
        return (await this.sdk.simpleLoans.get({ ref })) as unknown as RawLoan;
    }

    async find(query: string): Promise<{ ref: string }[]> {
        return (await this.sdk.simpleLoans.find(query)).map(r => ({ ref: r.ref }));
    }

    // ── Advanced Mode: Profile, Portfolio, Outflows, Inflows ──

    async getProfileId(address: string): Promise<string | null> {
        return this.sdk.accounts.getProfileId(address);
    }

    async prepareCreateProfile(account: string) {
        const prep = await this.sdk.accounts.prepareCreateProfile({ account });
        return {
            account: prep.account,
            message: prep.message,
            expiryTimestamp: prep.data.expiryTimestamp,
            actionType: prep.actionType,
        };
    }

    async createProfile(account: string, chain: string, signature: string, expiryTimestamp: bigint): Promise<string> {
        const prep = await this.sdk.accounts.prepareCreateProfile({ account });
        const signingChain = chain.toUpperCase() === 'BTC' ? Chain.BTC : Chain.ETH;
        return prep.submit({ signature, chain: signingChain, account });
    }

    async getUserPositionSummary(profileId: string) {
        return this.sdk.positions.getUserPositionSummary(profileId);
    }

    async getUserReserves(profileId: string) {
        return this.sdk.positions.getUserReserves(profileId);
    }

    async getHealthFactor(profileId: string) {
        return this.sdk.positions.getHealthFactor(profileId);
    }

    async prepareBorrow(req: { profileId: string; poolId: string; amount: bigint; chain: string; receiver: string; signerWalletAddress: string }) {
        const chain = req.chain.toUpperCase() === 'BTC' ? Chain.BTC : req.chain.toUpperCase() === 'ETH' ? Chain.ETH : Chain.ICP;
        const prep = await this.sdk.lending.prepareBorrow({
            profileId: req.profileId,
            poolId: req.poolId,
            amount: req.amount,
            chain: chain as any,
            receiver: req.receiver as any,
            signerWalletAddress: req.signerWalletAddress,
        });
        return {
            message: prep.message,
            expiryTimestamp: prep.data.expiryTimestamp,
            actionType: prep.actionType,
            data: prep.data,
        };
    }

    async submitBorrow(data: any, signatureInfo: { signature: string; chain: string; account?: string }) {
        const chain = (data.chain ?? 'ETH').toUpperCase() === 'BTC' ? Chain.BTC : (data.chain ?? 'ETH').toUpperCase() === 'ETH' ? Chain.ETH : Chain.ICP;
        const prep = await this.sdk.lending.prepareBorrow({
            profileId: data.profileId,
            poolId: data.poolId,
            amount: BigInt(data.amount),
            chain: chain as any,
            receiver: data.receiver as any,
            signerWalletAddress: data.signerWalletAddress ?? signatureInfo.account,
        });
        const signingChain = signatureInfo.chain.toUpperCase() === 'BTC' ? Chain.BTC : Chain.ETH;
        return prep.submit({
            signature: signatureInfo.signature,
            chain: signingChain,
            account: signatureInfo.account,
        });
    }

    async prepareWithdraw(req: { profileId: string; poolId: string; amount: bigint; chain: string; receiver: string; signerWalletAddress: string }) {
        const chain = req.chain.toUpperCase() === 'BTC' ? Chain.BTC : req.chain.toUpperCase() === 'ETH' ? Chain.ETH : Chain.ICP;
        const prep = await this.sdk.lending.prepareWithdraw({
            profileId: req.profileId,
            poolId: req.poolId,
            amount: req.amount,
            chain: chain as any,
            receiver: req.receiver as any,
            signerWalletAddress: req.signerWalletAddress,
        });
        return {
            message: prep.message,
            expiryTimestamp: prep.data.expiryTimestamp,
            actionType: prep.actionType,
            data: prep.data,
        };
    }

    async submitWithdraw(data: any, signatureInfo: { signature: string; chain: string; account?: string }) {
        const chain = (data.chain ?? 'ETH').toUpperCase() === 'BTC' ? Chain.BTC : (data.chain ?? 'ETH').toUpperCase() === 'ETH' ? Chain.ETH : Chain.ICP;
        const prep = await this.sdk.lending.prepareWithdraw({
            profileId: data.profileId,
            poolId: data.poolId,
            amount: BigInt(data.amount),
            chain: chain as any,
            receiver: data.receiver as any,
            signerWalletAddress: data.signerWalletAddress ?? signatureInfo.account,
        });
        const signingChain = signatureInfo.chain.toUpperCase() === 'BTC' ? Chain.BTC : Chain.ETH;
        return prep.submit({
            signature: signatureInfo.signature,
            chain: signingChain,
            account: signatureInfo.account,
        });
    }

    async supplyTarget(profileId: string, poolId: string, action: 'deposit' | 'repay', chain: string) {
        const c = chain.toUpperCase() === 'BTC' ? Chain.BTC : chain.toUpperCase() === 'ETH' ? Chain.ETH : Chain.ICP;
        return this.sdk.lending.supply({
            profileId,
            poolId,
            action: action as any,
            chain: c as any,
        });
    }

    async submitInflow(txid: string, operation: 'deposit' | 'repayment', chain?: string) {
        const c = chain?.toUpperCase() === 'BTC' ? Chain.BTC : Chain.ETH;
        return this.sdk.lending.submitInflow({
            txid,
            operation: operation as any,
            chain: c as any,
        });
    }
}

