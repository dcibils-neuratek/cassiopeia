import { useEffect, useState } from "react";
import { api } from "./api.js";

type PerProcess = { id: string; name: string; total: number; byStatus: Record<string, number> };
type Recent = { id: string; defId: string; status: string; currentNodeId: string };
type Point = { date: string; started: number; completed: number };
type Stats = { processes: number; instances: number; byStatus: Record<string, number>; perProcess: PerProcess[]; recent: Recent[]; timeline: Point[] };

const STATUS_COLOR: Record<string, string> = { running: "#2563eb", waiting: "#d97706", completed: "#16a34a", failed: "#dc2626" };
const ORDER = ["running", "waiting", "completed", "failed"];

export function Stats() {
  const [stats, setStats] = useState<Stats | null>(null);
  async function reload() { setStats((await api("/stats")).data); }
  useEffect(() => {
    let alive = true;
    const load = () => api("/stats").then((r) => { if (alive) setStats(r.data); });
    load();
    const t = setInterval(load, 4000); // live updates
    return () => { alive = false; clearInterval(t); };
  }, []);
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

const S: Record<string, React.CSSProperties> = {
  dot: { display: "inline-block", width: 9, height: 9, borderRadius: 3, marginRight: 5, verticalAlign: "middle" },
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
