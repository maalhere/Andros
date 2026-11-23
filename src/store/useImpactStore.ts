import { create } from "zustand";
import type { ImpactAlertEntry } from "@/lib/canvas/impact";

// ============================================================================
// ANDROS — ALERTAS "ANTI-MALENTENDIDOS" DEL ESPACIO (solo sesión)
//
// · `alerts`: descuadres activos (propios o recibidos de la sala en vivo).
//   `canvasSync` emite cada alta/baja local como `alert:upsert` /
//   `alert:resolve`; lo que llega de la sala se aplica con `runAsRemoteCollab`
//   para no re-emitirlo (sin bucles).
// · `pending`: tarjetas con un cambio importante aún sin revisar (guarda el
//   texto ANTES del primer cambio, para juntar varias ediciones seguidas).
// · `checking`: revisiones en curso (evita llamadas duplicadas).
// ============================================================================

export interface PendingImpact {
  before: string;
  after: string;
  /** Marca del último cambio: si cambia durante la revisión, queda pendiente. */
  at: number;
}

interface ImpactState {
  alerts: ImpactAlertEntry[];
  pending: Record<string, PendingImpact>;
  checking: Record<string, true>;
  panelOpen: boolean;
  /** Alerta resaltada en el panel (al tocar el aviso de una tarjeta). */
  highlightedAlertId: string | null;

  markPending: (nodeId: string, before: string, after: string) => void;
  clearPending: (nodeId: string, at?: number) => void;
  setChecking: (nodeId: string, value: boolean) => void;
  /** Sustituye las alertas que provocó `sourceNodeId` por las nuevas. */
  replaceForSource: (sourceNodeId: string, next: ImpactAlertEntry[]) => void;
  upsertAlert: (alert: ImpactAlertEntry) => void;
  resolveAlert: (id: string) => void;
  setPanelOpen: (open: boolean, highlightedAlertId?: string | null) => void;
}

export const useImpactStore = create<ImpactState>((set) => ({
  alerts: [],
  pending: {},
  checking: {},
  panelOpen: false,
  highlightedAlertId: null,

  markPending: (nodeId, before, after) =>
    set((s) => {
      const previous = s.pending[nodeId];
      const origin = previous?.before ?? before;
      // Volvió exactamente a como estaba: ya no hay nada que revisar.
      if (origin === after) {
        if (!previous) return {};
        const pending = { ...s.pending };
        delete pending[nodeId];
        return { pending };
      }
      return { pending: { ...s.pending, [nodeId]: { before: origin, after, at: Date.now() } } };
    }),

  clearPending: (nodeId, at) =>
    set((s) => {
      const current = s.pending[nodeId];
      if (!current || (at !== undefined && current.at !== at)) return {};
      const pending = { ...s.pending };
      delete pending[nodeId];
      return { pending };
    }),

  setChecking: (nodeId, value) =>
    set((s) => {
      if (Boolean(s.checking[nodeId]) === value) return {};
      const checking = { ...s.checking };
      if (value) checking[nodeId] = true;
      else delete checking[nodeId];
      return { checking };
    }),

  replaceForSource: (sourceNodeId, next) =>
    set((s) => {
      const kept = s.alerts.filter((a) => a.sourceNodeId !== sourceNodeId);
      if (kept.length === s.alerts.length && next.length === 0) return {};
      return { alerts: [...next, ...kept] };
    }),

  upsertAlert: (alert) =>
    set((s) => {
      const index = s.alerts.findIndex((a) => a.id === alert.id);
      if (index === -1) return { alerts: [alert, ...s.alerts] };
      const alerts = [...s.alerts];
      alerts[index] = alert;
      return { alerts };
    }),

  resolveAlert: (id) =>
    set((s) => {
      if (!s.alerts.some((a) => a.id === id)) return {};
      const alerts = s.alerts.filter((a) => a.id !== id);
      return {
        alerts,
        highlightedAlertId: s.highlightedAlertId === id ? null : s.highlightedAlertId,
        panelOpen: alerts.length > 0 && s.panelOpen,
      };
    }),

  setPanelOpen: (panelOpen, highlightedAlertId = null) => set({ panelOpen, highlightedAlertId }),
}));
