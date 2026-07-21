import { useEffect, useState } from "react";
import { api } from "./api.js";
import type { CurrentUser } from "./Login.js";

type PerProcess = { id: string; name: string; total: number; byStatus: Record<string, number> };
type Stats = { processes: number; instances: number; byStatus: Record<string, number>; perProcess: PerProcess[] };

const ROLE_RANK: Record<string, number> = { viewer: 0, operator: 1, analyst: 2, admin: 3 };

export function Home({ user, onOpen, onTemplates, onInbox, onDelete }: {
  user: CurrentUser;
  onOpen: (defId: string, mode: "build" | "run") => void;
  onTemplates: () => void;
  onInbox: () => void;
  onDelete?: (id: string, name: string) => void;
}) {
  // Analysts and admins build & run flows; operators/viewers get a worklist.
  const isBuilder = (ROLE_RANK[user.role] ?? 0) >= ROLE_RANK.analyst;
  return isBuilder
    ? <BuilderHome user={user} onOpen={onOpen} onTemplates={onTemplates} onDelete={onDelete} />
    : <OperatorHome user={user} onInbox={onInbox} />;
}

// ---------------------------------------------------------------------------
// Operator home: focused on the tasks this person can act on.
// ---------------------------------------------------------------------------
type Task = {
  id: string; instanceId: string; nodeName: string; processName: string;
  priority?: string | null; dueAt?: string | null; assignee?: string | null;
};
const PRIO_COLOR: Record<string, string> = { high: "#dc2626", normal: "#2563eb", low: "#64748b" };
const PRIO_ES: Record<string, string> = { high: "alta", normal: "normal", low: "baja" };

