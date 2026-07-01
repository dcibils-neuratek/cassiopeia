// Prompt-to-workflow: turn a natural-language instruction (plus the current
// design, for conversational edits) into a full ProcessDefinition + forms via
// an OpenAI-compatible LLM. Reuses the `describer` connector for model/key.

import type { Edge, FormDefinition, Node as ModelNode, ProcessDefinition } from "@cassiopeia/model";
import { validateDefinition } from "@cassiopeia/engine";
import { getConnector } from "./db.js";

const FIELD_KINDS = ["text", "email", "number", "date", "select", "checkbox", "file"];

function toBind(label: string): string {
  const parts = label.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "field";
  return parts.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
}

function autoLayout(nodes: { id: string }[], edges: { from: string; to: string }[], startId: string): Record<string, { x: number; y: number }> {
  const adj: Record<string, string[]> = {};
  for (const e of edges) (adj[e.from] ??= []).push(e.to);
  const depth: Record<string, number> = { [startId]: 0 };
  const q: string[] = [startId];
  while (q.length) {
    const id = q.shift()!;
    for (const to of adj[id] ?? []) if (depth[to] == null) { depth[to] = depth[id] + 1; q.push(to); }
  }
  let maxD = Math.max(0, ...Object.values(depth));
  const layers: Record<number, string[]> = {};
  for (const n of nodes) {
    const d = depth[n.id] ?? ++maxD;
    (layers[d] ??= []).push(n.id);
  }
  const layout: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of Object.entries(layers)) {
    const dep = Number(d);
    ids.forEach((id, i) => { layout[id] = { x: 40 + dep * 220, y: 90 + i * 130 }; });
  }
  return layout;
}

