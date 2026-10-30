/**
 * spike_readonly.ts — checks every live dependency that needs no funded wallet.
 *   npx tsx scripts/spike_readonly.ts
 */
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { config, enabledChains } from '../src/config.js';
import { IrisClient } from '../src/cctp/iris.js';
import { evmToBytes32 } from '../src/cctp/encoding.js';
import { EvmAdapter } from '../src/evm/EvmAdapter.js';
import { SolanaAdapter } from '../src/solana/SolanaAdapter.js';

const ok = (m: string) => console.log(`  ok   ${m}`);
const bad = (m: string) => { console.log(`  FAIL ${m}`); process.exitCode = 1; };

async function main() {
    const iris = new IrisClient(config.irisBaseUrl);
    console.log('Iris');
    const fees = await iris.getFees(0, 26);
    ok(`fees 0→26 ${JSON.stringify(fees)}`);
    ok(`fast allowance ${await iris.getFastAllowance()} USDC`);
    const none = await iris.getMessages(6, '0x' + '11'.repeat(32));
    none === null ? ok('unknown tx → null (404)') : bad(`unknown tx returned ${JSON.stringify(none)}`);

    for (const c of enabledChains()) {
        console.log(`\n${c.name} (domain ${c.domain})`);
        try {
            if (c.kind === 'evm') {
                const a = new EvmAdapter(c);
                const net = await a.provider.getNetwork();
                net.chainId === BigInt(c.chainId!) ? ok(`chainId ${net.chainId}`) : bad(`chainId ${net.chainId} != ${c.chainId}`);
                const code = await a.provider.getCode(c.tokenMessenger!);
                code.length > 2 ? ok('TokenMessengerV2 deployed') : bad('no TokenMessengerV2 code');
                ok(`getMinFeeAmount(1 USDC) = ${await a.minFeeAmount(1_000_000n)}`);
                (await a.isNonceUsed('0x' + '00'.repeat(32))) ? ok('usedNonces(0) = used (as the contract sets it)') : bad('usedNonces(0) not set');
                (await a.isNonceUsed('0x' + 'ab'.repeat(32))) ? bad('random nonce marked used') : ok('random nonce unused');
                ok(`USDC balanceOf(0x…dEaD) = ${await a.usdcBalance('0x000000000000000000000000000000000000dEaD')}`);
                const fd = await a.provider.getFeeData();
                ok(`fee data maxFeePerGas=${fd.maxFeePerGas} prio=${fd.maxPriorityFeePerGas}`);
            } else {
                const a = new SolanaAdapter(c);
                ok(`min fee for 1 USDC = ${await a.minFeeAmount(1_000_000n)}`);
                (await a.isNonceUsed('0x' + 'ab'.repeat(32))) ? bad('random nonce marked used') : ok('random nonce unused');
                const owner = Keypair.generate().publicKey;
                const ix = await a.burnInstruction(owner, Keypair.generate().publicKey, {
                    owner: owner.toBase58(), amount: 1_000_000n, dstDomain: 26,
                    mintRecipient: evmToBytes32('0x000000000000000000000000000000000000dEaD'),
                    maxFee: 0n, minFinalityThreshold: 2000,
                });
                ok(`deposit_for_burn ix built: ${ix.keys.length} accounts, data ${ix.data.length} bytes`);
                const tx = new Transaction({ feePayer: owner, recentBlockhash: PublicKey.default.toBase58() }).add(ix);
                ok(`tx message size ${tx.serializeMessage().length} bytes (limit 1232)`);
                const { mintRecipient, tokenAccount } = a.mintRecipientFor(owner.toBase58());
                ok(`mintRecipient for wallet → ATA ${tokenAccount} (${mintRecipient.slice(0, 18)}…)`);
            }
        } catch (e: any) {
            bad(e?.shortMessage ?? e?.message ?? String(e));
        }
    }
}

main().catch(e => { console.error(e); process.exit(1); });
