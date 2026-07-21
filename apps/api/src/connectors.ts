// Connector runner. MVP connectors are all synchronous: the engine awaits the
// result inline, then advances. The async/callback branch of the Connector
// interface is deferred (see design doc). Adapters dispatch on connector `type`.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Context, Json } from "@cassiopeia/model";
import { getConnector } from "./db.js";

type Adapter = (input: Context, config: Record<string, unknown>) => Promise<Context>;

/**
 * Per-connector-run context so the ai-agent adapter can report token usage and
 * tool calls back to the runtime without changing the engine's connector
 * interface. The runtime sets the store around each connector run.
 */
export interface RunHooks {
  emitUsage?: (usage: Json) => void;
  connectorId?: string;
}
export const runCtx = new AsyncLocalStorage<RunHooks>();

/** Strip ```json … ``` fences some models wrap JSON in, despite instructions. */
function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

// Rough public pricing (USD per 1M tokens) for cost estimation. Unknown → 0.
const PRICING: { match: RegExp; in: number; out: number }[] = [
  { match: /opus/i, in: 15, out: 75 },
  { match: /sonnet/i, in: 3, out: 15 },
  { match: /haiku/i, in: 1, out: 5 },
  { match: /gpt-4o-mini|4o-mini/i, in: 0.15, out: 0.6 },
  { match: /gpt-4o|4o/i, in: 2.5, out: 10 },
  { match: /gpt-4/i, in: 10, out: 30 },
];
function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING.find((x) => x.match.test(model));
  if (!p) return 0;
  return Number(((promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out).toFixed(6));
}

interface ChatUsage { promptTokens: number; completionTokens: number; totalTokens: number; cost: number; model: string }
interface ChatResult { message: any; usage: ChatUsage }

/** One OpenAI-compatible chat/completions call; returns the assistant message + usage. */
async function chatCompletion(
  config: Record<string, unknown>,
  messages: unknown[],
  tools?: unknown[],
): Promise<ChatResult> {
  const baseUrl = String(config.baseUrl ?? "").replace(/\/+$/, "");
  const model = String(config.model ?? "");
  const body: Record<string, unknown> = { model, messages };
  if (typeof config.temperature === "number") body.temperature = config.temperature;
  if (tools && tools.length) body.tools = tools;
  // Anthropic's OpenAI-compatible endpoint rejects response_format:json_object
  // (it wants json_schema); the system prompt already enforces JSON-only output,
  // so we only send response_format for other OpenAI-compatible providers.
  else if (config.jsonOutput !== false && !/anthropic\.com/i.test(baseUrl)) body.response_format = { type: "json_object" };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${String(config.apiKey ?? "")}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ai-agent HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: any }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const u = data.usage ?? {};
  const promptTokens = u.prompt_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? 0;
  return {
    message: data.choices?.[0]?.message ?? { content: "" },
    usage: { promptTokens, completionTokens, totalTokens: u.total_tokens ?? promptTokens + completionTokens, cost: estimateCost(model, promptTokens, completionTokens), model },
  };
}

/** POST one JSON-RPC message to an MCP Streamable-HTTP endpoint; parse JSON or SSE. */
async function mcpPost(url: string, message: unknown, headers: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(message),
  });
  const sid = res.headers.get("mcp-session-id") ?? undefined;
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  let json: any = {};
  if (ct.includes("text/event-stream")) {
    const dataLines = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
    if (dataLines.length) json = JSON.parse(dataLines[dataLines.length - 1]);
  } else if (text.trim()) {
    json = JSON.parse(text);
  }
  return { json, sid };
}

