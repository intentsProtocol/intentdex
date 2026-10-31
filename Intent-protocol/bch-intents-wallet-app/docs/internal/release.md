# Building and releasing

How to get an installable build, and how to stand up the two services the Swap tab needs.

## An Android APK, from the cloud

The app contains native code (the Bare runtime that runs the wallet worklet, the keychain, the camera), so it cannot run in Expo Go. It needs its own build. Expo's build service makes one without an Android toolchain on your machine.

```bash
npm install -g eas-cli
eas login                    # your Expo account
eas init                     # once: creates the project and writes its id into app.json
npm run build:apk            # = eas build --platform android --profile preview
```

The build takes roughly 15 to 25 minutes. When it finishes, EAS prints a link and a QR code: open it on the phone and install the APK. Android asks once to allow installs from the browser.

What happens on the build machine: `npm ci`, then the `postinstall` script bundles the wallet worklet (`.wdk-bundle/`), then Expo generates the Android project and Gradle builds it. A failure in the worklet step shows in the "Install dependencies" phase of the build log.

### Before the first build

1. **Service URLs.** Copy `.env.example` to `.env` and fill in what you have. For a cloud build the same variables must be on EAS too, because `.env` is not uploaded:

   ```bash
   eas env:create --environment preview --name EXPO_PUBLIC_CASHTOKEN_RELAYER --value https://… --visibility plaintext
   ```

   Repeat for each `EXPO_PUBLIC_` variable. They are compiled into the app and are public by nature; nothing secret belongs in them.

2. **WalletConnect.** Create a project at <https://dashboard.reown.com> and set `EXPO_PUBLIC_REOWN_PROJECT_ID`. Without it the app builds and runs, and the Connect screen explains that apps cannot connect.

3. **The package name.** `cash.bchintents.wallet` in `app.json`. Change it, or set `ANDROID_PACKAGE_NAME`, before publishing under your own name. It cannot be changed after an app is in a store.

### Profiles

| Profile | Makes | For |
|---|---|---|
| `development` | APK with the dev client | daily work: `npm start`, then open the app; it loads JavaScript from your machine |
| `preview` | release APK | testing on real phones |
| `production` | AAB | Google Play |

With the `development` build installed, most changes need no new build: only adding a native module or changing `wdk.config.js` does.

## A local build

With Android Studio and JDK 17 installed:

```bash
npm install
npm run android
```

## iOS

```bash
eas build --platform ios --profile preview
```

This needs an Apple Developer account, which EAS asks for. Nothing in the code is Android-only, but the iOS build has not been made yet.

## The services

The Swap tab talks to two services. Both deploy to Railway from their own folders; each has a `Dockerfile` and a `railway.toml`.

### cashtoken-relayer (BCH ↔ CashToken)

`../cashtoken-relayer`. Steps and variables are in its `docs/deploy-railway.md`. In short:

```bash
cd ../cashtoken-relayer
railway login
railway init
railway volume add --mount-path /data
railway variables --set NETWORK=chipnet --set RELAYER_PRIVATE_KEY_WIF=<key>
railway up
railway domain
```

The volume holds the relayer's open orders. Do not skip it. The relayer needs the chipnet solver key to start, so this deployment is yours to make: the key should go from your hands into Railway and nowhere else.

### cctp-swap-server (USDC bridge, Solana swaps)

`../arc-cctp/cctp-swap-server`. One instance serves one network mode, so a full setup is two Railway services from the same folder:

```bash
cd ../arc-cctp/cctp-swap-server
railway init
railway volume add --mount-path /app/data
railway variables --set CCTP_NETWORK=testnet --set DATA_DIR=/app/data
railway up
railway domain
```

Repeat as a second service with `CCTP_NETWORK=mainnet` for mainnet. The server's own `.env.example` lists the keys it needs (the relay wallet, RPC URLs, the Jupiter settings); set them with `railway variables`. The relay keys are optional in its configuration; its README says what each one enables.

### Giving the URLs to the wallets

| Service | Mobile app | Browser extension |
|---|---|---|
| cashtoken-relayer | `EXPO_PUBLIC_CASHTOKEN_RELAYER` | `VITE_CASHTOKEN_RELAYER_URL` |
| swap server, testnet | `EXPO_PUBLIC_SWAP_SERVER_TESTNET` | `VITE_CCTP_SWAP_SERVER_URL` |
| swap server, mainnet | `EXPO_PUBLIC_SWAP_SERVER_MAINNET` | `VITE_CCTP_SWAP_SERVER_MAINNET_URL` |

Both wallets read these at build time, so a new URL means a new build. **Settings → Services** in either wallet shows whether each one answers.

## Checklist for a release

- [ ] `npm run sync:check` passes: `vendor/` matches the sibling packages
- [ ] `npm run typecheck` and `npm test` pass
- [ ] `npx bare scripts/bare-smoke.cjs` passes: every wallet module loads and reads a testnet under Bare
- [ ] The build installs, and the checks in [testing.md](testing.md) under "On a device" have been walked through
- [ ] Version raised in `app.json`
