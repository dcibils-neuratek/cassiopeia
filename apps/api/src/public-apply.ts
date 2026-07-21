// Public, token-scoped application API for the customer-facing "Banco del Futuro"
// portal. No session required — a trigger token authorizes starting applications
// for one product/workflow. The customer only drives customer-facing user tasks
// (no candidateRole); staff tasks (compliance/underwriting) stay in the Inbox.
// The portal renders each customer task's form dynamically from its schema.

import { randomUUID } from "node:crypto";
import type { Context, FormDefinition, ProcessDefinition } from "@cassiopeia/model";
import { getNode } from "@cassiopeia/model";
import {
  deleteDraft, getDefinition, getDraft, getForm, getInstance, getTrigger,
  openTaskForInstance, saveDraft,
} from "./db.js";
import { startInstance, submitTask } from "./runtime.js";
import {
  getJourney, intakeStep, publicSteps, type Journey, type JourneyPage,
  type JourneyStepPublic,
} from "./journeys.js";

export interface PublicStatus {
  appId: string;
  stage: "processing" | "form" | "review" | "done" | "error";
  outcome?: "approved" | "declined"; // when done
  title?: string;                    // end-node label, e.g. "Cuenta abierta"
  message?: string;
  form?: FormDefinition;             // when a customer task awaits input
  summary?: Record<string, unknown>; // safe context fields to show
  // ---- journey projection (present only for products that have a journey) ----
  steps?: JourneyStepPublic[];       // the customer-facing steps
  current?: number;                  // active step index
  substate?: "form" | "analyzing" | "review" | "done";
  pages?: JourneyPage[];             // wizard pages within the current form step
  draft?: Context;                   // saved partial input, to rehydrate the wizard
  page?: number;                     // page the customer left off on
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

// ---- journey-aware flow (resumable wizard + projection over the workflow) ----

const stepIndex = (j: Journey, key: string) => j.steps.findIndex((s) => s.key === key);
const waitIndex = (j: Journey) => { const i = j.steps.findIndex((s) => s.kind === "wait"); return i < 0 ? 0 : i; };

/** The form attached to a customer task, looked up from the definition. */
function formForTask(defId: string, nodeId: string): FormDefinition | undefined {
  const node = getNode(getDefinition(defId), nodeId);
  return node.type === "userTask" && node.formId ? getForm(node.formId) : undefined;
}

/** GET intake: a fresh application id + the journey's steps and first form. No
 *  instance is created yet — the workflow starts only on the first full submit. */
export function journeyIntake(token: string): PublicStatus {
  const j = getJourney(token);
  if (!j) throw new Error("This product has no journey");
  const step = intakeStep(j);
  if (!step || !step.task) throw new Error("Journey has no intake form step");
  return {
    appId: randomUUID(),
    stage: "form",
    steps: publicSteps(j),
    current: stepIndex(j, step.key),
    substate: "form",
    title: j.title,
    form: formForTask(j.defId, step.task),
    pages: step.pages,
    draft: {},
    page: 0,
  };
}

/** Autosave partial wizard input for the current open form task (or the intake
 *  task before the instance exists). Never touches the workflow. */
export function saveJourneyDraft(token: string, appId: string, data: Context, page: number): void {
  const j = getJourney(token);
  if (!j) throw new Error("This product has no journey");
  let nodeId = openTaskForInstance(appId)?.nodeId; // undefined if no instance yet
  if (!nodeId) nodeId = intakeStep(j)?.task;
  if (!nodeId) throw new Error("No hay un paso de formulario para guardar");
  const node = getNode(getDefinition(j.defId), nodeId);
  const formId = node.type === "userTask" ? (node.formId ?? null) : null;
  saveDraft(appId, nodeId, j.defId, formId, data, page);
}

/** GET status: project the application onto the journey. Before the instance
 *  exists we're in the draft phase (rehydrate the wizard from the saved draft);
 *  after, we map the live flow node to form / analyzing / review / done. */
export function resolveJourney(token: string, appId: string): PublicStatus {
  const j = getJourney(token);
  if (!j) throw new Error("This product has no journey");
  const steps = publicSteps(j);

  let inst: ReturnType<typeof getInstance> | undefined;
  try { inst = getInstance(appId); } catch { inst = undefined; }

  if (!inst) {
    const step = intakeStep(j);
    if (!step || !step.task) throw new Error("Journey has no intake form step");
    const draft = getDraft(appId, step.task);
    return {
      appId, stage: "form", steps, current: stepIndex(j, step.key), substate: "form",
      title: j.title, form: formForTask(j.defId, step.task), pages: step.pages,
      draft: draft?.data ?? {}, page: draft?.page ?? 0,
    };
  }

  const def = getDefinition(inst.defId, inst.defVersion);
  if (inst.status === "failed") {
    return { appId, stage: "error", steps, title: j.title, message: "No pudimos procesar tu solicitud. Probá de nuevo." };
  }
  if (inst.status === "completed") {
    const end = getNode(def, inst.currentNodeId);
    const name = ("name" in end && end.name) || "";
    return {
      appId, stage: "done", steps, current: steps.length - 1, substate: "done",
      outcome: isDeclined(name) ? "declined" : "approved", title: name || j.title,
      summary: safeSummary(inst.context),
    };
  }

  const task = openTaskForInstance(appId);
  if (task) {
    const node = getNode(def, task.nodeId);
    const formStep = j.steps.find((s) => s.kind === "form" && s.task === task.nodeId);
    if (formStep && node.type === "userTask" && !node.candidateRole) {
      const draft = getDraft(appId, task.nodeId);
      return {
        appId, stage: "form", steps, current: stepIndex(j, formStep.key), substate: "form",
        title: j.title, form: node.formId ? getForm(node.formId) : undefined, pages: formStep.pages,
        draft: draft?.data ?? {}, page: draft?.page ?? 0,
      };
    }
    // staff task (compliance/underwriting) → "en revisión"
    const waitStep = j.steps.find((s) => (s.covers ?? []).includes(task.nodeId));
    return {
      appId, stage: "review", steps, current: waitStep ? stepIndex(j, waitStep.key) : waitIndex(j),
      substate: "review", title: j.title, message: "Un especialista del banco está revisando tu solicitud.",
      summary: safeSummary(inst.context),
    };
  }

  // running between nodes (service/gateway) → "analizando"
  const waitStep = j.steps.find((s) => (s.covers ?? []).includes(inst.currentNodeId));
  return {
    appId, stage: "processing", steps, current: waitStep ? stepIndex(j, waitStep.key) : waitIndex(j),
    substate: "analyzing", title: j.title, message: "Analizando con IA…", summary: safeSummary(inst.context),
  };
}

/** Final submit of the current form step. On the intake it creates the instance
 *  (id = appId) and completes the first task; on later customer steps it submits
 *  the open task. The draft is deleted once committed to the workflow. */
export async function submitJourneyStep(token: string, appId: string, data: Context): Promise<PublicStatus> {
  const j = getJourney(token);
  if (!j) throw new Error("This product has no journey");

  let inst: ReturnType<typeof getInstance> | undefined;
  try { inst = getInstance(appId); } catch { inst = undefined; }

  if (!inst) {
    // Intake: the workflow is born here, reusing the application id as instance id.
    const step = intakeStep(j);
    const { instanceId } = await startInstance(j.defId, undefined, appId);
    const task = openTaskForInstance(instanceId);
    if (task && isCustomerTask(getDefinition(j.defId), task.nodeId)) {
      await submitTask(task.id, data);
    }
    if (step?.task) deleteDraft(appId, step.task);
    return resolveJourney(token, appId);
  }

  const def = getDefinition(inst.defId, inst.defVersion);
  const task = openTaskForInstance(appId);
  if (!task || !isCustomerTask(def, task.nodeId)) throw new Error("No hay un paso pendiente para completar");
  await submitTask(task.id, data);
  deleteDraft(appId, task.nodeId);
  return resolveJourney(token, appId);
}
