/**
 * verify_chains.ts — check the chain registry in src/config.ts against the chains themselves. Read-only.
 *   npx tsx scripts/verify_chains.ts                      (the testnet set)
 *   CCTP_NETWORK=mainnet npx tsx scripts/verify_chains.ts (the mainnet set; run before the first mainnet start)
 *
 * A wrong address in the registry would send a user's burn to the wrong contract, so nothing here is taken from
 * a document. For every EVM chain:
 *   - the RPC answers with the chain id in the registry
 *   - TokenMessengerV2 is a contract whose localMessageTransmitter() is the registry's MessageTransmitterV2
 *   - MessageTransmitterV2.localDomain() is the registry's CCTP domain
 *   - the USDC address is a 6-decimal token called USDC that the CCTP minter accepts for burning
 *     (TokenMinter.burnLimitsPerMessage(usdc) > 0: only tokens Circle has registered have a limit)
 * For Solana: both CCTP programs are executable, and the USDC mint has 6 decimals and is owned by the token program.
 * Last: Circle's attestation service answers fee lookups for every pair of domains in the set.
 */
import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { config, enabledChains, SOLANA_PROGRAMS, type ChainConfig } from '../src/config.js';

const MESSENGER_ABI = ['function localMessageTransmitter() view returns (address)', 'function localMinter() view returns (address)'];
const TRANSMITTER_ABI = ['function localDomain() view returns (uint32)'];
const MINTER_ABI = ['function burnLimitsPerMessage(address) view returns (uint256)'];
const ERC20_ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];

let pass = 0, fail = 0;
function check(ok: boolean, what: string, detail = '') {
    if (ok) pass++; else fail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
}

async function evm(c: ChainConfig) {
    const p = new ethers.JsonRpcProvider(c.rpcUrl, undefined, { staticNetwork: true });
    const chainId = Number((await p.getNetwork()).chainId);
    check(chainId === c.chainId, `chain id ${c.chainId}`, `RPC says ${chainId}`);
    if (chainId !== c.chainId) return;

    check((await p.getCode(c.tokenMessenger!)).length > 2, `TokenMessengerV2 ${c.tokenMessenger} is a contract`);
    const messenger = new ethers.Contract(c.tokenMessenger!, MESSENGER_ABI, p);
    const transmitter: string = await messenger.localMessageTransmitter();
    check(transmitter.toLowerCase() === c.messageTransmitter!.toLowerCase(), `its message transmitter is ${c.messageTransmitter}`, `chain says ${transmitter}`);
    const domain = Number(await new ethers.Contract(c.messageTransmitter!, TRANSMITTER_ABI, p).localDomain());
    check(domain === c.domain, `CCTP domain ${c.domain}`, `chain says ${domain}`);

    const usdc = new ethers.Contract(c.usdc, ERC20_ABI, p);
    const [symbol, decimals] = [await usdc.symbol(), Number(await usdc.decimals())];
    check(symbol === 'USDC' && decimals === 6, `${c.usdc} is USDC with 6 decimals`, `${symbol}, ${decimals}`);
    const minter: string = await messenger.localMinter();
    const limit: bigint = await new ethers.Contract(minter, MINTER_ABI, p).burnLimitsPerMessage(c.usdc);
    check(limit > 0n, 'the CCTP minter accepts it for burning', `burn limit per message ${ethers.formatUnits(limit, 6)} USDC`);
}

async function solana(c: ChainConfig) {
    const conn = new Connection(c.rpcUrl, 'confirmed');
    for (const [name, id] of Object.entries(SOLANA_PROGRAMS)) {
        const info = await conn.getAccountInfo(new PublicKey(id));
        check(!!info?.executable, `${name} ${id} is a program`);
    }
    const mint = await conn.getParsedAccountInfo(new PublicKey(c.usdc));
    const data = mint.value?.data as { parsed?: { info?: { decimals?: number } }; program?: string } | undefined;
    check(data?.program === 'spl-token' && data.parsed?.info?.decimals === 6, `${c.usdc} is a 6-decimal SPL mint`, `${data?.program}, ${data?.parsed?.info?.decimals}`);
}

async function iris(chains: ChainConfig[]) {
    console.log(`\nCircle attestation service  ${config.irisBaseUrl}`);
    for (const a of chains) {
        const others = chains.filter(b => b.key !== a.key);
        const results = await Promise.all(others.map(async b => {
            const res = await fetch(`${config.irisBaseUrl}/v2/burn/USDC/fees/${a.domain}/${b.domain}`, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
            const json = res?.status === 200 ? await res.json().catch(() => null) : null;
            return Array.isArray(json) && json.length > 0 ? null : `${b.key} (HTTP ${res?.status ?? 'none'})`;
        }));
        const bad = results.filter(Boolean);
        check(bad.length === 0, `fees from ${a.key} to ${others.length} chains`, bad.join(', '));
        await new Promise(r => setTimeout(r, 300));
    }
}

async function main() {
    const chains = enabledChains();
    console.log(`network: ${config.network}   chains: ${chains.map(c => c.key).join(', ')}`);
    for (const c of chains) {
        console.log(`\n${c.name}  (${c.key}, ${c.rpcUrl})`);
        try { await (c.kind === 'evm' ? evm(c) : solana(c)); }
        catch (e) { check(false, 'could not be checked', String((e as Error).message).slice(0, 160)); }
    }
    await iris(chains);
    console.log(`\n── verify_chains (${config.network}): ${pass} pass / ${fail} fail ──`);
    process.exit(fail ? 1 : 0);
}
main();
