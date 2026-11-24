// ============================================================================
// ANDROS — ESTRUCTURA DE EXPORTACIÓN (funciones puras: cliente, servidor y scripts)
//
// Un mismo «esquema» alimenta las 3 salidas del Estudio de Exportación:
//   · `DocumentOutline` → PDF imprimible y Word / Google Docs (.docx),
//   · `SlidesOutline`   → PowerPoint / Google Slides (.pptx).
// Puede salir de dos sitios:
//   1. `buildLocalExportOutline` (0 ms, sin IA): directo de las tarjetas.
//   2. `/api/oracle/export-outline` (Gemini): redacta y ordena el contenido.
//
// Las cifras NUNCA las escribe la IA: el modelo solo cita tablas y fórmulas por
// su referencia ([C3]) y aquí se rellenan con los datos reales del tablero
// (totales recalculados con `sheet.ts`, fórmulas resueltas en vivo). Las fotos
// viajan solo como referencia (`photoId` + etiqueta): sus bytes jamás salen
// del dispositivo y se incrustan localmente al generar el archivo.
// ============================================================================

import type { OracleIssue } from "@/types/oracle";
import type { PlanDocument, PlanSection, PlanTextBlock } from "@/lib/plan/planDocument";
import { PLAN_CATEGORY_LABELS } from "@/lib/plan/planDocument";

export type ExportMode = "document" | "slides";

// ----------------------------------------------------------------------------
// Piezas de datos reales (nunca redactadas por la IA)
// ----------------------------------------------------------------------------

export interface OutlineTable {
  title: string;
  header: string[] | null;
  rows: string[][];
  total: { label: string; value: string } | null;
  /** `fields`: «Campo | Valor» (texto a la izquierda); `sheet`: montos a la derecha. */
  kind: "sheet" | "fields";
}

export interface OutlineFormula {
  title: string;
  /** LaTeX simbólico (KaTeX en el PDF). */
  latex: string;
  /** Expresión evaluable legible: «m / h^2». */
  expression: string;
  substitutionLatex: string | null;
  /** «82 / 1.75^2» (Word y PowerPoint no pintan LaTeX). */
  substitutionText: string | null;
  result: { label: string; value: string };
  /** Filas «Variable | Valor · origen». */
  variables: string[][];
}

export interface OutlineBlock {
  type: "heading" | "paragraph" | "bullet";
  text: string;
}

// ----------------------------------------------------------------------------
// Documento (PDF y .docx)
// ----------------------------------------------------------------------------

export interface DocumentOutlineSection {
  heading: string;
  /** Categoría corta («Presupuesto»): antetítulo en el PDF y el Word. */
  kicker: string | null;
  blocks: OutlineBlock[];
  tables: OutlineTable[];
  formulas: OutlineFormula[];
  photoIds: string[];
}

export interface DocumentOutline {
  mode: "document";
  title: string;
  subtitle: string;
  /** Párrafos del resumen ejecutivo. */
  executiveSummary: string[];
  sections: DocumentOutlineSection[];
  keyFindings: string[];
  /** `ai` si lo redactó Gemini; `local` si salió directo del tablero. */
  source: "ai" | "local";
}

// ----------------------------------------------------------------------------
// Presentación (.pptx)
// ----------------------------------------------------------------------------

export type SlideLayout = "cover" | "summary" | "content" | "table" | "formula" | "closing";

export interface SlideOutline {
  layout: SlideLayout;
  title: string;
  subtitle: string | null;
  bullets: string[];
  table: OutlineTable | null;
  formula: OutlineFormula | null;
  photoId: string | null;
}

export interface SlidesOutline {
  mode: "slides";
  title: string;
  subtitle: string;
  slides: SlideOutline[];
  source: "ai" | "local";
}

export type ExportOutline = DocumentOutline | SlidesOutline;

export const SLIDES_MIN = 5;
export const SLIDES_MAX = 9;
export const SLIDE_MAX_BULLETS = 5;
export const SLIDE_BULLET_MAX_CHARS = 150;
/** Filas visibles de una tabla en una diapositiva (el resto se resume). */
export const SLIDE_TABLE_MAX_ROWS = 8;
export const INSTRUCTION_MAX_CHARS = 240;

// ----------------------------------------------------------------------------
// Petición: tarjetas del lienzo ya resueltas (sin imágenes)
// ----------------------------------------------------------------------------

