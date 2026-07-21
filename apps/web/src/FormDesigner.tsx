import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FieldKind, FormDefinition, FormField } from "@cassiopeia/model";
import { FormRenderer } from "@cassiopeia/form-kit";
import { api } from "./api.js";

const uid = () => Math.random().toString(36).slice(2, 7);
const KINDS: FieldKind[] = ["text", "email", "number", "date", "select", "checkbox", "file", "computed"];
const KIND_ES: Record<string, string> = {
  text: "texto", email: "email", number: "número", date: "fecha",
  select: "lista", checkbox: "casilla", file: "archivo", computed: "calculado",
};

export function FormDesigner({
  fixedFormId,
  onClose,
  onSaved,
}: { fixedFormId?: string; onClose?: () => void; onSaved?: () => void } = {}) {
  const [list, setList] = useState<{ id: string; title: string }[]>([]);
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const embedded = Boolean(fixedFormId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (fixedFormId) {
      load(fixedFormId);
      return;
    }
    api(`/forms`).then((r) => {
      setList(r.data);
      if (r.data[0]) load(r.data[0].id);
    });
  }, [fixedFormId]);

  async function load(id: string) {
    const r = await api(`/forms/${id}`);
    setForm(r.data);
    setSelId(null);
    setMsg("");
  }

  function patchForm(p: Partial<FormDefinition>) {
    setForm((f) => (f ? { ...f, ...p } : f));
  }
  function updateField(id: string, patch: Partial<FormField>) {
    setForm((f) => (f ? { ...f, fields: f.fields.map((x) => (x.id === id ? { ...x, ...patch } : x)) } : f));
  }
  function addField(kind: FieldKind) {
    if (!form) return;
    const n = form.fields.length + 1;
    const field: FormField = {
      id: `f_${uid()}`,
      kind,
      bind: `field${n}`,
      label: `New ${kind}`,
      ...(kind === "select" ? { options: [{ label: "Option 1", value: "opt1" }] } : {}),
    };
    setForm({ ...form, fields: [...form.fields, field] });
    setSelId(field.id);
  }
  function deleteField(id: string) {
    setForm((f) => (f ? { ...f, fields: f.fields.filter((x) => x.id !== id) } : f));
    if (selId === id) setSelId(null);
  }
  function onDragEnd(e: DragEndEvent) {
    if (!form || !e.over || e.active.id === e.over.id) return;
    const from = form.fields.findIndex((x) => x.id === e.active.id);
    const to = form.fields.findIndex((x) => x.id === e.over!.id);
    setForm({ ...form, fields: arrayMove(form.fields, from, to) });
  }

  function newForm() {
    const id = `form_${uid()}`;
    const f: FormDefinition = { id, version: 1, title: "Untitled form", fields: [] };
    setForm(f);
    setList((l) => [...l, { id, title: f.title }]);
    setSelId(null);
  }
  async function save() {
    if (!form) return;
    await api(`/forms/${form.id}`, { method: "POST", body: JSON.stringify(form) });
    setList((l) => (l.some((x) => x.id === form.id) ? l.map((x) => (x.id === form.id ? { ...x, title: form.title } : x)) : l));
    setMsg("Guardado ✓");
    onSaved?.();
  }

  if (!form) return <p style={{ color: "#64748b" }}>Cargando formularios…</p>;
  const sel = form.fields.find((x) => x.id === selId);

  return (
    <div>
      <div style={S.toolbar}>
        {!embedded && (
          <>
            <select style={S.select} value={form.id} onChange={(e) => load(e.target.value)}>
              {list.map((f) => (
                <option key={f.id} value={f.id}>{f.title}</option>
              ))}
            </select>
            <button style={S.ghost} onClick={newForm}>Nuevo formulario</button>
          </>
        )}
        <input style={S.title} value={form.title} onChange={(e) => patchForm({ title: e.target.value })} />
        <div style={{ flex: 1 }} />
        {msg && <span style={{ color: "#166534", fontSize: 13 }}>{msg}</span>}
        <button style={S.primary} onClick={save}>Guardar</button>
        {embedded && onClose && (
          <button style={S.ghost} onClick={onClose}>Listo</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "flex-start" }}>
        <div style={S.palette}>
          <div style={S.paletteHead}>Agregar campo</div>
          {KINDS.map((k) => (
            <button key={k} style={S.paletteBtn} onClick={() => addField(k)}>+ {KIND_ES[k] ?? k}</button>
          ))}
        </div>

        <div style={S.canvas}>
          <div style={S.paletteHead}>Campos — arrastrá para reordenar</div>
          {form.fields.length === 0 && <p style={S.hint}>Sin campos todavía. Agregá uno desde la izquierda.</p>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={form.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              {form.fields.map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  selected={f.id === selId}
                  onSelect={() => setSelId(f.id)}
                  onDelete={() => deleteField(f.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <div style={S.panel}>
          <div style={S.paletteHead}>Propiedades</div>
          {!sel && <p style={S.hint}>Seleccioná un campo para editarlo.</p>}
          {sel && <FieldProps field={sel} onChange={(p) => updateField(sel.id, p)} />}
        </div>
      </div>

      <div style={S.preview}>
        <div style={S.paletteHead}>Vista previa (el mismo render que ve el usuario)</div>
        <FormRenderer key={JSON.stringify(form.fields.map((f) => f.id))} form={form} submitLabel="Enviar" onSubmit={() => {}} />
      </div>
    </div>
  );
}

function FieldRow({
  field,
  selected,
  onSelect,
  onDelete,
}: {
  field: FormField;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  return (
    <div
      ref={setNodeRef}
      onClick={onSelect}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        marginBottom: 6,
        border: `1px solid ${selected ? "#2563eb" : "#e2e8f0"}`,
        borderRadius: 8,
        background: "white",
        cursor: "pointer",
      }}
    >
      <span {...attributes} {...listeners} style={{ cursor: "grab", color: "#94a3b8" }}>⠿</span>
      <span style={{ flex: 1, fontSize: 14 }}>{field.label}</span>
      <span style={S.badge}>{field.kind}</span>
      <button style={S.x} onClick={(e) => { e.stopPropagation(); onDelete(); }}>×</button>
    </div>
  );
}

function FieldProps({ field, onChange }: { field: FormField; onChange: (p: Partial<FormField>) => void }) {
  return (
    <div>
      <L>Etiqueta</L>
      <input style={S.input} value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
      <L>Campo (ruta en el contexto)</L>
      <input style={S.input} value={field.bind} onChange={(e) => onChange({ bind: e.target.value })} />
      <L>Descripción</L>
      <input style={S.input} value={field.description ?? ""} onChange={(e) => onChange({ description: e.target.value })} />
      <label style={{ ...S.lbl, display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <input type="checkbox" checked={Boolean(field.required)} onChange={(e) => onChange({ required: e.target.checked })} />
        Obligatorio
      </label>

      {field.kind === "number" && (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <L>Mín</L>
            <input style={S.input} type="number" value={field.min ?? ""} onChange={(e) => onChange({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </div>
          <div style={{ flex: 1 }}>
            <L>Máx</L>
            <input style={S.input} type="number" value={field.max ?? ""} onChange={(e) => onChange({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </div>
        </div>
      )}

      {(field.kind === "text" || field.kind === "email") && (
        <>
          <L>Patrón (regex)</L>
          <input style={S.input} value={field.pattern ?? ""} onChange={(e) => onChange({ pattern: e.target.value || undefined })} />
        </>
      )}

      {field.kind === "computed" && (
        <>
          <L>Expresión (sobre otros campos)</L>
          <input style={S.input} placeholder="ej. price * quantity" value={field.expr ?? ""} onChange={(e) => onChange({ expr: e.target.value || undefined })} />
        </>
      )}

      {field.kind === "select" && (
        <>
          <L>Opciones (una por línea: Etiqueta|valor)</L>
          <textarea
            style={{ ...S.input, height: 80, fontFamily: "monospace" }}
            value={(field.options ?? []).map((o) => `${o.label}|${o.value}`).join("\n")}
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => {
                    const [label, value] = line.split("|");
                    return { label: label ?? "", value: (value ?? label ?? "").trim() };
                  }),
              })
            }
          />
        </>
      )}

      <L>Visible si (expresión)</L>
      <input style={S.input} placeholder="ej. isCompany == true" value={field.visibleIf ?? ""} onChange={(e) => onChange({ visibleIf: e.target.value || undefined })} />
      <L>Página del asistente</L>
      <input style={S.input} type="number" min={1} placeholder="1" value={field.page ?? ""} onChange={(e) => onChange({ page: e.target.value === "" ? undefined : Math.max(1, Number(e.target.value) || 1) })} />
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <label style={S.lbl}>{children}</label>;
}

const S: Record<string, React.CSSProperties> = {
  toolbar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  select: { border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 14 },
  title: { border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 14, fontWeight: 600, minWidth: 220 },
  ghost: { background: "white", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer" },
  primary: { background: "#2563eb", color: "white", border: 0, borderRadius: 8, padding: "8px 16px", fontSize: 14, cursor: "pointer" },
  palette: { width: 130, border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "white", display: "flex", flexDirection: "column", gap: 6 },
  paletteHead: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#64748b", fontWeight: 700, marginBottom: 4 },
  paletteBtn: { border: "1px solid #cbd5e1", background: "white", borderRadius: 8, padding: "6px 8px", fontSize: 12, cursor: "pointer", color: "#334155", textAlign: "left" },
  canvas: { flex: 1, border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc", minHeight: 300 },
  panel: { width: 280, border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "white" },
  preview: { marginTop: 12, border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, background: "white", maxWidth: 520 },
  badge: { fontSize: 10, textTransform: "uppercase", background: "#e8effe", color: "#2563eb", padding: "2px 6px", borderRadius: 4, fontWeight: 700 },
  x: { border: 0, background: "transparent", color: "#94a3b8", fontSize: 18, cursor: "pointer", lineHeight: 1 },
  hint: { fontSize: 12, color: "#64748b" },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 9px", fontSize: 13 },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 10, marginBottom: 3 },
};
