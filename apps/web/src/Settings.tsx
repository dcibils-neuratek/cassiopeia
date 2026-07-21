import { useEffect, useState } from "react";
import { api } from "./api.js";
import { McpToolPicker } from "./McpToolPicker.js";
import { THEMES, getTheme, setTheme } from "./theme.js";

type Connector = { id: string; type: string; config: Record<string, any> };

export function Settings() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [describer, setDescriber] = useState<Connector>({ id: "describer", type: "ai-agent", config: { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001", apiKey: "", jsonOutput: false } });
  const [selId, setSelId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [testInput, setTestInput] = useState('{ "income": 1200 }');
  const [testOut, setTestOut] = useState("");
  const [users, setUsers] = useState<{ id: string; username: string; displayName: string; role: string }[]>([]);
  const [audit, setAudit] = useState<{ ts: string; actor: string; action: string; target: string | null }[]>([]);
  const [nu, setNu] = useState({ username: "", password: "", displayName: "", role: "operator" });
  const [theme, setThemeState] = useState(getTheme());
  function pickTheme(id: string) { setTheme(id); setThemeState(id); }

  async function reload() {
    const r = await api("/connectors");
    setConnectors(r.data);
    const d = (r.data as Connector[]).find((c) => c.id === "describer");
    if (d) setDescriber(d);
  }
  async function loadAdmin() {
    const u = await api("/auth/users"); if (u.ok) setUsers(u.data);
    const a = await api("/audit"); if (a.ok) setAudit(a.data);
  }
  useEffect(() => { reload(); loadAdmin(); }, []);

  async function addUser() {
    const r = await api("/auth/users", { method: "POST", body: JSON.stringify(nu) });
    if (r.ok) { setNu({ username: "", password: "", displayName: "", role: "operator" }); setMsg(`Usuario ${r.data.user.username} creado`); loadAdmin(); }
    else setMsg(r.data?.error ?? "No se pudo crear el usuario");
  }

  async function save(c: Connector, note: string) {
    await api("/connectors", { method: "POST", body: JSON.stringify(c) });
    setMsg(note);
    reload();
  }
  function newConnector(type: string) {
    const prefix = type === "maverick-agent" ? "mav" : type === "mcp" ? "mcp" : type === "http" ? "http" : type === "async-callback" ? "async" : "ai";
    const id = `${prefix}_${Math.random().toString(36).slice(2, 6)}`;
    const config = type === "maverick-agent" ? { baseUrl: "https://your-maverick-host", apiKey: "", agentId: "" }
      : type === "mcp" ? { url: "https://your-mcp-server/mcp", toolName: "", apiKey: "" }
      : type === "http" ? { url: "", method: "POST" }
      : type === "async-callback" ? { url: "https://your-async-service/kickoff", callbackBaseUrl: "http://localhost:3001/callbacks" }
      : { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", apiKey: "", instructions: "You are a task agent inside a business process.", jsonOutput: true };
    const c = { id, type, config };
    setConnectors((cs) => [...cs, c]);
    setSelId(id);
  }
  const setCfg = (id: string, k: string, v: any) => setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, config: { ...c.config, [k]: v } } : c)));
  async function test(id: string) {
    let input: any = {}; try { input = JSON.parse(testInput); } catch { setTestOut("Invalid JSON"); return; }
    setTestOut(JSON.stringify((await api(`/connectors/${id}/test`, { method: "POST", body: JSON.stringify(input) })).data, null, 2));
  }

  const sel = connectors.find((c) => c.id === selId);

  return (
    <div style={{ maxWidth: 900 }}>
      {/* ---- Appearance / themes ---- */}
      <section style={S.card}>
        <h2 style={S.h2}>Apariencia</h2>
        <p style={S.hint}>Elegí la paleta de colores de toda la app.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginTop: 12 }}>
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => pickTheme(t.id)}
              style={{ textAlign: "left", cursor: "pointer", padding: 12, borderRadius: 12, background: "var(--surface)", border: theme === t.id ? "2px solid var(--primary)" : "1px solid var(--border)", boxShadow: theme === t.id ? "var(--shadow-md)" : "var(--shadow-sm)" }}>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                {t.swatch.map((c, i) => <div key={i} style={{ flex: 1, height: 26, borderRadius: 5, background: c, border: "1px solid rgba(0,0,0,0.06)" }} />)}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</span>
                {theme === t.id && <span style={{ fontSize: 11, color: "var(--primary)", fontWeight: 700 }}>✓ Activo</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ---- Users & access ---- */}
      <section style={{ ...S.card, marginTop: 18 }}>
        <h2 style={S.h2}>Usuarios y acceso</h2>
        <p style={S.hint}>Los roles son jerárquicos: <b>viewer</b> → <b>operator</b> (ejecutar/bandeja) → <b>analyst</b> (diseñar) → <b>admin</b> (ajustes/usuarios).</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
            <th style={S.th}>Usuario</th><th style={S.th}>Nombre de usuario</th><th style={S.th}>Rol</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={S.td}>{u.displayName}</td><td style={S.td}><code>{u.username}</code></td>
                <td style={S.td}><span style={S.rolePill}>{u.role}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div style={{ flex: "1 1 130px" }}><L>Nombre de usuario</L><input style={S.input} value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} /></div>
          <div style={{ flex: "1 1 130px" }}><L>Nombre visible</L><input style={S.input} value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} /></div>
          <div style={{ flex: "1 1 120px" }}><L>Contraseña</L><input style={S.input} type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></div>
          <div style={{ flex: "1 1 110px" }}><L>Rol</L>
            <select style={S.input} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
              {["viewer", "operator", "analyst", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button style={S.primary} onClick={addUser}>Agregar usuario</button>
        </div>
      </section>

      {/* ---- LLM keys ---- */}
      <section style={{ ...S.card, marginTop: 18 }}>
        <h2 style={S.h2}>Modelo de IA de la plataforma (LLM)</h2>
        <p style={S.hint}>Impulsa <b>✦ Describir</b>, <b>✦ Construir con IA</b> y el <b>analista de procesos IA</b>. Por defecto usa Claude vía el endpoint compatible con OpenAI de Anthropic; sirve cualquier proveedor compatible con OpenAI. La clave se guarda <b>encriptada</b> y se muestra enmascarada — dejala en blanco para conservar la almacenada.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          <div style={{ flex: "1 1 200px" }}><L>Modelo</L><input style={S.input} value={describer.config.model ?? ""} onChange={(e) => setDescriber({ ...describer, config: { ...describer.config, model: e.target.value } })} /></div>
          <div style={{ flex: "2 1 240px" }}><L>URL base</L><input style={S.input} value={describer.config.baseUrl ?? ""} onChange={(e) => setDescriber({ ...describer, config: { ...describer.config, baseUrl: e.target.value } })} /></div>
          <div style={{ flex: "1 1 160px" }}><L>Clave de API</L><input style={S.input} type="password" placeholder="se conserva si lo dejás en blanco" value={describer.config.apiKey ?? ""} onChange={(e) => setDescriber({ ...describer, config: { ...describer.config, apiKey: e.target.value } })} /></div>
          <button style={S.primary} onClick={() => save({ ...describer, type: "ai-agent", config: { ...describer.config, jsonOutput: false } }, "Modelo de plataforma guardado")}>Guardar</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={S.hint}>Modelos Claude:</span>
          {[["Haiku", "claude-haiku-4-5-20251001"], ["Sonnet", "claude-sonnet-5"], ["Opus", "claude-opus-4-8"]].map(([label, id]) => (
            <button key={id} style={{ ...S.ghost, ...(describer.config.model === id ? { border: "1px solid var(--primary)", background: "var(--primary-tint)" } : {}) }}
              onClick={() => setDescriber({ ...describer, config: { ...describer.config, model: id, baseUrl: "https://api.anthropic.com/v1" } })}>{label}</button>
          ))}
        </div>
      </section>

      {/* ---- Connector library ---- */}
      <section style={{ ...S.card, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={S.h2}>Librería de conectores</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={S.ghost} onClick={() => newConnector("ai-agent")}>+ AI agent</button>
            <button style={S.ghost} onClick={() => newConnector("maverick-agent")}>+ Maverick</button>
            <button style={S.ghost} onClick={() => newConnector("mcp")}>+ MCP</button>
            <button style={S.ghost} onClick={() => newConnector("http")}>+ HTTP</button>
            <button style={S.ghost} onClick={() => newConnector("async-callback")}>+ Async</button>
          </div>
        </div>
        <p style={S.hint}>Las claves de API de los conectores de agente IA y Maverick viven acá — configuralas una vez y reutilizalas en todos los flujos.</p>

        <div style={{ display: "flex", gap: 14, marginTop: 10, alignItems: "flex-start" }}>
          <div style={S.list}>
            {connectors.map((c) => (
              <button key={c.id} onClick={() => { setSelId(c.id); setTestOut(""); }} style={{ ...S.item, ...(selId === c.id ? S.itemActive : {}) }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.id}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{c.type}</div>
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }}>
            {!sel && <p style={S.hint}>Seleccioná un conector para editarlo.</p>}
            {sel && (
              <>
                {sel.type === "ai-agent" && <>
                  <L>URL base</L><input style={S.input} value={sel.config.baseUrl ?? ""} onChange={(e) => setCfg(sel.id, "baseUrl", e.target.value)} />
                  <L>Clave de API</L><input style={S.input} type="password" placeholder="se conserva si lo dejás en blanco" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
                  <L>Modelo</L><input style={S.input} value={sel.config.model ?? ""} onChange={(e) => setCfg(sel.id, "model", e.target.value)} />
                  <L>Instrucciones</L><textarea style={{ ...S.input, height: 64 }} value={sel.config.instructions ?? ""} onChange={(e) => setCfg(sel.id, "instructions", e.target.value)} />
                  <L>Herramientas <span style={S.hint}>el agente puede llamar a estos conectores mientras razona</span></L>
                  {((sel.config.tools as any[]) ?? []).map((t: any, i: number) => (
                    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input style={{ ...S.input, flex: 1 }} placeholder="nombre de la herramienta" value={t.name ?? ""} onChange={(e) => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <select style={{ ...S.input, flex: 1 }} value={t.connector ?? ""} onChange={(e) => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).map((x, j) => j === i ? { ...x, connector: e.target.value } : x))}>
                        <option value="">conector…</option>
                        {connectors.filter((c) => c.id !== sel.id).map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                      </select>
                      <button style={S.ghost} onClick={() => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  <button style={S.ghost} onClick={() => setCfg(sel.id, "tools", [...((sel.config.tools as any[]) ?? []), { name: "", connector: "" }])}>+ Tool</button>
                  <L>Claves de salida requeridas <span style={S.hint}>barrera — reintenta una vez si faltan</span></L>
                  <input style={S.input} placeholder="e.g. riskScore, decision" value={((sel.config.requiredKeys as string[]) ?? []).join(", ")} onChange={(e) => setCfg(sel.id, "requiredKeys", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
                </>}
                {sel.type === "maverick-agent" && <>
                  <L>URL base de Maverick</L><input style={S.input} value={sel.config.baseUrl ?? ""} onChange={(e) => setCfg(sel.id, "baseUrl", e.target.value)} />
                  <L>Clave de API</L><input style={S.input} type="password" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
                  <L>ID del agente</L><input style={S.input} value={sel.config.agentId ?? ""} onChange={(e) => setCfg(sel.id, "agentId", e.target.value)} />
                </>}
                {sel.type === "mcp" && <>
                  <L>URL del servidor MCP</L><input style={S.input} value={sel.config.url ?? ""} onChange={(e) => setCfg(sel.id, "url", e.target.value)} />
                  <L>Clave de API (opcional)</L><input style={S.input} type="password" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
                  <L>Herramienta</L><McpToolPicker url={sel.config.url} apiKey={sel.config.apiKey} value={sel.config.toolName} onChange={(v) => setCfg(sel.id, "toolName", v)} />
                </>}
                {sel.type === "http" && <>
                  <L>URL</L><input style={S.input} value={sel.config.url ?? ""} onChange={(e) => setCfg(sel.id, "url", e.target.value)} />
                  <L>Método</L><input style={S.input} value={sel.config.method ?? "POST"} onChange={(e) => setCfg(sel.id, "method", e.target.value)} />
                </>}
                {sel.type === "async-callback" && <>
                  <L>URL de arranque <span style={S.hint}>recibe {"{ input, callbackUrl }"}</span></L>
                  <input style={S.input} value={sel.config.url ?? ""} onChange={(e) => setCfg(sel.id, "url", e.target.value)} />
                  <L>URL base de callback</L>
                  <input style={S.input} value={sel.config.callbackBaseUrl ?? ""} onChange={(e) => setCfg(sel.id, "callbackBaseUrl", e.target.value)} />
                  <p style={S.hint}>La instancia se detiene tras el arranque y se reanuda cuando el sistema externo hace un POST del JSON de resultado a la URL de callback.</p>
                </>}
                {sel.type.startsWith("mock") && <p style={S.hint}>Conector de prueba incorporado — sin configuración.</p>}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {!sel.type.startsWith("mock") && <button style={S.primary} onClick={() => save(sel, `${sel.id} guardado`)}>Guardar</button>}
                  <button style={S.ghost} onClick={() => test(sel.id)}>Probar</button>
                </div>
                <div style={{ marginTop: 10 }}>
                  <L>Datos de prueba (JSON)</L>
                  <textarea style={{ ...S.input, height: 44, fontFamily: "monospace" }} value={testInput} onChange={(e) => setTestInput(e.target.value)} />
                  {testOut && <pre style={S.pre}>{testOut}</pre>}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---- Audit log ---- */}
      <section style={{ ...S.card, marginTop: 18 }}>
        <h2 style={S.h2}>Actividad reciente</h2>
        <p style={S.hint}>Quién hizo qué, lo más reciente primero.</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 8 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
            <th style={S.th}>Cuándo</th><th style={S.th}>Actor</th><th style={S.th}>Acción</th><th style={S.th}>Objetivo</th>
          </tr></thead>
          <tbody>
            {audit.slice(0, 40).map((a, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={S.td}>{new Date(a.ts).toLocaleString()}</td>
                <td style={S.td}><b>{a.actor}</b></td>
                <td style={S.td}><code>{a.action}</code></td>
                <td style={S.td}>{a.target ?? "—"}</td>
              </tr>
            ))}
            {audit.length === 0 && <tr><td style={S.td} colSpan={4}>Todavía no hay actividad.</td></tr>}
          </tbody>
        </table>
      </section>

      {msg && <div style={S.ok}>{msg}</div>}
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) { return <label style={S.label}>{children}</label>; }

const S: Record<string, React.CSSProperties> = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, boxShadow: "var(--shadow)" },
  h2: { fontSize: 16, fontWeight: 800, margin: 0 },
  hint: { fontSize: 12, color: "var(--text-muted)", marginTop: 6 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 10, marginBottom: 4 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13 },
  list: { width: 200, display: "flex", flexDirection: "column", gap: 6 },
  item: { textAlign: "left", border: "1px solid var(--border)", background: "white", borderRadius: 8, padding: "8px 10px", cursor: "pointer" },
  itemActive: { border: "1px solid var(--primary)", background: "var(--primary-tint)" },
  primary: { background: "var(--primary)", color: "white", border: 0, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  ghost: { background: "white", color: "var(--primary)", border: "1px solid var(--primary)", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" },
  pre: { background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 12, overflowX: "auto", marginTop: 8 },
  ok: { marginTop: 14, background: "#dcfce7", color: "#166534", padding: "8px 12px", borderRadius: 8, fontSize: 13 },
  th: { padding: "7px 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 },
  td: { padding: "7px 10px", color: "var(--text)", verticalAlign: "top" },
  rolePill: { fontSize: 11, background: "var(--primary-tint)", color: "var(--primary-strong)", borderRadius: 6, padding: "2px 8px", fontWeight: 700 },
};
