// The one renderer used by BOTH the portal (runtime) and the designer preview
// (M4) — so there is no behavior drift between what an analyst designs and what
// a customer fills. Controlled, schema-driven, expr-powered visibility.
// M16: multi-page wizard, computed (derived) fields, and real file upload.

import { useMemo, useState } from "react";
import type { FormDefinition, FormField, Json } from "@cassiopeia/model";
import {
  type FormErrors,
  type FormValues,
  coerce,
  computeDerived,
  formPages,
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
  /** Optional real file upload; returns the value stored for the field (e.g. {fileId,name,size}). */
  uploadFile?: (file: File) => Promise<Json>;
}

export function FormRenderer({ form, initial, submitLabel = "Submit", onSubmit, uploadFile }: FormRendererProps) {
  const [values, setValues] = useState<FormValues>(() => ({
    ...initialValues(form),
    ...(initial ?? {}),
  }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  const derived = useMemo(() => computeDerived(form, values), [form, values]);
  const pages = useMemo(() => formPages(form), [form]);
  const currentPage = pages[pageIdx];
  const isLast = pageIdx >= pages.length - 1;

  const visibleFields = useMemo(
    () => form.fields.filter((f) => (f.page ?? 1) === currentPage && isVisible(f, values)),
    [form, values, currentPage],
  );

  const setField = (field: FormField, raw: unknown) =>
    setValues((v) => ({ ...v, [field.bind]: coerce(field, raw) }));

  function pageHasErrors(): boolean {
    const errs = validate(form, values);
    setErrors(errs);
    return visibleFields.some((f) => errs[f.bind]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLast) { if (!pageHasErrors()) setPageIdx((i) => i + 1); return; }
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
      {pages.length > 1 && (
        <div style={s.steps}>
          {pages.map((p, i) => (
            <div key={p} style={{ ...s.step, ...(i === pageIdx ? s.stepActive : i < pageIdx ? s.stepDone : {}) }}>{i + 1}</div>
          ))}
          <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>Step {pageIdx + 1} of {pages.length}</span>
        </div>
      )}
      {visibleFields.map((field) => (
        <div key={field.id} style={s.row}>
          <label style={s.label}>
            {field.label}
            {field.required && field.kind !== "computed" && <span style={{ color: "#dc2626" }}> *</span>}
          </label>
          {field.description && <div style={s.desc}>{field.description}</div>}
          <FieldControl
            field={field}
            value={field.kind === "computed" ? derived[field.bind] : values[field.bind]}
            onChange={(raw) => setField(field, raw)}
            uploadFile={uploadFile}
          />
          {errors[field.bind] && <div style={s.error}>{errors[field.bind]}</div>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {pages.length > 1 && pageIdx > 0 && (
          <button type="button" onClick={() => setPageIdx((i) => i - 1)} style={s.back}>Back</button>
        )}
        <button type="submit" disabled={busy} style={s.submit}>
          {busy ? "Working…" : isLast ? submitLabel : "Next"}
        </button>
      </div>
    </form>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  uploadFile,
}: {
  field: FormField;
  value: Json;
  onChange: (raw: unknown) => void;
  uploadFile?: (file: File) => Promise<Json>;
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
    case "computed": {
      const shown = value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return <div style={s.computed}>{shown}</div>;
    }
    case "file": {
      const v = value as { name?: string; size?: number } | null;
      return (
        <div>
          <input
            type="file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) { onChange(null); return; }
              if (uploadFile) onChange(await uploadFile(f));
              else onChange({ name: f.name, size: f.size });
            }}
          />
          {v?.name && <div style={s.fileTag}>📎 {v.name}{typeof v.size === "number" ? ` (${Math.round(v.size / 1024)} KB)` : ""}</div>}
        </div>
      );
    }
  }
}

const s: Record<string, React.CSSProperties> = {
  form: { display: "flex", flexDirection: "column", gap: 14 },
  row: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 13, fontWeight: 600, color: "var(--text-muted, #334155)" },
  desc: { fontSize: 12, color: "var(--text-faint, #64748b)" },
  input: { border: "1px solid var(--border-strong, #cbd5e1)", borderRadius: 8, padding: "8px 10px", fontSize: 14, background: "var(--surface, #fff)", color: "var(--text, #0f172a)" },
  computed: { border: "1px dashed var(--border-strong, #cbd5e1)", background: "var(--surface-2, #f8fafc)", borderRadius: 8, padding: "8px 10px", fontSize: 14, color: "var(--text, #0f172a)", fontWeight: 600 },
  fileTag: { fontSize: 12, color: "var(--text, #0f172a)", marginTop: 4 },
  error: { fontSize: 12, color: "#ef4444" },
  submit: { background: "var(--primary, #2563eb)", color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontSize: 14, cursor: "pointer" },
  back: { background: "var(--surface, #fff)", color: "var(--text-muted, #334155)", border: "1px solid var(--border-strong, #cbd5e1)", borderRadius: 8, padding: "10px 16px", fontSize: 14, cursor: "pointer" },
  steps: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 },
  step: { width: 24, height: 24, borderRadius: 12, background: "var(--surface-3, #e2e8f0)", color: "var(--text-muted, #64748b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 },
  stepActive: { background: "var(--primary, #2563eb)", color: "#fff" },
  stepDone: { background: "var(--success, #16a34a)", color: "#fff" },
};
