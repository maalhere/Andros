import { create } from "zustand";

// ============================================================================
// ANDROS — ESTADO DE LA GUÍA DE ATAJOS Y FLUJOS (tecla «?»)
// ============================================================================

export type ShortcutsGuideTab = "shortcuts" | "ai";

interface ShortcutsGuideState {
  open: boolean;
  tab: ShortcutsGuideTab;
  openGuide: (tab?: ShortcutsGuideTab) => void;
  closeGuide: () => void;
  setTab: (tab: ShortcutsGuideTab) => void;
}

export const useShortcutsGuideStore = create<ShortcutsGuideState>((set) => ({
  open: false,
  tab: "shortcuts",
  openGuide: (tab = "shortcuts") => set({ open: true, tab }),
  closeGuide: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
}));
