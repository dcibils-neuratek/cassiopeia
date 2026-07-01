// Connector runner. MVP connectors are all synchronous: the engine awaits the
// result inline, then advances. The async/callback branch of the Connector
// interface is deferred (see design doc). Adapters dispatch on connector `type`.

import type { Context } from "@cassiopeia/model";
import { getConnector } from "./db.js";

type Adapter = (input: Context, config: Record<string, unknown>) => Promise<Context>;

/** Strip ```json … ``` fences some models wrap JSON in, despite instructions. */
function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
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

  // Register travel so the card works abroad. Swap for the card network API.
  "mock-travel-register": async (input) => {
    const dest = typeof input.destinations === "string" ? input.destinations : "";
    return {
      registered: true,
      reference: `TRV-${dest.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6)}-OK`,
      coverage: dest,
    };
  },

  // AI Agent connector — OpenAI-compatible /chat/completions. Provider-neutral
  // by design: point baseUrl+apiKey+model at Anthropic's OpenAI-compat endpoint
  // (https://api.anthropic.com/v1, model e.g. claude-sonnet-5) or any other
  // OpenAI-compatible server. config:
  //   { baseUrl, apiKey, model, instructions?, jsonOutput?, temperature? }
  "ai-agent": async (input, config) => {
    const baseUrl = String(config.baseUrl ?? "").replace(/\/+$/, "");
    const model = String(config.model ?? "");
    if (!baseUrl || !model) throw new Error("ai-agent connector needs baseUrl and model");
    const instructions = String(config.instructions ?? "You are a task agent inside a business process.");
    const jsonOutput = config.jsonOutput !== false; // default true — process needs structured data

    const system = jsonOutput
      ? `${instructions}\n\nRespond ONLY with a single JSON object (no prose, no code fences) that the process can merge into its context.`
      : instructions;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(input) },
      ],
    };
    if (typeof config.temperature === "number") body.temperature = config.temperature;
    if (jsonOutput) body.response_format = { type: "json_object" };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(config.apiKey ?? "")}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ai-agent HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!jsonOutput) return { agentText: content };
    try {
      return JSON.parse(stripFences(content)) as Context;
    } catch {
      return { agentRaw: content, agentParseError: true };
    }
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
    const auth = config.apiKey ? { authorization: `Bearer ${String(config.apiKey)}` } : {};

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

  // Generic REST connector. config: { url, method?, headers? }.
  http: async (input, config) => {
    const url = String(config.url);
    const method = (config.method as string) ?? "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(config.headers as object) },
      body: method === "GET" ? undefined : JSON.stringify(input),
    });
    const data = (await res.json()) as Context;
    return data;
  },
};

export async function runConnector(
  connectorId: string,
  input: Context,
): Promise<Context> {
  const c = getConnector(connectorId);
  const adapter = adapters[c.type];
  if (!adapter) throw new Error(`No adapter for connector type '${c.type}'`);
  return adapter(input, c.config);
}
