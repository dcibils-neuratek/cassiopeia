// Thin data-access layer over node:sqlite. Deliberately hand-written SQL kept
// vanilla so this can be repointed at Postgres (via Drizzle) later without
// touching callers. JSON-heavy columns are stored as text.

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Context,
  FormDefinition,
  ProcessDefinition,
  ProcessInstance,
} from "@cassiopeia/model";
import type { EngineEvent } from "@cassiopeia/engine";

export interface ConnectorRow {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

export interface TaskRow {
  id: string;
  instanceId: string;
  nodeId: string;
  formId: string | null;
  status: "open" | "completed";
}

export interface StoredEvent extends EngineEvent {
  id: string;
  instanceId: string;
  ts: string;
}

let db: DatabaseSync;

export function initDb(path = "data/cassiopeia.sqlite"): void {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS process_definitions (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (id, version)
    );
    CREATE TABLE IF NOT EXISTS form_definitions (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (id, version)
    );
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      def_id TEXT NOT NULL,
      def_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      current_node_id TEXT NOT NULL,
      context_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      form_id TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      type TEXT NOT NULL,
      node_id TEXT,
      payload_json TEXT,
      ts TEXT NOT NULL
    );
  `);
}

// ---- definitions ----

export function saveDefinition(def: ProcessDefinition): void {
  db.prepare(
    `INSERT OR REPLACE INTO process_definitions (id, version, status, json)
     VALUES (?, ?, ?, ?)`,
  ).run(def.id, def.version, def.status, JSON.stringify(def));
}

export interface DefinitionSummary {
  id: string;
  name: string;
  latestVersion: number;
  status: string;
  hasPublished: boolean;
}

export function listDefinitions(): DefinitionSummary[] {
  const rows = db
    .prepare(
      `SELECT id, MAX(version) AS latest FROM process_definitions GROUP BY id`,
    )
    .all() as { id: string; latest: number }[];
  return rows.map((r) => {
    const latest = getDefinition(r.id, r.latest);
    const published = db
      .prepare(
        `SELECT MAX(version) AS v FROM process_definitions WHERE id = ? AND status = 'published'`,
      )
      .get(r.id) as { v: number | null };
    return {
      id: r.id,
      name: latest.name,
      latestVersion: r.latest,
      status: latest.status,
      hasPublished: published.v != null,
    };
  });
}

/** Version 0 is the mutable working draft. Published versions are 1..N. */
export function maxPublishedVersion(id: string): number {
  const row = db
    .prepare(
      `SELECT MAX(version) AS v FROM process_definitions WHERE id = ? AND status = 'published'`,
    )
    .get(id) as { v: number | null };
  return row.v ?? 0;
}

/** What the designer loads to edit: the draft if present, else latest published. */
export function getEditableDefinition(id: string): ProcessDefinition | null {
  const draft = db
    .prepare(`SELECT json FROM process_definitions WHERE id = ? AND version = 0`)
    .get(id) as { json: string } | undefined;
  if (draft) return JSON.parse(draft.json) as ProcessDefinition;
  const row = db
    .prepare(
      `SELECT json FROM process_definitions WHERE id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(id) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as ProcessDefinition) : null;
}

export function getDefinition(id: string, version?: number): ProcessDefinition {
  const row = version
    ? db
        .prepare(`SELECT json FROM process_definitions WHERE id = ? AND version = ?`)
        .get(id, version)
    : db
        .prepare(
          `SELECT json FROM process_definitions WHERE id = ?
           ORDER BY version DESC LIMIT 1`,
        )
        .get(id);
  if (!row) throw new Error(`Definition not found: ${id}`);
  return JSON.parse((row as { json: string }).json) as ProcessDefinition;
}

// ---- forms ----

export function saveForm(form: FormDefinition): void {
  db.prepare(
    `INSERT OR REPLACE INTO form_definitions (id, version, json) VALUES (?, ?, ?)`,
  ).run(form.id, form.version, JSON.stringify(form));
}

export function getForm(id: string, version?: number): FormDefinition {
  const row = version
    ? db.prepare(`SELECT json FROM form_definitions WHERE id = ? AND version = ?`).get(id, version)
    : db
        .prepare(`SELECT json FROM form_definitions WHERE id = ? ORDER BY version DESC LIMIT 1`)
        .get(id);
  if (!row) throw new Error(`Form not found: ${id}`);
  return JSON.parse((row as { json: string }).json) as FormDefinition;
}

export function listForms(): { id: string; title: string }[] {
  const rows = db
    .prepare(
      `SELECT id, MAX(version) AS latest FROM form_definitions GROUP BY id`,
    )
    .all() as { id: string; latest: number }[];
  return rows.map((r) => {
    const f = getForm(r.id, r.latest);
    return { id: f.id, title: f.title };
  });
}

