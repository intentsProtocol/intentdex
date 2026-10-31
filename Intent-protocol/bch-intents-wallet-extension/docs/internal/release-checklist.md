# Release checklist

For cutting an alpha build that someone outside the team will install.

## Before building

- [ ] `manifest.json` and `package.json` carry the same new version.
- [ ] `.env.local` (or CI variables) sets all four service URLs to deployed instances, and RPC URLs to a provider's endpoints. See [`../developers/configuration.md`](../developers/configuration.md). A build with the defaults calls the user's own `localhost`.
- [ ] The swap server instance behind `VITE_CCTP_SWAP_SERVER_MAINNET_URL` runs with `CCTP_NETWORK=mainnet`, and its relayer has gas on every destination chain.
- [ ] The cashtoken relayer answers `/health` and `/router/quote` for both `chipnet` and `mainnet`.

## Build and automated checks

```bash
npm ci
npm run check     # typecheck, unit tests, build, end-to-end tests
```

- [ ] All four steps pass.
- [ ] `dist/content/content.js` and `dist/inpage/inpage.js` exist (the build fails otherwise if they contain an import).

## By hand, in a clean browser profile

Load `dist/` unpacked.

**Install and onboarding**
- [ ] Installing opens the onboarding tab.
- [ ] Create a wallet through to "Open wallet"; the side panel opens.
- [ ] Remove it; import a known phrase; the addresses match another wallet's.

**Surfaces**
- [ ] The toolbar icon opens the side panel.
- [ ] Settings → Open wallet as → Popup: the icon opens the popup. Switch back.
- [ ] Light, dark and auto each look right on Home, Swap, Settings and an approval.

**Services** (Settings → Services)
- [ ] Both services show *Reachable* on testnet and on mainnet.

**Funded checks, testnet** (see [`testing.md`](testing.md) for the full list)
- [ ] Send and receive on each family: BCH, a CashToken, ETH and USDC on one EVM network, SOL, BTC.
- [ ] One BCH → CashToken swap fills.
- [ ] One USDC bridge delivers. Close the wallet after the burn on a second one and finish it from Activity.
- [ ] A dapp send from `test-extension.html` broadcasts.

**Funded checks, mainnet**, with small amounts
- [ ] One send on each family.
- [ ] One Solana swap.
- [ ] One USDC bridge.

## Package

- [ ] Zip the **contents** of `dist/` (the manifest at the zip's root).
- [ ] Tag the commit `ext-v<version>`.
- [ ] Release notes: what changed, known limitations (link [`known-limitations.md`](known-limitations.md)), and the alpha warning.

## Chrome Web Store, when the time comes

Not done for the alpha. It will need: a privacy policy, a justification for each permission (`<all_urls>` especially: see [`security-model.md`](security-model.md#permissions)), real 16/48/128 px icons (the three sizes currently share one image), screenshots, and an audit.