interface RawResult {
  reply?: string;
  name?: string;
  nodes?: any[];
  edges?: any[];
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function currentSummary(def?: ProcessDefinition): string {
  if (!def || def.nodes.length === 0) return "There is no existing workflow yet — build one from scratch.";
  const nodes = def.nodes.map((n) => {
    const extra = n.type === "serviceTask" ? ` connector=${(n as any).connectorId || "none"}` : n.type === "userTask" ? ` form=${(n as any).formId || "none"}` : "";
    return `${n.id}[${n.type}${(n as any).name ? ` "${(n as any).name}"` : ""}${extra}]`;
  });
  const edges = def.edges.map((e) => `${e.from}->${e.to}`);
  return `Current workflow "${def.name}":\nNodes: ${nodes.join(", ")}\nEdges: ${edges.join(", ")}`;
}

const SYSTEM = `You are the Cassiopeia workflow builder — an assistant that designs BPM-style banking workflows.
Return ONLY a JSON object (no prose, no code fences) with this exact shape:
{
  "reply": "one or two sentences telling the user what you built or changed",
  "name": "Workflow name",
  "nodes": [
    { "id": "start", "type": "start" },
    { "id": "collect", "type": "userTask", "name": "Collect Info",
      "form": { "title": "Collect Info", "fields": [
        { "kind": "text", "label": "Full name", "required": true },
        { "kind": "number", "label": "Annual income", "required": true },
        { "kind": "select", "label": "Purpose", "options": ["Home","Vehicle","Other"] }
      ] } },
    { "id": "check", "type": "serviceTask", "name": "Risk Check", "connector": "<existing connector id, or omit>" },
    { "id": "decide", "type": "gateway", "name": "Approved?" },
    { "id": "approve", "type": "userTask", "name": "Approve" },
    { "id": "end", "type": "end" }
  ],
  "edges": [
    { "from": "start", "to": "collect" },
    { "from": "collect", "to": "check" },
    { "from": "check", "to": "decide" },
    { "from": "decide", "to": "approve", "when": "decision == 'approved'" },
    { "from": "decide", "to": "end" }
  ]
}
Rules:
- Exactly one "start" node and at least one "end" node.
- Every non-end node has exactly one outgoing edge, EXCEPT gateways, which have 2+.
- For a gateway, put a "when" condition on each conditional edge; leave exactly one edge WITHOUT "when" as the default/else branch. Conditions reference process variables produced by earlier forms/connectors (e.g. income, riskScore, decision) using ==, !=, >, >=, <, <=, &&, ||.
- Attach a "form" to userTasks that collect information. Field kinds: text, email, number, date, select, checkbox, file. Add "options" for select.
- For serviceTasks, set "connector" to one of the EXISTING connector ids listed by the user if relevant; otherwise omit it (the user will configure it).
- When editing an existing workflow, return the COMPLETE updated workflow, keeping node ids stable where possible.
- Keep ids short slugs (letters, digits, underscore).`;

export async function generateWorkflow(
  instruction: string,
  current?: ProcessDefinition,
  connectorIds: string[] = [],
  override?: { baseUrl?: string; apiKey?: string; model?: string },
): Promise<{ reply: string; definition: ProcessDefinition; forms: FormDefinition[]; errors: string[] }> {
  let cfg: Record<string, any> = { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5", apiKey: "" };
  try { cfg = { ...cfg, ...getConnector("describer").config }; } catch { /* not seeded */ }
  for (const [k, v] of Object.entries(override ?? {})) if (v != null && v !== "") cfg[k] = v;
  if (!cfg.apiKey) throw new Error("No API key set for the AI builder. Add it in Settings → Process description model.");

  const userMsg =
    `${currentSummary(current)}\n\nExisting connector ids you may reference: ${connectorIds.join(", ") || "(none)"}\n\nInstruction: ${instruction}`;

  const res = await fetch(`${String(cfg.baseUrl).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI builder HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  let raw: RawResult;
  try { raw = JSON.parse(stripFences(content)); } catch { throw new Error("The model did not return valid JSON. Try rephrasing."); }

  // ---- convert raw -> ProcessDefinition + forms ----
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const forms: FormDefinition[] = [];
  const defId = current?.id ?? "onboarding";

  const nodes: ModelNode[] = rawNodes.map((n: any) => {
    if (n.type === "userTask") {
      let formId: string | undefined;
      if (n.form && Array.isArray(n.form.fields)) {
        formId = `form_${n.id}`;
        forms.push({
          id: formId,
          version: 1,
          title: n.form.title || n.name || "Form",
          fields: n.form.fields.map((f: any, i: number) => ({
            kind: FIELD_KINDS.includes(f.kind) ? f.kind : "text",
            id: `f_${n.id}_${i}`,
            bind: f.bind || toBind(f.label || `field${i}`),
            label: f.label || `Field ${i + 1}`,
            required: !!f.required,
            ...(Array.isArray(f.options) ? { options: f.options.map((o: any) => (typeof o === "string" ? { label: o, value: toBind(o) } : o)) } : {}),
          })),
        });
      }
      return { id: n.id, type: "userTask", name: n.name || n.id, ...(formId ? { formId } : {}) } as ModelNode;
    }
    if (n.type === "serviceTask") {
      const connectorId = typeof n.connector === "string" && connectorIds.includes(n.connector) ? n.connector : "";
      return { id: n.id, type: "serviceTask", name: n.name || n.id, connectorId } as ModelNode;
    }
    if (n.type === "gateway") return { id: n.id, type: "gateway", name: n.name || n.id, branches: [], defaultEdgeId: "" } as ModelNode;
    if (n.type === "end") return { id: n.id, type: "end" } as ModelNode;
    return { id: n.id, type: "start" } as ModelNode;
  });

  const edges: Edge[] = rawEdges.map((e: any, i: number) => ({ id: `e_${i}`, from: e.from, to: e.to }));
  // gateway branches from edge "when"
  for (const node of nodes) {
    if (node.type !== "gateway") continue;
    const out = rawEdges.map((e: any, i: number) => ({ ...e, id: `e_${i}` })).filter((e: any) => e.from === node.id);
    node.branches = out.filter((e: any) => e.when).map((e: any) => ({ edgeId: e.id, when: String(e.when) }));
    const def = out.find((e: any) => !e.when) ?? out[out.length - 1];
    node.defaultEdgeId = def?.id ?? "";
  }

  const startNode = nodes.find((n) => n.type === "start");
  const startNodeId = startNode?.id ?? nodes[0]?.id ?? "start";

  const definition: ProcessDefinition = {
    id: defId,
    name: raw.name || current?.name || "New Workflow",
    version: 0,
    status: "draft",
    startNodeId,
    nodes,
    edges,
    layout: autoLayout(nodes, edges, startNodeId),
  };

  return { reply: raw.reply || "Here's the workflow.", definition, forms, errors: validateDefinition(definition) };
}
