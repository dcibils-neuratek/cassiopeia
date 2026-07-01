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
  type AdvanceResult,
  type EngineDeps,
} from "@cassiopeia/engine";
import type { Context, Json, ProcessDefinition, ProcessInstance } from "@cassiopeia/model";
import {
  addEvent,
  completeTaskRow,
  createInstance,
  createTask,
  createTimer,
  dueTimers,
  fireTimerRow,
  getDefinition,
  getInstance,
  getTask,
  openTaskForInstance,
  saveInstance,
} from "./db.js";
import { getNode } from "@cassiopeia/model";
import { runConnector } from "./connectors.js";

function depsFor(instanceId: string): EngineDeps {
  return {
    runConnector,
    emit: (event) => addEvent(instanceId, event, new Date().toISOString()),
  };
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
      createTask(inst.id, node.id, node.formId ?? null, dueAt);
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
  }
}

/** Start a new instance of a definition and run it until the first wait/sleep/end. */
export async function startInstance(defId: string): Promise<{
  instanceId: string;
  result: AdvanceResult;
}> {
  const def = getDefinition(defId);
  const inst = createInstance(def.id, def.version, def.startNodeId);
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

/** Poll for due timers on an interval. Returns a stop function. */
export function startScheduler(intervalMs = 1000): () => void {
  const t = setInterval(() => {
    fireDueTimers().catch(() => { /* logged via events */ });
  }, intervalMs);
  if (typeof t.unref === "function") t.unref();
  return () => clearInterval(t);
}
