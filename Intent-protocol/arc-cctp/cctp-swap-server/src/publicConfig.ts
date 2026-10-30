/**
 * publicConfig — what a client needs to shape its forms before it asks for a quote: per product, whether it is
 * open, the limits, the fee policy and the networks. Built on every request, so an admin change shows at once.
 * Nothing here is secret: the same facts are visible through quotes and /health.
 */
import { config, enabledChains, SOLANA_PROGRAMS, type ChainConfig } from './config.js';
import { WSOL_MINT } from './jupiter/TokenCatalog.js';
import type { Settings } from './settings.js';
import type { Treasury } from './treasury/Treasury.js';

/** One chain as /chains and /config list it. */
export function chainView(c: ChainConfig) {
    return {
        key: c.key, name: c.name, kind: c.kind, domain: c.domain, chainId: c.chainId, usdc: c.usdc,
        tokenMessenger: c.tokenMessenger ?? (c.kind === 'solana' ? SOLANA_PROGRAMS.tokenMessengerMinter : undefined),
        messageTransmitter: c.messageTransmitter ?? (c.kind === 'solana' ? SOLANA_PROGRAMS.messageTransmitter : undefined),
        fastSource: c.fastSource, standardEtaSec: c.standardEtaSec, fastEtaSec: c.fastEtaSec,
        minMaxFeePerGasGwei: c.minMaxFeePerGasGwei, explorerTx: c.explorerTx,
    };
}

export function publicConfig(settings: Settings, treasury: Treasury, chains: ChainConfig[] = enabledChains(), now = Date.now()) {
    const c = settings.cctp, s = settings.solana, b = settings.bch;
    const open = chains.filter(x => settings.chainOpen(x.key));
    const openKeys = new Set(open.map(x => x.key));
    // A fee is charged only when a rate is set and there is a treasury wallet for the source chain's type.
    const hasRate = c.feeBps > 0 || c.feeMinUsdc > 0 || Object.values(c.gasFeeUsdc).some(v => v > 0);
    const solanaFee = !!settings.referralAccount() && (s.referralFeeBps > 0 || (s.stocksFeeBps ?? 0) > 0 || (s.stablesFeeBps ?? 0) > 0);
    return {
        serverTime: now,
        cctp: {
            network: config.network,
            paused: c.paused, pauseReason: c.pauseReason,
            relayEnabled: c.relayEnabled, fastEnabled: c.fastEnabled,
            minTransferUsdc: c.minTransferUsdc, maxTransferUsdc: c.maxTransferUsdc,
            createdTtlSec: config.limits.createdTtlMin * 60,
            fee: {
                bps: c.feeBps, minUsdc: c.feeMinUsdc, maxUsdc: c.feeMaxUsdc, gasUsdc: c.gasFeeUsdc, enforced: c.feeEnforced,
                collecting: { evm: hasRate && !!treasury.active('evm'), solana: hasRate && !!treasury.active('solana') },
            },
            chains: open.map(chainView),
            closedRoutes: c.disabledRoutes.filter(r => { const [a, b] = r.split('>'); return openKeys.has(a) && openKeys.has(b); }),
        },
        solana: {
            enabled: config.jupiter.enabled, network: 'mainnet' as const,
            paused: s.paused, pauseReason: s.pauseReason,
            stocksEnabled: s.stocksEnabled, allowUnverified: s.allowUnverified,
            slippage: { defaultBps: s.defaultSlippageBps, maxBps: s.maxSlippageBps },
            maxSwapUsd: s.maxSwapUsd,
            orderTtlSec: config.jupiter.orderTtlSec,
            nativeMint: WSOL_MINT,
            fee: { referralFeeBps: s.referralFeeBps, stocksFeeBps: s.stocksFeeBps, stablesFeeBps: s.stablesFeeBps, active: solanaFee },
        },
        bch: {
            enabled: config.bch.enabled && b.enabled,
            network: 'mainnet' as const,
            paused: b.paused,
            pauseReason: b.pauseReason,
            feeBps: b.feeBps,
            feeRecipientNear: b.feeRecipientNear,
            minSwapUsd: b.minSwapUsd,
            maxSwapUsd: b.maxSwapUsd,
        },
    };
}
