import { create } from "zustand";

// ============================================================================
// ANDROS — VENTANAS DE ARENA (concursos y empleos) Y SUSCRIPCIONES
// Solo guarda si cada ventana está abierta; los datos viven en Supabase.
// ============================================================================

interface MarketState {
  arenaOpen: boolean;
  upgradeOpen: boolean;
  /**
   * (Sprint 21) Motivo por el que se abrió el modal de planes al tocar un
   * límite del Plan Básico («Tu plan permite 2 espacios…»). `null` si se
   * abrió a mano desde el menú.
   */
  upgradeReason: string | null;
  /** Lista de espera / aviso cuando abran los pagos de Andros Pro. */
  waitlistOpen: boolean;
  setArenaOpen: (open: boolean) => void;
  setUpgradeOpen: (open: boolean) => void;
  /** Abre el modal de planes explicando qué límite se alcanzó. */
  openUpgrade: (reason?: string | null) => void;
  setWaitlistOpen: (open: boolean) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  arenaOpen: false,
  upgradeOpen: false,
  upgradeReason: null,
  waitlistOpen: false,
  setArenaOpen: (arenaOpen) => set({ arenaOpen }),
  setUpgradeOpen: (upgradeOpen) => set(upgradeOpen ? { upgradeOpen } : { upgradeOpen, upgradeReason: null }),
  openUpgrade: (reason = null) => set({ upgradeOpen: true, upgradeReason: reason }),
  setWaitlistOpen: (waitlistOpen) => set({ waitlistOpen }),
}));
