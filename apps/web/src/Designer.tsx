import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  Edge,
  GatewayNode,
  Node as ModelNode,
  ProcessDefinition,
} from "@cassiopeia/model";
import { api } from "./api.js";
import { FormDesigner } from "./FormDesigner.js";
import { Portal } from "./Portal.js";
import { McpToolPicker } from "./McpToolPicker.js";

const uid = () => Math.random().toString(36).slice(2, 6);

const NODE_UI: Record<string, { color: string }> = {
  start: { color: "#16a34a" },
  end: { color: "#64748b" },
  userTask: { color: "#2563eb" },
  serviceTask: { color: "#7c3aed" },
  gateway: { color: "#d97706" },
  timer: { color: "#0891b2" },
  subprocess: { color: "#0d9488" },
};

function label(n: ModelNode): string {
  if (n.type === "start") return "Start";
  if (n.type === "end") return "End";
  return n.name;
}

function CassNode({ data, selected }: { data: { node: ModelNode }; selected: boolean }) {
  const n = data.node;
  const ui = NODE_UI[n.type];
  const sub =
    n.type === "userTask" ? (n.formId ? "📝 form attached" : "no form yet") :
    n.type === "serviceTask" ? (n.connectorId ? `⚙ ${n.connectorId}` : "no connector") :
    n.type === "timer" ? (n.untilPath ? `⏱ until ${n.untilPath}` : `⏱ ${n.delaySeconds ?? 0}s`) :
    n.type === "subprocess" ? (n.processId ? `⤷ ${n.processId}` : "no process") : "";
  return (
    <div
      style={{
        border: `2px solid ${ui.color}`,
        borderRadius: n.type === "gateway" ? 20 : 8,
        background: "white",
        padding: "8px 12px",
        minWidth: 110,
        textAlign: "center",
        boxShadow: selected ? "0 0 0 3px rgba(79,70,229,0.4)" : "none",
      }}
    >
      {n.type !== "start" && <Handle type="target" position={Position.Left} />}
      <div style={{ fontSize: 9, textTransform: "uppercase", color: ui.color, fontWeight: 700, letterSpacing: 0.5 }}>{n.type}</div>
      <div style={{ fontSize: 13, color: "#0f172a" }}>{label(n)}</div>
      {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
      {n.type !== "end" && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

const nodeTypes = { cass: CassNode };
type Sel = { kind: "node" | "edge"; id: string } | null;
type Connector = { id: string; type: string; config: Record<string, any> };

export function Designer({ defId }: { defId: string }) {
  const DEF_ID = defId;
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [name, setName] = useState("Customer Onboarding");
  const [sel, setSel] = useState<Sel>(null);
  const [forms, setForms] = useState<{ id: string; title: string }[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [allDefs, setAllDefs] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [formDrawerId, setFormDrawerId] = useState<string | null>(null);
  const [testInput, setTestInput] = useState('{ "income": 1200 }');
  const [testOut, setTestOut] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [descCfg, setDescCfg] = useState({ baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5", apiKey: "" });
  const [description, setDescription] = useState("");
  const [descBusy, setDescBusy] = useState(false);
  const [descErr, setDescErr] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [chat, setChat] = useState<{ role: "user" | "agent"; text: string }[]>([
    { role: "agent", text: "Hi! Describe the workflow you want — e.g. \"a mortgage pre-approval that collects income and property value, runs an affordability check, then approves or asks for more info.\" I'll build it on the canvas, and you can keep refining." },
  ]);
  // M9 governance
  const [govOpen, setGovOpen] = useState(false);
  const [govTab, setGovTab] = useState<"versions" | "data" | "automation" | "import">("versions");
  const [versions, setVersions] = useState<{ version: number; status: string; nodeCount: number; edgeCount: number }[]>([]);
  const [dataDict, setDataDict] = useState<{ entries: { key: string; producedBy: string[]; consumedBy: string[] }[]; warnings: string[] } | null>(null);
  const [importText, setImportText] = useState("");
  const [govMsg, setGovMsg] = useState("");
  const [triggers, setTriggers] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [newSchedMin, setNewSchedMin] = useState(60);

  async function reloadForms() {
    const r = await api(`/forms`);
    setForms(r.data);
  }
  async function reloadConnectors() {
    const r = await api(`/connectors`);
    setConnectors(r.data);
  }

  function applyDef(def: ProcessDefinition) {
    setName(def.name);
    setNodes(def.nodes.map((n) => ({ id: n.id, type: "cass", position: def.layout?.[n.id] ?? { x: 0, y: 0 }, data: { node: n } })));
    setEdges(def.edges.map((e) => {
      const gw = def.nodes.find((x) => x.id === e.from && x.type === "gateway") as GatewayNode | undefined;
      const isDefault = gw?.defaultEdgeId === e.id;
      const when = gw?.branches.find((b) => b.edgeId === e.id)?.when;
      return { id: e.id, source: e.from, target: e.to, markerEnd: { type: MarkerType.ArrowClosed }, label: isDefault ? "default" : when ?? "", data: { when, isDefault } };
    }));
    setSel(null);
  }

  useEffect(() => {
    (async () => {
      const defRes = await api(`/definitions/${DEF_ID}/edit`);
      await reloadForms();
      await reloadConnectors();
      const dl = await api(`/definitions`);
      if (dl.ok) setAllDefs(dl.data.map((d: any) => ({ id: d.id, name: d.name })));
      applyDef(defRes.data as ProcessDefinition);
    })();
  }, []);

  const onConnect = useCallback((c: Connection) =>
    setEdges((eds) => addEdge({ ...c, id: `e_${uid()}`, markerEnd: { type: MarkerType.ArrowClosed }, data: {} }, eds)), [setEdges]);

  function addNode(type: ModelNode["type"]) {
    if (type === "start" && nodes.some((n) => n.data.node.type === "start")) return;
    const id = `${type}_${uid()}`;
    let node: ModelNode;
    if (type === "userTask") node = { id, type, name: "User Task" };
    else if (type === "serviceTask") node = { id, type, name: "Service Task", connectorId: "" };
    else if (type === "gateway") node = { id, type, name: "Gateway", branches: [], defaultEdgeId: "" };
    else if (type === "timer") node = { id, type, name: "Wait", delaySeconds: 60 };
    else if (type === "subprocess") node = { id, type, name: "Subprocess", processId: "" };
    else if (type === "end") node = { id, type };
    else node = { id, type: "start" };
    const spawn = 80 + nodes.length * 20;
    setNodes((nds) => [...nds, { id, type: "cass", position: { x: spawn, y: spawn }, data: { node } }]);
    setSel({ kind: "node", id });
  }

  const updateNode = (id: string, patch: Partial<ModelNode>) =>
    setNodes((nds) => nds.map((nd) => (nd.id === id ? { ...nd, data: { node: { ...nd.data.node, ...patch } } } : nd)));

  const updateEdge = (id: string, patch: { when?: string; isDefault?: boolean }, source?: string) =>
    setEdges((eds) => eds.map((ed) => {
      if (patch.isDefault && source && ed.source === source && ed.id !== id) {
        const d = { ...ed.data, isDefault: false };
        return { ...ed, data: d, label: d.when || "" };
      }
      if (ed.id !== id) return ed;
      const data = { ...ed.data, ...patch };
      return { ...ed, data, label: data.isDefault ? "default" : data.when || "" };
    }));

  function deleteSelected() {
    if (!sel) return;
    if (sel.kind === "node") {
      setNodes((nds) => nds.filter((n) => n.id !== sel.id));
      setEdges((eds) => eds.filter((e) => e.source !== sel.id && e.target !== sel.id));
    } else setEdges((eds) => eds.filter((e) => e.id !== sel.id));
    setSel(null);
  }

  function toDefinition(): ProcessDefinition {
    const modelNodes: ModelNode[] = nodes.map((rn) => {
      const n = rn.data.node as ModelNode;
      if (n.type === "gateway") {
        const out = edges.filter((e) => e.source === rn.id);
        const branches = out.filter((e) => e.data?.when && !e.data?.isDefault).map((e) => ({ edgeId: e.id, when: e.data.when as string }));
        const def = out.find((e) => e.data?.isDefault) ?? out[out.length - 1];
        return { ...n, branches, defaultEdgeId: def?.id ?? "" };
      }
      return n;
    });
    const modelEdges: Edge[] = edges.map((e) => ({ id: e.id, from: e.source, to: e.target }));
    const layout = Object.fromEntries(nodes.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]));
    const start = nodes.find((n) => n.data.node.type === "start");
    return { id: DEF_ID, name, version: 0, status: "draft", startNodeId: start?.id ?? "", nodes: modelNodes, edges: modelEdges, layout };
  }

  async function persist(publish: boolean) {
    setMsg("");
    const r = await api(`/definitions/${DEF_ID}/${publish ? "publish" : "draft"}`, { method: "POST", body: JSON.stringify(toDefinition()) });
    if (publish && r.ok) { setErrors([]); setMsg(`Published v${r.data.version} ✓ — go to Run to try it`); }
    else if (publish) setErrors(r.data.errors ?? ["Publish failed"]);
    else { setErrors(r.data.errors ?? []); setMsg("Draft saved"); }
  }

  async function reloadCanvas() {
    const r = await api(`/definitions/${DEF_ID}/edit`);
    applyDef(r.data as ProcessDefinition);
  }
  // Tidy the canvas: BFS-layer nodes left→right from the start node.
  function autoLayout() {
    const adj = new Map<string, string[]>();
    for (const e of edges) { const a = adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!; a.push(e.target); }
    const start = nodes.find((n) => n.data.node.type === "start");
    const layer = new Map<string, number>();
    if (start) {
      const q = [start.id]; layer.set(start.id, 0);
      while (q.length) { const cur = q.shift()!; const l = layer.get(cur)!; for (const to of adj.get(cur) ?? []) if (!layer.has(to)) { layer.set(to, l + 1); q.push(to); } }
    }
    const byLayer = new Map<number, string[]>();
    for (const n of nodes) { const l = layer.get(n.id) ?? 0; const a = byLayer.get(l) ?? byLayer.set(l, []).get(l)!; a.push(n.id); }
    const pos = new Map<string, { x: number; y: number }>();
    byLayer.forEach((ids, l) => ids.forEach((id, i) => pos.set(id, { x: 60 + l * 240, y: 60 + i * 110 })));
    setNodes((nds) => nds.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
  }
  async function exportWorkflow() {
    await api(`/definitions/${DEF_ID}/draft`, { method: "POST", body: JSON.stringify(toDefinition()) });
    const r = await api(`/definitions/${DEF_ID}/export`);
    if (!r.ok) { setMsg("Export failed"); return; }
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${DEF_ID}.cassiopeia.json`; a.click();
    URL.revokeObjectURL(url);
    setMsg("Exported workflow bundle (JSON)");
  }
  async function openGov() {
    setGovMsg(""); setGovTab("versions"); setImportText("");
    await api(`/definitions/${DEF_ID}/draft`, { method: "POST", body: JSON.stringify(toDefinition()) });
    const [v, d, tr, sc] = await Promise.all([
      api(`/definitions/${DEF_ID}/versions`), api(`/definitions/${DEF_ID}/data-dictionary`),
      api(`/definitions/${DEF_ID}/triggers`), api(`/definitions/${DEF_ID}/schedules`),
    ]);
    setVersions(v.data); setDataDict(d.data);
    setTriggers(tr.ok ? tr.data : []); setSchedules(sc.ok ? sc.data : []);
    setGovOpen(true);
  }
  async function addTrigger() {
    const r = await api(`/definitions/${DEF_ID}/triggers`, { method: "POST", body: JSON.stringify({ label: "webhook" }) });
    if (r.ok) setTriggers((await api(`/definitions/${DEF_ID}/triggers`)).data);
    else setGovMsg(r.data?.error ?? "Creating a trigger needs admin");
  }
  async function delTrigger(token: string) {
    await api(`/definitions/${DEF_ID}/triggers/${token}`, { method: "DELETE" });
    setTriggers((ts) => ts.filter((t) => t.token !== token));
  }
  async function addSchedule() {
    const r = await api(`/definitions/${DEF_ID}/schedules`, { method: "POST", body: JSON.stringify({ intervalSeconds: Math.max(1, newSchedMin) * 60, label: "recurring" }) });
    if (r.ok) setSchedules((await api(`/definitions/${DEF_ID}/schedules`)).data);
    else setGovMsg(r.data?.error ?? "Could not create schedule");
  }
  async function delSchedule(id: string) {
    await api(`/definitions/${DEF_ID}/schedules/${id}`, { method: "DELETE" });
    setSchedules((ss) => ss.filter((s) => s.id !== id));
  }
  async function restoreVersion(v: number) {
    await api(`/definitions/${DEF_ID}/restore/${v}`, { method: "POST" });
    await reloadCanvas();
    setGovMsg(`Restored v${v} into the working draft`);
  }
  async function importWorkflow() {
    let bundle: any;
    try { bundle = JSON.parse(importText); } catch { setGovMsg("Invalid JSON"); return; }
    const r = await api(`/definitions/import`, { method: "POST", body: JSON.stringify({ ...bundle, targetId: DEF_ID }) });
    if (r.ok) { await reloadCanvas(); await reloadForms(); await reloadConnectors(); setGovMsg("Imported into this workflow ✓"); }
    else setGovMsg(r.data?.error ?? "Import failed");
  }

  // Publish the current design, then open the Run modal so it reflects edits.
  async function publishAndRun() {
    const r = await api(`/definitions/${DEF_ID}/publish`, { method: "POST", body: JSON.stringify(toDefinition()) });
    if (r.ok) { setErrors([]); setMsg(""); setRunOpen(true); }
    else setErrors(r.data.errors ?? ["Publish failed"]);
  }

  // ---- LLM process description ----
  async function openDescribe() {
    setDescription(""); setDescErr("");
    const r = await api(`/connectors`);
    const d = (r.data as Connector[]).find((c) => c.id === "describer");
    if (d) setDescCfg({ baseUrl: d.config.baseUrl ?? "", model: d.config.model ?? "claude-haiku-4-5", apiKey: d.config.apiKey ?? "" });
    setDescOpen(true);
  }
  async function saveDescriber() {
    await api(`/connectors`, { method: "POST", body: JSON.stringify({ id: "describer", type: "ai-agent", config: { ...descCfg, jsonOutput: false } }) });
    setDescErr(""); setMsg("Description model saved");
  }
  async function generateDescription() {
    setDescBusy(true); setDescErr(""); setDescription("");
    // publish current design first so the description reflects what's on screen
    await api(`/definitions/${DEF_ID}/draft`, { method: "POST", body: JSON.stringify(toDefinition()) });
    const r = await api(`/definitions/${DEF_ID}/describe`, { method: "POST", body: JSON.stringify(descCfg) });
    setDescBusy(false);
    if (r.ok) setDescription(r.data.description);
    else setDescErr(r.data.error ?? "Failed to generate description");
  }

  // ---- AI workflow builder (chat) ----
  async function sendAi() {
    const instruction = aiInput.trim();
    if (!instruction || aiBusy) return;
    setChat((c) => [...c, { role: "user", text: instruction }]);
    setAiInput("");
    setAiBusy(true);
    const r = await api(`/definitions/${DEF_ID}/ai-build`, {
      method: "POST",
      body: JSON.stringify({ instruction, current: toDefinition() }),
    });
    setAiBusy(false);
    if (r.ok) {
      applyDef(r.data.definition as ProcessDefinition);
      await reloadForms();
      await reloadConnectors();
      const created = (r.data.connectors ?? []) as { id: string; type: string }[];
      const madeNote = created.length ? `\n\nCreated connector${created.length > 1 ? "s" : ""}: ${created.map((c) => `${c.id} (${c.type})`).join(", ")} — add keys in Settings.` : "";
      const errs = (r.data.errors ?? []) as string[];
      const note = errs.length ? `\n\n⚠ Needs a fix before publishing: ${errs.join("; ")}` : "";
      setChat((c) => [...c, { role: "agent", text: (r.data.reply || "Done.") + madeNote + note }]);
    } else {
      setChat((c) => [...c, { role: "agent", text: `Sorry — ${r.data.error ?? "something went wrong."}` }]);
    }
  }

  // ---- forms attached to a user task ----
  async function createFormForTask(node: ModelNode & { name?: string }) {
    const id = `form_${uid()}`;
    const title = `${(node as any).name ?? "Task"} — Form`;
    await api(`/forms/${id}`, { method: "POST", body: JSON.stringify({ id, version: 1, title, fields: [] }) });
    await reloadForms();
    updateNode(node.id, { formId: id } as any);
    setFormDrawerId(id);
  }

  // ---- connector editing inline on a service task ----
  const setConnectorCfg = (cid: string, key: string, val: any) =>
    setConnectors((cs) => cs.map((c) => (c.id === cid ? { ...c, config: { ...c.config, [key]: val } } : c)));
  async function saveConnector(c: Connector) {
    await api(`/connectors`, { method: "POST", body: JSON.stringify(c) });
    setMsg(`Connector ${c.id} saved`);
  }
  async function newConnectorFor(node: ModelNode, type: string) {
    const prefix = type === "maverick-agent" ? "mav" : type === "mcp" ? "mcp" : "ai";
    const id = `${prefix}_${uid()}`;
    const config =
      type === "maverick-agent" ? { baseUrl: "https://your-maverick-host", apiKey: "", agentId: "" }
      : type === "mcp" ? { url: "https://your-mcp-server/mcp", toolName: "", apiKey: "" }
      : { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", apiKey: "", instructions: "You are a task agent inside a business process.", jsonOutput: true };
    const c: Connector = { id, type, config };
    await api(`/connectors`, { method: "POST", body: JSON.stringify(c) });
    await reloadConnectors();
    updateNode(node.id, { connectorId: id } as any);
    setTestOut("");
  }
  async function testConnector(id: string) {
    let input: any = {};
    try { input = JSON.parse(testInput); } catch { setTestOut("Invalid JSON"); return; }
    const r = await api(`/connectors/${id}/test`, { method: "POST", body: JSON.stringify(input) });
    setTestOut(JSON.stringify(r.data, null, 2));
  }

  const selNode = sel?.kind === "node" ? nodes.find((n) => n.id === sel.id)?.data.node as ModelNode | undefined : undefined;
  const selEdge = sel?.kind === "edge" ? edges.find((e) => e.id === sel.id) : undefined;
  const selEdgeFromGateway = selEdge && nodes.find((n) => n.id === selEdge.source)?.data.node.type === "gateway";

  return (
    <div>
      <div style={S.toolbar}>
        <input style={S.nameInput} value={name} onChange={(e) => setName(e.target.value)} />
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Add:</span>
        {(["userTask", "serviceTask", "gateway", "timer", "subprocess", "end", "start"] as const).map((t) => (
          <button key={t} style={S.paletteBtn} onClick={() => addNode(t)}>+ {t}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button style={S.aiBtn} onClick={() => setAiOpen(true)}>✦ Build with AI</button>
        <button style={S.describe} onClick={openDescribe}>✦ Describe</button>
        <button style={S.ghost} onClick={autoLayout} title="Tidy the layout">⤢ Tidy</button>
        <button style={S.ghost} onClick={openGov}>Manage</button>
        <button style={S.ghost} onClick={exportWorkflow}>Export</button>
        <button style={S.ghost} onClick={() => persist(false)}>Save draft</button>
        <button style={S.ghost} onClick={() => persist(true)}>Publish</button>
        <button style={S.run} onClick={publishAndRun}>▶ Run</button>
      </div>

      {msg && <div style={S.okBar}>{msg}</div>}
      {errors.length > 0 && <div style={S.errBar}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <div style={{ flex: 1, height: "calc(100vh - 250px)", minHeight: 460, border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => { setSel({ kind: "node", id: n.id }); setTestOut(""); }}
            onEdgeClick={(_, e) => setSel({ kind: "edge", id: e.id })}
            onPaneClick={() => setSel(null)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <div style={S.panel}>
          {!sel && (
            <div>
              <h3 style={S.h3}>Build your process</h3>
              <ol style={S.steps}>
                <li>Add tasks from the <b>Add</b> bar above.</li>
                <li>Drag from a node's right dot to the next node to connect them.</li>
                <li>Click a <span style={{ color: "#2563eb", fontWeight: 700 }}>User Task</span> to attach &amp; design its form.</li>
                <li>Click a <span style={{ color: "#7c3aed", fontWeight: 700 }}>Service Task</span> to pick &amp; configure a connector (API or AI agent).</li>
                <li>Click an edge out of a <span style={{ color: "#d97706", fontWeight: 700 }}>Gateway</span> to set its condition.</li>
                <li><b>Publish</b>, then open <b>Run</b> to try it.</li>
              </ol>
            </div>
          )}

          {selNode && (
            <div>
              <h3 style={S.h3}>{selNode.type}</h3>
              {selNode.type !== "start" && selNode.type !== "end" && (
                <>
                  <L>Name</L>
                  <input style={S.input} value={(selNode as any).name} onChange={(e) => updateNode(selNode.id, { name: e.target.value } as any)} />
                </>
              )}

              {selNode.type === "userTask" && (
                <>
                  <L>Attached form</L>
                  <select style={S.input} value={selNode.formId ?? ""} onChange={(e) => updateNode(selNode.id, { formId: e.target.value } as any)}>
                    <option value="">(none)</option>
                    {forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                  </select>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {selNode.formId ? (
                      <button style={S.primary} onClick={() => setFormDrawerId(selNode.formId!)}>Design this form →</button>
                    ) : (
                      <button style={S.primary} onClick={() => createFormForTask(selNode)}>Create &amp; design form →</button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <L>Assignee</L>
                      <input style={S.input} placeholder="unassigned"
                        value={(selNode as any).assignee ?? ""}
                        onChange={(e) => updateNode(selNode.id, { assignee: e.target.value || undefined } as any)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <L>Role</L>
                      <input style={S.input} placeholder="e.g. underwriter"
                        value={(selNode as any).candidateRole ?? ""}
                        onChange={(e) => updateNode(selNode.id, { candidateRole: e.target.value || undefined } as any)} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <L>Priority</L>
                      <select style={S.input} value={(selNode as any).priority ?? "normal"}
                        onChange={(e) => updateNode(selNode.id, { priority: e.target.value === "normal" ? undefined : e.target.value } as any)}>
                        <option value="low">low</option>
                        <option value="normal">normal</option>
                        <option value="high">high</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <L>SLA (hours)</L>
                      <input style={S.input} type="number" min={0} placeholder="none"
                        value={(selNode as any).slaHours ?? ""}
                        onChange={(e) => updateNode(selNode.id, { slaHours: e.target.value.trim() === "" ? undefined : Math.max(0, Number(e.target.value) || 0) } as any)} />
                    </div>
                  </div>
                  <p style={S.hint}>Drives the Inbox worklist: ordering, filtering, and overdue flags.</p>
                </>
              )}

              {selNode.type === "timer" && (
                <>
                  <L>Wait for (seconds)</L>
                  <input style={S.input} type="number" min={0} placeholder="60"
                    value={(selNode as any).delaySeconds ?? ""}
                    onChange={(e) => updateNode(selNode.id, { delaySeconds: e.target.value.trim() === "" ? undefined : Math.max(0, Number(e.target.value) || 0) } as any)} />
                  <L>…or wait until (context date path)</L>
                  <input style={S.input} placeholder="e.g. appointment.date"
                    value={(selNode as any).untilPath ?? ""}
                    onChange={(e) => updateNode(selNode.id, { untilPath: e.target.value || undefined } as any)} />
                  <p style={S.hint}>The engine parks here; a scheduler resumes the run once the time passes. A date path wins over the fixed delay when it resolves.</p>
                </>
              )}

              {selNode.type === "subprocess" && (
                <>
                  <L>Sub-process</L>
                  <select style={S.input} value={(selNode as any).processId ?? ""} onChange={(e) => updateNode(selNode.id, { processId: e.target.value } as any)}>
                    <option value="">(pick a process)</option>
                    {allDefs.filter((d) => d.id !== DEF_ID).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <p style={S.hint}>Runs another process to completion and merges its result. It must be fully automated (no human tasks).</p>
                  <MultiInstanceFields node={selNode} onChange={(mi) => updateNode(selNode.id, { multiInstance: mi } as any)} />
                </>
              )}

              {selNode.type === "serviceTask" && (
                <ServiceInspector
                  node={selNode}
                  connectors={connectors}
                  outEdges={edges.filter((e) => e.source === selNode.id).map((e) => {
                    const tn = nodes.find((n) => n.id === e.target)?.data.node as ModelNode | undefined;
                    return { id: e.id, toName: tn && "name" in tn && tn.name ? (tn.name as string) : e.target };
                  })}
                  onPatch={(patch) => updateNode(selNode.id, patch)}
                  onPick={(cid) => { updateNode(selNode.id, { connectorId: cid } as any); setTestOut(""); }}
                  onNew={(type) => newConnectorFor(selNode, type)}
                  setCfg={setConnectorCfg}
                  onSave={saveConnector}
                  testInput={testInput} setTestInput={setTestInput}
                  testOut={testOut} onTest={testConnector}
                />
              )}

              {selNode.type === "gateway" && <p style={S.hint}>Set conditions on the edges leaving this gateway (click an edge).</p>}
              <button style={S.danger} onClick={deleteSelected}>Delete node</button>
            </div>
          )}

          {selEdge && (
            <div>
              <h3 style={S.h3}>Connection</h3>
              <p style={S.hint}>{selEdge.source} → {selEdge.target}</p>
              {selEdgeFromGateway ? (
                <>
                  <L>Condition (when)</L>
                  <input style={S.input} placeholder="e.g. riskScore > 0.7" value={(selEdge.data?.when as string) ?? ""} onChange={(e) => updateEdge(selEdge.id, { when: e.target.value })} disabled={Boolean(selEdge.data?.isDefault)} />
                  <label style={S.check}>
                    <input type="checkbox" checked={Boolean(selEdge.data?.isDefault)} onChange={(e) => updateEdge(selEdge.id, { isDefault: e.target.checked }, selEdge.source)} />
                    Default branch
                  </label>
                </>
              ) : <p style={S.hint}>Only edges leaving a gateway carry conditions.</p>}
              <button style={S.danger} onClick={deleteSelected}>Delete edge</button>
            </div>
          )}
        </div>
      </div>

      {formDrawerId && (
        <>
          <div style={S.backdrop} onClick={() => { setFormDrawerId(null); reloadForms(); }} />
          <div style={S.drawer}>
            <div style={S.drawerHead}>
              <span style={{ fontWeight: 700 }}>Form for: {selNode && (selNode as any).name}</span>
            </div>
            <FormDesigner fixedFormId={formDrawerId} onClose={() => { setFormDrawerId(null); reloadForms(); }} />
          </div>
        </>
      )}

      {runOpen && (
        <>
          <div style={S.backdrop} onClick={() => setRunOpen(false)} />
          <div style={S.modal}>
            <div style={S.modalHead}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>▶ Run: {name}</span>
              <button style={S.ghost} onClick={() => setRunOpen(false)}>Close</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto" }}>
              <Portal defId={DEF_ID} autoStart />
            </div>
          </div>
        </>
      )}

      {govOpen && (
        <>
          <div style={S.backdrop} onClick={() => setGovOpen(false)} />
          <div style={{ ...S.modal, width: "min(860px, 94vw)", height: "auto", maxHeight: "88vh" }}>
            <div style={S.modalHead}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Manage: {name}</span>
              <button style={S.ghost} onClick={() => setGovOpen(false)}>Close</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(["versions", "data", "automation", "import"] as const).map((t) => (
                  <button key={t} onClick={() => setGovTab(t)} style={govTab === t ? S.tabActive : S.tab}>
                    {t === "versions" ? "Version history" : t === "data" ? "Data dictionary" : t === "automation" ? "Automation" : "Import"}
                  </button>
                ))}
              </div>
              {govMsg && <div style={S.okMsg}>{govMsg}</div>}

              {govTab === "versions" && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ color: "#64748b", textAlign: "left" }}>
                    <th style={S.gth}>Version</th><th style={S.gth}>Status</th><th style={S.gth}>Nodes</th><th style={S.gth}>Edges</th><th style={S.gth}></th>
                  </tr></thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.version} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={S.gtd}>v{v.version}</td><td style={S.gtd}>{v.status}</td><td style={S.gtd}>{v.nodeCount}</td><td style={S.gtd}>{v.edgeCount}</td>
                        <td style={S.gtd}><button style={S.ghost} onClick={() => restoreVersion(v.version)}>Restore to draft</button></td>
                      </tr>
                    ))}
                    {versions.length === 0 && <tr><td style={S.gtd} colSpan={5}>No published versions yet — publish to create v1.</td></tr>}
                  </tbody>
                </table>
              )}

              {govTab === "data" && dataDict && (
                <>
                  {dataDict.warnings.map((w, i) => <div key={i} style={S.warn}>⚠ {w}</div>)}
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ color: "#64748b", textAlign: "left" }}>
                      <th style={S.gth}>Context key</th><th style={S.gth}>Produced by</th><th style={S.gth}>Consumed by</th>
                    </tr></thead>
                    <tbody>
                      {dataDict.entries.map((e) => (
                        <tr key={e.key} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={S.gtd}><code>{e.key}</code></td>
                          <td style={S.gtd}>{e.producedBy.join(", ") || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                          <td style={S.gtd}>{e.consumedBy.join(", ") || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                        </tr>
                      ))}
                      {dataDict.entries.length === 0 && <tr><td style={S.gtd} colSpan={3}>No context keys yet.</td></tr>}
                    </tbody>
                  </table>
                </>
              )}

              {govTab === "automation" && (
                <>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Webhook triggers</div>
                  <p style={S.hint}>POST JSON to a trigger URL to start this workflow — the body becomes the initial context. No login needed (the token authorizes it). Creating a trigger needs admin.</p>
                  {triggers.map((t) => (
                    <div key={t.token} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <input readOnly style={{ ...S.input, flex: 1, fontFamily: "monospace", fontSize: 11 }} value={`${location.origin}/api/hooks/${t.token}`} onFocus={(e) => e.currentTarget.select()} />
                      <span style={S.hint}>{t.label}</span>
                      <button style={S.ghost} onClick={() => delTrigger(t.token)}>✕</button>
                    </div>
                  ))}
                  <button style={S.ghost} onClick={addTrigger}>+ Webhook trigger</button>

                  <div className="eyebrow" style={{ margin: "16px 0 4px" }}>Schedules</div>
                  <p style={S.hint}>Start this workflow automatically on a recurring interval.</p>
                  {schedules.map((s) => (
                    <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 13 }}>
                      <span>Every <b>{Math.round(s.intervalSeconds / 60)}</b> min {s.label ? `· ${s.label}` : ""}</span>
                      <span style={S.hint}>next {new Date(s.nextRun).toLocaleTimeString()}</span>
                      <button style={S.ghost} onClick={() => delSchedule(s.id)}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                    Every <input type="number" min={1} style={{ ...S.input, width: 80 }} value={newSchedMin} onChange={(e) => setNewSchedMin(Number(e.target.value) || 1)} /> minutes
                    <button style={S.ghost} onClick={addSchedule}>+ Schedule</button>
                  </div>
                </>
              )}

              {govTab === "import" && (
                <>
                  <p style={S.hint}>Paste a Cassiopeia workflow bundle (from Export). It imports into <b>{DEF_ID}</b> as a draft; existing connectors keep their keys.</p>
                  <textarea style={{ ...S.input, height: 220, fontFamily: "monospace" }} placeholder='{"cassiopeia":"workflow-bundle", ...}' value={importText} onChange={(e) => setImportText(e.target.value)} />
                  <button style={S.primary} onClick={importWorkflow}>Import bundle</button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {aiOpen && (
        <div style={S.aiDrawer}>
          <div style={S.drawerHead}>
            <span style={{ fontWeight: 700 }}>✦ Build with AI</span>
            <button style={S.ghost} onClick={() => setAiOpen(false)}>Close</button>
          </div>
          <div style={S.chatScroll}>
            {chat.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <div style={m.role === "user" ? S.bubbleUser : S.bubbleAgent}>{m.text}</div>
              </div>
            ))}
            {aiBusy && <div style={{ ...S.bubbleAgent, color: "#64748b" }}>Designing the workflow…</div>}
          </div>
          <div style={S.chatInputRow}>
            <textarea
              style={S.chatInput}
              placeholder="Describe or change the workflow…"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAi(); } }}
            />
            <button style={S.primary} disabled={aiBusy} onClick={sendAi}>Send</button>
          </div>
        </div>
      )}

      {descOpen && (
        <>
          <div style={S.backdrop} onClick={() => setDescOpen(false)} />
          <div style={{ ...S.modal, width: "min(760px, 94vw)", height: "auto", maxHeight: "88vh" }}>
            <div style={S.modalHead}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>✦ Process description: {name}</span>
              <button style={S.ghost} onClick={() => setDescOpen(false)}>Close</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto" }}>
              <div style={S.descSettings}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div style={{ flex: "1 1 160px" }}>
                    <L>Model</L>
                    <input style={S.input} value={descCfg.model} onChange={(e) => setDescCfg({ ...descCfg, model: e.target.value })} />
                  </div>
                  <div style={{ flex: "2 1 240px" }}>
                    <L>Base URL <span style={S.hint}>OpenAI-compatible</span></L>
                    <input style={S.input} value={descCfg.baseUrl} onChange={(e) => setDescCfg({ ...descCfg, baseUrl: e.target.value })} />
                  </div>
                  <div style={{ flex: "1 1 160px" }}>
                    <L>API key</L>
                    <input style={S.input} type="password" value={descCfg.apiKey} onChange={(e) => setDescCfg({ ...descCfg, apiKey: e.target.value })} />
                  </div>
                  <button style={S.ghost} onClick={saveDescriber}>Save</button>
                </div>
                <p style={{ ...S.hint, marginTop: 8 }}>Defaults to Claude Haiku — change the model/URL/key for any OpenAI-compatible provider.</p>
              </div>

              <button style={{ ...S.primary, marginTop: 14 }} disabled={descBusy} onClick={generateDescription}>
                {descBusy ? "Reading the flow…" : "Generate description"}
              </button>

              {descErr && <div style={{ ...S.errBar, marginTop: 12 }}>{descErr}</div>}
              {description && (
                <div style={S.descBox}>
                  {description.split(/\n\n+/).map((p, i) => <p key={i} style={{ margin: "0 0 10px", lineHeight: 1.6 }}>{p}</p>)}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ServiceInspector({
  node, connectors, outEdges, onPatch, onPick, onNew, setCfg, onSave, testInput, setTestInput, testOut, onTest,
}: {
  node: ModelNode & { connectorId?: string; retries?: number; retryDelayMs?: number; timeoutMs?: number; onErrorEdgeId?: string };
  connectors: Connector[];
  outEdges: { id: string; toName: string }[];
  onPatch: (patch: Partial<ModelNode>) => void;
  onPick: (cid: string) => void;
  onNew: (type: string) => void;
  setCfg: (cid: string, key: string, val: any) => void;
  onSave: (c: Connector) => void;
  testInput: string; setTestInput: (s: string) => void;
  testOut: string; onTest: (id: string) => void;
}) {
  const c = connectors.find((x) => x.id === node.connectorId);
  const num = (v: string): any => (v.trim() === "" ? undefined : Math.max(0, Number(v) || 0));
  return (
    <div>
      <L>Connector</L>
      <select style={S.input} value={node.connectorId ?? ""} onChange={(e) => onPick(e.target.value)}>
        <option value="">(none)</option>
        {connectors.map((x) => <option key={x.id} value={x.id}>{x.id} ({x.type})</option>)}
      </select>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <button style={S.ghost} onClick={() => onNew("ai-agent")}>+ AI agent</button>
        <button style={S.ghost} onClick={() => onNew("maverick-agent")}>+ Maverick</button>
        <button style={S.ghost} onClick={() => onNew("mcp")}>+ MCP</button>
      </div>

      {c && c.type === "mcp" && (
        <>
          <L>MCP server URL</L>
          <input style={S.input} value={c.config.url ?? ""} onChange={(e) => setCfg(c.id, "url", e.target.value)} />
          <L>API key <span style={S.hint}>optional</span></L>
          <input style={S.input} type="password" value={c.config.apiKey ?? ""} onChange={(e) => setCfg(c.id, "apiKey", e.target.value)} />
          <L>Tool</L>
          <McpToolPicker url={c.config.url} apiKey={c.config.apiKey} value={c.config.toolName} onChange={(v) => setCfg(c.id, "toolName", v)} />
        </>
      )}

      {c && c.type === "maverick-agent" && (
        <>
          <L>Maverick base URL</L>
          <input style={S.input} value={c.config.baseUrl ?? ""} onChange={(e) => setCfg(c.id, "baseUrl", e.target.value)} />
          <L>API key</L>
          <input style={S.input} type="password" value={c.config.apiKey ?? ""} onChange={(e) => setCfg(c.id, "apiKey", e.target.value)} />
          <L>Agent ID</L>
          <input style={S.input} value={c.config.agentId ?? ""} onChange={(e) => setCfg(c.id, "agentId", e.target.value)} />
        </>
      )}

      {c && c.type === "ai-agent" && (
        <>
          <L>Base URL <span style={S.hint}>OpenAI-compatible</span></L>
          <input style={S.input} value={c.config.baseUrl ?? ""} onChange={(e) => setCfg(c.id, "baseUrl", e.target.value)} />
          <L>API key</L>
          <input style={S.input} type="password" value={c.config.apiKey ?? ""} onChange={(e) => setCfg(c.id, "apiKey", e.target.value)} />
          <L>Model</L>
          <input style={S.input} value={c.config.model ?? ""} onChange={(e) => setCfg(c.id, "model", e.target.value)} />
          <L>Instructions</L>
          <textarea style={{ ...S.input, height: 70 }} value={c.config.instructions ?? ""} onChange={(e) => setCfg(c.id, "instructions", e.target.value)} />
        </>
      )}
      {c && c.type === "http" && (
        <>
          <L>URL</L>
          <input style={S.input} value={c.config.url ?? ""} onChange={(e) => setCfg(c.id, "url", e.target.value)} />
        </>
      )}
      {c && c.type.startsWith("mock") && <p style={S.hint}>Built-in mock connector — no config.</p>}

      {c && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {!c.type.startsWith("mock") && <button style={S.ghost} onClick={() => onSave(c)}>Save connector</button>}
          </div>
          <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
            <L>Test input (JSON)</L>
            <textarea style={{ ...S.input, height: 48, fontFamily: "monospace" }} value={testInput} onChange={(e) => setTestInput(e.target.value)} />
            <button style={S.ghost} onClick={() => onTest(c.id)}>Run test</button>
            {testOut && <pre style={S.pre}>{testOut}</pre>}
          </div>
        </>
      )}

      <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
        <L>Reliability</L>
        <p style={S.hint}>Retry a flaky connector, cap how long it may run, and choose where a final failure goes.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <L>Retries</L>
            <input style={S.input} type="number" min={0} value={node.retries ?? ""} placeholder="0"
              onChange={(e) => onPatch({ retries: num(e.target.value) } as any)} />
          </div>
          <div style={{ flex: 1 }}>
            <L>Backoff (ms)</L>
            <input style={S.input} type="number" min={0} value={node.retryDelayMs ?? ""} placeholder="500"
              onChange={(e) => onPatch({ retryDelayMs: num(e.target.value) } as any)} />
          </div>
          <div style={{ flex: 1 }}>
            <L>Timeout (ms)</L>
            <input style={S.input} type="number" min={0} value={node.timeoutMs ?? ""} placeholder="none"
              onChange={(e) => onPatch({ timeoutMs: num(e.target.value) } as any)} />
          </div>
        </div>
        <L>On failure</L>
        <select style={S.input} value={node.onErrorEdgeId ?? ""} onChange={(e) => onPatch({ onErrorEdgeId: e.target.value || undefined } as any)}>
          <option value="">Fail the instance</option>
          {outEdges.map((e) => <option key={e.id} value={e.id}>Route to → {e.toName}</option>)}
        </select>
        {node.onErrorEdgeId && <p style={S.hint}>On error, the run continues down this edge with the failure in <code>error</code>.</p>}
      </div>

      <MultiInstanceFields node={node} onChange={(mi) => onPatch({ multiInstance: mi } as any)} />
    </div>
  );
}

function MultiInstanceFields({ node, onChange }: { node: any; onChange: (mi: any) => void }) {
  const mi = node.multiInstance;
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
      <label style={S.check}>
        <input type="checkbox" checked={!!mi} onChange={(e) => onChange(e.target.checked ? { collectionPath: "items", itemKey: "item", resultPath: "results" } : undefined)} />
        Fan-out: run once per item of a collection
      </label>
      {mi && (
        <>
          <L>Collection path</L>
          <input style={S.input} value={mi.collectionPath ?? ""} placeholder="e.g. applicants" onChange={(e) => onChange({ ...mi, collectionPath: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><L>Item key</L><input style={S.input} value={mi.itemKey ?? ""} placeholder="item" onChange={(e) => onChange({ ...mi, itemKey: e.target.value })} /></div>
            <div style={{ flex: 1 }}><L>Result path</L><input style={S.input} value={mi.resultPath ?? ""} placeholder="results" onChange={(e) => onChange({ ...mi, resultPath: e.target.value })} /></div>
          </div>
        </>
      )}
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <label style={S.label}>{children}</label>;
}

const S: Record<string, React.CSSProperties> = {
  toolbar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  nameInput: { border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 14, fontWeight: 600, minWidth: 190 },
  paletteBtn: { border: "1px solid #cbd5e1", background: "white", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", color: "#334155" },
  primary: { background: "#2563eb", color: "white", border: 0, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  ghost: { background: "white", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer" },
  run: { background: "#16a34a", color: "white", border: 0, borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  describe: { background: "#eef2ff", color: "#4338ca", border: "1px solid #c7d2fe", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  aiBtn: { background: "#4338ca", color: "white", border: 0, borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  aiDrawer: { position: "fixed", top: 0, right: 0, height: "100vh", width: 380, maxWidth: "92vw", background: "white", boxShadow: "-8px 0 24px rgba(0,0,0,0.15)", zIndex: 50, display: "flex", flexDirection: "column", padding: 16 },
  chatScroll: { flex: 1, overflowY: "auto", padding: "12px 2px" },
  bubbleUser: { background: "#4338ca", color: "white", borderRadius: "12px 12px 2px 12px", padding: "8px 12px", fontSize: 13, maxWidth: "85%", whiteSpace: "pre-wrap" },
  bubbleAgent: { background: "#f1f5f9", color: "#0f172a", borderRadius: "12px 12px 12px 2px", padding: "8px 12px", fontSize: 13, maxWidth: "90%", whiteSpace: "pre-wrap" },
  chatInputRow: { display: "flex", gap: 8, alignItems: "flex-end", borderTop: "1px solid #e2e8f0", paddingTop: 10 },
  chatInput: { flex: 1, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13, resize: "none", height: 52, fontFamily: "inherit" },
  descSettings: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 },
  descBox: { marginTop: 16, background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, fontSize: 14, color: "#0f172a" },
  okBar: { marginTop: 10, background: "#dcfce7", color: "#166534", padding: "8px 12px", borderRadius: 8, fontSize: 13 },
  errBar: { marginTop: 10, background: "#fef2f2", color: "#991b1b", padding: "8px 12px", borderRadius: 8, fontSize: 13 },
  panel: { width: 320, border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, background: "white", color: "#0f172a", maxHeight: "calc(100vh - 250px)", minHeight: 460, overflowY: "auto" },
  h3: { margin: "0 0 8px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: "#64748b" },
  steps: { margin: 0, paddingLeft: 18, lineHeight: 1.9, fontSize: 13, color: "#334155" },
  hint: { fontSize: 12, color: "#64748b" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 12, marginBottom: 4 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13 },
  check: { display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13, color: "#334155" },
  danger: { marginTop: 16, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer", width: "100%" },
  pre: { background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 12, overflowX: "auto", marginTop: 8 },
  tab: { border: "1px solid #cbd5e1", background: "white", color: "#334155", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" },
  tabActive: { border: "1px solid #2563eb", background: "#eff6ff", color: "#2563eb", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 700 },
  okMsg: { background: "#dcfce7", color: "#166534", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 },
  warn: { background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", padding: "8px 12px", borderRadius: 8, fontSize: 12, marginBottom: 8 },
  gth: { padding: "8px 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  gtd: { padding: "8px 10px", color: "#0f172a", verticalAlign: "top" },
  backdrop: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.35)", zIndex: 40 },
  drawer: { position: "fixed", top: 0, right: 0, height: "100vh", width: "min(1080px, 96vw)", background: "white", boxShadow: "-8px 0 24px rgba(0,0,0,0.15)", zIndex: 50, padding: 24, overflowY: "auto" },
  drawerHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" },
  modal: { position: "fixed", top: "4vh", left: "50%", transform: "translateX(-50%)", width: "min(1000px, 94vw)", height: "90vh", background: "white", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", zIndex: 50, display: "flex", flexDirection: "column", overflow: "hidden" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" },
};
