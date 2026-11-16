import { create } from "zustand";

// ============================================================================
// ANDROS — ESTADO DE LA LANDING PAGE
//   · "landing"   → se muestra la portada con el logo mutante.
//   · "igniting"  → transición de ignición: el logo vuela a la barra superior.
//   · "workspace" → lienzo de trabajo normal.
// La primera visita abre la landing; después se entra directo al lienzo.
// Pulsar el logo de la barra superior vuelve a abrirla.
// ============================================================================

export type LandingPhase = "landing" | "igniting" | "workspace";

const SEEN_KEY = "andros:landing-seen";

function readInitialPhase(): LandingPhase {
  if (typeof window === "undefined") return "landing";
  try {
    return window.localStorage.getItem(SEEN_KEY) ? "workspace" : "landing";
  } catch {
    return "landing";
  }
}

interface LandingState {
  phase: LandingPhase;
  openLanding: () => void;
  startIgnition: () => void;
  finishIgnition: () => void;
}

export const useLandingStore = create<LandingState>((set) => ({
  phase: readInitialPhase(),

  openLanding: () => set({ phase: "landing" }),

  startIgnition: () => set({ phase: "igniting" }),

  finishIgnition: () => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Navegación privada / almacenamiento bloqueado: no pasa nada.
    }
    set({ phase: "workspace" });
  },
}));
