import { useState } from "react";
import { api } from "./api.js";

// Tool-name input for MCP connectors, with a "Discover" button that lists the
// server's tools (via /mcp/tools) so you can pick from a dropdown.
export function McpToolPicker({
  url, apiKey, value, onChange,
}: { url?: string; apiKey?: string; value?: string; onChange: (v: string) => void }) {
  const [tools, setTools] = useState<{ name: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function discover() {
    setBusy(true); setErr("");
    const r = await api("/mcp/tools", { method: "POST", body: JSON.stringify({ url, apiKey }) });
    setBusy(false);
    if (r.ok) setTools(r.data.tools ?? []);
    else { setTools([]); setErr(r.data.error ?? "Could not reach the server"); }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={S.input} value={value ?? ""} placeholder="tool name" onChange={(e) => onChange(e.target.value)} />
        <button style={S.ghost} onClick={discover} disabled={busy}>{busy ? "…" : "Discover"}</button>
      </div>
      {tools.length > 0 && (
        <select style={{ ...S.input, marginTop: 6 }} value="" onChange={(e) => e.target.value && onChange(e.target.value)}>
          <option value="">Pick a discovered tool…</option>
          {tools.map((t) => <option key={t.name} value={t.name}>{t.name}{t.description ? ` — ${t.description.slice(0, 48)}` : ""}</option>)}
        </select>
      )}
      {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 4 }}>{err}</div>}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  input: { flex: 1, width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 13 },
  ghost: { background: "white", color: "var(--primary)", border: "1px solid var(--primary)", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" },
};
