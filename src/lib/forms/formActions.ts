// ============================================================================
// ANDROS — ACCIONES LOCALES DE LAS FICHAS (solo cliente, $0 API, 0 ms)
// Editar campos, añadir/quitar filas, adjuntar fotos y replicar formatos
// trabajan siempre sobre la ficha MÁS RECIENTE del store (otro campo pudo
// cambiar en la sala en vivo). `canvasSync` emite cada cambio a los demás.
// ============================================================================

import {
  estimateNodeHeight,
  nextUniqueId,
  resolveAutoPorts,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import { toast } from "@/store/useToastStore";
import { visibleSpawnPoint } from "@/lib/canvas/quickAdd";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import type {
  EngineeringNodeData,
  FormField,
  FormFieldType,
  FormPhoto,
  FormSheetEngineeringNode,
  FormSheetPayload,
  NodeConnection,
} from "@/types/workspace";
import type { FormTemplate } from "@/types/forms";
import {
  FORM_MAX_ATTACHMENTS,
  FORM_MAX_FIELDS,
  FORM_MAX_PHOTOS_PER_FIELD,
  FORM_MAX_PHOTOS_TOTAL,
  FORM_SHEET_CODE_TAG,
  FORM_FIELD_TYPE_LABELS,
  emptyValueFor,
  instantiateTemplate,
  newFormId,
  photoCount,
  toFieldKey,
  uniqueFieldKeys,
} from "./formSchema";
import { compressPhoto, PhotoError } from "./imageCompress";
import { instantiateCatalogTemplate, type CatalogTemplate } from "./templateCatalog";

const ws = () => useWorkspaceStore.getState();

function getSheet(nodeId: string): FormSheetEngineeringNode | null {
  const node = ws().nodes.find((n) => n.id === nodeId);
  return node?.type === "form-sheet-node" ? node : null;
}

/** Aplica un cambio sobre la versión más reciente de la ficha. */
export function patchFormSheet(
  nodeId: string,
  patch: (data: FormSheetPayload) => Partial<FormSheetPayload> | null
): boolean {
  const node = getSheet(nodeId);
  if (!node) return false;
  const next = patch(node.formSheetData);
  if (!next) return false;
  ws().updateNodePayload(nodeId, next);
  return true;
}

export function updateFormField(nodeId: string, fieldId: string, patch: Partial<FormField>): boolean {
  return patchFormSheet(nodeId, (data) => {
    if (!data.fields.some((f) => f.id === fieldId)) return null;
    return { fields: data.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) };
  });
}

/** Cambia la etiqueta y regenera el `fieldKey` (único dentro de la ficha). */
export function renameFormField(nodeId: string, fieldId: string, label: string): void {
  patchFormSheet(nodeId, (data) => ({
    fields: uniqueFieldKeys(
      data.fields.map((f) => (f.id === fieldId ? { ...f, label: label.slice(0, 80), fieldKey: toFieldKey(label) } : f))
    ),
  }));
}

/** Cambia el tipo conservando lo que tenga sentido (texto ↔ texto largo). */
export function changeFormFieldType(nodeId: string, fieldId: string, type: FormFieldType): void {
  patchFormSheet(nodeId, (data) => ({
    fields: data.fields.map((f) => {
      if (f.id !== fieldId || f.type === type) return f;
      const keepText = (f.type === "text" || f.type === "textarea") && (type === "text" || type === "textarea");
      return {
        id: f.id,
        fieldKey: f.fieldKey,
        label: f.label,
        type,
        value: keepText ? f.value : emptyValueFor(type),
        ...(type === "number" && f.unit ? { unit: f.unit } : {}),
        ...(type === "select" ? { options: f.options?.length ? f.options : ["Opción 1", "Opción 2"] } : {}),
        ...(type === "photo" ? { photos: [] } : {}),
      };
    }),
  }));
}

export function addFormField(nodeId: string, type: FormFieldType = "text"): string | null {
  const id = newFormId("fld");
  const ok = patchFormSheet(nodeId, (data) => {
    if (data.fields.length >= FORM_MAX_FIELDS) {
      toast({ message: `Una ficha admite hasta ${FORM_MAX_FIELDS} campos.`, tone: "error" });
      return null;
    }
    const label = `${FORM_FIELD_TYPE_LABELS[type]} ${data.fields.length + 1}`;
    const field: FormField = {
      id,
      fieldKey: toFieldKey(label),
      label,
      type,
      value: emptyValueFor(type),
      ...(type === "select" ? { options: ["Opción 1", "Opción 2"] } : {}),
      ...(type === "photo" ? { photos: [] } : {}),
    };
    return { fields: uniqueFieldKeys([...data.fields, field]) };
  });
  return ok ? id : null;
}

