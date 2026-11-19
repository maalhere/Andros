// ============================================================================
// ANDROS — CONSENTIMIENTO DE COOKIES (localStorage)
//   · "necessary": solo lo imprescindible (sesión de Supabase, preferencias).
//   · "all": además, analítica opcional (si algún día se configura).
// Sin elección guardada = solo necesarias (nada opcional se carga antes).
// ============================================================================

export type ConsentChoice = "necessary" | "all";

export interface ConsentRecord {
  version: 1;
  choice: ConsentChoice;
  /** ISO 8601: cuándo se dio el consentimiento (prueba de consentimiento). */
  decidedAt: string;
}

const STORAGE_KEY = "andros-cookie-consent";
const CHANGE_EVENT = "andros:consent-change";
const OPEN_EVENT = "andros:open-cookie-preferences";

export function readConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    if (parsed.version !== 1 || (parsed.choice !== "necessary" && parsed.choice !== "all")) return null;
    return parsed as ConsentRecord;
  } catch {
    return null;
  }
}

export function saveConsent(choice: ConsentChoice): void {
  const record: ConsentRecord = { version: 1, choice, decidedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Almacenamiento bloqueado (modo privado): la elección vale solo esta sesión.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: record }));
}

/** `true` solo si la persona aceptó explícitamente la analítica opcional. */
export const hasAnalyticsConsent = () => readConsent()?.choice === "all";

/** Suscripción para useSyncExternalStore (cambios en esta pestaña y en otras). */
export function subscribeConsent(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Vuelve a mostrar el banner para cambiar la elección (enlace «Preferencias de cookies»). */
export const openCookiePreferences = () => window.dispatchEvent(new Event(OPEN_EVENT));

export function subscribeOpenPreferences(onOpen: () => void): () => void {
  window.addEventListener(OPEN_EVENT, onOpen);
  return () => window.removeEventListener(OPEN_EVENT, onOpen);
}
