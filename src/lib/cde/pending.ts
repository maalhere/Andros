// ============================================================================
// ANDROS — ALARMAS Y PENDIENTES (funciones puras, sin store) — Sprint 24
// Un pendiente es una Ficha de Resolución (semáforo Rojo / Verde) que puede
// llevar fecha y hora límite (`dueAt`). Aquí vive lo que no depende del store:
//   · Atajos de vencimiento en 1 clic: Hoy, Mañana, En 3 días, Próxima semana.
//   · «+ Alarma rápida» en lenguaje natural: «Confirmar el audio mañana a las
//     10 @Logística» → descripción + área + fecha.
//   · Estado de la alarma (vencida, hoy, pronto) y su texto corto.
//   · Áreas presentes en el lienzo (para los chips de asignación).
// ============================================================================

import type { EngineeringNodeData } from "@/types/workspace";
import { areaKey, canonicalArea, normalizeAreaName } from "./areas";

export type DueShortcut = "today" | "tomorrow" | "in3" | "nextWeek";

export const DUE_SHORTCUTS: readonly { id: DueShortcut; label: string }[] = [
  { id: "today", label: "Hoy" },
  { id: "tomorrow", label: "Mañana" },
  { id: "in3", label: "En 3 días" },
  { id: "nextWeek", label: "Próxima semana" },
];

/** Hora por defecto de una alarma sin hora explícita (fin de la jornada). */
export const DEFAULT_DUE_HOUR = 18;

function atLocal(base: Date, addDays: number, hour: number, minute = 0): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, hour, minute, 0, 0);
  return d;
}

/** Fecha límite de un atajo. «Hoy» pasadas las 18:00 vence a las 23:59. */
export function dueFromShortcut(kind: DueShortcut, now: Date = new Date()): string {
  switch (kind) {
    case "today":
      return (now.getHours() >= DEFAULT_DUE_HOUR ? atLocal(now, 0, 23, 59) : atLocal(now, 0, DEFAULT_DUE_HOUR)).toISOString();
    case "tomorrow":
      return atLocal(now, 1, DEFAULT_DUE_HOUR).toISOString();
    case "in3":
      return atLocal(now, 3, DEFAULT_DUE_HOUR).toISOString();
    case "nextWeek":
      return atLocal(now, 7, DEFAULT_DUE_HOUR).toISOString();
  }
}

/** ¿Qué atajo produjo esta fecha (para resaltar el botón)? */
export function shortcutOf(dueAt: string | null | undefined, now: Date = new Date()): DueShortcut | null {
  if (!dueAt) return null;
  return DUE_SHORTCUTS.find((s) => dueFromShortcut(s.id, now) === dueAt)?.id ?? null;
}

// ----------------------------------------------------------------------------
// Estado y texto corto de una alarma
// ----------------------------------------------------------------------------

export type DueState = "overdue" | "today" | "soon" | "later";

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY_MS = 86_400_000;

export function dueState(dueAt: string | null | undefined, now: Date = new Date()): DueState | null {
  const at = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(at)) return null;
  if (at < now.getTime()) return "overdue";
  const days = Math.round((dayStart(new Date(at)) - dayStart(now)) / DAY_MS);
  if (days <= 0) return "today";
  if (days <= 3) return "soon";
  return "later";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** «Hoy 18:00», «Mañana 09:30», «vie 4 dic 18:00» o «Vencida · ayer 18:00». */
export function formatDue(dueAt: string | null | undefined, now: Date = new Date()): string {
  const at = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((dayStart(d) - dayStart(now)) / DAY_MS);
  const day =
    days === 0
      ? "hoy"
      : days === 1
        ? "mañana"
        : days === -1
          ? "ayer"
          : d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
  const text = `${day} ${time}`;
  const capital = text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
  return at < now.getTime() ? `Vencida · ${text}` : capital;
}

