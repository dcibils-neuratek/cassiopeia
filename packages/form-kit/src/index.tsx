// The one renderer used by BOTH the portal (runtime) and the designer preview
// (M4) — so there is no behavior drift between what an analyst designs and what
// a customer fills. Controlled, schema-driven, expr-powered visibility.

import { useMemo, useState } from "react";
import type { FormDefinition, FormField, Json } from "@cassiopeia/model";
import {
  type FormErrors,
  type FormValues,
  coerce,
  initialValues,
  isVisible,
  validate,
  visiblePatch,
} from "./validate.js";

export * from "./validate.js";

export interface FormRendererProps {
  form: FormDefinition;
  initial?: FormValues;
  submitLabel?: string;
  onSubmit: (patch: FormValues) => void | Promise<void>;
}

export function FormRenderer({ form, initial, submitLabel = "Submit", onSubmit }: FormRendererProps) {
  const [values, setValues] = useState<FormValues>(() => ({
    ...initialValues(form),
    ...(initial ?? {}),
  }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);

  const visibleFields = useMemo(
    () => form.fields.filter((f) => isVisible(f, values)),
    [form, values],
  );

  const setField = (field: FormField, raw: unknown) =>
    setValues((v) => ({ ...v, [field.bind]: coerce(field, raw) }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate(form, values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      await onSubmit(visiblePatch(form, values));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={s.form}>
      {visibleFields.map((field) => (
        <div key={field.id} style={s.row}>
          <label style={s.label}>
            {field.label}
            {field.required && <span style={{ color: "#dc2626" }}> *</span>}
          </label>
          {field.description && <div style={s.desc}>{field.description}</div>}
          <FieldControl field={field} value={values[field.bind]} onChange={(raw) => setField(field, raw)} />
          {errors[field.bind] && <div style={s.error}>{errors[field.bind]}</div>}
        </div>
      ))}
      <button type="submit" disabled={busy} style={s.submit}>
        {busy ? "Working…" : submitLabel}
      </button>
    </form>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: Json;
  onChange: (raw: unknown) => void;
}) {
  const common = { style: s.input };
  switch (field.kind) {
    case "text":
    case "email":
      return (
        <input
          {...common}
          type={field.kind}
          placeholder={field.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          {...common}
          type="number"
          placeholder={field.placeholder}
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "date":
      return (
        <input {...common} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
      );
    case "select":
      return (
        <select {...common} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            {field.placeholder ?? "Select…"}
          </option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "file":
      // MVP: capture file metadata only. Real binary upload to object storage
      // is a later milestone.
      return (
        <input
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            onChange(f ? { name: f.name, size: f.size } : null);
          }}
        />
      );
  }
}

const s: Record<string, React.CSSProperties> = {
  form: { display: "flex", flexDirection: "column", gap: 14 },
  row: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 13, fontWeight: 600, color: "#334155" },
  desc: { fontSize: 12, color: "#64748b" },
  input: { border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 14 },
  error: { fontSize: 12, color: "#dc2626" },
  submit: { background: "#2563eb", color: "white", border: 0, borderRadius: 8, padding: "10px 16px", fontSize: 14, cursor: "pointer", marginTop: 4 },
};
