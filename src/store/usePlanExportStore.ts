import { create } from "zustand";

// ============================================================================
// ANDROS — MODAL «EXPORTAR PLAN DEL DÍA» (abierto / cerrado)
// Se abre desde ⋯ Más opciones, la paleta ⌘K y «Compartir espacio».
// ============================================================================

interface PlanExportState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const usePlanExportStore = create<PlanExportState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
