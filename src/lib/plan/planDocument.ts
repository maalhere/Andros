// ============================================================================
// ANDROS — «PLAN DEL DÍA» (funciones puras, sin store: cliente y vista pública)
//
// Convierte las tarjetas de un espacio en un documento ejecutivo ordenado por
// prioridad: Resumen → Cronograma → Presupuesto → Logística → Roles → resto
// (por posición en el lienzo). Lo usan:
//   · la exportación «Plan del Día» (PDF imprimible + resumen para WhatsApp),
//   · la Vista Invitado pública de solo lectura (`/ver/<token>`).
// Los totales del presupuesto se recalculan con el motor de `sheet.ts`, así el
// documento nunca muestra una cifra vieja aunque la tarjeta no se haya abierto.
// ============================================================================

import type { EngineeringNodeData, NodeConnection, SpreadsheetCell } from "@/types/workspace";
import { SHEET_COLUMN_LETTERS, computeSheet, rawOfCells } from "@/lib/canvas/sheet";
import { allPhotos, formatFieldValue } from "@/lib/forms/formSchema";
import {
  expressionLatex,
  formatVariableValue,
  formulaResultLine,
  originLabel,
  resolveFormula,
  type FormulaGraph,
} from "@/lib/math/formulaBinding";

export type PlanCategory = "summary" | "timeline" | "budget" | "logistics" | "roles" | "other";

export interface PlanTextBlock {
  type: "heading" | "paragraph" | "bullet";
  text: string;
}

export interface PlanChecklistItem {
  text: string;
  checked: boolean;
}

export interface PlanTable {
  /** Cabecera (fila 1 de la hoja) o `null` si la fila 1 ya son datos. */
  header: string[] | null;
  rows: string[][];
  /** Fila «Total» de la hoja o, si no hay, la suma de la columna de montos. */
  total: { label: string; value: string } | null;
  /** `fields`: tabla «Campo | Valor» de una ficha (valores de texto, alineados a la izquierda). */
  kind?: "sheet" | "fields";
}

export interface PlanImage {
  src: string;
  alt: string;
}

export interface PlanSection {
  id: string;
  title: string;
  tag: string;
  category: PlanCategory;
  blocks: PlanTextBlock[];
  checklist: PlanChecklistItem[];
  table: PlanTable | null;
  /** Texto secundario: justificación del cálculo, descripción del enlace… */
  note: string | null;
  link: { url: string; label: string } | null;
  /** Fotos de una ficha (se imprimen en el PDF y se ven en la Vista Invitado). */
  images: PlanImage[];
  /** Ficha de Fórmula: LaTeX simbólico y sustitución numérica (KaTeX en pantalla y PDF). */
  formula: PlanFormula | null;
}

export interface PlanFormula {
  latex: string;
  /** `\text{IMC} = \frac{82}{1.75^{2}}` o `null` si faltan datos. */
  substitutionLatex: string | null;
  /** Expresión legible para WhatsApp: «m / h^2». */
  expression: string;
}

export interface PlanDocument {
  title: string;
  generatedAt: Date;
  sections: PlanSection[];
  /** Total del primer presupuesto del tablero (para el encabezado). */
  budgetTotal: string | null;
}

// ----------------------------------------------------------------------------
// Prioridad ejecutiva
// ----------------------------------------------------------------------------

export const PLAN_CATEGORY_ORDER: PlanCategory[] = ["summary", "timeline", "budget", "logistics", "roles", "other"];

export const PLAN_CATEGORY_LABELS: Record<PlanCategory, string> = {
  summary: "Resumen",
  timeline: "Cronograma",
  budget: "Presupuesto",
  logistics: "Logística",
  roles: "Roles",
  other: "Más tarjetas",
};

/** Mayúsculas y sin tildes: «Logística» → «LOGISTICA». */
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();

const CATEGORY_PATTERNS: [PlanCategory, RegExp][] = [
  ["summary", /\b(RESUMEN|META|OBJETIVOS?|SUMMARY)\b/],
  ["timeline", /\b(CRONOGRAMA|AGENDA|CALENDARIO|ITINERARIO|TIMELINE|PROGRAMA)\b/],
  ["budget", /\b(PRESUPUESTOS?|COSTOS?|GASTOS|BUDGET|FINANZAS)\b/],
  ["logistics", /\b(LOGISTICA|PENDIENTES|TAREAS|PREPARATIVOS|CHECKLIST)\b/],
  ["roles", /\b(ROLES|RESPONSABLES|EQUIPO|ENCARGADOS)\b/],
];

