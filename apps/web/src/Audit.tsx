import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

// Full audit trail: every action a user took on the platform, with who / what /
// when / from where (IP + browser). Admin-only (gated by the sidebar).

type Entry = { ts: string; actor: string; action: string; target: string | null; ip: string | null; userAgent: string | null };

// Map a machine action to a functionality area + a human-readable verb.
const ACTIONS: Record<string, { area: string; label: string }> = {
  login: { area: "Sesión", label: "Inició sesión" },
  logout: { area: "Sesión", label: "Cerró sesión" },
  "user.create": { area: "Usuarios", label: "Creó un usuario" },
  "user.update": { area: "Usuarios", label: "Editó un usuario" },
  "user.password": { area: "Usuarios", label: "Cambió una contraseña" },
  "user.delete": { area: "Usuarios", label: "Eliminó un usuario" },
  "draft.delete": { area: "Sin completar", label: "Eliminó un borrador" },
  "connector.save": { area: "Agentes", label: "Guardó un agente/conector" },
  "connector.delete": { area: "Agentes", label: "Eliminó un agente/conector" },
  publish: { area: "Flujos", label: "Publicó un flujo" },
  restore: { area: "Flujos", label: "Restauró una versión" },
  "definition.delete": { area: "Flujos", label: "Eliminó un flujo" },
  import: { area: "Flujos", label: "Importó un flujo" },
  "template.install": { area: "Plantillas", label: "Instaló una plantilla" },
  "form.duplicate": { area: "Formularios", label: "Duplicó un formulario" },
  "form.delete": { area: "Formularios", label: "Eliminó un formulario" },
  "task.claim": { area: "Bandeja", label: "Tomó una tarea" },
  "task.reassign": { area: "Bandeja", label: "Reasignó una tarea" },
  "task.submit": { area: "Bandeja", label: "Completó una tarea" },
  "instance.start": { area: "Operación", label: "Inició una ejecución" },
  "instance.retry": { area: "Operación", label: "Reintentó una ejecución" },
  "trigger.create": { area: "Operación", label: "Creó un trigger" },
  "schedule.create": { area: "Operación", label: "Creó un schedule" },
};
const meta = (action: string) => ACTIONS[action] ?? { area: "General", label: action };

function browser(ua: string | null): string {
  if (!ua) return "—";
  if (/edg/i.test(ua)) return "Edge";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  if (/curl/i.test(ua)) return "curl";
  return "Otro";
}
function when(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("es", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Audit() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");
  const [area, setArea] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() { const r = await api("/audit"); if (r.ok) setEntries(r.data as Entry[]); setLoading(false); }
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  const actors = useMemo(() => Array.from(new Set(entries.map((e) => e.actor))).sort(), [entries]);
  const areas = useMemo(() => Array.from(new Set(entries.map((e) => meta(e.action).area))).sort(), [entries]);

  const rows = entries.filter((e) => {
    if (who && e.actor !== who) return false;
    if (area && meta(e.action).area !== area) return false;
    if (q) {
      const hay = `${e.actor} ${e.action} ${meta(e.action).label} ${meta(e.action).area} ${e.target ?? ""} ${e.ip ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div>
      <div style={S.filters}>
        <input style={S.search} placeholder="Buscar por usuario, acción, objetivo o IP…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={S.select} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Todos los usuarios</option>
          {actors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select style={S.select} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Toda la plataforma</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span style={S.count}>{rows.length} evento{rows.length === 1 ? "" : "s"}</span>
      </div>

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Fecha y hora</th>
              <th style={S.th}>Usuario</th>
              <th style={S.th}>Funcionalidad</th>
              <th style={S.th}>Acción</th>
              <th style={S.th}>Objetivo</th>
              <th style={S.th}>IP</th>
              <th style={S.th}>Navegador</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const m = meta(e.action);
              return (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ ...S.td, ...S.mono, whiteSpace: "nowrap" }}>{when(e.ts)}</td>
                  <td style={S.td}><span style={S.actor}>{e.actor}</span></td>
                  <td style={S.td}><span style={S.pill}>{m.area}</span></td>
                  <td style={S.td}>{m.label} <code style={S.code}>{e.action}</code></td>
                  <td style={{ ...S.td, ...S.mono, color: "var(--text-muted)" }}>{e.target ?? "—"}</td>
                  <td style={{ ...S.td, ...S.mono }}>{e.ip ?? "—"}</td>
                  <td style={S.td} title={e.userAgent ?? ""}>{browser(e.userAgent)}</td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && <tr><td style={S.td} colSpan={7}>Sin eventos que coincidan.</td></tr>}
            {loading && <tr><td style={S.td} colSpan={7}>Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  filters: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 },
  search: { flex: "1 1 300px", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", fontSize: 13, background: "var(--surface)" },
  select: { border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", fontSize: 13, background: "var(--surface)" },
  count: { fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono, monospace)" },
  tableWrap: { border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", overflowX: "auto", background: "var(--surface)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 },
  th: { textAlign: "left", padding: "11px 14px", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-faint)", fontWeight: 600, background: "var(--bg)", whiteSpace: "nowrap" },
  td: { padding: "10px 14px", color: "var(--text)", verticalAlign: "top" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 },
  actor: { fontWeight: 600 },
  pill: { fontSize: 11, background: "var(--primary-tint)", color: "var(--primary-strong)", borderRadius: 6, padding: "2px 8px", fontWeight: 700, whiteSpace: "nowrap" },
  code: { fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--text-faint)", background: "var(--bg)", padding: "1px 5px", borderRadius: 4, marginLeft: 4 },
};
