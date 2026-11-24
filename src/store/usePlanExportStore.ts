import { create } from "zustand";

// ============================================================================
// ANDROS — ESTUDIO DE EXPORTACIÓN (antes «Exportar Plan del Día»): abierto / cerrado
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