// ---- connectors ----

export function listConnectors(): ConnectorRow[] {
  const rows = db.prepare(`SELECT * FROM connectors`).all() as {
    id: string;
    type: string;
    config_json: string;
  }[];
  return rows.map((r) => ({ id: r.id, type: r.type, config: JSON.parse(r.config_json) }));
}

export function saveConnector(c: ConnectorRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO connectors (id, type, config_json) VALUES (?, ?, ?)`,
  ).run(c.id, c.type, JSON.stringify(c.config));
}

export function getConnector(id: string): ConnectorRow {
  const row = db.prepare(`SELECT * FROM connectors WHERE id = ?`).get(id) as
    | { id: string; type: string; config_json: string }
    | undefined;
  if (!row) throw new Error(`Connector not found: ${id}`);
  return { id: row.id, type: row.type, config: JSON.parse(row.config_json) };
}

// ---- instances ----

export function createInstance(
  defId: string,
  defVersion: number,
  startNodeId: string,
): ProcessInstance {
  const inst: ProcessInstance = {
    id: randomUUID(),
    defId,
    defVersion,
    status: "running",
    currentNodeId: startNodeId,
    context: {},
  };
  db.prepare(
    `INSERT INTO instances (id, def_id, def_version, status, current_node_id, context_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(inst.id, defId, defVersion, inst.status, startNodeId, "{}");
  return inst;
}

export function getInstance(id: string): ProcessInstance {
  const row = db.prepare(`SELECT * FROM instances WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`Instance not found: ${id}`);
  return {
    id: row.id as string,
    defId: row.def_id as string,
    defVersion: row.def_version as number,
    status: row.status as ProcessInstance["status"],
    currentNodeId: row.current_node_id as string,
    context: JSON.parse(row.context_json as string) as Context,
  };
}

export function saveInstance(inst: ProcessInstance): void {
  db.prepare(
    `UPDATE instances SET status = ?, current_node_id = ?, context_json = ?
     WHERE id = ?`,
  ).run(inst.status, inst.currentNodeId, JSON.stringify(inst.context), inst.id);
}

export function listInstances(): ProcessInstance[] {
  const rows = db.prepare(`SELECT id FROM instances`).all() as { id: string }[];
  return rows.map((r) => getInstance(r.id));
}

// ---- tasks ----

export function createTask(
  instanceId: string,
  nodeId: string,
  formId: string | null,
): TaskRow {
  const task: TaskRow = {
    id: randomUUID(),
    instanceId,
    nodeId,
    formId,
    status: "open",
  };
  db.prepare(
    `INSERT INTO tasks (id, instance_id, node_id, form_id, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(task.id, instanceId, nodeId, formId, task.status);
  return task;
}

export function getTask(id: string): TaskRow {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`Task not found: ${id}`);
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    nodeId: row.node_id as string,
    formId: (row.form_id as string) ?? null,
    status: row.status as TaskRow["status"],
  };
}

export function openTaskForInstance(instanceId: string): TaskRow | undefined {
  const row = db
    .prepare(
      `SELECT * FROM tasks WHERE instance_id = ? AND status = 'open'
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get(instanceId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    nodeId: row.node_id as string,
    formId: (row.form_id as string) ?? null,
    status: row.status as TaskRow["status"],
  };
}

export function completeTaskRow(id: string): void {
  db.prepare(`UPDATE tasks SET status = 'completed' WHERE id = ?`).run(id);
}

// ---- events (audit trail) ----

export function addEvent(instanceId: string, e: EngineEvent, ts: string): void {
  db.prepare(
    `INSERT INTO events (id, instance_id, type, node_id, payload_json, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    instanceId,
    e.type,
    e.nodeId ?? null,
    e.payload !== undefined ? JSON.stringify(e.payload) : null,
    ts,
  );
}

/** Daily counts of started/completed instances, for throughput charts. */
export function eventDailyCounts(): { day: string; type: string; n: number }[] {
  return db
    .prepare(
      `SELECT substr(ts, 1, 10) AS day, type, COUNT(*) AS n
       FROM events
       WHERE type IN ('instance.started', 'instance.completed')
       GROUP BY day, type`,
    )
    .all() as { day: string; type: string; n: number }[];
}

export function listEvents(instanceId: string): StoredEvent[] {
  const rows = db
    .prepare(`SELECT * FROM events WHERE instance_id = ? ORDER BY ts ASC, rowid ASC`)
    .all(instanceId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    instanceId: r.instance_id as string,
    type: r.type as EngineEvent["type"],
    nodeId: (r.node_id as string) ?? undefined,
    payload: r.payload_json ? JSON.parse(r.payload_json as string) : undefined,
    ts: r.ts as string,
  }));
}
