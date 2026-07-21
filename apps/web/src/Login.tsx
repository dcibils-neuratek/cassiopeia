import { useState } from "react";
import { api, setToken } from "./api.js";

export type CurrentUser = { id: string; username: string; displayName: string; role: string; area?: string | null };

export function Login({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    setBusy(false);
    if (r.ok && r.data.token) { setToken(r.data.token); onLogin(r.data.user); }
    else setErr(r.data?.error ?? "No se pudo iniciar sesión");
  }

  return (
    <div style={S.wrap}>
      <form onSubmit={submit} style={S.card} className="fade-in">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={S.logo}>✦</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.02 }}>Cassiopeia</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>process &amp; form studio</div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "10px 0 18px" }}>Iniciá sesión para continuar.</p>

        <label style={S.label}>Usuario</label>
        <input autoFocus style={S.input} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
        <label style={S.label}>Contraseña</label>
        <input style={S.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />

        {err && <div style={S.err}>{err}</div>}
        <button style={S.btn} disabled={busy} type="submit">{busy ? "Ingresando…" : "Ingresar"}</button>
        <p style={S.hint}>El primer arranque crea <b>admin</b> / <b>admin</b> — cambialo en producción.</p>
      </form>
      <div style={S.powered}>POWERED BY <b style={{ color: "var(--text-muted)" }}>Neuratek</b></div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 20 },
  card: { width: "min(400px, 94vw)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 28, boxShadow: "var(--shadow-lg)" },
  logo: { width: 40, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--on-primary)", fontSize: 20, background: "linear-gradient(135deg, var(--primary), var(--primary-strong))", boxShadow: "var(--shadow-md)" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 12, marginBottom: 5 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", padding: "10px 12px", fontSize: 14 },
  err: { background: "var(--danger-tint)", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 14 },
  btn: { width: "100%", marginTop: 18, background: "var(--primary)", color: "white", border: 0, borderRadius: "var(--radius-sm)", padding: "11px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  hint: { fontSize: 11.5, color: "var(--text-faint)", marginTop: 14, textAlign: "center" },
  powered: { fontSize: 10, letterSpacing: 0.6, color: "var(--text-faint)", fontWeight: 700 },
};