/** ISO → valor de `<input type="datetime-local">` (hora local). */
export function toLocalInputValue(dueAt: string | null | undefined): string {
  const at = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor de `datetime-local` → ISO (o `null` si está vacío o es inválido). */
export function fromLocalInputValue(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

// ----------------------------------------------------------------------------
// «+ Alarma rápida» en lenguaje natural (0 ms, sin IA)
// ----------------------------------------------------------------------------

export interface QuickAlarmDraft {
  description: string;
  area: string;
  dueAt: string | null;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/** Quita tildes conservando la longitud (para buscar sin perder posiciones). */
function fold(text: string): string {
  return [...text].map((ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0) || ch).join("").toLowerCase();
}

interface DayMatch {
  start: number;
  end: number;
  addDays: number;
  date?: Date;
}

function findDay(folded: string, now: Date): DayMatch | null {
  const tests: [RegExp, (m: RegExpExecArray) => Omit<DayMatch, "start" | "end"> | null][] = [
    [/\bpasado manana\b/, () => ({ addDays: 2 })],
    [/\b(?:para |de )?hoy\b/, () => ({ addDays: 0 })],
    [/\b(?:para )?manana\b/, () => ({ addDays: 1 })],
    [/\ben (\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) (dias?|semanas?)\b/, (m) => {
      const words: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : words[m[1]];
      return { addDays: n * (m[2].startsWith("semana") ? 7 : 1) };
    }],
    [/\b(?:la )?(?:proxima semana|semana que viene)\b/, () => ({ addDays: 7 })],
    [/\b(?:el |este |para el )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/, (m) => {
      const target = WEEKDAYS.indexOf(m[1]);
      const diff = (target - now.getDay() + 7) % 7 || 7;
      return { addDays: diff };
    }],
    [/\b(?:el |para el )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, (m) => {
      const yearRaw = m[3] ? Number(m[3]) : now.getFullYear();
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      const date = new Date(year, Number(m[2]) - 1, Number(m[1]));
      if (date.getMonth() !== Number(m[2]) - 1) return null;
      if (!m[3] && dayStart(date) < dayStart(now)) date.setFullYear(year + 1);
      return { addDays: 0, date };
    }],
  ];
  for (const [re, build] of tests) {
    const m = re.exec(folded);
    if (!m) continue;
    const found = build(m);
    if (found) return { ...found, start: m.index, end: m.index + m[0].length };
  }
  return null;
}

function findTime(folded: string): { start: number; end: number; hour: number; minute: number } | null {
  const m = /\b(?:a las |a la |sobre las )?(\d{1,2})(?::(\d{2}))?\s*(am|pm|h|hrs|horas)?\b/.exec(folded);
  if (!m) return null;
  const explicit = Boolean(m[2] || m[3] || /a las|a la|sobre las/.test(m[0]));
  if (!explicit) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { start: m.index, end: m.index + m[0].length, hour, minute };
}

/**
 * Interpreta una alarma escrita de corrido. El área sale de una mención
 * «@Área» que exista en el espacio; la fecha, de «hoy», «mañana», «en 3 días»,
 * «próxima semana», un día de la semana o «12/12». Sin hora → 18:00.
 */
export function parseQuickAlarm(text: string, areas: readonly string[], now: Date = new Date()): QuickAlarmDraft {
  let working = text.replace(/\s+/g, " ").trim();
  let area = "";

  // 1. @Área (la más larga primero: «@Diseño gráfico» antes que «@Diseño»).
  const mention = /@([\p{L}\p{N}&-]+(?: [\p{L}\p{N}&-]+){0,3})/u.exec(working);
  if (mention) {
    const words = mention[1].split(" ");
    for (let n = words.length; n >= 1; n -= 1) {
      const candidate = canonicalArea(words.slice(0, n).join(" "), areas);
      if (candidate) {
        area = candidate;
        const consumed = `@${words.slice(0, n).join(" ")}`;
        working = (working.slice(0, mention.index) + working.slice(mention.index + consumed.length)).trim();
        break;
      }
    }
  }

  // 2. Día y hora (se buscan sobre el texto sin tildes, misma longitud).
  let dueAt: string | null = null;
  const day = findDay(fold(working), now);
  if (day) working = `${working.slice(0, day.start)} ${working.slice(day.end)}`;
  const time = findTime(fold(working));
  if (time) working = `${working.slice(0, time.start)} ${working.slice(time.end)}`;
  if (day || time) {
    const base = day?.date ?? atLocal(now, day?.addDays ?? 0, 0);
    const hour = time ? time.hour : DEFAULT_DUE_HOUR;
    const minute = time ? time.minute : 0;
    let date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute);
    // Solo hora y ya pasó → mañana a esa hora.
    if (!day && date.getTime() <= now.getTime()) date = atLocal(now, 1, hour, minute);
    dueAt = date.toISOString();
  }

  const description = working
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, "")
    .trim();
  return {
    description: description ? description.charAt(0).toLocaleUpperCase("es") + description.slice(1) : "",
    area,
    dueAt,
  };
}

// ----------------------------------------------------------------------------
// Áreas presentes en el lienzo (chips de asignación sin escribir)
// ----------------------------------------------------------------------------

/** Áreas del espacio + las que aparecen en el lienzo (notas «Área: X» y fichas con área). */
export function canvasAreas(nodes: readonly EngineeringNodeData[], spaceAreas: readonly string[] = []): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    const name = normalizeAreaName(raw ?? "");
    if (name && !out.some((a) => areaKey(a) === areaKey(name))) out.push(name);
  };
  spaceAreas.forEach(push);
  for (const n of nodes) {
    if (n.type === "form-sheet-node") push(n.formSheetData.resolution?.area || n.formSheetData.area);
    else if (n.type === "sketch-note-node") {
      const m = /^[ÁA]rea:\s*(.+)$/i.exec(n.title.trim());
      if (m) push(m[1]);
    }
    if (out.length >= 16) break;
  }
  return out;
}
