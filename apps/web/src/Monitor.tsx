import { useEffect, useRef, useState } from "react";
import { api, apiRaw } from "./api.js";

type Instance = { id: string; defId: string; status: string; currentNodeId: string; context: Record<string, unknown>; error?: string };
type Event = { type: string; nodeId?: string; payload?: unknown; ts: string };
type OpenTask = { id: string; nodeId: string; dueAt?: string | null } | null;
type OpenTimer = { nodeId: string; wakeAt: string } | null;
type Detail = { instance: Instance; events: Event[]; openTask?: OpenTask; openTimer?: OpenTimer };

const STATUS_COLOR: Record<string, string> = {
  running: "#2563eb", waiting: "#d97706", completed: "#16a34a", failed: "#dc2626",
};

export function Monitor() {
  const [list, setList] = useState<Instance[]>([]);
  const [defs, setDefs] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState<Detail | null>(null);
  const openId = useRef<string | null>(null);

  const [retrying, setRetrying] = useState(false);
  const [comments, setComments] = useState<{ id: string; author: string; text: string; ts: string }[]>([]);
  const [commentText, setCommentText] = useState("");
  async function reloadList() { setList((await api("/instances")).data); }
  async function loadComments(id: string) { const r = await api(`/instances/${id}/comments`); if (r.ok) setComments(r.data); }
  async function open(id: string) {
    openId.current = id;
    const r = await api(`/instances/${id}`);
    setDetail({ instance: r.data.instance, events: r.data.events, openTask: r.data.openTask, openTimer: r.data.openTimer });
    loadComments(id);
  }
  async function postComment() {
    const id = openId.current; const text = commentText.trim();
    if (!id || !text) return;
    await api(`/instances/${id}/comments`, { method: "POST", body: JSON.stringify({ text }) });
    setCommentText(""); loadComments(id);
  }
  async function downloadCsv(id: string) {
    const res = await apiRaw(`/instances/${id}/audit.csv`);
    const text = await res.text();
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `audit-${id.slice(0, 8)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  async function retry(id: string) {
    setRetrying(true);
    try {
      await api(`/instances/${id}/retry`, { method: "POST" });
      await open(id);
      await reloadList();
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    let alive = true;
    api("/definitions").then((r) => alive && setDefs(r.data.map((d: any) => ({ id: d.id, name: d.name }))));
    const load = async () => {
      if (!alive) return;
      await reloadList();
      if (openId.current) { // keep the open detail live too
        const r = await api(`/instances/${openId.current}`);
        if (alive) setDetail({ instance: r.data.instance, events: r.data.events, openTask: r.data.openTask, openTimer: r.data.openTimer });
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const shown = filter === "all" ? list : list.filter((i) => i.defId === filter);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 12, background: "white", overflow: "hidden" }}>
        <div style={S.bar}>
          <span style={S.head}>Instances ({shown.length})</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={S.select}>
              <option value="all">All workflows</option>
              {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "#16a34a", display: "inline-block" }} /> live
            </span>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th style={S.th}>Instance</th><th style={S.th}>Process</th><th style={S.th}>Status</th><th style={S.th}>At node</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} onClick={() => open(i.id)} style={{ cursor: "pointer", borderTop: "1px solid #f1f5f9", background: detail?.instance.id === i.id ? "var(--primary-tint)" : "white" }}>
                <td style={S.td}><code>{i.id.slice(0, 8)}</code></td>
                <td style={S.td}>{i.defId}</td>
                <td style={S.td}><span style={{ color: STATUS_COLOR[i.status] ?? "#334155", fontWeight: 600 }}>{i.status}</span></td>
                <td style={S.td}>{i.currentNodeId}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td style={S.td} colSpan={4}>No instances{filter !== "all" ? " for this workflow" : " yet"}.</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ width: 400, border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "white" }}>
        <div style={S.head}>Detail</div>
        {!detail && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Select an instance.</p>}
        {detail && (
          <>
            <div style={{ fontSize: 13, margin: "6px 0" }}>
              <b style={{ color: STATUS_COLOR[detail.instance.status] }}>{detail.instance.status}</b> · at {detail.instance.currentNodeId}
            </div>
            {detail.openTimer && (
              <div style={S.timerBox}>⏱ Sleeping until {new Date(detail.openTimer.wakeAt).toLocaleString()}</div>
            )}
            {detail.openTask?.dueAt && (
              <div style={new Date(detail.openTask.dueAt) < new Date() ? S.overdueBox : S.dueBox}>
                {new Date(detail.openTask.dueAt) < new Date() ? "⚠ Overdue" : "⏳ Due"} {new Date(detail.openTask.dueAt).toLocaleString()}
              </div>
            )}
            {detail.instance.status === "failed" && (
              <div style={S.errBox}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Failed</div>
                <div style={{ marginBottom: 8, wordBreak: "break-word" }}>{detail.instance.error ?? "Unknown error"}</div>
                <button style={S.retryBtn} disabled={retrying} onClick={() => retry(detail.instance.id)}>
                  {retrying ? "Retrying…" : "↻ Retry from failed step"}
                </button>
              </div>
            )}
            <pre style={S.pre}>{JSON.stringify(detail.instance.context, null, 2)}</pre>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <div style={S.head}>Audit trail</div>
              <button onClick={() => downloadCsv(detail.instance.id)} style={S.csvLink}>⬇ CSV</button>
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {detail.events.map((e, i) => (
                <li key={i} style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {e.type}{e.nodeId ? ` @${e.nodeId}` : ""}{e.payload !== undefined ? `  ${JSON.stringify(e.payload)}` : ""}
                </li>
              ))}
            </ol>

            <div style={{ ...S.head, marginTop: 16 }}>Comments</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "8px 0" }}>
              {comments.map((c) => (
                <div key={c.id} style={S.comment}>
                  <div style={{ fontSize: 12 }}>{c.text}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}><b>{c.author}</b> · {new Date(c.ts).toLocaleString()}</div>
                </div>
              ))}
              {comments.length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No comments yet.</div>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input style={S.commentInput} placeholder="Add a comment…" value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") postComment(); }} />
              <button style={S.commentBtn} onClick={postComment}>Post</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  bar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottom: "1px solid var(--border)" },
  head: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)", fontWeight: 700 },
  select: { border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", fontSize: 12, background: "white", fontWeight: 600, color: "var(--text)" },
  th: { padding: "8px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { padding: "8px 12px", color: "var(--text)" },
  pre: { background: "#f8fafc", borderRadius: 8, padding: 12, fontSize: 12, overflowX: "auto", marginTop: 8 },
  errBox: { background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: 12, fontSize: 12, margin: "8px 0" },
  retryBtn: { background: "#dc2626", color: "white", border: 0, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  timerBox: { background: "#ecfeff", border: "1px solid #a5f3fc", color: "#155e75", borderRadius: 8, padding: "8px 10px", fontSize: 12, margin: "6px 0", fontWeight: 600 },
  dueBox: { background: "#f0f9ff", border: "1px solid #bae6fd", color: "#075985", borderRadius: 8, padding: "8px 10px", fontSize: 12, margin: "6px 0", fontWeight: 600 },
  overdueBox: { background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 8, padding: "8px 10px", fontSize: 12, margin: "6px 0", fontWeight: 600 },
  csvLink: { fontSize: 11, color: "var(--primary)", background: "transparent", border: 0, cursor: "pointer", fontWeight: 700 },
  comment: { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" },
  commentInput: { flex: 1, border: "1px solid var(--border-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 13 },
  commentBtn: { background: "var(--primary)", color: "white", border: 0, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
};