function OperatorHome({ user, onInbox }: { user: CurrentUser; onInbox: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => api("/tasks").then((r) => { if (alive && r.ok) setTasks(r.data); });
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const now = new Date();
  const overdue = tasks.filter((t) => t.dueAt && new Date(t.dueAt) < now);
  const mine = tasks.filter((t) => t.assignee === user.username);
  const high = tasks.filter((t) => (t.priority ?? "normal") === "high");
  const firstName = (user.displayName || user.username).split(" ")[0];

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Hola, {firstName} 👋</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
          {user.area
            ? <>Estás en el área <span style={S.areaPill}>{user.area}</span> — acá están tus tareas pendientes.</>
            : "Acá están las tareas asignadas a vos."}
        </div>
      </div>

      <div style={S.cards}>
        <Stat label="Tareas a resolver" value={tasks.length} onClick={onInbox} />
        <Stat label="Asignadas a mí" value={mine.length} accent="var(--primary)" onClick={onInbox} />
        <Stat label="Prioridad alta" value={high.length} accent="#dc2626" onClick={onInbox} />
        <Stat label="Vencidas" value={overdue.length} accent="#dc2626" onClick={onInbox} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28 }}>
        <h2 style={S.h2}>Tu lista de trabajo</h2>
        <button style={S.ghost} onClick={onInbox}>Abrir Bandeja →</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {tasks.slice(0, 8).map((t) => {
          const prio = t.priority ?? "normal";
          const isOver = t.dueAt && new Date(t.dueAt) < now;
          return (
            <button key={t.id} onClick={onInbox} className="hoverable"
              style={{ textAlign: "left", cursor: "pointer", padding: "12px 14px 12px 16px", borderRadius: 11, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: `inset 4px 0 0 ${PRIO_COLOR[prio]}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{t.nodeName}</span>
                <span style={{ ...S.prioPill, background: PRIO_COLOR[prio] + "22", color: PRIO_COLOR[prio] }}>{PRIO_ES[prio]}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{t.processName}</div>
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>{t.assignee ? `👤 ${t.assignee}` : "sin asignar"}</span>
                {t.dueAt && <span style={{ color: isOver ? "#dc2626" : "var(--text-muted)", fontWeight: isOver ? 700 : 400 }}>{isOver ? "⚠ vencida" : "🕓 vence"} {new Date(t.dueAt).toLocaleDateString()}</span>}
              </div>
            </button>
          );
        })}
        {tasks.length === 0 && (
          <div style={{ ...S.card, textAlign: "center", color: "var(--text-muted)" }}>
            🎉 No tenés tareas pendientes ahora mismo.
          </div>
        )}
        {tasks.length > 8 && <button style={{ ...S.ghost, alignSelf: "flex-start", marginTop: 4 }} onClick={onInbox}>Ver las {tasks.length} tareas →</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder home (analyst / admin): the flow dashboard.
// ---------------------------------------------------------------------------
function BuilderHome({ user, onOpen, onTemplates, onDelete }: {
  user: CurrentUser;
  onOpen: (defId: string, mode: "build" | "run") => void;
  onTemplates: () => void;
  onDelete?: (id: string, name: string) => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api("/stats").then((r) => { if (alive) setStats(r.data); });
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const active = stats ? (stats.byStatus.running ?? 0) + (stats.byStatus.waiting ?? 0) : 0;
  const canModify = (ROLE_RANK[user.role] ?? 0) >= ROLE_RANK.admin;

  return (
    <div>
      <div style={S.cards}>
        <Stat label="Flujos" value={stats?.processes ?? "—"} />
        <Stat label="Ejecuciones totales" value={stats?.instances ?? "—"} />
        <Stat label="Activas" value={active} accent="#d97706" />
        <Stat label="Completadas" value={stats?.byStatus.completed ?? 0} accent="#16a34a" />
      </div>

      <div style={S.demoBanner} className="hoverable" onClick={() => window.open("/banco", "_blank", "noopener")}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>🏦</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Portal del cliente — Banco del Futuro</div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 1 }}>La solicitud de préstamo que ve el cliente. Se abre en otra pestaña e inicia el flujo real.</div>
          </div>
        </div>
        <span style={S.demoOpen}>Abrir portal ↗</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28 }}>
        <h2 style={S.h2}>Tus flujos</h2>
        <button style={S.ghost} onClick={onTemplates}>+ Nuevo desde plantilla</button>
      </div>

      <div style={S.grid}>
        {stats?.perProcess.map((p) => (
          <div key={p.id} className="hoverable" style={{ ...S.card, position: "relative" }}>
            {onDelete && (
              <button title="Eliminar flujo" style={S.del} onClick={() => onDelete(p.id, p.name)}>×</button>
            )}
            <div style={{ fontSize: 16, fontWeight: 700, paddingRight: 20 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>{p.id}</div>
            <div style={{ display: "flex", gap: 14, fontSize: 13, color: "var(--text-muted)" }}>
              <span><b style={{ color: "var(--text)" }}>{p.total}</b> ejecuciones</span>
              <span><b style={{ color: "#d97706" }}>{(p.byStatus.running ?? 0) + (p.byStatus.waiting ?? 0)}</b> activas</span>
              <span><b style={{ color: "#16a34a" }}>{p.byStatus.completed ?? 0}</b> completadas</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {canModify && <button style={S.primary} onClick={() => onOpen(p.id, "build")}>Diseñar</button>}
              <button style={S.run} onClick={() => onOpen(p.id, "run")}>▶ Ejecutar</button>
            </div>
          </div>
        ))}
        {stats && stats.perProcess.length === 0 && (
          <div style={{ color: "var(--text-muted)" }}>Todavía no hay flujos — empezá desde una plantilla.</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, onClick }: { label: string; value: number | string; accent?: string; onClick?: () => void }) {
  return (
    <div style={{ ...S.statCard, ...(onClick ? { cursor: "pointer" } : {}) }} className={onClick ? "hoverable" : undefined} onClick={onClick}>
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
  del: { position: "absolute", top: 10, right: 10, width: 24, height: 24, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-faint)", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  areaPill: { fontSize: 12, background: "var(--primary-tint)", color: "var(--primary-strong)", borderRadius: 6, padding: "1px 8px", fontWeight: 700 },
  demoBanner: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 22, padding: "14px 18px", borderRadius: "var(--radius)", border: "1px solid var(--primary-tint-2)", background: "var(--primary-tint)", cursor: "pointer", flexWrap: "wrap" },
  demoOpen: { background: "var(--primary)", color: "var(--on-primary)", border: 0, borderRadius: "var(--radius-sm)", padding: "8px 14px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" },
  prioPill: { fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.3 },
};
