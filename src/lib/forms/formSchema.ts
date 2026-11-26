// ============================================================================
// ANDROS — FICHAS ESTRUCTURADAS: ESQUEMA, FORMATOS INICIALES Y SERIALIZACIÓN
// Funciones puras (cliente y servidor, sin store):
//   · `toFieldKey`: «Peso (kg)» → `peso_kg` (identificador para futuras
//     fórmulas LaTeX reactivas).
//   · Los 4 formatos iniciales de la librería.
//   · `instantiateTemplate`: formato → ficha vacía lista para el lienzo.
//   · `sanitizeTemplate` / `sanitizeFormSheet`: validan datos externos
//     (localStorage, Supabase, sala en vivo, .andros.zip).
//   · `formFieldLine` / `serializeFormSheet`: «label / fieldKey = valor unidad»
//     para el Oráculo y el Motor Anti-Malentendidos (sin las imágenes).
// ============================================================================

import type {
  FormField,
  FormFieldType,
  FormFieldValue,
  FormPhoto,
  FormSheetPayload,
} from "@/types/workspace";
import type { FormFieldDef, FormTemplate } from "@/types/forms";
import { normalizeAreaName } from "@/lib/cde/areas";
import { sanitizeResolution } from "@/lib/cde/resolution";

export const FORM_FIELD_TYPES: FormFieldType[] = [
  "text",
  "textarea",
  "number",
  "date",
  "checkbox",
  "select",
  "photo",
];

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Texto",
  textarea: "Texto largo",
  number: "Número",
  date: "Fecha",
  checkbox: "Casilla",
  select: "Lista desplegable",
  photo: "Foto",
};

/** Límites para que una ficha nunca sature la nube ni la sala en vivo. */
export const FORM_MAX_FIELDS = 40;
export const FORM_MAX_OPTIONS = 20;
export const FORM_MAX_PHOTOS_PER_FIELD = 4;
export const FORM_MAX_ATTACHMENTS = 6;
/** Fotos en total por ficha (campos + adjuntos). */
export const FORM_MAX_PHOTOS_TOTAL = 8;
export const FORM_MAX_TEXT_CHARS = 4000;
export const FORM_LIBRARY_MAX_TEMPLATES = 60;

/** Etiqueta de código del nodo en el lienzo. */
export const FORM_SHEET_CODE_TAG = "FICHA";

// ----------------------------------------------------------------------------
// Identificadores
// ----------------------------------------------------------------------------

/**
 * «Presión sistólica (mmHg)» → `presion_sistolica_mmhg`. Solo [a-z0-9_],
 * empieza por letra y mide como máximo 40 caracteres.
 */
export function toFieldKey(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/g, "");
  if (!base) return "campo";
  return /^[a-z]/.test(base) ? base : `c_${base}`.slice(0, 40);
}

/** Garantiza que cada `fieldKey` sea único dentro de la ficha (`dosis`, `dosis_2`…). */
export function uniqueFieldKeys<T extends { fieldKey: string; label: string }>(fields: T[]): T[] {
  const seen = new Set<string>();
  return fields.map((field) => {
    const wanted = /^[a-z][a-z0-9_]{0,39}$/.test(field.fieldKey) ? field.fieldKey : toFieldKey(field.label);
    let key = wanted;
    let n = 2;
    while (seen.has(key)) {
      key = `${wanted.slice(0, 36)}_${n}`;
      n += 1;
    }
    seen.add(key);
    return key === field.fieldKey ? field : { ...field, fieldKey: key };
  });
}

let idCounter = 0;
export function newFormId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

// ----------------------------------------------------------------------------
// Formatos iniciales
// ----------------------------------------------------------------------------

type DefSeed = [label: string, type: FormFieldType, extra?: { unit?: string; options?: string[]; key?: string }];

function defs(prefix: string, seeds: DefSeed[]): FormFieldDef[] {
  return seeds.map(([label, type, extra], i) => ({
    id: `${prefix}-f${i + 1}`,
    fieldKey: extra?.key ?? toFieldKey(label),
    label,
    type,
    ...(extra?.unit ? { unit: extra.unit } : {}),
    ...(extra?.options ? { options: extra.options } : {}),
  }));
}

