// M10 analytics: turn the event log into operational insight — per-node cycle
// times (where runs spend time), a bottleneck, gateway branch distribution,
// failure rates, and average end-to-end completion time. Plus an AI "process
// analyst" that reads these numbers and suggests concrete improvements.

import { getDefinition, listEvents, listInstances } from "./db.js";
import { callDescriber } from "./describe.js";

export interface NodeStat {
  nodeId: string;
  name: string;
  type: string;
  visits: number;
  avgMs: number;
  maxMs: number;
  totalMs: number;
}

export interface ProcessAnalytics {
  defId: string;
  name: string;
  totalInstances: number;
  byStatus: Record<string, number>;
  completedCount: number;
  avgCycleMs: number | null;
  nodeStats: NodeStat[];
  bottleneck: NodeStat | null;
  gatewayDistribution: { nodeId: string; name: string; branches: { to: string; toName: string; count: number }[] }[];
  failuresByNode: { nodeId: string; name: string; count: number }[];
}

export function computeAnalytics(defId: string): ProcessAnalytics {
  const def = getDefinition(defId);
  const nodeMeta = new Map(def.nodes.map((n) => [n.id, { name: "name" in n && n.name ? n.name : n.id, type: n.type }]));
  const nameOf = (id: string) => nodeMeta.get(id)?.name ?? id;

  const instances = listInstances().filter((i) => i.defId === defId);
  const byStatus: Record<string, number> = {};
  const acc = new Map<string, { visits: number; totalMs: number; maxMs: number }>();
  const gatewayCounts = new Map<string, Map<string, number>>(); // gatewayId -> (toId -> count)
  const failCounts = new Map<string, number>();
  let completedCount = 0;
  let cycleTotal = 0;

  for (const inst of instances) {
    byStatus[inst.status] = (byStatus[inst.status] ?? 0) + 1;
    const events = listEvents(inst.id);

    // per-node dwell time: time between successive node.entered events
    let prevNode: string | null = null;
    let prevTs = 0;
    let startedTs: number | null = null;
    const closeNode = (endTs: number) => {
      if (prevNode == null) return;
      const dt = Math.max(0, endTs - prevTs);
      const a = acc.get(prevNode) ?? { visits: 0, totalMs: 0, maxMs: 0 };
      a.visits += 1; a.totalMs += dt; a.maxMs = Math.max(a.maxMs, dt);
      acc.set(prevNode, a);
    };

    for (const e of events) {
      const ts = new Date(e.ts).getTime();
      if (e.type === "instance.started") startedTs = ts;
      if (e.type === "node.entered" && e.nodeId) {
        closeNode(ts);
        prevNode = e.nodeId; prevTs = ts;
      }
      if (e.type === "gateway.evaluated" && e.nodeId) {
        const to = (e.payload as any)?.to as string | undefined;
        if (to) {
          const m = gatewayCounts.get(e.nodeId) ?? new Map();
          m.set(to, (m.get(to) ?? 0) + 1);
          gatewayCounts.set(e.nodeId, m);
        }
      }
      if (e.type === "service.failed" && e.nodeId) failCounts.set(e.nodeId, (failCounts.get(e.nodeId) ?? 0) + 1);
      if (e.type === "instance.completed" || e.type === "instance.failed") {
        closeNode(ts); prevNode = null;
        if (e.type === "instance.completed" && startedTs != null) { completedCount++; cycleTotal += ts - startedTs; }
      }
    }
    // instance still parked: close the current node at its last event time (dwell so far)
    if (prevNode != null && events.length) closeNode(new Date(events[events.length - 1].ts).getTime());
  }

  const nodeStats: NodeStat[] = [...acc.entries()].map(([nodeId, a]) => ({
    nodeId,
    name: nameOf(nodeId),
    type: nodeMeta.get(nodeId)?.type ?? "?",
    visits: a.visits,
    totalMs: a.totalMs,
    avgMs: a.visits ? Math.round(a.totalMs / a.visits) : 0,
    maxMs: a.maxMs,
  })).sort((x, y) => y.avgMs - x.avgMs);

  const bottleneck = nodeStats.filter((n) => n.type !== "start" && n.type !== "end")[0] ?? null;

  const gatewayDistribution = [...gatewayCounts.entries()].map(([nodeId, m]) => ({
    nodeId,
    name: nameOf(nodeId),
    branches: [...m.entries()].map(([to, count]) => ({ to, toName: nameOf(to), count })).sort((a, b) => b.count - a.count),
  }));

  const failuresByNode = [...failCounts.entries()].map(([nodeId, count]) => ({ nodeId, name: nameOf(nodeId), count }))
    .sort((a, b) => b.count - a.count);

  return {
    defId,
    name: def.name,
    totalInstances: instances.length,
    byStatus,
    completedCount,
    avgCycleMs: completedCount ? Math.round(cycleTotal / completedCount) : null,
    nodeStats,
    bottleneck,
    gatewayDistribution,
    failuresByNode,
  };
}

const ANALYST_SYSTEM =
  "You are a senior business-process analyst reviewing operational metrics for a workflow " +
  "running on a BPM engine. Given the process structure and aggregate run data (per-node cycle " +
  "times, the bottleneck, gateway branch distribution, failures, and average completion time), " +
  "give a concise, practical assessment: 1) the single biggest bottleneck or risk and why, " +
  "2) 3–5 specific, actionable improvements (e.g. add an SLA/timer, automate a manual step, add " +
  "a retry or error path, split a gateway), and 3) any data-quality concerns. Be concrete and " +
  "reference the actual step names. Use short paragraphs and a tight bullet list. No code.";

function fmtMs(ms: number | null): string {
  if (ms == null) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/** Ask the describer LLM to interpret the analytics and suggest improvements. */
export async function analyzeProcess(
  defId: string,
  override?: { baseUrl?: string; apiKey?: string; model?: string },
): Promise<{ analytics: ProcessAnalytics; suggestions: string }> {
  const a = computeAnalytics(defId);
  const lines: string[] = [
    `Process: ${a.name}`,
    `Instances: ${a.totalInstances} (by status: ${JSON.stringify(a.byStatus)})`,
    `Completed: ${a.completedCount}; average completion time: ${fmtMs(a.avgCycleMs)}`,
    `Bottleneck: ${a.bottleneck ? `${a.bottleneck.name} (avg ${fmtMs(a.bottleneck.avgMs)}, ${a.bottleneck.visits} visits)` : "none"}`,
    "Per-node cycle time (avg / max / visits):",
    ...a.nodeStats.map((n) => `- ${n.name} [${n.type}]: avg ${fmtMs(n.avgMs)}, max ${fmtMs(n.maxMs)}, ${n.visits} visits`),
  ];
  if (a.gatewayDistribution.length) {
    lines.push("Gateway branch distribution:");
    for (const g of a.gatewayDistribution) lines.push(`- ${g.name}: ${g.branches.map((b) => `${b.toName}=${b.count}`).join(", ")}`);
  }
  if (a.failuresByNode.length) {
    lines.push("Failures by node:");
    for (const f of a.failuresByNode) lines.push(`- ${f.name}: ${f.count}`);
  }
  const suggestions = await callDescriber(ANALYST_SYSTEM, lines.join("\n"), override);
  return { analytics: a, suggestions };
}
