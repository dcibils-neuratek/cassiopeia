import { useEffect, useState } from "react";
import { api } from "./api.js";

type PerProcess = { id: string; name: string; total: number; byStatus: Record<string, number> };
type Recent = { id: string; defId: string; status: string; currentNodeId: string };
type Point = { date: string; started: number; completed: number };
type Stats = { processes: number; instances: number; byStatus: Record<string, number>; perProcess: PerProcess[]; recent: Recent[]; timeline: Point[] };

const STATUS_COLOR: Record<string, string> = { running: "#2563eb", waiting: "#d97706", completed: "#16a34a", failed: "#dc2626" };
const ORDER = ["running", "waiting", "completed", "failed"];

type NodeStat = { nodeId: string; name: string; type: string; visits: number; avgMs: number; maxMs: number };
type Analytics = {
  name: string; totalInstances: number; completedCount: number; avgCycleMs: number | null;
  aiTokens: number; aiCost: number;
  nodeStats: NodeStat[]; bottleneck: NodeStat | null;
  gatewayDistribution: { nodeId: string; name: string; branches: { to: string; toName: string; count: number }[] }[];
  failuresByNode: { nodeId: string; name: string; count: number }[];
};

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

export function Stats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [selDef, setSelDef] = useState("");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [suggestions, setSuggestions] = useState("");
  const [aBusy, setABusy] = useState(false);
  const [aErr, setAErr] = useState("");

  async function loadAnalytics(id: string) {
    if (!id) return;
    const r = await api(`/analytics/${id}`);
    if (r.ok) setAnalytics(r.data);
  }
  async function reload() {
    setStats((await api("/stats")).data);
    if (selDef) loadAnalytics(selDef);
  }
  async function analyze() {
    if (!selDef) return;
    setABusy(true); setAErr(""); setSuggestions("");
    const r = await api(`/definitions/${selDef}/analyze`, { method: "POST", body: JSON.stringify({}) });
    setABusy(false);
    if (r.ok) { setSuggestions(r.data.suggestions); setAnalytics(r.data.analytics); }
    else setAErr(r.data?.error ?? "Analysis failed");
  }

  useEffect(() => {
    let alive = true;
    const load = () => api("/stats").then((r) => { if (alive) setStats(r.data); });
    load();
    const t = setInterval(load, 4000); // live updates
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (stats && !selDef && stats.perProcess.length) setSelDef(stats.perProcess[0].id);
  }, [stats, selDef]);
  useEffect(() => { setSuggestions(""); setAErr(""); loadAnalytics(selDef); }, [selDef]);

  if (!stats) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;

  const total = stats.instances || 1;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "#16a34a", display: "inline-block" }} /> live
        </span>
        <button style={S.ghost} onClick={reload}>Refresh</button>
      </div>

      <div style={S.cards}>
        {ORDER.map((k) => (
          <div key={k} style={S.statCard}>
            <div className="eyebrow">{k}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: STATUS_COLOR[k], marginTop: 6 }}>{stats.byStatus[k] ?? 0}</div>
          </div>
        ))}
      </div>

      <div style={S.bar}>
        {ORDER.map((k) => {
          const v = stats.byStatus[k] ?? 0;
          return v ? <div key={k} title={`${k}: ${v}`} style={{ width: `${(v / total) * 100}%`, background: STATUS_COLOR[k] }} /> : null;
        })}
      </div>

      <h2 style={S.h2}>Throughput (last 14 days)</h2>
      <div style={S.panel}>
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 10, fontSize: 12, color: "var(--text-muted)" }}>
            <span><span style={{ ...S.dot, background: "#2563eb" }} /> Started</span>
            <span><span style={{ ...S.dot, background: "#16a34a" }} /> Completed</span>
          </div>
          <Throughput data={stats.timeline} />
        </div>
      </div>

      <h2 style={S.h2}>By workflow</h2>
      <div style={S.panel}>
        <table style={S.table}>
          <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th style={S.th}>Workflow</th><th style={S.th}>Runs</th>
            {ORDER.map((k) => <th key={k} style={S.th}>{k}</th>)}
          </tr></thead>
          <tbody>
            {stats.perProcess.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={S.td}>{p.name}</td>
                <td style={S.td}><b>{p.total}</b></td>
                {ORDER.map((k) => <td key={k} style={{ ...S.td, color: (p.byStatus[k] ?? 0) ? STATUS_COLOR[k] : "#cbd5e1", fontWeight: 600 }}>{p.byStatus[k] ?? 0}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 28 }}>
        <h2 style={{ ...S.h2, margin: 0 }}>Cycle time &amp; AI analyst</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={selDef} onChange={(e) => setSelDef(e.target.value)} style={S.select}>
            {stats.perProcess.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button style={S.aiBtn} disabled={aBusy} onClick={analyze}>{aBusy ? "Analyzing…" : "✦ Analyze with AI"}</button>
        </div>
      </div>

      {analytics && (
        <div style={{ ...S.panel, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 24, padding: 16, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
            <Metric label="Avg completion time" value={fmtMs(analytics.avgCycleMs)} />
            <Metric label="Completed" value={String(analytics.completedCount)} />
            <Metric label="Bottleneck" value={analytics.bottleneck ? `${analytics.bottleneck.name} · ${fmtMs(analytics.bottleneck.avgMs)}` : "—"} />
            <Metric label="AI tokens" value={(analytics.aiTokens ?? 0).toLocaleString()} />
            <Metric label="Est. AI cost" value={`$${(analytics.aiCost ?? 0).toFixed(4)}`} />
          </div>
          <table style={S.table}>
            <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th style={S.th}>Step</th><th style={S.th}>Type</th><th style={S.th}>Avg time</th><th style={S.th}>Max</th><th style={S.th}>Visits</th>
            </tr></thead>
            <tbody>
              {analytics.nodeStats.map((n) => {
                const isBottle = analytics.bottleneck?.nodeId === n.nodeId;
                return (
                  <tr key={n.nodeId} style={{ borderTop: "1px solid #f1f5f9", background: isBottle ? "#fff7ed" : undefined }}>
                    <td style={S.td}>{isBottle && "🐢 "}{n.name}</td>
                    <td style={{ ...S.td, color: "var(--text-muted)" }}>{n.type}</td>
                    <td style={{ ...S.td, fontWeight: isBottle ? 800 : 600, color: isBottle ? "#9a3412" : "var(--text)" }}>{fmtMs(n.avgMs)}</td>
                    <td style={S.td}>{fmtMs(n.maxMs)}</td>
                    <td style={S.td}>{n.visits}</td>
                  </tr>
                );
              })}
              {analytics.nodeStats.length === 0 && <tr><td style={S.td} colSpan={5}>No run data yet — start some instances.</td></tr>}
            </tbody>
          </table>
          {analytics.gatewayDistribution.length > 0 && (
            <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Gateway branches</div>
              {analytics.gatewayDistribution.map((g) => (
                <div key={g.nodeId} style={{ fontSize: 13, marginBottom: 4 }}>
                  <b>{g.name}:</b> {g.branches.map((b) => `${b.toName} (${b.count})`).join(" · ")}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {aErr && <div style={S.err}>{aErr}</div>}
      {suggestions && (
        <div style={{ ...S.panel, marginTop: 12, padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>✦ AI analyst suggestions</div>
          <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text)" }}>{suggestions}</div>
        </div>
      )}

      <h2 style={S.h2}>Recent runs</h2>
      <div style={S.panel}>
        <table style={S.table}>
          <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th style={S.th}>Instance</th><th style={S.th}>Workflow</th><th style={S.th}>Status</th><th style={S.th}>At node</th>
          </tr></thead>
          <tbody>
            {stats.recent.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={S.td}><code>{r.id.slice(0, 8)}</code></td>
                <td style={S.td}>{r.defId}</td>
                <td style={{ ...S.td, color: STATUS_COLOR[r.status] ?? "#334155", fontWeight: 600 }}>{r.status}</td>
                <td style={S.td}>{r.currentNodeId}</td>
              </tr>
            ))}
            {stats.recent.length === 0 && <tr><td style={S.td} colSpan={4}>No runs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Throughput({ data }: { data: Point[] }) {
  const W = 720, H = 160, padL = 28, padB = 22, padT = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.started, d.completed)));
  const n = data.length;
  const slot = (W - padL) / n;
  const bw = Math.min(10, slot / 3);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const gridVals = [0, Math.ceil(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {gridVals.map((g, i) => (
        <g key={i}>
          <line x1={padL} x2={W} y1={y(g)} y2={y(g)} stroke="#eef1f6" />
          <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{g}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = padL + slot * i + slot / 2;
        return (
          <g key={d.date}>
            <rect x={cx - bw - 1} y={y(d.started)} width={bw} height={Math.max(0, y(0) - y(d.started))} rx={2} fill="#2563eb" />
            <rect x={cx + 1} y={y(d.completed)} width={bw} height={Math.max(0, y(0) - y(d.completed))} rx={2} fill="#16a34a" />
            {(i % 2 === 0 || i === n - 1) && (
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="9" fill="#94a3b8">{d.date.slice(5)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  dot: { display: "inline-block", width: 9, height: 9, borderRadius: 3, marginRight: 5, verticalAlign: "middle" },
  select: { border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "white", fontWeight: 600, color: "var(--text)" },
  aiBtn: { background: "var(--primary)", color: "white", border: 0, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  err: { background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 10 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginTop: 8 },
  statCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 18px", boxShadow: "var(--shadow)" },
  bar: { display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "#eef1f6", marginTop: 16 },
  h2: { fontSize: 16, fontWeight: 800, marginTop: 28, marginBottom: 10 },
  panel: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", boxShadow: "var(--shadow)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "10px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { padding: "10px 14px", color: "var(--text)" },
  ghost: { background: "white", color: "var(--primary)", border: "1px solid var(--primary)", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" },
};
