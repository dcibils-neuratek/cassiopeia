// Build a business-readable "case file" for one instance: who submitted what, what
// each AI agent decided (reasoning / score / confidence / cost), how gateways
// routed, which humans approved, and the final outcome. Consumed by the
// Executions view so a bank exec can review a whole application at a glance.

import type { Json, ProcessDefinition } from "@cassiopeia/model";
import { getNode } from "@cassiopeia/model";
import {
  auditForInstance,
  getConnector,
  getDefinition,
  getInstance,
  listComments,
  listEvents,
  listInstances,
} from "./db.js";

export type CaseStepKind = "start" | "human" | "ai" | "service" | "route" | "timer" | "pending" | "callback" | "escalated" | "outcome" | "failed";

export interface CaseField { label: string; value: string }
export interface CaseStep {
  ts: string;
  kind: CaseStepKind;
  title: string;
  detail?: string;
  actor?: string;
  badge?: string;
  fields?: CaseField[];
  meta?: CaseField[]; // small chips (score, confidence, tokens, cost)
}

export interface CaseView {
  instanceId: string;
  processName: string;
  status: string;
  outcome: string; // "approved" | "declined" | "running" | "review" | "failed"
  outcomeLabel: string;
  startedAt?: string;
  endedAt?: string;
  subject?: string; // best-effort applicant name
  data: CaseField[]; // context snapshot (scalars)
  ai: { calls: number; tokens: number; cost: number };
  steps: CaseStep[];
  comments: { author: string; text: string; ts: string }[];
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase()).trim();
}
function fmt(v: Json): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
function scalarFields(obj: Record<string, Json>, skip: Set<string> = new Set()): CaseField[] {
  const out: CaseField[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || k.startsWith("_")) continue;
    if (v != null && typeof v === "object") continue; // skip nested (e.g. error object)
    out.push({ label: humanize(k), value: fmt(v) });
  }
  return out;
}

export interface CaseSummary {
  id: string; defId: string; processName: string; subject: string | null;
  status: string; outcome: string; outcomeLabel: string;
}

/** Compute outcome (approved/declined/review/running/failed) + label for an instance. */
function outcomeFor(def: ProcessDefinition, status: string, currentNodeId: string): { outcome: string; label: string } {
  if (status === "failed") return { outcome: "failed", label: "Failed" };
  if (status === "completed") {
    const end = getNode(def, currentNodeId);
    const nm = ("name" in end && end.name) || "";
    if (/decl|rechaz|reject/i.test(nm)) return { outcome: "declined", label: nm || "Declined" };
    return { outcome: "approved", label: nm || "Approved" };
  }
  try {
    const n = getNode(def, currentNodeId);
    if (n.type === "userTask" && n.candidateRole) return { outcome: "review", label: "Under review" };
  } catch { /* ignore */ }
  return { outcome: "running", label: "In progress" };
}

/** Lightweight list of all executions for the Executions view. Newest first. */
export function listCaseSummaries(): CaseSummary[] {
  return listInstances().map((inst) => {
    let processName = inst.defId, outcome = "running", label = "In progress";
    try {
      const def = getDefinition(inst.defId, inst.defVersion);
      processName = def.name;
      const o = outcomeFor(def, inst.status, inst.currentNodeId);
      outcome = o.outcome; label = o.label;
    } catch { /* definition gone */ }
    const subject = (inst.context.fullName as string) || (inst.context.legalName as string) || (inst.context.name as string) || null;
    return { id: inst.id, defId: inst.defId, processName, subject, status: inst.status, outcome, outcomeLabel: label };
  }).reverse();
}

function serviceIsAgent(def: ProcessDefinition, nodeId: string): boolean {
  const n = getNode(def, nodeId);
  if (n.type !== "serviceTask") return false;
  try { return getConnector(n.connectorId).type === "ai-agent"; } catch { return false; }
}

