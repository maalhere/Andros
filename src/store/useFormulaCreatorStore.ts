import { create } from "zustand";

// ============================================================================
// ANDROS — DIÁLOGO «NUEVA FÓRMULA» (+ Agregar, ⌘K y el Oráculo)
// Solo guarda si está abierto: el diálogo se descarga la primera vez que se abre.
// ============================================================================

interface FormulaCreatorState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useFormulaCreatorStore = create<FormulaCreatorState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
