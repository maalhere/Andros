import { create } from "zustand";
import type { LibraryScope, LibrarySource } from "@/types/library";

// ============================================================================
// ANDROS — ESTADO DE LA BIBLIOTECA DE FUENTES
// Ventana abierta/cerrada, pestaña activa y "Mis fuentes" (las guardadas por
// el usuario, en localStorage para que funcionen sin nube ni red).
// ============================================================================

const SAVED_KEY = "andros.library.saved.v1";
const MAX_SAVED = 60;

/** Desde dónde se abrió: cambia la acción destacada de cada resultado. */
export type LibraryOrigin = "canvas" | "oracle";

interface LibraryState {
  open: boolean;
  origin: LibraryOrigin;
  scope: LibraryScope;
  saved: LibrarySource[];
  hydrated: boolean;

  openLibrary: (options?: { origin?: LibraryOrigin; scope?: LibraryScope }) => void;
  closeLibrary: () => void;
  setScope: (scope: LibraryScope) => void;
  hydrateSaved: () => void;
  toggleSaved: (source: LibrarySource) => void;
}

function readSaved(): LibrarySource[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((s): s is LibrarySource => Boolean(s && typeof s === "object" && "id" in s && "title" in s))
      : [];
  } catch {
    return [];
  }
}

function writeSaved(list: LibrarySource[]) {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // Navegación privada o cuota llena: se mantiene solo en memoria.
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  open: false,
  origin: "canvas",
  scope: "papers",
  saved: [],
  hydrated: false,

  openLibrary: (options) =>
    set((state) => ({
      open: true,
      origin: options?.origin ?? "canvas",
      scope: options?.scope ?? state.scope,
    })),
  closeLibrary: () => set({ open: false }),
  setScope: (scope) => set({ scope }),
  hydrateSaved: () => {
    if (get().hydrated) return;
    set({ saved: readSaved(), hydrated: true });
  },
  toggleSaved: (source) => {
    const exists = get().saved.some((s) => s.id === source.id);
    const next = exists
      ? get().saved.filter((s) => s.id !== source.id)
      : [source, ...get().saved].slice(0, MAX_SAVED);
    writeSaved(next);
    set({ saved: next });
  },
}));
