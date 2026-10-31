# Configuration

Everything configurable is a build-time `VITE_` variable read by `src/lib/config.ts` and `src/lib/chains.ts`. The names match the frontend's, so one `.env` can serve both projects. Put them in `.env.local` (ignored by git) or pass them on the command line.

Values are compiled into the bundle. They are public: never put a secret in one.

## Swap services

| Variable | Default | Used for |
|---|---|---|
| `VITE_CCTP_SWAP_SERVER_URL` | `http://localhost:3012` | USDC bridging on **testnet** |
| `VITE_CCTP_SWAP_SERVER_MAINNET_URL` | `http://localhost:3013` | USDC bridging and Solana swaps on **mainnet** |
| `VITE_CASHTOKEN_RELAYER_URL` | `http://localhost:3001` | Bitcoin Cash swaps on chipnet |
| `VITE_CASHTOKEN_RELAYER_MAINNET_URL` | the chipnet URL | Bitcoin Cash swaps on mainnet |

The swap server serves one network per instance (`CCTP_NETWORK`). The wallet checks the network the server reports in `/config` and ignores an instance that is on the wrong one, so pointing the mainnet variable at a testnet server shows no bridge routes rather than wrong ones.

The cashtoken relayer serves both networks from one instance; the wallet sends `network` with each request.

**A release build must set all four.** With the defaults, a user's wallet calls their own `localhost`, finds nothing, and reports the services as unreachable (BCH swaps show no quote; the bridge and Solana swaps are hidden). Nothing breaks, but nothing swaps.

Both services must allow cross-origin requests. The swap server does (`origin: true`). Extension pages also hold host permissions for every URL, so a server without CORS headers still works from the wallet, but not from a website.

## Price feed

| Variable | Default | Used for |
|---|---|---|
| `VITE_MESH_SERVER_URL` | empty | `GET /api/v1/prices` on the mesh server. When empty or unreachable, prices come from CoinGecko's public API. |

Prices are only shown on mainnet.

## RPC endpoints

Each has a public default that is fine for development and rate-limited under real use. Set a provider's URL for anything you ship.

| Variable | Network |
|---|---|
| `VITE_ETH_SEPOLIA_RPC`, `VITE_BASE_SEPOLIA_RPC`, `VITE_ARB_SEPOLIA_RPC`, `VITE_OP_SEPOLIA_RPC`, `VITE_ARC_TESTNET_RPC` | EVM testnets |
| `VITE_ETH_MAINNET_RPC`, `VITE_BASE_MAINNET_RPC`, `VITE_ARB_MAINNET_RPC`, `VITE_OP_MAINNET_RPC`, `VITE_ARC_MAINNET_RPC` | EVM mainnets |
| `VITE_SOLANA_DEVNET_RPC`, `VITE_SOLANA_MAINNET_RPC` | Solana |
| `VITE_BTC_TESTNET_API`, `VITE_BTC_MAINNET_API` | Bitcoin: an Esplora REST base URL (default `blockstream.info`) |

Bitcoin Cash uses `mainnet-js`'s built-in Electrum servers and has no variable.

Solana mainnet balances come from the swap server (`/solana/balances`) when it is reachable, which also names and prices each token; the RPC is the fallback.

## Example

```bash
# .env.local
VITE_CCTP_SWAP_SERVER_URL=https://swap-testnet.example.com
VITE_CCTP_SWAP_SERVER_MAINNET_URL=https://swap.example.com
VITE_CASHTOKEN_RELAYER_URL=https://relayer.example.com
VITE_CASHTOKEN_RELAYER_MAINNET_URL=https://relayer.example.com
VITE_SOLANA_MAINNET_RPC=https://your-provider.example/solana
```

```bash
npm run build
```

Check the result in the wallet under **Settings → Services**: it lists the URLs compiled in and whether each answers.

## Adding a network

Add a row to `NETWORKS` in `src/lib/chains.ts`. For an EVM network that is one call to `evm(...)` with its chain id, RPC, USDC address, explorer and logo. Use the swap server's chain key as the `key` if the server supports the chain, and the bridge appears for it with no further change. `tests/unit/routing.test.ts` checks that every row is complete.
