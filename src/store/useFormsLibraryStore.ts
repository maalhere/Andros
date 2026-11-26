import { create } from "zustand";
import type { FormTemplate } from "@/types/forms";
import {
  BUILT_IN_TEMPLATES,
  FORM_LIBRARY_MAX_TEMPLATES,
  sanitizeTemplate,
} from "@/lib/forms/formSchema";

// ============================================================================
// ANDROS — LIBRERÍA PERSONAL DE FICHAS REPLICABLES
// Formatos del usuario (y los 4 iniciales). Persistencia en
// `useFormLibrarySync`: localStorage `andros_form_library` + Supabase
// `profiles.form_library` (JSONB). Los borrados dejan una «lápida» con fecha
// para que otro dispositivo no resucite el formato al sincronizar.
// ============================================================================

/** `catalog`: las 24 plantillas listas para usar (Sprint 23). */
export type FormsLibraryTab = "catalog" | "library" | "autofill";
/** `setup`: falta la columna `form_library` en Supabase (se usa solo la copia local). */
export type FormsCloudStatus = "local" | "synced" | "setup";

export interface FormLibraryDocument {
  version: 1;
  templates: FormTemplate[];
  /** id → fecha (ms) del borrado. */
  deleted: Record<string, number>;
}

interface FormsLibraryState {
  templates: FormTemplate[];
  deleted: Record<string, number>;
  hydrated: boolean;
  cloudStatus: FormsCloudStatus;

  libraryOpen: boolean;
  libraryTab: FormsLibraryTab;
  /** Formatos preseleccionados al abrir «Llenar con IA». */
  preselectTemplateIds: string[];
  /** (Sprint 24) Fichas del lienzo preseleccionadas (botón «Llenar con IA» de una ficha). */
  preselectSheetIds: string[];
  /** Diálogo independiente de auto-llenado (desde el Oráculo). */
  autofillOpen: boolean;

  openLibrary: (tab?: FormsLibraryTab, preselect?: string[]) => void;
  /** Abre «Llenar con IA» con estas fichas del lienzo ya elegidas. */
  openAutofillForSheets: (sheetIds: string[]) => void;
  closeLibrary: () => void;
  setLibraryTab: (tab: FormsLibraryTab) => void;
  setAutofillOpen: (open: boolean) => void;

  /** Reemplaza la librería (carga local o de la nube). */
  hydrate: (doc: FormLibraryDocument) => void;
  setCloudStatus: (status: FormsCloudStatus) => void;
  upsertTemplate: (template: FormTemplate) => void;
  /** Borra y devuelve lo necesario para «Deshacer». */
  removeTemplate: (id: string) => { template: FormTemplate; index: number } | null;
  restoreTemplate: (template: FormTemplate, index: number) => void;
  /** Vuelve a añadir los formatos iniciales que falten. Devuelve cuántos añadió. */
  restoreBuiltIns: () => number;
}

const MAX_TOMBSTONES = 200;

function trimTombstones(deleted: Record<string, number>): Record<string, number> {
  const entries = Object.entries(deleted);
  if (entries.length <= MAX_TOMBSTONES) return deleted;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_TOMBSTONES));
}

