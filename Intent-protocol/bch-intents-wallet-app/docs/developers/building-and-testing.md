# Building and testing

## Requirements

- Node 22 or newer, npm 11 or newer
- The two sibling folders next to this one, if you want to change shared code: `../bch-intents-wallet-core` and `../wdk-wallet-bch`. Without them the copies in `vendor/` are used as committed.
- For a build: an Expo account (cloud build), or Android Studio with JDK 17 (local build)

## Install

```bash
npm install
```

`postinstall` bundles the wallet worklet into `.wdk-bundle/wdk-worklet.bundle.js`. It takes about half a minute. Run it again by hand, after changing `wdk.config.js` or a wallet module, with:

```bash
npm run bundle:worklet
```

## Checks

```bash
npm run typecheck                     # the whole app, including vendor/wallet-core
npm test                              # unit tests (vitest)
npm run sync:check                    # vendor/ matches the sibling packages
npx bare scripts/bare-smoke.cjs       # the wallet modules under Bare, against testnets
npx expo export --platform android    # Metro bundles the app
```

None of these needs a phone. What they prove and what they leave open is listed in [testing](../internal/testing.md).

`bare-smoke` needs the Bare runtime: `npm i -g bare`, or `npx bare`.

## Run it

The app contains native code and cannot run in Expo Go. Install a development build once (see [building and releasing](../internal/release.md)), then:

```bash
npm start
```

Open the app on the phone; it loads the JavaScript from your machine and reloads as you edit.

## Configuration

Copy `.env.example` to `.env`. Every value is an `EXPO_PUBLIC_` variable, read in `src/lib/config.ts`.

| Variable | Meaning |
|---|---|
| `EXPO_PUBLIC_SWAP_SERVER_TESTNET`, `…_MAINNET` | cctp-swap-server, one instance per mode |
| `EXPO_PUBLIC_CASHTOKEN_RELAYER`, `…_MAINNET` | cashtoken-relayer |
| `EXPO_PUBLIC_REOWN_PROJECT_ID` | WalletConnect project id |
| `EXPO_PUBLIC_PRICE_FEED` | optional price feed; empty uses CoinGecko |
| `EXPO_PUBLIC_RPC_<NETWORK>` | replace a network's public RPC |

Expo replaces `process.env.EXPO_PUBLIC_X` only where it is written out in full, which is why `config.ts` names every variable and looks none up by a computed key. A new variable needs a line there.

A service with no URL is treated as absent. There is no localhost default: on a phone, localhost is the phone.

## Working on shared code

`vendor/` holds copies of two packages. Edit the originals, never the copies:

```bash
# edit ../bch-intents-wallet-core or ../wdk-wallet-bch, run its tests, then
npm run sync
npm run bundle:worklet      # only after changing wdk-wallet-bch
```

Commit `vendor/` with the change that needed it.

## Adding a network

1. Add it to `NETWORKS` in `../bch-intents-wallet-core/src/chains.ts`, then `npm run sync`.
2. Add its key to `wdk.config.js` with the module that signs for it.
3. If the family is new, add a case to `configFor` and `derivationPath` in `src/wdk/config.ts`.
4. `npm run bundle:worklet`, then `npm test`: the first test fails if step 2 was missed.

## Adding a string

Strings shared with the extension go in the shared package's catalogue (`src/i18n/en.ts` and `zh-CN.ts` there). Strings only the app has go in `src/i18n/en.ts` and `zh-CN.ts` here. The Chinese catalogue is typed against the English one, so a missing translation is a compile error.

## Calling the worklet

```ts
import { call, account } from '@/wdk/bridge';

const balance = await account('bch-chipnet', 0).balance();                       // bigint
const tokens = await call<Record<string, string>>('bch-chipnet', 0, 'getTokenBalances');
```

Arguments and results are JSON. Pass amounts as strings; a `bigint` in a result arrives as a string. A method that returns `undefined` is reported as an error by WDK, so give every new module method a return value.
