// Wires the pure engine to I/O: the DB, the connector runner, and the audit
// log. In the MVP the engine runs in-process — no queue, no worker. Resume is
// a direct function call from an API handler. (Extract to a worker later.)
//
// M7 adds time: a timer node parks the instance and a lightweight scheduler
// (startScheduler) resumes it once the wake time passes. User tasks can carry an
// SLA (slaHours) which is stored as the task's due_at.

import {
  advance,
  completeTask,
  resumeTimer,
  resumeCallback,
  type AdvanceResult,
  type EngineDeps,
} from "@cassiopeia/engine";
import type { Context, Json, ProcessDefinition, ProcessInstance } from "@cassiopeia/model";
import {
  addEvent,
  addNotification,
  bumpSchedule,
  completeCallback,
  completeTaskRow,
  createCallback,
  createInstance,
  createTask,
  createTimer,
  dueSchedules,
  dueTimers,
  escalateTask,
  fireTimerRow,
  getCallback,
  getDefinition,
  getInstance,
  getTask,
  listOverdueTasks,
  openTaskForInstance,
  saveInstance,
} from "./db.js";
import { getNode } from "@cassiopeia/model";
import { runConnector, runCtx } from "./connectors.js";

function depsFor(instanceId: string): EngineDeps {
  const emit = (event: Parameters<EngineDeps["emit"]>[0]) => addEvent(instanceId, event, new Date().toISOString());
  return {
    // Run each connector inside a hook context so the ai-agent can report token
    // usage / cost back as an audit event without changing the engine interface.
    runConnector: (connectorId, input) =>
      runCtx.run(
        { connectorId, emitUsage: (usage) => emit({ type: "agent.usage", nodeId: connectorId, payload: usage }) },
        () => runConnector(connectorId, input),
      ),
    runSubprocess,
    emit,
  };
}

/**
 * Call-activity: run another published process to completion (in-process) and
 * return its final context. Persists a child instance for auditability. The
 * sub-process must complete synchronously — a human task inside it is an error.
 */
async function runSubprocess(processId: string, input: Context): Promise<Context> {
  const def = getDefinition(processId);
  const child = createInstance(def.id, def.version, def.startNodeId);
  child.context = { ...input };
  addEvent(child.id, { type: "instance.started", payload: { subprocess: true } }, new Date().toISOString());
  const result = await advance(def, child, depsFor(child.id));
  saveInstance(child);
  if (result.status !== "completed") {
    throw new Error(`Subprocess '${processId}' did not complete synchronously (status: ${result.status}). Sub-processes must be fully automated.`);
  }
  return child.context;
}

function getPath(ctx: Context, path: string): Json | undefined {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur as Json | undefined;
}

/**
 * After the engine parks, open the right thing: a task (with an SLA due date) for
 * a user task, or a timer (with a computed wake time) for a timer node.
 */
function onParked(def: ProcessDefinition, inst: ProcessInstance, result: AdvanceResult): void {
  if (result.status === "waiting" && !openTaskForInstance(inst.id)) {
    const node = getNode(def, inst.currentNodeId);
    if (node.type === "userTask") {
      const dueAt = node.slaHours
        ? new Date(Date.now() + node.slaHours * 3600_000).toISOString()
        : null;
      createTask(inst.id, node.id, node.formId ?? null, {
        dueAt,
        assignee: node.assignee ?? null,
        role: node.candidateRole ?? null,
        priority: node.priority ?? null,
      });
      if (node.assignee) addNotification(node.assignee, "task-assigned", `Task "${node.name}" was assigned to you`, inst.id);
    }
  } else if (result.status === "sleeping") {
    const node = result.timer;
    let wakeAt: string | null = null;
    if (node.untilPath) {
      const v = getPath(inst.context, node.untilPath);
      const t = typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : NaN;
      if (!Number.isNaN(t)) wakeAt = new Date(t).toISOString();
    }
    if (!wakeAt) wakeAt = new Date(Date.now() + (node.delaySeconds ?? 0) * 1000).toISOString();
    createTimer(inst.id, node.id, wakeAt);
  } else if (result.status === "awaiting") {
    createCallback(result.token, inst.id, result.node.id);
  }
}

/** Start a new instance of a definition and run it until the first wait/sleep/end.
 *  An explicit `id` lets a caller (e.g. the public portal) reuse a pre-issued
 *  application id as the instance id. */
