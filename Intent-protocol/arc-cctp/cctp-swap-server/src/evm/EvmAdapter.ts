/**
 * EvmAdapter — CCTP V2 on an EVM chain (Ethereum, Base, Arbitrum, OP and Arc; testnets or mainnets).
 * ABIs taken from circlefin/evm-cctp-contracts src/v2 (TokenMessengerV2, BaseTokenMessenger, MessageTransmitterV2).
 */
import { ethers } from 'ethers';
import type { ChainConfig } from '../config.js';
import { config } from '../config.js';
import { ZERO_BYTES32, evmToBytes32 } from '../cctp/encoding.js';
import { HttpError, type BuiltTx, type BurnCheck, type FeeCheck, type MintCheck, type MintResult, type ParsedBurn } from '../types.js';
import { MintError, classifyMintError, type BuildBurnParams, type ChainAdapter } from '../chains/adapter.js';
import { errMsg } from '../log.js';
import { TxSender } from './TxSender.js';

export const TOKEN_MESSENGER_ABI = [
    'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
    'function getMinFeeAmount(uint256 amount) view returns (uint256)',
    'event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)',
    'event MintAndWithdraw(address indexed mintRecipient, uint256 amount, address indexed mintToken, uint256 feeCollected)',
];

export const MESSAGE_TRANSMITTER_ABI = [
    'function receiveMessage(bytes message, bytes attestation) returns (bool)',
    'function usedNonces(bytes32 nonce) view returns (uint256)',
    'event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)',
];

export const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const tmIface = new ethers.Interface(TOKEN_MESSENGER_ABI);
const mtIface = new ethers.Interface(MESSAGE_TRANSMITTER_ABI);
const erc20Iface = new ethers.Interface(ERC20_ABI);

export class EvmAdapter implements ChainAdapter {
    readonly provider: ethers.JsonRpcProvider;
    private sender?: TxSender;
    private tm: ethers.Contract;
    private mt: ethers.Contract;
    private usdc: ethers.Contract;

