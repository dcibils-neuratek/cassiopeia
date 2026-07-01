// Minimal HTTP surface for the MVP. The engine runs in-process; these handlers
// just call the runtime. CORS is open for local dev with the Vite web app.

import Fastify from "fastify";
import cors from "@fastify/cors";
import type { FormDefinition, ProcessDefinition } from "@cassiopeia/model";
import { validateDefinition } from "@cassiopeia/engine";
import {
  getDefinition,
  getEditableDefinition,
  eventDailyCounts,
  getForm,
  getInstance,
  getTask,
  initDb,
  listDefinitionVersions,
  claimTask,
  listConnectors,
  listDefinitions,
  listEvents,
  listForms,
  listInstances,
  listOpenTasks,
  maxPublishedVersion,
  openTaskForInstance,
  openTimerForInstance,
  saveConnector,
  saveDefinition,
  saveForm,
} from "./db.js";
import { seedSample } from "./sample.js";
import { listTemplates, installTemplate } from "./templates.js";
import { describeProcess } from "./describe.js";
import { generateWorkflow } from "./ai-build.js";
import { runConnector, listMcpTools } from "./connectors.js";
import { startInstance, submitTask, retryInstance, startScheduler } from "./runtime.js";
import { exportBundle, importBundle, dataDictionary, auditCsv, type WorkflowBundle } from "./governance.js";
import { computeAnalytics, analyzeProcess } from "./analytics.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

initDb();
seedSample();
startScheduler(); // resume timer nodes whose wake time has passed

app.get("/health", async () => ({ ok: true }));

// Aggregate metrics for the Home and Stats screens.
app.get("/stats", async () => {
  const instances = listInstances();
  const defs = listDefinitions();
  const blank = () => ({ running: 0, waiting: 0, completed: 0, failed: 0 } as Record<string, number>);
  const byStatus = blank();
  const per: Record<string, { total: number; byStatus: Record<string, number> }> = {};
  for (const i of instances) {
    byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    const p = (per[i.defId] ??= { total: 0, byStatus: blank() });
    p.total++;
    p.byStatus[i.status] = (p.byStatus[i.status] ?? 0) + 1;
  }
  // 14-day throughput from the event log (started vs completed per day).
  const counts = eventDailyCounts();
  const byDay: Record<string, { started: number; completed: number }> = {};
  for (const c of counts) {
    (byDay[c.day] ??= { started: 0, completed: 0 });
    if (c.type === "instance.started") byDay[c.day].started = c.n;
    else if (c.type === "instance.completed") byDay[c.day].completed = c.n;
  }
  const timeline: { date: string; started: number; completed: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    timeline.push({ date: key, started: byDay[key]?.started ?? 0, completed: byDay[key]?.completed ?? 0 });
  }

  return {
    processes: defs.length,
    instances: instances.length,
    byStatus,
    perProcess: defs.map((d) => ({ id: d.id, name: d.name, total: per[d.id]?.total ?? 0, byStatus: per[d.id]?.byStatus ?? blank() })),
    recent: instances.slice(-10).reverse().map((i) => ({ id: i.id, defId: i.defId, status: i.status, currentNodeId: i.currentNodeId })),
    timeline,
  };
});

// ---- M10 analytics ----
app.get("/analytics/:defId", async (req, reply) => {
  const { defId } = req.params as { defId: string };
  try {
    return computeAnalytics(defId);
  } catch (err) {
    return reply.code(404).send({ ok: false, error: (err as Error).message });
  }
});

