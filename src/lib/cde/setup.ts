// ============================================================================
// ANDROS — ARRANQUE GUIADO EN 3 PASOS: PLAN DE FICHAS (funciones puras)
// (Sprint 18) Paso 3: la persona describe qué fichas necesita («Fichas de
// control de compras, actas de entrega y seguimiento de incidencias»). La IA
// (/api/oracle/cde-setup) devuelve los formatos; sin IA, sin sesión o sin
// cuota, `buildLocalSetupPlan` arma uno equivalente por palabras clave (0 ms).
// Ambos caminos pasan por `sanitizeSetupTemplates`: cada ficha queda asignada
// a un área nominal del espacio.
// ============================================================================

import type { FormFieldType } from "@/types/workspace";
import { areaKey, canonicalArea } from "./areas";

export const SETUP_MAX_TEMPLATES = 6;
export const SETUP_MAX_FIELDS = 12;
export const SETUP_DESCRIPTION_MAX = 500;

export interface SetupFieldSeed {
  label: string;
  type: FormFieldType;
  unit?: string;
  options?: string[];
}

export interface SetupTemplateSeed {
  title: string;
  /** Área nominal responsable (una de las del espacio, o "" si no hay áreas). */
  area: string;
  description: string;
  fields: SetupFieldSeed[];
}

export interface SetupPlan {
  templates: SetupTemplateSeed[];
  engine: "ai" | "local";
}

// ----------------------------------------------------------------------------
// Catálogo local (respaldo sin IA)
// ----------------------------------------------------------------------------

interface KindRecipe {
  match: RegExp;
  title: string;
  description: string;
  /** Áreas preferidas, en orden (se comparan sin tildes). */
  areas: string[];
  fields: SetupFieldSeed[];
}

const ESTADO = (options: string[]): SetupFieldSeed => ({ label: "Estado", type: "select", options });

