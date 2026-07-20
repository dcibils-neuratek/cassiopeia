import { useEffect, useState } from "react";
import type { FormDefinition } from "@cassiopeia/model";
import { FormRenderer, type FormValues } from "@cassiopeia/form-kit";
import { api, uploadFile } from "./api.js";

type OpenTask = { id: string; nodeId: string; formId: string | null } | null;
type OpenTimer = { nodeId: string; wakeAt: string } | null;
type Instance = { id: string; status: string; currentNodeId: string; context: Record<string, unknown> };
type Event = { type: string; nodeId?: string; payload?: unknown };
type State = { instance: Instance; openTask: OpenTask; openTimer?: OpenTimer; events: Event[] };

export function Portal({ defId, autoStart }: { defId: string; autoStart?: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [form, setForm] = useState<FormDefinition | null>(null);

  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const formId = state?.openTask?.formId;
    if (!formId) {
      setForm(null);
      return;
    }
    api(`/forms/${formId}`).then((r) => setForm(r.data));
  }, [state?.openTask?.id, state?.openTask?.formId]);

  async function start() {
    const { data } = await api(`/definitions/${defId}/start`, { method: "POST" });
    setState((await api(`/instances/${data.instanceId}`)).data);
  }

  async function submit(patch: FormValues) {
    if (!state?.openTask) return;
    await api(`/tasks/${state.openTask.id}/submit`, { method: "POST", body: JSON.stringify(patch) });
    setState((await api(`/instances/${state.instance.id}`)).data);
  }

  // While the run is parked on a timer, poll so the UI resumes when it fires.
  useEffect(() => {
    if (!state?.openTimer) return;
    const id = state.instance.id;
    const t = setInterval(async () => {
      setState((await api(`/instances/${id}`)).data);
    }, 2000);
    return () => clearInterval(t);
  }, [state?.openTimer?.wakeAt, state?.instance.id]);

  return (
    <div>
      <button style={S.primary} onClick={start}>Start new instance</button>
      {state && (
        <div style={S.grid}>
          <section style={S.card}>
            <h2 style={S.h2}>{form ? form.title : "Current task"}</h2>
            {!state.openTask && state.openTimer && (
              <p style={{ color: "#0891b2", fontWeight: 600 }}>
                ⏱ Waiting until {new Date(state.openTimer.wakeAt).toLocaleString()} — the run resumes automatically.
              </p>
            )}
            {!state.openTask && !state.openTimer && (
              <p style={{ color: "#16a34a", fontWeight: 600 }}>
                ✓ No open task — instance is {state.instance.status}
              </p>
            )}
            {state.openTask && form && (
              <FormRenderer key={state.openTask.id} form={form} initial={state.instance.context as any} submitLabel="Submit" onSubmit={submit} uploadFile={uploadFile} />
            )}
            {state.openTask && !form && <p style={{ color: "#64748b" }}>Loading form…</p>}
          </section>

          <section style={S.card}>
            <h2 style={S.h2}>Instance</h2>
            <div style={S.kv}><span>status</span><b>{state.instance.status}</b></div>
            <div style={S.kv}><span>at node</span><b>{state.instance.currentNodeId}</b></div>
            <pre style={S.pre}>{JSON.stringify(state.instance.context, null, 2)}</pre>
          </section>

          <section style={{ ...S.card, gridColumn: "1 / -1" }}>
            <h2 style={S.h2}>Audit trail</h2>
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {state.events.map((e, i) => (
                <li key={i} style={{ fontFamily: "monospace", fontSize: 13 }}>
                  {e.type}{e.nodeId ? ` @${e.nodeId}` : ""}
                  {e.payload !== undefined ? `  ${JSON.stringify(e.payload)}` : ""}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  primary: { background: "#2563eb", color: "white", border: 0, borderRadius: 8, padding: "10px 16px", fontSize: 14, cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 24, alignItems: "start" },
  card: { border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, background: "white", color: "#0f172a" },
  h2: { fontSize: 14, textTransform: "uppercase", letterSpacing: 0.5, color: "#64748b", marginTop: 0 },
  kv: { display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #f1f5f9" },
  pre: { background: "#f8fafc", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginTop: 8 },
};