export function moveFormField(nodeId: string, fieldId: string, delta: -1 | 1): void {
  patchFormSheet(nodeId, (data) => {
    const index = data.fields.findIndex((f) => f.id === fieldId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= data.fields.length) return null;
    const fields = [...data.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    return { fields };
  });
}

/** Quita una fila con «Deshacer» (vuelve a su posición si la ficha sigue existiendo). */
export function removeFormFieldWithUndo(nodeId: string, fieldId: string): void {
  const node = getSheet(nodeId);
  const index = node?.formSheetData.fields.findIndex((f) => f.id === fieldId) ?? -1;
  if (!node || index === -1) return;
  const field = node.formSheetData.fields[index];
  patchFormSheet(nodeId, (data) => ({ fields: data.fields.filter((f) => f.id !== fieldId) }));
  toast({
    message: `Campo «${field.label.slice(0, 40)}» quitado.`,
    action: {
      label: "Deshacer",
      onAction: () =>
        patchFormSheet(nodeId, (data) => {
          if (data.fields.some((f) => f.id === fieldId)) return null;
          const fields = [...data.fields];
          fields.splice(Math.min(index, fields.length), 0, field);
          return { fields: uniqueFieldKeys(fields) };
        }),
    },
  });
}

// ----------------------------------------------------------------------------
// Fotos
// ----------------------------------------------------------------------------

export type PhotoTarget = { fieldId: string } | "attachments";

/** Comprime y adjunta imágenes (archivo, cámara o portapapeles) respetando los topes. */
export async function addPhotosToSheet(nodeId: string, target: PhotoTarget, files: File[]): Promise<number> {
  const node = getSheet(nodeId);
  if (!node || files.length === 0) return 0;
  const data = node.formSheetData;
  const slotsTotal = FORM_MAX_PHOTOS_TOTAL - photoCount(data);
  const slotsTarget =
    target === "attachments"
      ? FORM_MAX_ATTACHMENTS - data.attachments.length
      : FORM_MAX_PHOTOS_PER_FIELD - (data.fields.find((f) => f.id === target.fieldId)?.photos?.length ?? 0);
  const slots = Math.min(slotsTotal, slotsTarget);
  if (slots <= 0) {
    toast({
      message: `Se alcanzó el máximo de fotos (${FORM_MAX_PHOTOS_TOTAL} por ficha, ${
        target === "attachments" ? FORM_MAX_ATTACHMENTS : FORM_MAX_PHOTOS_PER_FIELD
      } aquí).`,
      tone: "error",
    });
    return 0;
  }

  const photos: FormPhoto[] = [];
  for (const file of files.slice(0, slots)) {
    try {
      photos.push(await compressPhoto(file));
    } catch (error) {
      toast({
        message: error instanceof PhotoError ? error.message : "No se pudo procesar la imagen.",
        tone: "error",
      });
    }
  }
  if (photos.length === 0) return 0;
  if (files.length > slots) {
    toast({ message: `Solo se adjuntaron ${photos.length}: se alcanzó el máximo de fotos.`, tone: "neutral" });
  }

  patchFormSheet(nodeId, (latest) => {
    if (target === "attachments") return { attachments: [...latest.attachments, ...photos] };
    return {
      fields: latest.fields.map((f) =>
        f.id === target.fieldId ? { ...f, photos: [...(f.photos ?? []), ...photos], needsReview: undefined } : f
      ),
    };
  });
  return photos.length;
}

/** Borra una foto (de un campo o de los adjuntos) con «Deshacer». */
export function removePhotoWithUndo(nodeId: string, photoId: string): void {
  const node = getSheet(nodeId);
  if (!node) return;
  const data = node.formSheetData;
  const attachmentIndex = data.attachments.findIndex((p) => p.id === photoId);
  const owner = data.fields.find((f) => f.photos?.some((p) => p.id === photoId));
  const photo =
    attachmentIndex >= 0 ? data.attachments[attachmentIndex] : owner?.photos?.find((p) => p.id === photoId);
  if (!photo) return;
  const index = attachmentIndex >= 0 ? attachmentIndex : (owner?.photos?.findIndex((p) => p.id === photoId) ?? 0);

  patchFormSheet(nodeId, (latest) => ({
    attachments: latest.attachments.filter((p) => p.id !== photoId),
    fields: latest.fields.map((f) =>
      f.photos?.some((p) => p.id === photoId) ? { ...f, photos: f.photos.filter((p) => p.id !== photoId) } : f
    ),
  }));

  const insert = (list: FormPhoto[]) => {
    if (list.some((p) => p.id === photoId)) return list;
    const next = [...list];
    next.splice(Math.min(index, next.length), 0, photo);
    return next;
  };
  toast({
    message: "Foto eliminada.",
    action: {
      label: "Deshacer",
      onAction: () =>
        patchFormSheet(nodeId, (latest) =>
          attachmentIndex >= 0
            ? { attachments: insert(latest.attachments) }
            : {
                fields: latest.fields.map((f) => (f.id === owner?.id ? { ...f, photos: insert(f.photos ?? []) } : f)),
              }
        ),
    },
  });
}

// ----------------------------------------------------------------------------
// Replicar formatos y colocar fichas sin solapes
// ----------------------------------------------------------------------------

const NODE_WIDTH = 320;
const COLUMN_GAP = 150;
const ROW_GAP = 60;
const SHEETS_PER_ROW = 4;

/**
 * Posiciones libres para `heights.length` fichas nuevas: a la derecha de todo
 * lo que ya hay en el lienzo (nunca encima de otra tarjeta), en filas de 4 y
 * a la altura de lo que el usuario está mirando.
 */
export function freeSlotsForSheets(heights: number[]): { x: number; y: number }[] {
  const { nodes } = ws();
  const view = typeof window !== "undefined" ? visibleSpawnPoint() : { x: 80, y: 120 };
  const startX =
    nodes.length === 0 ? view.x : Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH)) + COLUMN_GAP;
  const startY = nodes.length === 0 ? view.y : Math.max(80, view.y);

  const slots: { x: number; y: number }[] = [];
  let rowTop = startY;
  let rowHeight = 0;
  heights.forEach((height, i) => {
    const col = i % SHEETS_PER_ROW;
    if (i > 0 && col === 0) {
      rowTop += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    slots.push({ x: Math.round(startX + col * (NODE_WIDTH + COLUMN_GAP)), y: Math.round(rowTop) });
    rowHeight = Math.max(rowHeight, height);
  });
  return slots;
}

