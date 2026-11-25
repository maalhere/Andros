// ============================================================================
// ANDROS — ARCHIVO .ICS Y ENLACE «AÑADIR A GOOGLE CALENDAR» (funciones puras)
//
// `.ics` (RFC 5545, iCalendar 2.0): compatible con Google Calendar, Apple
// Calendar y Outlook.
//   · Líneas terminadas en CRLF y plegadas a 75 octetos (UTF-8).
//   · Texto escapado (\\ ; , y saltos de línea).
//   · Eventos de todo el día con DTSTART;VALUE=DATE y DTEND exclusivo (día
//     siguiente); eventos con hora en «hora flotante» (sin zona): cada
//     calendario los muestra a la hora local de quien los importa, igual que
//     se escribieron en el tablero.
// El enlace de Google usa el formato oficial `calendar/render?action=TEMPLATE`
// con `ctz` = zona del navegador para respetar la hora escrita.
// ============================================================================

import type { CalendarEvent } from "./extractEvents";

export const ICS_MIME = "text/calendar;charset=utf-8";
const PRODID = "-//Andros//Calendario del tablero//ES";
const MAX_OCTETS = 75;
const DEFAULT_DURATION_MIN = 60;

/** Escapa texto según RFC 5545 §3.3.11. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Pliega una línea a 75 octetos sin partir caracteres UTF-8 (RFC 5545 §3.1). */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // La 1.ª línea admite 75 octetos; las siguientes 74 (+1 del espacio inicial).
    const limit = parts.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (date: string) => date.replace(/-/g, "");

/** Suma días a `YYYY-MM-DD` (sin zona horaria). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/** Inicio y fin locales `YYYYMMDDTHHMMSS` (fin = inicio + 1 h si no hay hora de fin). */
export function eventRange(event: Pick<CalendarEvent, "date" | "startTime" | "endTime">): { start: string; end: string } {
  const [sh, sm] = (event.startTime ?? "00:00").split(":").map(Number);
  let endDate = event.date;
  let eh: number;
  let em: number;
  if (event.endTime) {
    [eh, em] = event.endTime.split(":").map(Number);
    // «22:00–01:00» termina al día siguiente.
    if (eh * 60 + em <= sh * 60 + sm) endDate = addDays(event.date, 1);
  } else {
    const total = sh * 60 + sm + DEFAULT_DURATION_MIN;
    if (total >= 24 * 60) endDate = addDays(event.date, 1);
    eh = Math.floor((total % (24 * 60)) / 60);
    em = total % 60;
  }
  const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
  return {
    start: `${compactDate(event.date)}T${hhmm(sh, sm)}`,
    end: `${compactDate(endDate)}T${hhmm(eh, em)}`,
  };
}

function utcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export interface IcsOptions {
  calendarName: string;
  /** Enlace al tablero (se añade a cada evento como URL y en la descripción). */
  boardLink?: string;
  now?: Date;
}

/** Calendario completo (.ics) con todos los hitos recibidos. */
export function buildIcs(events: CalendarEvent[], options: IcsOptions): string {
  const stamp = utcStamp(options.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
  ];
  for (const event of events) {
    const description = [event.description, options.boardLink ? `Tablero: ${options.boardLink}` : ""]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id.replace(/[^\w.:-]/g, "-")}@andros`,
      `DTSTAMP:${stamp}`
    );
    if (event.allDay || !event.startTime) {
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
        `DTEND;VALUE=DATE:${compactDate(addDays(event.date, 1))}`,
        "TRANSP:TRANSPARENT"
      );
    } else {
      const range = eventRange(event);
      lines.push(`DTSTART:${range.start}`, `DTEND:${range.end}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    if (options.boardLink) lines.push(`URL:${options.boardLink}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Nombre de archivo seguro: «andros-<espacio>.ics». */
export function icsFilename(workspaceName: string): string {
  const slug = workspaceName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `andros-${slug || "calendario"}.ics`;
}

/** Enlace oficial «Añadir a Google Calendar» prellenado (sin OAuth). */
export function googleCalendarLink(
  event: CalendarEvent,
  options: { boardLink?: string; timeZone?: string } = {}
): string {
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", event.title);
  if (event.allDay || !event.startTime) {
    params.set("dates", `${compactDate(event.date)}/${compactDate(addDays(event.date, 1))}`);
  } else {
    const range = eventRange(event);
    params.set("dates", `${range.start}/${range.end}`);
    if (options.timeZone) params.set("ctz", options.timeZone);
  }
  const details = [event.description, options.boardLink ? `Tablero en Andros: ${options.boardLink}` : ""]
    .filter(Boolean)
    .join("\n\n");
  if (details) params.set("details", details.slice(0, 1500));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
