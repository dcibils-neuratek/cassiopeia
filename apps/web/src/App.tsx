import { useEffect, useState } from "react";
import { Designer } from "./Designer.js";
import { Portal } from "./Portal.js";
import { Monitor } from "./Monitor.js";
import { Templates } from "./Templates.js";
import { Home } from "./Home.js";
import { Stats } from "./Stats.js";
import { Settings } from "./Settings.js";
import { Inbox } from "./Inbox.js";
import { api } from "./api.js";

type Mode = "home" | "stats" | "templates" | "build" | "run" | "inbox" | "monitor" | "settings";
type DefSummary = { id: string; name: string };

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

  async function refreshDefs() {
    const r = await api("/definitions");
    setDefs(r.data.map((d: any) => ({ id: d.id, name: d.name })));
  }
  useEffect(() => { refreshDefs(); }, []);
  useEffect(() => { if (mode === "build" || mode === "run") refreshDefs(); }, [mode]);

  async function useTemplate(id: string) { setDefId(id); await refreshDefs(); setMode("build"); }
  function openWorkflow(id: string, m: "build" | "run") { setDefId(id); setMode(m); }

  const showPicker = mode === "build" || mode === "run";

  return (
    <div style={S.shell}>
      <aside style={S.sidebar}>
        <div style={S.brand}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.3, color: "var(--primary)" }}>CASSIOPEIA</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>process &amp; form studio</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {GROUPS.map((g) => (
            <div key={g.label} style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ padding: "0 20px", marginBottom: 6 }}>{g.label}</div>
              <nav style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 2 }}>
                {g.items.map((id) => (
                  <button key={id} onClick={() => setMode(id)} style={navItem(mode === id)}>
                    <span style={chip(mode === id)}><Icon name={id} /></span>{TITLES[id]}
                  </button>
                ))}
              </nav>
            </div>
          ))}
        </div>

        <nav style={{ padding: "8px 12px 0", borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setMode("settings")} style={navItem(mode === "settings")}>
            <span style={chip(mode === "settings")}><Icon name="settings" /></span>Settings
          </button>
        </nav>
        <div style={S.poweredBy}>POWERED BY <b style={{ color: "var(--text-muted)" }}>Neuratek</b></div>
      </aside>

      <main style={S.main}>
        <div style={S.topbar}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{TITLES[mode]}</h1>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{HINTS[mode]}</div>
          </div>
          {showPicker && (
            <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
              Process
              <select value={defId} onChange={(e) => setDefId(e.target.value)} style={S.select}>
                {defs.length === 0 && <option value={defId}>{defId}</option>}
                {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
        </div>

        <div style={{ marginTop: 18 }}>
          {mode === "home" && <Home onOpen={openWorkflow} onTemplates={() => setMode("templates")} />}
          {mode === "stats" && <Stats />}
          {mode === "templates" && <Templates onUse={useTemplate} />}
          {mode === "build" && <Designer key={defId} defId={defId} />}
          {mode === "run" && <Portal key={defId} defId={defId} />}
          {mode === "inbox" && <Inbox />}
          {mode === "monitor" && <Monitor />}
          {mode === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}

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
  sidebar: { width: 240, flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", paddingTop: 20, paddingBottom: 16 },
  brand: { padding: "0 20px 20px" },
  poweredBy: { padding: "12px 20px 0", fontSize: 10, letterSpacing: 0.6, color: "var(--text-faint)", fontWeight: 700 },
  main: { flex: 1, minWidth: 0, padding: "22px 28px" },
  topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 },
  select: { border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--text)", background: "white", fontWeight: 600 },
};
