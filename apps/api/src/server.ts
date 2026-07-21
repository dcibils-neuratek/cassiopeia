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
  getFile,
  getForm,
  getInstance,
  getTask,
  initDb,
  listDefinitionVersions,
  addAudit,
  addComment,
  addNotification,
  claimTask,
  createSchedule,
  createTrigger,
  deleteDefinition,
  deleteSchedule,
  deleteTrigger,
  ensurePublicTrigger,
  getTrigger,
  getUserByUsername,
  listAudit,
  listComments,
  listConnectors,
  listNotifications,
  markAllNotificationsRead,
  unreadCount,
  listSchedules,
  listTriggers,
  listDefinitions,
  listEvents,
  listForms,
  listInstances,
  listOpenTasks,
  listUsers,
  type UserRow,
  maxPublishedVersion,
  openTaskForInstance,
  openTimerForInstance,
  saveConnector,
  saveDefinition,
  saveFile,
  saveForm,
} from "./db.js";
import { randomUUID } from "node:crypto";
import { seedSample } from "./sample.js";
import { listTemplates, installTemplate } from "./templates.js";
import { describeProcess } from "./describe.js";
import { generateWorkflow } from "./ai-build.js";
import { runConnector, listMcpTools } from "./connectors.js";
import { startInstance, submitTask, retryInstance, startScheduler, resumeViaCallback } from "./runtime.js";
import { exportBundle, importBundle, dataDictionary, auditCsv, type WorkflowBundle } from "./governance.js";
import { computeAnalytics, analyzeProcess } from "./analytics.js";
import { buildCase, listCaseSummaries } from "./case.js";
import { login, logout, userForToken, registerUser, seedAuth, can, ALL_ROLES, type Capability } from "./auth.js";
import { bancoPage } from "./banco.js";
import { startApplication, statusOf, acceptOffer, defIdForToken } from "./public-apply.js";

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 }); // allow base64 file uploads
await app.register(cors, { origin: true });

initDb();
seedSample();
seedAuth(); // default admin/admin on first run

// Seed the "Banco del Futuro" demo: the loan flow, a public form token, and a
// bank loan officer who approves borderline cases in the Inbox.
try {
  let hasLoan = false;
  try { getDefinition("loan-preapproval"); hasLoan = true; } catch { hasLoan = false; }
  if (!hasLoan) installTemplate("loan-preapproval");
  ensurePublicTrigger("banco-del-futuro-loan", "loan-preapproval", "Banco del Futuro — public loan form");
  if (!getUserByUsername("officer")) {
    registerUser("officer", "officer", "Banco del Futuro — Mesa de Crédito", "operator");
    console.warn("[demo] Seeded bank officer (officer/officer) for the Inbox.");
  }
} catch (err) { app.log.warn(`demo seed skipped: ${(err as Error).message}`); }

startScheduler(); // resume timer nodes whose wake time has passed

// ---- M11 auth: authenticate every non-public request ----
function isPublic(method: string, url: string): boolean {
  if (url === "/health") return true;
  if (method === "POST" && url === "/auth/login") return true;
  if (url.startsWith("/mock-")) return true; // called server-to-server by connectors
  if (url.startsWith("/hooks/")) return true; // inbound triggers (token in the path)
  if (url.startsWith("/callbacks/")) return true; // async connector callbacks (token in the path)
  if (url === "/banco") return true; // public customer-facing bank page
  if (url.startsWith("/apply/")) return true; // public application API (token-scoped)
  return false;
}

app.addHook("onRequest", async (req, reply) => {
  const url = (req.raw.url ?? "").split("?")[0];
  if (isPublic(req.method, url)) return;
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const user = userForToken(token);
  if (!user) return reply.code(401).send({ ok: false, error: "Authentication required" });
  (req as unknown as { cassUser: UserRow }).cassUser = user;
});

/** The authenticated user for a request (present on all non-public routes). */
function actor(req: unknown): UserRow {
  return (req as { cassUser: UserRow }).cassUser;
}

