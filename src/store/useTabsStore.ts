import { create } from "zustand";
import { useCloudStore } from "@/store/useCloudStore";
import { useLandingStore } from "@/store/useLandingStore";

// ============================================================================
// ANDROS — PESTAÑAS DE ESPACIOS DE TRABAJO (estilo Chrome)
// `openTabIds` son los espacios abiertos en esta sesión (se guardan en
// localStorage para que sigan abiertos al recargar). El espacio realmente
// cargado lo decide `useCloudSync` (`useCloudStore.workspaceId`); aquí solo se
// refleja en `activeWorkspaceId`.
// ============================================================================

export const TABS_STORAGE_KEY = "andros:tabs:v1";

interface TabsState {
  openTabIds: string[];
  activeWorkspaceId: string | null;
  /** Ya se leyó localStorage (evita pisarlo con una lista vacía al arrancar). */
  hydrated: boolean;

  hydrate: () => void;
  /** Añade la pestaña si no existe (si existe, no la duplica) y la marca activa. */
  openTab: (id: string) => void;
  /** Quita la pestaña. Devuelve el espacio vecino que debe abrirse si era la activa. */
  closeTab: (id: string) => string | null;
  /** Descarta pestañas de espacios que ya no existen (borrados), salvo `keepId`. */
  prune: (validIds: string[], keepId: string | null) => void;
}

function persist(openTabIds: string[], activeWorkspaceId: string | null) {
  try {
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ openTabIds, activeWorkspaceId }));
  } catch {
    // Almacenamiento bloqueado: las pestañas siguen funcionando en esta sesión.
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  openTabIds: [],
  activeWorkspaceId: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    let ids: string[] = [];
    let active: string | null = null;
    try {
      const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { openTabIds?: unknown; activeWorkspaceId?: unknown };
        if (Array.isArray(parsed.openTabIds)) {
          ids = [...new Set(parsed.openTabIds.filter((x): x is string => typeof x === "string"))].slice(0, 30);
        }
        if (typeof parsed.activeWorkspaceId === "string") active = parsed.activeWorkspaceId;
      }
    } catch {
      // JSON dañado: se empieza sin pestañas guardadas.
    }
    set((s) => ({
      hydrated: true,
      openTabIds: [...ids, ...s.openTabIds.filter((id) => !ids.includes(id))],
      activeWorkspaceId: s.activeWorkspaceId ?? active,
    }));
  },

  openTab: (id) => {
    const { openTabIds, activeWorkspaceId, hydrated } = get();
    if (openTabIds.includes(id) && activeWorkspaceId === id) return;
    const next = openTabIds.includes(id) ? openTabIds : [...openTabIds, id];
    set({ openTabIds: next, activeWorkspaceId: id });
    if (hydrated) persist(next, id);
  },

  closeTab: (id) => {
    const { openTabIds, activeWorkspaceId } = get();
    const index = openTabIds.indexOf(id);
    if (index === -1) return null;
    const next = openTabIds.filter((x) => x !== id);
    const wasActive = id === activeWorkspaceId;
    const neighbor = wasActive ? (next[index] ?? next[index - 1] ?? null) : null;
    const active = wasActive ? neighbor : activeWorkspaceId;
    set({ openTabIds: next, activeWorkspaceId: active });
    persist(next, active);
    return neighbor;
  },

  prune: (validIds, keepId) => {
    const { openTabIds, activeWorkspaceId } = get();
    const next = openTabIds.filter((id) => id === keepId || validIds.includes(id));
    if (next.length === openTabIds.length) return;
    const active = activeWorkspaceId && next.includes(activeWorkspaceId) ? activeWorkspaceId : keepId;
    set({ openTabIds: next, activeWorkspaceId: active });
    persist(next, active);
  },
}));

/** La barra de pestañas solo se muestra con sesión iniciada y fuera de la portada. */
export function useTabsBarVisible(): boolean {
  const signedIn = useCloudStore((s) => s.user !== null);
  const inWorkspace = useLandingStore((s) => s.phase === "workspace");
  return signedIn && inWorkspace;
}
