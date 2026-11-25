// ============================================================================
// ANDROS — GOOGLE CALENDAR API: VALIDACIÓN, CUERPOS Y ERRORES (funciones puras)
// Las usan /api/calendar/export y /api/calendar/import (servidor) y el
// script de verificación. Nada de aquí guarda datos: los eventos viajan del
// navegador a Google (o de Google al navegador) a través de la ruta.
// ============================================================================

import { eventRange, addDays } from "./ics";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
export const MAX_EXPORT_EVENTS = 25;
export const IMPORT_WINDOW_DAYS = 14;

/** Evento que el navegador pide crear (ya extraído del tablero). */
export interface ExportEventInput {
  id: string;
  title: string;
  description: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
}

/** Evento leído de Google, en hora local de quien importa. */
export interface ImportedCalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
}

export type GoogleCalendarIssue =
  | "token_expired" // El permiso caducó o se revocó: hay que reconectar.
  | "api_disabled" // Google Calendar API no está habilitada en el proyecto OAuth.
  | "scope_missing" // Se inició sesión sin aceptar el permiso de calendario.
  | "rate_limited"
  | "failed";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Valida y recorta un evento recibido del navegador (o `null` si no sirve). */
export function sanitizeExportEvent(raw: unknown): ExportEventInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const id = text(o.id, 160);
  const title = text(o.title, 200);
  const date = text(o.date, 10);
  if (!id || !title || !DATE.test(date)) return null;
  const startTime = typeof o.startTime === "string" && TIME.test(o.startTime) ? o.startTime : null;
  const endTime = startTime && typeof o.endTime === "string" && TIME.test(o.endTime) ? o.endTime : null;
  return {
    id,
    title,
    description: text(o.description, 2000),
    date,
    startTime,
    endTime,
    allDay: !startTime,
  };
}

const isoFromCompact = (compact: string) =>
  `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}`;

/** Cuerpo de `events.insert` (todo el día con `date`; con hora, `dateTime` + `timeZone`). */
export function toGoogleEventBody(
  event: ExportEventInput,
  timeZone: string,
  boardLink?: string
): Record<string, unknown> {
  const description = [event.description, boardLink ? `Tablero en Andros: ${boardLink}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const body: Record<string, unknown> = { summary: event.title, description };
  if (event.allDay || !event.startTime) {
    body.start = { date: event.date };
    body.end = { date: addDays(event.date, 1) };
  } else {
    const range = eventRange(event);
    body.start = { dateTime: isoFromCompact(range.start), timeZone };
    body.end = { dateTime: isoFromCompact(range.end), timeZone };
  }
  if (boardLink) body.source = { title: "Andros", url: boardLink };
  return body;
}

/** Traduce la respuesta de error de Google a un motivo que la interfaz entiende. */
export function classifyGoogleError(status: number, json: unknown): GoogleCalendarIssue {
  const err = (json && typeof json === "object" ? (json as { error?: unknown }).error : null) as
    | { status?: string; message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] }
    | null;
  const reasons = [
    err?.status,
    ...(err?.errors ?? []).map((e) => e.reason),
    ...(err?.details ?? []).map((d) => d.reason),
  ]
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.toLowerCase());
  const message = (err?.message ?? "").toLowerCase();
  if (status === 401) return "token_expired";
  if (
    reasons.some((r) => r === "accessnotconfigured" || r === "service_disabled") ||
    message.includes("has not been used") ||
    message.includes("is disabled")
  ) {
    return "api_disabled";
  }
  if (reasons.some((r) => r === "insufficientpermissions" || r === "access_token_scope_insufficient")) {
    return "scope_missing";
  }
  if (status === 429 || reasons.some((r) => r === "ratelimitexceeded" || r === "userratelimitexceeded")) {
    return "rate_limited";
  }
  if (status === 403) return "scope_missing";
  return "failed";
}

/** Fecha y hora local (`YYYY-MM-DD`, `HH:MM`) de un instante en una zona. */
export function localParts(iso: string, timeZone: string): { date: string; time: string } | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Normaliza un `items[]` de `events.list` (descarta cancelados y sin fecha). */
export function normalizeGoogleItem(raw: unknown, timeZone: string): ImportedCalendarEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.status === "cancelled") return null;
  const start = (o.start ?? {}) as { date?: unknown; dateTime?: unknown };
  const end = (o.end ?? {}) as { date?: unknown; dateTime?: unknown };
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const id = text(o.id, 200);
  if (!id) return null;
  const title = text(o.summary, 200) || "(Sin título)";
  const location = text(o.location, 200) || null;
  const htmlLink = isSafeHttpUrl(o.htmlLink) && String(o.htmlLink).startsWith("https://") ? String(o.htmlLink) : null;

  if (typeof start.date === "string" && DATE.test(start.date)) {
    return { id, title, date: start.date, startTime: null, endTime: null, allDay: true, location, htmlLink };
  }
  if (typeof start.dateTime !== "string") return null;
  const from = localParts(start.dateTime, timeZone);
  if (!from) return null;
  const to = typeof end.dateTime === "string" ? localParts(end.dateTime, timeZone) : null;
  return {
    id,
    title,
    date: from.date,
    startTime: from.time,
    endTime: to && to.date === from.date ? to.time : null,
    allDay: false,
    location,
    htmlLink,
  };
}
