// Wires the pure engine to I/O: the DB, the connector runner, and the audit
// log. In the MVP the engine runs in-process — no queue, no worker. Resume is
// a direct function call from an API handler. (Extract to a worker later.)

import {
  advance,
  completeTask,
  type AdvanceResult,
  type EngineDeps,
} from "@cassiopeia/engine";
import type { Context } from "@cassiopeia/model";
import {
  addEvent,
  completeTaskRow,
  createInstance,
  createTask,
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

/** Start a new instance of a definition and run it until the first wait/end. */
export async function startInstance(defId: string): Promise<{
  instanceId: string;
  result: AdvanceResult;
}> {
  const def = getDefinition(defId);
  const inst = createInstance(def.id, def.version, def.startNodeId);
  addEvent(inst.id, { type: "instance.started" }, new Date().toISOString());

  const result = await advance(def, inst, depsFor(inst.id));
  saveInstance(inst);
  if (result.status === "waiting") {
    createTask(inst.id, result.task.id, result.task.formId ?? null);
  }
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

  // If the flow parked at another user task, open it.
  if (result.status === "waiting") {
    const node = getNode(def, inst.currentNodeId);
    if (node.type === "userTask") {
      createTask(inst.id, node.id, node.formId ?? null);
    }
  }
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

  // If it now parks at a user task without an open one, open it.
  if (result.status === "waiting" && !openTaskForInstance(inst.id)) {
    const node = getNode(def, inst.currentNodeId);
    if (node.type === "userTask") createTask(inst.id, node.id, node.formId ?? null);
  }
  return result;
}
