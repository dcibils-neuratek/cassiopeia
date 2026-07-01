# Cassiopeia — project guide for Claude Code

Cassiopeia is a **process & form studio for the era of AI agents** — a Neuratek
product. Analysts draw a business process (tasks, connectors, gateways), attach
forms to human tasks, and a lightweight BPM-style engine runs it: humans fill
forms, service tasks call connectors (AI agents, APIs, MCP tools), gateways
route on the results.

## Run it

```bash
pnpm install
pnpm start        # API (:3001) + web (:5173) together — open http://localhost:5173
```

Other: `pnpm demo` (engine trace in-process), `pnpm dev:api`, `pnpm dev:web`.

## Architecture (pnpm monorepo)

```
packages/
  model/    shared TS types (ProcessDefinition, Node, Edge, FormDefinition) — THE contract
  expr/     safe expression evaluator (no eval); powers gateways + form visibleIf
  engine/   pure process engine (no I/O): advance/wait/resume, gateways, validateDefinition
  form-kit/ schema-driven React form renderer (used by portal AND designer preview)
apps/
  api/      Fastify + node:sqlite (no external DB); engine runs in-process
  web/      React + Vite; React Flow canvas, dnd-kit form designer
```

- **DB:** `node:sqlite` (built into Node ≥ 22). Data in `apps/api/data/` (gitignored).
  SQL is kept vanilla so it can move to Postgres via Drizzle later.
- **Engine is pure** (`packages/engine`): connectors + audit are injected; single
  active node per instance (no parallel yet); sync connectors (async/callbacks deferred).
- **Contract-first:** `@cassiopeia/model` types are shared by web + api so the
  canvas and engine can't disagree about what a node means.

## Web app (apps/web/src)

Sidebar modes: **Home** (dashboard, live) · **Stats** (live throughput chart) ·
**Templates** (installable banking workflows) · **Build** (the Studio) · **Run**
(portal) · **Monitor** (live, per-workflow filter) · **Settings** (LLM keys +
connector library).

**Build (`Designer.tsx`) is canvas-centric:** select a User Task → design its
form in a side drawer; select a Service Task → pick/configure/test its connector
inline; gateway edges carry conditions. Toolbar: **Save draft / Publish / ▶ Run**
(modal, auto-starts) / **✦ Describe** (LLM description) / **✦ Build with AI**
(prompt-to-workflow chat that generates tasks, gateways, connectors, and forms).

## Connectors (apps/api/src/connectors.ts)

`ai-agent` (OpenAI-compatible chat/completions, provider-neutral), `maverick-agent`
(Neuratek Maverick REST), `mcp` (MCP tools over Streamable HTTP: initialize →
tools/call; discovery via tools/list), `http`, plus deterministic mocks
(`mock-verify`, `mock-mortgage`, `mock-credit-score`, `mock-travel-register`).
Local mock endpoints exist for verification: `/mock-llm`, `/mock-maverick`, `/mock-mcp`.

The platform LLM (Describe + AI builder) is the `describer` connector — model /
base URL / API key set in **Settings** (Claude Haiku by default; any
OpenAI-compatible provider). The user supplies the key.

## Conventions

- **Commit and push after every change** to `origin/main`
  (`https://github.com/dcibils-neuratek/cassiopeia.git`). Simple linear history on
  `main`. End commit messages with the `Co-Authored-By: Claude Opus 4.8` trailer.
- Never commit `node_modules/`, `apps/api/data/`, or `*.sqlite` (gitignored).
- Verify UI changes in the browser (preview tools) before committing.

## Continuing this Claude Code conversation on another machine

Claude Code sessions are local-only. To resume the exact conversation elsewhere:

```bash
git clone https://github.com/dcibils-neuratek/cassiopeia.git
cd cassiopeia
node scripts/restore-session.mjs   # copies .session/ transcript + memory into ~/.claude
claude --resume                    # pick this session
```

For a plain fresh start with full context, just run `claude` in the repo — this
file is loaded automatically. See `.session/README.md`.
