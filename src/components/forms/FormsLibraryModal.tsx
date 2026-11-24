"use client";

import React, { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Cloud,
  CloudOff,
  Copy,
  LibraryBig,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useFormsLibraryStore, type FormsLibraryTab } from "@/store/useFormsLibraryStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { toast } from "@/store/useToastStore";
import { replicateTemplate } from "@/lib/forms/formActions";
import {
  BUILT_IN_TEMPLATE_IDS,
  FORM_FIELD_TYPES,
  FORM_FIELD_TYPE_LABELS,
  FORM_MAX_FIELDS,
  FORM_MAX_OPTIONS,
  newFormId,
  toFieldKey,
  uniqueFieldKeys,
} from "@/lib/forms/formSchema";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, SocialDialog } from "@/components/social/SocialDialog";
import { AutoFillPanel } from "./AutoFillModal";
import type { FormFieldDef, FormTemplate } from "@/types/forms";
import type { FormFieldType } from "@/types/workspace";

// ============================================================================
// ANDROS — LIBRERÍA PERSONAL DE FICHAS REPLICABLES
//   · Mis formatos: replicar en el espacio actual en 1 clic (0 ms, $0 API),
//     crear, editar y eliminar (con «Deshacer») formatos tipados.
//   · Llenar con IA: el mismo panel que abre el Oráculo.
// Persistencia: localStorage + Supabase `profiles.form_library` (ver
// `useFormLibrarySync`).
// ============================================================================

export const FormsLibraryModal: React.FC = () => {
  const open = useFormsLibraryStore((s) => s.libraryOpen);
  const tab = useFormsLibraryStore((s) => s.libraryTab);
  const close = () => useFormsLibraryStore.getState().closeLibrary();

  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Librería de fichas"
      titleId="andros-forms-library-title"
      icon={<LibraryBig className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description="Formatos replicables con campos tipados y fotos. Replica uno en el espacio actual o deja que la IA los llene con tu información."
      wide
    >
      {open && <LibraryBody tab={tab} onClose={close} />}
    </SocialDialog>
  );
};

const TABS: { id: FormsLibraryTab; label: string }[] = [
  { id: "library", label: "Mis formatos" },
  { id: "autofill", label: "Llenar con IA" },
];

