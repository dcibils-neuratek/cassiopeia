import { useEffect, useState } from "react";
import { api } from "./api.js";
import { FormDesigner } from "./FormDesigner.js";

const uid = () => Math.random().toString(36).slice(2, 7);

// Standalone forms library: manage every reusable form in one place. The editor
// on the right is the same FormDesigner used inside the flow designer.
export function Forms() {
  const [list, setList] = useState<{ id: string; title: string }[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // force-remount the editor after external changes
  const [collapsed, setCollapsed] = useState(false);

  async function reload(selectId?: string) {
    const r = await api("/forms");
    if (r.ok) {
      setList(r.data);
      setSel((cur) => selectId ?? cur ?? (r.data[0]?.id ?? null));
    }
  }
  useEffect(() => { reload(); }, []);

  async function newForm() {
    const id = `form_${uid()}`;
    await api(`/forms/${id}`, { method: "POST", body: JSON.stringify({ id, version: 1, title: "Formulario sin título", fields: [] }) });
    await reload(id);
    setNonce((n) => n + 1);
  }
  async function duplicate(id: string) {
    const r = await api(`/forms/${id}/duplicate`, { method: "POST" });
    if (r.ok) { await reload(r.data.id); setNonce((n) => n + 1); }
  }
  async function remove(id: string, title: string) {
    if (!window.confirm(`¿Eliminar el formulario "${title}"?`)) return;
    const r = await api(`/forms/${id}`, { method: "DELETE" });
    if (!r.ok && r.data?.usedBy) {
      alert(`No se puede eliminar: lo usan estos flujos → ${r.data.usedBy.join(", ")}`);
      return;
    }
    const next = list.find((f) => f.id !== id)?.id ?? null;
    await reload(next ?? undefined);
    setSel(next);
    setNonce((n) => n + 1);
  }

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {collapsed ? (
        <button style={S.rail} title="Mostrar formularios" onClick={() => setCollapsed(false)}>
          <span style={{ fontSize: 16 }}>»</span>
          <span style={S.railLabel}>Formularios ({list.length})</span>
        </button>
      ) : (
      <div style={S.sideCard}>
        <div style={S.sideHead}>
          <span style={S.eyebrow}>Formularios ({list.length})</span>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button style={S.newBtn} onClick={newForm}>+ Nuevo</button>
            <button style={S.iconBtn} title="Colapsar" onClick={() => setCollapsed(true)}>«</button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, flex: 1, overflowY: "auto", minHeight: 0 }}>
          {list.map((f) => {
            const active = sel === f.id;
            return (
              <div key={f.id} className="hoverable" onClick={() => setSel(f.id)}
                style={{ cursor: "pointer", padding: "10px 12px", borderRadius: 10, border: active ? "1.5px solid var(--primary)" : "1px solid var(--border)", background: active ? "var(--primary-tint)" : "var(--surface-2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}><code>{f.id}</code></div>
                  </div>
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <button style={S.iconBtn} title="Duplicar" onClick={(e) => { e.stopPropagation(); duplicate(f.id); }}>⧉</button>
                    <button style={S.iconBtn} title="Eliminar" onClick={(e) => { e.stopPropagation(); remove(f.id, f.title); }}>×</button>
                  </div>
                </div>
              </div>
            );
          })}
          {list.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Todavía no hay formularios. Creá uno con <b>+ Nuevo</b>.</div>}
        </div>
      </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {sel
          ? <FormDesigner key={`${sel}:${nonce}`} fixedFormId={sel} onSaved={() => reload(sel)} />
          : <div style={{ ...S.sideCard, padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Seleccioná o creá un formulario para diseñarlo.</div>}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  sideCard: { width: 280, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow-sm)", overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 168px)", position: "sticky", top: 20 },
  sideHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: "1px solid var(--border)" },
  eyebrow: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700 },
  newBtn: { background: "var(--primary)", color: "var(--on-primary)", border: 0, borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  iconBtn: { border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", width: 24, height: 24, borderRadius: 6, cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  rail: { flexShrink: 0, width: 40, alignSelf: "stretch", minHeight: 200, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "12px 0", color: "var(--text-muted)" },
  railLabel: { writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
};