const adapters: Record<string, Adapter> = {
  // Deterministic stand-in for a document-verification agent. Higher income =>
  // lower risk. Real AI Agent connector arrives in a later milestone.
  "mock-verify": async (input) => {
    const income = typeof input.income === "number" ? input.income : 0;
    const riskScore = income >= 5000 ? 0.2 : 0.9;
    return { riskScore, verified: true };
  },

  "mock-create-account": async (input) => {
    const name =
      typeof input.legalName === "string" ? input.legalName : "customer";
    const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 12);
    return { accountId: `ACC-${slug}` };
  },

  // Stand-in for an AML / sanctions / PEP screening service (the tool a KYC
  // agent calls). Deterministic from the applicant's name so the demo is stable.
  "mock-aml": async (input) => {
    const name = String(input.legalName ?? input.fullName ?? "").toLowerCase();
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    const amlRisk = Math.round((h % 100) / 100 * 100) / 100; // 0..0.99
    return {
      amlRisk,
      watchlistHit: amlRisk > 0.85,
      pep: amlRisk > 0.9,
      sanctions: amlRisk > 0.95,
    };
  },

  // Mortgage math. Swap for a real pricing API or an AI agent later.
  "mock-mortgage": async (input) => {
    const price = Number(input.propertyValue) || 0;
    const down = Number(input.downPayment) || 0;
    const years = Number(input.termYears) || 20;
    const annualIncome = Number(input.annualIncome) || 1;
    const loanAmount = Math.max(price - down, 0);
    const r = 0.06 / 12;
    const n = years * 12;
    const monthlyPayment = loanAmount === 0 ? 0 : (loanAmount * r) / (1 - Math.pow(1 + r, -n));
    const dti = monthlyPayment / (annualIncome / 12);
    return {
      loanAmount: Math.round(loanAmount),
      monthlyPayment: Math.round(monthlyPayment),
      dti: Math.round(dti * 100) / 100,
      affordable: dti <= 0.35,
    };
  },

  // Simple credit scoring. Swap for a bureau API or an AI agent later.
  "mock-credit-score": async (input) => {
    const income = Number(input.annualIncome) || 0;
    const amount = Number(input.amount) || 1;
    const ratio = income / amount;
    const score = Math.max(300, Math.min(850, Math.round(500 + ratio * 40)));
    return { creditScore: score, decision: score >= 650 ? "approved" : "review" };
  },

  // Always throws — used to exercise retries, error routing, and the failed/retry
  // path in Monitor. config: { message? }.
  "mock-fail": async (_input, config) => {
    throw new Error(String(config.message ?? "mock-fail: simulated connector failure"));
  },

  // Register travel so the card works abroad. Swap for the card network API.
  "mock-travel-register": async (input) => {
    const dest = typeof input.destinations === "string" ? input.destinations : "";
    return {
      registered: true,
      reference: `TRV-${dest.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6)}-OK`,
      coverage: dest,
    };
  },

  // AI Agent connector — OpenAI-compatible /chat/completions. Provider-neutral:
  // point baseUrl+apiKey+model at Anthropic's OpenAI-compat endpoint or any other
  // OpenAI-compatible server. config:
  //   { baseUrl, apiKey, model, instructions?, jsonOutput?, temperature?,
  //     tools?: [{ name, description?, connector, parameters? }],  // tool-calling
  //     requiredKeys?: string[],   // output guardrail (retry once if missing)
  //     maxSteps? }                // tool-loop cap (default 4)
  "ai-agent": async (input, config) => {
    const baseUrl = String(config.baseUrl ?? "").replace(/\/+$/, "");
    const model = String(config.model ?? "");
    if (!baseUrl || !model) throw new Error("ai-agent connector needs baseUrl and model");
    const instructions = String(config.instructions ?? "You are a task agent inside a business process.");
    const jsonOutput = config.jsonOutput !== false;
    const toolSpecs = Array.isArray(config.tools) ? (config.tools as any[]) : [];
    const requiredKeys = Array.isArray(config.requiredKeys) ? (config.requiredKeys as string[]) : [];
    const maxSteps = typeof config.maxSteps === "number" ? config.maxSteps : 4;
    const hooks = runCtx.getStore();

    const system = jsonOutput
      ? `${instructions}\n\nWhen you have the final answer, respond ONLY with a single JSON object (no prose, no code fences) to merge into the process context.`
      : instructions;

    // OpenAI-style tool schemas; each maps to another connector.
    const tools = toolSpecs.map((t) => ({
      type: "function",
      function: {
        name: String(t.name),
        description: String(t.description ?? `Call the ${t.connector} connector`),
        parameters: t.parameters ?? { type: "object", properties: {}, additionalProperties: true },
      },
    }));
    const toolToConnector = new Map<string, string>(toolSpecs.map((t) => [String(t.name), String(t.connector)]));

    const messages: any[] = [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(input) },
    ];

    const totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
    const accumulate = (u: ChatUsage) => {
      totals.promptTokens += u.promptTokens; totals.completionTokens += u.completionTokens;
      totals.totalTokens += u.totalTokens; totals.cost = Number((totals.cost + u.cost).toFixed(6));
    };

    // Reasoning + tool-calling loop.
    let finalContent = "";
    for (let step = 0; step < maxSteps; step++) {
      const { message, usage } = await chatCompletion(config, messages, tools.length ? tools : undefined);
      accumulate(usage);
      messages.push(message);
      const calls = message.tool_calls as any[] | undefined;
      if (calls && calls.length) {
        for (const call of calls) {
          const name = call.function?.name;
          const connectorId = toolToConnector.get(name);
          let result: unknown;
          try {
            const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
            result = connectorId ? await runConnector(connectorId, args) : { error: `unknown tool ${name}` };
          } catch (err) {
            result = { error: (err as Error).message };
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue; // let the model read tool results
      }
      finalContent = message.content ?? "";
      break;
    }

    if (hooks?.emitUsage) {
      hooks.emitUsage({ model, promptTokens: totals.promptTokens, completionTokens: totals.completionTokens, totalTokens: totals.totalTokens, cost: totals.cost, tools: tools.length } as Json);
    }

    if (!jsonOutput) return { agentText: finalContent };
    let out: Context;
    try { out = JSON.parse(stripFences(finalContent)) as Context; }
    catch { out = { agentRaw: finalContent, agentParseError: true }; }

    // Output guardrail: one corrective retry if required keys are missing.
    const missing = requiredKeys.filter((k) => !(k in out));
    if (missing.length && !out.agentParseError) {
      messages.push({ role: "user", content: `Your JSON is missing required keys: ${missing.join(", ")}. Reply again with a complete JSON object including them.` });
      const { message, usage } = await chatCompletion(config, messages);
      accumulate(usage);
      if (hooks?.emitUsage) hooks.emitUsage({ model, retry: true, totalTokens: usage.totalTokens, cost: usage.cost } as Json);
      try { out = JSON.parse(stripFences(message.content ?? "")) as Context; } catch { /* keep prior */ }
    }
    const stillMissing = requiredKeys.filter((k) => !(k in out));
    if (stillMissing.length) out.guardrailMissing = stillMissing as unknown as Json;
    return out;
  },

  // Native Maverick Agents connector — a REST call to a Maverick agent. Call
  // your Maverick agents directly from an agent task. config:
  //   { baseUrl, apiKey, agentId, path? }
  // Defaults to POST {baseUrl}/agents/{agentId}/invoke with { input } and a
  // Bearer token; unwraps output/result and merges it into the process context.
  "maverick-agent": async (input, config) => {
    const baseUrl = String(config.baseUrl ?? "").replace(/\/+$/, "");
    const agentId = String(config.agentId ?? "");
    if (!baseUrl || !agentId) throw new Error("maverick-agent needs baseUrl and agentId");
    const path = String(config.path ?? `/agents/${agentId}/invoke`);
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(config.apiKey ?? "")}`,
      },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`maverick-agent HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    const out = (data.output ?? data.result ?? data) as unknown;
    if (out && typeof out === "object" && !Array.isArray(out)) return out as Context;
    return { maverickOutput: out as any };
  },

  // MCP connector — call a tool on an MCP server (Streamable HTTP). Does the
  // JSON-RPC handshake (initialize → tools/call). config:
  //   { url, toolName, apiKey? }
  // Unwraps structuredContent (or JSON text content) into the process context.
  mcp: async (input, config) => {
    const url = String(config.url ?? "");
    const toolName = String(config.toolName ?? "");
    if (!url || !toolName) throw new Error("mcp connector needs url and toolName");
    const auth: Record<string, string> = config.apiKey ? { authorization: `Bearer ${String(config.apiKey)}` } : {};

    const init = await mcpPost(
      url,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cassiopeia", version: "0.1" } } },
      auth,
    );
    const sess = init.sid ? { "mcp-session-id": init.sid, ...auth } : auth;

    // best-effort "initialized" notification (some servers require it)
    try {
      await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...sess }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    } catch { /* ignore */ }

    const call = await mcpPost(url, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: input } }, sess);
    if (call.json?.error) throw new Error(`MCP tool error: ${call.json.error.message ?? "unknown"}`);
    const result = call.json?.result ?? {};
    if (result.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)) {
      return result.structuredContent as Context;
    }
    const textOut = (Array.isArray(result.content) ? result.content : [])
      .filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n");
    try { return JSON.parse(stripFences(textOut)) as Context; } catch { return { mcpText: textOut }; }
  },

  // Async connector — kicks off long-running external work (e.g. a slow agent)
  // and returns immediately; the instance parks until the external system POSTs
  // the result to the callback URL. config: { url, callbackBaseUrl?, headers? }.
  // The engine sees __awaitCallback and waits; resumeCallback() continues the run.
  "async-callback": async (input, config) => {
    const url = String(config.url ?? "");
    const token = randomUUID().replace(/-/g, "");
    const base = String(config.callbackBaseUrl ?? "http://localhost:3001/callbacks").replace(/\/+$/, "");
    const callbackUrl = `${base}/${token}`;
    if (url) {
      try {
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(config.headers as object) },
          body: JSON.stringify({ input, callbackUrl }),
        });
      } catch { /* fire-and-forget kickoff; the callback is the real signal */ }
    }
    return { __awaitCallback: true, __callbackToken: token, callbackUrl };
  },

  // Generic REST connector. config: { url, method?, headers? }.
  // "API" integration: call any REST endpoint. url / headers / body are already
  // {{variable}}-substituted by runConnector before we get here.
  http: async (input, config) => {
    const url = String(config.url ?? "");
    if (!url) throw new Error("La integración API necesita una URL");
    const method = String(config.method ?? "POST").toUpperCase();

    const headers: Record<string, string> = { "content-type": "application/json" };
    const h = config.headers;
    if (Array.isArray(h)) {
      for (const it of h as { key?: string; value?: string }[]) if (it?.key) headers[String(it.key)] = String(it.value ?? "");
    } else if (h && typeof h === "object") {
      for (const [k, v] of Object.entries(h)) headers[k] = String(v);
    }
    if (config.token) headers["authorization"] = `Bearer ${String(config.token)}`;

    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const b = config.body;
      if (typeof b === "string" && b.trim()) {
        try { JSON.parse(b); } catch { throw new Error(`El payload no es JSON válido tras reemplazar variables: ${b.slice(0, 140)}`); }
        body = b;
      } else if (b && typeof b === "object") {
        body = JSON.stringify(b);
      } else {
        body = JSON.stringify(input); // no template → send the whole input
      }
    }

    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    if (!res.ok) throw new Error(`API HTTP ${res.status}: ${text.slice(0, 300)}`);
    if (!text) return {};
    try { return JSON.parse(text) as Context; } catch { return { raw: text }; }
  },
};