// AI process analyst: interpret the run metrics and suggest improvements.
app.post("/definitions/:id/analyze", async (req, reply) => {
  const { id } = req.params as { id: string };
  const override = (req.body ?? {}) as { baseUrl?: string; apiKey?: string; model?: string };
  try {
    const { analytics, suggestions } = await analyzeProcess(id, override);
    return { ok: true, analytics, suggestions };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

app.get("/templates", async () => listTemplates());

app.post("/templates/:id/install", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    return { ok: true, defId: installTemplate(id) };
  } catch (err) {
    return reply.code(404).send({ ok: false, error: (err as Error).message });
  }
});

app.get("/definitions", async () => listDefinitions());

app.get("/definitions/:id", async (req) => {
  const { id } = req.params as { id: string };
  return getDefinition(id);
});

// LLM-generated functional description of a process. Optional {baseUrl, apiKey,
// model} in the body override the seeded `describer` connector for this call.
app.post("/definitions/:id/describe", async (req, reply) => {
  const { id } = req.params as { id: string };
  const override = (req.body ?? {}) as { baseUrl?: string; apiKey?: string; model?: string };
  try {
    return { ok: true, description: await describeProcess(id, override) };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// Prompt-to-workflow: build/edit a process from a natural-language instruction.
// Persists any generated forms + saves the result as the editable draft so the
// canvas can load it. Body: { instruction, current?, baseUrl?, apiKey?, model? }.
app.post("/definitions/:id/ai-build", async (req, reply) => {
  const { id } = req.params as { id: string };
  const b = (req.body ?? {}) as { instruction?: string; current?: ProcessDefinition; baseUrl?: string; apiKey?: string; model?: string };
  if (!b.instruction) return reply.code(400).send({ ok: false, error: "instruction is required" });
  try {
    const connectorIds = listConnectors().map((c) => c.id);
    const out = await generateWorkflow(b.instruction, b.current, connectorIds, { baseUrl: b.baseUrl, apiKey: b.apiKey, model: b.model });
    const def: ProcessDefinition = { ...out.definition, id };
    for (const f of out.forms) saveForm(f);
    for (const c of out.connectors) saveConnector({ id: c.id, type: c.type, config: c.config });
    saveDefinition({ ...def, version: 0, status: "draft" });
    return { ok: true, reply: out.reply, definition: def, connectors: out.connectors.map((c) => ({ id: c.id, type: c.type })), errors: out.errors };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// What the designer loads to edit (draft if present, else latest published).
app.get("/definitions/:id/edit", async (req, reply) => {
  const { id } = req.params as { id: string };
  const def = getEditableDefinition(id);
  if (!def) return reply.code(404).send({ error: "not found" });
  return def;
});

// Save the working draft (version 0).
app.post("/definitions/:id/draft", async (req) => {
  const { id } = req.params as { id: string };
  const body = req.body as ProcessDefinition;
  const draft: ProcessDefinition = { ...body, id, version: 0, status: "draft" };
  saveDefinition(draft);
  return { ok: true, errors: validateDefinition(draft) };
});

// Publish: refuse if invalid; otherwise store as the next published version.
app.post("/definitions/:id/publish", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as ProcessDefinition;
  const candidate: ProcessDefinition = { ...body, id, status: "published" };
  const errors = validateDefinition(candidate);
  if (errors.length > 0) return reply.code(400).send({ ok: false, errors });
  candidate.version = maxPublishedVersion(id) + 1;
  saveDefinition(candidate);
  // keep editing the draft in sync with what was published
  saveDefinition({ ...candidate, version: 0, status: "draft" });
  return { ok: true, version: candidate.version };
});

// ---- M9 governance: version history, import/export, data dictionary ----

app.get("/definitions/:id/versions", async (req) => {
  const { id } = req.params as { id: string };
  return listDefinitionVersions(id);
});

// Restore a published version back into the editable draft.
app.post("/definitions/:id/restore/:version", async (req, reply) => {
  const { id, version } = req.params as { id: string; version: string };
  try {
    const def = getDefinition(id, Number(version));
    saveDefinition({ ...def, id, version: 0, status: "draft" });
    return { ok: true };
  } catch (err) {
    return reply.code(404).send({ ok: false, error: (err as Error).message });
  }
});

// Export a portable bundle (definition + referenced forms + connectors, secrets stripped).
app.get("/definitions/:id/export", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    return { ...exportBundle(id), exportedAt: new Date().toISOString() };
  } catch (err) {
    return reply.code(404).send({ ok: false, error: (err as Error).message });
  }
});

// Import a bundle (as a new draft). Body: the bundle, optional { targetId }.
app.post("/definitions/import", async (req, reply) => {
  const body = (req.body ?? {}) as WorkflowBundle & { targetId?: string };
  try {
    const defId = importBundle(body, body.targetId);
    return { ok: true, defId };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// The context-key contract for a process: produced vs consumed, with warnings.
app.get("/definitions/:id/data-dictionary", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    return dataDictionary(id);
  } catch (err) {
    return reply.code(404).send({ ok: false, error: (err as Error).message });
  }
});

app.get("/forms", async () => listForms());
app.get("/connectors", async () => listConnectors());

// Discover the tools a given MCP server exposes (for the tool-name picker).
app.post("/mcp/tools", async (req, reply) => {
  const { url, apiKey } = (req.body ?? {}) as { url?: string; apiKey?: string };
  try {
    return { ok: true, tools: await listMcpTools(url ?? "", apiKey) };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

app.post("/connectors", async (req) => {
  const body = req.body as { id: string; type: string; config: Record<string, unknown> };
  saveConnector({ id: body.id, type: body.type, config: body.config ?? {} });
  return { ok: true };
});

// Test a connector with sample input (used by the admin "Test" button).
app.post("/connectors/:id/test", async (req, reply) => {
  const { id } = req.params as { id: string };
  const input = (req.body ?? {}) as Record<string, never>;
  try {
    const output = await runConnector(id, input);
    return { ok: true, output };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// A local stand-in for an MCP server (Streamable HTTP, JSON-RPC) so the mcp
// connector can be exercised without a real MCP server.
app.post("/mock-mcp", async (req, reply) => {
  const msg = (req.body ?? {}) as { id?: number; method?: string; params?: any };
  if (msg.method === "initialize") {
    reply.header("mcp-session-id", "mock-session-1");
    return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-mcp", version: "0.1" } } };
  }
  if (msg.method === "notifications/initialized") return reply.code(202).send();
  if (msg.method === "tools/list") {
    return { jsonrpc: "2.0", id: msg.id, result: { tools: [
      { name: "credit_lookup", description: "Look up a customer's credit profile" },
      { name: "kyc_check", description: "Run a KYC / AML screening" },
      { name: "sanctions_screen", description: "Screen a name against sanctions lists" },
    ] } };
  }
  if (msg.method === "tools/call") {
    const args = msg.params?.arguments ?? {};
    const out = { tool: msg.params?.name, ...args, mcpHandled: true };
    return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out } };
  }
  return { jsonrpc: "2.0", id: msg.id, result: {} };
});

// A local stand-in for a Maverick agent so the maverick-agent connector can be
// exercised without a real Maverick instance. Echoes the input under `output`.
app.post("/mock-maverick/agents/:agentId/invoke", async (req) => {
  const { agentId } = req.params as { agentId: string };
  const body = (req.body ?? {}) as { input?: Record<string, unknown> };
  return {
    output: {
      agent: agentId,
      handled: true,
      ...(body.input ?? {}),
      maverickNote: `handled by ${agentId}`,
    },
  };
});

// A local OpenAI-compatible endpoint so the AI Agent connector can be exercised
// end-to-end without real credentials. Echoes a deterministic JSON "decision".
app.post("/mock-llm/chat/completions", async (req) => {
  const body = req.body as { messages?: { role: string; content: string }[] };
  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";

  // Workflow-builder prompt → return a sample workflow JSON.
  if (system.includes("Cassiopeia workflow builder")) {
    const workflow = {
      reply: "Built a personal loan pre-approval: collect the applicant's details, run a check, then approve or route to manual review.",
      name: "Loan Pre-Approval",
      nodes: [
        { id: "start", type: "start" },
        { id: "collect", type: "userTask", name: "Loan Details", form: { title: "Loan Details", fields: [
          { kind: "text", label: "Full name", required: true },
          { kind: "number", label: "Annual income", required: true },
          { kind: "number", label: "Amount requested", required: true },
        ] } },
        { id: "check", type: "serviceTask", name: "Credit Risk Check", connector: "risk_api" },
        { id: "decide", type: "gateway", name: "Approved?" },
        { id: "sign", type: "userTask", name: "Sign Offer" },
        { id: "review", type: "userTask", name: "Manual Review" },
        { id: "end", type: "end" },
      ],
      edges: [
        { from: "start", to: "collect" },
        { from: "collect", to: "check" },
        { from: "check", to: "decide" },
        { from: "decide", to: "sign", when: "riskScore < 0.5" },
        { from: "decide", to: "review" },
        { from: "sign", to: "end" },
        { from: "review", to: "end" },
      ],
      connectors: [{ id: "risk_api", type: "ai-agent", purpose: "assess credit risk and return riskScore" }],
    };
    return { id: "chatcmpl-mock", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(workflow) }, finish_reason: "stop" }] };
  }

  const userMsg = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  let income = 0;
  try {
    const parsed = JSON.parse(userMsg?.content ?? "{}");
    if (typeof parsed.income === "number") income = parsed.income;
  } catch {
    /* ignore */
  }
  const decision = { riskScore: income >= 5000 ? 0.2 : 0.9, verified: true, reviewedBy: "mock-llm" };
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(decision) }, finish_reason: "stop" }],
  };
});

app.get("/forms/:id", async (req) => {
  const { id } = req.params as { id: string };
  return getForm(id);
});

// Save a form (MVP: overwrite at version 1; the portal resolves the latest).
app.post("/forms/:id", async (req) => {
  const { id } = req.params as { id: string };
  const body = req.body as FormDefinition;
  const form: FormDefinition = { ...body, id, version: 1 };
  saveForm(form);
  return { ok: true };
});

app.get("/instances", async () => listInstances());

app.get("/instances/:id", async (req) => {
  const { id } = req.params as { id: string };
  const instance = getInstance(id);
  return {
    instance,
    openTask: openTaskForInstance(id) ?? null,
    openTimer: openTimerForInstance(id) ?? null,
    events: listEvents(id),
  };
});

// Audit trail as CSV (for compliance / spreadsheets).
app.get("/instances/:id/audit.csv", async (req, reply) => {
  const { id } = req.params as { id: string };
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="audit-${id.slice(0, 8)}.csv"`);
  return auditCsv(id);
});

app.post("/definitions/:id/start", async (req) => {
  const { id } = req.params as { id: string };
  return startInstance(id);
});

// Re-run a failed instance from where it stopped (e.g. after a flaky dependency recovers).
app.post("/instances/:id/retry", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const result = await retryInstance(id);
    return { ok: true, result, instance: getInstance(id) };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// The worklist: every open user task across all instances, enriched with the
// process/node/form names and its instance context so the Inbox can render it.
app.get("/tasks", async () => {
  const rank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  return listOpenTasks()
    .map((t) => {
      const inst = getInstance(t.instanceId);
      let processName = inst.defId;
      let nodeName = t.nodeId;
      try {
        const def = getDefinition(inst.defId, inst.defVersion);
        processName = def.name;
        const node = def.nodes.find((n) => n.id === t.nodeId);
        if (node && "name" in node && node.name) nodeName = node.name;
      } catch { /* definition gone */ }
      let formTitle: string | null = null;
      if (t.formId) { try { formTitle = getForm(t.formId).title; } catch { /* form gone */ } }
      return { ...t, defId: inst.defId, processName, nodeName, formTitle, context: inst.context };
    })
    .sort((a, b) => {
      const pr = (rank[a.priority ?? "normal"] ?? 1) - (rank[b.priority ?? "normal"] ?? 1);
      if (pr !== 0) return pr;
      return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"); // sooner due first
    });
});

// Claim an open task for a user (assign it to them).
app.post("/tasks/:taskId/claim", async (req, reply) => {
  const { taskId } = req.params as { taskId: string };
  const { assignee } = (req.body ?? {}) as { assignee?: string };
  if (!assignee) return reply.code(400).send({ ok: false, error: "assignee is required" });
  try {
    claimTask(taskId, assignee);
    return { ok: true };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

app.post("/tasks/:taskId/submit", async (req) => {
  const { taskId } = req.params as { taskId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const result = await submitTask(taskId, body as Record<string, never>);
  const task = getTask(taskId);
  return { result, instance: getInstance(task.instanceId) };
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`Cassiopeia API on http://localhost:${port}`);
});
