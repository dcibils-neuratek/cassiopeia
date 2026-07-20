import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, validateDefinition, type EngineEvent, type EngineDeps } from "../src/index.js";
import type { Context, ProcessDefinition, ProcessInstance } from "@cassiopeia/model";

function inst(def: ProcessDefinition, ctx: Context = {}): ProcessInstance {
  return { id: "i", defId: def.id, defVersion: 1, status: "running", currentNodeId: def.startNodeId, context: { ...ctx } };
}
function collectDeps(over: Partial<EngineDeps> = {}): { deps: EngineDeps; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  return { events, deps: { runConnector: async () => ({}), emit: (e) => events.push(e), ...over } };
}

const linear = (svc: any): ProcessDefinition => ({
  id: "t", name: "t", version: 1, status: "published", startNodeId: "s",
  nodes: [{ id: "s", type: "start" }, svc, { id: "e", type: "end" }],
  edges: [{ id: "e1", from: "s", to: svc.id }, { id: "e2", from: svc.id, to: "e" }],
});

test("gateway routes on a branch condition", async () => {
  const def: ProcessDefinition = {
    id: "g", name: "g", version: 1, status: "published", startNodeId: "s",
    nodes: [
      { id: "s", type: "start" },
      { id: "gw", type: "gateway", name: "risk", branches: [{ edgeId: "hi", when: "risk > 0.5" }], defaultEdgeId: "lo" },
      { id: "manual", type: "end", name: "manual" }, { id: "auto", type: "end", name: "auto" },
    ],
    edges: [{ id: "e0", from: "s", to: "gw" }, { id: "hi", from: "gw", to: "manual" }, { id: "lo", from: "gw", to: "auto" }],
  };
  const a = inst(def, { risk: 0.9 }); await advance(def, a, collectDeps().deps);
  assert.equal(a.currentNodeId, "manual");
  const b = inst(def, { risk: 0.1 }); await advance(def, b, collectDeps().deps);
  assert.equal(b.currentNodeId, "auto");
});

test("service task retries then fails with a reason", async () => {
  const def = linear({ id: "svc", type: "serviceTask", name: "call", connectorId: "c", retries: 2, retryDelayMs: 1 });
  let calls = 0;
  const { deps, events } = collectDeps({ runConnector: async () => { calls++; throw new Error("boom"); } });
  const i = inst(def); const r = await advance(def, i, deps);
  assert.equal(r.status, "failed");
  assert.equal(i.error, "boom");
  assert.equal(calls, 3); // 1 + 2 retries
  assert.equal(events.filter((e) => e.type === "service.retried").length, 2);
  assert.ok(events.some((e) => e.type === "instance.failed"));
});

test("service task recovers after transient failures", async () => {
  const def = linear({ id: "svc", type: "serviceTask", name: "call", connectorId: "c", retries: 3, retryDelayMs: 1 });
  let n = 0;
  const { deps } = collectDeps({ runConnector: async () => { if (n++ < 2) throw new Error("x"); return { ok: true }; } });
  const i = inst(def); const r = await advance(def, i, deps);
  assert.equal(r.status, "completed");
  assert.equal(i.context.ok, true);
});

test("error routing continues down the error edge", async () => {
  const def: ProcessDefinition = {
    id: "er", name: "er", version: 1, status: "published", startNodeId: "s",
    nodes: [
      { id: "s", type: "start" },
      { id: "svc", type: "serviceTask", name: "call", connectorId: "c", onErrorEdgeId: "err" },
      { id: "handler", type: "end", name: "handled" }, { id: "e", type: "end" },
    ],
    edges: [{ id: "e1", from: "s", to: "svc" }, { id: "ok", from: "svc", to: "e" }, { id: "err", from: "svc", to: "handler" }],
  };
  const { deps } = collectDeps({ runConnector: async () => { throw new Error("down"); } });
  const i = inst(def); const r = await advance(def, i, deps);
  assert.equal(r.status, "completed");
  assert.equal(i.currentNodeId, "handler");
  assert.ok(i.context.error);
});

test("timer parks the instance (sleeping)", async () => {
  const def = linear({ id: "svc", type: "timer", name: "wait", delaySeconds: 60 });
  const i = inst(def); const r = await advance(def, i, collectDeps().deps);
  assert.equal(r.status, "sleeping");
  assert.equal(i.currentNodeId, "svc");
});

test("multi-instance fans out over a collection", async () => {
  const def = linear({ id: "svc", type: "serviceTask", name: "each", connectorId: "c", multiInstance: { collectionPath: "nums", itemKey: "n", resultPath: "out" } });
  const { deps } = collectDeps({ runConnector: async (_id, input: Context) => ({ v: (input.n as number) * 10 }) });
  const i = inst(def, { nums: [1, 2, 3] }); const r = await advance(def, i, deps);
  assert.equal(r.status, "completed");
  assert.deepEqual((i.context.out as any[]).map((x) => x.v), [10, 20, 30]);
});

test("subprocess merges the child's context", async () => {
  const def = linear({ id: "svc", type: "subprocess", name: "call", processId: "child" });
  const { deps } = collectDeps({ runSubprocess: async () => ({ score: 720 }) });
  const i = inst(def); const r = await advance(def, i, deps);
  assert.equal(r.status, "completed");
  assert.equal(i.context.score, 720);
});

test("validateDefinition flags a missing end and bad gateway edge", () => {
  const bad: ProcessDefinition = {
    id: "b", name: "b", version: 1, status: "draft", startNodeId: "s",
    nodes: [{ id: "s", type: "start" }, { id: "gw", type: "gateway", name: "g", branches: [{ edgeId: "nope", when: "x" }], defaultEdgeId: "nope" }],
    edges: [{ id: "e1", from: "s", to: "gw" }],
  };
  const errors = validateDefinition(bad);
  assert.ok(errors.some((e) => /no end node/i.test(e)));
});
