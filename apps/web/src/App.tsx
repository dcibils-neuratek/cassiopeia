import { useEffect, useState } from "react";
import { Designer } from "./Designer.js";
import { Portal } from "./Portal.js";
import { Monitor } from "./Monitor.js";
import { Templates } from "./Templates.js";
import { Home } from "./Home.js";
import { Stats } from "./Stats.js";
import { Settings } from "./Settings.js";
import { Inbox } from "./Inbox.js";
import { Login, type CurrentUser } from "./Login.js";
import { api, getToken, setToken } from "./api.js";
import { t } from "./i18n.js";

type Mode = "home" | "stats" | "templates" | "build" | "run" | "inbox" | "monitor" | "settings";
type DefSummary = { id: string; name: string };

const ROLE_RANK: Record<string, number> = { viewer: 0, operator: 1, analyst: 2, admin: 3 };
const MODE_MIN: Record<Mode, string> = {
  home: "viewer", stats: "viewer", monitor: "viewer",
  run: "operator", inbox: "operator",
  templates: "analyst", build: "analyst",
  settings: "admin",
};
const canSee = (role: string, mode: Mode) => (ROLE_RANK[role] ?? 0) >= ROLE_RANK[MODE_MIN[mode]];

const HINTS: Record<Mode, string> = {
  home: "Your workflows at a glance",
  stats: "Monitor runs across all workflows",
  templates: "Start from a ready-made banking workflow",
  build: "Design the process and its forms",
  run: "Try it as an end user",
  inbox: "Your worklist of open human tasks",
  monitor: "Watch running instances",
  settings: "API keys and connectors",
};
const TITLES: Record<Mode, string> = {
  home: "Home", stats: "Stats", templates: "Templates", build: "Build",
  run: "Run", inbox: "Inbox", monitor: "Monitor", settings: "Settings",
};

const GROUPS: { label: string; items: Mode[] }[] = [
  { label: "Overview", items: ["home", "stats"] },
  { label: "Workflow", items: ["templates", "build", "run", "inbox", "monitor"] },
];

