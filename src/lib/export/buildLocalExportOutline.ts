// ============================================================================
// ANDROS — ESTRUCTURA DE EXPORTACIÓN SIN IA (0 ms, $0 de API)
//
// Arma el documento (PDF/.docx) y la presentación (.pptx) directamente desde
// las tarjetas del lienzo, en el orden ejecutivo del Plan del Día. Se usa:
//   · cuando la persona elige «Directo del tablero (sin IA)»,
//   · como respaldo instantáneo si falla la red o se agota la cuota,
//   · en el servidor si la respuesta de la IA llega vacía o rota.
// Función pura: sirve en el navegador, en la API y en los scripts.
// ============================================================================

import {
  SLIDES_MAX,
  SLIDE_BULLET_MAX_CHARS,
  SLIDE_MAX_BULLETS,
  clipWords,
  formatExportDate,
  type DocumentOutline,
  type DocumentOutlineSection,
  type ExportCard,
  type ExportMode,
  type ExportOutline,
  type SlideOutline,
  type SlidesOutline,
} from "./exportOutline";

const pluralize = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Cifras clave del tablero: totales de tablas y resultados de fórmulas. */
function keyFigures(cards: ExportCard[]): string[] {
  const out: string[] = [];
  for (const card of cards) {
    if (card.table?.total?.value) out.push(`${card.title}: ${card.table.total.label} ${card.table.total.value}`);
    if (card.formula) out.push(`${card.formula.result.label}: ${card.formula.result.value}`);
  }
  return out;
}

function pendingTasks(cards: ExportCard[]): string[] {
  return cards.flatMap((card) => card.blocks.filter((b) => b.text.startsWith("☐ ")).map((b) => b.text.slice(2).trim()));
}

/** Viñetas para diapositivas: frases cortas, sin títulos internos. */
function slideBullets(card: ExportCard): string[] {
  const bullets = card.blocks
    .filter((b) => b.type !== "heading")
    .map((b) => clipWords(b.text, SLIDE_BULLET_MAX_CHARS))
    .filter(Boolean);
  if (bullets.length === 0 && card.note) bullets.push(clipWords(card.note, SLIDE_BULLET_MAX_CHARS));
  if (card.table && card.table.kind === "fields") {
    for (const row of card.table.rows) {
      if (bullets.length >= SLIDE_MAX_BULLETS) break;
      const [label, ...rest] = row;
      const value = rest.filter(Boolean).join(" · ");
      if (label && value && value !== "—") bullets.push(clipWords(`${label}: ${value}`, SLIDE_BULLET_MAX_CHARS));
    }
  }
  return bullets.slice(0, SLIDE_MAX_BULLETS);
}

function summaryParagraphs(cards: ExportCard[]): string[] {
  const summary = cards.find((c) => c.category === "Resumen");
  const fromSummary =
    summary?.blocks.filter((b) => b.type === "paragraph").map((b) => b.text) ??
    (summary?.note ? [summary.note] : []);
  if (fromSummary.length > 0) return fromSummary.slice(0, 3);

  const tables = cards.filter((c) => c.table).length;
  const formulas = cards.filter((c) => c.formula).length;
  const photos = cards.reduce((n, c) => n + c.photos.length, 0);
  const parts = [pluralize(cards.length, "tarjeta", "tarjetas")];
  if (tables) parts.push(pluralize(tables, "tabla", "tablas"));
  if (formulas) parts.push(pluralize(formulas, "cálculo", "cálculos"));
  if (photos) parts.push(pluralize(photos, "foto", "fotos"));
  const last = parts.pop();
  const list = parts.length > 0 ? `${parts.join(", ")} y ${last}` : last;
  return [`Este documento reúne ${list} del espacio, ordenados por prioridad: resumen, cronograma, presupuesto, logística y roles.`];
}

// ----------------------------------------------------------------------------
// Documento
// ----------------------------------------------------------------------------

export function buildLocalDocumentOutline(title: string, cards: ExportCard[], generatedAt = new Date()): DocumentOutline {
  const sections: DocumentOutlineSection[] = cards.map((card) => {
    const blocks = [...card.blocks];
    if (card.note) blocks.push({ type: "paragraph", text: card.note });
    return {
      heading: card.title,
      kicker: card.category,
      blocks,
      tables: card.table ? [card.table] : [],
      formulas: card.formula ? [card.formula] : [],
      photoIds: card.photos.map((p) => p.photoId),
    };
  });

  const findings = keyFigures(cards);
  const pending = pendingTasks(cards);
  if (pending.length > 0) findings.push(`Quedan ${pluralize(pending.length, "tarea pendiente", "tareas pendientes")} por completar.`);

  return {
    mode: "document",
    title: title.trim() || "Mi espacio",
    subtitle: `Informe del tablero · ${formatExportDate(generatedAt)}`,
    executiveSummary: cards.length > 0 ? summaryParagraphs(cards) : ["El tablero todavía no tiene tarjetas con contenido."],
    sections,
    keyFindings: findings.slice(0, 8),
    source: "local",
  };
}

