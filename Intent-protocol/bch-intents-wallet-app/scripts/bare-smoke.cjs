// A smoke test of the wallet modules under the Bare runtime, the engine the worklet runs in on a phone:
//
//   npx bare scripts/bare-smoke.cjs
//
// It loads each module the way the generated worklet entry does, derives account 0 of the public Hardhat test
// phrase on a testnet, and reads its balance from the network. Nothing is signed or sent. A module that cannot
// load, derive or reach its server under Bare fails here, on a desktop, instead of on a device.

require('bare-node-runtime/global')

const PHRASE = 'test test test test test test test test test test test junk'
const withBare = { with: { imports: 'bare-node-runtime/imports' } }

const CASES = [
  ['bch-chipnet', '@bch-intents/wdk-wallet-bch', { network: 'chipnet', coinType: 0 }],
  ['base-sepolia', '@tetherto/wdk-wallet-evm', { provider: 'https://base-sepolia-rpc.publicnode.com', chainId: 84532 }],
  ['solana-devnet', '@tetherto/wdk-wallet-solana', { provider: 'https://api.devnet.solana.com', commitment: 'confirmed' }],
  ['btc-testnet', '@tetherto/wdk-wallet-btc', { network: 'testnet', client: { type: 'blockbook-http', clientConfig: { url: 'https://tbtc1.trezor.io/api' } } }]
]

async function main () {
  const only = Bare.argv[2]
  let failed = 0
  for (const [network, pkg, config] of CASES) {
    if (only && only !== network) continue
    try {
      const mod = require(pkg, withBare)
      const Manager = mod.default || mod
      const manager = new Manager(PHRASE, config)
      const account = await manager.getAccount(0)
      const address = await account.getAddress()
      const balance = await account.getBalance()
      const signature = await account.sign('bare smoke test')
      console.log(`ok   ${network}  ${address}  balance ${balance}  signature ${String(signature).slice(0, 16)}…`)
      if (network === 'bch-chipnet') {
        console.log(`     token address ${await account.getTokenAddress()}  tokens ${JSON.stringify(await account.getTokenBalances(), (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`)
      }
      try { manager.dispose() } catch {}
    } catch (error) {
      failed++
      console.log(`FAIL ${network}  ${error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : error}`)
    }
  }
  console.log(failed ? `${failed} failed` : 'all ok')
  Bare.exit(failed ? 1 : 0)
}

main()
