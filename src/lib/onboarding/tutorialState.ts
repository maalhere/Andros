// ============================================================================
// ANDROS — ESTADO DEL TUTORIAL DE INICIO POR CUENTA (funciones puras) — Sprint 24
// Cada cuenta tiene su propio estado (no el del navegador):
//   · localStorage `andros:tutorial:v2:<user.id>` = "completed" | "skipped".
//   · Supabase `profiles.preferences.tutorial` = { status, at } (lo sincroniza
//     useSettingsSync), para que no dependa de un solo navegador.
// Una cuenta nueva (sin estado en ninguno de los dos) lo ve sola al entrar a su
// espacio; al completarlo u omitirlo deja de salir, y siempre se puede repetir
// a mano («Ver tutorial de inicio» en ⋯, en la ayuda y en ⌘K).
// ============================================================================

export type TutorialStatus = "completed" | "skipped";

export const TUTORIAL_STEP_COUNT = 5;
export const TUTORIAL_KEY_PREFIX = "andros:tutorial:v2:";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function tutorialStorageKey(userId: string | null): string {
  return `${TUTORIAL_KEY_PREFIX}${userId || "local"}`;
}

/** Estado válido o `null` (acepta "completed", "skipped" o { status }). */
export function sanitizeTutorialStatus(raw: unknown): TutorialStatus | null {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).status : raw;
  return value === "completed" || value === "skipped" ? value : null;
}

export function readTutorialStatus(storage: KeyValueStorage | null, userId: string | null): TutorialStatus | null {
  if (!storage) return null;
  try {
    return sanitizeTutorialStatus(storage.getItem(tutorialStorageKey(userId)));
  } catch {
    return null;
  }
}

/** Guarda (o borra con `null`) el estado de esta cuenta en este navegador. */
export function writeTutorialStatus(storage: KeyValueStorage | null, userId: string | null, status: TutorialStatus | null): void {
  if (!storage) return;
  try {
    if (status) storage.setItem(tutorialStorageKey(userId), status);
    else storage.removeItem(tutorialStorageKey(userId));
  } catch {
    // Navegación privada / almacenamiento lleno: queda en la nube.
  }
}

export interface AutoStartInput {
  userId: string | null;
  /** Estado guardado en este navegador para esta cuenta. */
  local: TutorialStatus | null;
  /** Estado de la nube; `undefined` mientras todavía no se leyó. */
  remote: TutorialStatus | null | undefined;
  /** `false` si no hay Supabase configurado (solo cuenta lo local). */
  cloud: boolean;
}

/**
 * ¿Lanzar solo el tutorial? Solo a cuentas con sesión que no lo completaron
 * ni omitieron (ni aquí ni en la nube). Con nube, espera a haberla leído para
 * no mostrárselo otra vez a quien ya lo hizo en otro dispositivo.
 */
export function shouldAutoStartTutorial(input: AutoStartInput): boolean {
  if (!input.userId) return false;
  if (input.local) return false;
  if (input.cloud && input.remote === undefined) return false;
  return !input.remote;
}

/** Valor que se guarda en `profiles.preferences.tutorial`. */
export function tutorialPreference(status: TutorialStatus, at: string): { status: TutorialStatus; at: string } {
  return { status, at };
}

// ----------------------------------------------------------------------------
// Máquina de estados del recorrido (la usa el store; sin efectos)
// ----------------------------------------------------------------------------

export interface TutorialMachine {
  open: boolean;
  step: number;
  status: TutorialStatus | null;
}

export type TutorialAction =
  | { type: "start" }
  | { type: "next" }
  | { type: "back" }
  | { type: "finish"; outcome: TutorialStatus }
  /** Olvida el estado: vuelve a contar como cuenta nueva. */
  | { type: "reset" };

export const INITIAL_TUTORIAL: TutorialMachine = { open: false, step: 0, status: null };

export function tutorialReducer(state: TutorialMachine, action: TutorialAction): TutorialMachine {
  switch (action.type) {
    case "start":
      return { ...state, open: true, step: 0 };
    case "next":
      if (!state.open) return state;
      if (state.step >= TUTORIAL_STEP_COUNT - 1) return { open: false, step: 0, status: "completed" };
      return { ...state, step: state.step + 1 };
    case "back":
      return state.open ? { ...state, step: Math.max(0, state.step - 1) } : state;
    case "finish":
      return { open: false, step: 0, status: action.outcome };
    case "reset":
      return { ...INITIAL_TUTORIAL };
  }
}
