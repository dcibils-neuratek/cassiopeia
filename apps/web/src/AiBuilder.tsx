import { useState } from "react";
import { api } from "./api.js";

// "Construir con IA" — a dedicated surface that turns a natural-language prompt
// (or a mermaid diagram) into a full flow + forms + integrations. Two steps:
//   1) Plan  — POST /ai-build/plan generates the artifacts WITHOUT saving.
//   2) Commit — the user reviews the plan, then POST /ai-build/commit persists
//      everything and we jump into the flow designer.

type Field = { label?: string; kind?: string };
type FormDef = { id: string; title?: string; fields?: Field[] };
type Node = { id: string; type: string; name?: string; formId?: string; connectorId?: string };
type Connector = { id: string; type: string; config?: Record<string, any> };
type Plan = {
  reply: string;
  definition: { id: string; name: string; nodes: Node[] };
  forms: FormDef[];
  connectors: Connector[];
  errors: string[];
};

const EXAMPLES = [
  "Alta de cuenta: el cliente carga sus datos y documento, verificamos identidad con un agente; si aprueba pasa a firma, si no a revisión manual.",
  "Solicitud de préstamo: el cliente pide monto y plazo, un agente evalúa riesgo, si el score es alto aprueba automático, si no va a comité.",
  "Reclamo de tarjeta: el cliente describe el problema, un agente lo clasifica y arma la respuesta, un analista revisa y confirma.",
];

const TYPE_LABEL: Record<string, string> = {
  "ai-agent": "Agente de IA", "maverick-agent": "Agente Maverick", mcp: "MCP", http: "API",
};

// Inline SVG icons (some unicode glyphs render as tofu) — same look as the shell.
function Ic({ name, size = 14 }: { name: string; size?: number }) {
  const p: Record<string, React.ReactNode> = {
    flow: <><rect x="9" y="3" width="6" height="4" rx="1" /><rect x="3" y="17" width="6" height="4" rx="1" /><rect x="15" y="17" width="6" height="4" rx="1" /><path d="M12 7v4" /><path d="M6 17v-2h12v2" /></>,
    form: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" /></>,
    integration: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />,
    gateway: <path d="M12 3 21 12 12 21 3 12Z" />,
    dot: <circle cx="12" cy="12" r="4" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, verticalAlign: "-2px" }}>
      {p[name]}
    </svg>
  );
}
const NODE_ICON: Record<string, string> = { userTask: "form", serviceTask: "integration", gateway: "gateway" };
const needsKey = (c: Connector) => {
  const cfg = c.config ?? {};
  return !cfg.apiKey && !cfg.token; // freshly generated integrations have no secret yet
};

