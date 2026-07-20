// The process engine — PURE logic. No DB, no network. All I/O (running a
// connector) is injected via EngineDeps so the routing logic stays unit-
// testable without infrastructure. This is the highest-risk component, so it
// lives on its own with no side effects.

import {
  type Context,
  type Json,
  type Mapping,
  type MultiInstance,
  type ProcessDefinition,
  type ServiceTaskNode,
  type ProcessInstance,
  type UserTaskNode,
  type TimerNode,
  edgeById,
  getNode,
  outgoingEdges,
} from "@cassiopeia/model";
import { evalBool } from "@cassiopeia/expr";

export interface EngineEvent {
  type:
    | "instance.started"
    | "node.entered"
    | "task.created"
    | "task.completed"
    | "service.completed"
    | "service.failed"
    | "service.retried"
    | "service.pending"
    | "callback.received"
    | "agent.usage"
    | "subprocess.completed"
    | "task.escalated"
    | "gateway.evaluated"
    | "timer.scheduled"
    | "timer.fired"
    | "instance.completed"
    | "instance.failed";
  nodeId?: string;
  payload?: Json;
}

export interface EngineDeps {
  /** Execute a connector and return its result. The only I/O the engine does. */
  runConnector(connectorId: string, input: Context): Promise<Context>;
  /** Run another process to completion and return its final context (call-activity). */
  runSubprocess?(processId: string, input: Context): Promise<Context>;
  /** Append an event to the audit log. */
  emit(event: EngineEvent): void;
}

export type AdvanceResult =
  | { status: "waiting"; task: UserTaskNode }
  | { status: "sleeping"; timer: TimerNode }
  | { status: "awaiting"; node: ServiceTaskNode; token: string }
  | { status: "completed" }
  | { status: "failed"; error: string };

/**
 * Structural validation of a definition. Returned to the designer and enforced
 * at publish time so a broken flow can't be deployed. Pure — no I/O.
 */
export function validateDefinition(def: ProcessDefinition): string[] {
  const errors: string[] = [];
  const ids = new Set(def.nodes.map((n) => n.id));

  const start = def.nodes.find((n) => n.id === def.startNodeId);
  if (!start) errors.push(`Start node '${def.startNodeId}' does not exist`);
  else if (start.type !== "start") errors.push(`Start node must be of type 'start'`);
  if (!def.nodes.some((n) => n.type === "end")) errors.push(`Flow has no end node`);

  for (const e of def.edges) {
    if (!ids.has(e.from)) errors.push(`Edge ${e.id} starts at missing node '${e.from}'`);
    if (!ids.has(e.to)) errors.push(`Edge ${e.id} ends at missing node '${e.to}'`);
  }

  for (const node of def.nodes) {
    const out = outgoingEdges(def, node.id);
    switch (node.type) {
      case "end":
        break;
      case "gateway": {
        if (out.length < 1) errors.push(`Gateway '${node.name}' needs at least one outgoing edge`);
        const outIds = new Set(out.map((e) => e.id));
        if (!outIds.has(node.defaultEdgeId))
          errors.push(`Gateway '${node.name}' default edge is not one of its outgoing edges`);
        for (const b of node.branches)
          if (!outIds.has(b.edgeId))
            errors.push(`Gateway '${node.name}' branch references a non-outgoing edge`);
        break;
      }
      case "serviceTask": {
        if (!node.connectorId) errors.push(`Service task '${node.name}' has no connector`);
        const successEdges = out.filter((e) => e.id !== node.onErrorEdgeId);
        if (successEdges.length !== 1)
          errors.push(`Service task '${node.name}' must have exactly one (non-error) outgoing edge`);
        if (node.onErrorEdgeId && !out.some((e) => e.id === node.onErrorEdgeId))
          errors.push(`Service task '${node.name}' error edge is not one of its outgoing edges`);
        break;
      }
      case "userTask":
        if (out.length !== 1) errors.push(`User task '${node.name}' must have exactly one outgoing edge`);
        break;
      case "timer":
        if (out.length !== 1) errors.push(`Timer '${node.name}' must have exactly one outgoing edge`);
        if (!node.delaySeconds && !node.untilPath) errors.push(`Timer '${node.name}' needs a delay or an 'until' path`);
        break;
      case "subprocess":
        if (!node.processId) errors.push(`Subprocess '${node.name}' has no target process`);
        if (out.length !== 1) errors.push(`Subprocess '${node.name}' must have exactly one outgoing edge`);
        break;
      case "start":
        if (out.length !== 1) errors.push(`Start must have exactly one outgoing edge`);
        break;
    }
  }
  return errors;
}

