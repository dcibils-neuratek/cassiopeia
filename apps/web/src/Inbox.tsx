import { useEffect, useState } from "react";
import type { FormDefinition } from "@cassiopeia/model";
import { FormRenderer, type FormValues } from "@cassiopeia/form-kit";
import { api, uploadFile } from "./api.js";

type Task = {
  id: string; instanceId: string; nodeId: string; formId: string | null;
  defId: string; processName: string; nodeName: string; formTitle: string | null;
  dueAt?: string | null; assignee?: string | null; role?: string | null; priority?: string | null;
  context: Record<string, unknown>;
};

const PRIO_COLOR: Record<string, string> = { high: "#dc2626", normal: "#2563eb", low: "#64748b" };
const PRIO_ES: Record<string, string> = { high: "alta", normal: "normal", low: "baja" };

export function Inbox({ me }: { me: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [defs, setDefs] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [sel, setSel] = useState<Task | null>(null);
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [reassignTo, setReassignTo] = useState("");

  async function reload() {
    const r = await api("/tasks");
    setTasks(r.data);
    // keep the selected task in sync (or drop it if completed)
    setSel((cur) => (cur ? (r.data as Task[]).find((t) => t.id === cur.id) ?? null : cur));
  }
  useEffect(() => {
    let alive = true;
    api("/definitions").then((r) => alive && setDefs(r.data.map((d: any) => ({ id: d.id, name: d.name }))));
    reload();
    const t = setInterval(() => alive && reload(), 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!sel?.formId) { setForm(null); return; }
    api(`/forms/${sel.formId}`).then((r) => setForm(r.data));
  }, [sel?.id, sel?.formId]);

  async function claim(t: Task) {
    setBusy(true);
    try { await api(`/tasks/${t.id}/claim`, { method: "POST" }); await reload(); }
    finally { setBusy(false); }
  }
  async function reassign(t: Task) {
    const to = reassignTo.trim();
    if (!to) return;
    setBusy(true);
    try {
      const r = await api(`/tasks/${t.id}/reassign`, { method: "POST", body: JSON.stringify({ assignee: to }) });
      if (!r.ok) alert(r.data?.error ?? "Reassign failed");
      setReassignTo(""); await reload();
    } finally { setBusy(false); }
  }
  async function complete(patch: FormValues) {
    if (!sel) return;
    setBusy(true);
    try {
      await api(`/tasks/${sel.id}/submit`, { method: "POST", body: JSON.stringify(patch) });
      setSel(null); setForm(null); await reload();
    } finally { setBusy(false); }
  }
  async function completeNoForm() {
    if (!sel) return;
    setBusy(true);
    try { await api(`/tasks/${sel.id}/submit`, { method: "POST", body: JSON.stringify({}) }); setSel(null); await reload(); }
    finally { setBusy(false); }
  }

  const shown = tasks
    .filter((t) => filter === "all" || t.defId === filter)
    .filter((t) => !mineOnly || t.assignee === me);
  const overdue = (t: Task) => t.dueAt && new Date(t.dueAt) < new Date();

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", overflow: "hidden" }}>
        <div style={S.bar}>
          <span style={S.head}>Tareas ({shown.length})</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={S.youLabel}>Vos: <b style={{ color: "var(--text)" }}>{me}</b></span>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> mías
            </label>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={S.select}>
              <option value="all">Todos los flujos</option>
              {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
          {shown.map((t) => {
            const active = sel?.id === t.id;
            const prio = t.priority ?? "normal";
            return (
              <button key={t.id} onClick={() => setSel(t)} className="hoverable"
                style={{ textAlign: "left", cursor: "pointer", padding: "12px 14px", borderRadius: 11, background: active ? "var(--primary-tint)" : "var(--surface-2)", border: active ? "1.5px solid var(--primary)" : "1px solid var(--border)", borderLeft: `4px solid ${PRIO_COLOR[prio]}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{t.nodeName}</span>
                  <span style={{ ...S.prioPill, background: PRIO_COLOR[prio] + "22", color: PRIO_COLOR[prio] }}>{PRIO_ES[prio]}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{t.processName}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-muted)" }}>{t.assignee ? `👤 ${t.assignee}` : "sin asignar"}</span>
                  {t.dueAt && <span style={{ color: overdue(t) ? "#dc2626" : "var(--text-muted)", fontWeight: overdue(t) ? 700 : 400 }}>{overdue(t) ? "⚠ vencida" : "🕓 vence"} {new Date(t.dueAt).toLocaleDateString()}</span>}
                </div>
              </button>
            );
          })}
          {shown.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>No hay tareas abiertas{mineOnly ? " asignadas a vos" : ""}.</div>}
        </div>
      </div>

      <div style={{ width: 420, border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--surface)" }}>
        <div style={S.head}>Tarea</div>
        {!sel && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Seleccioná una tarea para trabajarla.</p>}
        {sel && (
          <>
            <h3 style={{ margin: "6px 0 2px", fontSize: 16 }}>{sel.nodeName}</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{sel.processName} · <code>{sel.instanceId.slice(0, 8)}</code></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={S.tag}>prioridad: <b style={{ color: PRIO_COLOR[sel.priority ?? "normal"] }}>{PRIO_ES[sel.priority ?? "normal"]}</b></span>
              {sel.role && <span style={S.tag}>rol: {sel.role}</span>}
              <span style={S.tag}>asignado: {sel.assignee || "sin asignar"}</span>
              {sel.dueAt && <span style={{ ...S.tag, color: overdue(sel) ? "#dc2626" : undefined }}>{overdue(sel) ? "vencida" : "vence"} {new Date(sel.dueAt).toLocaleString()}</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {sel.assignee !== me && (
                <button style={S.claim} disabled={busy} onClick={() => claim(sel)}>Tomar como {me}</button>
              )}
              <input style={S.reassignInput} placeholder="reasignar a…" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} />
              <button style={S.reassignBtn} disabled={busy || !reassignTo.trim()} onClick={() => reassign(sel)}>Reasignar</button>
            </div>
            <div style={{ marginTop: 12 }}>
              {sel.formId && form && <FormRenderer key={sel.id} form={form} initial={sel.context as any} submitLabel={busy ? "Procesando…" : "Completar tarea"} onSubmit={complete} uploadFile={uploadFile} />}
              {sel.formId && !form && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Cargando formulario…</p>}
              {!sel.formId && (
                <>
                  <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Esta tarea no tiene formulario.</p>
                  <button style={S.primary} disabled={busy} onClick={completeNoForm}>Completar tarea</button>
                </>
              )}
            </div>
            <div style={{ ...S.head, marginTop: 14 }}>Datos de la instancia</div>
            <pre style={S.pre}>{JSON.stringify(sel.context, null, 2)}</pre>
          </>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  bar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: "1px solid var(--border)", gap: 10, flexWrap: "wrap" },
  head: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700 },
  select: { border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", fontSize: 12, background: "white", fontWeight: 600, color: "var(--text)" },
  youLabel: { fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 4, alignItems: "center" },
  youInput: { border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", fontSize: 12, width: 80 },
  th: { padding: "8px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { padding: "8px 12px", color: "var(--text)" },
  tag: { fontSize: 11, background: "var(--surface-3)", borderRadius: 6, padding: "3px 7px", color: "var(--text-muted)" },
  prioPill: { fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.3 },
  claim: { background: "var(--primary)", color: "white", border: 0, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  reassignInput: { border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 9px", fontSize: 12, width: 120 },
  reassignBtn: { background: "var(--surface)", color: "var(--primary)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  primary: { background: "#2563eb", color: "white", border: 0, borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer" },
  pre: { background: "#f8fafc", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginTop: 8 },
};
