"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Camera,
  Check,
  CheckSquare,
  ImagePlus,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { FORM_FIELDS_MAX_HEIGHT } from "@/store/useWorkspaceStore";
import { useCanvasReadOnly, useCollabStore } from "@/store/useCollabStore";
import { useFormsLibraryStore } from "@/store/useFormsLibraryStore";
import { toast } from "@/store/useToastStore";
import { commitWithImpact, snapshotOf } from "@/lib/canvas/impactClient";
import {
  FORM_FIELD_TYPES,
  FORM_FIELD_TYPE_LABELS,
  FORM_MAX_ATTACHMENTS,
  FORM_MAX_FIELDS,
  FORM_MAX_PHOTOS_PER_FIELD,
  formatFormNumber,
  isFieldFilled,
  templateFromSheet,
} from "@/lib/forms/formSchema";
import {
  addFormField,
  addPhotosToSheet,
  changeFormFieldType,
  moveFormField,
  patchFormSheet,
  removeFormFieldWithUndo,
  removePhotoWithUndo,
  renameFormField,
  updateFormField,
  type PhotoTarget,
} from "@/lib/forms/formActions";
import { formatPhotoBytes, imagesFromClipboard } from "@/lib/forms/imageCompress";
import type { FormField, FormFieldType, FormPhoto, FormSheetEngineeringNode } from "@/types/workspace";
import { ResolutionPanel } from "@/components/cde/ResolutionPanel";
import { AreaBadge } from "@/components/cde/CdeBits";
import { parseMentions } from "@/lib/cde/mentions";
import { useMentionDirectory, useMyArea, useMyUserId } from "@/lib/cde/hooks";
import { areaKey } from "@/lib/cde/areas";

/**
 * (Sprint 18) Menciones @Área / @usuario escritas en los campos de la ficha:
 * se resaltan aquí y avisan en la bandeja interna a quien corresponde.
 */
