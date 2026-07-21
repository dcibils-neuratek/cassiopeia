import { useEffect, useState } from "react";
import { api } from "./api.js";

// "Sin completar" — applications a customer started in the portal but never
// finished (a draft with no workflow instance yet). Staff can see who got stuck
// and send a one-click recovery email (on-demand; TTL automation comes later).

type Draft = {
  appId: string;
  nodeId: string;
  token: string | null;
  product: string;
  title: string;
  name: string;
  email: string;
  page: number;
  pagesTotal: number;
  updatedAt: string;
  createdAt: string | null;
  resumeUrl?: string;
};

function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "hace instantes";
  const m = Math.floor(secs / 60); if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24); return `hace ${d} día${d === 1 ? "" : "s"}`;
}

export function Drafts() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [mailerReady, setMailerReady] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  async function load() {
    const [d, c] = await Promise.all([api("/drafts"), api("/connectors")]);
    if (d.ok) setDrafts(d.data as Draft[]);
    if (c.ok) setMailerReady((c.data as { id: string }[]).some((x) => x.id === "mailer"));
    setLoading(false);
  }
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  async function remind(d: Draft) {
    setBusy(d.appId); setToast(null);
    const r = await api("/drafts/remind", { method: "POST", body: JSON.stringify({ appId: d.appId, nodeId: d.nodeId }) });
    setBusy(null);
    setToast(r.ok
      ? { id: d.appId, ok: true, msg: `Recordatorio enviado a ${r.data.to}` }
      : { id: d.appId, ok: false, msg: r.data?.error || "No se pudo enviar" });
  }
  function copy(url?: string) { if (url && navigator.clipboard) navigator.clipboard.writeText(url); }
  async function remove(d: Draft) {
    if (!window.confirm(`¿Eliminar la solicitud sin completar de ${d.name || d.email || "este cliente"}? No se puede deshacer.`)) return;
    setBusy(d.appId); setToast(null);
    const r = await api(`/drafts/${d.appId}/${d.nodeId}`, { method: "DELETE" });
    setBusy(null);
    if (r.ok) setDrafts((xs) => xs.filter((x) => x.appId !== d.appId));
    else setToast({ id: d.appId, ok: false, msg: r.data?.error || "No se pudo eliminar" });
  }

  return (
    <div style={{ maxWidth: 960 }}>
      {!mailerReady && (
        <div style={S.warn}>Para enviar recordatorios, configurá el correo en <b>Ajustes → Correo</b>.</div>
      )}

      {loading ? <p style={S.muted}>Cargando…</p> : drafts.length === 0 ? (
        <div style={S.empty}>No hay solicitudes sin completar. 🎉</div>
      ) : (
        <div style={S.card}>
          <div style={{ ...S.row, ...S.head }}>
            <div style={{ flex: 2 }}>Solicitante</div>
            <div style={{ flex: 2 }}>Producto</div>
            <div style={{ flex: 1 }}>Progreso</div>
            <div style={{ flex: 1 }}>Actividad</div>
            <div style={{ flex: 2, textAlign: "right" }}>Acciones</div>
          </div>
          {drafts.map((d) => (
            <div key={d.appId} style={S.row}>
              <div style={{ flex: 2, minWidth: 0 }}>
                <div style={S.name}>{d.name || "—"}</div>
                <div style={S.sub2}>{d.email || "sin email"}</div>
              </div>
              <div style={{ flex: 2 }}>{d.title}</div>
              <div style={{ flex: 1 }}>{d.pagesTotal > 1 ? `Paso ${d.page + 1}/${d.pagesTotal}` : "Inicial"}</div>
              <div style={{ flex: 1, color: "var(--text-muted)", fontSize: 13 }}>{ago(d.updatedAt)}</div>
              <div style={{ flex: 2, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                {d.resumeUrl && <button style={S.ghost} onClick={() => copy(d.resumeUrl)} title={d.resumeUrl}>Copiar link</button>}
                <button style={{ ...S.primary, opacity: d.email ? 1 : 0.5 }} disabled={!d.email || busy === d.appId}
                  onClick={() => remind(d)}>
                  {busy === d.appId ? "Enviando…" : "Enviar recordatorio"}
                </button>
                <button style={S.danger} disabled={busy === d.appId} onClick={() => remove(d)} title="Eliminar (queda auditado)">Eliminar</button>
              </div>
              {toast && toast.id === d.appId && (
                <div style={{ flexBasis: "100%", marginTop: 8, ...(toast.ok ? S.ok : S.err) }}>{toast.msg}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  h1: { fontSize: 35, fontWeight: 700, color: "rgb(10,10,10)", margin: "0 0 4px" },
  lead: { color: "var(--text-muted)", fontSize: 14, margin: "0 0 20px", maxWidth: 640 },
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" },
  head: { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-faint)", fontWeight: 600, background: "var(--bg)" },
  name: { fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  sub2: { color: "var(--text-muted)", fontSize: 12.5 },
  primary: { border: 0, background: "var(--primary)", color: "#fff", borderRadius: 9, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  ghost: { border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", borderRadius: 9, padding: "8px 12px", fontSize: 13, cursor: "pointer" },
  danger: { border: "1px solid #f6caca", background: "var(--surface)", color: "#b91c1c", borderRadius: 9, padding: "8px 12px", fontSize: 13, cursor: "pointer" },
  muted: { color: "var(--text-muted)" },
  empty: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 40, textAlign: "center", color: "var(--text-muted)" },
  warn: { background: "#fff4e5", color: "#9a3412", border: "1px solid #fde3c2", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 },
  ok: { background: "#e7f7ee", color: "#166534", borderRadius: 8, padding: "8px 12px", fontSize: 13 },
  err: { background: "#fdeaea", color: "#991b1b", borderRadius: 8, padding: "8px 12px", fontSize: 13 },
};
