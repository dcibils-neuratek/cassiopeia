import { useEffect, useState } from "react";
import { api } from "./api.js";
import { McpToolPicker } from "./McpToolPicker.js";

type Connector = { id: string; type: string; config: Record<string, any> };

const uid = () => Math.random().toString(36).slice(2, 6);

// Integration (connector) types. "describer"/"mailer"/"automation" are platform
// connectors and live in Settings, so they're excluded from this catalog.
const TYPE_ES: Record<string, string> = {
  http: "API", "ai-agent": "Agente de IA", mcp: "MCP", "maverick-agent": "Maverick",
};
const typeLabel = (t: string) => TYPE_ES[t] ?? (t.startsWith("mock") ? "Mock" : t);

const NEW_CONFIG: Record<string, Record<string, any>> = {
  "ai-agent": { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", apiKey: "", instructions: "Sos un agente dentro de un proceso de negocio. Respondé en JSON.", jsonOutput: true },
  "maverick-agent": { baseUrl: "https://your-maverick-host", apiKey: "", agentId: "" },
  mcp: { url: "https://your-mcp-server/mcp", toolName: "", apiKey: "" },
  http: { url: "", method: "POST" },
};

// Status lives in config (no schema change). Legacy connectors have no status →
// treated as published so existing flows keep working.
const statusOf = (c: Connector) => (c.config?.status as string) ?? "published";
const nameOf = (c: Connector) => ((c.config?.label as string) || "").trim() || c.id;
const isPublished = (c: Connector) => statusOf(c) === "published";

const CLAUDE_MODELS: [string, string][] = [["Haiku", "claude-haiku-4-5-20251001"], ["Sonnet", "claude-sonnet-5"], ["Opus", "claude-opus-4-8"]];

// Standalone agent library: create and configure reusable AI agents (and other
// connectors) that flow service tasks call. One agent can power many flows.
export function Agents() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [testInput, setTestInput] = useState('{ "income": 1200 }');
  const [testOut, setTestOut] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload(selectId?: string) {
    const r = await api("/connectors");
    if (r.ok) {
      const list = (r.data as Connector[]).filter((c) => c.id !== "describer" && c.id !== "mailer" && c.id !== "automation");
      setConnectors(list);
      setSelId((cur) => selectId ?? cur ?? (list[0]?.id ?? null));
    }
  }
  useEffect(() => { reload(); }, []);

  const sel = connectors.find((c) => c.id === selId);
  const setCfg = (id: string, k: string, v: any) => setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, config: { ...c.config, [k]: v } } : c)));

  async function newIntegration(type: string) {
    const prefix = type === "maverick-agent" ? "mav" : type === "mcp" ? "mcp" : type === "http" ? "api" : "ia";
    const id = `${prefix}_${uid()}`;
    const c: Connector = { id, type, config: { ...(NEW_CONFIG[type] ?? {}), label: `Nueva integración ${typeLabel(type)}`, status: "draft" } };
    await api("/connectors", { method: "POST", body: JSON.stringify(c) });
    await reload(id);
    setTestOut(""); setMsg("");
  }
  async function save(c: Connector) {
    setBusy(true);
    try { await api("/connectors", { method: "POST", body: JSON.stringify(c) }); setMsg(`Integración guardada ✓`); await reload(c.id); }
    finally { setBusy(false); }
  }
  async function setStatus(c: Connector, status: string) {
    const updated = { ...c, config: { ...c.config, status } };
    await api("/connectors", { method: "POST", body: JSON.stringify(updated) });
    setMsg(status === "published" ? "Integración publicada ✓ — ya se puede usar en los flujos" : "Integración despublicada");
    await reload(c.id);
  }
  async function remove(c: Connector) {
    if (!window.confirm(`¿Eliminar la integración "${nameOf(c)}"?`)) return;
    const r = await api(`/connectors/${c.id}`, { method: "DELETE" });
    if (!r.ok && r.data?.usedBy) { alert(`No se puede eliminar: lo usan → ${r.data.usedBy.join(", ")}`); return; }
    const next = connectors.find((x) => x.id !== c.id)?.id ?? null;
    setSelId(next); await reload(next ?? undefined); setTestOut("");
  }
  async function test(id: string) {
    let input: any = {};
    try { input = JSON.parse(testInput); } catch { setTestOut("JSON inválido"); return; }
    setTestOut("Ejecutando…");
    const r = await api(`/connectors/${id}/test`, { method: "POST", body: JSON.stringify(input) });
    setTestOut(JSON.stringify(r.data, null, 2));
  }

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {/* ---- integration catalog ---- */}
      <div style={S.sideCard}>
        <div style={S.sideHead}>
          <span style={S.eyebrow}>Integraciones ({connectors.length})</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "10px 10px 4px" }}>
          <span style={{ ...S.hint, width: "100%", marginTop: 0 }}>+ Nueva conexión:</span>
          <button style={S.miniBtn} onClick={() => newIntegration("http")}>API</button>
          <button style={S.miniBtn} onClick={() => newIntegration("ai-agent")}>Agente de IA</button>
          <button style={S.miniBtn} onClick={() => newIntegration("mcp")}>MCP</button>
          <button style={S.miniBtn} onClick={() => newIntegration("maverick-agent")}>Maverick</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10 }}>
          {connectors.map((c) => {
            const active = selId === c.id;
            const pub = isPublished(c);
            return (
              <div key={c.id} className="hoverable" onClick={() => { setSelId(c.id); setTestOut(""); setMsg(""); }}
                style={{ cursor: "pointer", padding: "10px 12px", borderRadius: 10, border: active ? "1.5px solid var(--primary)" : "1px solid var(--border)", background: active ? "var(--primary-tint)" : "var(--surface-2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(c)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{typeLabel(c.type)}{c.config?.model ? ` · ${c.config.model}` : ""}</div>
                  </div>
                  <span style={pub ? S.pubPill : S.draftPill}>{pub ? "Publicada" : "Borrador"}</span>
                </div>
              </div>
            );
          })}
          {connectors.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Todavía no hay integraciones. Creá una arriba (API, Agente de IA o MCP).</div>}
        </div>
      </div>

      {/* ---- editor ---- */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!sel && <div style={{ ...S.card, textAlign: "center", color: "var(--text-muted)", padding: 40 }}>Seleccioná o creá una integración para configurarla.</div>}
        {sel && (
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={S.typePill}>{typeLabel(sel.type)}</span>
                  <span style={isPublished(sel) ? S.pubPill : S.draftPill}>{isPublished(sel) ? "Publicada" : "Borrador"}</span>
                  <code style={{ fontSize: 11, color: "var(--text-faint)" }}>{sel.id}</code>
                </div>
                <input style={{ ...S.input, fontSize: 17, fontWeight: 700, marginTop: 8, border: "1px solid transparent", padding: "4px 6px" }}
                  value={(sel.config.label as string) ?? ""} placeholder="Nombre de la integración"
                  onChange={(e) => setCfg(sel.id, "label", e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {isPublished(sel)
                  ? <button style={S.ghost} onClick={() => setStatus(sel, "draft")}>Despublicar</button>
                  : <button style={S.primary} onClick={() => setStatus(sel, "published")}>Publicar</button>}
                <button style={S.dangerGhost} onClick={() => remove(sel)}>Eliminar</button>
              </div>
            </div>
            <p style={S.hint}>Una conexión reutilizable a un sistema. Solo las <b>publicadas</b> aparecen en el diseñador de flujos. La clave se guarda encriptada — dejala en blanco para conservarla.</p>

            {sel.type === "ai-agent" && <>
              <div style={{ display: "flex", gap: 6, margin: "10px 0 2px", alignItems: "center", flexWrap: "wrap" }}>
                <span style={S.hint}>Modelo Claude:</span>
                {CLAUDE_MODELS.map(([label, id]) => (
                  <button key={id} style={{ ...S.chip, ...(sel.config.model === id ? S.chipActive : {}) }}
                    onClick={() => { setCfg(sel.id, "model", id); setCfg(sel.id, "baseUrl", "https://api.anthropic.com/v1"); }}>{label}</button>
                ))}
              </div>
              <L>Modelo</L><input style={S.input} value={sel.config.model ?? ""} onChange={(e) => setCfg(sel.id, "model", e.target.value)} />
              <L>URL base <span style={S.hint}>compatible con OpenAI</span></L><input style={S.input} value={sel.config.baseUrl ?? ""} onChange={(e) => setCfg(sel.id, "baseUrl", e.target.value)} />
              <L>Clave de API</L><input style={S.input} type="password" placeholder="se conserva si lo dejás en blanco" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
              <L>Instrucciones (prompt)</L><textarea style={{ ...S.input, height: 90 }} value={sel.config.instructions ?? ""} onChange={(e) => setCfg(sel.id, "instructions", e.target.value)} />
              <L>Herramientas <span style={S.hint}>el agente puede llamar a otros agentes mientras razona</span></L>
              {((sel.config.tools as any[]) ?? []).map((t: any, i: number) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input style={{ ...S.input, flex: 1 }} placeholder="nombre de la herramienta" value={t.name ?? ""} onChange={(e) => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <select style={{ ...S.input, flex: 1 }} value={t.connector ?? ""} onChange={(e) => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).map((x, j) => j === i ? { ...x, connector: e.target.value } : x))}>
                    <option value="">agente…</option>
                    {connectors.filter((c) => c.id !== sel.id).map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                  </select>
                  <button style={S.iconBtn} onClick={() => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button style={S.ghost} onClick={() => setCfg(sel.id, "tools", [...((sel.config.tools as any[]) ?? []), { name: "", connector: "" }])}>+ Herramienta</button>
              <L>Claves de salida requeridas <span style={S.hint}>barrera — reintenta una vez si faltan</span></L>
              <input style={S.input} placeholder="ej. riskScore, decision" value={((sel.config.requiredKeys as string[]) ?? []).join(", ")} onChange={(e) => setCfg(sel.id, "requiredKeys", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
            </>}

            {sel.type === "maverick-agent" && <>
              <L>URL base de Maverick</L><input style={S.input} value={sel.config.baseUrl ?? ""} onChange={(e) => setCfg(sel.id, "baseUrl", e.target.value)} />
              <L>Clave de API</L><input style={S.input} type="password" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
              <L>ID del agente</L><input style={S.input} value={sel.config.agentId ?? ""} onChange={(e) => setCfg(sel.id, "agentId", e.target.value)} />
            </>}

            {sel.type === "mcp" && <>
              <L>URL del servidor MCP</L><input style={S.input} value={sel.config.url ?? ""} onChange={(e) => setCfg(sel.id, "url", e.target.value)} />
              <L>Clave de API <span style={S.hint}>opcional</span></L><input style={S.input} type="password" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
              <L>Herramienta</L><McpToolPicker url={sel.config.url} apiKey={sel.config.apiKey} value={sel.config.toolName} onChange={(v) => setCfg(sel.id, "toolName", v)} />
            </>}

            {sel.type === "http" && <>
              <L>URL</L><input style={S.input} value={sel.config.url ?? ""} onChange={(e) => setCfg(sel.id, "url", e.target.value)} />
              <L>Método</L><input style={S.input} value={sel.config.method ?? "POST"} onChange={(e) => setCfg(sel.id, "method", e.target.value)} />
            </>}

            {sel.type.startsWith("mock") && <p style={S.hint}>Agente de prueba incorporado — sin configuración.</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {!sel.type.startsWith("mock") && <button style={S.primary} disabled={busy} onClick={() => save(sel)}>{busy ? "Guardando…" : "Guardar"}</button>}
              {msg && <span style={{ color: "#166534", fontSize: 13, alignSelf: "center" }}>{msg}</span>}
            </div>

            {/* test panel */}
            <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <div style={S.eyebrow}>Probar la integración</div>
              <L>Datos de prueba (JSON)</L>
              <textarea style={{ ...S.input, height: 54, fontFamily: "monospace" }} value={testInput} onChange={(e) => setTestInput(e.target.value)} />
              <button style={S.ghost} onClick={() => test(sel.id)}>Ejecutar prueba</button>
              {testOut && <pre style={S.pre}>{testOut}</pre>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) { return <label style={S.label}>{children}</label>; }

const S: Record<string, React.CSSProperties> = {
  sideCard: { width: 280, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow-sm)", overflow: "hidden" },
  sideHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: "1px solid var(--border)" },
  eyebrow: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700 },
  newBtn: { background: "var(--primary)", color: "var(--on-primary)", border: 0, borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  miniBtn: { background: "var(--surface)", color: "var(--primary)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "5px 9px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" },
  typePill: { fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "2px 7px", background: "var(--surface-3)", color: "var(--text-muted)", flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.3 },
  pubPill: { fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "2px 7px", background: "#dcfce7", color: "#166534", flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.3 },
  draftPill: { fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "2px 7px", background: "#fef3c7", color: "#92400e", flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.3 },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, boxShadow: "var(--shadow)" },
  hint: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginTop: 12, marginBottom: 4 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" },
  primary: { background: "var(--primary)", color: "var(--on-primary)", border: 0, borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  ghost: { background: "var(--surface)", color: "var(--primary)", border: "1px solid var(--primary)", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  dangerGhost: { background: "var(--surface)", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  iconBtn: { border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", width: 30, borderRadius: 6, cursor: "pointer", fontSize: 15 },
  chip: { border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text-muted)", borderRadius: 999, padding: "3px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  chipActive: { border: "1px solid var(--primary)", background: "var(--primary-tint)", color: "var(--primary-strong)" },
  pre: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginTop: 10 },
};
