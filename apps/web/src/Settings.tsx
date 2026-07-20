import { useEffect, useState } from "react";
import { api } from "./api.js";
import { McpToolPicker } from "./McpToolPicker.js";

type Connector = { id: string; type: string; config: Record<string, any> };

export function Settings() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [describer, setDescriber] = useState<Connector>({ id: "describer", type: "ai-agent", config: { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5", apiKey: "", jsonOutput: false } });
  const [selId, setSelId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [testInput, setTestInput] = useState('{ "income": 1200 }');
  const [testOut, setTestOut] = useState("");
  const [users, setUsers] = useState<{ id: string; username: string; displayName: string; role: string }[]>([]);
  const [audit, setAudit] = useState<{ ts: string; actor: string; action: string; target: string | null }[]>([]);
  const [nu, setNu] = useState({ username: "", password: "", displayName: "", role: "operator" });

  async function reload() {
    const r = await api("/connectors");
    setConnectors(r.data);
    const d = (r.data as Connector[]).find((c) => c.id === "describer");
    if (d) setDescriber(d);
  }
  async function loadAdmin() {
    const u = await api("/auth/users"); if (u.ok) setUsers(u.data);
    const a = await api("/audit"); if (a.ok) setAudit(a.data);
  }
  useEffect(() => { reload(); loadAdmin(); }, []);

  async function addUser() {
    const r = await api("/auth/users", { method: "POST", body: JSON.stringify(nu) });
    if (r.ok) { setNu({ username: "", password: "", displayName: "", role: "operator" }); setMsg(`User ${r.data.user.username} created`); loadAdmin(); }
    else setMsg(r.data?.error ?? "Could not create user");
  }

  async function save(c: Connector, note: string) {
    await api("/connectors", { method: "POST", body: JSON.stringify(c) });
    setMsg(note);
    reload();
  }
  function newConnector(type: string) {
    const prefix = type === "maverick-agent" ? "mav" : type === "mcp" ? "mcp" : type === "http" ? "http" : "ai";
    const id = `${prefix}_${Math.random().toString(36).slice(2, 6)}`;
    const config = type === "maverick-agent" ? { baseUrl: "https://your-maverick-host", apiKey: "", agentId: "" }
      : type === "mcp" ? { url: "https://your-mcp-server/mcp", toolName: "", apiKey: "" }
      : type === "http" ? { url: "", method: "POST" }
      : { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", apiKey: "", instructions: "You are a task agent inside a business process.", jsonOutput: true };
    const c = { id, type, config };
    setConnectors((cs) => [...cs, c]);
    setSelId(id);
  }
  const setCfg = (id: string, k: string, v: any) => setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, config: { ...c.config, [k]: v } } : c)));
  async function test(id: string) {
    let input: any = {}; try { input = JSON.parse(testInput); } catch { setTestOut("Invalid JSON"); return; }
    setTestOut(JSON.stringify((await api(`/connectors/${id}/test`, { method: "POST", body: JSON.stringify(input) })).data, null, 2));
  }

  const sel = connectors.find((c) => c.id === selId);

  return (
    <div style={{ maxWidth: 900 }}>
      {/* ---- Users & access ---- */}
      <section style={S.card}>
        <h2 style={S.h2}>Users &amp; access</h2>
        <p style={S.hint}>Roles are hierarchical: <b>viewer</b> → <b>operator</b> (run/inbox) → <b>analyst</b> (build) → <b>admin</b> (settings/users).</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
            <th style={S.th}>User</th><th style={S.th}>Username</th><th style={S.th}>Role</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={S.td}>{u.displayName}</td><td style={S.td}><code>{u.username}</code></td>
                <td style={S.td}><span style={S.rolePill}>{u.role}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div style={{ flex: "1 1 130px" }}><L>Username</L><input style={S.input} value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} /></div>
          <div style={{ flex: "1 1 130px" }}><L>Display name</L><input style={S.input} value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} /></div>
          <div style={{ flex: "1 1 120px" }}><L>Password</L><input style={S.input} type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></div>
          <div style={{ flex: "1 1 110px" }}><L>Role</L>
            <select style={S.input} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
              {["viewer", "operator", "analyst", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button style={S.primary} onClick={addUser}>Add user</button>
        </div>
      </section>

      {/* ---- LLM keys ---- */}
      <section style={{ ...S.card, marginTop: 18 }}>
        <h2 style={S.h2}>Process description model (LLM)</h2>
        <p style={S.hint}>The LLM used by <b>✦ Describe</b>. Defaults to Claude Haiku via Anthropic's OpenAI-compatible endpoint; any OpenAI-compatible provider works.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          <div style={{ flex: "1 1 150px" }}><L>Model</L><input style={S.input} value={describer.config.model ?? ""} onChange={(e) => setDescriber({ ...describer, config: { ...describer.config, model: e.target.value } })} /></div>
          <div style={{ flex: "2 1 240px" }}><L>Base URL</L><input style={S.input} value={describer.config.baseUrl ?? ""} onChange={(e) => setDescriber({ ...describer, config: { ...describer.config, baseUrl: e.target.value } })} /></div>
          <div style={{ flex: "1 1 160px" }}><L>API key</L><input style={S.input} type="password" value={describer.config.apiKey ?? ""} onChange={(e) => setDescriber({ ...describer, config: { ...describer.config, apiKey: e.target.value } })} /></div>
          <button style={S.primary} onClick={() => save({ ...describer, type: "ai-agent", config: { ...describer.config, jsonOutput: false } }, "Description model saved")}>Save</button>
        </div>
      </section>

      {/* ---- Connector library ---- */}
      <section style={{ ...S.card, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={S.h2}>Connector library</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={S.ghost} onClick={() => newConnector("ai-agent")}>+ AI agent</button>
            <button style={S.ghost} onClick={() => newConnector("maverick-agent")}>+ Maverick</button>
            <button style={S.ghost} onClick={() => newConnector("mcp")}>+ MCP</button>
            <button style={S.ghost} onClick={() => newConnector("http")}>+ HTTP</button>
          </div>
        </div>
        <p style={S.hint}>API keys for AI-agent and Maverick connectors live here — configure once, reuse across workflows.</p>

        <div style={{ display: "flex", gap: 14, marginTop: 10, alignItems: "flex-start" }}>
          <div style={S.list}>
            {connectors.map((c) => (
              <button key={c.id} onClick={() => { setSelId(c.id); setTestOut(""); }} style={{ ...S.item, ...(selId === c.id ? S.itemActive : {}) }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.id}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{c.type}</div>
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }}>
            {!sel && <p style={S.hint}>Select a connector to edit it.</p>}
            {sel && (
              <>
                {sel.type === "ai-agent" && <>
                  <L>Base URL</L><input style={S.input} value={sel.config.baseUrl ?? ""} onChange={(e) => setCfg(sel.id, "baseUrl", e.target.value)} />
                  <L>API key</L><input style={S.input} type="password" placeholder="unchanged if left blank" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
                  <L>Model</L><input style={S.input} value={sel.config.model ?? ""} onChange={(e) => setCfg(sel.id, "model", e.target.value)} />
                  <L>Instructions</L><textarea style={{ ...S.input, height: 64 }} value={sel.config.instructions ?? ""} onChange={(e) => setCfg(sel.id, "instructions", e.target.value)} />
                  <L>Tools <span style={S.hint}>the agent can call these connectors while reasoning</span></L>
                  {((sel.config.tools as any[]) ?? []).map((t: any, i: number) => (
                    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input style={{ ...S.input, flex: 1 }} placeholder="tool name" value={t.name ?? ""} onChange={(e) => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <select style={{ ...S.input, flex: 1 }} value={t.connector ?? ""} onChange={(e) => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).map((x, j) => j === i ? { ...x, connector: e.target.value } : x))}>
                        <option value="">connector…</option>
                        {connectors.filter((c) => c.id !== sel.id).map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
                      </select>
                      <button style={S.ghost} onClick={() => setCfg(sel.id, "tools", ((sel.config.tools as any[]) ?? []).filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  <button style={S.ghost} onClick={() => setCfg(sel.id, "tools", [...((sel.config.tools as any[]) ?? []), { name: "", connector: "" }])}>+ Tool</button>
                  <L>Required output keys <span style={S.hint}>guardrail — retries once if missing</span></L>
                  <input style={S.input} placeholder="e.g. riskScore, decision" value={((sel.config.requiredKeys as string[]) ?? []).join(", ")} onChange={(e) => setCfg(sel.id, "requiredKeys", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
                </>}
                {sel.type === "maverick-agent" && <>
                  <L>Maverick base URL</L><input style={S.input} value={sel.config.baseUrl ?? ""} onChange={(e) => setCfg(sel.id, "baseUrl", e.target.value)} />
                  <L>API key</L><input style={S.input} type="password" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
                  <L>Agent ID</L><input style={S.input} value={sel.config.agentId ?? ""} onChange={(e) => setCfg(sel.id, "agentId", e.target.value)} />
                </>}
                {sel.type === "mcp" && <>
                  <L>MCP server URL</L><input style={S.input} value={sel.config.url ?? ""} onChange={(e) => setCfg(sel.id, "url", e.target.value)} />
                  <L>API key (optional)</L><input style={S.input} type="password" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
                  <L>Tool</L><McpToolPicker url={sel.config.url} apiKey={sel.config.apiKey} value={sel.config.toolName} onChange={(v) => setCfg(sel.id, "toolName", v)} />
                </>}
                {sel.type === "http" && <>
                  <L>URL</L><input style={S.input} value={sel.config.url ?? ""} onChange={(e) => setCfg(sel.id, "url", e.target.value)} />
                  <L>Method</L><input style={S.input} value={sel.config.method ?? "POST"} onChange={(e) => setCfg(sel.id, "method", e.target.value)} />
                </>}
                {sel.type.startsWith("mock") && <p style={S.hint}>Built-in mock connector — no configuration.</p>}

                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {!sel.type.startsWith("mock") && <button style={S.primary} onClick={() => save(sel, `${sel.id} saved`)}>Save</button>}
                  <button style={S.ghost} onClick={() => test(sel.id)}>Test</button>
                </div>
                <div style={{ marginTop: 10 }}>
                  <L>Test input (JSON)</L>
                  <textarea style={{ ...S.input, height: 44, fontFamily: "monospace" }} value={testInput} onChange={(e) => setTestInput(e.target.value)} />
                  {testOut && <pre style={S.pre}>{testOut}</pre>}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---- Audit log ---- */}
      <section style={{ ...S.card, marginTop: 18 }}>
        <h2 style={S.h2}>Recent activity</h2>
        <p style={S.hint}>Who did what, most recent first.</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 8 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
            <th style={S.th}>When</th><th style={S.th}>Actor</th><th style={S.th}>Action</th><th style={S.th}>Target</th>
          </tr></thead>
          <tbody>
            {audit.slice(0, 40).map((a, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={S.td}>{new Date(a.ts).toLocaleString()}</td>
                <td style={S.td}><b>{a.actor}</b></td>
                <td style={S.td}><code>{a.action}</code></td>
                <td style={S.td}>{a.target ?? "—"}</td>
              </tr>
            ))}
            {audit.length === 0 && <tr><td style={S.td} colSpan={4}>No activity yet.</td></tr>}
          </tbody>
        </table>
      </section>

      {msg && <div style={S.ok}>{msg}</div>}
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) { return <label style={S.label}>{children}</label>; }

const S: Record<string, React.CSSProperties> = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, boxShadow: "var(--shadow)" },
  h2: { fontSize: 16, fontWeight: 800, margin: 0 },
  hint: { fontSize: 12, color: "var(--text-muted)", marginTop: 6 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 10, marginBottom: 4 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13 },
  list: { width: 200, display: "flex", flexDirection: "column", gap: 6 },
  item: { textAlign: "left", border: "1px solid var(--border)", background: "white", borderRadius: 8, padding: "8px 10px", cursor: "pointer" },
  itemActive: { border: "1px solid var(--primary)", background: "var(--primary-tint)" },
  primary: { background: "var(--primary)", color: "white", border: 0, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  ghost: { background: "white", color: "var(--primary)", border: "1px solid var(--primary)", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" },
  pre: { background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 12, overflowX: "auto", marginTop: 8 },
  ok: { marginTop: 14, background: "#dcfce7", color: "#166534", padding: "8px 12px", borderRadius: 8, fontSize: 13 },
  th: { padding: "7px 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 },
  td: { padding: "7px 10px", color: "var(--text)", verticalAlign: "top" },
  rolePill: { fontSize: 11, background: "var(--primary-tint)", color: "var(--primary-strong)", borderRadius: 6, padding: "2px 8px", fontWeight: 700 },
};
