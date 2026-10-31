// Which wallet module the WDK worklet loads for each network. `npm install` runs the bundler, which packs these
// into .wdk-bundle/wdk-worklet.bundle.js; the app hands that bundle to the Bare runtime at start-up.
//
// The keys are the network keys of the shared chain table (vendor/wallet-core/src/chains.ts). They must stay in
// step with it: src/wdk/config.ts refuses to start with a network that has no module here.

const EVM = '@tetherto/wdk-wallet-evm';
const SOLANA = '@tetherto/wdk-wallet-solana';
const BTC = '@tetherto/wdk-wallet-btc';
const BCH = '@bch-intents/wdk-wallet-bch';

/** @type {import('@tetherto/wdk-worklet-bundler').WdkBundleConfig} */
module.exports = {
  networks: {
    'bch-chipnet': { package: BCH },
    'bch-mainnet': { package: BCH },

    'eth-sepolia': { package: EVM },
    'base-sepolia': { package: EVM },
    'arb-sepolia': { package: EVM },
    'op-sepolia': { package: EVM },
    'arc-testnet': { package: EVM },
    ethereum: { package: EVM },
    base: { package: EVM },
    arbitrum: { package: EVM },
    optimism: { package: EVM },
    arc: { package: EVM },

    'solana-devnet': { package: SOLANA },
    solana: { package: SOLANA },

    'btc-testnet': { package: BTC },
    'btc-mainnet': { package: BTC },
  },
};
