import { create } from "zustand";

// ============================================================================
// ANDROS — ESTADO DE «CALENDARIOS EXTERNOS» (Sprint 16 Google · Sprint 19 Microsoft)
// Lo escriben el menú ⋯, la barra superior, la paleta ⌘K, el botón de
// calendario de cada tarjeta y los clientes `googleCalendarClient` /
// `microsoftCalendarClient` (tokens temporales). Lo lee CalendarSyncModal.
// ============================================================================

interface CalendarState {
  open: boolean;
  /** Tarjeta enfocada al abrir desde su botón (`null` = todo el espacio). */
  focusNodeId: string | null;
  /** Hay un permiso de Google Calendar vigente en esta pestaña. */
  connected: boolean;
  /** Caducidad local del permiso de Google (ms desde epoch) o `null`. */
  expiresAt: number | null;
  /** Hay un permiso de Microsoft Graph (Calendars.ReadWrite) vigente en esta pestaña. */
  msConnected: boolean;
  /** Caducidad local del permiso de Microsoft o `null`. */
  msExpiresAt: number | null;

  openModal: (nodeId?: string | null) => void;
  close: () => void;
  setFocusNode: (nodeId: string | null) => void;
  setConnection: (expiresAt: number | null) => void;
  setMicrosoftConnection: (expiresAt: number | null) => void;
}

export const useCalendarStore = create<CalendarState>((set) => ({
  open: false,
  focusNodeId: null,
  connected: false,
  expiresAt: null,
  msConnected: false,
  msExpiresAt: null,

  openModal: (nodeId = null) => set({ open: true, focusNodeId: nodeId }),
  close: () => set({ open: false }),
  setFocusNode: (focusNodeId) => set({ focusNodeId }),
  setConnection: (expiresAt) => set({ connected: expiresAt !== null && expiresAt > Date.now(), expiresAt }),
  setMicrosoftConnection: (msExpiresAt) =>
    set({ msConnected: msExpiresAt !== null && msExpiresAt > Date.now(), msExpiresAt }),
}));
