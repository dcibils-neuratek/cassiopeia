import { useEffect, useState } from "react";
import { api } from "./api.js";

type Template = {
  id: string;
  name: string;
  description: string;
  teaches: string[];
  steps: string[];
};

const ICON: Record<string, string> = {
  onboarding: "🧾",
  "mortgage-sim": "🏠",
  "personal-credit": "💳",
  "travel-notification": "✈️",
};

export function Templates({ onUse }: { onUse: (defId: string) => void }) {
  const [list, setList] = useState<Template[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api("/templates").then((r) => setList(r.data));
  }, []);

  async function use(id: string) {
    setBusy(id);
    const r = await api(`/templates/${id}/install`, { method: "POST" });
    setBusy(null);
    if (r.ok) onUse(r.data.defId);
  }

  return (
    <div>
      <p style={{ color: "#475569", marginTop: 0, maxWidth: 720 }}>
        Start from a ready-made banking workflow. Installing a template loads its process,
        forms, and connectors — open <b>Build</b> to see how it's wired, tweak it, then <b>Run</b> it.
      </p>
      <div style={S.grid}>
        {list.map((t) => (
          <div key={t.id} style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={S.icon}>{ICON[t.id] ?? "⚙️"}</div>
              <h3 style={{ margin: 0, fontSize: 17 }}>{t.name}</h3>
            </div>
            <p style={{ color: "#475569", fontSize: 14, lineHeight: 1.5 }}>{t.description}</p>

            <div style={S.teachHead}>What it teaches</div>
            <ul style={S.teach}>
              {t.teaches.map((x, i) => <li key={i}>{x}</li>)}
            </ul>

            {open === t.id && (
              <div style={S.steps}>
                <div style={S.teachHead}>How to implement it</div>
                <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, fontSize: 13, color: "#334155" }}>
                  {t.steps.map((x, i) => <li key={i}>{x}</li>)}
                </ol>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 14 }}>
              <button style={S.primary} disabled={busy === t.id} onClick={() => use(t.id)}>
                {busy === t.id ? "Installing…" : "Use this template →"}
              </button>
              <button style={S.ghost} onClick={() => setOpen(open === t.id ? null : t.id)}>
                {open === t.id ? "Hide steps" : "How to implement"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16, marginTop: 8 },
  card: { border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, background: "white", display: "flex", flexDirection: "column" },
  icon: { fontSize: 24, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", background: "#e8effe", borderRadius: 10 },
  teachHead: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#64748b", fontWeight: 700, marginTop: 4 },
  teach: { margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6, fontSize: 13, color: "#334155" },
  steps: { marginTop: 12, background: "#f8fafc", borderRadius: 10, padding: 12 },
  primary: { background: "#2563eb", color: "white", border: 0, borderRadius: 8, padding: "9px 16px", fontSize: 14, cursor: "pointer" },
  ghost: { background: "white", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer" },
};