/** Enforce a capability; returns the user or null after sending 403. */
function requireCap(req: unknown, reply: import("fastify").FastifyReply, cap: Capability): UserRow | null {
  const user = actor(req);
  if (!can(user.role, cap)) { reply.code(403).send({ ok: false, error: `Requires '${cap}' permission (your role: ${user.role})` }); return null; }
  return user;
}

// ---- auth endpoints ----
app.post("/auth/login", async (req, reply) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  const result = login(username ?? "", password ?? "");
  if (!result) return reply.code(401).send({ ok: false, error: "Invalid username or password" });
  addAudit(result.user.username, "login");
  return { ok: true, ...result };
});

app.post("/auth/logout", async (req) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (token) logout(token);
  return { ok: true };
});

app.get("/auth/me", async (req) => {
  const u = actor(req);
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
});

app.get("/auth/users", async (req, reply) => {
  if (!requireCap(req, reply, "admin")) return;
  return listUsers();
});

app.post("/auth/users", async (req, reply) => {
  const admin = requireCap(req, reply, "admin");
  if (!admin) return;
  const b = (req.body ?? {}) as { username?: string; password?: string; displayName?: string; role?: string };
  if (!ALL_ROLES.includes(b.role as never)) return reply.code(400).send({ ok: false, error: "Invalid role" });
  try {
    const u = registerUser(b.username ?? "", b.password ?? "", b.displayName ?? "", b.role as never);
    addAudit(admin.username, "user.create", u.username);
    return { ok: true, user: u };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

app.get("/audit", async (req, reply) => {
  if (!requireCap(req, reply, "admin")) return;
  return listAudit();
});

// ---- M15 notifications & comments ----
app.get("/notifications", async (req) => {
  const u = actor(req).username;
  return { unread: unreadCount(u), items: listNotifications(u) };
});
app.post("/notifications/read", async (req) => {
  markAllNotificationsRead(actor(req).username);
  return { ok: true };
});
app.get("/instances/:id/comments", async (req) => {
  const { id } = req.params as { id: string };
  return listComments(id);
});
app.post("/instances/:id/comments", async (req, reply) => {
  const { id } = req.params as { id: string };
  const { text } = (req.body ?? {}) as { text?: string };
  if (!text?.trim()) return reply.code(400).send({ ok: false, error: "text is required" });
  return { ok: true, comment: addComment(id, actor(req).username, text.trim()) };
});

app.get("/health", async () => ({ ok: true }));

// ---- Banco del Futuro: public customer-facing loan site ----
app.get("/banco", async (_req, reply) => {
  reply.type("text/html");
  return bancoPage("banco-del-futuro-loan");
});
app.post("/apply/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  try { return await startApplication(token, (req.body ?? {}) as Record<string, never>); }
  catch (err) { return reply.code(400).send({ ok: false, error: (err as Error).message }); }
});
app.get("/apply/:token/:appId", async (req, reply) => {
  const { token, appId } = req.params as { token: string; appId: string };
  try { return statusOf(defIdForToken(token), appId); }
  catch (err) { return reply.code(404).send({ ok: false, error: (err as Error).message }); }
});
app.post("/apply/:token/:appId/accept", async (req, reply) => {
  const { token, appId } = req.params as { token: string; appId: string };
  try { return await acceptOffer(token, appId); }
  catch (err) { return reply.code(400).send({ ok: false, error: (err as Error).message }); }
});

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
  if (!requireCap(req, reply, "build")) return;
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
  if (!requireCap(req, reply, "build")) return;
  const { id } = req.params as { id: string };
  try {
    addAudit(actor(req).username, "template.install", id);
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

// Delete a workflow and everything it owns.
app.delete("/definitions/:id", async (req, reply) => {
  if (!requireCap(req, reply, "admin")) return;
  const { id } = req.params as { id: string };
  deleteDefinition(id);
  addAudit(actor(req).username, "definition.delete", id);
  return { ok: true };
});

// LLM-generated functional description of a process. Optional {baseUrl, apiKey,
// model} in the body override the seeded `describer` connector for this call.
app.post("/definitions/:id/describe", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
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
  if (!requireCap(req, reply, "build")) return;
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
app.post("/definitions/:id/draft", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
  const { id } = req.params as { id: string };
  const body = req.body as ProcessDefinition;
  const draft: ProcessDefinition = { ...body, id, version: 0, status: "draft" };
  saveDefinition(draft);
  return { ok: true, errors: validateDefinition(draft) };
});

// Publish: refuse if invalid; otherwise store as the next published version.
app.post("/definitions/:id/publish", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
  const { id } = req.params as { id: string };
  const body = req.body as ProcessDefinition;
  const candidate: ProcessDefinition = { ...body, id, status: "published" };
  const errors = validateDefinition(candidate);
  if (errors.length > 0) return reply.code(400).send({ ok: false, errors });
  candidate.version = maxPublishedVersion(id) + 1;
  saveDefinition(candidate);
  // keep editing the draft in sync with what was published
  saveDefinition({ ...candidate, version: 0, status: "draft" });
  addAudit(actor(req).username, "publish", `${id}@v${candidate.version}`);
  return { ok: true, version: candidate.version };
});

// ---- M9 governance: version history, import/export, data dictionary ----

app.get("/definitions/:id/versions", async (req) => {
  const { id } = req.params as { id: string };
  return listDefinitionVersions(id);
});

// Restore a published version back into the editable draft.
app.post("/definitions/:id/restore/:version", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
  const { id, version } = req.params as { id: string; version: string };
  try {
    const def = getDefinition(id, Number(version));
    saveDefinition({ ...def, id, version: 0, status: "draft" });
    addAudit(actor(req).username, "restore", `${id}@v${version}`);
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
  if (!requireCap(req, reply, "build")) return;
  const body = (req.body ?? {}) as WorkflowBundle & { targetId?: string };
  try {
    const defId = importBundle(body, body.targetId);
    addAudit(actor(req).username, "import", defId);
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

// ---- M16 file upload (base64 JSON, no extra deps) ----
app.post("/files", async (req, reply) => {
  const { name, mime, contentBase64 } = (req.body ?? {}) as { name?: string; mime?: string; contentBase64?: string };
  if (!name || !contentBase64) return reply.code(400).send({ ok: false, error: "name and contentBase64 required" });
  const id = randomUUID();
  const size = Math.floor((contentBase64.length * 3) / 4);
  saveFile(id, name, mime ?? "application/octet-stream", size, contentBase64);
  return { ok: true, fileId: id, name, size, mime: mime ?? "application/octet-stream" };
});

app.get("/files/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const f = getFile(id);
  if (!f) return reply.code(404).send({ ok: false, error: "file not found" });
  reply.header("content-type", f.mime);
  reply.header("content-disposition", `inline; filename="${f.name.replace(/"/g, "")}"`);
  return reply.send(Buffer.from(f.content, "base64"));
});

app.get("/forms", async () => listForms());
app.get("/connectors", async () => listConnectors());

// Discover the tools a given MCP server exposes (for the tool-name picker).
app.post("/mcp/tools", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
  const { url, apiKey } = (req.body ?? {}) as { url?: string; apiKey?: string };
  try {
    return { ok: true, tools: await listMcpTools(url ?? "", apiKey) };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

app.post("/connectors", async (req, reply) => {
  if (!requireCap(req, reply, "admin")) return;
  const body = req.body as { id: string; type: string; config: Record<string, unknown> };
  saveConnector({ id: body.id, type: body.type, config: body.config ?? {} });
  addAudit(actor(req).username, "connector.save", body.id);
  return { ok: true };
});

// Test a connector with sample input (used by the admin "Test" button).
app.post("/connectors/:id/test", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
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
  const body = req.body as { messages?: { role: string; content: string }[]; tools?: { function?: { name?: string } }[] };
  const messages = body.messages ?? [];
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const usage = { prompt_tokens: 180, completion_tokens: 45, total_tokens: 225 };

  // Tool-calling: if tools are offered and no tool result has come back yet,
  // ask to call the first tool once; on the next turn, produce the final answer.
  const hasToolResult = messages.some((m) => m.role === "tool");
  if (Array.isArray(body.tools) && body.tools.length && !hasToolResult) {
    const name = body.tools[0]?.function?.name ?? "lookup";
    return {
      id: "chatcmpl-mock", object: "chat.completion", usage,
      choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify({ query: "mock" }) } }] }, finish_reason: "tool_calls" }],
    };
  }

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
    return { id: "chatcmpl-mock", object: "chat.completion", usage, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(workflow) }, finish_reason: "stop" }] };
  }

  const userMsg = [...messages].reverse().find((m) => m.role === "user");
  let income = 0;
  try {
    const parsed = JSON.parse(userMsg?.content ?? "{}");
    if (typeof parsed.income === "number") income = parsed.income;
  } catch {
    /* ignore */
  }
  const toolInformed = hasToolResult;
  const decision = { riskScore: income >= 5000 ? 0.2 : 0.9, verified: true, reviewedBy: "mock-llm", confidence: 0.82, ...(toolInformed ? { toolUsed: true } : {}) };
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    usage,
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

