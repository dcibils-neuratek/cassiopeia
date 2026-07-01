// Generate a plain-language, functional description of a process by serializing
// its graph (nodes, attached forms, connectors, gateway conditions, edges) and
// asking an OpenAI-compatible LLM to explain what it does. Model/baseUrl/apiKey
// come from the `describer` connector, overridable per request.

import type { GatewayNode } from "@cassiopeia/model";
import { getConnector, getEditableDefinition, getForm } from "./db.js";

function outline(defId: string): string {
  const def = getEditableDefinition(defId);
  if (!def) throw new Error(`Definition not found: ${defId}`);
  const lines: string[] = [`Process name: ${def.name}`, "Steps:"];
  for (const n of def.nodes) {
    if (n.type === "userTask") {
      let f = "";
      if (n.formId) {
        try {
          const form = getForm(n.formId);
          f = ` — collects a form "${form.title}" (fields: ${form.fields.map((x) => x.label).join(", ") || "none"})`;
        } catch { /* form missing */ }
      }
      lines.push(`- Human task: "${n.name}"${f}`);
    } else if (n.type === "serviceTask") {
      let c = "";
      if (n.connectorId) {
        try {
          const con = getConnector(n.connectorId);
          c = ` — automated call via connector "${con.id}" (type ${con.type})`;
        } catch { /* connector missing */ }
      }
      lines.push(`- Automated task: "${n.name}"${c}`);
    } else if (n.type === "gateway") {
      const g = n as GatewayNode;
      const branches = g.branches.map((b) => {
        const edge = def.edges.find((e) => e.id === b.edgeId);
        const target = def.nodes.find((x) => x.id === edge?.to);
        return `if (${b.when}) go to "${(target as any)?.name ?? edge?.to}"`;
      });
      const defEdge = def.edges.find((e) => e.id === g.defaultEdgeId);
      const defTarget = def.nodes.find((x) => x.id === defEdge?.to);
      lines.push(`- Decision: "${n.name}" — ${branches.join("; ") || "no conditions"}; otherwise go to "${(defTarget as any)?.name ?? defEdge?.to ?? "?"}"`);
    } else if (n.type === "start") {
      lines.push(`- Start of the process`);
    } else if (n.type === "end") {
      lines.push(`- End of the process`);
    }
  }
  lines.push("Connections:");
  for (const e of def.edges) {
    const from = def.nodes.find((x) => x.id === e.from);
    const to = def.nodes.find((x) => x.id === e.to);
    const nm = (x: any) => (x?.type === "start" ? "Start" : x?.type === "end" ? "End" : x?.name ?? "?");
    lines.push(`  ${nm(from)} → ${nm(to)}`);
  }
  return lines.join("\n");
}

const SYSTEM =
  "You are a banking business analyst. Read the workflow definition and describe, " +
  "in clear functional language for a non-technical stakeholder, what this process does " +
  "end to end: what starts it, what information is collected, what automated checks or " +
  "decisions happen, how it branches, and how it concludes. Write 2–4 short paragraphs. " +
  "Do not use bullet lists, code, or internal ids — just prose.";

/**
 * Call the platform `describer` LLM (Claude Haiku by default; any OpenAI-compatible
 * provider). Shared by Describe and the M10 process analyst.
 */
export async function callDescriber(
  system: string,
  user: string,
  override?: { baseUrl?: string; apiKey?: string; model?: string },
): Promise<string> {
  let cfg: Record<string, any> = { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5", apiKey: "" };
  try { cfg = { ...cfg, ...getConnector("describer").config }; } catch { /* not seeded */ }
  for (const [k, v] of Object.entries(override ?? {})) if (v != null && v !== "") cfg[k] = v;
  if (!cfg.apiKey) throw new Error("No API key set for the description model. Add it in Settings or the Describe panel.");

  const res = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Description LLM HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function describeProcess(
  defId: string,
  override?: { baseUrl?: string; apiKey?: string; model?: string },
): Promise<string> {
  return callDescriber(SYSTEM, outline(defId), override);
}