export const BUILT_IN_TEMPLATES: FormTemplate[] = [
  {
    id: "tpl-historial-clinico",
    title: "Historial Clínico",
    category: "Salud",
    description: "Datos del paciente, motivo de consulta, antecedentes, signos vitales y diagnóstico.",
    builtIn: true,
    updatedAt: 0,
    fields: defs("hc", [
      ["Paciente", "text", { key: "paciente" }],
      ["Edad", "number", { unit: "años", key: "edad" }],
      ["Fecha de consulta", "date", { key: "fecha_consulta" }],
      ["Motivo de consulta", "textarea", { key: "motivo_consulta" }],
      ["Antecedentes", "textarea", { key: "antecedentes" }],
      ["Alergias", "text", { key: "alergias" }],
      ["Presión sistólica", "number", { unit: "mmHg", key: "pa_sistolica" }],
      ["Presión diastólica", "number", { unit: "mmHg", key: "pa_diastolica" }],
      ["Frecuencia cardiaca", "number", { unit: "lpm", key: "frecuencia_cardiaca" }],
      ["Temperatura", "number", { unit: "°C", key: "temperatura" }],
      ["Peso", "number", { unit: "kg", key: "peso_kg" }],
      ["Diagnóstico", "textarea", { key: "diagnostico" }],
      ["Foto / adjunto", "photo", { key: "foto_adjunto" }],
    ]),
  },
  {
    id: "tpl-nota-evolucion-receta",
    title: "Nota de Evolución / Receta",
    category: "Salud",
    description: "Evolución del caso, plan y medicación, indicaciones y próxima cita.",
    builtIn: true,
    updatedAt: 0,
    fields: defs("rx", [
      ["Paciente", "text", { key: "paciente" }],
      ["Fecha", "date", { key: "fecha" }],
      ["Evolución", "textarea", { key: "evolucion" }],
      ["Plan / medicación", "textarea", { key: "plan_medicacion" }],
      ["Dosis", "number", { unit: "mg", key: "dosis_mg" }],
      ["Frecuencia", "text", { key: "frecuencia" }],
      ["Duración del tratamiento", "number", { unit: "días", key: "duracion_dias" }],
      ["Indicaciones", "textarea", { key: "indicaciones" }],
      ["Próxima cita", "date", { key: "proxima_cita" }],
    ]),
  },
  {
    id: "tpl-datos-tecnicos",
    title: "Ficha de Datos Técnicos / Medición",
    category: "Técnico",
    description: "Parámetros numéricos con unidad, condiciones, observaciones y foto de evidencia.",
    builtIn: true,
    updatedAt: 0,
    fields: defs("tec", [
      ["Equipo / muestra", "text", { key: "equipo_muestra" }],
      ["Fecha de medición", "date", { key: "fecha_medicion" }],
      ["Responsable", "text", { key: "responsable" }],
      ["Longitud", "number", { unit: "mm", key: "longitud_mm" }],
      ["Masa", "number", { unit: "kg", key: "masa_kg" }],
      ["Temperatura", "number", { unit: "°C", key: "temperatura_c" }],
      ["Presión", "number", { unit: "kPa", key: "presion_kpa" }],
      ["Dentro de tolerancia", "checkbox", { key: "dentro_tolerancia" }],
      ["Observaciones", "textarea", { key: "observaciones" }],
      ["Foto de evidencia", "photo", { key: "foto_evidencia" }],
    ]),
  },
  {
    id: "tpl-registro-logistica",
    title: "Ficha de Registro / Logística",
    category: "Logística",
    description: "Responsable, fecha límite, costo estimado, estado y evidencia fotográfica.",
    builtIn: true,
    updatedAt: 0,
    fields: defs("log", [
      ["Tarea / ítem", "text", { key: "tarea" }],
      ["Responsable", "text", { key: "responsable" }],
      ["Fecha límite", "date", { key: "fecha_limite" }],
      ["Costo estimado", "number", { unit: "USD", key: "costo_estimado" }],
      ["Cantidad", "number", { key: "cantidad" }],
      ["Estado", "select", { key: "estado", options: ["Pendiente", "En curso", "Listo", "Bloqueado"] }],
      ["Notas", "textarea", { key: "notas" }],
      ["Evidencia fotográfica", "photo", { key: "evidencia_foto" }],
    ]),
  },
];

export const BUILT_IN_TEMPLATE_IDS = new Set(BUILT_IN_TEMPLATES.map((t) => t.id));

// ----------------------------------------------------------------------------
// Formato → ficha
// ----------------------------------------------------------------------------

export function emptyValueFor(type: FormFieldType): FormFieldValue {
  if (type === "checkbox") return false;
  if (type === "number" || type === "photo") return null;
  return "";
}

export function fieldFromDef(def: FormFieldDef): FormField {
  return {
    id: newFormId("fld"),
    fieldKey: def.fieldKey,
    label: def.label,
    type: def.type,
    value: emptyValueFor(def.type),
    ...(def.unit ? { unit: def.unit } : {}),
    ...(def.type === "select" ? { options: def.options ?? [] } : {}),
    ...(def.type === "photo" ? { photos: [] } : {}),
  };
}