const RECIPES: KindRecipe[] = [
  {
    match: /(compra|proveedor|pedido|orden de compra|cotizaci)/,
    title: "Control de compras",
    description: "Pedidos a proveedores con monto, fechas y estado.",
    areas: ["Compras", "Presupuesto", "Logística"],
    fields: [
      { label: "Proveedor", type: "text" },
      { label: "Artículo o servicio", type: "text" },
      { label: "Cantidad", type: "number" },
      { label: "Monto", type: "number" },
      { label: "Fecha de pedido", type: "date" },
      { label: "Fecha de entrega", type: "date" },
      ESTADO(["Solicitada", "Aprobada", "Recibida"]),
      { label: "Observaciones", type: "textarea" },
    ],
  },
  {
    match: /(acta|entrega|recepci|recibid)/,
    title: "Acta de entrega",
    description: "Qué se entregó, quién lo entregó y quién lo recibió.",
    areas: ["Logística", "Operaciones"],
    fields: [
      { label: "Fecha", type: "date" },
      { label: "Entregado por", type: "text" },
      { label: "Recibido por", type: "text" },
      { label: "Elementos entregados", type: "textarea" },
      { label: "Conforme", type: "checkbox" },
      { label: "Foto de respaldo", type: "photo" },
      { label: "Observaciones", type: "textarea" },
    ],
  },
  {
    match: /(incidenc|problema|falla|riesgo|reclamo|queja|imprevist)/,
    title: "Seguimiento de incidencias",
    description: "Problemas detectados, su severidad, responsable y estado.",
    areas: ["Operaciones", "Ingeniería", "Logística"],
    fields: [
      { label: "Descripción", type: "textarea" },
      { label: "Severidad", type: "select", options: ["Baja", "Media", "Alta"] },
      { label: "Responsable", type: "text" },
      { label: "Fecha detectada", type: "date" },
      ESTADO(["Abierta", "En curso", "Cerrada"]),
      { label: "Evidencia", type: "photo" },
    ],
  },
  {
    match: /(presupuest|gasto|costo|coste|pago|factura|caja)/,
    title: "Control de gastos",
    description: "Gastos con concepto, monto, comprobante y aprobación.",
    areas: ["Presupuesto", "Finanzas", "Administración"],
    fields: [
      { label: "Concepto", type: "text" },
      { label: "Monto", type: "number" },
      { label: "Fecha", type: "date" },
      { label: "Categoría", type: "select", options: ["Materiales", "Servicios", "Transporte", "Otros"] },
      { label: "Aprobado", type: "checkbox" },
      { label: "Comprobante", type: "photo" },
    ],
  },
  {
    match: /(diseñ|disen|plano|boceto|maqueta|render|arte)/,
    title: "Revisión de diseño",
    description: "Versiones, cambios pedidos y aprobación de cada pieza.",
    areas: ["Diseño", "Ingeniería"],
    fields: [
      { label: "Elemento", type: "text" },
      { label: "Versión", type: "text" },
      { label: "Revisado por", type: "text" },
      { label: "Fecha", type: "date" },
      { label: "Cambios solicitados", type: "textarea" },
      { label: "Aprobado", type: "checkbox" },
      { label: "Imagen", type: "photo" },
    ],
  },
  {
    match: /(inspecci|calidad|verificaci|medici|ensayo|prueba)/,
    title: "Inspección de calidad",
    description: "Qué se inspeccionó, el resultado y la evidencia.",
    areas: ["Ingeniería", "Calidad", "Operaciones"],
    fields: [
      { label: "Elemento inspeccionado", type: "text" },
      { label: "Fecha", type: "date" },
      { label: "Inspector", type: "text" },
      { label: "Resultado", type: "select", options: ["Conforme", "No conforme", "Con observaciones"] },
      { label: "Medición", type: "number" },
      { label: "Evidencia", type: "photo" },
    ],
  },
  {
    match: /(asistencia|inscrip|participante|invitad|registro de personas)/,
    title: "Registro de asistencia",
    description: "Quién asistió y a qué actividad.",
    areas: ["Operaciones", "Logística"],
    fields: [
      { label: "Nombre", type: "text" },
      { label: "Actividad", type: "text" },
      { label: "Fecha", type: "date" },
      { label: "Asistió", type: "checkbox" },
      { label: "Observaciones", type: "textarea" },
    ],
  },
  {
    match: /(inventario|stock|material|almac|bodega|equipo)/,
    title: "Inventario de materiales",
    description: "Material disponible, cantidad, ubicación y responsable.",
    areas: ["Logística", "Operaciones"],
    fields: [
      { label: "Material", type: "text" },
      { label: "Cantidad", type: "number" },
      { label: "Ubicación", type: "text" },
      { label: "Responsable", type: "text" },
      { label: "Foto", type: "photo" },
    ],
  },
  {
    match: /(reuni|minuta|acuerdo)/,
    title: "Minuta de reunión",
    description: "Asistentes, acuerdos y próxima fecha.",
    areas: ["Operaciones"],
    fields: [
      { label: "Fecha", type: "date" },
      { label: "Asistentes", type: "textarea" },
      { label: "Acuerdos", type: "textarea" },
      { label: "Responsable de seguimiento", type: "text" },
      { label: "Próxima reunión", type: "date" },
    ],
  },
  {
    match: /(tarea|actividad|seguimiento|pendiente|avance)/,
    title: "Seguimiento de tareas",
    description: "Tareas con responsable, fecha límite y estado.",
    areas: ["Operaciones"],
    fields: [
      { label: "Tarea", type: "text" },
      { label: "Responsable", type: "text" },
      { label: "Fecha límite", type: "date" },
      ESTADO(["Pendiente", "En curso", "Hecha"]),
      { label: "Notas", type: "textarea" },
    ],
  },
];

const GENERIC_FIELDS: SetupFieldSeed[] = [
  { label: "Descripción", type: "textarea" },
  { label: "Responsable", type: "text" },
  { label: "Fecha", type: "date" },
  ESTADO(["Pendiente", "En curso", "Completado"]),
  { label: "Observaciones", type: "textarea" },
  { label: "Evidencia", type: "photo" },
];

const LEADING_NOISE =
  /^(quiero|necesito|me gustar[ií]a|usar|crear|tener|unas?|los|las|el|la|de|del|para|fichas?|formatos?|formularios?|plantillas?|registros? de|tipos? de)\s+/i;

