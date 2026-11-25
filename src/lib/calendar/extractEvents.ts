// ============================================================================
// ANDROS — EXTRACTOR LOCAL DE FECHAS Y CRONOGRAMAS (0 ms, $0 API, sin red)
//
// Detecta hitos de calendario en las tarjetas del espacio:
//   1. Fichas (`form-sheet-node`): cada campo de tipo `date` con valor
//      («Próxima cita», «Fecha límite», «Fecha del evento»…). Si la ficha
//      tiene un campo de hora («Hora», «Hora de la cita»…), se combina.
//   2. Cronogramas y notas (`sketch-note-node`): cada línea con una fecha o
//      una hora reconocible:
//        · ISO `2026-11-28`, `28/11/2026`, `28-11-26`
//        · en español: `28 de noviembre de 2026`, `sábado 28 nov`
//        · horas `18:30`, `9:00 am`, `6 pm`, `18h30` y rangos `18:30–20:00`
//      Una línea con solo hora usa la última fecha vista en la tarjeta (p. ej.
//      un título «# Sábado 28 de noviembre» y debajo «- 09:00 — Montaje»).
// Las fechas relativas («2 semanas antes») no son un día concreto: se ignoran.
// Todas las funciones son puras: las prueba scripts/verify-collab-calendar.ts.
// ============================================================================

import type { EngineeringNodeData, FormField } from "@/types/workspace";

export type CalendarEventSource = "form-field" | "timeline" | "note";

export interface CalendarEvent {
  /** Estable entre renders: `<nodo>:<campo o línea>`. */
  id: string;
  nodeId: string;
  title: string;
  description: string;
  /** `YYYY-MM-DD` (día local, sin zona horaria). */
  date: string;
  /** `HH:MM` 24 h, o `null` si es de todo el día. */
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  source: CalendarEventSource;
  /** Título de la tarjeta de origen. */
  sourceTitle: string;
}

export interface ParsedDate {
  year: number;
  month: number; // 1–12
  day: number;
}

export interface ParsedTime {
  hours: number;
  minutes: number;
}

const MAX_EVENTS = 200;
const MAX_TITLE = 120;

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAYS = "lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|lun|mar|mié|mie|jue|vie|sáb|sab|dom";

const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/;
const TEXT_DATE = new RegExp(
  `\\b(?:(?:${WEEKDAYS})\\.?,?\\s+)?(\\d{1,2})\\s+(?:de\\s+)?(${MONTH_NAMES})\\.?(?:,?\\s+(?:de\\s+|del\\s+)?(\\d{4}))?(?![\\p{L}])`,
  "iu"
);
/** `18:30`, `9:05 am`, `18h30`, `6 pm`, `6 p. m.` */
const TIME = /\b([01]?\d|2[0-3])(?:[:h]([0-5]\d))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?![\d/]|[.:-]\d)/giu;

export const pad2 = (n: number): string => String(n).padStart(2, "0");

export function isValidDate({ year, month, day }: ParsedDate): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= dim;
}

export function formatIsoDate(d: ParsedDate): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

export function formatTime(t: ParsedTime): string {
  return `${pad2(t.hours)}:${pad2(t.minutes)}`;
}

/** Año para «28 de noviembre» sin año: la próxima vez que ocurre (con 30 días de gracia). */
function inferYear(month: number, day: number, now: Date): number {
  const year = now.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const graceMs = 30 * 86_400_000;
  return candidate.getTime() < now.getTime() - graceMs ? year + 1 : year;
}

/** Primera fecha reconocible del texto, con su posición (para limpiar el título). */
export function findDate(text: string, now: Date = new Date()): { date: ParsedDate; index: number; length: number } | null {
  const candidates: { date: ParsedDate; index: number; length: number }[] = [];

  const iso = ISO_DATE.exec(text);
  if (iso) {
    const date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    if (isValidDate(date)) candidates.push({ date, index: iso.index, length: iso[0].length });
  }
  const numeric = NUMERIC_DATE.exec(text);
  if (numeric && !(iso && numeric.index >= iso.index && numeric.index < iso.index + iso[0].length)) {
    // Formato latino: día/mes/año.
    const rawYear = Number(numeric[3]);
    const date = {
      year: numeric[3].length === 2 ? 2000 + rawYear : rawYear,
      month: Number(numeric[2]),
      day: Number(numeric[1]),
    };
    if (isValidDate(date)) candidates.push({ date, index: numeric.index, length: numeric[0].length });
  }
  const written = TEXT_DATE.exec(text);
  if (written) {
    const month = MONTHS[written[2].toLowerCase()];
    const day = Number(written[1]);
    const year = written[3] ? Number(written[3]) : inferYear(month, day, now);
    const date = { year, month, day };
    if (month && isValidDate(date)) candidates.push({ date, index: written.index, length: written[0].length });
  }
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.index - b.index)[0];
}

