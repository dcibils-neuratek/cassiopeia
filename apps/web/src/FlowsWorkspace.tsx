import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Designer } from "./Designer.js";

const uid = () => Math.random().toString(36).slice(2, 7);

type FlowSummary = { id: string; name: string; status: string; hasPublished: boolean };

// Wraps the flow Designer with a collapsible list of flows on the left (like the
// Integraciones / Formularios catalogs), so you can switch and create flows
// without the top dropdown.
export function FlowsWorkspace({ defId, onSelect }: { defId: string; onSelect: (id: string) => void }) {
  const [list, setList] = useState<FlowSummary[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  async function reload() {
    const r = await api("/definitions");
    if (r.ok) setList(r.data as FlowSummary[]);
  }
  // Refresh on mount, when the active flow changes (new flow / template), and on a
  // light interval so renames/publishes show up without extra wiring.
  useEffect(() => { reload(); }, [defId]);
  useEffect(() => { const t = setInterval(reload, 5000); return () => clearInterval(t); }, []);

  async function newFlow() {
    const id = `flow_${uid()}`;
    const def = {
      id, name: "Flujo sin título", version: 1, status: "draft",
      startNodeId: "start",
      nodes: [{ id: "start", type: "start" }, { id: "end", type: "end", name: "Fin" }],
      edges: [{ id: "e_se", from: "start", to: "end" }],
      layout: { start: { x: 80, y: 180 }, end: { x: 380, y: 180 } },
    };
    await api(`/definitions/${id}/draft`, { method: "POST", body: JSON.stringify(def) });
    await reload();
    onSelect(id);
  }

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {collapsed ? (
        <button style={S.rail} title="Mostrar flujos" onClick={() => setCollapsed(false)}>
          <span style={{ fontSize: 16 }}>»</span>
          <span style={S.railLabel}>Flujos ({list.length})</span>
        </button>
      ) : (
        <div style={S.sideCard}>
          <div style={S.sideHead}>
            <span style={S.eyebrow}>Flujos ({list.length})</span>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button style={S.newBtn} onClick={newFlow}>+ Nuevo</button>
              <button style={S.iconBtn} title="Colapsar" onClick={() => setCollapsed(true)}>«</button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, flex: 1, overflowY: "auto", minHeight: 0 }}>
            {list.map((f) => {
              const active = defId === f.id;
              return (
                <div key={f.id} className="hoverable" onClick={() => onSelect(f.id)}
                  style={{ cursor: "pointer", padding: "10px 12px", borderRadius: 10, border: active ? "1.5px solid var(--primary)" : "1px solid var(--border)", background: active ? "var(--primary-tint)" : "var(--surface-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}><code>{f.id}</code></div>
                    </div>
                    <span style={f.hasPublished ? S.pubPill : S.draftPill}>{f.hasPublished ? "Publicado" : "Borrador"}</span>
                  </div>
                </div>
              );
            })}
            {list.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Sin flujos. Creá uno con <b>+ Nuevo</b> o desde <b>Plantillas</b>.</div>}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <Designer key={defId} defId={defId} />
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  sideCard: { width: 250, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow-sm)", overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 168px)", position: "sticky", top: 20 },
  rail: { flexShrink: 0, width: 40, alignSelf: "stretch", minHeight: 240, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "12px 0", color: "var(--text-muted)" },
  railLabel: { writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
  sideHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: "1px solid var(--border)" },
  eyebrow: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700 },
  newBtn: { background: "var(--primary)", color: "var(--on-primary)", border: 0, borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  iconBtn: { border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", width: 24, height: 24, borderRadius: 6, cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  pubPill: { fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "2px 7px", background: "#dcfce7", color: "#166534", flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.3 },
  draftPill: { fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "2px 7px", background: "#fef3c7", color: "#92400e", flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.3 },
};
