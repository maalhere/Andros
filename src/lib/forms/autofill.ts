// ============================================================================
// ANDROS — AUTO-LLENADO DE FICHAS: CONTRATO Y VALIDACIÓN (cliente y servidor)
//
// El modelo recibe la información en bruto + el esquema de cada ficha pedida
// y devuelve SOLO valores. Aquí se valida todo lo que devuelve:
//   · solo claves (`fieldKey`) que existen en la ficha; nunca campos «foto»;
//   · tipos correctos (número, fecha ISO, opción válida de la lista, sí/no);
//   · comprobación anti-invención: un número, fecha o texto que no aparece en
//     la información original se marca `needsReview` para que el usuario lo
//     confirme (p. ej. «próxima cita en 1 semana» → fecha calculada → revisar).
// ============================================================================

import type { FormFieldType, FormFieldValue } from "@/types/workspace";
import type { OracleIssue } from "@/types/oracle";

/** Tope de la información en bruto (cabe holgada en el contexto de 12 000 caracteres). */
export const AUTOFILL_MAX_RAW_CHARS = 8000;
/** Fichas distintas que se pueden pedir de una vez. */
export const AUTOFILL_MAX_REQUEST_SHEETS = 6;
/** Fichas que puede devolver (un mismo formato puede repetirse: p. ej. 2 pacientes). */
export const AUTOFILL_MAX_RESULT_SHEETS = 8;
export const AUTOFILL_MAX_FIELDS = 40;
/** (Sprint 24) Resumen de los nodos conectados a las fichas del lienzo. */
export const AUTOFILL_MAX_CONTEXT_CHARS = 3000;

export interface AutofillFieldSchema {
  key: string;
  label: string;
  type: Exclude<FormFieldType, "photo">;
  unit?: string;
  options?: string[];
}

export interface AutofillSheetSchema {
  /** «F1», «F2»… (formato de la librería) o «C1», «C2»… (ficha ya en el lienzo). */
  ref: string;
  title: string;
  category: string;
  /** `true` si es una ficha que ya está en el lienzo (solo se llena una vez). */
  existing: boolean;
  fields: AutofillFieldSchema[];
}

export interface AutofillRequestBody {
  rawText: string;
  sheets: AutofillSheetSchema[];
  /** Fecha local del usuario (AAAA-MM-DD) para resolver «mañana», «en 1 semana»… */
  today: string;
  /** (Sprint 24) Resumen de los nodos conectados (también son datos válidos). */
  context?: string;
  apiKey?: string;
}

export interface AutofillValue {
  value: FormFieldValue;
  needsReview: boolean;
}

export interface AutofillSheetResult {
  ref: string;
  /** Expediente / lote (p. ej. el nombre del paciente). Las del mismo grupo se cablean. */
  group: string;
  values: Record<string, AutofillValue>;
}

export type AutofillResponse =
  | { ok: true; sheets: AutofillSheetResult[]; notes: string; model: string }
  | { ok: false; issue: OracleIssue };

// ----------------------------------------------------------------------------
// Normalización y comprobación anti-invención
// ----------------------------------------------------------------------------

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const STOPWORDS = new Set([
  "para", "pero", "como", "cada", "desde", "hasta", "entre", "sobre", "tras", "este", "esta", "estos", "estas",
  "tiene", "tenia", "viene", "dias", "horas", "semana", "semanas", "meses", "años", "anos", "paciente", "llenar",
  "ficha", "fichas", "segun", "porque", "cuando", "donde", "también", "tambien", "mismo", "misma", "sera", "solo",
]);

/** Números escritos en el texto: «400mg» → 400, «120/80» → 120 y 80, «37,5» → 37.5. */
export function numbersInText(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const WORD_NUMBERS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cien: 100,
};

function numberIsGrounded(value: number, source: string, sourceNumbers: number[]): boolean {
  if (sourceNumbers.some((n) => Math.abs(n - value) < 1e-9)) return true;
  const words = normalize(source).split(/[^a-z]+/);
  return words.some((w) => WORD_NUMBERS[w] === value);
}

function textIsGrounded(value: string, sourceNorm: string, sourceNumbers: number[]): boolean {
  const words = normalize(value)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 4 && !/\d/.test(w) && !STOPWORDS.has(w));
  // Una cifra del texto original («cada 8 horas» ← «cada 8h») también ancla el valor.
  if (numbersInText(value).some((n) => sourceNumbers.includes(n))) return true;
  if (words.length === 0) {
    // Valores cortos («sí», «no», «A+»): basta con que aparezcan tal cual.
    const short = normalize(value).trim();
    return short.length > 0 && sourceNorm.includes(short);
  }
  // Basta con que una palabra significativa venga del texto (puede reformular).
  return words.some((w) => sourceNorm.includes(w.slice(0, Math.max(4, w.length - 2))));
}