// Business-readable executions list + per-case detail (for the Executions view).
app.get("/executions", async () => listCaseSummaries());
app.get("/instances/:id/case", async (req, reply) => {
  const { id } = req.params as { id: string };
  try { return buildCase(id); }
  catch (err) { return reply.code(404).send({ ok: false, error: (err as Error).message }); }
});

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

app.post("/definitions/:id/start", async (req, reply) => {
  if (!requireCap(req, reply, "operate")) return;
  const { id } = req.params as { id: string };
  addAudit(actor(req).username, "instance.start", id);
  return startInstance(id);
});

// ---- M13 triggers & schedules ----

// Inbound webhook (public, token-authenticated) — start an instance with the posted body as context.
app.post("/hooks/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  const trig = getTrigger(token);
  if (!trig || !trig.enabled) return reply.code(404).send({ ok: false, error: "Unknown trigger" });
  const body = (req.body ?? {}) as Record<string, never>;
  const { instanceId } = await startInstance(trig.defId, body);
  return { ok: true, instanceId };
});

// Async connector callback (public, token-authenticated) — resume a parked instance.
app.post("/callbacks/:token", async (req, reply) => {
  const { token } = req.params as { token: string };
  try {
    const result = await resumeViaCallback(token, (req.body ?? {}) as Record<string, never>);
    return { ok: true, result };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// Trigger management.
app.get("/definitions/:id/triggers", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
  const { id } = req.params as { id: string };
  return listTriggers(id);
});
app.post("/definitions/:id/triggers", async (req, reply) => {
  if (!requireCap(req, reply, "admin")) return;
  const { id } = req.params as { id: string };
  const { label } = (req.body ?? {}) as { label?: string };
  const t = createTrigger(id, label ?? "");
  addAudit(actor(req).username, "trigger.create", id);
  return { ok: true, trigger: t };
});
app.delete("/definitions/:id/triggers/:token", async (req, reply) => {
  if (!requireCap(req, reply, "admin")) return;
  const { token } = req.params as { token: string };
  deleteTrigger(token);
  return { ok: true };
});

// Schedule management (interval-based recurring starts).
app.get("/definitions/:id/schedules", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
  const { id } = req.params as { id: string };
  return listSchedules(id);
});
app.post("/definitions/:id/schedules", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
  const { id } = req.params as { id: string };
  const { intervalSeconds, label } = (req.body ?? {}) as { intervalSeconds?: number; label?: string };
  if (!intervalSeconds || intervalSeconds < 5) return reply.code(400).send({ ok: false, error: "intervalSeconds must be >= 5" });
  const s = createSchedule(id, Math.floor(intervalSeconds), label ?? "");
  addAudit(actor(req).username, "schedule.create", id);
  return { ok: true, schedule: s };
});
app.delete("/definitions/:id/schedules/:sid", async (req, reply) => {
  if (!requireCap(req, reply, "build")) return;
  const { sid } = req.params as { sid: string };
  deleteSchedule(sid);
  return { ok: true };
});