export function createEmptyFormSheetPayload(): FormSheetPayload {
  return { templateId: "custom", category: "General", fields: [], attachments: [] };
}

/** Ficha vacía a partir de un formato (0 ms, sin red). */
export function instantiateTemplate(template: FormTemplate): { title: string; data: FormSheetPayload } {
  return {
    title: template.title,
    data: {
      templateId: template.id,
      category: template.category,
      fields: template.fields.map(fieldFromDef),
      attachments: [],
    },
  };
}

/** Estructura de una ficha del lienzo → formato reutilizable (sin valores ni fotos). */
export function templateFromSheet(title: string, data: FormSheetPayload): FormTemplate {
  return {
    id: newFormId("tpl"),
    title: title.trim().slice(0, 80) || "Mi formato",
    category: data.category.trim().slice(0, 40) || "General",
    fields: uniqueFieldKeys(
      data.fields.map((f) => ({
        id: newFormId("def"),
        fieldKey: f.fieldKey,
        label: f.label,
        type: f.type,
        ...(f.unit ? { unit: f.unit } : {}),
        ...(f.type === "select" ? { options: f.options ?? [] } : {}),
      }))
    ),
    updatedAt: Date.now(),
  };
}

// ----------------------------------------------------------------------------
// Validación de datos externos
// ----------------------------------------------------------------------------

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function sanitizeFieldType(v: unknown): FormFieldType {
  return FORM_FIELD_TYPES.includes(v as FormFieldType) ? (v as FormFieldType) : "text";
}

function sanitizeOptions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const text = str(item, 60).trim();
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= FORM_MAX_OPTIONS) break;
  }
  return out;
}

export function sanitizeFieldDef(raw: unknown): FormFieldDef | null {
  if (!isObj(raw)) return null;
  const label = str(raw.label, 80).trim();
  if (!label) return null;
  const type = sanitizeFieldType(raw.type);
  const unit = str(raw.unit, 16).trim();
  return {
    id: str(raw.id, 80) || newFormId("def"),
    fieldKey: str(raw.fieldKey, 40) || toFieldKey(label),
    label,
    type,
    ...(unit ? { unit } : {}),
    ...(type === "select" ? { options: sanitizeOptions(raw.options) } : {}),
  };
}

export function sanitizeTemplate(raw: unknown): FormTemplate | null {
  if (!isObj(raw)) return null;
  const title = str(raw.title, 80).trim();
  const id = str(raw.id, 80).trim();
  if (!title || !id) return null;
  const fields = uniqueFieldKeys(
    (Array.isArray(raw.fields) ? raw.fields : [])
      .map(sanitizeFieldDef)
      .filter((f): f is FormFieldDef => f !== null)
      .slice(0, FORM_MAX_FIELDS)
  );
  const description = str(raw.description, 200).trim();
  return {
    id,
    title,
    category: str(raw.category, 40).trim() || "General",
    ...(description ? { description } : {}),
    fields,
    ...(raw.builtIn === true ? { builtIn: true } : {}),
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
  };
}

/** Solo imágenes `data:` (nunca URLs externas ni `javascript:`). */
const SAFE_IMAGE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

export function sanitizePhoto(raw: unknown): FormPhoto | null {
  if (!isObj(raw)) return null;
  const src = typeof raw.src === "string" && SAFE_IMAGE.test(raw.src) ? raw.src : "";
  const thumb = typeof raw.thumb === "string" && SAFE_IMAGE.test(raw.thumb) ? raw.thumb : "";
  // La sala en vivo puede mandar solo la miniatura (la imagen completa no cabe).
  if (!src && !thumb) return null;
  return {
    id: str(raw.id, 80) || newFormId("img"),
    src,
    thumb: thumb || src,
    name: str(raw.name, 120) || "Imagen",
    width: Math.max(0, Math.round(Number(raw.width) || 0)),
    height: Math.max(0, Math.round(Number(raw.height) || 0)),
    bytes: Math.max(0, Math.round(Number(raw.bytes) || 0)),
  };
}

function sanitizePhotos(v: unknown, max: number): FormPhoto[] {
  return (Array.isArray(v) ? v : [])
    .map(sanitizePhoto)
    .filter((p): p is FormPhoto => p !== null)
    .slice(0, max);
}

