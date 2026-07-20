// Public, token-scoped application API for a customer-facing intake page (e.g.
// the "Banco del Futuro" loan site). No session required — a trigger token
// authorizes starting applications for one workflow. The customer can only act
// on their own instance and only on customer-facing user tasks (no candidateRole);
// staff tasks (an underwriter review) stay internal to the Inbox. Only safe
// fields are exposed.

import type { Context, ProcessDefinition } from "@cassiopeia/model";
import { getNode } from "@cassiopeia/model";
import { getDefinition, getInstance, getTrigger, openTaskForInstance } from "./db.js";
import { startInstance, submitTask } from "./runtime.js";

export interface PublicStatus {
  appId: string;
  stage: "processing" | "review" | "offer" | "approved" | "declined" | "error";
  message?: string;
  offer?: Record<string, unknown>;
}

function isCustomerTask(def: ProcessDefinition, nodeId: string): boolean {
  const n = getNode(def, nodeId);
  return n.type === "userTask" && !n.candidateRole; // no role = customer-facing
}

/** Only fields safe to show a customer. */
function safeOffer(ctx: Context): Record<string, unknown> {
  const pick = (k: string) => (ctx[k] !== undefined ? ctx[k] : undefined);
  return {
    amount: pick("amount"),
    termYears: pick("termYears"),
    monthlyPayment: pick("monthlyPayment"),
    creditScore: pick("creditScore"),
    decision: pick("decision"),
    reasoning: pick("reasoning"),
  };
}

export function statusOf(defId: string, appId: string): PublicStatus {
  const inst = getInstance(appId);
  if (inst.defId !== defId) throw new Error("Application not found");
  const def = getDefinition(inst.defId, inst.defVersion);

  if (inst.status === "failed") return { appId, stage: "error", message: "We couldn't process your application. Please try again." };
  if (inst.status === "completed") {
    const end = getNode(def, inst.currentNodeId);
    const approved = /approv|aprob/i.test(("name" in end && end.name) || "");
    return { appId, stage: approved ? "approved" : "declined", offer: safeOffer(inst.context) };
  }
  const task = openTaskForInstance(appId);
  if (task) {
    const node = getNode(def, task.nodeId);
    if (node.type === "userTask" && node.candidateRole) {
      return { appId, stage: "review", message: "A loan specialist is reviewing your application." };
    }
    return { appId, stage: "offer", offer: safeOffer(inst.context) };
  }
  return { appId, stage: "processing" };
}

/** Resolve a public token to its workflow id. */
export function defIdForToken(token: string): string {
  const trig = getTrigger(token);
  if (!trig || !trig.enabled) throw new Error("Unknown application form");
  return trig.defId;
}

/** Start an application: run the intake form's data through the flow until it
 *  reaches an offer, a staff review, or a decision. */
export async function startApplication(token: string, data: Context): Promise<PublicStatus> {
  const defId = defIdForToken(token);
  const { instanceId } = await startInstance(defId);
  const def = getDefinition(defId);
  const task = openTaskForInstance(instanceId);
  if (task && isCustomerTask(def, task.nodeId)) {
    await submitTask(task.id, data); // completes the application step → runs the AI credit check
  }
  return statusOf(defId, instanceId);
}

/** Customer accepts the offer (completes the customer 'sign' task). */
export async function acceptOffer(token: string, appId: string): Promise<PublicStatus> {
  const defId = defIdForToken(token);
  const inst = getInstance(appId);
  if (inst.defId !== defId) throw new Error("Application not found");
  const def = getDefinition(inst.defId, inst.defVersion);
  const task = openTaskForInstance(appId);
  if (!task || !isCustomerTask(def, task.nodeId)) throw new Error("No pending step to accept");
  await submitTask(task.id, { accepted: true });
  return statusOf(defId, appId);
}
