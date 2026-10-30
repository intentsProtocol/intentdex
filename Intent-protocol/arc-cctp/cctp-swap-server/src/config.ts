/**
 * config.ts — chain registry + limits for the CCTP swap server.
 *
 * Testnet addresses verified 2026-09-28 against Circle docs (see arc-cctp/docs/01-verified-facts.md).
 * EVM CCTP V2 contracts share one address across all EVM testnets, Arc included, and another across all EVM
 * mainnets. One server serves one network: CCTP_NETWORK=testnet (default) or mainnet. The two never share a
 * data directory. `npm run verify:chains` checks every address below against the chains themselves.
 */
import dotenv from 'dotenv';
dotenv.config();

export type ChainKind = 'evm' | 'solana';

export interface ChainConfig {
    key: string;                 // stable id used by the API, e.g. 'base-sepolia'
    name: string;
    kind: ChainKind;
    domain: number;              // CCTP domain
    chainId?: number;            // EVM only
    rpcUrl: string;
    usdc: string;                // EVM token address, or Solana mint
    tokenMessenger?: string;     // EVM TokenMessengerV2
    messageTransmitter?: string; // EVM MessageTransmitterV2
    fastSource: boolean;         // can be a Fast Transfer source
    standardEtaSec: number;      // Standard attestation time (Circle finality table)
    fastEtaSec?: number;         // Fast attestation time
    minMaxFeePerGasGwei?: number;// tx floor; Arc silently drops txs below 20 gwei
    explorerTx: string;          // '{tx}' placeholder
    enabled: boolean;
}

const EVM_TESTNET_TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const EVM_TESTNET_MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';
const EVM_MAINNET_TOKEN_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
const EVM_MAINNET_MESSAGE_TRANSMITTER = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

export type CctpNetwork = 'testnet' | 'mainnet';
const network: CctpNetwork = (() => {
    const v = (process.env.CCTP_NETWORK || 'testnet').trim().toLowerCase();
    if (v !== 'testnet' && v !== 'mainnet') throw new Error('config: CCTP_NETWORK must be testnet or mainnet');
    return v;
})();

export const SOLANA_PROGRAMS = {
    messageTransmitter: 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
    tokenMessengerMinter: 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
};

