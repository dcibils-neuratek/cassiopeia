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

// Node palette for the toolbox (Spanish labels + icons + what each node does).
const TOOLBOX = [
  { type: "userTask", label: "Tarea humana", icon: "👤", color: "#2563eb", help: "Una persona completa un formulario: revisar, aprobar o cargar datos. Aparece en la Bandeja." },
  { type: "serviceTask", label: "Tarea de servicio", icon: "⚙", color: "#7c3aed", help: "Paso automático: llama a un conector (API, agente de IA o herramienta MCP) y guarda su resultado." },
  { type: "gateway", label: "Decisión", icon: "⑃", color: "#d97706", help: "Bifurca el flujo según una condición sobre los datos (ej. score > 700). Las condiciones van en las aristas de salida." },
  { type: "timer", label: "Espera / Timer", icon: "⏱", color: "#0891b2", help: "Pausa el flujo un tiempo fijo o hasta una fecha del contexto, y luego lo reanuda." },
  { type: "subprocess", label: "Subproceso", icon: "⤷", color: "#0d9488", help: "Ejecuta otro proceso completo y trae su resultado. Debe ser totalmente automático." },
  { type: "start", label: "Inicio", icon: "▶", color: "#16a34a", help: "Punto de arranque del proceso. Solo puede haber uno." },
  { type: "end", label: "Fin", icon: "■", color: "#64748b", help: "Marca el final de un camino del proceso." },
];
const NODE_TYPE_ES: Record<string, string> = {
  start: "Inicio", end: "Fin", userTask: "Tarea humana", serviceTask: "Tarea de servicio",
  gateway: "Decisión", timer: "Espera / Timer", subprocess: "Subproceso",
};

function label(n: ModelNode): string {
  if (n.type === "start") return "Inicio";
  if (n.type === "end") return "Fin";
  return n.name;
}

