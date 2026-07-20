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

## M6→M10 — shipped (autonomous)

Built toward a production-shaped agentic BPM platform. Each milestone is a
self-contained, verified increment; the app stays runnable throughout. All five
are complete and pushed to `origin/main`.

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

### M10 — Analytics & AI process analyst ✅
Close the loop from execution back to design.
- **Cycle-time & bottleneck** analytics: per-node durations from the event log.
- An **AI process analyst** that reads run data and suggests concrete improvements (uses the describer LLM).

## M11→M18 — planned (next phase: from "complete demo" to "productizable")

Gap analysis after M10: the platform is functionally end-to-end, but lacks what
separates a rich demo from something a bank runs in production — identity, deeper
agent-native capabilities, BPMN-grade orchestration, external triggers, and
delivery hardening. Sequenced so each unblocks the next.

Chosen starting track: **M11 (identity & security)** — prerequisite for any real
pilot.

### M11 — Identity, roles & secrets ✅
Give the platform real users and stop trusting the client.
- **Auth**: local users (scrypt password hashing, `node:crypto`), login → session
  token; middleware authenticates every non-public request. OIDC-ready shape.
- **RBAC**: roles `admin` / `analyst` / `operator` / `viewer`; enforced per
  endpoint (publish/build = analyst+, connectors/settings = admin, inbox = operator+).
- **Real task assignment**: Inbox uses the logged-in user; claim gated by
  `candidateRole`; audit captures the acting user on publish/start/claim/submit/etc.
- **Secrets at rest**: encrypt connector secret fields (apiKey/token/…) with
  AES-256-GCM (key from `CASSIOPEIA_SECRET_KEY`, else generated to `data/secret.key`).
  Never return decrypted secrets to the client (masked); decrypt only server-side.
- **Web**: login screen + auth context, token on every `api()` call, current-user
  chip + logout, role-gated UI. Seed an initial admin.

### M12 — Agentic depth: tool-calling agents + human-in-the-loop AI review ✅
The differentiator. Agents that use tools mid-reasoning; humans supervise.
- `ai-agent` upgraded to a **tool-calling loop** (call connectors/MCP tools while
  reasoning); **structured-output schema** validation + guardrails.
- **Confidence-threshold routing** (low confidence → human); an **AI-review task**
  where a human approves/edits an agent's decision before the flow continues.
- **Token/cost tracking** per step, surfaced in Monitor/Stats.

### M13 — Triggers & async ✅
Start processes from the outside; support long-running agents.
- Inbound **webhooks / API** to start instances; **scheduled (cron)** starts.
- **Async connectors** with callback (agent replies later → resume via a token).

### M14 — Engine expressiveness ✅ (parallel multi-token gateways still future)
BPMN-grade orchestration.
- **Parallel gateways** (fork/join, multiple active tokens); **subprocess /
  call-activity**; **multi-instance** (loop over a collection); **SLA escalation**
  actions on breach (reassign / notify / branch).

### M15 — Notifications & collaboration ✅
- Email + in-app **notifications** (task assigned, SLA breach, run failed);
  **comments** on tasks/instances; Inbox **reassign / delegate / bulk**.

### M16 — Forms & documents ✅
- **File upload** with a storage backend; **multi-page** forms; **repeating
  groups/panels**; **computed/derived** fields; pass documents to agents.

### M17 — Quality & delivery
- Test suites (**engine / expr / API**) + **CI**; **Dockerfile / compose**; env
  config; **Postgres via Drizzle** (repo layer already isolates SQL); dev/test/prod
  environments + promotion.

### M18 — UX & i18n polish
- Canvas **undo/redo**, **auto-layout**, search; **dark mode**; keyboard shortcuts;
  better empty states; **i18n (Spanish / English)**.

## Conventions

- Commit + push to `origin/main` after every change; end commits with the
  `Co-Authored-By: Claude Opus 4.8` trailer.
- DB migrations are additive and idempotent (`CREATE TABLE IF NOT EXISTS`,
  add-column-if-missing) so existing `data/` upgrades cleanly.
- Keep the SQL vanilla (future Postgres/Drizzle move) and the engine pure.
