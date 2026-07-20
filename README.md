# Cassiopeia

A process & form designer for the era of AI agents. Draw a business process
(tasks, connectors, conditionals), attach forms to human tasks, and run it on a
lightweight, durable BPM-style engine that dispatches to AI agents, APIs, and
other connectors.

Status: **MVP complete (M0–M5)** — you can visually design a process *and* its
forms, configure connectors (including an AI agent), publish, run, and monitor
it end-to-end. Service tasks call connectors (REST or an OpenAI-compatible AI
agent), gateways route on the result, and the Monitor shows every instance's
context and audit trail.

## Stack

- **Monorepo**: pnpm workspaces
- **DB**: `node:sqlite` (built into Node ≥ 22 — no native build, no Postgres)
- **Backend**: Node + TypeScript (Fastify), engine runs in-process
- **Frontend**: React + TypeScript (Vite)
- **No commercial dependencies** — everything is permissively licensed

## Layout

```
packages/
  model/    shared types (ProcessDefinition, Node, Instance) — THE contract
  expr/     safe expression evaluator (gateways + later form logic), no eval
  engine/   pure process engine (no I/O; connectors + audit injected)
apps/
  api/      Fastify server, SQLite repo, connector runner, runtime wiring
  web/      React runner (throwaway; the real designer is M3)
```

## Run

```bash
pnpm install
pnpm start       # starts API (:3001) + web (:5173) together — open http://localhost:5173
```

Then open **http://localhost:5173**. Sign in with the seeded **admin / admin**
(change it in production). Ctrl-C stops both.

> **Security note:** connector secrets are encrypted at rest with a key from
> `CASSIOPEIA_SECRET_KEY` (auto-generated into `data/secret.key` in dev). Set that
> env var in production and keep it stable.

Other commands:

```bash
pnpm demo        # run the onboarding flow (both branches) in-process, print the trace
pnpm dev:api     # API only, on http://localhost:3001
pnpm dev:web     # web only, on http://localhost:5173 (proxies /api -> :3001)
```

## Testing & deployment

```bash
pnpm typecheck   # types across all packages + web
pnpm test        # engine / expr / form-kit unit tests (node:test)
```

CI runs typecheck + tests on every push/PR (`.github/workflows/ci.yml`).

Run it in a container:

```bash
docker compose up --build      # → http://localhost:5173  (admin / admin)
```

**Configuration (env):**

| Var | Purpose |
| --- | --- |
| `PORT` | API port (default 3001) |
| `CASSIOPEIA_SECRET_KEY` | Key for encrypting connector secrets at rest — **set in production**; a dev key is generated to `apps/api/data/secret.key` if unset |
| `API_TARGET` | Web dev-server proxy target for the API (default `http://localhost:3001`) |

**Postgres:** all SQL lives behind the thin repo in `apps/api/src/db.ts`; moving
from `node:sqlite` to Postgres (via Drizzle) is a matter of reimplementing that one
module — callers and the engine are untouched.

## Design decisions

- **Custom TS engine + React Flow** (not BPMN, not Temporal) — full control,
  AI-native node types.
- **Own form layer** (SurveyJS-inspired, not adopted — it's commercially
  licensed) built on MIT deps (dnd-kit, react-hook-form, zod, jsep).
- **Single-tenant / on-prem** target (bank compliance): self-hosted, no
  mandatory external egress.

### MVP simplifications (none are dead-ends)

| Concern | MVP | Later |
| --- | --- | --- |
| DB | SQLite via thin repo | Postgres via Drizzle (repo isolates SQL) |
| Engine host | in-process | extract to worker + queue |
| Connectors | synchronous | async with callbacks (interface already allows) |
| Tokens | single active node | parallel gateways |
| Auth | none | OIDC/SAML |

## Roadmap

Per-milestone changelogs (functional + technical detail) live in
[`changelog/`](changelog/README.md).

- **M0/M1** ✅ scaffold + walking-skeleton engine (wait/resume, gateway, connectors, audit)
- **M2** ✅ form-kit (`expr`-driven renderer, conditional visibility, validation) + portal
- **M3** ✅ process designer (React Flow): palette, node/edge property panels, validation, publish versioned definitions
- **M4** ✅ form designer (dnd-kit): field palette, per-field properties, drag reorder, live preview via the shared renderer, save
- **M5** ✅ connectors (HTTP + provider-neutral OpenAI-compatible AI Agent), connector admin + test, instance monitor → full demo
- **M6** ✅ resilience: connector retries (backoff) + timeouts, service-task **error routing** (`onError` edge), failed instances captured with a reason, one-click **Retry** in Monitor
- **M7** ✅ time: **timer nodes** (fixed delay or wait-until a context date) resumed by a background **scheduler**; user-task **SLA** due dates with overdue flags in Monitor
- **M8** ✅ **Inbox** worklist: user tasks carry assignee / candidate role / priority; a cross-instance inbox to filter, claim, and complete tasks inline (priority + due ordering)
- **M9** ✅ governance (Build → **Manage**): version history + restore, portable **export/import** bundles (secrets stripped), a **data dictionary** (produced vs consumed context keys with warnings), audit-trail **CSV** export in Monitor
- **M10** ✅ analytics (Stats): per-node **cycle time** + **bottleneck** from the event log, average completion time, gateway branch distribution, failures by node, and an **AI process analyst** that reads the metrics and suggests improvements

