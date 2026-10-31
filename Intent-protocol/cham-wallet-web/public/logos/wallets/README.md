# Wallet icons

One per wallet the app can connect. `main.svg` and `bch-intents.svg` are the Cham mark; the others are placeholders. Replace a file with the real logo and keep its name:

| File | Shown for |
|---|---|
| `main.svg` | Cham Wallet, built in |
| `cashonize.svg` | Cashonize |
| `paytaca.svg` | Paytaca |
| `walletconnect.svg` | Any other WalletConnect wallet |
| `bch-intents.svg` | The Cham Wallet browser extension (the file keeps its old name) |

Square artwork, SVG preferred. To use a PNG, change the extension in `src/components/wallet/WalletIcon.tsx`.
If a file is missing the app falls back to a generic wallet glyph.