export interface ExportPhotoRef {
  photoId: string;
  /** «Herida · Ficha de paciente». */
  label: string;
  width?: number;
  height?: number;
}

export interface ExportCard {
  /** Referencia corta y estable: «C1», «C2»… */
  ref: string;
  title: string;
  /** Categoría legible («Resumen», «Presupuesto»…). */
  category: string;
  blocks: OutlineBlock[];
  table: OutlineTable | null;
  formula: OutlineFormula | null;
  note: string | null;
  photos: ExportPhotoRef[];
}

export interface ExportOutlineRequest {
  mode: ExportMode;
  title: string;
  /** «Tono formal para directivos»… (opcional). */
  instruction?: string;
  cards: ExportCard[];
  apiKey?: string;
}

export type ExportOutlineResponse =
  | { ok: true; outline: ExportOutline; model: string }
  | { ok: false; issue: OracleIssue };

/** Foto lista para dibujar/incrustar (los bytes nunca salen del dispositivo). */
export interface ExportPhotoAsset {
  photoId: string;
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** Foto ya convertida a JPEG/PNG para incrustarla en Word o PowerPoint. */
export interface EmbeddedImage {
  /** `data:image/jpeg;base64,…` o `data:image/png;base64,…`. */
  dataUrl: string;
  type: "jpg" | "png";
  width: number;
  height: number;
  alt: string;
}

export type EmbeddedImages = Map<string, EmbeddedImage>;

/** Tamaño que cabe en `maxW × maxH` sin deformar la imagen. */
export function fitInside(width: number, height: number, maxW: number, maxH: number): { w: number; h: number } {
  const w = width > 0 ? width : maxW;
  const h = height > 0 ? height : maxH;
  const scale = Math.min(maxW / w, maxH / h);
  return { w: w * scale, h: h * scale };
}

// ----------------------------------------------------------------------------
// Plan del Día → tarjetas de exportación
// ----------------------------------------------------------------------------

function tableOf(section: PlanSection): OutlineTable | null {
  if (!section.table || section.formula) return null;
  return {
    title: section.title,
    header: section.table.header,
    rows: section.table.rows,
    total: section.table.total,
    kind: section.table.kind ?? "sheet",
  };
}

function formulaOf(section: PlanSection): OutlineFormula | null {
  const f = section.formula;
  if (!f) return null;
  return {
    title: section.title,
    latex: f.latex,
    expression: f.expression,
    substitutionLatex: f.substitutionLatex,
    substitutionText: f.substitutionText ?? null,
    result: f.result ?? section.table?.total ?? { label: "Resultado", value: "Sin resultado" },
    variables: section.table?.rows ?? [],
  };
}

function blocksOf(section: PlanSection): OutlineBlock[] {
  const blocks: OutlineBlock[] = section.blocks.map((b: PlanTextBlock) => ({ type: b.type, text: b.text }));
  for (const item of section.checklist) blocks.push({ type: "bullet", text: `${item.checked ? "☑" : "☐"} ${item.text}` });
  if (section.link) {
    const { label, url } = section.link;
    blocks.push({ type: "paragraph", text: label !== url ? `${label} — ${url}` : url });
  }
  return blocks;
}

/** Tarjetas del Plan del Día (orden ejecutivo) → contexto de exportación. */
export function exportCardsFromPlan(doc: PlanDocument): ExportCard[] {
  return doc.sections.map((section, i) => ({
    ref: `C${i + 1}`,
    title: section.title,
    category: PLAN_CATEGORY_LABELS[section.category],
    blocks: blocksOf(section),
    table: tableOf(section),
    formula: formulaOf(section),
    note: section.note,
    photos: section.images
      .filter((img) => img.id)
      .map((img) => ({
        photoId: img.id!,
        label: `${img.label ?? "Foto"} · ${section.title}`,
        ...(img.width ? { width: img.width } : {}),
        ...(img.height ? { height: img.height } : {}),
      })),
  }));
}

/** Fotos del Plan del Día por `photoId` (para incrustarlas al generar el archivo). */
export function photoAssetsFromPlan(doc: PlanDocument): Map<string, ExportPhotoAsset> {
  const map = new Map<string, ExportPhotoAsset>();
  for (const section of doc.sections) {
    for (const img of section.images) {
      if (!img.id || !img.src || map.has(img.id)) continue;
      map.set(img.id, {
        photoId: img.id,
        src: img.src,
        alt: img.alt,
        width: img.width && img.width > 0 ? img.width : 1280,
        height: img.height && img.height > 0 ? img.height : 960,
      });
    }
  }
  return map;
}

// ----------------------------------------------------------------------------
// Saneado de la petición (servidor): nunca confiar en el cliente
// ----------------------------------------------------------------------------

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "";

const oneLine = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const MAX_CARDS = 60;
const MAX_ROWS = 60;
const MAX_COLS = 8;

function cleanRows(value: unknown, maxRows = MAX_ROWS): string[][] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxRows)
    .filter(Array.isArray)
    .map((row: unknown[]) => row.slice(0, MAX_COLS).map((cell) => oneLine(String(cell ?? ""), 200)));
}

