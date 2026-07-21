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
import { decryptValue, encryptValue, isSecretField } from "./secrets.js";

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
  dueAt?: string | null;
  assignee?: string | null;
  role?: string | null;
  priority?: string | null;
}

export interface TimerRow {
  id: string;
  instanceId: string;
  nodeId: string;
  wakeAt: string;
  status: "open" | "fired";
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
    CREATE TABLE IF NOT EXISTS timers (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      wake_at TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT
    );
    CREATE TABLE IF NOT EXISTS triggers (
      token TEXT PRIMARY KEY,
      def_id TEXT NOT NULL,
      label TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      def_id TEXT NOT NULL,
      interval_seconds INTEGER NOT NULL,
      next_run TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      label TEXT
    );
    CREATE TABLE IF NOT EXISTS callbacks (
      token TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_name TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      target TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    -- Partial, resumable wizard input for the public portal. One row per open
    -- customer task (app_id + node_id); committed to the instance on final
    -- submit, then deleted. Never part of the workflow's audited state.
    CREATE TABLE IF NOT EXISTS form_drafts (
      app_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      def_id TEXT NOT NULL,
      token TEXT,
      form_id TEXT,
      data_json TEXT NOT NULL,
      page INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      created_at TEXT,
      PRIMARY KEY (app_id, node_id)
    );
  `);
  migrate();
}

/** Add a column only if it isn't already present (idempotent upgrade of old DBs). */
function addColumnIfMissing(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
  }
}

/** Additive, idempotent schema migrations so existing data/ upgrades cleanly. */
function migrate(): void {
  addColumnIfMissing("instances", "error", "error TEXT");
  addColumnIfMissing("tasks", "due_at", "due_at TEXT");
  addColumnIfMissing("tasks", "assignee", "assignee TEXT");
  addColumnIfMissing("tasks", "role", "role TEXT");
  addColumnIfMissing("tasks", "priority", "priority TEXT");
  addColumnIfMissing("tasks", "escalated", "escalated INTEGER DEFAULT 0");
  addColumnIfMissing("users", "area", "area TEXT");
  addColumnIfMissing("form_drafts", "token", "token TEXT");
  addColumnIfMissing("form_drafts", "created_at", "created_at TEXT");
  addColumnIfMissing("form_drafts", "reminders_sent", "reminders_sent INTEGER DEFAULT 0");
  addColumnIfMissing("form_drafts", "last_reminder_at", "last_reminder_at TEXT");
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

/** Published version history (newest first), with node/edge counts for display. */
export function listDefinitionVersions(id: string): { version: number; status: string; nodeCount: number; edgeCount: number }[] {
  const rows = db
    .prepare(`SELECT version, status, json FROM process_definitions WHERE id = ? AND version > 0 ORDER BY version DESC`)
    .all(id) as { version: number; status: string; json: string }[];
  return rows.map((r) => {
    const d = JSON.parse(r.json) as ProcessDefinition;
    return { version: r.version, status: r.status, nodeCount: d.nodes.length, edgeCount: d.edges.length };
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

/** Delete a workflow and everything it owns (instances, tasks, events, timers,
 *  callbacks, comments, triggers, schedules). Forms/connectors are shared, so
 *  they are left in place. */
export function deleteDefinition(id: string): void {
  const insts = db.prepare(`SELECT id FROM instances WHERE def_id = ?`).all(id) as { id: string }[];
  for (const { id: iid } of insts) {
    db.prepare(`DELETE FROM tasks WHERE instance_id = ?`).run(iid);
    db.prepare(`DELETE FROM events WHERE instance_id = ?`).run(iid);
    db.prepare(`DELETE FROM timers WHERE instance_id = ?`).run(iid);
    db.prepare(`DELETE FROM callbacks WHERE instance_id = ?`).run(iid);
    db.prepare(`DELETE FROM comments WHERE instance_id = ?`).run(iid);
  }
  db.prepare(`DELETE FROM instances WHERE def_id = ?`).run(id);
  db.prepare(`DELETE FROM triggers WHERE def_id = ?`).run(id);
  db.prepare(`DELETE FROM schedules WHERE def_id = ?`).run(id);
  db.prepare(`DELETE FROM process_definitions WHERE id = ?`).run(id);
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

export function deleteForm(id: string): void {
  db.prepare(`DELETE FROM form_definitions WHERE id = ?`).run(id);
}

// ---- connectors ----

function decryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = isSecretField(k) && typeof v === "string" ? decryptValue(v) : v;
  }
  return out;
}

/** Replace secret fields with a masked marker for API responses. */
function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = isSecretField(k) ? (v ? "" : "") : v; // never leak secrets to clients
  }
  return out;
}

/** For the UI: connectors with secrets masked. */
export function listConnectors(): ConnectorRow[] {
  const rows = db.prepare(`SELECT * FROM connectors`).all() as {
    id: string;
    type: string;
    config_json: string;
  }[];
  return rows.map((r) => ({ id: r.id, type: r.type, config: maskConfig(JSON.parse(r.config_json)) }));
}

/**
 * Persist a connector, encrypting secret fields. Secrets sent empty/blank are
 * treated as "unchanged" so the client never has to echo a key back to save
 * other fields.
 */
export function saveConnector(c: ConnectorRow): void {
  const incoming = c.config ?? {};
  const row = db.prepare(`SELECT config_json FROM connectors WHERE id = ?`).get(c.id) as
    | { config_json: string }
    | undefined;
  const existing: Record<string, unknown> = row ? JSON.parse(row.config_json) : {};

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (isSecretField(k)) {
      const s = typeof v === "string" ? v : "";
      if (s === "") { if (existing[k] != null) out[k] = existing[k]; } // keep stored (encrypted)
      else out[k] = encryptValue(s);
    } else out[k] = v;
  }
  // preserve stored secrets the client didn't send at all
  for (const [k, v] of Object.entries(existing)) {
    if (isSecretField(k) && !(k in incoming)) out[k] = v;
  }
  db.prepare(
    `INSERT OR REPLACE INTO connectors (id, type, config_json) VALUES (?, ?, ?)`,
  ).run(c.id, c.type, JSON.stringify(out));
}

/** For execution: connector with secrets decrypted. Server-side only. */
export function getConnector(id: string): ConnectorRow {
  const row = db.prepare(`SELECT * FROM connectors WHERE id = ?`).get(id) as
    | { id: string; type: string; config_json: string }
    | undefined;
  if (!row) throw new Error(`Connector not found: ${id}`);
  return { id: row.id, type: row.type, config: decryptConfig(JSON.parse(row.config_json)) };
}

export function deleteConnector(id: string): void {
  db.prepare(`DELETE FROM connectors WHERE id = ?`).run(id);
}

// ---- instances ----

export function createInstance(
  defId: string,
  defVersion: number,
  startNodeId: string,
  id?: string,
): ProcessInstance {
  const inst: ProcessInstance = {
    id: id ?? randomUUID(),
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
    error: (row.error as string) ?? undefined,
  };
}

export function saveInstance(inst: ProcessInstance): void {
  db.prepare(
    `UPDATE instances SET status = ?, current_node_id = ?, context_json = ?, error = ?
     WHERE id = ?`,
  ).run(inst.status, inst.currentNodeId, JSON.stringify(inst.context), inst.error ?? null, inst.id);
}

export function listInstances(): ProcessInstance[] {
  const rows = db.prepare(`SELECT id FROM instances`).all() as { id: string }[];
  return rows.map((r) => getInstance(r.id));
}

// ---- tasks ----

function rowToTask(row: Record<string, unknown>): TaskRow {
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    nodeId: row.node_id as string,
    formId: (row.form_id as string) ?? null,
    status: row.status as TaskRow["status"],
    dueAt: (row.due_at as string) ?? null,
    assignee: (row.assignee as string) ?? null,
    role: (row.role as string) ?? null,
    priority: (row.priority as string) ?? null,
  };
}

export interface CreateTaskOpts {
  dueAt?: string | null;
  assignee?: string | null;
  role?: string | null;
  priority?: string | null;
}

export function createTask(
  instanceId: string,
  nodeId: string,
  formId: string | null,
  opts: CreateTaskOpts = {},
): TaskRow {
  const task: TaskRow = {
    id: randomUUID(),
    instanceId,
    nodeId,
    formId,
    status: "open",
    dueAt: opts.dueAt ?? null,
    assignee: opts.assignee ?? null,
    role: opts.role ?? null,
    priority: opts.priority ?? null,
  };
  db.prepare(
    `INSERT INTO tasks (id, instance_id, node_id, form_id, status, due_at, assignee, role, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(task.id, instanceId, nodeId, formId, task.status, task.dueAt ?? null, task.assignee ?? null, task.role ?? null, task.priority ?? null);
  return task;
}

/** Assign (claim) an open task to a user. */
export function claimTask(id: string, assignee: string): void {
  db.prepare(`UPDATE tasks SET assignee = ? WHERE id = ?`).run(assignee, id);
}

export function getTask(id: string): TaskRow {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`Task not found: ${id}`);
  return rowToTask(row);
}

export function openTaskForInstance(instanceId: string): TaskRow | undefined {
  const row = db
    .prepare(
      `SELECT * FROM tasks WHERE instance_id = ? AND status = 'open'
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get(instanceId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToTask(row);
}

/** All open tasks across all instances (for the Inbox / SLA views). */
export function listOpenTasks(): TaskRow[] {
  const rows = db
    .prepare(`SELECT * FROM tasks WHERE status = 'open' ORDER BY rowid DESC`)
    .all() as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function completeTaskRow(id: string): void {
  db.prepare(`UPDATE tasks SET status = 'completed' WHERE id = ?`).run(id);
}

/** Open tasks past their due date that haven't been escalated yet. */
export function listOverdueTasks(nowIso: string): TaskRow[] {
  const rows = db
    .prepare(`SELECT * FROM tasks WHERE status = 'open' AND due_at IS NOT NULL AND due_at <= ? AND (escalated IS NULL OR escalated = 0)`)
    .all(nowIso) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function escalateTask(id: string): void {
  db.prepare(`UPDATE tasks SET escalated = 1, priority = 'high' WHERE id = ?`).run(id);
}

// ---- timers ----

export function createTimer(instanceId: string, nodeId: string, wakeAt: string): TimerRow {
  const t: TimerRow = { id: randomUUID(), instanceId, nodeId, wakeAt, status: "open" };
  db.prepare(
    `INSERT INTO timers (id, instance_id, node_id, wake_at, status) VALUES (?, ?, ?, ?, ?)`,
  ).run(t.id, instanceId, nodeId, wakeAt, t.status);
  return t;
}

function rowToTimer(row: Record<string, unknown>): TimerRow {
  return {
    id: row.id as string,
    instanceId: row.instance_id as string,
    nodeId: row.node_id as string,
    wakeAt: row.wake_at as string,
    status: row.status as TimerRow["status"],
  };
}

/** Open timers whose wake time has passed. */
export function dueTimers(nowIso: string): TimerRow[] {
  const rows = db
    .prepare(`SELECT * FROM timers WHERE status = 'open' AND wake_at <= ? ORDER BY wake_at ASC`)
    .all(nowIso) as Record<string, unknown>[];
  return rows.map(rowToTimer);
}

export function openTimerForInstance(instanceId: string): TimerRow | undefined {
  const row = db
    .prepare(`SELECT * FROM timers WHERE instance_id = ? AND status = 'open' ORDER BY rowid DESC LIMIT 1`)
    .get(instanceId) as Record<string, unknown> | undefined;
  return row ? rowToTimer(row) : undefined;
}

export function fireTimerRow(id: string): void {
  db.prepare(`UPDATE timers SET status = 'fired' WHERE id = ?`).run(id);
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

// ---- users & sessions (M11 auth) ----

export type Role = "admin" | "analyst" | "operator" | "viewer";

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /** Business area / queue (e.g. creditos, riesgo, cumplimiento). Operators only see their area's tasks. */
  area?: string | null;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
}

export type PublicUser = Pick<UserRow, "id" | "username" | "displayName" | "role" | "area">;

export function toPublicUser(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, area: u.area ?? null };
}

export function createUser(u: Omit<UserRow, "id" | "createdAt"> & { id?: string }): UserRow {
  const row: UserRow = { id: u.id ?? randomUUID(), createdAt: new Date().toISOString(), ...u };
  db.prepare(
    `INSERT INTO users (id, username, display_name, role, area, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.username, row.displayName, row.role, row.area ?? null, row.passwordHash, row.passwordSalt, row.createdAt);
  return row;
}

/** Set (or clear) a user's business area. */
export function updateUserArea(username: string, area: string | null): void {
  db.prepare(`UPDATE users SET area = ? WHERE username = ?`).run(area, username);
}

/** Rename a task queue/area across open tasks and stored definitions (idempotent). */
export function renameQueue(from: string, to: string): void {
  db.prepare(`UPDATE tasks SET role = ? WHERE role = ?`).run(to, from);
  db.prepare(`UPDATE process_definitions SET json = REPLACE(json, ?, ?)`)
    .run(`"candidateRole":"${from}"`, `"candidateRole":"${to}"`);
}

function rowToUser(r: Record<string, unknown>): UserRow {
  return {
    id: r.id as string,
    username: r.username as string,
    displayName: r.display_name as string,
    role: r.role as Role,
    area: (r.area as string) ?? null,
    passwordHash: r.password_hash as string,
    passwordSalt: r.password_salt as string,
    createdAt: r.created_at as string,
  };
}

export function getUserByUsername(username: string): UserRow | undefined {
  const r = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as Record<string, unknown> | undefined;
  return r ? rowToUser(r) : undefined;
}

export function getUserById(id: string): UserRow | undefined {
  const r = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToUser(r) : undefined;
}

export function listUsers(): PublicUser[] {
  const rows = db.prepare(`SELECT * FROM users ORDER BY created_at ASC`).all() as Record<string, unknown>[];
  return rows.map((r) => toPublicUser(rowToUser(r)));
}

export function countUsers(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
}

export function createSession(userId: string, token: string, expiresAt: string): void {
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
}

/** Resolve a session token to its user, honoring expiry. */
export function getSessionUser(token: string): UserRow | undefined {
  const s = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!s) return undefined;
  if (new Date(s.expires_at).getTime() < Date.now()) { deleteSession(token); return undefined; }
  return getUserById(s.user_id);
}

export function deleteSession(token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

// ---- audit log (who did what) ----

export function addAudit(actor: string, action: string, target?: string): void {
  db.prepare(`INSERT INTO audit_log (id, ts, actor, action, target) VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), new Date().toISOString(), actor, action, target ?? null);
}

export function listAudit(limit = 200): { ts: string; actor: string; action: string; target: string | null }[] {
  return db.prepare(`SELECT ts, actor, action, target FROM audit_log ORDER BY ts DESC LIMIT ?`).all(limit) as
    { ts: string; actor: string; action: string; target: string | null }[];
}

/** Task-related audit entries for one instance (target = instanceId), oldest first. */
export function auditForInstance(instanceId: string): { ts: string; actor: string; action: string }[] {
  return db.prepare(`SELECT ts, actor, action FROM audit_log WHERE target = ? AND action LIKE 'task.%' ORDER BY ts ASC`).all(instanceId) as
    { ts: string; actor: string; action: string }[];
}

// ---- triggers (inbound webhooks) ----

export interface TriggerRow { token: string; defId: string; label: string | null; enabled: number; createdAt: string }

export function createTrigger(defId: string, label: string): TriggerRow {
  const t: TriggerRow = { token: randomUUID().replace(/-/g, ""), defId, label: label || null, enabled: 1, createdAt: new Date().toISOString() };
  db.prepare(`INSERT INTO triggers (token, def_id, label, enabled, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(t.token, t.defId, t.label, t.enabled, t.createdAt);
  return t;
}
export function getTrigger(token: string): TriggerRow | undefined {
  const r = db.prepare(`SELECT * FROM triggers WHERE token = ?`).get(token) as any;
  return r ? { token: r.token, defId: r.def_id, label: r.label, enabled: r.enabled, createdAt: r.created_at } : undefined;
}
export function listTriggers(defId: string): TriggerRow[] {
  return (db.prepare(`SELECT * FROM triggers WHERE def_id = ? ORDER BY created_at DESC`).all(defId) as any[])
    .map((r) => ({ token: r.token, defId: r.def_id, label: r.label, enabled: r.enabled, createdAt: r.created_at }));
}
export function deleteTrigger(token: string): void {
  db.prepare(`DELETE FROM triggers WHERE token = ?`).run(token);
}

/** Create a trigger with a fixed, well-known token if it doesn't exist (for a public form). */
export function ensurePublicTrigger(token: string, defId: string, label: string): void {
  if (getTrigger(token)) return;
  db.prepare(`INSERT INTO triggers (token, def_id, label, enabled, created_at) VALUES (?, ?, ?, 1, ?)`)
    .run(token, defId, label, new Date().toISOString());
}

// ---- schedules (recurring starts) ----

export interface ScheduleRow { id: string; defId: string; intervalSeconds: number; nextRun: string; enabled: number; label: string | null }

export function createSchedule(defId: string, intervalSeconds: number, label: string): ScheduleRow {
  const s: ScheduleRow = { id: randomUUID(), defId, intervalSeconds, nextRun: new Date(Date.now() + intervalSeconds * 1000).toISOString(), enabled: 1, label: label || null };
  db.prepare(`INSERT INTO schedules (id, def_id, interval_seconds, next_run, enabled, label) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(s.id, s.defId, s.intervalSeconds, s.nextRun, s.enabled, s.label);
  return s;
}
function rowToSchedule(r: any): ScheduleRow {
  return { id: r.id, defId: r.def_id, intervalSeconds: r.interval_seconds, nextRun: r.next_run, enabled: r.enabled, label: r.label };
}
export function listSchedules(defId: string): ScheduleRow[] {
  return (db.prepare(`SELECT * FROM schedules WHERE def_id = ? ORDER BY next_run ASC`).all(defId) as any[]).map(rowToSchedule);
}
export function dueSchedules(nowIso: string): ScheduleRow[] {
  return (db.prepare(`SELECT * FROM schedules WHERE enabled = 1 AND next_run <= ?`).all(nowIso) as any[]).map(rowToSchedule);
}
export function bumpSchedule(id: string, nextRun: string): void {
  db.prepare(`UPDATE schedules SET next_run = ? WHERE id = ?`).run(nextRun, id);
}
export function deleteSchedule(id: string): void {
  db.prepare(`DELETE FROM schedules WHERE id = ?`).run(id);
}

// ---- callbacks (async connectors) ----

export interface CallbackRow { token: string; instanceId: string; nodeId: string; status: string }

export function createCallback(token: string, instanceId: string, nodeId: string): void {
  db.prepare(`INSERT OR REPLACE INTO callbacks (token, instance_id, node_id, status) VALUES (?, ?, ?, 'open')`)
    .run(token, instanceId, nodeId);
}
export function getCallback(token: string): CallbackRow | undefined {
  const r = db.prepare(`SELECT * FROM callbacks WHERE token = ?`).get(token) as any;
  return r ? { token: r.token, instanceId: r.instance_id, nodeId: r.node_id, status: r.status } : undefined;
}
export function completeCallback(token: string): void {
  db.prepare(`UPDATE callbacks SET status = 'done' WHERE token = ?`).run(token);
}

// ---- notifications (M15) ----

export interface NotificationRow { id: string; type: string; message: string; target: string | null; read: number; ts: string }

export function addNotification(userName: string, type: string, message: string, target?: string): void {
  if (!userName) return;
  db.prepare(`INSERT INTO notifications (id, user_name, type, message, target, read, ts) VALUES (?, ?, ?, ?, ?, 0, ?)`)
    .run(randomUUID(), userName, type, message, target ?? null, new Date().toISOString());
}
export function listNotifications(userName: string, limit = 50): NotificationRow[] {
  return db.prepare(`SELECT id, type, message, target, read, ts FROM notifications WHERE user_name = ? ORDER BY ts DESC LIMIT ?`).all(userName, limit) as unknown as NotificationRow[];
}
export function unreadCount(userName: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_name = ? AND read = 0`).get(userName) as { n: number }).n;
}
export function markAllNotificationsRead(userName: string): void {
  db.prepare(`UPDATE notifications SET read = 1 WHERE user_name = ?`).run(userName);
}

// ---- comments (M15) ----

export interface CommentRow { id: string; author: string; text: string; ts: string }

export function addComment(instanceId: string, author: string, text: string): CommentRow {
  const c: CommentRow = { id: randomUUID(), author, text, ts: new Date().toISOString() };
  db.prepare(`INSERT INTO comments (id, instance_id, author, text, ts) VALUES (?, ?, ?, ?, ?)`).run(c.id, instanceId, author, text, c.ts);
  return c;
}
export function listComments(instanceId: string): CommentRow[] {
  return db.prepare(`SELECT id, author, text, ts FROM comments WHERE instance_id = ? ORDER BY ts ASC`).all(instanceId) as unknown as CommentRow[];
}

// ---- uploaded files (M16) — stored base64 in the DB (fine for demo scale) ----

export function saveFile(id: string, name: string, mime: string, size: number, contentBase64: string): void {
  db.prepare(`INSERT INTO files (id, name, mime, size, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, name, mime, size, contentBase64, new Date().toISOString());
}
export function getFile(id: string): { name: string; mime: string; size: number; content: string } | undefined {
  const r = db.prepare(`SELECT name, mime, size, content FROM files WHERE id = ?`).get(id) as
    | { name: string; mime: string; size: number; content: string }
    | undefined;
  return r;
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

// ---- form drafts (resumable wizard input for the public portal) ----

export interface FormDraft {
  appId: string;
  nodeId: string;
  defId: string;
  token: string | null;
  formId: string | null;
  data: Context;
  page: number;
  updatedAt: string;
  createdAt: string | null;
  remindersSent: number;
  lastReminderAt: string | null;
}

function rowToDraft(r: Record<string, unknown>): FormDraft {
  return {
    appId: r.app_id as string,
    nodeId: r.node_id as string,
    defId: r.def_id as string,
    token: (r.token as string) ?? null,
    formId: (r.form_id as string) ?? null,
    data: JSON.parse((r.data_json as string) || "{}"),
    page: (r.page as number) ?? 0,
    updatedAt: r.updated_at as string,
    createdAt: (r.created_at as string) ?? null,
    remindersSent: (r.reminders_sent as number) ?? 0,
    lastReminderAt: (r.last_reminder_at as string) ?? null,
  };
}

/** Record that a recovery reminder was sent (does NOT touch updated_at, so the
 *  idle clock keeps measuring time since the customer's last real activity). */
export function markDraftReminded(appId: string, nodeId: string, count: number): void {
  db.prepare(`UPDATE form_drafts SET reminders_sent = ?, last_reminder_at = ? WHERE app_id = ? AND node_id = ?`)
    .run(count, new Date().toISOString(), appId, nodeId);
}

/** Upsert the partial input for one open customer task. */
export function saveDraft(
  appId: string,
  nodeId: string,
  defId: string,
  formId: string | null,
  data: Context,
  page: number,
  token: string | null = null,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO form_drafts (app_id, node_id, def_id, token, form_id, data_json, page, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(app_id, node_id) DO UPDATE SET
       data_json = excluded.data_json, page = excluded.page,
       form_id = excluded.form_id, token = excluded.token, updated_at = excluded.updated_at`,
  ).run(appId, nodeId, defId, token, formId, JSON.stringify(data ?? {}), page, now, now);
}

export function getDraft(appId: string, nodeId: string): FormDraft | undefined {
  const r = db.prepare(`SELECT * FROM form_drafts WHERE app_id = ? AND node_id = ?`).get(appId, nodeId) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToDraft(r) : undefined;
}

/** All open drafts (incomplete applications), most recently touched first. */
export function listDrafts(): FormDraft[] {
  const rows = db.prepare(`SELECT * FROM form_drafts ORDER BY updated_at DESC`).all() as Record<string, unknown>[];
  return rows.map(rowToDraft);
}

/** Any draft for this application (used before an instance exists — the intake). */
export function getAnyDraftForApp(appId: string): FormDraft | undefined {
  const rows = db.prepare(`SELECT node_id FROM form_drafts WHERE app_id = ? ORDER BY updated_at DESC LIMIT 1`).all(appId) as
    | { node_id: string }[];
  return rows.length ? getDraft(appId, rows[0].node_id) : undefined;
}

export function deleteDraft(appId: string, nodeId: string): void {
  db.prepare(`DELETE FROM form_drafts WHERE app_id = ? AND node_id = ?`).run(appId, nodeId);
}

/** Sweep drafts untouched for longer than `maxAgeMs` (abandoned wizards). */
export function purgeStaleDrafts(maxAgeMs: number): number {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const info = db.prepare(`DELETE FROM form_drafts WHERE updated_at < ?`).run(cutoff);
  return Number(info.changes ?? 0);
}
