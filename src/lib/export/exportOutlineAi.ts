// ============================================================================
// ANDROS — SÍNTESIS DE EXPORTACIÓN CON IA: CONTEXTO Y VALIDACIÓN (servidor)
//
//   cardsToPrompt   tarjetas → texto ≤ 12 000 caracteres, con referencias
//                   cortas [C1] (tarjetas) y [F1] (fotos: solo la etiqueta).
//   outlineFromAi   JSON del modelo → `DocumentOutline` / `SlidesOutline`
//                   válidos: las tablas y fórmulas se rellenan con los datos
//                   reales de las tarjetas citadas; las fotos inexistentes se
//                   descartan; lo que el modelo omitió se conserva en un anexo.
// ============================================================================

import { clipCleanly, MAX_TOTAL_CHARS } from "@/lib/canvas/contextGraph";
import { buildLocalDocumentOutline, buildLocalSlidesOutline } from "./buildLocalExportOutline";
import {
  SLIDES_MAX,
  SLIDES_MIN,
  SLIDE_BULLET_MAX_CHARS,
  SLIDE_MAX_BULLETS,
  clipWords,
  type DocumentOutline,
  type DocumentOutlineSection,
  type ExportCard,
  type ExportMode,
  type OutlineBlock,
  type OutlineFormula,
  type OutlineTable,
  type SlideLayout,
  type SlideOutline,
  type SlidesOutline,
} from "./exportOutline";

/** Referencias de fotos [F1]… ↔ `photoId` real (los ids largos se maltratan en el modelo). */
export interface PhotoRefMap {
  toRef: Map<string, string>;
  toId: Map<string, string>;
}

export function photoRefMap(cards: ExportCard[]): PhotoRefMap {
  const toRef = new Map<string, string>();
  const toId = new Map<string, string>();
  for (const card of cards) {
    for (const photo of card.photos) {
      const ref = `F${toRef.size + 1}`;
      toRef.set(photo.photoId, ref);
      toId.set(ref, photo.photoId);
    }
  }
  return { toRef, toId };
}

function tableText(table: OutlineTable): string {
  const lines: string[] = [];
  if (table.header) lines.push(`| ${table.header.join(" | ")} |`);
  for (const row of table.rows) lines.push(`| ${row.join(" | ")} |`);
  if (table.total) lines.push(`${table.total.label}: ${table.total.value}`);
  return lines.join("\n");
}

function formulaText(formula: OutlineFormula): string {
  const lines = [`Fórmula: ${formula.expression || formula.latex}`];
  for (const row of formula.variables) lines.push(`- ${row.join(": ")}`);
  if (formula.substitutionText) lines.push(`Sustitución: ${formula.substitutionText}`);
  lines.push(`${formula.result.label} = ${formula.result.value}`);
  return lines.join("\n");
}

function cardText(card: ExportCard, refs: PhotoRefMap): string {
  const lines: string[] = [];
  for (const b of card.blocks) lines.push(b.type === "heading" ? `## ${b.text}` : b.type === "bullet" ? `- ${b.text}` : b.text);
  if (card.note) lines.push(`Nota: ${card.note}`);
  if (card.table) lines.push(`TABLA (citable como ${card.ref}):\n${tableText(card.table)}`);
  if (card.formula) lines.push(`CÁLCULO (citable como ${card.ref}):\n${formulaText(card.formula)}`);
  if (card.photos.length > 0) {
    lines.push(`Fotos: ${card.photos.map((p) => `[${refs.toRef.get(p.photoId)}] ${p.label}`).join("; ")}`);
  }
  return lines.join("\n") || "(sin texto)";
}

/** Contexto del tablero para el modelo, dentro del tope global de 12 000 caracteres. */
export function cardsToPrompt(cards: ExportCard[], refs: PhotoRefMap, budget = MAX_TOTAL_CHARS): string {
  const parts: string[] = [];
  /** Se reserva sitio para la nota final «… y N tarjetas más». */
  const RESERVE = 80;
  let room = budget - RESERVE;
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const header = `[${card.ref}] «${card.title}» (${card.category})`;
    // Reparto justo: cada tarjeta puede usar su parte del espacio que queda (mín. 300).
    const share = Math.max(300, Math.floor(room / (cards.length - i)));
    // −3: salto tras la cabecera, «…» del recorte y separación entre tarjetas.
    const bodyMax = Math.min(share, room) - header.length - 3;
    if (bodyMax < 40) {
      parts.push(`… y ${cards.length - i} tarjetas más (sin espacio para su contenido).`);
      break;
    }
    const chunk = `${header}\n${clipCleanly(cardText(card, refs), bodyMax)}`;
    parts.push(chunk);
    room -= chunk.length + 2;
  }
  return parts.join("\n\n");
}

