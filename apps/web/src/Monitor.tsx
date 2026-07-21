import { useEffect, useRef, useState } from "react";
import { api, apiRaw } from "./api.js";

type Summary = { id: string; defId: string; processName: string; subject: string | null; status: string; outcome: string; outcomeLabel: string };
type Field = { label: string; value: string };
type Step = { ts: string; kind: string; title: string; detail?: string; actor?: string; badge?: string; fields?: Field[]; meta?: Field[] };
type CaseView = {
  instanceId: string; processName: string; status: string; outcome: string; outcomeLabel: string;
  startedAt?: string; endedAt?: string; subject?: string; data: Field[]; ai: { calls: number; tokens: number; cost: number };
  steps: Step[]; comments: { author: string; text: string; ts: string }[];
};

const STATUS_ES: Record<string, string> = { running: "en curso", waiting: "en espera", completed: "completada", failed: "fallida" };
const OUTCOME: Record<string, { bg: string; fg: string; label?: string }> = {
  approved: { bg: "#dcfce7", fg: "#166534" },
  declined: { bg: "#fee2e2", fg: "#991b1b" },
  review: { bg: "#fff4e5", fg: "#9a3412" },
  running: { bg: "#e0edff", fg: "#1e40af" },
  failed: { bg: "#fee2e2", fg: "#991b1b" },
};
const KIND: Record<string, { color: string; icon: string }> = {
  start: { color: "#94a3b8", icon: "▶" },
  human: { color: "#2563eb", icon: "👤" },
  ai: { color: "#7c3aed", icon: "🤖" },
  service: { color: "#0891b2", icon: "⚙" },
  route: { color: "#d97706", icon: "⑃" },
  timer: { color: "#0891b2", icon: "⏱" },
  pending: { color: "#0891b2", icon: "⇄" },
  callback: { color: "#0891b2", icon: "⇄" },
  escalated: { color: "#ea580c", icon: "⚠" },
  outcome: { color: "#16a34a", icon: "✓" },
  failed: { color: "#dc2626", icon: "✕" },
};

