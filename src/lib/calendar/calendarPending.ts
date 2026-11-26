// ============================================================================
// ANDROS — CONEXIÓN DE CALENDARIO PENDIENTE (Google o Microsoft) — Sprint 19
//
// Al pulsar «Conectar …» se sale al proveedor (Google o Microsoft) y se
// vuelve a /?calendario=1. Este marcador (localStorage, 10 min) recuerda QUÉ
// proveedor se pidió, para que el `provider_token` efímero de la sesión se
// asigne al calendario correcto. Solo guarda el nombre del proveedor y la
// hora: nunca el token.
// ============================================================================

export type CalendarProvider = "google" | "microsoft";

const PENDING_KEY = "andros.calendar.pending";
const PENDING_TTL_MS = 10 * 60_000;

/** Parámetro con el que /auth/callback devuelve al lienzo tras conectar. */
export const CALENDAR_RETURN_PARAM = "calendario";

/**
 * Forma aceptable de un token de acceso de proveedor (Google `ya29.…`,
 * Microsoft JWT `eyJ…` o token de cuenta personal `EwB…`). Solo caracteres
 * seguros para una cabecera HTTP; el contenido lo valida el proveedor.
 */
export function isPlausibleProviderToken(value: unknown): value is string {
  return typeof value === "string" && /^[\w.~+/=!*-]{20,12000}$/.test(value);
}

export function markCalendarPending(provider: CalendarProvider): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ provider, at: Date.now() }));
  } catch {
    /* sin almacenamiento: al volver no se asignará el token (se puede reconectar) */
  }
}

/** Lee y borra el marcador. Devuelve el proveedor si sigue vigente. */
export function takeCalendarPending(): CalendarProvider | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    // Formato anterior (Sprint 16): solo la hora → era Google.
    if (/^\d+$/.test(raw)) return Date.now() - Number(raw) < PENDING_TTL_MS ? "google" : null;
    const parsed = JSON.parse(raw) as { provider?: unknown; at?: unknown };
    const fresh = typeof parsed.at === "number" && Date.now() - parsed.at < PENDING_TTL_MS;
    if (!fresh) return null;
    return parsed.provider === "microsoft" ? "microsoft" : parsed.provider === "google" ? "google" : null;
  } catch {
    return null;
  }
}