// Re-run a failed instance from where it stopped (e.g. after a flaky dependency recovers).
app.post("/instances/:id/retry", async (req, reply) => {
  if (!requireCap(req, reply, "operate")) return;
  const { id } = req.params as { id: string };
  try {
    addAudit(actor(req).username, "instance.retry", id);
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
      let route: { from: string[]; to: string[] } = { from: [], to: [] };
      try {
        const def = getDefinition(inst.defId, inst.defVersion);
        processName = def.name;
        const nameOf = (nid: string): string => {
          const n = def.nodes.find((x) => x.id === nid);
          if (!n) return nid;
          if (n.type === "start") return "Inicio";
          if (n.type === "end") return "Fin";
          return "name" in n && n.name ? n.name : nid;
        };
        const node = def.nodes.find((n) => n.id === t.nodeId);
        if (node && "name" in node && node.name) nodeName = node.name;
        route = {
          from: def.edges.filter((e) => e.to === t.nodeId).map((e) => nameOf(e.from)),
          to: def.edges.filter((e) => e.from === t.nodeId).map((e) => nameOf(e.to)),
        };
      } catch { /* definition gone */ }
      let formTitle: string | null = null;
      if (t.formId) { try { formTitle = getForm(t.formId).title; } catch { /* form gone */ } }
      return { ...t, defId: inst.defId, processName, nodeName, formTitle, route, context: inst.context };
    })
    .sort((a, b) => {
      const pr = (rank[a.priority ?? "normal"] ?? 1) - (rank[b.priority ?? "normal"] ?? 1);
      if (pr !== 0) return pr;
      return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"); // sooner due first
    });
});