// ----------------------------------------------------------------------------
// Respuesta del modelo → estructura validada
// ----------------------------------------------------------------------------

const oneLine = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";

const stringList = (value: unknown, maxItems: number, maxChars: number): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .map((item) => text(item, maxChars).replace(/^[-•*]\s*/, ""))
    .filter(Boolean)
    .slice(0, maxItems);

const refList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .map((item) => oneLine(item, 140).replace(/^\[|\]$/g, "").toUpperCase())
    .filter(Boolean);

interface Resolver {
  table: (ref: string) => OutlineTable | null;
  formula: (ref: string) => OutlineFormula | null;
  /** Primera vez que se cita la foto: su `photoId`; repetida o inventada: `null`. */
  photo: (ref: string) => string | null;
  usedTables: Set<string>;
  usedFormulas: Set<string>;
  usedPhotos: Set<string>;
}

function resolver(cards: ExportCard[], refs: PhotoRefMap): Resolver {
  const byRef = new Map(cards.map((c) => [c.ref.toUpperCase(), c]));
  const usedTables = new Set<string>();
  const usedFormulas = new Set<string>();
  const usedPhotos = new Set<string>();
  return {
    usedTables,
    usedFormulas,
    usedPhotos,
    table(ref) {
      const card = byRef.get(ref);
      if (!card?.table) return null;
      usedTables.add(card.ref);
      return card.table;
    },
    formula(ref) {
      const card = byRef.get(ref);
      if (!card?.formula) return null;
      usedFormulas.add(card.ref);
      return card.formula;
    },
    photo(ref) {
      const id = refs.toId.get(ref) ?? (refs.toRef.has(ref) ? ref : null);
      if (!id || usedPhotos.has(id)) return null;
      usedPhotos.add(id);
      return id;
    },
  };
}

function documentFromAi(raw: Record<string, unknown>, title: string, cards: ExportCard[], refs: PhotoRefMap): DocumentOutline | null {
  const r = resolver(cards, refs);
  const sections: DocumentOutlineSection[] = [];
  for (const item of Array.isArray(raw.sections) ? raw.sections.slice(0, 14) : []) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const heading = oneLine(s.heading ?? s.title, 160);
    const blocks: OutlineBlock[] = [
      ...stringList(s.paragraphs, 8, 1400).map((t) => ({ type: "paragraph" as const, text: t })),
      ...stringList(s.bullets, 12, 400).map((t) => ({ type: "bullet" as const, text: t })),
    ];
    const tables = refList(s.tableRefs ?? s.tables).map(r.table).filter((t): t is OutlineTable => t !== null);
    const formulas = refList(s.formulaRefs ?? s.formulas).map(r.formula).filter((f): f is OutlineFormula => f !== null);
    const photoIds = refList(s.photoIds ?? s.photos).map(r.photo).filter((p): p is string => p !== null);
    if (!heading && blocks.length === 0 && tables.length === 0 && formulas.length === 0) continue;
    sections.push({ heading: heading || "Sección", kicker: oneLine(s.kicker, 40) || null, blocks, tables, formulas, photoIds });
  }
  if (sections.length === 0) return null;

  // Ninguna cifra ni foto del tablero se pierde: lo no citado va a un anexo.
  const annexTables = cards.filter((c) => c.table && !r.usedTables.has(c.ref)).map((c) => c.table!);
  const annexFormulas = cards.filter((c) => c.formula && !r.usedFormulas.has(c.ref)).map((c) => c.formula!);
  const annexPhotos = cards.flatMap((c) => c.photos.map((p) => p.photoId)).filter((id) => !r.usedPhotos.has(id));
  if (annexTables.length + annexFormulas.length + annexPhotos.length > 0) {
    sections.push({
      heading: "Anexo: datos del tablero",
      kicker: "Anexo",
      blocks: [{ type: "paragraph", text: "Tablas, cálculos y fotos del tablero que complementan este documento." }],
      tables: annexTables,
      formulas: annexFormulas,
      photoIds: annexPhotos,
    });
  }

  return {
    mode: "document",
    title: oneLine(raw.title, 160) || title,
    subtitle: oneLine(raw.subtitle, 200),
    executiveSummary: stringList(raw.executiveSummary ?? raw.summary, 4, 1400),
    sections,
    keyFindings: stringList(raw.keyFindings ?? raw.findings, 8, 300),
    source: "ai",
  };
}

