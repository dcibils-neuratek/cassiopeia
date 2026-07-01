# Cassiopeia roadmap

Cassiopeia is a **process & form studio for the era of AI agents**: analysts draw
a business process, attach forms to human tasks, and a lightweight BPM engine runs
it — humans fill forms, service tasks call connectors (AI agents, APIs, MCP
tools), gateways route on the results.

## Shipped

- **M0/M1** — scaffold + walking-skeleton engine (wait/resume, gateway, connectors, audit)
- **M2** — form-kit (`expr`-driven renderer, conditional visibility, validation) + portal
- **M3** — process designer (React Flow): palette, property panels, validation, versioned publish
- **M4** — form designer (dnd-kit): field palette, per-field properties, reorder, live preview
- **M5** — connectors (HTTP, provider-neutral AI Agent, Maverick, MCP) + admin/test + monitor
- **Platform** — Home / Stats / Templates / Build / Run / Monitor / Settings, live polling,
  throughput charts, banking templates, **✦ Describe** + **✦ Build with AI**

## In progress — autonomous M6→M10

Building toward a production-shaped agentic BPM platform. Each milestone is a
self-contained, verified increment; the app stays runnable throughout.

### M6 — Resilience & error handling ✅
Make runs survive flaky connectors and make failures actionable.
- Connector **retries** (config: `retries`, `retryDelayMs`) with backoff + **timeout** (`timeoutMs`).
- Service-task **error routing**: optional `onError` edge so a failed connector routes instead of killing the instance.
- Instances capture a **failure reason**; Monitor shows it and offers **Retry** (re-run from the failed node).
- New engine events: `service.failed`, `instance.failed`, `service.retried`.

### M7 — Timers, delays & SLAs ✅
Give the engine a sense of time.
- New **`timer` node** (wait N seconds, or until a context date) resumed by a **background scheduler**.
- **Due dates / SLA** on user tasks; overdue instances surfaced on Home / Monitor.

### M8 — Task inbox & assignment ✅
Turn human tasks into a real worklist.
- User tasks carry `assignee` / `candidateRole` / `priority`.
- A dedicated **Inbox** screen: filter, claim, open the form inline, complete — across all running instances.

### M9 — Governance: versioning, import/export, data dictionary ✅
Operate workflows over time.
- **Version history** per process (list published versions, restore).
- **Export / import** a workflow bundle (definition + forms + connectors) as JSON.
- **Audit CSV** export per instance. A per-process **data dictionary** (context keys produced/consumed).

### M10 — Analytics & AI process analyst
Close the loop from execution back to design.
- **Cycle-time & bottleneck** analytics: per-node durations from the event log.
- An **AI process analyst** that reads run data and suggests concrete improvements (uses the describer LLM).

## Conventions

- Commit + push to `origin/main` after every change; end commits with the
  `Co-Authored-By: Claude Opus 4.8` trailer.
- DB migrations are additive and idempotent (`CREATE TABLE IF NOT EXISTS`,
  add-column-if-missing) so existing `data/` upgrades cleanly.
- Keep the SQL vanilla (future Postgres/Drizzle move) and the engine pure.