function cleanPair(value: unknown): { label: string; value: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const label = oneLine(v.label, 120);
  const val = oneLine(v.value, 160);
  return label || val ? { label: label || "Total", value: val } : null;
}

export function sanitizeTable(value: unknown, fallbackTitle: string): OutlineTable | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Record<string, unknown>;
  const rows = cleanRows(t.rows);
  const header = Array.isArray(t.header) ? t.header.slice(0, MAX_COLS).map((c) => oneLine(String(c ?? ""), 120)) : null;
  if (rows.length === 0 && !header) return null;
  return {
    title: oneLine(t.title, 160) || fallbackTitle,
    header,
    rows,
    total: cleanPair(t.total),
    kind: t.kind === "fields" ? "fields" : "sheet",
  };
}

export function sanitizeFormula(value: unknown, fallbackTitle: string): OutlineFormula | null {
  if (!value || typeof value !== "object") return null;
  const f = value as Record<string, unknown>;
  const expression = oneLine(f.expression, 400);
  const latex = str(f.latex, 600);
  if (!expression && !latex) return null;
  return {
    title: oneLine(f.title, 160) || fallbackTitle,
    latex,
    expression,
    substitutionLatex: str(f.substitutionLatex, 800) || null,
    substitutionText: oneLine(f.substitutionText, 400) || null,
    result: cleanPair(f.result) ?? { label: "Resultado", value: "Sin resultado" },
    variables: cleanRows(f.variables, 24),
  };
}

function sanitizeBlocks(value: unknown): OutlineBlock[] {
  if (!Array.isArray(value)) return [];
  const out: OutlineBlock[] = [];
  for (const item of value.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const text = str(b.text, 1200);
    if (!text) continue;
    out.push({ type: b.type === "heading" || b.type === "bullet" ? b.type : "paragraph", text });
  }
  return out;
}

/** Cuerpo JSON de la petición → tarjetas válidas (referencias únicas C1…Cn). */
export function sanitizeExportCards(value: unknown): ExportCard[] {
  if (!Array.isArray(value)) return [];
  const cards: ExportCard[] = [];
  const photoIds = new Set<string>();
  for (const item of value.slice(0, MAX_CARDS)) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const title = oneLine(c.title, 160) || "Sin título";
    const photos: ExportPhotoRef[] = [];
    for (const p of Array.isArray(c.photos) ? c.photos.slice(0, 12) : []) {
      if (!p || typeof p !== "object") continue;
      const photo = p as Record<string, unknown>;
      const photoId = oneLine(photo.photoId, 120);
      if (!photoId || photoIds.has(photoId)) continue;
      photoIds.add(photoId);
      photos.push({ photoId, label: oneLine(photo.label, 160) || `Foto · ${title}` });
    }
    cards.push({
      ref: `C${cards.length + 1}`,
      title,
      category: oneLine(c.category, 40) || "Tarjeta",
      blocks: sanitizeBlocks(c.blocks),
      table: sanitizeTable(c.table, title),
      formula: sanitizeFormula(c.formula, title),
      note: str(c.note, 1500) || null,
      photos,
    });
  }
  return cards;
}

// ----------------------------------------------------------------------------
// Utilidades de texto compartidas
// ----------------------------------------------------------------------------

/** Recorta en un límite de palabra y añade «…». */
export function clipWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max - 1);
  const cut = head.lastIndexOf(" ");
  return `${(cut > max * 0.6 ? head.slice(0, cut) : head).replace(/[\s,;:.—-]+$/, "")}…`;
}

/** Nombre de archivo seguro: «Plan Boda 2027» → «Plan-Boda-2027». */
export function exportFileBase(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "Andros";
}

export function formatExportDate(date: Date): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "long" }).format(date);
}