const CardMentions: React.FC<{ fields: FormField[] }> = ({ fields }) => {
  const dir = useMentionDirectory();
  const uid = useMyUserId();
  const myArea = useMyArea();
  const text = fields.map((f) => (typeof f.value === "string" ? f.value : "")).join("\n");
  if (!text.includes("@")) return null;
  const { mentions } = parseMentions(text, dir);
  const people = mentions.filter((m) => m.kind !== "ai");
  if (people.length === 0) return null;
  return (
    <ul aria-label="Menciones en esta ficha" className="flex flex-wrap gap-1">
      {people.map((m) => {
        const mine =
          (m.kind === "user" && m.id === uid) || (m.kind === "area" && Boolean(myArea) && areaKey(m.value) === areaKey(myArea ?? ""));
        return (
          <li key={`${m.kind}-${m.value}`}>
            {m.kind === "area" ? (
              <AreaBadge area={m.value} className={mine ? "ring-1 ring-andros-accent/50" : ""} />
            ) : (
              <span
                className={`inline-flex px-1.5 py-0.5 rounded-md text-[11px] font-medium text-andros-accent-ink ${
                  mine ? "bg-andros-accent/20 ring-1 ring-andros-accent/40" : "bg-andros-accent/10"
                }`}
              >
                @{m.value}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

// ============================================================================
// ANDROS — NODO «FICHA ESTRUCTURADA CON FOTOS» (`form-sheet-node`)
//
// Edición 100 % local ($0 API): escribir, marcar casillas, elegir opciones,
// añadir/quitar campos y adjuntar fotos se aplica al instante y viaja en vivo
// por `canvasSync` (texto cada ~150 ms). Al confirmar (salir del campo) se
// decide si el cambio merece revisión del Motor Anti-Malentendidos.
// Respeta el modo solo lectura (sala llena) y anuncia `editingNodeId`.
// ============================================================================

const LIVE_SYNC_MS = 150;

/** Anuncia en la sala qué tarjeta editas mientras el foco esté dentro de ella. */
function usePresenceHandlers(nodeId: string) {
  return {
    onFocusCapture: () => useCollabStore.getState().setEditingNodeId(nodeId),
    onBlurCapture: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      useCollabStore.getState().clearEditingNodeId(nodeId);
    },
  };
}

const INPUT_BASE =
  "w-full min-w-0 h-11 md:h-8 px-2.5 rounded-lg bg-andros-canvas border outline-none text-[12px] text-andros-primary placeholder:text-andros-muted focus:border-andros-accent disabled:opacity-60";

const reviewBorder = (field: FormField) => (field.needsReview ? "border-andros-warning" : "border-andros-border");

// ----------------------------------------------------------------------------
// Campos de texto / número con envío en vivo
// ----------------------------------------------------------------------------

interface Session {
  before: string | null;
  original: FormField["value"];
  dirty: boolean;
  cancelled: boolean;
}

const LiveTextField: React.FC<{
  nodeId: string;
  field: FormField;
  inputId: string;
  disabled: boolean;
}> = ({ nodeId, field, inputId, disabled }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const isNumber = field.type === "number";
  const toValue = (text: string): FormField["value"] => {
    if (!isNumber) return text;
    const n = Number(text.replace(",", "."));
    return text.trim() === "" || !Number.isFinite(n) ? null : n;
  };
  const shown =
    draft ??
    (isNumber
      ? typeof field.value === "number"
        ? formatFormNumber(field.value)
        : ""
      : typeof field.value === "string"
        ? field.value
        : "");

  const begin = () => {
    session.current = { before: snapshotOf(nodeId), original: field.value, dirty: false, cancelled: false };
    setDraft(shown);
  };

  const change = (text: string) => {
    const next = text.slice(0, field.type === "textarea" ? 4000 : 400);
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (updateFormField(nodeId, field.id, { value: toValue(next), needsReview: undefined }) && session.current) {
        session.current.dirty = true;
      }
    }, LIVE_SYNC_MS);
  };

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const current = session.current;
    const text = draft;
    session.current = null;
    setDraft(null);
    if (!current || text === null) return;
    if (current.cancelled) {
      if (current.dirty) updateFormField(nodeId, field.id, { value: current.original });
      return;
    }
    const value = toValue(text);
    if (!current.dirty && value === current.original) return;
    commitWithImpact(nodeId, () => updateFormField(nodeId, field.id, { value, needsReview: undefined }), current.before);
  };

  const common = {
    id: inputId,
    value: shown,
    disabled,
    onFocus: begin,
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        if (session.current) session.current.cancelled = true;
        e.currentTarget.blur();
      }
      if (e.key === "Enter" && (field.type !== "textarea" || e.metaKey || e.ctrlKey)) e.currentTarget.blur();
    },
  };

  if (field.type === "textarea") {
    return (
      <textarea
        {...common}
        rows={3}
        className={`w-full min-w-0 resize-y rounded-lg bg-andros-canvas border ${reviewBorder(field)} outline-none p-2.5 text-[12px] leading-relaxed text-andros-primary focus:border-andros-accent disabled:opacity-60`}
      />
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        {...common}
        type="text"
        inputMode={isNumber ? "decimal" : "text"}
        className={`${INPUT_BASE} ${reviewBorder(field)} ${isNumber ? "text-right font-mono tabular-nums" : ""}`}
      />
      {isNumber && field.unit && (
        <span className="shrink-0 min-w-[2.5rem] text-[11px] font-mono text-andros-muted">{field.unit}</span>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Fotos: miniaturas, subida (PC / cámara / pegar) y visor ampliado
// ----------------------------------------------------------------------------

const PhotoLightbox: React.FC<{
  photo: FormPhoto;
  sheetTitle: string;
  canDelete: boolean;
  onDelete: () => void;
  onClose: () => void;
}> = ({ photo, sheetTitle, canDelete, onDelete, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[95] bg-black/80 flex items-center justify-center p-3 md:p-8"
      onPointerDown={onClose}
    >
      <div
        data-clarity-mask="true"
        role="dialog"
        aria-modal="true"
        aria-label={`Foto «${photo.name}» de la ficha «${sheetTitle}»`}
        onPointerDown={(e) => e.stopPropagation()}
        className="relative max-w-full max-h-full flex flex-col gap-2"
      >
        <div className="flex items-center justify-between gap-2 text-white">
          <p className="min-w-0 truncate text-xs">
            {photo.name}
            {photo.width > 0 && (
              <span className="ml-2 font-mono tabular-nums text-white/70">
                {photo.width}×{photo.height} · {formatPhotoBytes(photo.bytes)}
              </span>
            )}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label="Eliminar foto"
                className="w-11 h-11 md:w-9 md:h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center active:scale-[0.96] spring-micro"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Cerrar foto"
              className="w-11 h-11 md:w-9 md:h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center active:scale-[0.96] spring-micro"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.src || photo.thumb}
          alt={`Foto «${photo.name}» de la ficha «${sheetTitle}»`}
          className="max-w-[92vw] max-h-[80vh] object-contain rounded-xl bg-white"
        />
      </div>
    </div>,
    document.body
  );
};

const PhotoStrip: React.FC<{
  nodeId: string;
  sheetTitle: string;
  photos: FormPhoto[];
  target: PhotoTarget;
  label: string;
  max: number;
  disabled: boolean;
}> = ({ nodeId, sheetTitle, photos, target, label, max, disabled }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<FormPhoto | null>(null);

  const handleFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setBusy(true);
    try {
      await addPhotosToSheet(nodeId, target, files);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-no-drag className="space-y-1.5">
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-1.5" aria-label={`Fotos de ${label}`}>
          {photos.map((photo) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => setOpen(photo)}
                aria-label={`Ampliar foto «${photo.name}»`}
                className="block w-full aspect-square rounded-lg overflow-hidden border border-andros-border bg-andros-canvas hover:border-andros-border-active active:scale-[0.96] spring-micro"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumb || photo.src}
                  alt={`Miniatura de «${photo.name}»`}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!disabled && photos.length < max && (
        <div className="flex gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label={`Elegir imágenes para ${label}`}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label={`Tomar foto para ${label}`}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex-1 min-h-11 md:min-h-8 px-2.5 rounded-lg border border-dashed border-andros-border-active text-[11px] font-medium text-andros-muted hover:text-andros-primary hover:bg-andros-border/30 flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <ImagePlus className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
            )}
            {busy ? "Comprimiendo…" : "Añadir foto"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
            aria-label={`Tomar foto con la cámara para ${label}`}
            className="md:hidden w-11 h-11 shrink-0 rounded-lg border border-andros-border text-andros-accent-ink flex items-center justify-center active:scale-[0.96] spring-micro disabled:opacity-60"
          >
            <Camera className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {open && (
        <PhotoLightbox
          photo={open}
          sheetTitle={sheetTitle}
          canDelete={!disabled}
          onClose={() => setOpen(null)}
          onDelete={() => {
            removePhotoWithUndo(nodeId, open.id);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Fila de un campo (modo llenar)
// ----------------------------------------------------------------------------

const FieldRow: React.FC<{ node: FormSheetEngineeringNode; field: FormField; disabled: boolean }> = ({
  node,
  field,
  disabled,
}) => {
  const inputId = `form-${node.id}-${field.id}`;
  const commitDiscrete = (patch: Partial<FormField>) =>
    commitWithImpact(node.id, () => updateFormField(node.id, field.id, { ...patch, needsReview: undefined }));

  const control = (() => {
    switch (field.type) {
      case "checkbox": {
        const checked = field.value === true;
        return (
          <button
            id={inputId}
            type="button"
            role="checkbox"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => commitDiscrete({ value: !checked })}
            className="min-h-11 md:min-h-8 flex items-center gap-2 text-[12px] text-andros-primary active:scale-[0.96] spring-micro disabled:opacity-60"
          >
            {checked ? (
              <CheckSquare className="w-4 h-4 text-andros-success" aria-hidden="true" />
            ) : (
              <Square className="w-4 h-4 text-andros-muted" aria-hidden="true" />
            )}
            {checked ? "Sí" : "No"}
          </button>
        );
      }
      case "date":
        return (
          <input
            id={inputId}
            type="date"
            disabled={disabled}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={(e) => commitDiscrete({ value: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            className={`${INPUT_BASE} ${reviewBorder(field)} font-mono tabular-nums`}
          />
        );
      case "select":
        return (
          <select
            id={inputId}
            disabled={disabled}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={(e) => commitDiscrete({ value: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            className={`${INPUT_BASE} ${reviewBorder(field)}`}
          >
            <option value="">Sin elegir</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      case "photo":
        return (
          <PhotoStrip
            nodeId={node.id}
            sheetTitle={node.title}
            photos={field.photos ?? []}
            target={{ fieldId: field.id }}
            label={field.label}
            max={FORM_MAX_PHOTOS_PER_FIELD}
            disabled={disabled}
          />
        );
      default:
        return <LiveTextField nodeId={node.id} field={field} inputId={inputId} disabled={disabled} />;
    }
  })();

  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={field.type === "photo" ? undefined : inputId}
          className="min-w-0 truncate text-[11px] font-medium text-andros-muted"
          title={`Clave: ${field.fieldKey}`}
        >
          {field.label}
        </label>
        {field.needsReview && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] text-andros-warning">
            <TriangleAlert className="w-3 h-3" aria-hidden="true" />
            Revisar
            {!disabled && (
              <button
                type="button"
                onClick={() => updateFormField(node.id, field.id, { needsReview: undefined })}
                aria-label={`Confirmar dato de «${field.label}»`}
                title="Confirmar dato"
                className="hit-slop ml-0.5 p-0.5 rounded text-andros-success hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
              >
                <Check className="w-3 h-3" aria-hidden="true" />
              </button>
            )}
          </span>
        )}
      </div>
      {control}
    </li>
  );
};

// ----------------------------------------------------------------------------
// Fila de un campo (modo estructura: etiqueta, tipo, unidad, opciones, orden)
// ----------------------------------------------------------------------------

const StructureRow: React.FC<{ nodeId: string; field: FormField; index: number; count: number }> = ({
  nodeId,
  field,
  index,
  count,
}) => {
  const [label, setLabel] = useState(field.label);
  const [unit, setUnit] = useState(field.unit ?? "");
  const [options, setOptions] = useState((field.options ?? []).join(", "));
  const idBase = `struct-${nodeId}-${field.id}`;
  const stop = (e: React.KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") (e.currentTarget as HTMLElement).blur();
  };

  return (
    <li className="p-2 rounded-xl border border-andros-border bg-andros-canvas space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          id={`${idBase}-label`}
          aria-label="Nombre del campo"
          value={label}
          maxLength={80}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            const clean = label.trim();
            if (clean && clean !== field.label) renameFormField(nodeId, field.id, clean);
            else setLabel(field.label);
          }}
          onKeyDown={stop}
          className={`${INPUT_BASE} border-andros-border bg-andros-card`}
        />
        <button
          type="button"
          onClick={() => moveFormField(nodeId, field.id, -1)}
          disabled={index === 0}
          aria-label={`Subir «${field.label}»`}
          className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center justify-center active:scale-[0.96] spring-micro disabled:opacity-40"
        >
          <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => moveFormField(nodeId, field.id, 1)}
          disabled={index === count - 1}
          aria-label={`Bajar «${field.label}»`}
          className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center justify-center active:scale-[0.96] spring-micro disabled:opacity-40"
        >
          <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => removeFormFieldWithUndo(nodeId, field.id)}
          aria-label={`Quitar el campo «${field.label}»`}
          className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg text-andros-muted hover:text-andros-danger hover:bg-andros-border/40 flex items-center justify-center active:scale-[0.96] spring-micro"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          aria-label={`Tipo del campo «${field.label}»`}
          value={field.type}
          onChange={(e) => changeFormFieldType(nodeId, field.id, e.target.value as FormFieldType)}
          onKeyDown={(e) => e.stopPropagation()}
          className={`${INPUT_BASE} border-andros-border bg-andros-card`}
        >
          {FORM_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {FORM_FIELD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {field.type === "number" && (
          <input
            aria-label={`Unidad de «${field.label}»`}
            placeholder="Unidad"
            value={unit}
            maxLength={16}
            onChange={(e) => setUnit(e.target.value)}
            onBlur={() => updateFormField(nodeId, field.id, { unit: unit.trim() || undefined })}
            onKeyDown={stop}
            className={`${INPUT_BASE} border-andros-border bg-andros-card max-w-[6.5rem] font-mono`}
          />
        )}
      </div>
      {field.type === "select" && (
        <input
          aria-label={`Opciones de «${field.label}», separadas por comas`}
          placeholder="Opciones separadas por comas"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          onBlur={() => {
            const list = [...new Set(options.split(",").map((o) => o.trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
            updateFormField(nodeId, field.id, { options: list });
            setOptions(list.join(", "));
          }}
          onKeyDown={stop}
          className={`${INPUT_BASE} border-andros-border bg-andros-card`}
        />
      )}
      <p className="text-[10px] text-andros-muted">
        Clave para fórmulas: <code className="font-mono text-andros-primary">{field.fieldKey}</code>
      </p>
    </li>
  );
};

// ----------------------------------------------------------------------------
// Nodo completo
// ----------------------------------------------------------------------------

export const FormSheetNodeView: React.FC<{ node: FormSheetEngineeringNode; variant: "canvas" | "stack" }> = ({
  node,
  variant,
}) => {
  const data = node.formSheetData;
  const readOnly = useCanvasReadOnly();
  const [structure, setStructure] = useState(false);
  const presence = usePresenceHandlers(node.id);

  const filled = data.fields.filter(isFieldFilled).length;
  const review = data.fields.filter((f) => f.needsReview).length;

  const saveAsTemplate = () => {
    if (data.fields.length === 0) {
      toast({ message: "Añade al menos un campo antes de guardarla como formato.", tone: "error" });
      return;
    }
    useFormsLibraryStore.getState().upsertTemplate(templateFromSheet(node.title, data));
    toast({ message: `Formato «${node.title.slice(0, 40)}» guardado en tu librería.`, tone: "success" });
  };

  // Pegar una imagen (Ctrl/⌘+V) dentro de la ficha la añade a los adjuntos.
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const images = imagesFromClipboard(e);
    if (images.length === 0) return;
    e.preventDefault();
    void addPhotosToSheet(node.id, "attachments", images);
  };

  // (Sprint 18) Ficha de Resolución: semáforo Rojo/Verde + trazabilidad CDE.
  if (data.resolution) {
    return (
      <div className="py-3" {...presence}>
        <ResolutionPanel nodeId={node.id} meta={data.resolution} />
      </div>
    );
  }

  return (
    <div className="py-3 space-y-3" onPaste={onPaste} {...presence}>
      {/* Resumen de la ficha */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {data.area && <AreaBadge area={data.area} />}
        <span className="px-1.5 py-0.5 rounded bg-andros-border/50 text-andros-primary">{data.category}</span>
        {data.aiFilled && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-andros-border text-andros-muted">
            <Sparkles className="w-3 h-3 text-andros-accent-ink" aria-hidden="true" />
            Llenada con IA
          </span>
        )}
        <span className="ml-auto font-mono tabular-nums text-andros-muted" title="Campos con dato">
          {filled}/{data.fields.length}
        </span>
        {review > 0 && (
          <span className="flex items-center gap-1 font-mono tabular-nums text-andros-warning" title="Campos por revisar">
            <TriangleAlert className="w-3 h-3" aria-hidden="true" />
            {review}
          </span>
        )}
      </div>
      {data.batchLabel && (
        <p className="text-[11px] text-andros-muted truncate">
          Expediente: <span className="text-andros-primary font-medium">{data.batchLabel}</span>
        </p>
      )}
      <CardMentions fields={data.fields} />


      {/* Campos */}
      {data.fields.length === 0 ? (
        <p className="text-xs leading-relaxed text-andros-muted">
          Ficha sin campos. Pulsa «Editar campos» para añadir texto, números con unidad, fechas, casillas, listas o fotos.
        </p>
      ) : (
        <div
          data-no-drag
          className="overflow-y-auto pr-1 -mr-1"
          style={variant === "canvas" ? { maxHeight: FORM_FIELDS_MAX_HEIGHT } : undefined}
        >
          {structure ? (
            <ul className="space-y-2">
              {data.fields.map((field, index) => (
                <StructureRow
                  key={field.id}
                  nodeId={node.id}
                  field={field}
                  index={index}
                  count={data.fields.length}
                />
              ))}
            </ul>
          ) : (
            <ul className="space-y-2.5">
              {data.fields.map((field) => (
                <FieldRow key={field.id} node={node} field={field} disabled={readOnly} />
              ))}
            </ul>
          )}
        </div>
      )}

      {structure && !readOnly && data.fields.length < FORM_MAX_FIELDS && (
        <div data-no-drag className="flex flex-wrap gap-1.5">
          {FORM_FIELD_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addFormField(node.id, type)}
              className="min-h-11 md:min-h-7 px-2 rounded-lg border border-andros-border text-[11px] text-andros-primary hover:bg-andros-border/40 flex items-center gap-1 active:scale-[0.96] spring-micro"
            >
              <Plus className="w-3 h-3 text-andros-accent-ink" aria-hidden="true" />
              {FORM_FIELD_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}

      {/* Adjuntos visuales generales */}
      {(data.attachments.length > 0 || !readOnly) && !structure && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-andros-muted">
            Adjuntos
            {data.attachments.length > 0 && (
              <span className="ml-1 font-mono tabular-nums">({data.attachments.length})</span>
            )}
          </p>
          <PhotoStrip
            nodeId={node.id}
            sheetTitle={node.title}
            photos={data.attachments}
            target="attachments"
            label="los adjuntos"
            max={FORM_MAX_ATTACHMENTS}
            disabled={readOnly}
          />
        </div>
      )}

      {!readOnly && (
        <div data-no-drag className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setStructure((v) => !v)}
            aria-pressed={structure}
            className={`min-h-11 md:min-h-8 px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 active:scale-[0.96] spring-micro ${
              structure
                ? "bg-andros-accent-fill border-transparent text-white"
                : "border-andros-border text-andros-primary hover:bg-andros-border/40"
            }`}
          >
            {structure ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Settings2 className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />}
            {structure ? "Listo" : "Editar campos"}
          </button>
          <button
            type="button"
            onClick={saveAsTemplate}
            className="min-h-11 md:min-h-8 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
          >
            <BookmarkPlus className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
            Guardar como formato
          </button>
          {review > 0 && !structure && (
            <button
              type="button"
              onClick={() =>
                patchFormSheet(node.id, (latest) => ({
                  fields: latest.fields.map((f) => (f.needsReview ? { ...f, needsReview: undefined } : f)),
                }))
              }
              className="min-h-11 md:min-h-8 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
            >
              <Check className="w-3.5 h-3.5 text-andros-success" aria-hidden="true" />
              Todo revisado
            </button>
          )}
        </div>
      )}
    </div>
  );
};