export function buildCase(instanceId: string): CaseView {
  const inst = getInstance(instanceId);
  const def = getDefinition(inst.defId, inst.defVersion);
  const events = listEvents(instanceId);
  const audit = auditForInstance(instanceId);
  const comments = listComments(instanceId);
  const nodeName = (id?: string) => {
    if (!id) return "?";
    try { const n = getNode(def, id); return "name" in n && n.name ? n.name : n.type; } catch { return id; }
  };

  // resolve the nearest staff actor (task.submit/claim) at or before a timestamp
  const staffActorAt = (ts: string): string | undefined => {
    let best: string | undefined;
    for (const a of audit) { if (a.ts <= ts) best = a.actor; else break; }
    return best;
  };

  const steps: CaseStep[] = [];
  const ai = { calls: 0, tokens: 0, cost: 0 };
  let pendingUsage: { tokens: number; cost: number; model?: string } | null = null;

  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, Json>;
    switch (e.type) {
      case "instance.started":
        steps.push({ ts: e.ts, kind: "start", title: "Application received" });
        break;
      case "task.completed": {
        const node = e.nodeId ? getNode(def, e.nodeId) : undefined;
        const isStaff = node?.type === "userTask" && !!node.candidateRole;
        steps.push({
          ts: e.ts, kind: "human", title: nodeName(e.nodeId),
          actor: isStaff ? (staffActorAt(e.ts) ?? node?.candidateRole ?? "Staff") : "Customer",
          fields: scalarFields(p),
        });
        break;
      }
      case "agent.usage":
        ai.calls += 1;
        ai.tokens += Number(p.totalTokens ?? 0);
        ai.cost = Number((ai.cost + Number(p.cost ?? 0)).toFixed(6));
        pendingUsage = { tokens: Number(p.totalTokens ?? 0), cost: Number(p.cost ?? 0), model: p.model as string };
        break;
      case "service.completed": {
        if (e.nodeId && serviceIsAgent(def, e.nodeId)) {
          const meta: CaseField[] = [];
          if (p.creditScore != null || p.score != null) meta.push({ label: "Score", value: fmt(p.creditScore ?? p.score) });
          if (p.confidence != null) meta.push({ label: "Confidence", value: `${Math.round(Number(p.confidence) * 100)}%` });
          if (pendingUsage) { meta.push({ label: "Tokens", value: String(pendingUsage.tokens) }); meta.push({ label: "Cost", value: `$${pendingUsage.cost}` }); }
          steps.push({
            ts: e.ts, kind: "ai", title: `${nodeName(e.nodeId)} — AI agent`,
            badge: p.decision != null ? String(p.decision) : undefined,
            detail: p.reasoning != null ? String(p.reasoning) : undefined,
            meta,
          });
          pendingUsage = null;
        } else {
          steps.push({ ts: e.ts, kind: "service", title: nodeName(e.nodeId), detail: scalarFields(p).map((f) => `${f.label}: ${f.value}`).join(" · ") || undefined });
        }
        break;
      }
      case "gateway.evaluated":
        steps.push({ ts: e.ts, kind: "route", title: nodeName(e.nodeId), detail: `→ ${nodeName(p.to as string)}` });
        break;
      case "timer.scheduled":
        steps.push({ ts: e.ts, kind: "timer", title: nodeName(e.nodeId), detail: "Waiting…" });
        break;
      case "timer.fired":
        steps.push({ ts: e.ts, kind: "timer", title: nodeName(e.nodeId), detail: "Resumed" });
        break;
      case "service.pending":
        steps.push({ ts: e.ts, kind: "pending", title: nodeName(e.nodeId), detail: "Waiting for an external system…" });
        break;
      case "callback.received":
        steps.push({ ts: e.ts, kind: "callback", title: nodeName(e.nodeId), detail: "External result received" });
        break;
      case "task.escalated":
        steps.push({ ts: e.ts, kind: "escalated", title: nodeName(e.nodeId), detail: "SLA breached — escalated to high priority" });
        break;
      case "instance.completed": {
        const endName = nodeName(e.nodeId);
        steps.push({ ts: e.ts, kind: "outcome", title: endName, badge: endName });
        break;
      }
      case "instance.failed":
        steps.push({ ts: e.ts, kind: "failed", title: "Failed", detail: p.error != null ? String(p.error) : undefined });
        break;
    }
  }

  const { outcome, label: outcomeLabel } = outcomeFor(def, inst.status, inst.currentNodeId);
  const data = scalarFields(inst.context);
  const subject = (inst.context.fullName as string) || (inst.context.legalName as string) || (inst.context.name as string) || undefined;

  return {
    instanceId,
    processName: def.name,
    status: inst.status,
    outcome, outcomeLabel,
    startedAt: events[0]?.ts,
    endedAt: inst.status === "completed" || inst.status === "failed" ? events[events.length - 1]?.ts : undefined,
    subject,
    data,
    ai,
    steps,
    comments,
  };
}