/** List the tools exposed by an MCP server (initialize → tools/list). */
export async function listMcpTools(
  url: string,
  apiKey?: string,
): Promise<{ name: string; description: string }[]> {
  if (!url) throw new Error("MCP server URL is required");
  const auth: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const init = await mcpPost(
    url,
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cassiopeia", version: "0.1" } } },
    auth,
  );
  const sess = init.sid ? { "mcp-session-id": init.sid, ...auth } : auth;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...sess }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  } catch { /* ignore */ }
  const res = await mcpPost(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sess);
  if (res.json?.error) throw new Error(`tools/list: ${res.json.error.message ?? "failed"}`);
  const tools = Array.isArray(res.json?.result?.tools) ? res.json.result.tools : [];
  return tools.map((t: any) => ({ name: String(t.name), description: String(t.description ?? "") }));
}

// ---- {{variable}} templating + output mapping (the integration I/O contract) ----

function ctxPath(ctx: Context, path: string): Json {
  let cur: Json = ctx;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object" || Array.isArray(cur)) return null;
    cur = (cur as Record<string, Json>)[part] ?? null;
  }
  return cur;
}

/** Replace {{name}} / {{a.b}} tokens in a string with values from the input. */
function renderStr(s: string, input: Context): string {
  return s.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (_m, path) => {
    const v = ctxPath(input, String(path));
    if (v == null) return "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

/** Deep-substitute {{}} tokens across every string in a config value. */
function renderDeep(val: unknown, input: Context): unknown {
  if (typeof val === "string") return renderStr(val, input);
  if (Array.isArray(val)) return val.map((x) => renderDeep(x, input));
  if (val && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) out[k] = renderDeep(v, input);
    return out;
  }
  return val;
}

type OutputSpec = { name: string; from?: string };

/** If the integration declares outputs, project the raw result onto them. */
function applyOutputs(result: Context, outputs: unknown): Context {
  if (!Array.isArray(outputs) || outputs.length === 0) return result;
  const out: Context = {};
  for (const o of outputs as OutputSpec[]) {
    if (!o || !o.name) continue;
    out[o.name] = ctxPath(result, o.from?.trim() || o.name);
  }
  return out;
}

export async function runConnector(
  connectorId: string,
  input: Context,
): Promise<Context> {
  const c = getConnector(connectorId);
  const adapter = adapters[c.type];
  if (!adapter) throw new Error(`No adapter for connector type '${c.type}'`);
  // Enforce the integration's input contract: required variables must be present.
  const declaredInputs = c.config.inputs as { name?: string; required?: boolean }[] | undefined;
  if (Array.isArray(declaredInputs)) {
    const missing = declaredInputs
      .filter((v) => v?.required && v.name && ctxPath(input, v.name) == null)
      .map((v) => v!.name);
    if (missing.length) throw new Error(`Faltan variables de entrada requeridas: ${missing.join(", ")}`);
  }
  // 1) resolve the platform key, 2) substitute {{variables}} from the input,
  // 3) run, 4) map the result onto the declared output variables (if any).
  const config = renderDeep(withPlatformKey(connectorId, c.type, c.config), input) as Record<string, unknown>;
  const result = await adapter(input, config);
  return applyOutputs(result, config.outputs);
}

/**
 * Platform-key fallback, resolved at run time: an `ai-agent` with no key of its
 * own borrows the platform LLM key from the `describer` connector (Settings →
 * Modelo de IA). A key set on the agent itself always wins (per-agent override),
 * and changing the platform key takes effect immediately — no restart, nothing
 * baked into each agent.
 */
function withPlatformKey(
  connectorId: string,
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (type !== "ai-agent" || config.apiKey || connectorId === "describer") return config;
  try {
    const platformKey = getConnector("describer").config.apiKey;
    if (platformKey) return { ...config, apiKey: platformKey };
  } catch { /* describer not installed */ }
  return config;
}
