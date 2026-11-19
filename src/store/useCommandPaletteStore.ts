import { create } from "zustand";

// ============================================================================
// ANDROS — ESTADO DE LA PALETA DE COMANDOS (⌘K / Ctrl+K)
// ============================================================================

interface CommandPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
