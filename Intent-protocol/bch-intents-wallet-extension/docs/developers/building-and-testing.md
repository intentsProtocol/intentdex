# Building and testing

## Requirements

- Node.js 20 or newer
- Chrome 116 or newer (or another Chromium browser) to run it

## Build

```bash
npm install
npm run build        # production build into dist/
npm run dev          # rebuild on every change (vite build --watch)
```

`dist/` is the extension. The build fails if either script that runs inside web pages (`content/content.js`, `inpage/inpage.js`) contains an `import`, because that would silently break the provider on every site.

Service URLs and RPC endpoints are build-time variables: see [`configuration.md`](configuration.md).

## Load it

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → choose `dist/`.
3. After a rebuild, click the reload arrow on the extension's card, and reload any page that should see the provider.

Useful places to look:

| What | Where |
|---|---|
| Wallet UI console | Right-click inside the wallet → Inspect |
| Service worker console | `chrome://extensions` → the extension's card → *service worker* |
| Storage | In either console: `await chrome.storage.local.get(null)` and `await chrome.storage.session.get(null)` |
| The UI in a normal tab | `chrome-extension://<id>/src/popup/index.html?surface=panel` |

## Checks

```bash
npm run typecheck    # tsc --noEmit
npm test             # unit tests (vitest)
npm run test:e2e     # end-to-end tests (Playwright); needs a build first
npm run check        # all of the above, in order
```

### Unit tests

`tests/unit/`, run in Node with an in-memory `chrome.storage` (`tests/unit/setup.ts`). They cover amount parsing and formatting, settings, the translation catalogues, swap routing, address validation, the activity log, the dapp permission store, the signing journal, both service clients and the Bitcoin client.

They run in a single process on purpose: parallel workers time out on a loaded machine.

### End-to-end tests

`tests/e2e/`, run against the built extension loaded into Chromium.

```bash
npx playwright install chromium   # once
npm run build
npm run test:e2e
HEADED=1 npm run test:e2e         # watch it run
```

| File | Covers |
|---|---|
| `wallet.spec.ts` | Create and import, backup check, lock and unlock, removing the wallet, settings, accounts, network switch, receive, surfaces |
| `dapp.spec.ts` | The whole provider pipeline with a real page: connect, reject, sign, send approval checks, queueing, locked wallet, disconnect |
| `swap.spec.ts` | The swap card against mocked services: routing, request shapes, quotes, errors, outages |

The dapp tests serve `test-extension.html` on port 4173 (started automatically).

What these tests do not do is move funds: see [`../internal/testing.md`](../internal/testing.md) for the list and for how to run the funded checks by hand.

## Trying the provider by hand

```bash
node tests/e2e/static-server.mjs      # http://localhost:4173
```

Open that page with the extension loaded. It has a button for every method and logs every event.

## Project conventions

- **Storage:** `extLocal` / `extSession` from `src/lib/ext-storage.ts`, or `chrome.storage` directly in code the service worker shares. Never `localStorage` or `sessionStorage`.
- **Keys:** only in the wallet UI context. `mainnet-js`, WDK and React are never imported by the service worker, the content script or the inpage provider.
- **Styling:** inline styles using the `MX` tokens from `src/design-system/primitives.tsx`. No literal colours in screens; add a token to `theme.css` with a value for each theme.
- **Text:** every user-visible string is a key in `src/lib/i18n/en.ts`, used through `t()`. A key missing from another language is a compile error; an unused key fails a unit test.
- **Amounts:** `bigint` base units everywhere; `src/lib/format.ts` is the only place they become text.
- **Commits:** `feat(ext):`, `fix(ext):`, `chore(ext):`, `refactor(ext):`, `docs(ext):`, `test(ext):`.
