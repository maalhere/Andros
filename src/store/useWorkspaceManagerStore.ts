import { create } from "zustand";
import type { MemberRole } from "@/lib/access/permissions";

// ============================================================================
// ANDROS — ESTADO DEL GESTOR DE ESPACIOS (carpetas y proyectos del usuario)
// Lo escribe `useCloudSync` (lista de la tabla `workspaces`); lo leen el
// selector de la barra superior y `WorkspaceManagerDrawer`.
// ============================================================================

export interface WorkspaceSummary {
  id: string;
  name: string;
  /** Carpeta a la que pertenece. Cadena vacía = sin carpeta. */
  folder: string;
  createdAt: string;
  updatedAt: string;
}

/** Espacio de OTRA cuenta en el que te añadieron como miembro. */
export interface SharedWorkspaceSummary extends WorkspaceSummary {
  ownerId: string;
  /** Nombre o @usuario del dueño (si la base lo permite leer). */
  ownerName: string;
  /** (Sprint 16) Tu permiso en este espacio: Editor, Comentarista o Solo lectura. */
  role: MemberRole;
}

interface WorkspaceManagerState {
  workspaces: WorkspaceSummary[];
  /** «Compartidos conmigo»: espacios ajenos donde eres miembro. */
  sharedWorkspaces: SharedWorkspaceSummary[];
  /** `false` si la base de datos aún no tiene la columna `folder`. */
  foldersSupported: boolean;
  drawerOpen: boolean;
  /** Operación en curso (crear, duplicar, borrar, importar…). */
  busy: boolean;
  message: { kind: "error" | "info"; text: string } | null;

  setWorkspaces: (workspaces: WorkspaceSummary[], foldersSupported?: boolean) => void;
  setSharedWorkspaces: (shared: SharedWorkspaceSummary[]) => void;
  setDrawerOpen: (open: boolean) => void;
  setBusy: (busy: boolean) => void;
  setMessage: (message: WorkspaceManagerState["message"]) => void;
}

export const useWorkspaceManagerStore = create<WorkspaceManagerState>((set) => ({
  workspaces: [],
  sharedWorkspaces: [],
  foldersSupported: true,
  drawerOpen: false,
  busy: false,
  message: null,

  setWorkspaces: (workspaces, foldersSupported) =>
    set((state) => ({
      workspaces,
      foldersSupported: foldersSupported ?? state.foldersSupported,
    })),
  setSharedWorkspaces: (sharedWorkspaces) => set({ sharedWorkspaces }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setBusy: (busy) => set({ busy }),
  setMessage: (message) => set({ message }),
}));