// ----------------------------------------------------------------------------
// Presentación (5–9 diapositivas)
// ----------------------------------------------------------------------------

export function buildLocalSlidesOutline(title: string, cards: ExportCard[], generatedAt = new Date()): SlidesOutline {
  const deckTitle = title.trim() || "Mi espacio";
  const subtitle = formatExportDate(generatedAt);
  const slides: SlideOutline[] = [];
  const empty = { subtitle: null, bullets: [], table: null, formula: null, photoId: null };

  slides.push({ ...empty, layout: "cover", title: deckTitle, subtitle: `Presentación del tablero · ${subtitle}` });

  const summaryCard = cards.find((c) => c.category === "Resumen");
  const summaryBullets = summaryCard
    ? slideBullets(summaryCard)
    : summaryParagraphs(cards).map((p) => clipWords(p, SLIDE_BULLET_MAX_CHARS));
  const figures = keyFigures(cards).map((f) => clipWords(f, SLIDE_BULLET_MAX_CHARS));
  slides.push({
    ...empty,
    layout: "summary",
    title: summaryCard?.title ?? "Resumen y objetivo",
    bullets: [...summaryBullets, ...figures].slice(0, SLIDE_MAX_BULLETS),
  });

  // Contenido: espacio para 6 diapositivas (portada + resumen + 6 + cierre = 9).
  const room = SLIDES_MAX - 3;
  const content = cards.filter((c) => c !== summaryCard);
  const shown = content.length > room ? content.slice(0, room - 1) : content;
  const rest = content.slice(shown.length);

  for (const card of shown) {
    const photoId = card.photos[0]?.photoId ?? null;
    if (card.formula) {
      slides.push({ ...empty, layout: "formula", title: card.title, formula: card.formula, photoId });
    } else if (card.table && card.table.kind === "sheet") {
      slides.push({ ...empty, layout: "table", title: card.title, table: card.table, photoId: null });
    } else {
      const bullets = slideBullets(card);
      slides.push({
        ...empty,
        layout: "content",
        title: card.title,
        subtitle: card.category,
        bullets: bullets.length > 0 ? bullets : [`Ver la tarjeta «${card.title}» en Andros.`],
        photoId,
      });
    }
  }

  if (rest.length > 0) {
    const titles = rest.map((c) => clipWords(c.title, 80));
    const bullets =
      titles.length > SLIDE_MAX_BULLETS
        ? [...titles.slice(0, SLIDE_MAX_BULLETS - 1), `Y ${titles.length - (SLIDE_MAX_BULLETS - 1)} tarjetas más en el tablero`]
        : titles;
    slides.push({ ...empty, layout: "content", title: "Más del tablero", bullets });
  }

  // Relleno hasta el mínimo de 5 con las cifras clave (tableros muy pequeños).
  while (slides.length < 4) {
    slides.push({
      ...empty,
      layout: "content",
      title: slides.length === 2 ? "Cifras clave" : "Detalles",
      bullets: figures.length > 0 ? figures.slice(0, SLIDE_MAX_BULLETS) : ["Agrega tarjetas al tablero para enriquecer esta presentación."],
    });
    if (figures.length > 0) figures.length = 0;
  }

  const pending = pendingTasks(cards).map((t) => clipWords(t, SLIDE_BULLET_MAX_CHARS));
  slides.push({
    ...empty,
    layout: "closing",
    title: "Próximos pasos",
    bullets:
      pending.length > 0
        ? pending.slice(0, SLIDE_MAX_BULLETS)
        : ["Revisar y validar el contenido con el equipo.", "Actualizar el tablero en Andros con los cambios acordados."],
  });

  return { mode: "slides", title: deckTitle, subtitle, slides: slides.slice(0, SLIDES_MAX), source: "local" };
}

export function buildLocalExportOutline(
  mode: ExportMode,
  title: string,
  cards: ExportCard[],
  generatedAt = new Date()
): ExportOutline {
  return mode === "slides"
    ? buildLocalSlidesOutline(title, cards, generatedAt)
    : buildLocalDocumentOutline(title, cards, generatedAt);
}