/** Horas reconocibles del texto (como mucho 2: inicio y fin de un rango). */
export function findTimes(text: string): { time: ParsedTime; index: number; length: number }[] {
  const found: { time: ParsedTime; index: number; length: number }[] = [];
  TIME.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TIME.exec(text)) && found.length < 2) {
    const [whole, h, m, meridiem] = match;
    // Un número suelto («5 personas») no es una hora: hace falta «:mm», «h» o am/pm.
    if (m === undefined && !meridiem) continue;
    let hours = Number(h);
    const minutes = m === undefined ? 0 : Number(m);
    if (meridiem) {
      if (hours < 1 || hours > 12) continue;
      const pm = /^p/i.test(meridiem);
      if (pm && hours < 12) hours += 12;
      if (!pm && hours === 12) hours = 0;
    }
    found.push({ time: { hours, minutes }, index: match.index, length: whole.length });
  }
  return found;
}

/** Quita fecha, horas, viñetas y separadores para dejar un título limpio. */
function cleanTitle(text: string, spans: { index: number; length: number }[]): string {
  let out = text;
  for (const span of [...spans].sort((a, b) => b.index - a.index)) {
    out = out.slice(0, span.index) + " " + out.slice(span.index + span.length);
  }
  let title = out
    .replace(/^\s*(?:[-*•]|\[[ xX]\]|#+)\s*/, "")
    .replace(/\s*[-–—|·]\s*(?:[-–—|·]\s*)+/g, " — ")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Conectores que quedan sueltos al quitar la fecha («de», «a las», «desde»…).
  const connector = "(?:de|del|desde|a|al|las|la|el|hasta|y|día|dia)";
  for (let i = 0; i < 8; i += 1) {
    const before = title;
    title = title
      .replace(/^[\s\-–—|·:,()]+|[\s\-–—|·:,()]+$/g, "")
      .replace(new RegExp(`\\s+${connector}$`, "i"), "")
      .replace(new RegExp(`^${connector}\\s+`, "i"), "")
      .replace(new RegExp(`\\s+${connector}\\s+(?=[-–—|·:,]|$)`, "i"), " ");
    if (title === before) break;
  }
  return title.slice(0, MAX_TITLE);
}

/** Texto plano de una nota: títulos, párrafos, viñetas y tareas (una por línea). */
function noteLines(node: EngineeringNodeData): string[] {
  if (node.type !== "sketch-note-node") return [];
  const data = node.sketchNoteData;
  return [
    ...data.textBlocks.map((b) => b.text),
    ...data.checklistItems.map((c) => c.text),
  ]
    .flatMap((t) => t.split(/\r?\n/))
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 300);
}

const TIMELINE_TAG = /\b(CRONOGRAMA|AGENDA|CALENDARIO|ITINERARIO|TIMELINE|PROGRAMA)\b/;
const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

function isTimelineCard(node: EngineeringNodeData): boolean {
  return TIMELINE_TAG.test(normalize(node.codeTag ?? "")) || TIMELINE_TAG.test(normalize(node.title ?? ""));
}

function fromNote(node: EngineeringNodeData, now: Date): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const source: CalendarEventSource = isTimelineCard(node) ? "timeline" : "note";
  const cardTitle = node.title?.trim() || "Nota";
  let currentDate: ParsedDate | null = null;

  noteLines(node).forEach((line, index) => {
    const dateHit = findDate(line, now);
    if (dateHit) currentDate = dateHit.date;
    const times = findTimes(line);
    // Sin hora ni fecha propia no es un hito (aunque haya fecha arriba).
    if (!dateHit && times.length === 0) return;
    if (!currentDate) return;

    const spans = [...(dateHit ? [dateHit] : []), ...times];
    const title = cleanTitle(line, spans);
    // Un título de sección con solo la fecha («# Sábado 28 de noviembre») no es un hito.
    if (!title && times.length === 0) return;
    const start = times[0]?.time ?? null;
    const end = times[1]?.time ?? null;
    events.push({
      id: `${node.id}:l${index}`,
      nodeId: node.id,
      title: title || cardTitle,
      description: `${source === "timeline" ? "Cronograma" : "Nota"} «${cardTitle}»: ${line.replace(/^\s*(?:[-*•]|#+)\s*/, "").slice(0, 300)}`,
      date: formatIsoDate(currentDate),
      startTime: start ? formatTime(start) : null,
      endTime: start && end ? formatTime(end) : null,
      allDay: !start,
      source,
      sourceTitle: cardTitle,
    });
  });
  return events;
}