## Workflow templates

The **Templates** tab is a gallery of ready-made banking workflows. Each card
explains what it teaches and how it's built; "Use this template" installs its
process, forms, and connectors and drops you into **Build** to see the wiring:

- **New Client Onboarding** — form → AI-agent verification → risk gateway → auto-open or manual review
- **Mortgage Simulator** — request → compute payment/affordability → offer or adjust
- **Personal Credit Request** — application → credit score → instant approval or underwriting
- **Card Travel Notification** — trip details → register with the card network → confirm
- **Loan Pre-Approval** — application → automated credit check → score gateway → human underwriter (SLA/priority) or auto-approve → offer computation → sign-off (a full human-in-the-loop flow with a join)

Templates run out of the box on deterministic mock connectors (`mock-mortgage`,
`mock-credit-score`, `mock-travel-register`) — swap any for a real API or the AI
agent connector.

## UI: one connected Studio

The app is organized as a platform with a sectioned sidebar:

- **Overview** — **Home** (stat cards + your workflows with quick Build/Run, **auto-refreshing**) and **Stats** (runs by status, a **14-day throughput chart** of started vs completed, per-workflow breakdown, recent runs; **live**, backed by `GET /stats`).
- **Workflow** — **Templates → Build → Run → Monitor**. Monitor has a **per-workflow filter** and refreshes live (the open instance detail updates too).
- **Settings** — LLM API keys (the description model) and a **connector library** to configure/test AI-agent, Maverick, and HTTP connectors (and their keys) once, reused across workflows.

Build is
canvas-centric — the process is the center of gravity and everything attaches to it:

- Each node shows its status inline (📝 form attached / ⚙ connector).
- Select a **User Task** → attach and **design its form in a side drawer**, without leaving the flow (same renderer the portal uses).
- Select a **Service Task** → pick, configure, and **test its connector inline** (REST or AI agent).
- Select a **gateway edge** → set its condition.
- **▶ Run** in the Build toolbar publishes and opens a large **modal** that runs the process right there — no navigating away.
- **✦ Build with AI** opens a chat where you describe a workflow in plain language and the agent generates the tasks, gateways (with conditions), connectors, and forms directly on the canvas — and keeps refining it conversationally (it's sent the current design each turn). Uses the same configured LLM as Describe. Endpoint: `POST /definitions/:id/ai-build`; generation logic in `apps/api/src/ai-build.ts`.
- **✦ Describe** generates an LLM-written, plain-language functional description of the flow (reads the tasks, forms, connectors, and gateway conditions). Defaults to **Claude Haiku** via Anthropic's OpenAI-compatible endpoint; the model, base URL, and API key are editable in the panel and work with any OpenAI-compatible provider. Configuration is stored in the `describer` connector.
- An empty-state checklist guides first-time building.

The chrome follows a Neuratek-style design system (left sidebar, blue accent, soft
background, Inter, rounded white cards) defined by CSS variables in `apps/web/src/index.css`.

## MCP connector

`mcp` calls a tool on an MCP server (Streamable HTTP). It performs the JSON-RPC
handshake (`initialize` → `tools/call`), handles the session id and JSON/SSE
responses, and unwraps `structuredContent` (or JSON text content) into the
process context. Configure `url`, `toolName`, and optional `apiKey`. Add one
from the Service Task inspector or Settings with **+ MCP**. **Discover** lists the
server's tools (`POST /mcp/tools`, JSON-RPC `tools/list`) so you can pick the
tool name from a dropdown. A local `/mock-mcp` endpoint lets you exercise it
without a real server.

The **AI builder** can also propose and create the connectors a workflow needs
(AI agent / Maverick / MCP / HTTP) with safe empty configs — it wires them to the
service tasks and tells you which to add keys for in Settings.

## Maverick Agents connector

`maverick-agent` is a native REST connector for calling Maverick agents from a
service task. Configure `baseUrl`, `apiKey`, and `agentId`; it POSTs
`{ input }` to `{baseUrl}/agents/{agentId}/invoke` with a Bearer token and
merges the agent's `output`/`result` into the process context. Add one from the
Service Task inspector with **+ Maverick**. A local `/mock-maverick/...`
endpoint lets you exercise it without a real Maverick instance.

## AI Agent connector

The AI Agent connector (`ai-agent`) is **provider-neutral** — it calls any
OpenAI-compatible `/chat/completions` endpoint with a user-supplied
`baseUrl` + `apiKey` + `model`. Point it at Anthropic's OpenAI-compatible
endpoint (`https://api.anthropic.com/v1`, e.g. `claude-sonnet-5`) or any other
OpenAI-compatible provider. With `jsonOutput` on, the model's JSON response is
merged straight into the process context, so gateways can route on it. A local
mock LLM endpoint (`/mock-llm/chat/completions`) lets you exercise the whole
path without credentials.
