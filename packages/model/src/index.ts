// The shared contract. apps/web (designer) and the engine MUST agree on this.

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Context = Record<string, Json>;

/** A dotted path into the process context, e.g. "customer.income". */
export type ContextPath = string;

/** An expression string evaluated by @cassiopeia/expr, e.g. "riskScore > 0.7". */
export type Expr = string;

/**
 * Maps data across a node boundary.
 *   inputMap:  { connectorInputKey: "context.path" }  (read from context)
 *   outputMap: { "context.path": resultKey }          (write into context)
 * When omitted, MVP default is: send whole context / merge whole result.
 */
export type Mapping = Record<string, ContextPath>;

export type NodeType =
  | "start"
  | "end"
  | "userTask"
  | "serviceTask"
  | "gateway"
  | "timer";

export interface StartNode {
  id: string;
  type: "start";
}
export interface EndNode {
  id: string;
  type: "end";
  name?: string;
}
export interface UserTaskNode {
  id: string;
  type: "userTask";
  name: string;
  formId?: string;
  /** Where the submitted form data lands. Omit to merge at context root. */
  outputMap?: Mapping;
  /** Service-level target: hours until the task is considered overdue. */
  slaHours?: number;
  /** Default assignee (a user) this task lands on in the inbox. */
  assignee?: string;
  /** Candidate group/role that may claim the task when unassigned. */
  candidateRole?: string;
  /** Work priority; drives inbox ordering. */
  priority?: "low" | "normal" | "high";
}

/**
 * Wait node. The engine parks here; a background scheduler resumes it once the
 * wake time passes. `delaySeconds` waits a fixed duration; `untilPath` reads an
 * ISO date from the context to wait until (takes precedence when it parses).
 */
export interface TimerNode {
  id: string;
  type: "timer";
  name: string;
  delaySeconds?: number;
  untilPath?: ContextPath;
}
export interface ServiceTaskNode {
  id: string;
  type: "serviceTask";
  name: string;
  connectorId: string;
  inputMap?: Mapping;
  outputMap?: Mapping;
  /** Retry policy for the connector call. */
  retries?: number; // extra attempts after the first (0 = no retry)
  retryDelayMs?: number; // base backoff; doubles each attempt
  timeoutMs?: number; // abort a single attempt after this long (0 = no timeout)
  /**
   * Outgoing edge taken when the connector ultimately fails (after retries).
   * When set, the failure is caught, `error` is written to the context, and the
   * flow continues down this edge instead of failing the whole instance.
   */
  onErrorEdgeId?: string;
}
export interface GatewayBranch {
  edgeId: string;
  when: Expr;
}
export interface GatewayNode {
  id: string;
  type: "gateway";
  name: string;
  branches: GatewayBranch[];
  /** Edge taken when no branch matches. */
  defaultEdgeId: string;
}

export type Node =
  | StartNode
  | EndNode
  | UserTaskNode
  | ServiceTaskNode
  | GatewayNode
  | TimerNode;

export interface Edge {
  id: string;
  from: string;
  to: string;
}

export interface XY {
  x: number;
  y: number;
}

export interface ProcessDefinition {
  id: string;
  name: string;
  version: number;
  status: "draft" | "published";
  startNodeId: string;
  nodes: Node[];
  edges: Edge[];
  /** Canvas positions per node id. Designer-only; the engine ignores it. */
  layout?: Record<string, XY>;
}

export type InstanceStatus = "running" | "waiting" | "completed" | "failed";

export interface ProcessInstance {
  id: string;
  defId: string;
  defVersion: number;
  status: InstanceStatus;
  currentNodeId: string;
  context: Context;
  /** Populated when status is "failed": the reason the run stopped. */
  error?: string;
}

// ---- forms ----
// Forms are part of the contract too (api stores them, portal + designer render
// them), so the types live here. The React renderer lives in @cassiopeia/form-kit.

export type FieldKind =
  | "text"
  | "number"
  | "date"
  | "email"
  | "select"
  | "checkbox"
  | "file";

export interface FieldOption {
  label: string;
  value: string;
}

export interface FormField {
  kind: FieldKind;
  id: string;
  /** Where the value lands in the process context (dotted path). */
  bind: ContextPath;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: Json;
  options?: FieldOption[]; // select
  min?: number; // number
  max?: number; // number
  pattern?: string; // text/email regex
  /** Shown only when this expression is truthy, evaluated against form values. */
  visibleIf?: Expr;
}

export interface FormDefinition {
  id: string;
  version: number;
  title: string;
  /** MVP: a flat field list. Pages/panels/dynamic-panels come later. */
  fields: FormField[];
}

// ---- lookup helpers shared across the codebase ----

export function getNode(def: ProcessDefinition, id: string): Node {
  const n = def.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`Node not found: ${id}`);
  return n;
}

export function outgoingEdges(def: ProcessDefinition, nodeId: string): Edge[] {
  return def.edges.filter((e) => e.from === nodeId);
}

export function edgeById(def: ProcessDefinition, edgeId: string): Edge {
  const e = def.edges.find((x) => x.id === edgeId);
  if (!e) throw new Error(`Edge not found: ${edgeId}`);
  return e;
}
