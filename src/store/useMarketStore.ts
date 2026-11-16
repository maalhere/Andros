import { create } from "zustand";

// ============================================================================
// ANDROS — VENTANAS DE ARENA (concursos y empleos) Y SUSCRIPCIONES
// Solo guarda si cada ventana está abierta; los datos viven en Supabase.
// ============================================================================

interface MarketState {
  arenaOpen: boolean;
  upgradeOpen: boolean;
  setArenaOpen: (open: boolean) => void;
  setUpgradeOpen: (open: boolean) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  arenaOpen: false,
  upgradeOpen: false,
  setArenaOpen: (arenaOpen) => set({ arenaOpen }),
  setUpgradeOpen: (upgradeOpen) => set({ upgradeOpen }),
}));