function CassNode({ data, selected }: { data: { node: ModelNode }; selected: boolean }) {
  const n = data.node;
  const ui = NODE_UI[n.type];
  const sub =
    n.type === "userTask" ? (n.formId ? "📝 formulario adjunto" : "sin formulario") :
    n.type === "serviceTask" ? (n.connectorId ? `⚙ ${n.connectorId}` : "sin conector") :
    n.type === "timer" ? (n.untilPath ? `⏱ hasta ${n.untilPath}` : `⏱ ${n.delaySeconds ?? 0}s`) :
    n.type === "subprocess" ? (n.processId ? `⤷ ${n.processId}` : "sin proceso") : "";
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
      <div style={{ fontSize: 9, textTransform: "uppercase", color: ui.color, fontWeight: 700, letterSpacing: 0.5 }}>{NODE_TYPE_ES[n.type] ?? n.type}</div>
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
  const [descCfg, setDescCfg] = useState({ baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001", apiKey: "" });
  const [description, setDescription] = useState("");
  const [descBusy, setDescBusy] = useState(false);
  const [descErr, setDescErr] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [chat, setChat] = useState<{ role: "user" | "agent"; text: string }[]>([
    { role: "agent", text: "¡Hola! Describí el flujo que querés — por ej. \"una pre-aprobación de hipoteca que pide ingresos y valor de la propiedad, corre un análisis de capacidad de pago y después aprueba o pide más info.\" Lo construyo en el canvas y podés seguir ajustándolo." },
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
  const [helpOpen, setHelpOpen] = useState(false);

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
    if (publish && r.ok) { setErrors([]); setMsg(`Publicado v${r.data.version} ✓ — abrí Ejecutar para probarlo`); }
    else if (publish) setErrors(r.data.errors ?? ["No se pudo publicar"]);
    else { setErrors(r.data.errors ?? []); setMsg("Borrador guardado"); }
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
    if (!r.ok) { setMsg("No se pudo exportar"); return; }
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${DEF_ID}.cassiopeia.json`; a.click();
    URL.revokeObjectURL(url);
    setMsg("Paquete de flujo exportado (JSON)");
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
    else setGovMsg(r.data?.error ?? "Crear un disparador necesita admin");
  }
  async function delTrigger(token: string) {
    await api(`/definitions/${DEF_ID}/triggers/${token}`, { method: "DELETE" });
    setTriggers((ts) => ts.filter((t) => t.token !== token));
  }
  async function addSchedule() {
    const r = await api(`/definitions/${DEF_ID}/schedules`, { method: "POST", body: JSON.stringify({ intervalSeconds: Math.max(1, newSchedMin) * 60, label: "recurring" }) });
    if (r.ok) setSchedules((await api(`/definitions/${DEF_ID}/schedules`)).data);
    else setGovMsg(r.data?.error ?? "No se pudo crear la programación");
  }
  async function delSchedule(id: string) {
    await api(`/definitions/${DEF_ID}/schedules/${id}`, { method: "DELETE" });
    setSchedules((ss) => ss.filter((s) => s.id !== id));
  }
  async function restoreVersion(v: number) {
    await api(`/definitions/${DEF_ID}/restore/${v}`, { method: "POST" });
    await reloadCanvas();
    setGovMsg(`Restaurada la v${v} en el borrador de trabajo`);
  }
  async function importWorkflow() {
    let bundle: any;
    try { bundle = JSON.parse(importText); } catch { setGovMsg("JSON inválido"); return; }
    const r = await api(`/definitions/import`, { method: "POST", body: JSON.stringify({ ...bundle, targetId: DEF_ID }) });
    if (r.ok) { await reloadCanvas(); await reloadForms(); await reloadConnectors(); setGovMsg("Importado en este flujo ✓"); }
    else setGovMsg(r.data?.error ?? "No se pudo importar");
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
    if (d) setDescCfg({ baseUrl: d.config.baseUrl ?? "", model: d.config.model ?? "claude-haiku-4-5-20251001", apiKey: d.config.apiKey ?? "" });
    setDescOpen(true);
  }
  async function saveDescriber() {
    await api(`/connectors`, { method: "POST", body: JSON.stringify({ id: "describer", type: "ai-agent", config: { ...descCfg, jsonOutput: false } }) });
    setDescErr(""); setMsg("Modelo de descripción guardado");
  }
  async function generateDescription() {
    setDescBusy(true); setDescErr(""); setDescription("");
    // publish current design first so the description reflects what's on screen
    await api(`/definitions/${DEF_ID}/draft`, { method: "POST", body: JSON.stringify(toDefinition()) });
    const r = await api(`/definitions/${DEF_ID}/describe`, { method: "POST", body: JSON.stringify(descCfg) });
    setDescBusy(false);
    if (r.ok) setDescription(r.data.description);
    else setDescErr(r.data.error ?? "No se pudo generar la descripción");
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
      const madeNote = created.length ? `\n\nSe ${created.length > 1 ? "crearon conectores" : "creó el conector"}: ${created.map((c) => `${c.id} (${c.type})`).join(", ")} — cargá las claves en Ajustes.` : "";
      const errs = (r.data.errors ?? []) as string[];
      const note = errs.length ? `\n\n⚠ Hay que corregir antes de publicar: ${errs.join("; ")}` : "";
      setChat((c) => [...c, { role: "agent", text: (r.data.reply || "Listo.") + madeNote + note }]);
    } else {
      setChat((c) => [...c, { role: "agent", text: `Perdón — ${r.data.error ?? "algo salió mal."}` }]);
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
    setMsg(`Conector ${c.id} guardado`);
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
    try { input = JSON.parse(testInput); } catch { setTestOut("JSON inválido"); return; }
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
        <div style={{ flex: 1 }} />
        <button style={S.aiBtn} onClick={() => setAiOpen(true)}>✦ Construir con IA</button>
        <button style={S.describe} onClick={openDescribe}>✦ Describir</button>
        <button style={S.ghost} onClick={autoLayout} title="Ordenar el diagrama">⤢ Ordenar</button>
        <button style={S.ghost} onClick={openGov}>Gestionar</button>
        <button style={S.ghost} onClick={exportWorkflow}>Exportar</button>
        <button style={S.ghost} onClick={() => setHelpOpen(true)} title="Ayuda">? Ayuda</button>
        <button style={S.ghost} onClick={() => persist(false)}>Guardar borrador</button>
        <button style={S.ghost} onClick={() => persist(true)}>Publicar</button>
        <button style={S.run} onClick={publishAndRun}>▶ Ejecutar</button>
      </div>

      {msg && <div style={S.okBar}>{msg}</div>}
      {errors.length > 0 && <div style={S.errBar}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        {/* ---- node toolbox ---- */}
        <div style={S.toolbox}>
          <div className="eyebrow" style={{ padding: "2px 4px 8px" }}>Nodos</div>
          {TOOLBOX.map((n) => (
            <button key={n.type} className="nav-item tool-row" style={S.toolItem} onClick={() => addNode(n.type as any)}>
              <span style={{ ...S.toolDot, background: n.color }}>{n.icon}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{n.label}</span>
              <span style={S.infoDot} aria-hidden>i</span>
              <span className="tool-tip">
                <b style={{ display: "block", marginBottom: 3 }}>{n.label}</b>
                {n.help}
              </span>
            </button>
          ))}
          <p style={{ ...S.hint, padding: "6px 4px 0", margin: 0 }}>Pasá el mouse por la <b>i</b> para ver qué hace cada nodo.</p>
        </div>

        <div style={{ flex: 1, height: "calc(100vh - 210px)", minHeight: 480, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface-2)" }}>
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

        {sel && (
        <div style={S.panel}>
          {selNode && (
            <div>
              <h3 style={S.h3}>{NODE_TYPE_ES[selNode.type] ?? selNode.type}</h3>
              {selNode.type !== "start" && selNode.type !== "end" && (
                <>
                  <L>Nombre</L>
                  <input style={S.input} value={(selNode as any).name} onChange={(e) => updateNode(selNode.id, { name: e.target.value } as any)} />
                </>
              )}

              {selNode.type === "userTask" && (
                <>
                  <L>Formulario adjunto</L>
                  <select style={S.input} value={selNode.formId ?? ""} onChange={(e) => updateNode(selNode.id, { formId: e.target.value } as any)}>
                    <option value="">(ninguno)</option>
                    {forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                  </select>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {selNode.formId ? (
                      <button style={S.primary} onClick={() => setFormDrawerId(selNode.formId!)}>Diseñar este formulario →</button>
                    ) : (
                      <button style={S.primary} onClick={() => createFormForTask(selNode)}>Crear y diseñar formulario →</button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <L>Asignado a</L>
                      <input style={S.input} placeholder="sin asignar"
                        value={(selNode as any).assignee ?? ""}
                        onChange={(e) => updateNode(selNode.id, { assignee: e.target.value || undefined } as any)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <L>Rol</L>
                      <input style={S.input} placeholder="ej. analista"
                        value={(selNode as any).candidateRole ?? ""}
                        onChange={(e) => updateNode(selNode.id, { candidateRole: e.target.value || undefined } as any)} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <L>Prioridad</L>
                      <select style={S.input} value={(selNode as any).priority ?? "normal"}
                        onChange={(e) => updateNode(selNode.id, { priority: e.target.value === "normal" ? undefined : e.target.value } as any)}>
                        <option value="low">baja</option>
                        <option value="normal">normal</option>
                        <option value="high">alta</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <L>SLA (horas)</L>
                      <input style={S.input} type="number" min={0} placeholder="ninguno"
                        value={(selNode as any).slaHours ?? ""}
                        onChange={(e) => updateNode(selNode.id, { slaHours: e.target.value.trim() === "" ? undefined : Math.max(0, Number(e.target.value) || 0) } as any)} />
                    </div>
                  </div>
                  <p style={S.hint}>Define el orden, los filtros y los avisos de vencimiento en la Bandeja.</p>
                </>
              )}

              {selNode.type === "timer" && (
                <>
                  <L>Esperar (segundos)</L>
                  <input style={S.input} type="number" min={0} placeholder="60"
                    value={(selNode as any).delaySeconds ?? ""}
                    onChange={(e) => updateNode(selNode.id, { delaySeconds: e.target.value.trim() === "" ? undefined : Math.max(0, Number(e.target.value) || 0) } as any)} />
                  <L>…o esperar hasta (fecha en el contexto)</L>
                  <input style={S.input} placeholder="ej. appointment.date"
                    value={(selNode as any).untilPath ?? ""}
                    onChange={(e) => updateNode(selNode.id, { untilPath: e.target.value || undefined } as any)} />
                  <p style={S.hint}>El motor se detiene acá; un planificador reanuda la ejecución cuando pasa el tiempo. Si se resuelve una fecha, tiene prioridad sobre el retardo fijo.</p>
                </>
              )}

              {selNode.type === "subprocess" && (
                <>
                  <L>Subproceso</L>
                  <select style={S.input} value={(selNode as any).processId ?? ""} onChange={(e) => updateNode(selNode.id, { processId: e.target.value } as any)}>
                    <option value="">(elegí un proceso)</option>
                    {allDefs.filter((d) => d.id !== DEF_ID).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <p style={S.hint}>Ejecuta otro proceso hasta el final y combina su resultado. Debe ser totalmente automático (sin tareas humanas).</p>
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

              {selNode.type === "gateway" && <p style={S.hint}>Definí las condiciones en las aristas que salen de esta decisión (hacé click en una arista).</p>}
              <button style={S.danger} onClick={deleteSelected}>Eliminar nodo</button>
            </div>
          )}

          {selEdge && (
            <div>
              <h3 style={S.h3}>Conexión</h3>
              <p style={S.hint}>{selEdge.source} → {selEdge.target}</p>
              {selEdgeFromGateway ? (
                <>
                  <L>Condición (cuándo)</L>
                  <input style={S.input} placeholder="ej. riskScore > 0.7" value={(selEdge.data?.when as string) ?? ""} onChange={(e) => updateEdge(selEdge.id, { when: e.target.value })} disabled={Boolean(selEdge.data?.isDefault)} />
                  <label style={S.check}>
                    <input type="checkbox" checked={Boolean(selEdge.data?.isDefault)} onChange={(e) => updateEdge(selEdge.id, { isDefault: e.target.checked }, selEdge.source)} />
                    Rama por defecto
                  </label>
                </>
              ) : <p style={S.hint}>Solo las aristas que salen de una decisión llevan condiciones.</p>}
              <button style={S.danger} onClick={deleteSelected}>Eliminar arista</button>
            </div>
          )}
        </div>
        )}
      </div>

      {helpOpen && (
        <>
          <div style={S.backdrop} onClick={() => setHelpOpen(false)} />
          <div style={{ ...S.modal, width: "min(560px, 94vw)", height: "auto", maxHeight: "84vh" }}>
            <div style={S.modalHead}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Cómo construir tu proceso</span>
              <button style={S.ghost} onClick={() => setHelpOpen(false)}>Cerrar</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto" }}>
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8, fontSize: 14 }}>
                <li>Agregá nodos desde el <b>toolbox</b> de la izquierda.</li>
                <li>Arrastrá desde el punto derecho de un nodo hasta el siguiente para conectarlos.</li>
                <li>Hacé click en una <span style={{ color: "#2563eb", fontWeight: 700 }}>Tarea humana</span> para adjuntar y diseñar su formulario.</li>
                <li>Hacé click en una <span style={{ color: "#7c3aed", fontWeight: 700 }}>Tarea de servicio</span> para elegir y configurar un conector (API o agente IA).</li>
                <li>Hacé click en una arista que sale de una <span style={{ color: "#d97706", fontWeight: 700 }}>Decisión</span> para poner su condición.</li>
                <li><b>Publicá</b>, después abrí <b>Ejecutar</b> para probarlo. Usá <b>⤢ Ordenar</b> para acomodar el diagrama.</li>
              </ol>
            </div>
          </div>
        </>
      )}

      {formDrawerId && (
        <>
          <div style={S.backdrop} onClick={() => { setFormDrawerId(null); reloadForms(); }} />
          <div style={S.drawer}>
            <div style={S.drawerHead}>
              <span style={{ fontWeight: 700 }}>Formulario de: {selNode && (selNode as any).name}</span>
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
              <span style={{ fontWeight: 700, fontSize: 16 }}>▶ Ejecutar: {name}</span>
              <button style={S.ghost} onClick={() => setRunOpen(false)}>Cerrar</button>
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
              <span style={{ fontWeight: 700, fontSize: 16 }}>Gestionar: {name}</span>
              <button style={S.ghost} onClick={() => setGovOpen(false)}>Cerrar</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(["versions", "data", "automation", "import"] as const).map((t) => (
                  <button key={t} onClick={() => setGovTab(t)} style={govTab === t ? S.tabActive : S.tab}>
                    {t === "versions" ? "Historial de versiones" : t === "data" ? "Diccionario de datos" : t === "automation" ? "Automatización" : "Importar"}
                  </button>
                ))}
              </div>
              {govMsg && <div style={S.okMsg}>{govMsg}</div>}

              {govTab === "versions" && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ color: "#64748b", textAlign: "left" }}>
                    <th style={S.gth}>Versión</th><th style={S.gth}>Estado</th><th style={S.gth}>Nodos</th><th style={S.gth}>Aristas</th><th style={S.gth}></th>
                  </tr></thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.version} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={S.gtd}>v{v.version}</td><td style={S.gtd}>{v.status}</td><td style={S.gtd}>{v.nodeCount}</td><td style={S.gtd}>{v.edgeCount}</td>
                        <td style={S.gtd}><button style={S.ghost} onClick={() => restoreVersion(v.version)}>Restaurar al borrador</button></td>
                      </tr>
                    ))}
                    {versions.length === 0 && <tr><td style={S.gtd} colSpan={5}>Todavía no hay versiones publicadas — publicá para crear la v1.</td></tr>}
                  </tbody>
                </table>
              )}

              {govTab === "data" && dataDict && (
                <>
                  {dataDict.warnings.map((w, i) => <div key={i} style={S.warn}>⚠ {w}</div>)}
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ color: "#64748b", textAlign: "left" }}>
                      <th style={S.gth}>Clave de contexto</th><th style={S.gth}>Producida por</th><th style={S.gth}>Consumida por</th>
                    </tr></thead>
                    <tbody>
                      {dataDict.entries.map((e) => (
                        <tr key={e.key} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={S.gtd}><code>{e.key}</code></td>
                          <td style={S.gtd}>{e.producedBy.join(", ") || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                          <td style={S.gtd}>{e.consumedBy.join(", ") || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                        </tr>
                      ))}
                      {dataDict.entries.length === 0 && <tr><td style={S.gtd} colSpan={3}>Todavía no hay claves de contexto.</td></tr>}
                    </tbody>
                  </table>
                </>
              )}

              {govTab === "automation" && (
                <>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Disparadores webhook</div>
                  <p style={S.hint}>Hacé un POST de JSON a la URL del disparador para iniciar este flujo — el cuerpo se vuelve el contexto inicial. No requiere login (el token lo autoriza). Crear un disparador necesita permisos de admin.</p>
                  {triggers.map((t) => (
                    <div key={t.token} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <input readOnly style={{ ...S.input, flex: 1, fontFamily: "monospace", fontSize: 11 }} value={`${location.origin}/api/hooks/${t.token}`} onFocus={(e) => e.currentTarget.select()} />
                      <span style={S.hint}>{t.label}</span>
                      <button style={S.ghost} onClick={() => delTrigger(t.token)}>✕</button>
                    </div>
                  ))}
                  <button style={S.ghost} onClick={addTrigger}>+ Disparador webhook</button>

                  <div className="eyebrow" style={{ margin: "16px 0 4px" }}>Programaciones</div>
                  <p style={S.hint}>Iniciá este flujo automáticamente cada cierto intervalo.</p>
                  {schedules.map((s) => (
                    <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 13 }}>
                      <span>Cada <b>{Math.round(s.intervalSeconds / 60)}</b> min {s.label ? `· ${s.label}` : ""}</span>
                      <span style={S.hint}>próxima {new Date(s.nextRun).toLocaleTimeString()}</span>
                      <button style={S.ghost} onClick={() => delSchedule(s.id)}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                    Cada <input type="number" min={1} style={{ ...S.input, width: 80 }} value={newSchedMin} onChange={(e) => setNewSchedMin(Number(e.target.value) || 1)} /> minutos
                    <button style={S.ghost} onClick={addSchedule}>+ Programación</button>
                  </div>
                </>
              )}

              {govTab === "import" && (
                <>
                  <p style={S.hint}>Pegá un paquete de flujo de Cassiopeia (desde Exportar). Se importa en <b>{DEF_ID}</b> como borrador; los conectores existentes conservan sus claves.</p>
                  <textarea style={{ ...S.input, height: 220, fontFamily: "monospace" }} placeholder='{"cassiopeia":"workflow-bundle", ...}' value={importText} onChange={(e) => setImportText(e.target.value)} />
                  <button style={S.primary} onClick={importWorkflow}>Importar paquete</button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {aiOpen && (
        <div style={S.aiDrawer}>
          <div style={S.drawerHead}>
            <span style={{ fontWeight: 700 }}>✦ Construir con IA</span>
            <button style={S.ghost} onClick={() => setAiOpen(false)}>Cerrar</button>
          </div>
          <div style={S.chatScroll}>
            {chat.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <div style={m.role === "user" ? S.bubbleUser : S.bubbleAgent}>{m.text}</div>
              </div>
            ))}
            {aiBusy && <div style={{ ...S.bubbleAgent, color: "#64748b" }}>Diseñando el flujo…</div>}
          </div>
          <div style={S.chatInputRow}>
            <textarea
              style={S.chatInput}
              placeholder="Describí o modificá el flujo…"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAi(); } }}
            />
            <button style={S.primary} disabled={aiBusy} onClick={sendAi}>Enviar</button>
          </div>
        </div>
      )}

      {descOpen && (
        <>
          <div style={S.backdrop} onClick={() => setDescOpen(false)} />
          <div style={{ ...S.modal, width: "min(760px, 94vw)", height: "auto", maxHeight: "88vh" }}>
            <div style={S.modalHead}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>✦ Descripción del proceso: {name}</span>
              <button style={S.ghost} onClick={() => setDescOpen(false)}>Cerrar</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto" }}>
              <div style={S.descSettings}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div style={{ flex: "1 1 160px" }}>
                    <L>Modelo</L>
                    <input style={S.input} value={descCfg.model} onChange={(e) => setDescCfg({ ...descCfg, model: e.target.value })} />
                  </div>
                  <div style={{ flex: "2 1 240px" }}>
                    <L>URL base <span style={S.hint}>compatible con OpenAI</span></L>
                    <input style={S.input} value={descCfg.baseUrl} onChange={(e) => setDescCfg({ ...descCfg, baseUrl: e.target.value })} />
                  </div>
                  <div style={{ flex: "1 1 160px" }}>
                    <L>Clave de API</L>
                    <input style={S.input} type="password" value={descCfg.apiKey} onChange={(e) => setDescCfg({ ...descCfg, apiKey: e.target.value })} />
                  </div>
                  <button style={S.ghost} onClick={saveDescriber}>Guardar</button>
                </div>
                <p style={{ ...S.hint, marginTop: 8 }}>Por defecto usa Claude Haiku — cambiá el modelo/URL/clave para cualquier proveedor compatible con OpenAI.</p>
              </div>

              <button style={{ ...S.primary, marginTop: 14 }} disabled={descBusy} onClick={generateDescription}>
                {descBusy ? "Leyendo el flujo…" : "Generar descripción"}
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
      <L>Conector</L>
      <select style={S.input} value={node.connectorId ?? ""} onChange={(e) => onPick(e.target.value)}>
        <option value="">(ninguno)</option>
        {connectors.map((x) => <option key={x.id} value={x.id}>{x.id} ({x.type})</option>)}
      </select>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <button style={S.ghost} onClick={() => onNew("ai-agent")}>+ Agente IA</button>
        <button style={S.ghost} onClick={() => onNew("maverick-agent")}>+ Maverick</button>
        <button style={S.ghost} onClick={() => onNew("mcp")}>+ MCP</button>
      </div>

      {c && c.type === "mcp" && (
        <>
          <L>URL del servidor MCP</L>
          <input style={S.input} value={c.config.url ?? ""} onChange={(e) => setCfg(c.id, "url", e.target.value)} />
          <L>Clave de API <span style={S.hint}>opcional</span></L>
          <input style={S.input} type="password" value={c.config.apiKey ?? ""} onChange={(e) => setCfg(c.id, "apiKey", e.target.value)} />
          <L>Herramienta</L>
          <McpToolPicker url={c.config.url} apiKey={c.config.apiKey} value={c.config.toolName} onChange={(v) => setCfg(c.id, "toolName", v)} />
        </>
      )}

      {c && c.type === "maverick-agent" && (
        <>
          <L>URL base de Maverick</L>
          <input style={S.input} value={c.config.baseUrl ?? ""} onChange={(e) => setCfg(c.id, "baseUrl", e.target.value)} />
          <L>Clave de API</L>
          <input style={S.input} type="password" value={c.config.apiKey ?? ""} onChange={(e) => setCfg(c.id, "apiKey", e.target.value)} />
          <L>ID del agente</L>
          <input style={S.input} value={c.config.agentId ?? ""} onChange={(e) => setCfg(c.id, "agentId", e.target.value)} />
        </>
      )}

      {c && c.type === "ai-agent" && (
        <>
          <L>URL base <span style={S.hint}>compatible con OpenAI</span></L>
          <input style={S.input} value={c.config.baseUrl ?? ""} onChange={(e) => setCfg(c.id, "baseUrl", e.target.value)} />
          <L>Clave de API</L>
          <input style={S.input} type="password" value={c.config.apiKey ?? ""} onChange={(e) => setCfg(c.id, "apiKey", e.target.value)} />
          <L>Modelo</L>
          <input style={S.input} value={c.config.model ?? ""} onChange={(e) => setCfg(c.id, "model", e.target.value)} />
          <L>Instrucciones</L>
          <textarea style={{ ...S.input, height: 70 }} value={c.config.instructions ?? ""} onChange={(e) => setCfg(c.id, "instructions", e.target.value)} />
        </>
      )}
      {c && c.type === "http" && (
        <>
          <L>URL</L>
          <input style={S.input} value={c.config.url ?? ""} onChange={(e) => setCfg(c.id, "url", e.target.value)} />
        </>
      )}
      {c && c.type.startsWith("mock") && <p style={S.hint}>Conector de prueba incorporado — sin configuración.</p>}

      {c && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {!c.type.startsWith("mock") && <button style={S.ghost} onClick={() => onSave(c)}>Guardar conector</button>}
          </div>
          <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
            <L>Datos de prueba (JSON)</L>
            <textarea style={{ ...S.input, height: 48, fontFamily: "monospace" }} value={testInput} onChange={(e) => setTestInput(e.target.value)} />
            <button style={S.ghost} onClick={() => onTest(c.id)}>Probar</button>
            {testOut && <pre style={S.pre}>{testOut}</pre>}
          </div>
        </>
      )}

      <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
        <L>Resiliencia</L>
        <p style={S.hint}>Reintentá un conector inestable, limitá cuánto puede tardar y elegí a dónde va una falla definitiva.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <L>Reintentos</L>
            <input style={S.input} type="number" min={0} value={node.retries ?? ""} placeholder="0"
              onChange={(e) => onPatch({ retries: num(e.target.value) } as any)} />
          </div>
          <div style={{ flex: 1 }}>
            <L>Espera (ms)</L>
            <input style={S.input} type="number" min={0} value={node.retryDelayMs ?? ""} placeholder="500"
              onChange={(e) => onPatch({ retryDelayMs: num(e.target.value) } as any)} />
          </div>
          <div style={{ flex: 1 }}>
            <L>Tiempo límite (ms)</L>
            <input style={S.input} type="number" min={0} value={node.timeoutMs ?? ""} placeholder="ninguno"
              onChange={(e) => onPatch({ timeoutMs: num(e.target.value) } as any)} />
          </div>
        </div>
        <L>Si falla</L>
        <select style={S.input} value={node.onErrorEdgeId ?? ""} onChange={(e) => onPatch({ onErrorEdgeId: e.target.value || undefined } as any)}>
          <option value="">Fallar la instancia</option>
          {outEdges.map((e) => <option key={e.id} value={e.id}>Ir hacia → {e.toName}</option>)}
        </select>
        {node.onErrorEdgeId && <p style={S.hint}>Ante un error, la ejecución continúa por esta arista con la falla en <code>error</code>.</p>}
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
        Fan-out: ejecutar una vez por cada ítem de una colección
      </label>
      {mi && (
        <>
          <L>Ruta de la colección</L>
          <input style={S.input} value={mi.collectionPath ?? ""} placeholder="ej. applicants" onChange={(e) => onChange({ ...mi, collectionPath: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><L>Clave del ítem</L><input style={S.input} value={mi.itemKey ?? ""} placeholder="item" onChange={(e) => onChange({ ...mi, itemKey: e.target.value })} /></div>
            <div style={{ flex: 1 }}><L>Ruta de resultados</L><input style={S.input} value={mi.resultPath ?? ""} placeholder="results" onChange={(e) => onChange({ ...mi, resultPath: e.target.value })} /></div>
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
  panel: { width: 320, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--surface)", color: "var(--text)", maxHeight: "calc(100vh - 210px)", minHeight: 480, overflowY: "auto" },
  toolbox: { width: 168, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 12, padding: 8, background: "var(--surface)", display: "flex", flexDirection: "column", gap: 3, height: "fit-content" },
  toolItem: { display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", border: 0, background: "transparent", borderRadius: 9, padding: "8px 8px", cursor: "pointer", color: "var(--text)" },
  toolDot: { width: 26, height: 26, borderRadius: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 13, flexShrink: 0 },
  infoDot: { width: 16, height: 16, borderRadius: 999, border: "1px solid var(--border-strong)", color: "var(--text-faint)", fontSize: 10, fontWeight: 800, fontStyle: "italic", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "Georgia, serif" },
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
