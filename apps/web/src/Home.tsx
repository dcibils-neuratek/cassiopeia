import { useEffect, useState } from "react";
import { api } from "./api.js";

type PerProcess = { id: string; name: string; total: number; byStatus: Record<string, number> };
type Stats = { processes: number; instances: number; byStatus: Record<string, number>; perProcess: PerProcess[] };

export function Home({ onOpen, onTemplates }: { onOpen: (defId: string, mode: "build" | "run") => void; onTemplates: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api("/stats").then((r) => { if (alive) setStats(r.data); });
    load();
    const t = setInterval(load, 4000); // live updates
    return () => { alive = false; clearInterval(t); };
  }, []);

  const active = stats ? (stats.byStatus.running ?? 0) + (stats.byStatus.waiting ?? 0) : 0;

  return (
    <div>
      <div style={S.cards}>
        <Stat label="Workflows" value={stats?.processes ?? "—"} />
        <Stat label="Total runs" value={stats?.instances ?? "—"} />
        <Stat label="Active runs" value={active} accent="#d97706" />
        <Stat label="Completed" value={stats?.byStatus.completed ?? 0} accent="#16a34a" />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28 }}>
        <h2 style={S.h2}>Your workflows</h2>
        <button style={S.ghost} onClick={onTemplates}>+ New from template</button>
      </div>

      <div style={S.grid}>
        {stats?.perProcess.map((p) => (
          <div key={p.id} className="hoverable" style={S.card}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>{p.id}</div>
            <div style={{ display: "flex", gap: 14, fontSize: 13, color: "var(--text-muted)" }}>
              <span><b style={{ color: "var(--text)" }}>{p.total}</b> runs</span>
              <span><b style={{ color: "#d97706" }}>{(p.byStatus.running ?? 0) + (p.byStatus.waiting ?? 0)}</b> active</span>
              <span><b style={{ color: "#16a34a" }}>{p.byStatus.completed ?? 0}</b> done</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button style={S.primary} onClick={() => onOpen(p.id, "build")}>Build</button>
              <button style={S.run} onClick={() => onOpen(p.id, "run")}>▶ Run</button>
            </div>
          </div>
        ))}
        {stats && stats.perProcess.length === 0 && (
          <div style={{ color: "var(--text-muted)" }}>No workflows yet — start from a template.</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={S.statCard}>
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: accent ?? "var(--text)", marginTop: 6 }}>{value}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 },
  statCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px 18px", boxShadow: "var(--shadow)" },
  h2: { fontSize: 17, fontWeight: 800, margin: 0 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginTop: 14 },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 18, boxShadow: "var(--shadow)" },
  primary: { background: "var(--primary)", color: "white", border: 0, borderRadius: "var(--radius-sm)", padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  run: { background: "var(--success)", color: "white", border: 0, borderRadius: "var(--radius-sm)", padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  ghost: { background: "var(--surface)", color: "var(--primary)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
};
