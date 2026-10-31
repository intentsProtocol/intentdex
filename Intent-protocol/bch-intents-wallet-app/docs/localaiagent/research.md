# Research

Checked on 26 October 2026 against the DoraHacks page, docs.qvac.tether.io, npm and this machine.

## 1. The hackathon

**AI Yako: Own Your AI**, hosted by Tether with Node NBO. 24 to 31 October 2026, Nairobi; remote entries are
eligible under the same rules. Solo or teams of up to three, one project per team.

| | |
|---|---|
| Submission deadline | Friday 30 October, 17:00 EAT (14:00 UTC), on DoraHacks |
| Demo day | Saturday 31 October, 09:00–17:00, offline demonstrations and judging |
| Mid-week check | Wednesday 28 October: progress and offline testing |
| Office hours | Daily 15:00 EAT with Victor (Discord) |

**Tracks and prizes (USDt):** overall winner 1,500; Cloud to Pocket 900; Offline AI apps 700; On-device agentic
finance 400. Total 3,500.

**On-device agentic finance:** combine QVAC local AI with WDK for a self-custodial finance workflow. Clearly separate
offline AI from transactions or services that need a network. Show the offline part safely, with test data and a test
environment. WDK is required for this track; QVAC must be used meaningfully in every entry; Pears is welcome.

**Hard rules from the judging section**

- The core QVAC AI feature must run with the internet switched off. An entry that uses a cloud AI API for that
  feature cannot win.
- Network-dependent finance actions must be declared separately and do not replace the offline demonstration.
- Judges look at user value, meaningful QVAC use, a working implementation, usability, and how clear and reproducible
  the offline demonstration is.

**What to submit**

- Problem, who needs it, chosen track.
- A public repository (GitHub, GitLab or Bitbucket) with setup steps, dependencies and a note on what was built during
  the event. Existing code and third-party work must be disclosed.
- A short demo video of the working product with the internet disconnected.
- QVAC details: SDK and package versions, model name, model download steps, the files where QVAC is used. For finance
  entries, the WDK integration too.
- Device and OS, memory needs, model licences, hardware limits. List every feature that still needs a network. No
  secrets, keys or private data.

## 2. QVAC

| | |
|---|---|
| SDK | `@qvac/sdk` **0.22.0** (npm, updated 19 October 2026), Apache-2.0. Runs on Node, Bare and Expo |
| CLI and server | `@qvac/cli` **0.16.0**: `qvac configure`, `qvac serve --openai` |
| Repository | github.com/tetherto/qvac; examples in tetherto/qvac-examples |
| Docs | docs.qvac.tether.io (JS/TS quick start, text generation, decisions, system requirements, HTTP server) |

### 2.1 How it runs

- The SDK starts **one Bare worker per application** and talks to it over `bare-rpc`. Several models can be loaded at
  once; `unloadModel()` frees each one.
- Models are referenced by registry constants (for example `QWEN3_1_7B_INST_Q4`) or by a local `.gguf` path. The first
  load downloads the model (HTTP or peers); later loads read the cache. Download before going offline.
- `assessModelFit()` estimates whether a model will fit before downloading it. `modelFitPolicy: 'refuse'` blocks a
  load projected not to fit.

### 2.2 Tool calling (what the agent depends on)

- Load with `modelConfig: { tools: true, ctx_size: 4096 }`.
- `completion({ modelId, history, tools, stream: true, generationParams: { temp, predict, tool_choice, parallel_tool_calls } })`.
- `tools` take a JSON Schema for `parameters` (Zod is accepted). Nested schemas are kept (0.22).
- `tool_choice`: `"auto"`, `"required"`, `"none"` or a tool name. On llama.cpp models it constrains sampling with
  the chat template's tool-call grammar, so a forced call comes back well formed.
- Results arrive as `toolCall` events; a malformed call is a `toolError` event. Past calls can be replayed in
  `history` with `toolCalls`, `toolCallId` and `toolName`. `history` takes `system`, `user`, `assistant` and `tool`.
