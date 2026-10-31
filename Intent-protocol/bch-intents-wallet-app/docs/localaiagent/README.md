# Local AI agent — plan

A wallet agent that runs on the user's phone through **QVAC** (Tether's local AI stack) and acts through the app's
**WDK** worklet: it turns plain requests into swap intents, Mesh strategies and loan plans, and the user approves
each action before anything is signed.

Built for **AI Yako: Own Your AI** (QVAC hackathon, DoraHacks, Node NBO Nairobi), track **On-device agentic finance**.
Submission deadline: **Friday 30 October 2026, 17:00 EAT**.

Status (26 October 2026): research and plan. No code written.

| Document | What it covers |
|---|---|
| [research.md](research.md) | Hackathon rules, QVAC facts (versions, APIs, requirements), what this PC and the phones can run |
| [design.md](design.md) | How the agent works: runtimes, tool catalogue, Mesh position creation, safety rules, offline and online split |
| [plan.md](plan.md) | Day-by-day work to the deadline, the day-1 gate, cut line, demo script, submission checklist |

## The plan in short

1. **The model runs on the phone**: Qwen3 1.7B (Q4) through `@qvac/sdk` 0.22, with tool calling. It never sees a
   key and never signs. It picks a tool and fills in arguments; ordinary code checks them, does the maths and builds
   a draft; the user approves with the PIN; the WDK worklet signs.
2. **Logic goes in the shared package** (`bch-intents-wallet-core/src/agent/`), so the extension can reuse it later
   over `qvac serve`.
3. **The demo executes** swaps (CashToken intents on chipnet) and Mesh position creation (plan from the Mesh server,
   checked on the phone, signed in the worklet). Loans are planned and shown as drafts.
4. **Offline:** the model, request parsing, strategy design, Mesh grid maths, loan maths and explanations, from a
   saved portfolio snapshot. **Needs a network:** quotes, fresh prices, broadcasting, the relayer, the Mesh server,
   Liquidium. The demo shows both halves separately, as the rules require.
5. **Biggest risk:** QVAC needs `react-native-bare-kit` 0.16; the app's WDK worklet is pinned to 0.14.5. Day 1
   proves both work in one build on the phone before anything else is built. The fallback is the extension with
   QVAC in WSL.
