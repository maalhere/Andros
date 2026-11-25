import { create } from "zustand";

// ============================================================================
// ANDROS — ESTADO DE «GOOGLE CALENDAR» (Sprint 16)
// Lo escriben el menú ⋯, la paleta ⌘K, el botón de calendario de cada tarjeta
// y `googleCalendarClient` (token temporal). Lo lee CalendarSyncModal.
// ============================================================================

interface CalendarState {
  open: boolean;
  /** Tarjeta enfocada al abrir desde su botón (`null` = todo el espacio). */
  focusNodeId: string | null;
  /** Hay un permiso de Google Calendar vigente en esta pestaña. */
  connected: boolean;
  /** Caducidad local del permiso (ms desde epoch) o `null`. */
  expiresAt: number | null;

  openModal: (nodeId?: string | null) => void;
  close: () => void;
  setFocusNode: (nodeId: string | null) => void;
  setConnection: (expiresAt: number | null) => void;
}

export const useCalendarStore = create<CalendarState>((set) => ({
  open: false,
  focusNodeId: null,
  connected: false,
  expiresAt: null,

  openModal: (nodeId = null) => set({ open: true, focusNodeId: nodeId }),
  close: () => set({ open: false }),
  setFocusNode: (focusNodeId) => set({ focusNodeId }),
  setConnection: (expiresAt) => set({ connected: expiresAt !== null && expiresAt > Date.now(), expiresAt }),
}));
