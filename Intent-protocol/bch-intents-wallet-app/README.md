# BCH Intents Wallet for mobile

A self-custodial wallet for Android and iOS: Bitcoin Cash and CashTokens, Ethereum and its networks, Solana and Bitcoin, from one recovery phrase. The phone companion of the [browser extension](../bch-intents-wallet-extension), with the same accounts, the same swaps and the same look.

Built with React Native and Expo on Tether's [Wallet Development Kit](https://docs.wallet.tether.io). Keys live in WDK's worklet, a separate JavaScript runtime the interface cannot reach into.

> **Alpha.** Not audited, and not yet run on a phone by its authors. See [what is and is not verified](docs/internal/testing.md).

## What it does

- Creates or imports a 12 or 24 word phrase; a six-digit PIN and fingerprint or face unlock
- Several accounts per phrase, with the addresses MetaMask and Phantom derive
- Sends and receives on sixteen networks; scans QR codes to pay
- Swaps: BCH and CashTokens, USDC across chains (Circle CCTP), Solana tokens (Jupiter)
- Connects to dapps over WalletConnect: EVM, Solana and Bitcoin Cash
- Light and dark themes, English and Simplified Chinese, and Cham the chameleon

## Quick start

```bash
npm install            # also bundles the wallet worklet
npm run typecheck
npm test
```

To get it onto a phone:

```bash
npm install -g eas-cli
eas login
eas init
npm run build:apk      # a cloud build; install the APK from the link it prints
```

The app cannot run in Expo Go: it carries native code. [Building and releasing](docs/internal/release.md) has the details, including how to deploy the two swap services.

## Layout

```
wdk.config.js          which wallet module signs for which network
src/app/               screens (expo-router)
src/wdk/               the worklet: configuration, bridge, session, PIN, biometrics
src/state/             settings, accounts, portfolio
src/lib/               balances, sending, EVM transactions, scanning
src/swap/              the swap card's logic and its signing
src/connect/           WalletConnect
src/ui/                the design system
src/i18n/              strings only the app has
vendor/                copies of the shared package and the Bitcoin Cash module
tests/                 unit tests
docs/                  user, developer and internal documentation
```

## Documentation

Start at [docs/README.md](docs/README.md).

## Licence and credits

The project structure follows Tether's [wdk-starter-react-native](https://github.com/tetherto/wdk-starter-react-native) (Apache-2.0; its licence is kept in `LICENSE.wdk-starter`).