export function AiBuilder({ onCreated }: { onCreated: (id: string) => void }) {
  const [instruction, setInstruction] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState<"plan" | "commit" | null>(null);
  const [error, setError] = useState("");

  async function generate() {
    if (!instruction.trim()) return;
    setLoading("plan"); setError("");
    const r = await api("/ai-build/plan", { method: "POST", body: JSON.stringify({ instruction }) });
    setLoading(null);
    if (r.ok && r.data?.ok) setPlan(r.data as Plan);
    else setError(r.data?.error || "No pude generar el plan. Probá reformular la descripción.");
  }

  async function commit() {
    if (!plan) return;
    setLoading("commit"); setError("");
    const r = await api("/ai-build/commit", {
      method: "POST",
      body: JSON.stringify({ definition: plan.definition, forms: plan.forms, connectors: plan.connectors }),
    });
    setLoading(null);
    if (r.ok && r.data?.ok) onCreated(r.data.id as string);
    else setError(r.data?.error || "No pude crear los artefactos.");
  }

  // ---------- Step 1: describe ----------
  if (!plan) {
    return (
      <div style={{ maxWidth: 720 }}>
        <div style={S.card}>
          <div style={S.eyebrowRow}>
            <span style={S.spark}>✦</span>
            <span style={S.eyebrow}>Describí el proceso</span>
          </div>
          <p style={S.lead}>
            Contá en tus palabras qué tiene que hacer el flujo — o pegá un diagrama
            (por ejemplo mermaid). La IA arma el flujo, los formularios y las
            integraciones, y te muestra un plan para que lo apruebes antes de crear nada.
          </p>
          <textarea
            style={S.textarea}
            placeholder="Ej: Alta de cuenta — el cliente carga sus datos y documento, un agente verifica la identidad; si aprueba pasa a firma, si no a revisión manual."
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {EXAMPLES.map((ex, i) => (
              <button key={i} style={S.exampleChip} onClick={() => setInstruction(ex)} title={ex}>
                {ex.split(":")[0]}
              </button>
            ))}
          </div>
          {error && <div style={S.error}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button style={S.primaryBtn} onClick={generate} disabled={!instruction.trim() || loading === "plan"}>
              {loading === "plan" ? "Planificando…" : "✦ Generar plan"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Step 2: review the plan ----------
  const { definition, forms, connectors } = plan;
  const formById = new Map(forms.map((f) => [f.id, f]));
  const total = 1 + forms.length + connectors.length;
  const chipStyle = (n: Node): React.CSSProperties =>
    n.type === "userTask" ? S.chipForm
    : n.type === "serviceTask" ? S.chipAgent
    : n.type === "gateway" ? S.chipGateway
    : S.chipPlain;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={S.card}>
        {/* prompt echo */}
        <div style={S.echo}>
          <span style={S.spark}>✦</span>
          <div>
            <div style={S.echoLabel}>Tu descripción</div>
            <div style={S.echoText}>{instruction}</div>
          </div>
        </div>

        <div style={S.planHead}>Voy a crear estos artefactos</div>
        <div style={S.planSub}>Revisá el plan. Todavía no se creó nada — se crea cuando confirmes.</div>

        {/* counters */}
        <div style={S.counters}>
          <Counter icon="flow" n={1} label="Flujo" />
          <Counter icon="form" n={forms.length} label={forms.length === 1 ? "Formulario" : "Formularios"} />
          <Counter icon="integration" n={connectors.length} label={connectors.length === 1 ? "Integración" : "Integraciones"} />
        </div>

        {/* flow as a chain of steps */}
        <div style={S.section}>
          <div style={S.sectionHead}><Ic name="flow" size={15} /> Flujo · {definition.name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {definition.nodes.map((n, i) => (
              <span key={n.id} style={{ display: "contents" }}>
                <span style={chipStyle(n)}>
                  <Ic name={NODE_ICON[n.type] || "dot"} size={13} />
                  {n.name || (n.type === "start" ? "Inicio" : n.type === "end" ? "Fin" : n.id)}
                </span>
                {i < definition.nodes.length - 1 && <span style={S.arrow}>→</span>}
              </span>
            ))}
          </div>
        </div>

        {/* forms */}
        {forms.length > 0 && (
          <div style={S.gridTwo}>
            {forms.map((f) => (
              <div key={f.id} style={S.artCard}>
                <div style={S.artHead}><span style={{ color: "var(--primary)" }}><Ic name="form" /></span> {f.title || "Formulario"}</div>
                <div style={S.artBody}>{(f.fields ?? []).map((x) => x.label).filter(Boolean).join(" · ") || "Sin campos"}</div>
              </div>
            ))}
          </div>
        )}

        {/* integrations */}
        {connectors.map((c) => (
          <div key={c.id} style={S.artCardWide}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={S.artHead}>
                <span style={{ color: "#b45309" }}><Ic name="integration" /></span>
                {(c.config?.label as string) || c.id}
                <span style={S.typePill}>{TYPE_LABEL[c.type] || c.type}</span>
              </div>
              {needsKey(c) && <span style={S.keyNote}>necesita tu API key</span>}
            </div>
            {c.config?.purpose && <div style={S.artBody}>{c.config.purpose as string}</div>}
          </div>
        ))}

        {plan.errors?.length > 0 && (
          <div style={S.warnBox}>
            ⚠ Revisá al crear: {plan.errors.join(" · ")}
          </div>
        )}
        {error && <div style={S.error}>{error}</div>}

        {/* actions */}
        <div style={S.actions}>
          <button style={S.ghostBtn} onClick={() => setPlan(null)} disabled={loading === "commit"}>↺ Ajustar descripción</button>
          <button style={S.primaryBtn} onClick={commit} disabled={loading === "commit"}>
            {loading === "commit" ? "Creando…" : `✓ Confirmar y crear ${total} artefacto${total === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Counter({ icon, n, label }: { icon: string; n: number; label: string }) {
  return (
    <div style={S.counter}>
      <div style={S.counterN}><span style={{ color: "var(--text-muted)" }}><Ic name={icon} size={17} /></span> {n}</div>
      <div style={S.counterLabel}>{label}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  card: { border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", boxShadow: "var(--shadow-sm)", padding: 22 },
  eyebrowRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  spark: { color: "var(--primary)", fontSize: 15 },
  eyebrow: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700 },
  lead: { fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 14px" },
  textarea: { width: "100%", minHeight: 120, resize: "vertical", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-2)", fontSize: 14, lineHeight: 1.6, fontFamily: "inherit", color: "var(--text)", boxSizing: "border-box" },
  exampleChip: { border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-muted)", borderRadius: 16, padding: "5px 12px", fontSize: 12.5, cursor: "pointer", fontWeight: 600 },
  primaryBtn: { background: "var(--primary)", color: "var(--on-primary)", border: 0, borderRadius: 10, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  ghostBtn: { background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  error: { marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "#fef2f2", color: "#991b1b", fontSize: 13, border: "1px solid #fecaca" },

  echo: { display: "flex", gap: 10, alignItems: "flex-start", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 16 },
  echoLabel: { fontSize: 12, color: "var(--text-faint)", marginBottom: 2 },
  echoText: { fontSize: 14, color: "var(--text)", lineHeight: 1.6 },
  planHead: { fontSize: 16, fontWeight: 700, color: "var(--text)" },
  planSub: { fontSize: 13, color: "var(--text-muted)", margin: "2px 0 16px", lineHeight: 1.5 },

  counters: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 },
  counter: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" },
  counterN: { fontSize: 22, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 },
  counterLabel: { fontSize: 13, color: "var(--text-muted)", marginTop: 2 },

  section: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 12 },
  sectionHead: { fontSize: 14, fontWeight: 700, marginBottom: 12, color: "var(--text)" },
  arrow: { color: "var(--text-faint)", fontSize: 13, margin: "0 1px" },
  chipForm: { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--primary-tint)", color: "var(--primary)", fontSize: 12.5, padding: "5px 11px", borderRadius: 16, fontWeight: 600, whiteSpace: "nowrap" },
  chipAgent: { display: "inline-flex", alignItems: "center", gap: 5, background: "#fef3c7", color: "#92400e", fontSize: 12.5, padding: "5px 11px", borderRadius: 16, fontWeight: 600, whiteSpace: "nowrap" },
  chipGateway: { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--surface)", color: "var(--text-muted)", fontSize: 12.5, padding: "5px 11px", borderRadius: 16, fontWeight: 600, border: "1px solid var(--border)", whiteSpace: "nowrap" },
  chipPlain: { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--surface)", color: "var(--text-muted)", fontSize: 12.5, padding: "5px 11px", borderRadius: 16, fontWeight: 600, border: "1px solid var(--border)", whiteSpace: "nowrap" },

  gridTwo: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 12 },
  artCard: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" },
  artCardWide: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 12 },
  artHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: "var(--text)" },
  artBody: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.7, marginTop: 8 },
  typePill: { background: "#fef3c7", color: "#92400e", fontSize: 11, padding: "2px 8px", borderRadius: 6, fontWeight: 700 },
  keyNote: { fontSize: 12, color: "var(--text-faint)", whiteSpace: "nowrap" },

  warnBox: { padding: "10px 12px", borderRadius: 10, background: "#fffbeb", color: "#92400e", fontSize: 12.5, border: "1px solid #fde68a", marginBottom: 12, lineHeight: 1.5 },
  actions: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 4 },
};