- Tools can be grouped and loaded on demand (`deferLoading`, `group`, built-in `tool_search`). MCP servers can be
  passed with `mcp`.
- Cancellation per request: `cancel({ requestId })`.
- There is **no** JSON-schema response format or free grammar parameter. Structured output goes through tools.

### 2.3 The OpenAI-compatible server

```bash
npm install -g @qvac/cli
qvac configure            # pick models, writes qvac.config.json
qvac serve --openai       # http://127.0.0.1:11434/v1
```

- `/v1/chat/completions` (blocking and streaming), `/v1/embeddings`, `/v1/responses`.
- Tool calls work only if the model is configured with `config.tools: true`; otherwise `400 tools_not_enabled`.
- Every request names a model alias from `serve.models`; there is no fallback.
- CORS is off by default and needs explicit origins (no `*`). An extension page with a `host_permissions` entry for
  `http://127.0.0.1/*` is not subject to CORS, so the extension does not need it.
- A non-loopback host needs `--api-key`.

### 2.4 Decisions (small classifier models)

`decide()` with Laya models (`LAYA_TYPED_DECISIONS_421M_Q8_0` and others) answers `choice`, `score` and yes/no
questions with a probability per label. Useful as a fast router ("is this a swap, a strategy, a loan or a question?")
in front of the LLM. The docs warn that `action.actProbability` carries no usable signal.

### 2.5 Models for the agent

| Constant | Role | Note |
|---|---|---|
| `QWEN3_1_7B_INST_Q4` | Main agent model | Smallest model likely to pick tools reliably. About 1.1 GB on disk (to confirm with `assessModelFit`) |
| `QWEN3_600M_INST_Q4` | Fallback for weak hardware | Faster, weaker at choosing tools; keep the tool list short |
| `LLAMA_3_2_1B_INST_Q4_0` | The quick-start model | Alternative if Qwen3 misbehaves |
| `LAYA_TYPED_DECISIONS_421M_Q8_0` | Optional router | Classifies the request before the LLM runs |

Sizes, speed and tool accuracy on our hardware are not known yet; day 1 of the plan measures them.

### 2.6 Platform requirements (from the docs)

| Platform | Requirement |
|---|---|
| Android | 12+, arm64, Vulkan or OpenCL (Adreno 700+ for OpenCL), Expo, physical device only |
| Expo | Expo ≥ 54, `minSdkVersion` 29, `@qvac/sdk/expo-plugin` in `app.json`, `react-native-bare-kit` **≥ 0.16.0**, `expo-file-system`, `expo-device`, `expo-build-properties`; run prebuild again after every install |
| Windows | 10+, x64, **Vulkan 1.4 even for CPU-only inference** |
| Linux | Ubuntu 22+, x64 or arm64; Vulkan 1.4 for GPU, CPU fallback otherwise |
| Node | ^22.21.0 or ≥ 24.9.0 |
| Memory | At least 2 GB RAM, 4 GB recommended ("below 4 GB, most LLMs will fail to load"); 2 GB free when loading; 5 GB free disk |
| Emulators | Not supported |

## 3. Our hardware

### This PC

