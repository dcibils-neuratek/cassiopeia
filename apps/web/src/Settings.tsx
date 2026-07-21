import { useEffect, useState } from "react";
import { api } from "./api.js";
import { THEMES, getTheme, setTheme } from "./theme.js";
import { AREA_SUGGESTIONS } from "./areas.js";

type Connector = { id: string; type: string; config: Record<string, any> };

type TabId = "appearance" | "users" | "model" | "mail" | "activity";
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "appearance", label: "Apariencia", icon: "🎨" },
  { id: "users", label: "Usuarios y acceso", icon: "👥" },
  { id: "model", label: "Modelo de IA", icon: "✦" },
  { id: "mail", label: "Correo", icon: "✉️" },
  { id: "activity", label: "Actividad", icon: "🕘" },
];

export function Settings() {
  const [describer, setDescriber] = useState<Connector>({ id: "describer", type: "ai-agent", config: { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001", apiKey: "", jsonOutput: false } });
  const [mailer, setMailer] = useState<Connector>({ id: "mailer", type: "email", config: { provider: "resend", from: "", apiKey: "", url: "", portalBase: "" } });
  const [msg, setMsg] = useState("");
  const [users, setUsers] = useState<{ id: string; username: string; displayName: string; role: string; area?: string | null }[]>([]);
  const [audit, setAudit] = useState<{ ts: string; actor: string; action: string; target: string | null }[]>([]);
  const [nu, setNu] = useState({ username: "", password: "", displayName: "", role: "operator", area: "" });
  const [theme, setThemeState] = useState(getTheme());
  function pickTheme(id: string) { setTheme(id); setThemeState(id); }
  const [tab, setTab] = useState<TabId>("appearance");

  async function reload() {
    const r = await api("/connectors");
    const list = r.data as Connector[];
    const d = list.find((c) => c.id === "describer");
    if (d) setDescriber(d);
    const m = list.find((c) => c.id === "mailer");
    if (m) setMailer({ ...m, config: { provider: "resend", from: "", url: "", portalBase: "", apiKey: "", ...m.config } });
  }
  async function loadAdmin() {
    const u = await api("/auth/users"); if (u.ok) setUsers(u.data);
    const a = await api("/audit"); if (a.ok) setAudit(a.data);
  }
  useEffect(() => { reload(); loadAdmin(); }, []);

  async function addUser() {
    const r = await api("/auth/users", { method: "POST", body: JSON.stringify(nu) });
    if (r.ok) { setNu({ username: "", password: "", displayName: "", role: "operator", area: "" }); setMsg(`Usuario ${r.data.user.username} creado`); loadAdmin(); }
    else setMsg(r.data?.error ?? "No se pudo crear el usuario");
  }

  async function save(c: Connector, note: string) {
    await api("/connectors", { method: "POST", body: JSON.stringify(c) });
    setMsg(note);
    reload();
  }

  return (
    <div style={{ maxWidth: 900 }}>
      {/* ---- tab bar ---- */}
      <div style={S.tabBar}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? undefined : "nav-item"} style={tabBtn(tab === t.id)}>
            <span style={{ fontSize: 14 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ---- Appearance / themes ---- */}
      {tab === "appearance" && (
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
      )}

      {/* ---- Users & access ---- */}
      {tab === "users" && (
      <section style={S.card}>
        <h2 style={S.h2}>Usuarios y acceso</h2>
        <p style={S.hint}>Los roles son jerárquicos: <b>viewer</b> → <b>operator</b> (ejecutar/bandeja) → <b>analyst</b> (diseñar) → <b>admin</b> (ajustes/usuarios). El <b>área</b> filtra qué tareas ve un operador en su Bandeja e Inicio.</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
            <th style={S.th}>Usuario</th><th style={S.th}>Nombre de usuario</th><th style={S.th}>Rol</th><th style={S.th}>Área</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={S.td}>{u.displayName}</td><td style={S.td}><code>{u.username}</code></td>
                <td style={S.td}><span style={S.rolePill}>{u.role}</span></td>
                <td style={S.td}>{u.area ? <span style={S.areaPill}>{u.area}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
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
          <div style={{ flex: "1 1 120px" }}><L>Área <span style={S.hint}>operadores</span></L>
            <input style={S.input} list="area-list" placeholder="ej. creditos" value={nu.area}
              disabled={nu.role === "admin" || nu.role === "analyst"}
              onChange={(e) => setNu({ ...nu, area: e.target.value })} />
          </div>
          <datalist id="area-list">{AREA_SUGGESTIONS.map((a) => <option key={a} value={a} />)}</datalist>
          <button style={S.primary} onClick={addUser}>Agregar usuario</button>
        </div>
      </section>
      )}

      {/* ---- LLM keys ---- */}
      {tab === "model" && (
      <section style={S.card}>
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
      )}

      {/* ---- Email provider ---- */}
      {tab === "mail" && (
      <section style={S.card}>
        <h2 style={S.h2}>Correo saliente</h2>
        <p style={S.hint}>Se usa para enviar recordatorios a clientes que dejaron una solicitud <b>sin completar</b>. Neutral al proveedor: <b>Mandrill</b>, <b>Resend</b>, o <b>HTTP</b> para apuntar al sistema de correo del banco. La clave se guarda <b>encriptada</b> — dejala en blanco para conservar la almacenada.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          <div style={{ flex: "1 1 140px" }}><L>Proveedor</L>
            <select style={S.input} value={mailer.config.provider ?? "resend"} onChange={(e) => setMailer({ ...mailer, config: { ...mailer.config, provider: e.target.value } })}>
              <option value="resend">Resend</option>
              <option value="mandrill">Mandrill</option>
              <option value="http">HTTP (sistema del banco)</option>
            </select>
          </div>
          <div style={{ flex: "2 1 240px" }}><L>Remitente (From)</L><input style={S.input} placeholder="Banco del Futuro &lt;noreply@tudominio.com&gt;" value={mailer.config.from ?? ""} onChange={(e) => setMailer({ ...mailer, config: { ...mailer.config, from: e.target.value } })} /></div>
          <div style={{ flex: "1 1 160px" }}><L>Clave de API</L><input style={S.input} type="password" placeholder="se conserva si lo dejás en blanco" value={mailer.config.apiKey ?? ""} onChange={(e) => setMailer({ ...mailer, config: { ...mailer.config, apiKey: e.target.value } })} /></div>
          {mailer.config.provider === "http" && (
            <div style={{ flex: "2 1 240px" }}><L>URL del servicio</L><input style={S.input} placeholder="https://correo.banco.com/send" value={mailer.config.url ?? ""} onChange={(e) => setMailer({ ...mailer, config: { ...mailer.config, url: e.target.value } })} /></div>
          )}
          <div style={{ flex: "2 1 240px" }}><L>URL del portal <span style={S.hint}>para los links de reanudación</span></L><input style={S.input} placeholder="https://banco.com" value={mailer.config.portalBase ?? ""} onChange={(e) => setMailer({ ...mailer, config: { ...mailer.config, portalBase: e.target.value } })} /></div>
          <button style={S.primary} onClick={() => save(mailer, "Configuración de correo guardada")}>Guardar</button>
        </div>
      </section>
      )}

      {/* ---- Audit log ---- */}
      {tab === "activity" && (
      <section style={S.card}>
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
      )}

      {msg && <div style={S.ok}>{msg}</div>}
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) { return <label style={S.label}>{children}</label>; }

function tabBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 7, border: "1px solid",
    borderColor: active ? "var(--primary)" : "var(--border)",
    background: active ? "var(--primary-tint)" : "var(--surface)",
    color: active ? "var(--primary-strong)" : "var(--text-muted)",
    fontWeight: active ? 700 : 600, fontSize: 13, padding: "8px 14px",
    borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap",
  };
}

const S: Record<string, React.CSSProperties> = {
  tabBar: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 },
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
  areaPill: { fontSize: 11, background: "var(--surface-3)", color: "var(--text)", borderRadius: 6, padding: "2px 8px", fontWeight: 700 },
};
