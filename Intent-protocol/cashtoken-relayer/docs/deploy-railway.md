# Deploying the relayer on Railway

The repository has a `Dockerfile` and a `railway.toml`. Railway builds the image, starts it, and waits for `GET /health` before routing traffic to it.

## What you need

- The Railway CLI, logged in: `railway login`.
- The WIF private key of the chipnet solver wallet. The relayer does not start without it: with no key it looks for a wallet file that the container does not have. A mainnet key is optional.

## Steps

Run these from this folder.

```bash
railway init                       # create a project, or `railway link` to use an existing one
railway add --service cashtoken-relayer
railway volume add --mount-path /data
railway variables --set NETWORK=chipnet --set RELAYER_PRIVATE_KEY_WIF=<chipnet key>
railway up                         # build and deploy (uploads this folder, minus what .railwayignore lists)
railway domain                     # give the service a public https address
```

`railway domain` prints the address. Check it:

```bash
curl https://<your-domain>/health
```

## The volume is not optional

The relayer keeps its open orders in `intents.json` and its profit record in `profit-ledger.json`, in the directory it runs from. In the container that directory is `/data`. With a volume mounted there, a redeploy picks up where the last one stopped. Without one, every restart forgets the orders the relayer was watching, including funded orders it has yet to fill or refund.

A maker's funds are never at risk from this: each order is a covenant that pays the maker or returns the deposit after the auction ends, and anyone can trigger the refund. What is lost without the volume is the relayer's own knowledge of those orders.

## Variables

| Variable | Needed | Meaning |
|---|---|---|
| `NETWORK` | Yes | `chipnet` or `mainnet`: the network the solver wallet below fills on. |
| `RELAYER_PRIVATE_KEY_WIF` | Yes | The chipnet solver wallet's key. Set it as a variable on the service; never commit it. |
| `MAINNET_PRIVATE_KEY_WIF` | No | A second wallet, to also fill on mainnet from a chipnet instance. Unset: mainnet is quote-only. |
| `PORT` | No | Railway sets this itself. |

The rest (profit thresholds, token whitelist, concurrency) are described in `.env.example` and `docs/profit.md`, and have working defaults.

## Pointing the wallets at it

Once the service has a domain, give it to the wallets at build time:

- Browser extension: `VITE_CASHTOKEN_RELAYER_URL=https://<your-domain>`
- Mobile app: `EXPO_PUBLIC_CASHTOKEN_RELAYER=https://<your-domain>`

One instance serves both networks for quotes and order tracking; the request says which network it is for.
