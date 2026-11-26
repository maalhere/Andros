import { create } from "zustand";

// ============================================================================
// ANDROS — PANEL DE PENDIENTES Y ALARMAS (Sprint 24)
// Qué muestra el desplegable del semáforo Rojo / Verde: la lista filtrada o
// la barra «+ Alarma rápida». Lo abre también la paleta de comandos (⌘K).
// ============================================================================

export type PendingPanelMode = "pending" | "done" | "new";

interface PendingState {
  mode: PendingPanelMode | null;
  setMode: (mode: PendingPanelMode | null) => void;
}

export const usePendingStore = create<PendingState>((set) => ({
  mode: null,
  setMode: (mode) => set({ mode }),
}));
