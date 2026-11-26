import { create } from "zustand";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  INITIAL_TUTORIAL,
  TUTORIAL_STEP_COUNT,
  readTutorialStatus,
  tutorialReducer,
  writeTutorialStatus,
  type KeyValueStorage,
  type TutorialAction,
  type TutorialStatus,
} from "@/lib/onboarding/tutorialState";

// ============================================================================
// ANDROS — TUTORIAL DE INICIO DE 5 PASOS (OnboardingTour) — Sprint 24
// Estado POR CUENTA: localStorage `andros:tutorial:v2:<user.id>` y
// `profiles.preferences.tutorial` en Supabase (lo lee y sube useSettingsSync).
// La lógica de cuándo lanzarlo vive en `src/lib/onboarding/tutorialState.ts`.
// ============================================================================

/** Clave antigua (v1, por navegador): sigue sirviendo para quien no tiene sesión. */
export const ONBOARDING_STORAGE_KEY = "andros:onboarding:v1";
export const ONBOARDING_STEP_COUNT = TUTORIAL_STEP_COUNT;

function storage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Sin sesión: ¿ya terminó o saltó el tutorial en este navegador? */
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
  /** Cuenta a la que pertenece el estado (`null` = sin sesión). */
  userId: string | null;
  /** Estado de esta cuenta (local o nube). */
  status: TutorialStatus | null;
  /** Lo guardado en la nube; `undefined` mientras no se ha leído. */
  remoteStatus: TutorialStatus | null | undefined;
  /** Momento del último cambio de estado (ISO), para la nube. */
  statusAt: string | null;

  /** Abre el tutorial desde el paso 1 (automático o desde «Ver tutorial de inicio»). */
  start: () => void;
  next: () => void;
  back: () => void;
  /** Cierra el tutorial y lo guarda como completado u omitido. */
  finish: (outcome: TutorialStatus) => void;
  /** Cambio de cuenta: lee el estado local de la nueva. */
  bindUser: (userId: string | null) => void;
  /** Resultado de leer `profiles.preferences.tutorial` para `userId`. */
  setRemoteStatus: (userId: string, status: TutorialStatus | null) => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => {
  const persist = (status: TutorialStatus | null) => {
    const { userId } = get();
    writeTutorialStatus(storage(), userId, status);
    if (status) {
      try {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEY, status);
      } catch {
        // Sin almacenamiento: queda en preferencias.
      }
      // Compatibilidad: preferencia antigua (quien no tiene sesión).
      useSettingsStore.setState({ onboardingDone: true });
    }
  };

  const dispatch = (action: TutorialAction) => {
    const before = get();
    const next = tutorialReducer({ open: before.open, step: before.step, status: before.status }, action);
    const changed = next.status !== before.status;
    set({ open: next.open, step: next.step, status: next.status, ...(changed ? { statusAt: new Date().toISOString() } : {}) });
    if (changed) persist(next.status);
  };

  return {
    ...INITIAL_TUTORIAL,
    userId: null,
    remoteStatus: undefined,
    statusAt: null,

    start: () => dispatch({ type: "start" }),
    next: () => dispatch({ type: "next" }),
    back: () => dispatch({ type: "back" }),
    finish: (outcome) => dispatch({ type: "finish", outcome }),

    bindUser: (userId) => {
      if (get().userId === userId && get().remoteStatus !== undefined) return;
      set({ userId, status: readTutorialStatus(storage(), userId), remoteStatus: undefined, statusAt: null });
    },

    setRemoteStatus: (userId, status) => {
      if (get().userId !== userId) return;
      const local = get().status;
      set({ remoteStatus: status, ...(status && !local ? { status } : {}) });
      // Lo hecho en otro dispositivo también vale aquí.
      if (status && !local) writeTutorialStatus(storage(), userId, status);
    },
  };
});