// Claim an open task. Assigns to the current user; an admin may claim for someone else.
app.post("/tasks/:taskId/claim", async (req, reply) => {
  if (!requireCap(req, reply, "operate")) return;
  const { taskId } = req.params as { taskId: string };
  const user = actor(req);
  const body = (req.body ?? {}) as { assignee?: string };
  const assignee = can(user.role, "admin") && body.assignee ? body.assignee : user.username;
  try {
    claimTask(taskId, assignee);
    addAudit(user.username, "task.claim", getTask(taskId).instanceId);
    return { ok: true, assignee };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: (err as Error).message });
  }
});

// Reassign a task to another user (current assignee or an admin).
app.post("/tasks/:taskId/reassign", async (req, reply) => {
  if (!requireCap(req, reply, "operate")) return;
  const { taskId } = req.params as { taskId: string };
  const user = actor(req);
  const { assignee } = (req.body ?? {}) as { assignee?: string };
  if (!assignee) return reply.code(400).send({ ok: false, error: "assignee is required" });
  const task = getTask(taskId);
  if (!can(user.role, "admin") && task.assignee !== user.username) {
    return reply.code(403).send({ ok: false, error: "Only the current assignee or an admin can reassign" });
  }
  claimTask(taskId, assignee);
  addNotification(assignee, "task-reassigned", `Task reassigned to you by ${user.username}`, task.instanceId);
  addAudit(user.username, "task.reassign", task.instanceId);
  return { ok: true, assignee };
});

app.post("/tasks/:taskId/submit", async (req, reply) => {
  if (!requireCap(req, reply, "operate")) return;
  const { taskId } = req.params as { taskId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;
  addAudit(actor(req).username, "task.submit", getTask(taskId).instanceId);
  const result = await submitTask(taskId, body as Record<string, never>);
  const task = getTask(taskId);
  return { result, instance: getInstance(task.instanceId) };
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`Cassiopeia API on http://localhost:${port}`);
});