export async function startInstance(defId: string, initialContext?: Context, id?: string): Promise<{
  instanceId: string;
  result: AdvanceResult;
}> {
  const def = getDefinition(defId);
  const inst = createInstance(def.id, def.version, def.startNodeId, id);
  if (initialContext && typeof initialContext === "object") inst.context = { ...initialContext };
  addEvent(inst.id, { type: "instance.started" }, new Date().toISOString());

  const result = await advance(def, inst, depsFor(inst.id));
  saveInstance(inst);
  onParked(def, inst, result);
  return { instanceId: inst.id, result };
}

/** Complete an open task with submitted form data and resume the instance. */
export async function submitTask(
  taskId: string,
  formData: Context,
): Promise<AdvanceResult> {
  const task = getTask(taskId);
  if (task.status !== "open") throw new Error("Task already completed");

  const inst = getInstance(task.instanceId);
  const def = getDefinition(inst.defId, inst.defVersion);

  const result = await completeTask(def, inst, task.nodeId, formData, depsFor(inst.id));

  completeTaskRow(task.id);
  saveInstance(inst);
  onParked(def, inst, result);
  return result;
}

/**
 * Re-run a failed instance from the node it stopped on (typically a service task
 * whose connector errored). Useful once a flaky dependency recovers.
 */
export async function retryInstance(instanceId: string): Promise<AdvanceResult> {
  const inst = getInstance(instanceId);
  if (inst.status !== "failed") throw new Error("Only failed instances can be retried");
  const def = getDefinition(inst.defId, inst.defVersion);

  addEvent(inst.id, { type: "node.entered", nodeId: inst.currentNodeId, payload: { retry: true } }, new Date().toISOString());
  const result = await advance(def, inst, depsFor(inst.id));
  saveInstance(inst);
  onParked(def, inst, result);
  return result;
}

/** Resume every timer whose wake time has passed. Called on a scheduler tick. */
export async function fireDueTimers(): Promise<number> {
  const now = new Date().toISOString();
  const due = dueTimers(now);
  let fired = 0;
  for (const timer of due) {
    fireTimerRow(timer.id);
    try {
      const inst = getInstance(timer.instanceId);
      if (inst.currentNodeId !== timer.nodeId || inst.status === "completed" || inst.status === "failed") continue;
      const def = getDefinition(inst.defId, inst.defVersion);
      const result = await resumeTimer(def, inst, timer.nodeId, depsFor(inst.id));
      saveInstance(inst);
      onParked(def, inst, result);
      fired++;
    } catch (err) {
      addEvent(timer.instanceId, { type: "instance.failed", nodeId: timer.nodeId, payload: { error: (err as Error).message } }, new Date().toISOString());
    }
  }
  return fired;
}

/** Resume an instance parked on an async connector, with the callback's data. */
export async function resumeViaCallback(token: string, data: Context): Promise<AdvanceResult> {
  const cb = getCallback(token);
  if (!cb || cb.status !== "open") throw new Error("Unknown or already-used callback token");
  const inst = getInstance(cb.instanceId);
  const def = getDefinition(inst.defId, inst.defVersion);
  const result = await resumeCallback(def, inst, cb.nodeId, data, depsFor(inst.id));
  completeCallback(token);
  saveInstance(inst);
  onParked(def, inst, result);
  return result;
}

/** Start any recurring schedules whose next-run time has passed. */
export async function fireDueSchedules(): Promise<number> {
  const now = Date.now();
  const due = dueSchedules(new Date(now).toISOString());
  let started = 0;
  for (const s of due) {
    bumpSchedule(s.id, new Date(now + s.intervalSeconds * 1000).toISOString());
    try { await startInstance(s.defId); started++; } catch { /* def may be gone */ }
  }
  return started;
}

/** Escalate open tasks that have blown their SLA (bump to high priority + audit). */
export function fireEscalations(): number {
  const now = new Date().toISOString();
  let n = 0;
  for (const t of listOverdueTasks(now)) {
    escalateTask(t.id);
    addEvent(t.instanceId, { type: "task.escalated", nodeId: t.nodeId, payload: { taskId: t.id, dueAt: t.dueAt ?? null } }, now);
    if (t.assignee) addNotification(t.assignee, "sla-escalated", "A task assigned to you is overdue and was escalated to high priority", t.instanceId);
    n++;
  }
  return n;
}

/** Poll for due timers, schedules, and SLA escalations. Returns a stop function. */
export function startScheduler(intervalMs = 1000): () => void {
  const t = setInterval(() => {
    fireDueTimers().catch(() => { /* logged via events */ });
    fireDueSchedules().catch(() => { /* def may be gone */ });
    try { fireEscalations(); } catch { /* best-effort */ }
  }, intervalMs);
  if (typeof t.unref === "function") t.unref();
  return () => clearInterval(t);
}
