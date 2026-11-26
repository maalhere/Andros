// ============================================================================
// ANDROS — MICROSOFT 365 / OUTLOOK CALENDAR (funciones puras) — Sprint 19
//
//   · Nivel 1 (sin OAuth): enlace oficial de Outlook en la web
//     `…/calendar/0/deeplink/compose` prellenado. Las horas llevan el desfase
//     de la zona del navegador (p. ej. `2026-11-28T18:30:00-06:00`) para que
//     Outlook muestre la hora tal como se escribió en el tablero.
//   · Nivel 2 (Microsoft Graph): cuerpo de `POST /me/events`, normalización
//     de `GET /me/calendarview` y clasificación de errores de Graph.
// Las usan /api/calendar/microsoft/* (servidor), el modal y el script de
// verificación. Nada de aquí guarda datos.
// ============================================================================

import type { CalendarEvent } from "./extractEvents";
import { addDays, eventRange } from "./ics";
import { isSafeHttpUrl, type ExportEventInput, type ImportedCalendarEvent } from "./googleEvents";

/** Scopes pedidos a Microsoft (Supabase Azure OAuth). */
export const MICROSOFT_CALENDAR_SCOPES = "email User.Read Calendars.ReadWrite";
export const GRAPH_EVENTS_ENDPOINT = "https://graph.microsoft.com/v1.0/me/events";
export const GRAPH_CALENDAR_VIEW_ENDPOINT = "https://graph.microsoft.com/v1.0/me/calendarview";

/** Outlook en la web: cuentas de trabajo o escuela (Microsoft 365) o personales (Outlook.com). */
export type OutlookAccountKind = "work" | "personal";
export const OUTLOOK_HOSTS: Record<OutlookAccountKind, string> = {
  work: "https://outlook.office.com",
  personal: "https://outlook.live.com",
};

export type MicrosoftCalendarIssue =
  | "token_expired" // Permiso caducado o revocado: reconectar.
  | "scope_missing" // No se concedió Calendars.ReadWrite (o el inquilino lo bloquea).
  | "mailbox_unavailable" // La cuenta no tiene buzón de Exchange Online / Outlook.
  | "rate_limited"
  | "failed";

// ----------------------------------------------------------------------------
// Zonas horarias
// ----------------------------------------------------------------------------

/** Minutos que la zona `timeZone` va por delante de UTC en el instante `utcMs`. */
export function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Hora de pared `YYYY-MM-DD` + `HH:MM` en `timeZone` → ISO 8601 con desfase
 * (`2026-11-28T18:30:00+01:00`). Respeta el horario de verano de esa fecha.
 */
export function localToOffsetIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  let offset = zoneOffsetMinutes(timeZone, wall);
  const corrected = zoneOffsetMinutes(timeZone, wall - offset * 60_000);
  if (corrected !== offset) offset = corrected;
  return `${date}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00${formatOffset(offset)}`;
}

/** `YYYYMMDDTHHMMSS` (de eventRange) → `{ date, time }`. */
function splitCompact(compact: string): { date: string; time: string } {
  return {
    date: `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`,
    time: `${compact.slice(9, 11)}:${compact.slice(11, 13)}`,
  };
}

// ----------------------------------------------------------------------------
// Nivel 1: enlace «Abrir en Calendario de Microsoft» (Outlook en la web)
// ----------------------------------------------------------------------------

/** Codifica como `encodeURIComponent` (espacios → %20, «+» → %2B): Outlook no traduce «+». */
const encode = (value: string) => encodeURIComponent(value);

export function outlookCalendarLink(
  event: Pick<CalendarEvent, "title" | "description" | "date" | "startTime" | "endTime" | "allDay">,
  options: { boardLink?: string; timeZone?: string; account?: OutlookAccountKind } = {}
): string {
  const params: [string, string][] = [
    ["path", "/calendar/action/compose"],
    ["rru", "addevent"],
    ["subject", event.title],
  ];
  if (event.allDay || !event.startTime) {
    params.push(["startdt", event.date], ["enddt", addDays(event.date, 1)], ["allday", "true"]);
  } else {
    const range = eventRange(event);
    const start = splitCompact(range.start);
    const end = splitCompact(range.end);
    const tz = options.timeZone ?? "UTC";
    params.push(
      ["startdt", localToOffsetIso(start.date, start.time, tz)],
      ["enddt", localToOffsetIso(end.date, end.time, tz)],
      ["allday", "false"]
    );
  }
  const details = [event.description, options.boardLink ? `Tablero en Andros: ${options.boardLink}` : ""]
    .filter(Boolean)
    .join("\n\n");
  if (details) params.push(["body", details.slice(0, 1500)]);
  const query = params.map(([k, v]) => `${k}=${encode(v)}`).join("&");
  return `${OUTLOOK_HOSTS[options.account ?? "work"]}/calendar/0/deeplink/compose?${query}`;
}