// ---- context read/write helpers (dotted paths) ----

function getPath(ctx: Context, path: string): Json {
  let cur: Json = ctx;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object" || Array.isArray(cur)) return null;
    cur = (cur as Record<string, Json>)[part] ?? null;
  }
  return cur;
}

function setPath(ctx: Context, path: string, value: Json): void {
  const parts = path.split(".");
  let cur: Record<string, Json> = ctx;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nx = cur[key];
    if (nx == null || typeof nx !== "object" || Array.isArray(nx)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, Json>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Build a connector input. No map => send the whole context. */
function applyInputMap(ctx: Context, map?: Mapping): Context {
  if (!map) return { ...ctx };
  const out: Context = {};
  for (const [inputKey, path] of Object.entries(map)) {
    out[inputKey] = getPath(ctx, path);
  }
  return out;
}

/** Merge a result into the context. No map => shallow-merge whole result. */
function applyOutputMap(ctx: Context, result: Context, map?: Mapping): void {
  if (!map) {
    for (const [k, v] of Object.entries(result)) ctx[k] = v;
    return;
  }
  for (const [targetPath, resultKey] of Object.entries(map)) {
    setPath(ctx, targetPath, result[resultKey] ?? null);
  }
}

function singleNext(def: ProcessDefinition, nodeId: string): string {
  const edges = outgoingEdges(def, nodeId);
  if (edges.length !== 1) {
    throw new Error(
      `Node ${nodeId} must have exactly one outgoing edge (found ${edges.length})`,
    );
  }
  return edges[0].to;
}

/** The success edge of a service task = its single outgoing edge that isn't the error edge. */
function serviceNext(def: ProcessDefinition, node: ServiceTaskNode): string {
  const edges = outgoingEdges(def, node.id).filter((e) => e.id !== node.onErrorEdgeId);
  if (edges.length !== 1) {
    throw new Error(
      `Service task ${node.id} must have exactly one non-error outgoing edge (found ${edges.length})`,
    );
  }
  return edges[0].to;
}

/**
 * Fan-out: run `runOne` for each item of the collection at `mi.collectionPath`,
 * passing the item under `mi.itemKey`, and collect the outputs into
 * `mi.resultPath` (default "results").
 */
async function runMulti(
  mi: MultiInstance,
  ctx: Context,
  baseInput: Context,
  runOne: (itemInput: Context) => Promise<Context>,
): Promise<void> {
  const arr = getPath(ctx, mi.collectionPath);
  const items = Array.isArray(arr) ? arr : [];
  const key = mi.itemKey ?? "item";
  const results: Json[] = [];
  for (const item of items) {
    const out = await runOne({ ...baseInput, [key]: item });
    results.push(out as Json);
  }
  setPath(ctx, mi.resultPath ?? "results", results as Json);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reject a connector call that runs longer than `ms` (0 disables the timeout). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`connector timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Run a connector with the node's retry/backoff/timeout policy. */
async function runWithPolicy(
  node: ServiceTaskNode,
  input: Context,
  deps: EngineDeps,
): Promise<Context> {
  const retries = Math.max(0, Math.floor(node.retries ?? 0));
  const base = Math.max(0, node.retryDelayMs ?? 500);
  const timeoutMs = node.timeoutMs ?? 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(deps.runConnector(node.connectorId, input), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        deps.emit({
          type: "service.retried",
          nodeId: node.id,
          payload: { attempt: attempt + 1, of: retries, error: (err as Error).message },
        });
        await sleep(base * Math.pow(2, attempt)); // exponential backoff
      }
    }
  }
  throw lastErr;
}

/**
 * Run the instance forward from its current node until it either parks at a
 * user task (the only wait state in the MVP) or reaches an end node. Mutates
 * instance.context, instance.currentNodeId and instance.status.
 */
export async function advance(
  def: ProcessDefinition,
  instance: ProcessInstance,
  deps: EngineDeps,
): Promise<AdvanceResult> {
  try {
    instance.status = "running";
    instance.error = undefined; // clear any prior failure (e.g. on retry)
    for (;;) {
      const node = getNode(def, instance.currentNodeId);
      deps.emit({ type: "node.entered", nodeId: node.id });

      switch (node.type) {
        case "start": {
          instance.currentNodeId = singleNext(def, node.id);
          break;
        }
        case "userTask": {
          instance.status = "waiting";
          deps.emit({ type: "task.created", nodeId: node.id });
          return { status: "waiting", task: node };
        }
        case "serviceTask": {
          const input = applyInputMap(instance.context, node.inputMap);
          try {
            // Fan-out: run the connector once per item of a collection.
            if (node.multiInstance) {
              await runMulti(node.multiInstance, instance.context, input, (itemInput) => runWithPolicy(node, itemInput, deps));
              deps.emit({ type: "service.completed", nodeId: node.id, payload: { multiInstance: node.multiInstance.collectionPath } });
              instance.currentNodeId = serviceNext(def, node);
              break;
            }
            const result = await runWithPolicy(node, input, deps);
            // Async connector: parks until resumeCallback() arrives.
            if (result && (result as Record<string, Json>).__awaitCallback) {
              instance.status = "waiting";
              const token = String((result as Record<string, Json>).__callbackToken ?? "");
              deps.emit({ type: "service.pending", nodeId: node.id, payload: { token } });
              return { status: "awaiting", node, token };
            }
            applyOutputMap(instance.context, result, node.outputMap);
            deps.emit({ type: "service.completed", nodeId: node.id, payload: result as Json });
            instance.currentNodeId = serviceNext(def, node);
            break;
          } catch (err) {
            const message = (err as Error).message;
            deps.emit({ type: "service.failed", nodeId: node.id, payload: { error: message } });
            // Error routing: continue down the error edge instead of failing.
            if (node.onErrorEdgeId) {
              instance.context.error = { node: node.id, message };
              const edge = edgeById(def, node.onErrorEdgeId);
              instance.currentNodeId = edge.to;
              break;
            }
            instance.status = "failed";
            instance.error = message;
            deps.emit({ type: "instance.failed", nodeId: node.id, payload: { error: message } });
            return { status: "failed", error: message };
          }
        }
        case "gateway": {
          let chosen = node.defaultEdgeId;
          for (const branch of node.branches) {
            if (evalBool(branch.when, instance.context)) {
              chosen = branch.edgeId;
              break;
            }
          }
          const edge = edgeById(def, chosen);
          deps.emit({
            type: "gateway.evaluated",
            nodeId: node.id,
            payload: { edge: edge.id, to: edge.to },
          });
          instance.currentNodeId = edge.to;
          break;
        }
        case "timer": {
          // Park here; the scheduler computes the wake time and resumes later.
          instance.status = "waiting";
          deps.emit({ type: "timer.scheduled", nodeId: node.id });
          return { status: "sleeping", timer: node };
        }
        case "subprocess": {
          if (!deps.runSubprocess) {
            instance.status = "failed"; instance.error = "subprocess execution not available";
            return { status: "failed", error: "subprocess execution not available" };
          }
          const input = applyInputMap(instance.context, node.inputMap);
          try {
            if (node.multiInstance) {
              await runMulti(node.multiInstance, instance.context, input, (itemInput) => deps.runSubprocess!(node.processId, itemInput));
            } else {
              const result = await deps.runSubprocess(node.processId, input);
              applyOutputMap(instance.context, result, node.outputMap);
            }
            deps.emit({ type: "subprocess.completed", nodeId: node.id, payload: { processId: node.processId } });
            instance.currentNodeId = singleNext(def, node.id);
            break;
          } catch (err) {
            const message = (err as Error).message;
            instance.status = "failed"; instance.error = message;
            deps.emit({ type: "instance.failed", nodeId: node.id, payload: { error: message } });
            return { status: "failed", error: message };
          }
        }
        case "end": {
          instance.status = "completed";
          deps.emit({ type: "instance.completed", nodeId: node.id });
          return { status: "completed" };
        }
      }
    }
  } catch (err) {
    const message = (err as Error).message;
    instance.status = "failed";
    instance.error = message;
    deps.emit({ type: "instance.failed", nodeId: instance.currentNodeId, payload: { error: message } });
    return { status: "failed", error: message };
  }
}

/**
 * Resume a parked instance by completing its current user task with submitted
 * form data, then advancing again.
 */
export async function completeTask(
  def: ProcessDefinition,
  instance: ProcessInstance,
  taskNodeId: string,
  formData: Context,
  deps: EngineDeps,
): Promise<AdvanceResult> {
  const node = getNode(def, taskNodeId);
  if (node.type !== "userTask") {
    return { status: "failed", error: `Node ${taskNodeId} is not a user task` };
  }
  if (instance.currentNodeId !== taskNodeId) {
    return {
      status: "failed",
      error: `Instance is not waiting at ${taskNodeId} (at ${instance.currentNodeId})`,
    };
  }
  applyOutputMap(instance.context, formData, node.outputMap);
  deps.emit({ type: "task.completed", nodeId: node.id, payload: formData as Json });
  instance.currentNodeId = singleNext(def, node.id);
  return advance(def, instance, deps);
}

/**
 * Resume an instance parked at a timer node once its wake time has passed: step
 * past the timer to its next node, then run forward again.
 */
export async function resumeTimer(
  def: ProcessDefinition,
  instance: ProcessInstance,
  timerNodeId: string,
  deps: EngineDeps,
): Promise<AdvanceResult> {
  const node = getNode(def, timerNodeId);
  if (node.type !== "timer") {
    return { status: "failed", error: `Node ${timerNodeId} is not a timer` };
  }
  if (instance.currentNodeId !== timerNodeId) {
    return { status: "failed", error: `Instance is not sleeping at ${timerNodeId} (at ${instance.currentNodeId})` };
  }
  deps.emit({ type: "timer.fired", nodeId: node.id });
  instance.currentNodeId = singleNext(def, node.id);
  return advance(def, instance, deps);
}

/**
 * Resume a service task that was awaiting an async callback: merge the callback
 * data into the context (via the node's outputMap) and run forward.
 */
export async function resumeCallback(
  def: ProcessDefinition,
  instance: ProcessInstance,
  nodeId: string,
  data: Context,
  deps: EngineDeps,
): Promise<AdvanceResult> {
  const node = getNode(def, nodeId);
  if (node.type !== "serviceTask") {
    return { status: "failed", error: `Node ${nodeId} is not a service task` };
  }
  if (instance.currentNodeId !== nodeId) {
    return { status: "failed", error: `Instance is not awaiting at ${nodeId} (at ${instance.currentNodeId})` };
  }
  applyOutputMap(instance.context, data, node.outputMap);
  deps.emit({ type: "callback.received", nodeId: node.id, payload: data as Json });
  instance.currentNodeId = serviceNext(def, node);
  return advance(def, instance, deps);
}