export const useFormsLibraryStore = create<FormsLibraryState>((set, get) => ({
  templates: BUILT_IN_TEMPLATES,
  deleted: {},
  hydrated: false,
  cloudStatus: "local",

  libraryOpen: false,
  libraryTab: "library",
  preselectTemplateIds: [],
  preselectSheetIds: [],
  autofillOpen: false,

  openLibrary: (tab = "catalog", preselect = []) =>
    set({ libraryOpen: true, libraryTab: tab, preselectTemplateIds: preselect, preselectSheetIds: [] }),
  openAutofillForSheets: (sheetIds) =>
    set({ libraryOpen: true, libraryTab: "autofill", preselectTemplateIds: [], preselectSheetIds: sheetIds }),
  closeLibrary: () => set({ libraryOpen: false, preselectTemplateIds: [], preselectSheetIds: [] }),
  setLibraryTab: (tab) => set({ libraryTab: tab }),
  setAutofillOpen: (open) => set({ autofillOpen: open }),

  hydrate: (doc) =>
    set({
      templates: doc.templates.slice(0, FORM_LIBRARY_MAX_TEMPLATES),
      deleted: trimTombstones(doc.deleted),
      hydrated: true,
    }),
  setCloudStatus: (status) => set({ cloudStatus: status }),

  upsertTemplate: (template) =>
    set((state) => {
      const stamped = { ...template, updatedAt: Date.now() };
      const index = state.templates.findIndex((t) => t.id === template.id);
      const templates =
        index === -1
          ? [stamped, ...state.templates].slice(0, FORM_LIBRARY_MAX_TEMPLATES)
          : state.templates.map((t) => (t.id === template.id ? stamped : t));
      const deleted = { ...state.deleted };
      delete deleted[template.id];
      return { templates, deleted };
    }),

  removeTemplate: (id) => {
    const index = get().templates.findIndex((t) => t.id === id);
    if (index === -1) return null;
    const template = get().templates[index];
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
      deleted: trimTombstones({ ...state.deleted, [id]: Date.now() }),
    }));
    return { template, index };
  },

  restoreTemplate: (template, index) =>
    set((state) => {
      if (state.templates.some((t) => t.id === template.id)) return {};
      const templates = [...state.templates];
      templates.splice(Math.min(index, templates.length), 0, { ...template, updatedAt: Date.now() });
      const deleted = { ...state.deleted };
      delete deleted[template.id];
      return { templates, deleted };
    }),

  restoreBuiltIns: () => {
    const existing = new Set(get().templates.map((t) => t.id));
    const missing = BUILT_IN_TEMPLATES.filter((t) => !existing.has(t.id)).map((t) => ({
      ...t,
      updatedAt: Date.now(),
    }));
    if (missing.length === 0) return 0;
    set((state) => {
      const deleted = { ...state.deleted };
      for (const t of missing) delete deleted[t.id];
      return { templates: [...state.templates, ...missing], deleted };
    });
    return missing.length;
  },
}));

// ----------------------------------------------------------------------------
// Documento serializable (localStorage / Supabase) y fusión entre dispositivos
// ----------------------------------------------------------------------------

export function libraryDocument(): FormLibraryDocument {
  const { templates, deleted } = useFormsLibraryStore.getState();
  return { version: 1, templates, deleted };
}

/** Valida lo leído de localStorage o de la nube. `null` si no hay nada utilizable. */
export function parseLibraryDocument(raw: unknown): FormLibraryDocument | null {
  if (!raw) return null;
  // Formato antiguo / manual: un arreglo de formatos.
  const obj = Array.isArray(raw) ? { templates: raw } : raw;
  if (typeof obj !== "object" || obj === null) return null;
  const r = obj as Record<string, unknown>;
  if (!Array.isArray(r.templates)) return null;
  const seen = new Set<string>();
  const templates: FormTemplate[] = [];
  for (const item of r.templates) {
    const t = sanitizeTemplate(item);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    templates.push(t);
  }
  const deleted: Record<string, number> = {};
  if (r.deleted && typeof r.deleted === "object" && !Array.isArray(r.deleted)) {
    for (const [id, at] of Object.entries(r.deleted as Record<string, unknown>)) {
      if (typeof id === "string" && id.length <= 80 && Number.isFinite(at)) deleted[id] = Number(at);
    }
  }
  return { version: 1, templates, deleted };
}

/** Une dos librerías: gana la edición más reciente y se respetan los borrados. */
export function mergeLibraryDocuments(a: FormLibraryDocument, b: FormLibraryDocument): FormLibraryDocument {
  const deleted: Record<string, number> = { ...a.deleted };
  for (const [id, at] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, at);

  const byId = new Map<string, FormTemplate>();
  const order: string[] = [];
  for (const t of [...a.templates, ...b.templates]) {
    const prev = byId.get(t.id);
    if (!prev) order.push(t.id);
    if (!prev || t.updatedAt > prev.updatedAt) byId.set(t.id, t);
  }
  const templates = order
    .map((id) => byId.get(id)!)
    .filter((t) => !(deleted[t.id] && deleted[t.id] >= t.updatedAt));
  for (const t of templates) delete deleted[t.id];
  return { version: 1, templates: templates.slice(0, FORM_LIBRARY_MAX_TEMPLATES), deleted: trimTombstones(deleted) };
}