function sanitizeValue(type: FormFieldType, v: unknown): FormFieldValue {
  if (type === "checkbox") return v === true;
  if (type === "photo") return null;
  if (type === "number") {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  return typeof v === "string" ? v.slice(0, FORM_MAX_TEXT_CHARS) : "";
}

export function sanitizeFormField(raw: unknown): FormField | null {
  const def = sanitizeFieldDef(raw);
  if (!def || !isObj(raw)) return null;
  return {
    ...def,
    id: def.id || newFormId("fld"),
    value: sanitizeValue(def.type, raw.value),
    ...(def.type === "photo" ? { photos: sanitizePhotos(raw.photos, FORM_MAX_PHOTOS_PER_FIELD) } : {}),
    ...(raw.needsReview === true ? { needsReview: true } : {}),
  };
}

/** Completa y valida una ficha leída de la nube, de la sala o de un archivo. */
export function sanitizeFormSheet(raw: unknown): FormSheetPayload {
  const r = isObj(raw) ? raw : {};
  const fields = uniqueFieldKeys(
    (Array.isArray(r.fields) ? r.fields : [])
      .map(sanitizeFormField)
      .filter((f): f is FormField => f !== null)
      .slice(0, FORM_MAX_FIELDS)
  );
  const batchLabel = str(r.batchLabel, 80).trim();
  const area = normalizeAreaName(r.area);
  const resolution = sanitizeResolution(r.resolution);
  return {
    templateId: str(r.templateId, 80) || "custom",
    category: str(r.category, 40).trim() || "General",
    fields,
    attachments: sanitizePhotos(r.attachments, FORM_MAX_ATTACHMENTS),
    ...(batchLabel ? { batchLabel } : {}),
    ...(r.aiFilled === true ? { aiFilled: true } : {}),
    ...(area ? { area } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

// ----------------------------------------------------------------------------
// Lectura: valores legibles y serialización para la IA
// ----------------------------------------------------------------------------

export function photoCount(data: FormSheetPayload): number {
  return (
    data.attachments.length +
    data.fields.reduce((sum, f) => sum + (f.type === "photo" ? (f.photos?.length ?? 0) : 0), 0)
  );
}

export function allPhotos(data: FormSheetPayload): { photo: FormPhoto; label: string }[] {
  const out: { photo: FormPhoto; label: string }[] = [];
  for (const f of data.fields) {
    if (f.type === "photo") for (const photo of f.photos ?? []) out.push({ photo, label: f.label });
  }
  for (const photo of data.attachments) out.push({ photo, label: "Adjunto" });
  return out;
}

/** ¿El campo tiene un dato? (una casilla sin marcar cuenta como «no».) */
export function isFieldFilled(field: FormField): boolean {
  if (field.type === "photo") return (field.photos?.length ?? 0) > 0;
  if (field.type === "checkbox") return field.value === true;
  if (field.type === "number") return typeof field.value === "number" && Number.isFinite(field.value);
  return typeof field.value === "string" && field.value.trim() !== "";
}

/** Número legible: hasta 6 decimales, sin ceros sobrantes. */
export function formatFormNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** Valor visible de un campo (sin la unidad). Vacío si no hay dato. */
export function formatFieldValue(field: FormField): string {
  switch (field.type) {
    case "checkbox":
      return field.value === true ? "Sí" : "No";
    case "number":
      return typeof field.value === "number" && Number.isFinite(field.value) ? formatFormNumber(field.value) : "";
    case "photo": {
      const n = field.photos?.length ?? 0;
      return n > 0 ? `${n} foto${n === 1 ? "" : "s"} adjunta${n === 1 ? "" : "s"}` : "";
    }
    case "date": {
      const text = typeof field.value === "string" ? field.value.trim() : "";
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : text;
    }
    default:
      return typeof field.value === "string" ? field.value.trim() : "";
  }
}

/** «Presión sistólica / pa_sistolica = 120 mmHg» (o «(vacío)»). */
export function formFieldLine(field: FormField): string {
  const value = formatFieldValue(field);
  const unit = value && field.unit && field.type === "number" ? ` ${field.unit}` : "";
  const review = field.needsReview ? " [revisar]" : "";
  return `${field.label} / ${field.fieldKey} = ${value ? `${value}${unit}` : "(vacío)"}${review}`;
}

/** Contenido de la ficha como texto para el Oráculo y el detector de impacto. */
export function serializeFormSheet(title: string, data: FormSheetPayload): string {
  const filled = data.fields.filter(isFieldFilled).length;
  const lines = [
    `Ficha «${title}» · categoría ${data.category} · ${filled}/${data.fields.length} campos con dato`,
  ];
  if (data.batchLabel) lines.push(`Expediente / lote: ${data.batchLabel}`);
  for (const field of data.fields) lines.push(`- ${formFieldLine(field)}`);
  if (data.attachments.length > 0) lines.push(`(${data.attachments.length} imagen(es) adjunta(s) a la ficha)`);
  return lines.join("\n");
}