function categoryOf(node: EngineeringNodeData): PlanCategory {
  // La etiqueta (codeTag) manda; el título es el respaldo.
  for (const source of [node.codeTag, node.title]) {
    const text = normalize(source ?? "");
    for (const [category, pattern] of CATEGORY_PATTERNS) if (pattern.test(text)) return category;
  }
  return node.type === "calc-latex-node" ? "budget" : "other";
}

// ----------------------------------------------------------------------------
// Hojas de cálculo → tabla con total
// ----------------------------------------------------------------------------

const AMOUNT_HEADER = /MONTO|COSTO|PRECIO|IMPORTE|VALOR|TOTAL|SUBTOTAL|\$/;
const NUMERIC_TEXT = /^[-+$€£\s\d.,%]+$/;

function tableFromCells(cells: Record<string, SpreadsheetCell>, size: { rows: number; columns: number }): PlanTable | null {
  const raw = rawOfCells(cells);
  // Recalcula con el motor de la tarjeta: nunca se muestra un total viejo.
  const computed = computeSheet(raw);
  const columns = Math.max(1, Math.min(size.columns, SHEET_COLUMN_LETTERS.length));
  const letters = SHEET_COLUMN_LETTERS.slice(0, columns).split("");
  const lastRow = Math.max(
    size.rows,
    ...Object.keys(raw).map((address) => Number(/\d+$/.exec(address)?.[0] ?? 0))
  );

  const valueAt = (letter: string, row: number) => computed[`${letter}${row}`]?.computed ?? "";

  const allRows: { row: number; values: string[] }[] = [];
  for (let row = 1; row <= lastRow; row += 1) {
    const values = letters.map((letter) => valueAt(letter, row));
    if (values.some((v) => v.trim() !== "")) allRows.push({ row, values });
  }
  if (allRows.length === 0) return null;

  // ¿La fila 1 es cabecera? Sí, si tiene texto y ningún número.
  const first = allRows[0];
  const hasHeader =
    first.row === 1 && first.values.some((v) => v.trim() !== "" && !NUMERIC_TEXT.test(v.trim()));
  const header = hasHeader ? first.values : null;
  const body = hasHeader ? allRows.slice(1) : allRows;

  // Columna de montos: la que se llame «Monto», «Costo»… o la B.
  let amountIndex = header ? header.findIndex((h, i) => i > 0 && AMOUNT_HEADER.test(normalize(h))) : -1;
  if (amountIndex < 1) amountIndex = Math.min(1, columns - 1);
  const amountLetter = letters[amountIndex];
  const currency = Object.entries(raw).some(
    ([address, text]) => address.startsWith(amountLetter) && /\$/.test(text)
  )
    ? "$"
    : "";

  // Fila «Total» escrita por la persona (o por la plantilla).
  const totalRowIndex = body.findIndex((r) => /^\s*(TOTAL|SUMA)\b/.test(normalize(r.values[0] ?? "")));
  let total: PlanTable["total"] = null;
  const rows = body.filter((_, i) => i !== totalRowIndex).map((r) => r.values);

  if (totalRowIndex >= 0) {
    const totalRow = body[totalRowIndex];
    const value = totalRow.values[amountIndex] ?? "";
    if (value.trim()) total = { label: totalRow.values[0].trim() || "Total", value: `${currency}${value}` };
  } else if (amountIndex > 0) {
    // Sin fila «Total»: suma de la columna de montos con el mismo motor.
    const firstDataRow = hasHeader ? 2 : 1;
    const probe = "ZZ999";
    const sum = computeSheet({ ...raw, [probe]: `=SUM(${amountLetter}${firstDataRow}:${amountLetter}${lastRow})` })[probe];
    const anyNumber = rows.some((r) => NUMERIC_TEXT.test((r[amountIndex] ?? "").trim()) && /\d/.test(r[amountIndex] ?? ""));
    if (sum && !sum.error && anyNumber) total = { label: "Total", value: `${currency}${sum.computed}` };
  }

  return { header, rows, total };
}

// ----------------------------------------------------------------------------
// Nodo → sección
// ----------------------------------------------------------------------------