    constructor(readonly chain: ChainConfig, relayerKey?: string) {
        if (chain.kind !== 'evm' || !chain.chainId || !chain.tokenMessenger || !chain.messageTransmitter) {
            throw new Error(`EvmAdapter: bad chain config ${chain.key}`);
        }
        this.provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId, { staticNetwork: true });
        this.tm = new ethers.Contract(chain.tokenMessenger, TOKEN_MESSENGER_ABI, this.provider);
        this.mt = new ethers.Contract(chain.messageTransmitter, MESSAGE_TRANSMITTER_ABI, this.provider);
        this.usdc = new ethers.Contract(chain.usdc, ERC20_ABI, this.provider);
        if (relayerKey) {
            const wallet = new ethers.Wallet(relayerKey, this.provider);
            this.sender = new TxSender(wallet, chain.chainId, {
                floorGwei: chain.minMaxFeePerGasGwei,
                waitTimeoutMs: config.evm.mintWaitTimeoutMs,
                maxBumps: config.evm.maxFeeBumps,
                chainKey: chain.key,
            });
        }
    }

    validateAddress(a: string): boolean {
        return /^0x[0-9a-fA-F]{40}$/.test(a) && ethers.isAddress(a);
    }

    isValidTxHash(h: string): boolean {
        return /^0x[0-9a-fA-F]{64}$/.test(h);
    }

    mintRecipientFor(wallet: string) {
        return { mintRecipient: evmToBytes32(ethers.getAddress(wallet)) };
    }

    async buildBurn(p: BuildBurnParams): Promise<BuiltTx[]> {
        const owner = ethers.getAddress(p.owner);
        const [balance, allowance]: [bigint, bigint] = await Promise.all([
            this.usdc.balanceOf(owner), this.usdc.allowance(owner, this.chain.tokenMessenger),
        ]);
        const need = p.amount + (p.fee?.amount ?? 0n);
        if (balance < need) {
            throw new HttpError(400, `insufficient USDC on ${this.chain.name}: have ${balance}, need ${need} (base units)`, 'INSUFFICIENT_FUNDS');
        }
        const base = { chain: 'evm' as const, chainId: this.chain.chainId!, value: '0' as const, minMaxFeePerGasGwei: this.chain.minMaxFeePerGasGwei };
        const txs: BuiltTx[] = [];
        if (allowance < p.amount) {
            txs.push({ ...base, kind: 'approve', to: this.chain.usdc, data: erc20Iface.encodeFunctionData('approve', [this.chain.tokenMessenger, p.amount]) });
        }
        txs.push({
            ...base, kind: 'burn', to: this.chain.tokenMessenger!,
            data: tmIface.encodeFunctionData('depositForBurn', [
                p.amount, p.dstDomain, p.mintRecipient, this.chain.usdc, ZERO_BYTES32, p.maxFee, p.minFinalityThreshold,
            ]),
        });
        // Our fee goes last, so a user who stops halfway has never paid for a transfer that did not happen.
        if (p.fee && p.fee.amount > 0n) {
            txs.push({ ...base, kind: 'fee', to: this.chain.usdc, data: erc20Iface.encodeFunctionData('transfer', [ethers.getAddress(p.fee.recipient), p.fee.amount]) });
        }
        return txs;
    }

    async checkBurn(txHash: string): Promise<BurnCheck> {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (!receipt) return { state: 'pending' };
        if (receipt.status !== 1) return { state: 'failed', reason: 'burn transaction reverted' };
        const tmAddr = this.chain.tokenMessenger!.toLowerCase();
        for (const lg of receipt.logs) {
            if (lg.address.toLowerCase() !== tmAddr) continue;
            let parsed: ethers.LogDescription | null = null;
            try { parsed = tmIface.parseLog({ topics: [...lg.topics], data: lg.data }); } catch { /* other event */ }
            if (parsed?.name !== 'DepositForBurn') continue;
            const a = parsed.args;
            const burn: ParsedBurn = {
                amount: a.amount as bigint,
                destinationDomain: Number(a.destinationDomain),
                mintRecipient: (a.mintRecipient as string).toLowerCase(),
                destinationCaller: (a.destinationCaller as string).toLowerCase(),
                maxFee: a.maxFee as bigint,
                minFinalityThreshold: Number(a.minFinalityThreshold),
                burnToken: evmToBytes32(a.burnToken as string),
                sender: evmToBytes32(a.depositor as string),
            };
            return { state: 'confirmed', burn };
        }
        return { state: 'failed', reason: 'no DepositForBurn event from TokenMessengerV2 in this transaction' };
    }

    /**
     * On-chain minimum fee for `amount`. Older TokenMessengerV2 builds (e.g. Base/Eth/OP/Arb Sepolia at the
     * time of writing) have no minFee at all, so the call reverts without data: that means no minimum.
     */
    async minFeeAmount(amount: bigint): Promise<bigint> {
        if (amount <= 1n) return 0n;
        try {
            return (await this.tm.getMinFeeAmount(amount)) as bigint;
        } catch (e: any) {
            if (e?.code === 'CALL_EXCEPTION' && (!e.data || e.data === '0x')) return 0n;
            throw e;
        }
    }

    async checkFee(txHash: string, f: { from: string; to: string; amount: bigint }): Promise<FeeCheck> {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (!receipt) return 'pending';
        if (receipt.status !== 1) return 'missing';
        const usdc = this.chain.usdc.toLowerCase(), from = f.from.toLowerCase(), to = f.to.toLowerCase();
        let paid = 0n;
        for (const lg of receipt.logs) {
            if (lg.address.toLowerCase() !== usdc) continue;
            let p: ethers.LogDescription | null = null;
            try { p = erc20Iface.parseLog({ topics: [...lg.topics], data: lg.data }); } catch { /* other event */ }
            if (p?.name === 'Transfer' && (p.args.from as string).toLowerCase() === from && (p.args.to as string).toLowerCase() === to) paid += p.args.value as bigint;
        }
        return paid >= f.amount ? 'paid' : 'missing';
    }

    async isNonceUsed(nonce: string): Promise<boolean> {
        return ((await this.mt.usedNonces(nonce)) as bigint) > 0n;
    }

    async mint(m: { message: string; attestation: string }, onSent: (h: string) => void): Promise<MintResult> {
        if (!this.sender) throw new MintError('relayer key not configured', 'transient');
        let receipt: ethers.TransactionReceipt;
        try {
            receipt = await this.sender.send({
                to: this.chain.messageTransmitter!,
                data: mtIface.encodeFunctionData('receiveMessage', [m.message, m.attestation]),
            }, onSent);
        } catch (e) {
            const msg = errMsg(e);
            throw new MintError(msg, classifyMintError(msg));
        }
        if (receipt.status !== 1) throw new MintError(`receiveMessage reverted in ${receipt.hash}`, 'transient');
        return this.parseMint(receipt);
    }

    /** Gas the relayer paid, in the chain's native unit (ETH, or USDC on Arc). */
    private gasCost(r: ethers.TransactionReceipt) {
        return { amount: ethers.formatEther(r.gasUsed * r.gasPrice), symbol: this.chain.minMaxFeePerGasGwei ? 'USDC' : 'ETH' };
    }

    private parseMint(receipt: ethers.TransactionReceipt): MintResult {
        const tmAddr = this.chain.tokenMessenger!.toLowerCase();
        for (const lg of receipt.logs) {
            if (lg.address.toLowerCase() !== tmAddr) continue;
            try {
                const p = tmIface.parseLog({ topics: [...lg.topics], data: lg.data });
                if (p?.name === 'MintAndWithdraw') {
                    return { txHash: receipt.hash, received: p.args.amount as bigint, feeCollected: p.args.feeCollected as bigint, gasCost: this.gasCost(receipt) };
                }
            } catch { /* other event */ }
        }
        return { txHash: receipt.hash, gasCost: this.gasCost(receipt) };
    }

    async checkMint(txHash: string): Promise<MintCheck> {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (!receipt) {
            const tx = await this.provider.getTransaction(txHash);
            return tx ? { state: 'pending' } : { state: 'unknown' };
        }
        if (receipt.status !== 1) return { state: 'reverted' };
        return { state: 'success', result: this.parseMint(receipt) };
    }

    relayerAddress() { return this.sender?.address; }

    async relayerBalance() {
        const addr = this.sender?.address;
        if (!addr) return { amount: '0', symbol: 'n/a' };
        const wei = await this.provider.getBalance(addr);
        return { amount: ethers.formatEther(wei), symbol: this.chain.minMaxFeePerGasGwei ? 'USDC (native gas)' : 'ETH' };
    }

    async usdcBalance(wallet: string): Promise<bigint> {
        return (await this.usdc.balanceOf(wallet)) as bigint;
    }
}