| | |
|---|---|
| CPU | Intel Core i5-3470, 4 cores, 2012 (AVX, no AVX2) |
| RAM | 7.9 GB total, **1.8 GB free** at the time of the check |
| GPU | Intel HD Graphics, driver 10.18.10.5161; **no `vulkan-1.dll`** |
| OS | Windows 10 Pro, build 18362.1256; **WSL 2 with Ubuntu 24.04** installed |
| Node | 24.11.1 (meets QVAC's ≥ 24.9) |
| Disk | 279 GB free |

**Consequence:** QVAC cannot run on Windows here (no Vulkan). It can run inside WSL Ubuntu on the CPU. Speed is the
open question: an old CPU without AVX2 may give only a few tokens a second on a 1.7B model. Day 1 measures it; if it
is too slow, use the 600M model, a shorter context, or a borrowed laptop for the demo.

### The test phone

Samsung Galaxy A20s (SM-A207F): Android 11, 2 or 3 GB RAM depending on the model, Mali GPU. **Below QVAC's Android 12 and 4 GB
requirements.** The phone app needs another device: Android 12+, arm64, 6 GB RAM or more to leave room for the WDK
worklet and the model. Antony has one (26 October); its model, RAM and speed go here after day 1.

## 4. Our code base

| Area | What exists | Where |
|---|---|---|
| Swap intents (BCH ↔ CashToken) | Dutch-auction intent through the relayer: create, fund, watch | `wallet-core/src/swap/cashtoken.ts` |
| USDC across chains | CCTP bridge flow | `wallet-core/src/swap/flows.ts` |
| Solana swaps | Jupiter, mainnet only | `wallet-core/src/swap/solana.ts` |
| Route choice | `resolveRoute(sell, buy)` | `wallet-core/src/swap/tokens.ts` |
| Mesh V4 positions | Read only: decode the NFT commitment offline, price grid (`gridPrice`, `priceRange`), live value and activity from the Mesh server | `wallet-core/src/mesh/v4.ts` |
| Mesh strategy templates | Eight archetypes (Recycling Pair, Multi-Rung Grid, Spread Market Maker, Stable Peg Anchor, Multi-Pair Indexer, Accumulate Ladder, Take-Profit Ladder, Fixed Price Limit) | `meshprotocol/src/lib/meshApi.ts` |
| Mesh position creation | Server side only: `POST /api/v1/v4/positions/preview` plans bins; the client must build and sign the genesis transaction, then `POST /positions` | `BCHMesh/meshserver/src/api/routes/v4.ts` |
| Borrow | Plan only, nothing built. Liquidium (BTC → USDC, **mainnet only**); ParyonUSD for BCH later | `borrow&lend/`, `bch-intents-wallet-extension/docs/internal/borrow-implementation-plan.md` |
| Extension WDK | Solana and BTC through WDK managers, EVM through ethers, BCH through mainnet-js | `bch-intents-wallet-extension/src/context/WDKProvider.tsx` |
| App WDK | All four families inside the WDK worklet, `react-native-bare-kit` 0.14.5 with a pinned Bare stack | `bch-intents-wallet-app/src/wdk/bridge.ts`, `package.json` |

### Putting QVAC into the phone app

- WDK's `@tetherto/wdk-react-native-core` 1.0.0-beta.22 accepts `react-native-bare-kit >= 0.14.5`, so 0.16 is
  allowed. Tether's WDK React Native starter still uses 0.14.5.
- The app pins its Bare packages to the starter's versions (commit `40b0e15`) after a worklet crash. Moving to 0.16
  means checking the WDK worklet again on a device.
- QVAC starts its own Bare worker, so the app would run two Bare runtimes plus a model.
- Every check is a cloud build: about 13 minutes per EAS build, then an install on the phone.

## Sources

- https://dorahacks.io/hackathon/ai-yako/detail
- https://qvac.tether.io/start
- https://docs.qvac.tether.io/sdk/js-ts-sdk/
- https://docs.qvac.tether.io/sdk/ai-capabilities/text-generation/
- https://docs.qvac.tether.io/sdk/ai-capabilities/decisions/
- https://docs.qvac.tether.io/sdk/system-requirements/
- https://docs.qvac.tether.io/sdk/how-it-works/
- https://docs.qvac.tether.io/sdk/models/assess-model-fit/
- https://docs.qvac.tether.io/sdk/tutorials/expo/
- https://docs.qvac.tether.io/cli/http-server/
- https://docs.qvac.tether.io/sdk/reference/release-notes/
- https://github.com/tetherto/qvac
- npm: `@qvac/sdk`, `@qvac/cli`, `react-native-bare-kit`, `@tetherto/wdk-react-native-core`