// ----------------------------------------------------------------------------
// Nivel 2: Microsoft Graph
// ----------------------------------------------------------------------------

/**
 * Cuerpo de `POST /me/events`. Con hora: `dateTime` local + `timeZone` IANA
 * (Graph acepta zonas IANA y de Windows). Todo el día: `isAllDay` con inicio y
 * fin a medianoche (fin exclusivo) y `showAs: free`, como el .ics.
 */
export function toGraphEventBody(
  event: ExportEventInput,
  timeZone: string,
  boardLink?: string
): Record<string, unknown> {
  const content = [event.description, boardLink ? `Tablero en Andros: ${boardLink}` : ""].filter(Boolean).join("\n\n");
  const body: Record<string, unknown> = {
    subject: event.title,
    body: { contentType: "text", content },
  };
  if (event.allDay || !event.startTime) {
    body.isAllDay = true;
    body.showAs = "free";
    body.start = { dateTime: `${event.date}T00:00:00`, timeZone };
    body.end = { dateTime: `${addDays(event.date, 1)}T00:00:00`, timeZone };
  } else {
    const range = eventRange(event);
    const start = splitCompact(range.start);
    const end = splitCompact(range.end);
    body.isAllDay = false;
    body.start = { dateTime: `${start.date}T${start.time}:00`, timeZone };
    body.end = { dateTime: `${end.date}T${end.time}:00`, timeZone };
  }
  return body;
}

/** Solo enlaces https de Outlook (evita `javascript:` u otros dominios en la interfaz). */
export function isOutlookWebLink(value: unknown): value is string {
  if (!isSafeHttpUrl(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /(^|\.)(outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com)$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** `2026-11-28T17:30:00.0000000` (UTC de Graph) → ISO con «Z» que entiende `Date`. */
function graphUtcIso(dateTime: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?$/.exec(dateTime);
  return m ? `${m[1]}Z` : null;
}

/** Fecha y hora local de un instante en una zona (igual que en Google). */
function localParts(iso: string, timeZone: string): { date: string; time: string } | null {
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

/**
 * Normaliza un elemento de `calendarView` pedido en UTC
 * (`Prefer: outlook.timezone="UTC"`) a hora local de quien importa.
 * Descarta cancelados y sin fecha.
 */
export function normalizeGraphItem(raw: unknown, timeZone: string): ImportedCalendarEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.isCancelled === true) return null;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const id = text(o.id, 400);
  if (!id) return null;
  const start = (o.start ?? {}) as { dateTime?: unknown; timeZone?: unknown };
  const end = (o.end ?? {}) as { dateTime?: unknown; timeZone?: unknown };
  if (typeof start.dateTime !== "string") return null;
  const title = text(o.subject, 200) || "(Sin título)";
  const location = text((o.location as { displayName?: unknown } | undefined)?.displayName, 200) || null;
  const htmlLink = isOutlookWebLink(o.webLink) ? String(o.webLink) : null;

  if (o.isAllDay === true) {
    const date = start.dateTime.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return { id, title, date, startTime: null, endTime: null, allDay: true, location, htmlLink };
  }

  const startIso = graphUtcIso(start.dateTime);
  if (!startIso) return null;
  const from = localParts(startIso, timeZone);
  if (!from) return null;
  const endIso = typeof end.dateTime === "string" ? graphUtcIso(end.dateTime) : null;
  const to = endIso ? localParts(endIso, timeZone) : null;
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

/** Traduce un error de Graph (`{ error: { code, message } }`) a un motivo de la interfaz. */
export function classifyGraphError(status: number, json: unknown): MicrosoftCalendarIssue {
  const err = (json && typeof json === "object" ? (json as { error?: unknown }).error : null) as
    | { code?: unknown; message?: unknown }
    | null;
  const code = typeof err?.code === "string" ? err.code.toLowerCase() : "";
  const message = typeof err?.message === "string" ? err.message.toLowerCase() : "";
  if (status === 401 || code === "invalidauthenticationtoken") return "token_expired";
  if (
    code === "mailboxnotenabledforrestapi" ||
    code === "mailboxnotsupportedforrestapi" ||
    message.includes("mailbox is either inactive") ||
    message.includes("mailboxnotenabledforrestapi")
  ) {
    return "mailbox_unavailable";
  }
  if (status === 429 || code === "applicationthrottled" || code === "toomanyrequests") return "rate_limited";
  if (status === 403 || code === "erroraccessdenied" || code === "accessdenied" || code === "authorization_requestdenied") {
    return "scope_missing";
  }
  return "failed";
}
