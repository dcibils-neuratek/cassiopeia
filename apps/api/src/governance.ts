// M9 governance: portable workflow bundles (export/import), a per-process data
// dictionary (which context keys are produced vs consumed), and CSV export of an
// instance's audit trail. Pure-ish helpers over the DB.

import type { FormDefinition, ProcessDefinition } from "@cassiopeia/model";
import {
  getConnector,
  getEditableDefinition,
  getForm,
  listEvents,
  saveConnector,
  saveDefinition,
  saveForm,
  type ConnectorRow,
} from "./db.js";

export interface WorkflowBundle {
  cassiopeia: "workflow-bundle";
  bundleVersion: 1;
  exportedAt?: string;
  definition: ProcessDefinition;
  forms: FormDefinition[];
  connectors: { id: string; type: string; config: Record<string, unknown> }[];
}

/** Config keys we never write into an exported bundle. */
const SECRET_KEYS = new Set(["apiKey", "apikey", "token", "secret", "password"]);

function stripSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) out[k] = SECRET_KEYS.has(k) ? "" : v;
  return out;
}

/** Bundle a workflow: its current (draft) definition + every form and connector it references. */
export function exportBundle(id: string): WorkflowBundle {
  const definition = getEditableDefinition(id);
  if (!definition) throw new Error(`Definition not found: ${id}`);

  const formIds = new Set<string>();
  const connectorIds = new Set<string>();
  for (const n of definition.nodes) {
    if (n.type === "userTask" && n.formId) formIds.add(n.formId);
    if (n.type === "serviceTask" && n.connectorId) connectorIds.add(n.connectorId);
  }

  const forms: FormDefinition[] = [];
  for (const fid of formIds) { try { forms.push(getForm(fid)); } catch { /* missing */ } }

  const connectors: WorkflowBundle["connectors"] = [];
  for (const cid of connectorIds) {
    try {
      const c = getConnector(cid);
      connectors.push({ id: c.id, type: c.type, config: stripSecrets(c.config) });
    } catch { /* missing */ }
  }

  return { cassiopeia: "workflow-bundle", bundleVersion: 1, definition, forms, connectors };
}

/**
 * Import a bundle: save its forms, add any missing connectors (never clobber an
 * existing one — that would wipe live keys), and store the definition as a fresh
 * draft. Returns the imported definition id.
 */
export function importBundle(bundle: WorkflowBundle, targetId?: string): string {
  if (!bundle || bundle.cassiopeia !== "workflow-bundle" || !bundle.definition) {
    throw new Error("Not a Cassiopeia workflow bundle");
  }
  const id = targetId || bundle.definition.id;

  for (const f of bundle.forms ?? []) saveForm({ ...f, version: f.version ?? 1 });

  for (const c of bundle.connectors ?? []) {
    let exists = false;
    try { getConnector(c.id); exists = true; } catch { exists = false; }
    if (!exists) saveConnector({ id: c.id, type: c.type, config: c.config } as ConnectorRow);
  }

  saveDefinition({ ...bundle.definition, id, version: 0, status: "draft" });
  return id;
}

// ---- data dictionary ----

/** Pull dotted-identifier references out of an expression string. */
function refsInExpr(expr: string): string[] {
  const KEYWORDS = new Set(["true", "false", "null", "and", "or", "not"]);
  const matches = expr.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? [];
  return matches.filter((m) => !KEYWORDS.has(m.toLowerCase()) && !/^\d/.test(m));
}

export interface DataDictionaryEntry {
  key: string;
  producedBy: string[];
  consumedBy: string[];
}

/**
 * Which context keys each node produces vs consumes — a quick contract view that
 * surfaces typos (consumed-but-never-produced) and dead data.
 */
export function dataDictionary(id: string): { entries: DataDictionaryEntry[]; warnings: string[] } {
  const def = getEditableDefinition(id);
  if (!def) throw new Error(`Definition not found: ${id}`);

  const produced = new Map<string, Set<string>>();
  const consumed = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, by: string) => {
    if (!key) return;
    (map.get(key) ?? map.set(key, new Set()).get(key)!).add(by);
  };

  for (const n of def.nodes) {
    const label = "name" in n && n.name ? n.name : n.id;
    if (n.type === "userTask") {
      if (n.formId) {
        try {
          const form = getForm(n.formId);
          for (const field of form.fields) {
            if (field.bind) add(produced, field.bind, `form: ${label}`);
            if (field.visibleIf) for (const r of refsInExpr(field.visibleIf)) add(consumed, r, `form logic: ${label}`);
          }
        } catch { /* missing form */ }
      }
    } else if (n.type === "serviceTask") {
      if (n.inputMap) for (const path of Object.values(n.inputMap)) add(consumed, path, `service: ${label}`);
      if (n.outputMap) for (const target of Object.keys(n.outputMap)) add(produced, target, `service: ${label}`);
      else add(produced, "(connector result)", `service: ${label}`);
    } else if (n.type === "gateway") {
      for (const b of n.branches) for (const r of refsInExpr(b.when)) add(consumed, r, `gateway: ${label}`);
    } else if (n.type === "timer") {
      if (n.untilPath) add(consumed, n.untilPath, `timer: ${label}`);
    }
  }

  const keys = new Set([...produced.keys(), ...consumed.keys()]);
  const entries: DataDictionaryEntry[] = [...keys].sort().map((key) => ({
    key,
    producedBy: [...(produced.get(key) ?? [])],
    consumedBy: [...(consumed.get(key) ?? [])],
  }));

  const warnings: string[] = [];
  for (const e of entries) {
    if (e.consumedBy.length && !e.producedBy.length && e.key !== "error" && !e.key.startsWith("(")) {
      warnings.push(`"${e.key}" is read by ${e.consumedBy.join(", ")} but never produced — possible typo or missing step.`);
    }
  }
  return { entries, warnings };
}

// ---- audit CSV ----

function csvCell(v: unknown): string {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditCsv(instanceId: string): string {
  const rows = listEvents(instanceId);
  const header = ["ts", "type", "nodeId", "payload"];
  const lines = [header.join(",")];
  for (const e of rows) {
    lines.push([csvCell(e.ts), csvCell(e.type), csvCell(e.nodeId ?? ""), csvCell(e.payload)].join(","));
  }
  return lines.join("\n");
}
