import { create } from "zustand";

// ============================================================================
// ANDROS — ESTADO DE LA LANDING PAGE
//   · "landing"   → se muestra la portada pública.
//   · "igniting"  → transición de entrada: la marca vuela a la barra superior.
//   · "workspace" → lienzo de trabajo normal.
//
// Regla de entrada:
//   · Sin sesión de Google → SIEMPRE se entra por la portada.
//   · Con sesión activa    → se salta la portada y se abre el lienzo directo
//                            (lo decide `LandingOverlay` al detectar el usuario).
//   · Pulsar el logo de la barra superior vuelve a abrirla a propósito
//     (`manual: true`), y entonces NO se cierra sola aunque haya sesión.
// ============================================================================

export type LandingPhase = "landing" | "igniting" | "workspace";

interface LandingState {
  phase: LandingPhase;
  /** `true` si la portada la abrió el usuario desde el logo (no se auto-cierra). */
  manual: boolean;
  /** Abre la portada a petición del usuario (logo de la barra superior). */
  openLanding: () => void;
  /** Vuelve a la portada de entrada (p. ej. al cerrar sesión). */
  resetToLanding: () => void;
  startIgnition: () => void;
  finishIgnition: () => void;
  /** Entra al lienzo sin animación (sesión de Google ya activa). */
  skipToWorkspace: () => void;
}

export const useLandingStore = create<LandingState>((set) => ({
  phase: "landing",
  manual: false,

  openLanding: () => set({ phase: "landing", manual: true }),

  resetToLanding: () => set({ phase: "landing", manual: false }),

  startIgnition: () => set({ phase: "igniting" }),

  finishIgnition: () => set({ phase: "workspace", manual: false }),

  skipToWorkspace: () => set({ phase: "workspace", manual: false }),
}));