function sectionFromNode(node: EngineeringNodeData, graph: FormulaGraph): PlanSection | null {
  const base = {
    id: node.id,
    title: node.title?.trim() || "Sin título",
    tag: node.codeTag ?? "",
    category: categoryOf(node),
    blocks: [] as PlanTextBlock[],
    checklist: [] as PlanChecklistItem[],
    table: null as PlanTable | null,
    note: null as string | null,
    link: null as PlanSection["link"],
    images: [] as PlanImage[],
    formula: null as PlanFormula | null,
  };

  switch (node.type) {
    case "sketch-note-node": {
      const data = node.sketchNoteData;
      const blocks = (Array.isArray(data.textBlocks) ? data.textBlocks : [])
        .filter((b) => b && typeof b.text === "string" && b.text.trim())
        .map((b) => ({ type: b.type, text: b.text.trim() }));
      const checklist = (Array.isArray(data.checklistItems) ? data.checklistItems : [])
        .filter((c) => c && typeof c.text === "string" && c.text.trim())
        .map((c) => ({ text: c.text.trim(), checked: Boolean(c.checked) }));
      if (blocks.length === 0 && checklist.length === 0) return null;
      return { ...base, blocks, checklist };
    }
    case "calc-latex-node": {
      const data = node.calcLatexData;
      const table = tableFromCells(data.gridCells ?? {}, data.gridSize ?? { rows: 6, columns: 2 });
      const note = data.justificationText?.trim() || null;
      if (!table && !note) return null;
      return { ...base, table, note };
    }
    case "resource-link-node": {
      const data = node.resourceLinkData;
      if (!data.url) return null;
      return {
        ...base,
        link: { url: data.url, label: data.title?.trim() || data.url },
        note: data.description?.trim() || null,
      };
    }
    case "file-node": {
      const name = node.fileData.fileName;
      return name ? { ...base, note: `Archivo adjunto: ${name}` } : null;
    }
    case "code-lab-node": {
      const vars = Object.entries(node.codeLabData.result?.variables ?? {}).slice(0, 8);
      if (vars.length === 0) return null;
      return {
        ...base,
        blocks: vars.map(([name, value]) => ({
          type: "bullet" as const,
          text: `${name} = ${Array.isArray(value) ? `[${value.slice(0, 6).join(", ")}${value.length > 6 ? ", …" : ""}]` : value}`,
        })),
      };
    }
    case "ai-chat-node": {
      const summary = node.aiChatData.summary?.trim() || node.summary?.trim();
      return summary ? { ...base, note: summary } : null;
    }
    case "form-sheet-node": {
      const data = node.formSheetData;
      const fields = (Array.isArray(data.fields) ? data.fields : []).filter((f) => f.type !== "photo");
      const rows = fields.map((f) => {
        const value = formatFieldValue(f);
        const unit = value && f.unit && f.type === "number" ? ` ${f.unit}` : "";
        return [f.label, value ? `${value}${unit}${f.needsReview ? " (revisar)" : ""}` : "—"];
      });
      const images = allPhotos(data)
        .slice(0, 8)
        .map(({ photo, label }) => ({
          src: photo.src || photo.thumb,
          alt: `Foto «${label}» de la ficha «${base.title}»`,
        }))
        .filter((img) => img.src);
      if (rows.length === 0 && images.length === 0) return null;
      return {
        ...base,
        table: rows.length > 0 ? { header: ["Campo", "Valor"], rows, total: null, kind: "fields" as const } : null,
        note: data.batchLabel ? `Expediente: ${data.batchLabel}` : null,
        images,
      };
    }
    case "formula-sheet-node": {
      // Recalculada con los datos actuales de sus fichas conectadas (nunca un resultado viejo).
      const data = node.formulaSheetData;
      if (!data.expression.trim() && !data.latex.trim()) return null;
      const resolved = resolveFormula(node, graph);
      const rows = resolved.variables.map((entry) => [
        `${entry.variable.label} (${entry.variable.key})`,
        `${formatVariableValue(entry)} · ${originLabel(entry)}`,
      ]);
      return {
        ...base,
        table: {
          header: ["Variable", "Valor"],
          rows,
          total: {
            label: data.resultLabel || "Resultado",
            value: formulaResultLine(data, resolved),
          },
          kind: "fields" as const,
        },
        note: data.description?.trim() || null,
        formula: {
          latex: data.latex.trim() || expressionLatex(data),
          substitutionLatex: resolved.substitutionLatex,
          expression: data.expression.trim(),
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Construye el documento ejecutivo a partir de las tarjetas del espacio.
 * `connections` permite recalcular las Fichas de Fórmula con sus fichas conectadas.
 */
export function buildPlanDocument(
  title: string,
  nodes: EngineeringNodeData[],
  generatedAt = new Date(),
  connections: NodeConnection[] = []
): PlanDocument {
  const graph: FormulaGraph = { nodes, connections };
  const withPosition = nodes
    .map((node) => ({ node, section: sectionFromNode(node, graph) }))
    .filter((entry): entry is { node: EngineeringNodeData; section: PlanSection } => entry.section !== null);

  withPosition.sort((a, b) => {
    const byCategory =
      PLAN_CATEGORY_ORDER.indexOf(a.section.category) - PLAN_CATEGORY_ORDER.indexOf(b.section.category);
    if (byCategory !== 0) return byCategory;
    // Misma categoría: como se lee el lienzo (arriba → abajo, izquierda → derecha).
    const dy = a.node.position.y - b.node.position.y;
    return Math.abs(dy) > 40 ? dy : a.node.position.x - b.node.position.x;
  });

  const sections = withPosition.map((entry) => entry.section);
  // Una fórmula como «Costo por persona» se agrupa en Presupuesto, pero no es el total del presupuesto.
  const budgetTotal =
    sections.find((s) => s.category === "budget" && !s.formula && s.table?.total)?.table?.total?.value ?? null;

  return { title: title.trim() || "Mi espacio", generatedAt, sections, budgetTotal };
}

// ----------------------------------------------------------------------------
// Formatos de salida
// ----------------------------------------------------------------------------

export type BlockGroup =
  | { kind: "list"; items: string[] }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string };

/** Agrupa las viñetas seguidas en una sola lista. */
export function groupBlocks(section: PlanSection): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const block of section.blocks) {
    if (block.type === "bullet") {
      const last = groups[groups.length - 1];
      if (last?.kind === "list") last.items.push(block.text);
      else groups.push({ kind: "list", items: [block.text] });
    } else {
      groups.push({ kind: block.type, text: block.text });
    }
  }
  return groups;
}

export function formatPlanDate(date: Date): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short" }).format(date);
}

const SECTION_EMOJI: Record<PlanCategory, string> = {
  summary: "🎯",
  timeline: "🗓️",
  budget: "💰",
  logistics: "📦",
  roles: "👥",
  other: "📝",
};

/** Máximo de líneas por sección en WhatsApp (el resto se resume). */
const WHATSAPP_MAX_LINES = 14;

/** Quita los caracteres que WhatsApp interpreta como formato dentro de un dato. */
const plain = (text: string) => text.replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();

function sectionLines(section: PlanSection): string[] {
  const lines: string[] = [];
  if (section.formula?.expression) lines.push(`Fórmula: ${plain(section.formula.expression)}`);
  for (const block of section.blocks) {
    if (block.type === "heading") lines.push(`*${plain(block.text)}*`);
    else if (block.type === "bullet") lines.push(`• ${plain(block.text)}`);
    else lines.push(plain(block.text));
  }
  for (const item of section.checklist) lines.push(`${item.checked ? "✅" : "☐"} ${plain(item.text)}`);
  if (section.table) {
    for (const row of section.table.rows) {
      const [label, ...rest] = row.map(plain);
      const values = rest.filter(Boolean).join(" · ");
      if (label || values) lines.push(`• ${label}${label && values ? ": " : ""}${values}`);
    }
  }
  if (section.link) lines.push(`🔗 ${plain(section.link.label)} — ${section.link.url}`);
  if (section.images.length > 0) {
    lines.push(`📷 ${section.images.length} foto${section.images.length === 1 ? "" : "s"} en el tablero`);
  }
  if (section.note && section.category !== "budget") lines.push(plain(section.note));
  if (lines.length > WHATSAPP_MAX_LINES) {
    const hidden = lines.length - (WHATSAPP_MAX_LINES - 1);
    return [...lines.slice(0, WHATSAPP_MAX_LINES - 1), `… y ${hidden} más en el tablero`];
  }
  return lines;
}

/** Resumen ejecutivo listo para pegar en un grupo de WhatsApp. */
export function planToWhatsApp(doc: PlanDocument): string {
  const out: string[] = [`📋 *${plain(doc.title)}*`, `Plan del día · ${formatPlanDate(doc.generatedAt)}`];
  if (doc.sections.length === 0) {
    out.push("", "El tablero todavía no tiene tarjetas con contenido.");
  }
  for (const section of doc.sections) {
    const total = section.table?.total;
    const heading = `${SECTION_EMOJI[section.category]} *${plain(section.title)}*${
      total ? ` · ${plain(total.label)}: *${plain(total.value)}*` : ""
    }`;
    out.push("", heading, ...sectionLines(section));
  }
  out.push("", "— Organizado en Andros");
  return out.join("\n");
}