const enabledList = (process.env.ENABLED_CHAINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const isEnabled = (key: string) => enabledList.length === 0 || enabledList.includes(key);

function evmTestnet(
    key: string, name: string, domain: number, chainId: number, rpcEnv: string, rpcDefault: string,
    usdc: string, opts: Partial<ChainConfig> & { explorerTx: string },
): ChainConfig {
    return {
        key, name, kind: 'evm', domain, chainId,
        rpcUrl: process.env[rpcEnv] || rpcDefault,
        usdc,
        tokenMessenger: EVM_TESTNET_TOKEN_MESSENGER,
        messageTransmitter: EVM_TESTNET_MESSAGE_TRANSMITTER,
        fastSource: true,
        standardEtaSec: 17 * 60,
        fastEtaSec: 8,
        enabled: isEnabled(key),
        ...opts,
    };
}

function evmMainnet(
    key: string, name: string, domain: number, chainId: number, rpcEnv: string, rpcDefault: string,
    usdc: string, opts: Partial<ChainConfig> & { explorerTx: string },
): ChainConfig {
    return {
        ...evmTestnet(key, name, domain, chainId, rpcEnv, rpcDefault, usdc, opts),
        tokenMessenger: EVM_MAINNET_TOKEN_MESSENGER,
        messageTransmitter: EVM_MAINNET_MESSAGE_TRANSMITTER,
    };
}

/**
 * Real USDC. The public RPC defaults are for trying things out; set a provider's URL for each chain before
 * taking traffic.
 */
function buildMainnetChains(): ChainConfig[] {
    return [
        evmMainnet('ethereum', 'Ethereum', 0, 1, 'ETHEREUM_RPC',
            'https://ethereum-rpc.publicnode.com', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            { fastEtaSec: 20, explorerTx: 'https://etherscan.io/tx/{tx}' }),
        evmMainnet('optimism', 'OP Mainnet', 2, 10, 'OPTIMISM_RPC',
            'https://mainnet.optimism.io', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
            { explorerTx: 'https://optimistic.etherscan.io/tx/{tx}' }),
        evmMainnet('arbitrum', 'Arbitrum', 3, 42161, 'ARBITRUM_RPC',
            'https://arb1.arbitrum.io/rpc', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            { explorerTx: 'https://arbiscan.io/tx/{tx}' }),
        evmMainnet('base', 'Base', 6, 8453, 'BASE_RPC',
            'https://mainnet.base.org', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            { explorerTx: 'https://basescan.org/tx/{tx}' }),
        evmMainnet('arc', 'Arc', 26, 5042, 'ARC_RPC',
            'https://rpc.mainnet.arc.io', '0x3600000000000000000000000000000000000000',
            {
                fastSource: false,
                standardEtaSec: 1,
                fastEtaSec: undefined,
                minMaxFeePerGasGwei: 20,
                explorerTx: 'https://explorer.arc.io/tx/{tx}',
            }),
        {
            key: 'solana', name: 'Solana', kind: 'solana', domain: 5,
            rpcUrl: process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com',
            usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            fastSource: true,
            standardEtaSec: 25,
            fastEtaSec: 8,
            explorerTx: 'https://explorer.solana.com/tx/{tx}',
            enabled: isEnabled('solana'),
        },
    ];
}

function buildTestnetChains(): ChainConfig[] {
    return [
        evmTestnet('eth-sepolia', 'Ethereum Sepolia', 0, 11155111, 'ETH_SEPOLIA_RPC',
            'https://ethereum-sepolia-rpc.publicnode.com', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
            { fastEtaSec: 20, explorerTx: 'https://sepolia.etherscan.io/tx/{tx}' }),
        evmTestnet('op-sepolia', 'OP Sepolia', 2, 11155420, 'OPTIMISM_SEPOLIA_RPC',
            'https://sepolia.optimism.io', '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
            { explorerTx: 'https://sepolia-optimism.etherscan.io/tx/{tx}' }),
        evmTestnet('arb-sepolia', 'Arbitrum Sepolia', 3, 421614, 'ARBITRUM_SEPOLIA_RPC',
            'https://sepolia-rollup.arbitrum.io/rpc', '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
            { explorerTx: 'https://sepolia.arbiscan.io/tx/{tx}' }),
        evmTestnet('base-sepolia', 'Base Sepolia', 6, 84532, 'BASE_SEPOLIA_RPC',
            'https://sepolia.base.org', '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            { explorerTx: 'https://sepolia.basescan.org/tx/{tx}' }),
        evmTestnet('arc-testnet', 'Arc Testnet', 26, 5042002, 'ARC_TESTNET_RPC',
            'https://rpc.testnet.arc.io', '0x3600000000000000000000000000000000000000',
            {
                fastSource: false,          // Standard only; attests in ~0.5 s anyway
                standardEtaSec: 1,
                fastEtaSec: undefined,
                minMaxFeePerGasGwei: 20,
                explorerTx: 'https://explorer.testnet.arc.io/tx/{tx}',
            }),
        {
            key: 'solana-devnet', name: 'Solana Devnet', kind: 'solana', domain: 5,
            rpcUrl: process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com',
            usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            fastSource: true,
            standardEtaSec: 25,
            fastEtaSec: 8,
            explorerTx: 'https://explorer.solana.com/tx/{tx}?cluster=devnet',
            enabled: isEnabled('solana-devnet'),
        },
    ];
}

const num = (name: string, def: number) => {
    const v = process.env[name];
    const n = v === undefined || v === '' ? def : Number(v);
    if (!Number.isFinite(n)) throw new Error(`config: ${name} must be a number`);
    return n;
};

export const config = {
    port: num('PORT', 3012),
    network,
    irisBaseUrl: process.env.IRIS_BASE_URL || (network === 'mainnet' ? 'https://iris-api.circle.com' : 'https://iris-api-sandbox.circle.com'),
    // Records, settings, treasury keys and the Solana lookup table are per network: never one directory for both.
    dataDir: process.env.DATA_DIR || (network === 'mainnet' ? './data-mainnet' : './data'),

    chains: network === 'mainnet' ? buildMainnetChains() : buildTestnetChains(),

    limits: {
        minTransferUsdc: num('MIN_TRANSFER_USDC', 1),
        maxTransferUsdc: num('MAX_TRANSFER_USDC', 100),
        createdTtlMin: num('CREATED_TTL_MIN', 60),         // no burn posted within this → EXPIRED
        burnNotFoundMin: num('BURN_NOT_FOUND_MIN', 30),    // burn hash never lands → FAILED
    },

    quote: {
        feeBufferPct: num('FEE_BUFFER_PCT', 20),
        standardFastEnoughSec: num('STANDARD_FAST_ENOUGH_SEC', 60),
        mintOverheadSec: num('MINT_OVERHEAD_SEC', 10),
    },

    worker: {
        pollIntervalMs: num('POLL_INTERVAL_MS', 3000),
        slowAttestationPollMs: num('SLOW_ATTESTATION_POLL_MS', 15000),
        concurrency: num('WORKER_CONCURRENCY', 8),
        maxBackoffMs: num('MAX_BACKOFF_MS', 10 * 60_000),
    },

    evm: {
        mintWaitTimeoutMs: num('EVM_MINT_WAIT_TIMEOUT_MS', 90_000),
        maxFeeBumps: num('EVM_MAX_FEE_BUMPS', 3),
    },

    watchdog: {
        intervalMs: num('WATCHDOG_INTERVAL_MS', 60_000),
        stuckMin: num('STUCK_TRANSFER_MIN', 20),
    },

    // Solana same-chain swaps through Jupiter. Mainnet only: Jupiter has no devnet, so this is independent
    // of the CCTP `network` above. The API key is read in index.ts through getSecret('JUPITER_API_KEY').
    jupiter: {
        enabled: process.env.JUPITER_ENABLED !== 'false',
        baseUrl: process.env.JUPITER_BASE_URL || 'https://api.jup.ag',
        rps: num('JUPITER_RPS', 0),                         // 0 = 0.5 without a key, 1 with one (free plan)
        solanaRpcUrl: process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com',
        referralAccount: process.env.JUPITER_REFERRAL_ACCOUNT || '',
        referralFeeBps: num('JUPITER_REFERRAL_FEE_BPS', 0), // 50-255, only with a referral account
        maxSlippageBps: num('JUPITER_MAX_SLIPPAGE_BPS', 1000),
        tokenRefreshMin: num('JUPITER_TOKEN_REFRESH_MIN', 10),
        orderTtlSec: num('JUPITER_ORDER_TTL_SEC', 120),
        landTimeoutSec: num('JUPITER_LAND_TIMEOUT_SEC', 180),
        sweepIntervalMs: num('JUPITER_SWEEP_INTERVAL_MS', 30_000),   // how often open swaps are settled without being read
    },

    // Bitcoin Cash cross-chain swaps through NEAR Intents 1Click API
    bch: {
        enabled: process.env.BCH_SWAPS_ENABLED !== 'false',
        oneClickBaseUrl: process.env.ONECLICK_BASE_URL || 'https://1click.chaindefuser.com/v0',
        partnerJwt: process.env.ONECLICK_PARTNER_JWT || '',
        feeRecipientNear: process.env.ONECLICK_FEE_RECIPIENT || 'antony.near',
        defaultFeeBps: num('BCH_DEFAULT_FEE_BPS', 25),
        minSwapUsd: num('BCH_MIN_SWAP_USDC', 10),
        maxSwapUsd: num('BCH_MAX_SWAP_USDC', 25000),
        tokenRefreshMin: num('BCH_TOKEN_REFRESH_MIN', 10),
        pollIntervalMs: num('BCH_POLL_INTERVAL_MS', 5000),
    },
};

if (config.jupiter.referralAccount && (config.jupiter.referralFeeBps < 50 || config.jupiter.referralFeeBps > 255)) {
    throw new Error('config: JUPITER_REFERRAL_FEE_BPS must be 50-255 when JUPITER_REFERRAL_ACCOUNT is set');
}

// A mainnet server pointed at the sandbox attestation service (or the reverse) would never deliver anything.
if (/sandbox/.test(config.irisBaseUrl) !== (network === 'testnet')) {
    throw new Error(`config: IRIS_BASE_URL ${config.irisBaseUrl} does not belong to CCTP_NETWORK=${network}`);
}

export function getChain(key: string): ChainConfig | undefined {
    return config.chains.find(c => c.key === key && c.enabled);
}

export function getChainByDomain(domain: number): ChainConfig | undefined {
    return config.chains.find(c => c.domain === domain && c.enabled);
}

export function enabledChains(): ChainConfig[] {
    return config.chains.filter(c => c.enabled);
}

export function explorerUrl(chain: ChainConfig, tx?: string): string | undefined {
    return tx ? chain.explorerTx.replace('{tx}', tx) : undefined;
}
