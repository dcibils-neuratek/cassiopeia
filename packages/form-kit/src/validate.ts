// Pure form logic: visibility + validation + coercion. No React, so the
// designer preview and any tests can reuse it. Values are keyed by field.bind
// (the context path) so expressions like "isCompany == true" read naturally.

import type { FormDefinition, FormField, Json } from "@cassiopeia/model";
import { evalBool } from "@cassiopeia/expr";

export type FormValues = Record<string, Json>;
export type FormErrors = Record<string, string>;

export function isVisible(field: FormField, values: FormValues): boolean {
  if (!field.visibleIf) return true;
  try {
    return evalBool(field.visibleIf, values);
  } catch {
    return true; // a broken expression should not hide the field silently
  }
}

/** Coerce a raw input value to the field's typed value. */
export function coerce(field: FormField, raw: unknown): Json {
  switch (field.kind) {
    case "number":
      if (raw === "" || raw == null) return null;
      return Number(raw);
    case "checkbox":
      return Boolean(raw);
    default:
      return (raw ?? null) as Json;
  }
}

function isEmpty(v: Json): boolean {
  return v == null || v === "" || v === false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate all currently-visible fields. Returns errors keyed by field.bind. */
export function validate(form: FormDefinition, values: FormValues): FormErrors {
  const errors: FormErrors = {};
  for (const field of form.fields) {
    if (!isVisible(field, values)) continue;
    const v = values[field.bind] ?? null;

    if (field.required && isEmpty(v)) {
      errors[field.bind] = "Required";
      continue;
    }
    if (isEmpty(v)) continue;

    if (field.kind === "number" && typeof v === "number") {
      if (Number.isNaN(v)) errors[field.bind] = "Must be a number";
      else if (field.min != null && v < field.min) errors[field.bind] = `Min ${field.min}`;
      else if (field.max != null && v > field.max) errors[field.bind] = `Max ${field.max}`;
    }
    if (field.kind === "email" && typeof v === "string" && !EMAIL_RE.test(v)) {
      errors[field.bind] = "Invalid email";
    }
    if (field.pattern && typeof v === "string") {
      try {
        if (!new RegExp(field.pattern).test(v)) errors[field.bind] = "Invalid format";
      } catch {
        /* ignore bad author-supplied regex */
      }
    }
  }
  return errors;
}

/** Build the initial value map from field defaults. */
export function initialValues(form: FormDefinition): FormValues {
  const out: FormValues = {};
  for (const f of form.fields) {
    if (f.defaultValue !== undefined) out[f.bind] = f.defaultValue;
    else if (f.kind === "checkbox") out[f.bind] = false;
  }
  return out;
}

/** The submitted patch: only values for currently-visible fields. */
export function visiblePatch(form: FormDefinition, values: FormValues): FormValues {
  const out: FormValues = {};
  for (const f of form.fields) {
    if (isVisible(f, values) && values[f.bind] !== undefined) {
      out[f.bind] = values[f.bind];
    }
  }
  return out;
}
