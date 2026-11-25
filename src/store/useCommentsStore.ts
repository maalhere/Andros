import { create } from "zustand";
import { openCountsByNode, sortComments, type WorkspaceComment } from "@/lib/comments/commentModel";

// ============================================================================
// ANDROS — COMENTARIOS DEL ESPACIO ABIERTO (Sprint 16)
// Lo escriben `useCommentsSync` (carga desde Supabase) y la sala en vivo
// (`comment:upsert` / `comment:resolve` / `comment:delete` vía canvasSync);
// lo leen CommentsDrawer y el botón de comentarios de cada tarjeta.
// ============================================================================

export type CommentsStatus =
  | "idle" // Sin espacio en la nube (modo local o sin sesión).
  | "loading"
  | "ready"
  | "setup-missing" // Falta ejecutar supabase/schema.sql (§12).
  | "error";

interface CommentsState {
  workspaceId: string | null;
  comments: WorkspaceComment[];
  /** Abiertos por tarjeta (se recalcula al cambiar la lista). */
  openByNode: Record<string, number>;
  status: CommentsStatus;
  errorMessage: string | null;
  /** Ocultos mientras dura su «Deshacer». */
  hiddenIds: string[];

  drawerOpen: boolean;
  /** Tarjeta enfocada en el cajón (`null` = todos los comentarios). */
  focusNodeId: string | null;

  hydrate: (workspaceId: string | null, comments: WorkspaceComment[]) => void;
  setStatus: (status: CommentsStatus, errorMessage?: string | null) => void;
  upsert: (comment: WorkspaceComment) => void;
  setResolved: (id: string, resolved: boolean) => void;
  remove: (id: string) => void;
  hide: (id: string, hidden: boolean) => void;
  openDrawer: (nodeId?: string | null) => void;
  closeDrawer: () => void;
  setFocusNode: (nodeId: string | null) => void;
}

function withList(comments: WorkspaceComment[]) {
  const sorted = sortComments(comments);
  return { comments: sorted, openByNode: openCountsByNode(sorted) };
}

export const useCommentsStore = create<CommentsState>((set) => ({
  workspaceId: null,
  comments: [],
  openByNode: {},
  status: "idle",
  errorMessage: null,
  hiddenIds: [],
  drawerOpen: false,
  focusNodeId: null,

  hydrate: (workspaceId, comments) =>
    set((state) => ({
      workspaceId,
      ...withList(comments.filter((c) => c.workspaceId === workspaceId)),
      hiddenIds: state.workspaceId === workspaceId ? state.hiddenIds : [],
    })),
  setStatus: (status, errorMessage) =>
    set((state) => ({ status, errorMessage: errorMessage === undefined ? state.errorMessage : errorMessage })),
  upsert: (comment) =>
    set((state) => {
      if (comment.workspaceId !== state.workspaceId) return {};
      const rest = state.comments.filter((c) => c.id !== comment.id);
      return withList([comment, ...rest]);
    }),
  setResolved: (id, resolved) =>
    set((state) => {
      if (!state.comments.some((c) => c.id === id && c.resolved !== resolved)) return {};
      return withList(state.comments.map((c) => (c.id === id ? { ...c, resolved } : c)));
    }),
  remove: (id) =>
    set((state) => {
      if (!state.comments.some((c) => c.id === id)) return {};
      return { ...withList(state.comments.filter((c) => c.id !== id)), hiddenIds: state.hiddenIds.filter((x) => x !== id) };
    }),
  hide: (id, hidden) =>
    set((state) => ({
      hiddenIds: hidden ? [...new Set([...state.hiddenIds, id])] : state.hiddenIds.filter((x) => x !== id),
    })),
  openDrawer: (nodeId = null) => set({ drawerOpen: true, focusNodeId: nodeId }),
  closeDrawer: () => set({ drawerOpen: false }),
  setFocusNode: (focusNodeId) => set({ focusNodeId }),
}));

/** Comentarios abiertos de una tarjeta, sin contar los que están en «Deshacer». */
export function useNodeOpenCommentCount(nodeId: string): number {
  return useCommentsStore((s) => {
    const base = s.openByNode[nodeId] ?? 0;
    if (base === 0 || s.hiddenIds.length === 0) return base;
    return s.comments.filter((c) => c.nodeId === nodeId && !c.resolved && !s.hiddenIds.includes(c.id)).length;
  });
}

/** Total de comentarios abiertos del espacio (insignia de la barra superior). */
export function useOpenCommentTotal(): number {
  return useCommentsStore((s) => s.comments.filter((c) => !c.resolved && !s.hiddenIds.includes(c.id)).length);
}
