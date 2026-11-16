import { create } from "zustand";

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

interface WorkspaceManagerState {
  workspaces: WorkspaceSummary[];
  /** `false` si la base de datos aún no tiene la columna `folder`. */
  foldersSupported: boolean;
  drawerOpen: boolean;
  /** Operación en curso (crear, duplicar, borrar, importar…). */
  busy: boolean;
  message: { kind: "error" | "info"; text: string } | null;

  setWorkspaces: (workspaces: WorkspaceSummary[], foldersSupported?: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  setBusy: (busy: boolean) => void;
  setMessage: (message: WorkspaceManagerState["message"]) => void;
}

export const useWorkspaceManagerStore = create<WorkspaceManagerState>((set) => ({
  workspaces: [],
  foldersSupported: true,
  drawerOpen: false,
  busy: false,
  message: null,

  setWorkspaces: (workspaces, foldersSupported) =>
    set((state) => ({
      workspaces,
      foldersSupported: foldersSupported ?? state.foldersSupported,
    })),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setBusy: (busy) => set({ busy }),
  setMessage: (message) => set({ message }),
}));
