import { create } from "zustand";
import type { ThemeMode } from "@/types/workspace";

// ============================================================================
// ANDROS — AJUSTES DE COMODIDAD (Quality of Life)
// Se guardan en localStorage (sin cuenta) y en `profiles.preferences`
// (Supabase) cuando hay sesión. Lo sincroniza `useSettingsSync`.
// El tema Día/Noche vive en `useWorkspaceStore`; aquí solo se empaqueta.
// ============================================================================

export type CableStyle = "bezier" | "orthogonal" | "straight";
export type CanvasBackground = "dots" | "grid" | "plain";
export type AnimationLevel = "full" | "reduced";
export type AutosaveMode = "instant" | "moderate";

export interface Preferences {
  theme: ThemeMode;
  snapToGrid: boolean;
  cableStyle: CableStyle;
  canvasBackground: CanvasBackground;
  animations: AnimationLevel;
  autosave: AutosaveMode;
  /** `true` cuando el usuario terminó o saltó el tutorial guiado de 5 pasos. */
  onboardingDone: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  snapToGrid: false,
  cableStyle: "bezier",
  canvasBackground: "dots",
  animations: "full",
  autosave: "instant",
  onboardingDone: false,
};

/** Tamaño del imán de alineación (igual que la retícula del lienzo). */
export const SNAP_GRID_SIZE = 28;

export const AUTOSAVE_DELAY_MS: Record<AutosaveMode, number> = {
  instant: 1200,
  moderate: 5000,
};

/** Limpia datos desconocidos (localStorage o nube) y descarta lo inválido. */
export function sanitizePreferences(raw: unknown): Partial<Preferences> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Preferences> = {};
  if (r.theme === "light" || r.theme === "dark") out.theme = r.theme;
  if (typeof r.snapToGrid === "boolean") out.snapToGrid = r.snapToGrid;
  if (r.cableStyle === "bezier" || r.cableStyle === "orthogonal" || r.cableStyle === "straight")
    out.cableStyle = r.cableStyle;
  if (r.canvasBackground === "dots" || r.canvasBackground === "grid" || r.canvasBackground === "plain")
    out.canvasBackground = r.canvasBackground;
  if (r.animations === "full" || r.animations === "reduced") out.animations = r.animations;
  if (r.autosave === "instant" || r.autosave === "moderate") out.autosave = r.autosave;
  if (typeof r.onboardingDone === "boolean") out.onboardingDone = r.onboardingDone;
  return out;
}

type SettingsValues = Omit<Preferences, "theme">;

interface SettingsState extends SettingsValues {
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  /** Aplica varios ajustes a la vez (ignora `theme`, que vive en el workspace). */
  applyPreferences: (prefs: Partial<Preferences>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  snapToGrid: DEFAULT_PREFERENCES.snapToGrid,
  cableStyle: DEFAULT_PREFERENCES.cableStyle,
  canvasBackground: DEFAULT_PREFERENCES.canvasBackground,
  animations: DEFAULT_PREFERENCES.animations,
  autosave: DEFAULT_PREFERENCES.autosave,
  onboardingDone: DEFAULT_PREFERENCES.onboardingDone,
  modalOpen: false,
  setModalOpen: (modalOpen) => set({ modalOpen }),
  applyPreferences: (prefs) => {
    const rest: Partial<Preferences> = { ...prefs };
    delete rest.theme;
    // El tutorial, una vez visto en cualquier dispositivo, no vuelve a salir solo.
    if (rest.onboardingDone === false) delete rest.onboardingDone;
    set(rest);
  },
}));