const TIME_FIELD_LABEL = /\bhora\b|\bhorario\b|\btime\b/i;

function fieldText(field: FormField): string {
  return typeof field.value === "string" ? field.value.trim() : "";
}

function fromFormSheet(node: EngineeringNodeData, now: Date): CalendarEvent[] {
  if (node.type !== "form-sheet-node") return [];
  const cardTitle = node.title?.trim() || "Ficha";
  const fields = node.formSheetData.fields;
  // Campo de hora de la ficha (texto «18:30» o «6 pm»), si lo hay.
  const timeField = fields.find((f) => f.type !== "date" && TIME_FIELD_LABEL.test(f.label) && findTimes(fieldText(f)).length > 0);
  const sheetTimes = timeField ? findTimes(fieldText(timeField)) : [];

  const events: CalendarEvent[] = [];
  for (const field of fields) {
    if (field.type !== "date") continue;
    const value = fieldText(field);
    if (!value) continue;
    const hit = findDate(value, now);
    if (!hit) continue;
    const ownTimes = findTimes(value);
    const times = ownTimes.length > 0 ? ownTimes : sheetTimes;
    const start = times[0]?.time ?? null;
    const end = times[1]?.time ?? null;
    const label = field.label.trim() || "Fecha";
    events.push({
      id: `${node.id}:${field.id}`,
      nodeId: node.id,
      title: `${label} · ${cardTitle}`.slice(0, MAX_TITLE),
      description: `Ficha «${cardTitle}» · campo «${label}»${node.formSheetData.category ? ` · ${node.formSheetData.category}` : ""}`,
      date: formatIsoDate(hit.date),
      startTime: start ? formatTime(start) : null,
      endTime: start && end ? formatTime(end) : null,
      allDay: !start,
      source: "form-field",
      sourceTitle: cardTitle,
    });
  }
  return events;
}

/** Hitos de una sola tarjeta. */
export function extractNodeEvents(node: EngineeringNodeData, now: Date = new Date()): CalendarEvent[] {
  if (node.type === "form-sheet-node") return fromFormSheet(node, now);
  if (node.type === "sketch-note-node") return fromNote(node, now);
  return [];
}

/** ¿La tarjeta tiene al menos un hito? (botón rápido de calendario en la tarjeta). */
export function nodeHasCalendarEvents(node: EngineeringNodeData): boolean {
  if (node.type === "form-sheet-node") {
    return node.formSheetData.fields.some((f) => f.type === "date" && fieldText(f) !== "" && findDate(fieldText(f)) !== null);
  }
  return node.type === "sketch-note-node" && extractNodeEvents(node).length > 0;
}

/** Todos los hitos del espacio, sin duplicados y en orden cronológico. */
export function extractCalendarEvents(nodes: EngineeringNodeData[], now: Date = new Date()): CalendarEvent[] {
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const node of nodes) {
    for (const event of extractNodeEvents(node, now)) {
      const key = `${event.nodeId}|${event.date}|${event.startTime ?? ""}|${event.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return events
    .sort((a, b) => `${a.date} ${a.startTime ?? "00:00"}`.localeCompare(`${b.date} ${b.startTime ?? "00:00"}`))
    .slice(0, MAX_EVENTS);
}

/** «sáb, 28 nov 2026» en español (sin zona horaria: el día es local). */
export function formatEventDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** «18:30–20:00», «18:30» o «Todo el día». */
export function formatEventTime(event: Pick<CalendarEvent, "startTime" | "endTime">): string {
  if (!event.startTime) return "Todo el día";
  return event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime;
}
