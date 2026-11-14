import { create } from "zustand";

// ============================================================================
// ANDROS — ESTADO DE LA NUBE (sesión de Google + sincronización con Supabase)
// Lo escribe `useCloudSync` y lo lee `GoogleAuthButton`.
// ============================================================================

export type CloudStatus =
  | "disabled" // Falta `.env.local`: la app trabaja solo en local.
  | "signed-out" // Supabase listo, pero nadie ha iniciado sesión.
  | "connecting" // Comprobando la sesión o redirigiendo a Google.
  | "loading" // Descargando el lienzo guardado.
  | "saving" // Enviando cambios.
  | "saved" // Todo está guardado en la nube.
  | "error"; // El último guardado falló (se reintenta con el siguiente cambio).

export interface CloudUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

interface CloudState {
  status: CloudStatus;
  user: CloudUser | null;
  workspaceId: string | null;
  /** Archivos de `file-node` que se están subiendo al bucket ahora mismo. */
  pendingUploads: number;
  errorMessage: string | null;

  setStatus: (status: CloudStatus, errorMessage?: string | null) => void;
  setUser: (user: CloudUser | null) => void;
  setWorkspaceId: (id: string | null) => void;
  changePendingUploads: (delta: number) => void;
  clearError: () => void;
}

export const useCloudStore = create<CloudState>((set) => ({
  status: "connecting",
  user: null,
  workspaceId: null,
  pendingUploads: 0,
  errorMessage: null,

  setStatus: (status, errorMessage) =>
    set((state) => ({
      status,
      errorMessage: errorMessage === undefined ? state.errorMessage : errorMessage,
    })),
  setUser: (user) => set({ user }),
  setWorkspaceId: (workspaceId) => set({ workspaceId }),
  changePendingUploads: (delta) =>
    set((state) => ({ pendingUploads: Math.max(0, state.pendingUploads + delta) })),
  clearError: () => set({ errorMessage: null }),
}));
