import { create } from "zustand";
import { useSettingsStore } from "@/store/useSettingsStore";

// ============================================================================
// ANDROS — TUTORIAL GUIADO DE 4 PASOS (OnboardingTour)
// Se marca como visto en localStorage (este navegador) y en las preferencias
// del usuario (`profiles.preferences.onboardingDone` vía useSettingsSync).
// ============================================================================

export const ONBOARDING_STORAGE_KEY = "andros:onboarding:v1";
export const ONBOARDING_STEP_COUNT = 4;

/** ¿Ya terminó o saltó el tutorial en este navegador o en su cuenta? */
export function hasSeenOnboarding(): boolean {
  if (useSettingsStore.getState().onboardingDone) return true;
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

interface OnboardingState {
  open: boolean;
  step: number;
  /** Abre el tutorial desde el paso 1 (automático o desde "Ver tutorial"). */
  start: () => void;
  next: () => void;
  back: () => void;
  /** Cierra el tutorial y lo guarda como completado o saltado. */
  finish: (outcome: "completed" | "skipped") => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  open: false,
  step: 0,

  start: () => set({ open: true, step: 0 }),

  next: () => {
    const { step } = get();
    if (step >= ONBOARDING_STEP_COUNT - 1) {
      get().finish("completed");
      return;
    }
    set({ step: step + 1 });
  },

  back: () => set((s) => ({ step: Math.max(0, s.step - 1) })),

  finish: (outcome) => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, outcome);
    } catch {
      // Navegación privada / almacenamiento bloqueado: queda en preferencias.
    }
    // useSettingsSync lo guarda en localStorage y en Supabase (si hay sesión).
    useSettingsStore.setState({ onboardingDone: true });
    set({ open: false, step: 0 });
  },
}));