function dateIsGrounded(iso: string, source: string, sourceNumbers: number[]): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  // Día y mes escritos en el texto (12/05, 12 de mayo…) o el año completo.
  const hasDay = sourceNumbers.includes(d);
  const hasMonth =
    sourceNumbers.includes(m) ||
    normalize(source).includes(
      ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][m - 1]
    );
  return (hasDay && hasMonth) || sourceNumbers.includes(y);
}

function toIsoDate(raw: string): string | null {
  const text = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
  function valid(y: number, mo: number, d: number): string | null {
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
}

function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(raw.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Valida y tipa un valor del modelo; `null` = sin dato utilizable. */
function coerceValue(
  field: AutofillFieldSchema,
  raw: unknown,
  source: string,
  sourceNorm: string,
  sourceNumbers: number[]
): AutofillValue | null {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (field.type) {
    case "number": {
      const n = parseNumber(raw);
      if (n === null) return { value: null, needsReview: true };
      return { value: n, needsReview: !numberIsGrounded(n, source, sourceNumbers) };
    }
    case "date": {
      const iso = typeof raw === "string" ? toIsoDate(raw) : null;
      if (!iso) return { value: "", needsReview: true };
      return { value: iso, needsReview: !dateIsGrounded(iso, source, sourceNumbers) };
    }
    case "checkbox": {
      const truthy = raw === true || (typeof raw === "string" && /^(si|sí|true|yes|x)$/i.test(raw.trim()));
      const falsy = raw === false || (typeof raw === "string" && /^(no|false)$/i.test(raw.trim()));
      if (!truthy && !falsy) return { value: false, needsReview: true };
      return { value: truthy, needsReview: false };
    }
    case "select": {
      const text = typeof raw === "string" ? normalize(raw).trim() : "";
      const option = field.options?.find((o) => normalize(o).trim() === text);
      return option ? { value: option, needsReview: false } : { value: "", needsReview: true };
    }
    default: {
      const text = typeof raw === "string" ? raw.trim().slice(0, field.type === "textarea" ? 2000 : 300) : "";
      if (!text) return null;
      return { value: text, needsReview: !textIsGrounded(text, sourceNorm, sourceNumbers) };
    }
  }
}

/** Valida la respuesta del modelo contra lo que se pidió. */
export function sanitizeAutofillResult(
  raw: unknown,
  sheets: AutofillSheetSchema[],
  source: string
): { sheets: AutofillSheetResult[]; notes: string } {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(root.sheets) ? root.sheets : [];
  const byRef = new Map(sheets.map((s) => [s.ref, s]));
  const sourceNorm = normalize(source);
  const sourceNumbers = numbersInText(source);
  const usedExisting = new Set<string>();
  const results: AutofillSheetResult[] = [];

  for (const item of list) {
    if (results.length >= AUTOFILL_MAX_RESULT_SHEETS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const schema = byRef.get(typeof r.ref === "string" ? r.ref.trim() : "");
    if (!schema) continue;
    if (schema.existing) {
      if (usedExisting.has(schema.ref)) continue;
      usedExisting.add(schema.ref);
    }
    const valuesRaw = r.values && typeof r.values === "object" ? (r.values as Record<string, unknown>) : {};
    const values: Record<string, AutofillValue> = {};
    for (const field of schema.fields) {
      if (!(field.key in valuesRaw)) continue;
      const entry = valuesRaw[field.key];
      const wrapped = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
      const coerced = coerceValue(field, wrapped ? wrapped.value : entry, source, sourceNorm, sourceNumbers);
      if (!coerced) {
        if (wrapped?.needsReview === true) values[field.key] = { value: null, needsReview: true };
        continue;
      }
      values[field.key] = { value: coerced.value, needsReview: coerced.needsReview || wrapped?.needsReview === true };
    }
    const group = typeof r.group === "string" ? r.group.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    results.push({ ref: schema.ref, group: group || "Lote", values });
  }

  const notes = typeof root.notes === "string" ? root.notes.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return { sheets: results, notes };
}

/** Fecha local AAAA-MM-DD. */
export function localIsoDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
