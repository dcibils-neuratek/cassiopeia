import { useEffect, useState } from "react";
import { api } from "./api.js";

type Connector = { id: string; type: string; config: Record<string, any> };

export function Settings() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [describer, setDescriber] = useState<Connector>({ id: "describer", type: "ai-agent", config: { baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5", apiKey: "", jsonOutput: false } });
  const [selId, setSelId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [testInput, setTestInput] = useState('{ "income": 1200 }');
  const [testOut, setTestOut] = useState("");

  async function reload() {
    const r = await api("/connectors");
    setConnectors(r.data);
    const d = (r.data as Connector[]).find((c) => c.id === "describer");
    if (d) setDescriber(d);
  }
  useEffect(() => { reload(); }, []);

  async function save(c: Connector, note: string) {
    await api("/connectors", { method: "POST", body: JSON.stringify(c) });
    setMsg(note);
    reload();
  }
  function newConnector(type: string) {
    const id = `${type === "maverick-agent" ? "mav" : type === "http" ? "http" : "ai"}_${Math.random().toString(36).slice(2, 6)}`;
    const config = type === "maverick-agent" ? { baseUrl: "https://your-maverick-host", apiKey: "", agentId: "" }
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
      {/* ---- LLM keys ---- */}
      <section style={S.card}>
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
                  <L>API key</L><input style={S.input} type="password" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
                  <L>Model</L><input style={S.input} value={sel.config.model ?? ""} onChange={(e) => setCfg(sel.id, "model", e.target.value)} />
                  <L>Instructions</L><textarea style={{ ...S.input, height: 64 }} value={sel.config.instructions ?? ""} onChange={(e) => setCfg(sel.id, "instructions", e.target.value)} />
                </>}
                {sel.type === "maverick-agent" && <>
                  <L>Maverick base URL</L><input style={S.input} value={sel.config.baseUrl ?? ""} onChange={(e) => setCfg(sel.id, "baseUrl", e.target.value)} />
                  <L>API key</L><input style={S.input} type="password" value={sel.config.apiKey ?? ""} onChange={(e) => setCfg(sel.id, "apiKey", e.target.value)} />
                  <L>Agent ID</L><input style={S.input} value={sel.config.agentId ?? ""} onChange={(e) => setCfg(sel.id, "agentId", e.target.value)} />
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
  itemActive: { borderColor: "var(--primary)", background: "var(--primary-tint)" },
  primary: { background: "var(--primary)", color: "white", border: 0, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  ghost: { background: "white", color: "var(--primary)", border: "1px solid var(--primary)", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer" },
  pre: { background: "#f8fafc", borderRadius: 8, padding: 10, fontSize: 12, overflowX: "auto", marginTop: 8 },
  ok: { marginTop: 14, background: "#dcfce7", color: "#166534", padding: "8px 12px", borderRadius: 8, fontSize: 13 },
};
