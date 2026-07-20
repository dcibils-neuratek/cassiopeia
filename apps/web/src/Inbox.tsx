import { useEffect, useState } from "react";
import type { FormDefinition } from "@cassiopeia/model";
import { FormRenderer, type FormValues } from "@cassiopeia/form-kit";
import { api } from "./api.js";

type Task = {
  id: string; instanceId: string; nodeId: string; formId: string | null;
  defId: string; processName: string; nodeName: string; formTitle: string | null;
  dueAt?: string | null; assignee?: string | null; role?: string | null; priority?: string | null;
  context: Record<string, unknown>;
};

const PRIO_COLOR: Record<string, string> = { high: "#dc2626", normal: "#2563eb", low: "#64748b" };

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
      <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 12, background: "white", overflow: "hidden" }}>
        <div style={S.bar}>
          <span style={S.head}>Worklist ({shown.length})</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={S.youLabel}>You: <b style={{ color: "var(--text)" }}>{me}</b></span>
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> mine
            </label>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={S.select}>
              <option value="all">All workflows</option>
              {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th style={S.th}>Task</th><th style={S.th}>Process</th><th style={S.th}>Priority</th><th style={S.th}>Assignee</th><th style={S.th}>Due</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} onClick={() => setSel(t)} style={{ cursor: "pointer", borderTop: "1px solid #f1f5f9", background: sel?.id === t.id ? "var(--primary-tint)" : "white" }}>
                <td style={S.td}>{t.nodeName}</td>
                <td style={S.td}>{t.processName}</td>
                <td style={S.td}><span style={{ color: PRIO_COLOR[t.priority ?? "normal"], fontWeight: 700 }}>{t.priority ?? "normal"}</span></td>
                <td style={S.td}>{t.assignee || <span style={{ color: "#94a3b8" }}>unassigned</span>}</td>
                <td style={{ ...S.td, color: overdue(t) ? "#dc2626" : "var(--text)", fontWeight: overdue(t) ? 700 : 400 }}>
                  {t.dueAt ? (overdue(t) ? "⚠ " : "") + new Date(t.dueAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td style={S.td} colSpan={5}>No open tasks{mineOnly ? " assigned to you" : ""}.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ width: 420, border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "white" }}>
        <div style={S.head}>Task</div>
        {!sel && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Select a task to work on it.</p>}
        {sel && (
          <>
            <h3 style={{ margin: "6px 0 2px", fontSize: 16 }}>{sel.nodeName}</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{sel.processName} · <code>{sel.instanceId.slice(0, 8)}</code></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={S.tag}>priority: <b style={{ color: PRIO_COLOR[sel.priority ?? "normal"] }}>{sel.priority ?? "normal"}</b></span>
              {sel.role && <span style={S.tag}>role: {sel.role}</span>}
              <span style={S.tag}>assignee: {sel.assignee || "unassigned"}</span>
              {sel.dueAt && <span style={{ ...S.tag, color: overdue(sel) ? "#dc2626" : undefined }}>{overdue(sel) ? "overdue" : "due"} {new Date(sel.dueAt).toLocaleString()}</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {sel.assignee !== me && (
                <button style={S.claim} disabled={busy} onClick={() => claim(sel)}>Claim for {me}</button>
              )}
              <input style={S.reassignInput} placeholder="reassign to…" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} />
              <button style={S.reassignBtn} disabled={busy || !reassignTo.trim()} onClick={() => reassign(sel)}>Reassign</button>
            </div>
            <div style={{ marginTop: 12 }}>
              {sel.formId && form && <FormRenderer key={sel.id} form={form} initial={sel.context as any} submitLabel={busy ? "Working…" : "Complete task"} onSubmit={complete} />}
              {sel.formId && !form && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading form…</p>}
              {!sel.formId && (
                <>
                  <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No form attached to this task.</p>
                  <button style={S.primary} disabled={busy} onClick={completeNoForm}>Complete task</button>
                </>
              )}
            </div>
            <div style={{ ...S.head, marginTop: 14 }}>Instance data</div>
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
  tag: { fontSize: 11, background: "#f1f5f9", borderRadius: 6, padding: "3px 7px", color: "var(--text-muted)" },
  claim: { background: "var(--primary)", color: "white", border: 0, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  reassignInput: { border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 9px", fontSize: 12, width: 120 },
  reassignBtn: { background: "var(--surface)", color: "var(--primary)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  primary: { background: "#2563eb", color: "white", border: 0, borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer" },
  pre: { background: "#f8fafc", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginTop: 8 },
};