/** «Fichas de control de compras, actas de entrega y seguimiento de incidencias» → 3 pedidos. */
export function splitRequestedKinds(description: string): string[] {
  const parts = description
    .slice(0, SETUP_DESCRIPTION_MAX)
    .replace(/[«»"“”]/g, " ")
    .split(/[,;\n/]+|\s+y\s+|\s+e\s+|\s+además\s+/i)
    .map((p) => {
      let s = p.replace(/\s+/g, " ").replace(/[.:!?]+$/, "").trim();
      for (let i = 0; i < 4; i += 1) s = s.replace(LEADING_NOISE, "").trim();
      return s;
    })
    .filter((p) => p.length >= 3);
  const out: string[] = [];
  for (const p of parts) if (!out.some((x) => areaKey(x) === areaKey(p))) out.push(p);
  return out.slice(0, SETUP_MAX_TEMPLATES);
}

const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("es") + s.slice(1) : s);

/** Elige el área de una ficha: la preferida que exista; si no, la que tenga menos fichas. */
function pickArea(preferred: readonly string[], areas: readonly string[], load: Map<string, number>): string {
  if (areas.length === 0) return "";
  for (const p of preferred) {
    const hit = canonicalArea(p, areas);
    if (hit) return hit;
  }
  return [...areas].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
}

/** Respaldo local sin IA (0 ms, $0): una ficha por cada tipo pedido. */
export function buildLocalSetupPlan(description: string, areas: readonly string[]): SetupPlan {
  const kinds = splitRequestedKinds(description);
  const requested = kinds.length > 0 ? kinds : ["seguimiento de tareas", "seguimiento de incidencias"];
  const load = new Map<string, number>();
  const used = new Set<string>();
  const templates: SetupTemplateSeed[] = [];
  for (const kind of requested) {
    const key = areaKey(kind);
    const recipe = RECIPES.find((r) => r.match.test(key) && !used.has(r.title));
    const title = recipe ? recipe.title : capitalize(kind).slice(0, 60);
    if (templates.some((t) => areaKey(t.title) === areaKey(title))) continue;
    if (recipe) used.add(recipe.title);
    const area = pickArea(recipe?.areas ?? [], areas, load);
    if (area) load.set(area, (load.get(area) ?? 0) + 1);
    templates.push({
      title,
      area,
      description: recipe?.description ?? `Registro de ${kind.toLocaleLowerCase("es")}.`,
      fields: (recipe?.fields ?? GENERIC_FIELDS).map((f) => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) })),
    });
  }
  return { templates: templates.slice(0, SETUP_MAX_TEMPLATES), engine: "local" };
}

// ----------------------------------------------------------------------------
// Validación (respuesta de la IA)
// ----------------------------------------------------------------------------

const FIELD_TYPES: FormFieldType[] = ["text", "textarea", "number", "date", "checkbox", "select", "photo"];
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/[*_`#]/g, "").trim().slice(0, max) : "");

/** Formatos de la IA → formatos válidos, cada uno con un área real del espacio. */
export function sanitizeSetupTemplates(raw: unknown, areas: readonly string[]): SetupTemplateSeed[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as { templates?: unknown }).templates : null;
  const load = new Map<string, number>();
  const out: SetupTemplateSeed[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = clip(o.title, 60);
    if (!title || out.some((t) => areaKey(t.title) === areaKey(title))) continue;
    const fields: SetupFieldSeed[] = [];
    for (const f of Array.isArray(o.fields) ? o.fields : []) {
      if (!f || typeof f !== "object") continue;
      const fo = f as Record<string, unknown>;
      const label = clip(fo.label, 60);
      if (!label || fields.some((x) => areaKey(x.label) === areaKey(label))) continue;
      const type = FIELD_TYPES.includes(fo.type as FormFieldType) ? (fo.type as FormFieldType) : "text";
      const unit = clip(fo.unit, 12);
      const options =
        type === "select"
          ? [...new Set((Array.isArray(fo.options) ? fo.options : []).map((x) => clip(x, 40)).filter(Boolean))].slice(0, 8)
          : [];
      fields.push({ label, type: type === "select" && options.length < 2 ? "text" : type, ...(unit ? { unit } : {}), ...(options.length >= 2 ? { options } : {}) });
      if (fields.length >= SETUP_MAX_FIELDS) break;
    }
    if (fields.length === 0) continue;
    const wanted = clip(o.area, 40);
    const area = (wanted && canonicalArea(wanted, areas)) || pickArea([], areas, load);
    if (area) load.set(area, (load.get(area) ?? 0) + 1);
    out.push({ title, area, description: clip(o.description, 160), fields });
    if (out.length >= SETUP_MAX_TEMPLATES) break;
  }
  return out;
}
