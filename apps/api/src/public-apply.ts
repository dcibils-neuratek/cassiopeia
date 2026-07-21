// Public, token-scoped application API for the customer-facing "Banco del Futuro"
// portal. No session required — a trigger token authorizes starting applications
// for one product/workflow. The customer only drives customer-facing user tasks
// (no candidateRole); staff tasks (compliance/underwriting) stay in the Inbox.
// The portal renders each customer task's form dynamically from its schema.

import type { Context, FormDefinition, ProcessDefinition } from "@cassiopeia/model";
import { getNode } from "@cassiopeia/model";
import { getDefinition, getForm, getInstance, getTrigger, openTaskForInstance } from "./db.js";
import { startInstance, submitTask } from "./runtime.js";

export interface PublicStatus {
  appId: string;
  stage: "processing" | "form" | "review" | "done" | "error";
  outcome?: "approved" | "declined"; // when done
  title?: string;                    // end-node label, e.g. "Cuenta abierta"
  message?: string;
  form?: FormDefinition;             // when a customer task awaits input
  summary?: Record<string, unknown>; // safe context fields to show
}

function isCustomerTask(def: ProcessDefinition, nodeId: string): boolean {
  const n = getNode(def, nodeId);
  return n.type === "userTask" && !n.candidateRole; // no role = customer-facing
}

// Safe subset of context fields the customer may see (only those present).
const SAFE_KEYS = [
  "fullName", "amount", "termYears", "propertyValue", "downPayment", "annualIncome",
  "monthlyPayment", "loanAmount", "dti", "creditScore", "decision", "reasoning",
  "confidence", "amlRisk", "riskLevel", "registered", "reference", "coverage",
  "accountId", "purpose", "destinations",
];
function safeSummary(ctx: Context): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SAFE_KEYS) if (ctx[k] !== undefined) out[k] = ctx[k];
  return out;
}

const isDeclined = (name: string) => /rechaz|declin|reject/i.test(name);

/** Resolve a public token to its workflow id. */
export function defIdForToken(token: string): string {
  const trig = getTrigger(token);
  if (!trig || !trig.enabled) throw new Error("Unknown application form");
  return trig.defId;
}

/** The first customer-facing task's form — what the portal shows to start. */
export function intakeForm(token: string): { defId: string; name: string; form: FormDefinition } {
  const defId = defIdForToken(token);
  const def = getDefinition(defId);
  // follow the start edge to the first customer userTask
  let nodeId = def.edges.find((e) => e.from === def.startNodeId)?.to;
  const seen = new Set<string>();
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const n = getNode(def, nodeId);
    if (n.type === "userTask" && !n.candidateRole && n.formId) {
      return { defId, name: def.name, form: getForm(n.formId) };
    }
    nodeId = def.edges.find((e) => e.from === nodeId)?.to;
  }
  throw new Error("This product has no public intake form");
}

export function statusOf(defId: string, appId: string): PublicStatus {
  const inst = getInstance(appId);
  if (inst.defId !== defId) throw new Error("Application not found");
  const def = getDefinition(inst.defId, inst.defVersion);

  if (inst.status === "failed") return { appId, stage: "error", message: "No pudimos procesar tu solicitud. Probá de nuevo." };
  if (inst.status === "completed") {
    const end = getNode(def, inst.currentNodeId);
    const name = ("name" in end && end.name) || "";
    return { appId, stage: "done", outcome: isDeclined(name) ? "declined" : "approved", title: name || "Listo", summary: safeSummary(inst.context) };
  }
  const task = openTaskForInstance(appId);
  if (task) {
    const node = getNode(def, task.nodeId);
    if (node.type === "userTask" && node.candidateRole) {
      return { appId, stage: "review", message: "Un especialista del banco está revisando tu solicitud.", summary: safeSummary(inst.context) };
    }
    // customer-facing task awaiting input → render its form
    const form = node.type === "userTask" && node.formId ? getForm(node.formId) : undefined;
    return { appId, stage: "form", form, summary: safeSummary(inst.context) };
  }
  return { appId, stage: "processing" };
}

/** Start an application: run the intake data through the flow until it reaches
 *  the next customer step, a staff review, or a final decision. */
export async function startApplication(token: string, data: Context): Promise<PublicStatus> {
  const defId = defIdForToken(token);
  const { instanceId } = await startInstance(defId);
  const def = getDefinition(defId);
  const task = openTaskForInstance(instanceId);
  if (task && isCustomerTask(def, task.nodeId)) {
    await submitTask(task.id, data);
  }
  return statusOf(defId, instanceId);
}

/** Submit the current customer task (an offer acceptance, a signature, …). */
export async function submitStep(token: string, appId: string, data: Context): Promise<PublicStatus> {
  const defId = defIdForToken(token);
  const inst = getInstance(appId);
  if (inst.defId !== defId) throw new Error("Application not found");
  const def = getDefinition(inst.defId, inst.defVersion);
  const task = openTaskForInstance(appId);
  if (!task || !isCustomerTask(def, task.nodeId)) throw new Error("No hay un paso pendiente para completar");
  await submitTask(task.id, data);
  return statusOf(defId, appId);
}
