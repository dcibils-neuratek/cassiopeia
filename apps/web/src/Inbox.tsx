import { useEffect, useState } from "react";
import type { FormDefinition } from "@cassiopeia/model";
import { FormRenderer, type FormValues } from "@cassiopeia/form-kit";
import { api, uploadFile } from "./api.js";

type Task = {
  id: string; instanceId: string; nodeId: string; formId: string | null;
  defId: string; processName: string; nodeName: string; formTitle: string | null;
  dueAt?: string | null; assignee?: string | null; role?: string | null; priority?: string | null;
  route?: { from: string[]; to: string[] };
  context: Record<string, unknown>;
};

const PRIO_COLOR: Record<string, string> = { high: "#dc2626", normal: "#2563eb", low: "#64748b" };
const PRIO_ES: Record<string, string> = { high: "alta", normal: "normal", low: "baja" };

// Friendly Spanish labels for the well-known context keys the demo produces.
const FIELD_ES: Record<string, string> = {
  fullName: "Nombre", email: "Email", phone: "Teléfono", document: "Documento",
  annualIncome: "Ingreso anual", amount: "Monto solicitado", termYears: "Plazo (años)",
  employmentStatus: "Situación laboral", creditScore: "Score crediticio",
  decision: "Decisión del agente", reasoning: "Razonamiento", confidence: "Confianza",
  purpose: "Destino", monthlyPayment: "Cuota mensual", rate: "Tasa", offer: "Oferta",
  notes: "Notas", status: "Estado",
};
const VALUE_ES: Record<string, string> = {
  approve: "Aprobar", reject: "Rechazar", review: "Revisar", self: "Independiente",
  employed: "En relación de dependencia", unemployed: "Desempleado",
};
// Keys that describe the AI/automated analysis — surfaced as a highlighted card.
const AI_KEYS = ["decision", "reasoning", "confidence", "creditScore"];
const labelFor = (k: string) => FIELD_ES[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
function fmtValue(k: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    if (k === "confidence") return `${Math.round(v * 100)}%`;
    if (/income|amount|payment|offer/i.test(k)) return v.toLocaleString("es");
    return String(v);
  }
  if (typeof v === "string") return VALUE_ES[v] ?? v;
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return JSON.stringify(v);
}