const LAYOUTS = new Set<SlideLayout>(["cover", "summary", "content", "table", "formula", "closing"]);

function slidesFromAi(raw: Record<string, unknown>, title: string, cards: ExportCard[], refs: PhotoRefMap): SlidesOutline | null {
  const r = resolver(cards, refs);
  const slides: SlideOutline[] = [];
  for (const item of Array.isArray(raw.slides) ? raw.slides.slice(0, SLIDES_MAX + 3) : []) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const declared = oneLine(s.layout ?? s.type, 20).toLowerCase() as SlideLayout;
    const table = refList(s.tableRef).map(r.table).find(Boolean) ?? null;
    const formula = table ? null : (refList(s.formulaRef).map(r.formula).find(Boolean) ?? null);
    const photoId = refList(s.photoId ?? s.photo).map(r.photo).find(Boolean) ?? null;
    const bullets = stringList(s.bullets, SLIDE_MAX_BULLETS, 400).map((b) => clipWords(b, SLIDE_BULLET_MAX_CHARS));
    const layout: SlideLayout = table ? "table" : formula ? "formula" : LAYOUTS.has(declared) && declared !== "table" && declared !== "formula" ? declared : "content";
    const slideTitle = oneLine(s.title, 120);
    if (!slideTitle && bullets.length === 0 && !table && !formula) continue;
    slides.push({
      layout,
      title: slideTitle || title,
      subtitle: oneLine(s.subtitle, 160) || null,
      bullets,
      table,
      formula,
      photoId: layout === "table" ? null : photoId,
    });
  }
  if (slides.length < 3) return null;

  // Portada al inicio y cierre al final, siempre.
  if (slides[0].layout !== "cover") {
    slides.unshift({ layout: "cover", title: oneLine(raw.title, 120) || title, subtitle: oneLine(raw.subtitle, 160) || null, bullets: [], table: null, formula: null, photoId: null });
  }
  const closingIndex = slides.findIndex((s, i) => i > 0 && s.layout === "closing");
  if (closingIndex === -1) {
    slides.push({ layout: "closing", title: "Próximos pasos", subtitle: null, bullets: ["Revisar el contenido con el equipo y acordar responsables."], table: null, formula: null, photoId: null });
  } else if (closingIndex !== slides.length - 1) {
    slides.push(...slides.splice(closingIndex, 1));
  }
  // Mazo de 5 a 9: se recortan diapositivas intermedias si sobran.
  while (slides.length > SLIDES_MAX) slides.splice(slides.length - 2, 1);
  if (slides.length < SLIDES_MIN) return null;

  return {
    mode: "slides",
    title: oneLine(raw.title, 120) || title,
    subtitle: oneLine(raw.subtitle, 160),
    slides,
    source: "ai",
  };
}

/**
 * JSON del modelo → estructura lista para maquetar. Si llega vacía o rota,
 * se usa la estructura local (mismo contenido, sin redacción) para no fallar.
 */
export function outlineFromAi(
  raw: unknown,
  mode: ExportMode,
  title: string,
  cards: ExportCard[],
  refs: PhotoRefMap,
  generatedAt = new Date()
): { outline: DocumentOutline | SlidesOutline; usedFallback: boolean } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (mode === "slides") {
    const deck = slidesFromAi(o, title, cards, refs);
    return deck ? { outline: deck, usedFallback: false } : { outline: buildLocalSlidesOutline(title, cards, generatedAt), usedFallback: true };
  }
  const doc = documentFromAi(o, title, cards, refs);
  return doc ? { outline: doc, usedFallback: false } : { outline: buildLocalDocumentOutline(title, cards, generatedAt), usedFallback: true };
}