/** Crea en el lienzo una ficha vacía del formato elegido (1 clic, 0 ms, $0 API). */
export function replicateTemplate(template: FormTemplate): string {
  return placeSheet(instantiateTemplate(template));
}

/** (Sprint 23) Plantilla del catálogo → ficha con guías prellenadas y área sugerida. */
export function replicateCatalogTemplate(template: CatalogTemplate): string {
  return placeSheet(instantiateCatalogTemplate(template));
}

function placeSheet({ title, data }: { title: string; data: FormSheetPayload }): string {
  const draft = buildSheetNode("tmp", title, data, { x: 0, y: 0 });
  const [position] = freeSlotsForSheets([estimateNodeHeight(draft)]);
  const id = ws().aiCreateNode({
    type: "form-sheet-node",
    title,
    codeTag: FORM_SHEET_CODE_TAG,
    position,
    formSheetData: data,
  });
  ws().setActiveTool("pointer");
  ws().setActiveMobileSheet("none");
  requestAnimationFrame(() => focusNodeOnScreen(id));
  return id;
}

export function buildSheetNode(
  id: string,
  title: string,
  data: FormSheetPayload,
  position: { x: number; y: number }
): FormSheetEngineeringNode {
  return {
    id,
    type: "form-sheet-node",
    title: title.slice(0, 120) || "Ficha",
    codeTag: FORM_SHEET_CODE_TAG,
    position,
    updatedAt: "Ahora mismo",
    formSheetData: data,
  };
}

/**
 * Inserta varias fichas ya llenas de una sola vez, sin solapes, y une con
 * cables claras las que pertenecen al mismo expediente / lote.
 */
export function insertSheetBatch(
  sheets: { title: string; data: FormSheetPayload; group: string }[]
): string[] {
  if (sheets.length === 0) return [];
  const drafts = sheets.map((s) => buildSheetNode(nextUniqueId("node"), s.title, s.data, { x: 0, y: 0 }));
  const slots = freeSlotsForSheets(drafts.map((d) => estimateNodeHeight(d)));
  const nodes: EngineeringNodeData[] = drafts.map((d, i) => ({ ...d, position: slots[i] }));

  const connections: NodeConnection[] = [];
  const lastOfGroup = new Map<string, EngineeringNodeData>();
  nodes.forEach((node, i) => {
    const group = sheets[i].group;
    const prev = lastOfGroup.get(group);
    if (prev) {
      const ports = resolveAutoPorts(prev, node);
      connections.push({
        id: nextUniqueId("conn"),
        fromNodeId: prev.id,
        toNodeId: node.id,
        ...ports,
        label: group.length <= 40 ? `Expediente: ${group}` : "Mismo expediente",
      });
    }
    lastOfGroup.set(group, node);
  });

  ws().aiInsertBoard(nodes, connections);
  requestAnimationFrame(() => focusNodeOnScreen(nodes[0].id));
  return nodes.map((n) => n.id);
}