export function Inbox({ me }: { me: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [defs, setDefs] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [sel, setSel] = useState<Task | null>(null);
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [rawOpen, setRawOpen] = useState(false);

  async function reload() {
    const r = await api("/tasks");
    setTasks(r.data);
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
      if (!r.ok) alert(r.data?.error ?? "No se pudo reasignar");
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
      {/* ---- task list ---- */}
      <div style={{ width: 380, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <div style={S.bar}>
          <span style={S.head}>Tareas ({shown.length})</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
                style={{ textAlign: "left", cursor: "pointer", padding: "12px 14px 12px 16px", borderRadius: 11, background: active ? "var(--primary-tint)" : "var(--surface-2)", border: active ? "1.5px solid var(--primary)" : "1px solid var(--border)", boxShadow: `inset 4px 0 0 ${PRIO_COLOR[prio]}` }}>
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

      {/* ---- work panel ---- */}
      <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow-sm)", overflow: "hidden" }}>
        {!sel && <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Seleccioná una tarea de la izquierda para trabajarla.</div>}
        {sel && (
          <>
            {/* header */}
            <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{sel.processName}</div>
                  <h2 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 800 }}>{sel.nodeName}</h2>
                </div>
                <span style={{ ...S.prioPill, background: PRIO_COLOR[sel.priority ?? "normal"] + "22", color: PRIO_COLOR[sel.priority ?? "normal"] }}>prioridad {PRIO_ES[sel.priority ?? "normal"]}</span>
              </div>
              {/* process route: where it comes from → here → where it goes */}
              <Route from={sel.route?.from ?? []} current={sel.nodeName} to={sel.route?.to ?? []} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
                {sel.role && <span style={S.tag}>rol: {sel.role}</span>}
                <span style={S.tag}>asignado: {sel.assignee || "sin asignar"}</span>
                {sel.dueAt && <span style={{ ...S.tag, color: overdue(sel) ? "#dc2626" : undefined }}>{overdue(sel) ? "vencida" : "vence"} {new Date(sel.dueAt).toLocaleString()}</span>}
                <span style={S.tag}>caso <code>{sel.instanceId.slice(0, 8)}</code></span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {/* left column: what you need to know */}
              <div style={{ padding: 20, borderRight: "1px solid var(--border)" }}>
                <div style={S.head}>Lo que tenés que revisar</div>
                <AiCard ctx={sel.context} />
                <SummaryList ctx={sel.context} />
                <button style={S.rawToggle} onClick={() => setRawOpen((v) => !v)}>{rawOpen ? "▾ Ocultar datos crudos" : "▸ Ver todos los datos (JSON)"}</button>
                {rawOpen && <pre style={S.pre}>{JSON.stringify(sel.context, null, 2)}</pre>}
              </div>

              {/* right column: take action */}
              <div style={{ padding: 20 }}>
                <div style={S.head}>Tu decisión</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "10px 0 14px" }}>
                  {sel.assignee !== me && (
                    <button style={S.claim} disabled={busy} onClick={() => claim(sel)}>Tomar como {me}</button>
                  )}
                  <input style={S.reassignInput} placeholder="reasignar a…" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} />
                  <button style={S.reassignBtn} disabled={busy || !reassignTo.trim()} onClick={() => reassign(sel)}>Reasignar</button>
                </div>
                {sel.formId && form && <FormRenderer key={sel.id} form={form} initial={sel.context as any} submitLabel={busy ? "Procesando…" : "Completar tarea"} onSubmit={complete} uploadFile={uploadFile} />}
                {sel.formId && !form && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Cargando formulario…</p>}
                {!sel.formId && (
                  <>
                    <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Esta tarea no tiene formulario — confirmá para continuar el flujo.</p>
                    <button style={S.primary} disabled={busy} onClick={completeNoForm}>Completar tarea</button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The mini flow strip: previous step(s) → current → next step(s).
function Route({ from, current, to }: { from: string[]; current: string; to: string[] }) {
  const Chip = ({ text, tone }: { text: string; tone: "muted" | "now" }) => (
    <span style={{
      fontSize: 12, padding: "4px 10px", borderRadius: 8, whiteSpace: "nowrap",
      background: tone === "now" ? "var(--primary)" : "var(--surface-3)",
      color: tone === "now" ? "var(--on-primary)" : "var(--text-muted)",
      fontWeight: tone === "now" ? 700 : 500, border: tone === "now" ? 0 : "1px solid var(--border)",
    }}>{text}</span>
  );
  const arrow = <span style={{ color: "var(--text-faint)", fontSize: 13 }}>→</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 12, padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
      <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-faint)", fontWeight: 700, marginRight: 2 }}>Ruta</span>
      {from.length === 0 && <Chip text="Inicio" tone="muted" />}
      {from.map((f, i) => <Chip key={"f" + i} text={f} tone="muted" />)}
      {arrow}
      <Chip text={current} tone="now" />
      {to.length > 0 && arrow}
      {to.map((t, i) => <Chip key={"t" + i} text={t} tone="muted" />)}
    </div>
  );
}

// Highlighted card for the automated / AI analysis, when present in context.
function AiCard({ ctx }: { ctx: Record<string, unknown> }) {
  const has = AI_KEYS.some((k) => ctx[k] != null);
  if (!has) return null;
  const decision = ctx.decision as string | undefined;
  const tone = decision === "approve" ? "#16a34a" : decision === "reject" ? "#dc2626" : "#d97706";
  return (
    <div style={{ border: `1px solid ${tone}44`, background: `${tone}0f`, borderRadius: 12, padding: "12px 14px", margin: "10px 0 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 15 }}>✦</span>
        <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: tone }}>Análisis del agente IA</span>
        {decision && <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: tone }}>{VALUE_ES[decision] ?? decision}</span>}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: ctx.reasoning ? 8 : 0 }}>
        {ctx.creditScore != null && <Fact label="Score crediticio" value={String(ctx.creditScore)} />}
        {ctx.confidence != null && <Fact label="Confianza" value={`${Math.round((ctx.confidence as number) * 100)}%`} />}
      </div>
      {ctx.reasoning != null && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>{String(ctx.reasoning)}</p>}
    </div>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

// Readable key/value list of the applicant/context data (AI keys excluded — shown above).
function SummaryList({ ctx }: { ctx: Record<string, unknown> }) {
  const rows = Object.entries(ctx).filter(([k, v]) =>
    !AI_KEYS.includes(k) && v != null && typeof v !== "object");
  if (rows.length === 0) return <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Sin datos del solicitante.</p>;
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "0" }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ gridColumn: 1, padding: "7px 12px 7px 0", fontSize: 12.5, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>{labelFor(k)}</dt>
          <dd style={{ gridColumn: 2, padding: "7px 0", margin: 0, fontSize: 13.5, fontWeight: 600, borderTop: "1px solid var(--border)" }}>{fmtValue(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

const S: Record<string, React.CSSProperties> = {
  bar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: "1px solid var(--border)", gap: 10, flexWrap: "wrap" },
  head: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700 },
  select: { border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", fontSize: 12, background: "var(--surface)", fontWeight: 600, color: "var(--text)" },
  tag: { fontSize: 11, background: "var(--surface-3)", borderRadius: 6, padding: "3px 8px", color: "var(--text-muted)" },
  prioPill: { fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: "3px 10px", textTransform: "uppercase", letterSpacing: 0.3 },
  claim: { background: "var(--primary)", color: "var(--on-primary)", border: 0, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  reassignInput: { border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 9px", fontSize: 12, width: 120 },
  reassignBtn: { background: "var(--surface)", color: "var(--primary)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  primary: { background: "var(--primary)", color: "var(--on-primary)", border: 0, borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600, marginTop: 8 },
  rawToggle: { marginTop: 14, background: "transparent", border: 0, color: "var(--text-muted)", fontSize: 12, cursor: "pointer", padding: 0, fontWeight: 600 },
  pre: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginTop: 8 },
};