export function Monitor() {
  const [list, setList] = useState<Summary[]>([]);
  const [defs, setDefs] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [caseView, setCaseView] = useState<CaseView | null>(null);
  const [tech, setTech] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState(false);
  const openRef = useRef<string | null>(null);

  async function reloadList() { const r = await api("/executions"); if (r.ok) setList(r.data); }
  async function openCase(id: string) {
    openRef.current = id; setOpenId(id); setTech(false);
    const r = await api(`/instances/${id}/case`);
    if (r.ok) setCaseView(r.data);
  }
  function back() { openRef.current = null; setOpenId(null); setCaseView(null); }

  useEffect(() => {
    let alive = true;
    api("/definitions").then((r) => alive && r.ok && setDefs(r.data.map((d: any) => ({ id: d.id, name: d.name }))));
    const load = async () => {
      if (!alive) return;
      await reloadList();
      if (openRef.current) { const r = await api(`/instances/${openRef.current}/case`); if (alive && r.ok) setCaseView(r.data); }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function retry(id: string) { setBusy(true); try { await api(`/instances/${id}/retry`, { method: "POST" }); await openCase(id); await reloadList(); } finally { setBusy(false); } }
  async function postComment() { const t = commentText.trim(); if (!openId || !t) return; await api(`/instances/${openId}/comments`, { method: "POST", body: JSON.stringify({ text: t }) }); setCommentText(""); await openCase(openId); }
  async function downloadCsv(id: string) {
    const res = await apiRaw(`/instances/${id}/audit.csv`); const text = await res.text();
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `audit-${id.slice(0, 8)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // ---- case detail ----
  if (openId && caseView) {
    const c = caseView; const oc = OUTCOME[c.outcome] ?? OUTCOME.running;
    return (
      <div style={{ maxWidth: 860 }}>
        <button style={S.back} onClick={back}>← Todas las ejecuciones</button>
        <div style={S.caseHead}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.processName} · <code>{c.instanceId.slice(0, 8)}</code></div>
            <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>{c.subject ?? "Solicitud"}</h2>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {c.ai.calls > 0 && <span style={S.aiChip}>🤖 {c.ai.calls} IA · {c.ai.tokens.toLocaleString()} tok · ${c.ai.cost.toFixed(4)}</span>}
            <span style={{ ...S.outcome, background: oc.bg, color: oc.fg }}>{c.outcomeLabel}</span>
          </div>
        </div>
        {c.status === "failed" && (
          <div style={S.failBox}>⚠ Esta ejecución falló. <button style={S.retryBtn} disabled={busy} onClick={() => retry(c.instanceId)}>{busy ? "Reintentando…" : "↻ Reintentar"}</button></div>
        )}

        <div style={S.timeline}>
          {c.steps.map((s, i) => {
            const k = KIND[s.kind] ?? KIND.service;
            return (
              <div key={i} style={S.tItem}>
                <div style={{ ...S.tDot, background: k.color }}>{k.icon}</div>
                {i < c.steps.length - 1 && <div style={S.tLine} />}
                <div style={S.tCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {s.title}
                      {s.badge && <span style={{ ...S.badge, background: badgeColor(s.badge).bg, color: badgeColor(s.badge).fg }}>{s.badge}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap" }}>{s.ts ? new Date(s.ts).toLocaleString() : ""}</div>
                  </div>
                  {s.actor && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>por <b>{s.actor}</b></div>}
                  {s.detail && <div style={{ fontSize: 13, color: "var(--text)", marginTop: 6, lineHeight: 1.5 }}>{s.detail}</div>}
                  {s.fields && s.fields.length > 0 && (
                    <div style={S.fieldGrid}>{s.fields.map((f, j) => (<div key={j}><span style={S.fk}>{f.label}</span><span style={S.fv}>{f.value}</span></div>))}</div>
                  )}
                  {s.meta && s.meta.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{s.meta.map((f, j) => (<span key={j} style={S.metaChip}>{f.label}: <b>{f.value}</b></span>))}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={S.card}>
          <div style={S.h}>Comentarios</div>
          {c.comments.map((cm, i) => (
            <div key={i} style={S.comment}><div style={{ fontSize: 13 }}>{cm.text}</div><div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}><b>{cm.author}</b> · {new Date(cm.ts).toLocaleString()}</div></div>
          ))}
          {c.comments.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0" }}>Sin comentarios.</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input style={S.cInput} placeholder="Agregar un comentario…" value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") postComment(); }} />
            <button style={S.cBtn} onClick={postComment}>Enviar</button>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button style={S.techToggle} onClick={() => setTech((t) => !t)}>{tech ? "▾" : "▸"} Detalle técnico</button>
          <a href="#" onClick={(e) => { e.preventDefault(); downloadCsv(c.instanceId); }} style={S.csv}>⬇ auditoría CSV</a>
          {tech && (
            <div style={S.card}>
              <div style={S.h}>Datos del caso</div>
              <div style={S.fieldGrid}>{c.data.map((f, i) => (<div key={i}><span style={S.fk}>{f.label}</span><span style={S.fv}>{f.value}</span></div>))}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- list ----
  const shown = list
    .filter((i) => filter === "all" || i.defId === filter)
    .filter((i) => !q || (i.subject ?? "").toLowerCase().includes(q.toLowerCase()) || i.id.includes(q) || i.processName.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
      <div style={S.bar}>
        <span style={S.h}>Ejecuciones ({shown.length})</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input style={S.search} placeholder="Buscar solicitante…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={S.select}>
            <option value="all">Todos los flujos</option>
            {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "#16a34a" }} /> en vivo</span>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
          <th style={S.th}>Solicitante</th><th style={S.th}>Flujo</th><th style={S.th}>Resultado</th><th style={S.th}>Estado</th><th style={S.th}>Caso</th>
        </tr></thead>
        <tbody>
          {shown.map((i) => {
            const oc = OUTCOME[i.outcome] ?? OUTCOME.running;
            return (
              <tr key={i.id} onClick={() => openCase(i.id)} style={{ cursor: "pointer", borderTop: "1px solid var(--border)" }} className="nav-item">
                <td style={{ ...S.td, fontWeight: 600 }}>{i.subject ?? <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                <td style={S.td}>{i.processName}</td>
                <td style={S.td}><span style={{ ...S.outcome, background: oc.bg, color: oc.fg }}>{i.outcomeLabel}</span></td>
                <td style={{ ...S.td, color: "var(--text-muted)" }}>{STATUS_ES[i.status] ?? i.status}</td>
                <td style={{ ...S.td, color: "var(--text-faint)" }}><code>{i.id.slice(0, 8)}</code></td>
              </tr>
            );
          })}
          {shown.length === 0 && <tr><td style={S.td} colSpan={5}>Todavía no hay ejecuciones — aplicá en <code>/banco</code> o ejecutá un flujo.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function badgeColor(b: string): { bg: string; fg: string } {
  if (/approv|aprob|yes|sí/i.test(b)) return { bg: "#dcfce7", fg: "#166534" };
  if (/decl|reject|rechaz|review|revis|no/i.test(b)) return { bg: "#fff4e5", fg: "#9a3412" };
  return { bg: "var(--surface-3)", fg: "var(--text-muted)" };
}

const S: Record<string, React.CSSProperties> = {
  bar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: "1px solid var(--border)", gap: 10, flexWrap: "wrap" },
  h: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700 },
  search: { border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 10px", fontSize: 13, width: 170, background: "var(--surface)", color: "var(--text)" },
  select: { border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 8px", fontSize: 12, background: "var(--surface)", fontWeight: 600, color: "var(--text)" },
  th: { padding: "9px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { padding: "10px 14px", color: "var(--text)" },
  outcome: { fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" },
  back: { background: "transparent", border: 0, color: "var(--primary)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "2px 0", marginBottom: 12 },
  caseHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 },
  aiChip: { fontSize: 12, background: "#f3ecff", color: "#6d28d9", borderRadius: 999, padding: "5px 11px", fontWeight: 600, whiteSpace: "nowrap" },
  failBox: { background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14, display: "flex", gap: 10, alignItems: "center" },
  retryBtn: { background: "#dc2626", color: "white", border: 0, borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  timeline: { position: "relative", marginBottom: 18 },
  tItem: { position: "relative", paddingLeft: 44, paddingBottom: 14 },
  tDot: { position: "absolute", left: 0, top: 0, width: 30, height: 30, borderRadius: 999, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, zIndex: 1 },
  tLine: { position: "absolute", left: 14, top: 30, bottom: -2, width: 2, background: "var(--border)" },
  tCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", boxShadow: "var(--shadow-sm)" },
  badge: { fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 9px", marginLeft: 8, verticalAlign: "middle" },
  fieldGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginTop: 10 },
  fk: { display: "block", fontSize: 10.5, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: 0.3 },
  fv: { display: "block", fontSize: 13, color: "var(--text)", fontWeight: 600, marginTop: 1 },
  metaChip: { fontSize: 11.5, background: "var(--surface-3)", color: "var(--text-muted)", borderRadius: 6, padding: "3px 8px" },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginTop: 12 },
  comment: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", marginTop: 8 },
  cInput: { flex: 1, border: "1px solid var(--border-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "var(--surface)", color: "var(--text)" },
  cBtn: { background: "var(--primary)", color: "white", border: 0, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  techToggle: { background: "transparent", border: 0, color: "var(--text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 },
  csv: { fontSize: 12, color: "var(--primary)", marginLeft: 14, fontWeight: 600, textDecoration: "none" },
};