export function App() {
  const [mode, setMode] = useState<Mode>("home");
  const [defId, setDefId] = useState("onboarding");
  const [defs, setDefs] = useState<DefSummary[]>([]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => (localStorage.getItem("cass.theme") as "light" | "dark") || "light");

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("cass.theme", theme); } catch { /* ignore */ } }, [theme]);

  // Resolve the current session on load; react to forced logout (401).
  useEffect(() => {
    (async () => {
      if (getToken()) {
        const r = await api("/auth/me");
        if (r.ok) setUser(r.data);
      }
      setAuthReady(true);
    })();
    const onUnauth = () => setUser(null);
    window.addEventListener("cass-unauth", onUnauth);
    return () => window.removeEventListener("cass-unauth", onUnauth);
  }, []);

  async function refreshDefs() {
    const r = await api("/definitions");
    if (r.ok) setDefs(r.data.map((d: any) => ({ id: d.id, name: d.name })));
  }
  useEffect(() => { if (user) refreshDefs(); }, [user]);
  useEffect(() => { if (user && (mode === "build" || mode === "run")) refreshDefs(); }, [mode]);
  // Keep the active view within the user's role.
  useEffect(() => { if (user && !canSee(user.role, mode)) setMode("home"); }, [user, mode]);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    setToken(null); setUser(null);
  }

  async function useTemplate(id: string) { setDefId(id); await refreshDefs(); setMode("build"); }
  function openWorkflow(id: string, m: "build" | "run") { setDefId(id); setMode(m); }
  async function deleteWorkflow(id: string, name: string) {
    if (!window.confirm(`¿Eliminar "${name}" y todas sus ejecuciones? Esta acción no se puede deshacer.`)) return;
    await api(`/definitions/${id}`, { method: "DELETE" });
    await refreshDefs();
  }

  if (!authReady) return null;
  if (!user) return <Login onLogin={setUser} />;

  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((m) => canSee(user.role, m)) })).filter((g) => g.items.length);
  const showPicker = mode === "build" || mode === "run";

  return (
    <div style={S.shell}>
      <aside style={S.sidebar}>
        <div style={S.brand}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={S.logoMark}>✦</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.2, color: "var(--text)" }}>Cassiopeia</div>
              <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 1, letterSpacing: 0.2 }}>process &amp; form studio</div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {groups.map((g) => (
            <div key={g.label} style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ padding: "0 20px", marginBottom: 6 }}>{t(g.label.toLowerCase())}</div>
              <nav style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 2 }}>
                {g.items.map((id) => (
                  <button key={id} className={mode === id ? undefined : "nav-item"} onClick={() => setMode(id)} style={navItem(mode === id)}>
                    <span style={chip(mode === id)}><Icon name={id} /></span>{t(id)}
                  </button>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <nav style={{ padding: "8px 12px 0", borderTop: "1px solid var(--border)" }}>
          {canSee(user.role, "settings") && (
            <button className={mode === "settings" ? undefined : "nav-item"} onClick={() => setMode("settings")} style={navItem(mode === "settings")}>
              <span style={chip(mode === "settings")}><Icon name="settings" /></span>{t("settings")}
            </button>
          )}
        </nav>

        <div style={S.userRow}>
          <div style={S.avatar}>{(user.displayName || user.username).slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.displayName || user.username}</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{user.role}</div>
          </div>
          <button onClick={logout} title="Sign out" style={S.logoutBtn}>⎋</button>
        </div>
        <div style={S.poweredBy}>POWERED BY <b style={{ color: "var(--text-muted)" }}>Neuratek</b></div>
      </aside>

      <main style={S.main}>
        <div style={S.topbar}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{t(mode)}</h1>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t(mode + "_hint")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {showPicker && (
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
                Proceso
                <select value={defId} onChange={(e) => setDefId(e.target.value)} style={S.select}>
                  {defs.length === 0 && <option value={defId}>{defId}</option>}
                  {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
            )}
            <button onClick={() => setTheme((th) => (th === "light" ? "dark" : "light"))} title="Tema" style={S.iconPill}>{theme === "dark" ? "☀" : "☾"}</button>
            <NotificationBell />
          </div>
        </div>

        <div key={mode} className="fade-in" style={{ marginTop: 20 }}>
          {mode === "home" && <Home onOpen={openWorkflow} onTemplates={() => setMode("templates")} onDelete={canSee(user.role, "settings") ? deleteWorkflow : undefined} />}
          {mode === "stats" && <Stats />}
          {mode === "templates" && <Templates onUse={useTemplate} />}
          {mode === "build" && <Designer key={defId} defId={defId} />}
          {mode === "run" && <Portal key={defId} defId={defId} />}
          {mode === "inbox" && <Inbox me={user.username} />}
          {mode === "monitor" && <Monitor />}
          {mode === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; items: { id: string; message: string; ts: string }[] }>({ unread: 0, items: [] });
  async function load() { const r = await api("/notifications"); if (r.ok) setData(r.data); }
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  async function toggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && data.unread > 0) { await api("/notifications/read", { method: "POST" }); setData((d) => ({ ...d, unread: 0 })); }
  }
  return (
    <div style={{ position: "relative" }}>
      <button onClick={toggle} title="Notificaciones" style={NB.btn}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {data.unread > 0 && <span style={NB.badge}>{data.unread}</span>}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div style={NB.panel}>
            <div style={NB.head}>Notificaciones</div>
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {data.items.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "var(--text-muted)" }}>Sin novedades.</div>}
              {data.items.map((n) => (
                <div key={n.id} style={NB.item}>
                  <div style={{ fontSize: 13 }}>{n.message}</div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{new Date(n.ts).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const NB: Record<string, React.CSSProperties> = {
  btn: { position: "relative", width: 38, height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -5, right: -5, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 9, background: "var(--danger)", color: "white", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  panel: { position: "absolute", right: 0, top: 46, width: 320, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", zIndex: 40, overflow: "hidden" },
  head: { padding: "10px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700, borderBottom: "1px solid var(--border)" },
  item: { padding: "10px 14px", borderBottom: "1px solid var(--surface-3)" },
};

function Icon({ name }: { name: Mode | "settings" }) {
  const p: Record<string, React.ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
    stats: <><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="4" width="3" height="14" /></>,
    templates: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    build: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
    run: <polygon points="6 4 20 12 6 20 6 4" />,
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5Z" /></>,
    monitor: <><path d="M3 3v18h18" /><path d="M7 14l3-4 3 3 4-6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>,
  };
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  );
}

function navItem(active: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
    border: 0, background: active ? "var(--primary-tint)" : "transparent",
    color: active ? "var(--primary)" : "var(--text-muted)", fontWeight: active ? 700 : 500,
    padding: "9px 10px", borderRadius: 10, cursor: "pointer", fontSize: 14,
  };
}
function chip(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
    borderRadius: 8, background: active ? "var(--primary)" : "#eef1f6",
    color: active ? "white" : "var(--text-muted)", flexShrink: 0,
  };
}

const S: Record<string, React.CSSProperties> = {
  shell: { display: "flex", minHeight: "100vh", alignItems: "stretch" },
  sidebar: { width: 246, flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", paddingTop: 22, paddingBottom: 16, position: "sticky", top: 0, height: "100vh" },
  brand: { padding: "0 22px 22px" },
  logoMark: { width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 16, background: "linear-gradient(135deg, #3b82f6, #1e40af)", boxShadow: "0 4px 10px -2px rgba(37,99,235,0.5)", flexShrink: 0 },
  poweredBy: { padding: "12px 22px 0", fontSize: 10, letterSpacing: 0.6, color: "var(--text-faint)", fontWeight: 700 },
  userRow: { display: "flex", alignItems: "center", gap: 10, margin: "12px 14px 0", padding: "8px 10px", background: "var(--surface-3)", borderRadius: 10 },
  avatar: { width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#1e40af)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 },
  logoutBtn: { background: "transparent", border: "1px solid var(--border-strong)", borderRadius: 8, width: 28, height: 28, cursor: "pointer", color: "var(--text-muted)", fontSize: 14, flexShrink: 0 },
  main: { flex: 1, minWidth: 0, padding: "22px 32px 40px" },
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 18, borderBottom: "1px solid var(--border)" },
  select: { border: "1px solid var(--border-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "var(--surface)", fontWeight: 600 },
  iconPill: { width: 38, height: 38, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
};