const LibraryBody: React.FC<{ tab: FormsLibraryTab; onClose: () => void }> = ({ tab, onClose }) => {
  const [editing, setEditing] = useState<FormTemplate | null>(null);

  if (editing) {
    return <TemplateBuilder initial={editing} onDone={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Secciones de la librería" className="flex gap-1 p-1 rounded-xl bg-andros-border/40">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => useFormsLibraryStore.getState().setLibraryTab(t.id)}
            className={`flex-1 min-h-11 md:min-h-8 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro ${
              tab === t.id ? "bg-andros-card text-andros-primary shadow-sm" : "text-andros-muted hover:text-andros-primary"
            }`}
          >
            {t.id === "autofill" && <Sparkles className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "library" ? (
        <TemplateList
          onEdit={setEditing}
          onNew={() =>
            setEditing({
              id: newFormId("tpl"),
              title: "",
              category: "General",
              fields: [],
              updatedAt: 0,
            })
          }
          onReplicated={onClose}
        />
      ) : (
        <AutoFillPanel onDone={onClose} />
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Lista de formatos
// ----------------------------------------------------------------------------

const TemplateList: React.FC<{
  onEdit: (t: FormTemplate) => void;
  onNew: () => void;
  onReplicated: () => void;
}> = ({ onEdit, onNew, onReplicated }) => {
  const templates = useFormsLibraryStore((s) => s.templates);
  const cloudStatus = useFormsLibraryStore((s) => s.cloudStatus);
  const signedIn = useCloudStore((s) => Boolean(s.user));
  const readOnly = useCanvasReadOnly();
  const missingBuiltIns = [...BUILT_IN_TEMPLATE_IDS].filter((id) => !templates.some((t) => t.id === id)).length;

  const remove = (template: FormTemplate) => {
    const removed = useFormsLibraryStore.getState().removeTemplate(template.id);
    if (!removed) return;
    toast({
      message: `Formato «${template.title.slice(0, 40)}» eliminado.`,
      action: {
        label: "Deshacer",
        onAction: () => useFormsLibraryStore.getState().restoreTemplate(removed.template, removed.index),
      },
    });
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={onNew} className={`${BUTTON_SECONDARY} w-full`}>
        <Plus className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />
        Nuevo formato
      </button>

      {templates.length === 0 ? (
        <p className="text-xs text-andros-muted">Tu librería está vacía. Crea un formato o restaura los formatos iniciales.</p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="p-3 rounded-xl border border-andros-border bg-andros-canvas">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-andros-primary truncate">{t.title}</p>
                  <p className="text-[11px] text-andros-muted">
                    {t.category} · <span className="font-mono tabular-nums">{t.fields.length}</span>{" "}
                    {t.fields.length === 1 ? "campo" : "campos"}
                    {t.fields.some((f) => f.type === "photo") ? " · con fotos" : ""}
                  </p>
                  {t.description && <p className="mt-1 text-xs leading-relaxed text-andros-muted">{t.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onEdit(t)}
                    aria-label={`Editar el formato «${t.title}»`}
                    className="w-11 h-11 md:w-9 md:h-9 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center justify-center active:scale-[0.96] spring-micro"
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(t)}
                    aria-label={`Eliminar el formato «${t.title}»`}
                    className="w-11 h-11 md:w-9 md:h-9 rounded-xl text-andros-muted hover:text-andros-danger hover:bg-andros-border/40 flex items-center justify-center active:scale-[0.96] spring-micro"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {!readOnly && (
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      replicateTemplate(t);
                      onReplicated();
                    }}
                    className={`${BUTTON_PRIMARY} flex-1`}
                  >
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    Replicar en el espacio
                  </button>
                  <button
                    type="button"
                    onClick={() => useFormsLibraryStore.getState().openLibrary("autofill", [t.id])}
                    className={BUTTON_SECONDARY}
                  >
                    <Sparkles className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />
                    Llenar con IA
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="flex items-center gap-1.5 text-[11px] text-andros-muted">
          {signedIn && cloudStatus === "synced" ? (
            <>
              <Cloud className="w-3.5 h-3.5 text-andros-success" aria-hidden="true" />
              Sincronizada con tu cuenta
            </>
          ) : signedIn && cloudStatus === "setup" ? (
            <>
              <CloudOff className="w-3.5 h-3.5 text-andros-warning" aria-hidden="true" />
              Guardada en este dispositivo (falta ejecutar supabase/schema.sql para la nube)
            </>
          ) : (
            <>
              <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
              Guardada en este dispositivo{signedIn ? "" : " · inicia sesión para usarla en otros"}
            </>
          )}
        </p>
        {missingBuiltIns > 0 && (
          <button
            type="button"
            onClick={() => {
              const n = useFormsLibraryStore.getState().restoreBuiltIns();
              toast({ message: `${n} formato(s) inicial(es) restaurado(s).`, tone: "success" });
            }}
            className="min-h-11 md:min-h-8 px-2.5 rounded-lg text-[11px] text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Restaurar formatos iniciales
          </button>
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Constructor / editor de formatos
// ----------------------------------------------------------------------------

interface DraftField extends FormFieldDef {
  optionsText: string;
}

const toDraft = (f: FormFieldDef): DraftField => ({ ...f, optionsText: (f.options ?? []).join(", ") });

const TemplateBuilder: React.FC<{ initial: FormTemplate; onDone: () => void }> = ({ initial, onDone }) => {
  const templates = useFormsLibraryStore((s) => s.templates);
  const isNew = !templates.some((t) => t.id === initial.id);
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState(initial.category);
  const [description, setDescription] = useState(initial.description ?? "");
  const [fields, setFields] = useState<DraftField[]>(() => initial.fields.map(toDraft));
  const [errors, setErrors] = useState<{ title?: string; fields?: string; labels?: Set<string> }>({});
  const categories = [...new Set(templates.map((t) => t.category))];

  const patch = (id: string, change: Partial<DraftField>) =>
    setFields((list) => list.map((f) => (f.id === id ? { ...f, ...change } : f)));

  const add = (type: FormFieldType) =>
    setFields((list) =>
      list.length >= FORM_MAX_FIELDS
        ? list
        : [
            ...list,
            {
              id: newFormId("def"),
              fieldKey: "",
              label: "",
              type,
              optionsText: type === "select" ? "Opción 1, Opción 2" : "",
            },
          ]
    );

  const move = (index: number, delta: -1 | 1) =>
    setFields((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = () => {
    const emptyLabels = new Set(fields.filter((f) => !f.label.trim()).map((f) => f.id));
    const nextErrors = {
      title: title.trim() ? undefined : "Ponle un título al formato.",
      fields: fields.length === 0 ? "Añade al menos un campo." : emptyLabels.size > 0 ? "Cada campo necesita un nombre." : undefined,
      labels: emptyLabels,
    };
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.fields) return;

    const cleanFields: FormFieldDef[] = uniqueFieldKeys(
      fields.map((f) => {
        const label = f.label.trim().slice(0, 80);
        const unit = f.unit?.trim().slice(0, 16);
        return {
          id: f.id,
          fieldKey: toFieldKey(label),
          label,
          type: f.type,
          ...(f.type === "number" && unit ? { unit } : {}),
          ...(f.type === "select"
            ? {
                options: [...new Set(f.optionsText.split(",").map((o) => o.trim().slice(0, 60)).filter(Boolean))].slice(
                  0,
                  FORM_MAX_OPTIONS
                ),
              }
            : {}),
        };
      })
    );
    const cleanDescription = description.trim().slice(0, 200);
    useFormsLibraryStore.getState().upsertTemplate({
      ...initial,
      title: title.trim().slice(0, 80),
      category: category.trim().slice(0, 40) || "General",
      ...(cleanDescription ? { description: cleanDescription } : { description: undefined }),
      fields: cleanFields,
    });
    toast({ message: isNew ? "Formato creado en tu librería." : "Formato actualizado.", tone: "success" });
    onDone();
  };

  const fieldButton =
    "w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center justify-center active:scale-[0.96] spring-micro disabled:opacity-40";

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      <p className="text-sm font-semibold text-andros-primary">{isNew ? "Nuevo formato" : `Editar «${initial.title}»`}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="tpl-title" className="block text-xs font-medium text-andros-primary">
            Título
          </label>
          <input
            id="tpl-title"
            value={title}
            maxLength={80}
            onChange={(e) => {
              setTitle(e.target.value);
              if (errors.title) setErrors((x) => ({ ...x, title: undefined }));
            }}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "tpl-title-error" : undefined}
            placeholder="p. ej. Control de calidad"
            className={INPUT}
          />
          {errors.title && (
            <p id="tpl-title-error" className="text-[11px] text-andros-danger">
              {errors.title}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="tpl-category" className="block text-xs font-medium text-andros-primary">
            Categoría
          </label>
          <input
            id="tpl-category"
            list="tpl-category-list"
            value={category}
            maxLength={40}
            onChange={(e) => setCategory(e.target.value)}
            className={INPUT}
          />
          <datalist id="tpl-category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="tpl-description" className="block text-xs font-medium text-andros-primary">
          Descripción <span className="font-normal text-andros-muted">(opcional)</span>
        </label>
        <input
          id="tpl-description"
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
          className={INPUT}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-andros-primary">
          Campos <span className="font-mono tabular-nums text-andros-muted">{fields.length}/{FORM_MAX_FIELDS}</span>
        </p>
        <ul className="space-y-2">
          {fields.map((field, index) => {
            const missing = errors.labels?.has(field.id);
            return (
              <li key={field.id} className="p-2.5 rounded-xl border border-andros-border bg-andros-canvas space-y-2">
                <div className="flex items-center gap-1.5">
                  <input
                    aria-label={`Nombre del campo ${index + 1}`}
                    aria-invalid={missing}
                    value={field.label}
                    maxLength={80}
                    placeholder="Nombre del campo"
                    onChange={(e) => patch(field.id, { label: e.target.value })}
                    className={`${INPUT} ${missing ? "border-andros-danger" : ""}`}
                  />
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Subir campo" className={fieldButton}>
                    <ArrowUp className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === fields.length - 1}
                    aria-label="Bajar campo"
                    className={fieldButton}
                  >
                    <ArrowDown className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFields((list) => list.filter((f) => f.id !== field.id))}
                    aria-label={`Quitar el campo ${field.label || index + 1}`}
                    className={`${fieldButton} hover:text-andros-danger`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    aria-label={`Tipo del campo ${field.label || index + 1}`}
                    value={field.type}
                    onChange={(e) => patch(field.id, { type: e.target.value as FormFieldType })}
                    className={`${INPUT} w-auto flex-1 min-w-[9rem]`}
                  >
                    {FORM_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {FORM_FIELD_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                  {field.type === "number" && (
                    <input
                      aria-label={`Unidad del campo ${field.label || index + 1}`}
                      placeholder="Unidad (kg, mmHg, USD…)"
                      value={field.unit ?? ""}
                      maxLength={16}
                      onChange={(e) => patch(field.id, { unit: e.target.value })}
                      className={`${INPUT} w-auto flex-1 min-w-[8rem]`}
                    />
                  )}
                </div>
                {field.type === "select" && (
                  <input
                    aria-label={`Opciones del campo ${field.label || index + 1}, separadas por comas`}
                    placeholder="Opciones separadas por comas"
                    value={field.optionsText}
                    onChange={(e) => patch(field.id, { optionsText: e.target.value })}
                    className={INPUT}
                  />
                )}
                {field.label.trim() && (
                  <p className="text-[10px] text-andros-muted">
                    Clave: <code className="font-mono text-andros-primary">{toFieldKey(field.label)}</code>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {fields.length < FORM_MAX_FIELDS && (
          <div className="flex flex-wrap gap-1.5" aria-label="Añadir campo">
            {FORM_FIELD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => add(type)}
                className="min-h-11 md:min-h-8 px-2.5 rounded-lg border border-andros-border text-[11px] text-andros-primary hover:bg-andros-border/40 flex items-center gap-1 active:scale-[0.96] spring-micro"
              >
                <Plus className="w-3 h-3 text-andros-accent-ink" aria-hidden="true" />
                {FORM_FIELD_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        )}
        {errors.fields && (
          <p role="alert" className="text-[11px] text-andros-danger">
            {errors.fields}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button type="submit" className={`${BUTTON_PRIMARY} flex-1`}>
          Guardar formato
        </button>
        <button type="button" onClick={onDone} className={BUTTON_SECONDARY}>
          Cancelar
        </button>
      </div>
    </form>
  );
};
