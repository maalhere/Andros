// ============================================================================
// ANDROS — GENERADOR .PPTX (Microsoft PowerPoint y Google Slides)
//
// Se carga SOLO con `await import("@/lib/export/pptxBuilder")` al pulsar
// «Descargar .pptx»: `pptxgenjs` nunca entra en el JS inicial de `/`.
// Presentación 16:9 sobria con la estética editorial de Andros según el motor
// activo (Paper Modernist #F6F5F2 / #C95A3B u Obsidian Monolith #0D0E11 /
// #3B82F6). El tamaño de letra se calcula con la cantidad de texto para que
// nada se desborde; las fotos van a la derecha con su relación de aspecto.
// Funciona en el navegador y en Node (scripts/verify-export.ts).
// ============================================================================

import PptxGenJS from "pptxgenjs";
import {
  SLIDE_TABLE_MAX_ROWS,
  clipWords,
  fitInside,
  type EmbeddedImages,
  type OutlineFormula,
  type OutlineTable,
  type SlideOutline,
  type SlidesOutline,
} from "./exportOutline";

export type PptxTheme = "light" | "dark";

interface Palette {
  bg: string;
  card: string;
  ink: string;
  muted: string;
  /** Acento decorativo (barras, bordes). */
  accent: string;
  /** Acento como TEXTO (contraste AA sobre el fondo). */
  accentInk: string;
  rule: string;
  headerFill: string;
}

const PALETTES: Record<PptxTheme, Palette> = {
  light: {
    bg: "F6F5F2",
    card: "FFFFFF",
    ink: "1A1A18",
    muted: "5C5A55",
    accent: "C95A3B",
    accentInk: "A9452A",
    rule: "D5D2CB",
    headerFill: "EDEBE6",
  },
  dark: {
    bg: "0D0E11",
    card: "16181D",
    ink: "EDEDEF",
    muted: "A1A3AB",
    accent: "3B82F6",
    accentInk: "6EA8FF",
    rule: "2A2D35",
    headerFill: "1E2128",
  },
};

const FONT = "Calibri";
const MONO = "Consolas";

// Lienzo 16:9 (LAYOUT_WIDE): 13,333 × 7,5 pulgadas.
const W = 13.333;
const MARGIN_X = 0.7;
const CONTENT_W = W - MARGIN_X * 2;
const BODY_Y = 1.75;
const BODY_H = 4.95;
/** Columna de la foto (derecha) cuando la diapositiva la lleva. */
const PHOTO_COL_W = 4.6;
const GAP = 0.4;

export interface PptxOptions {
  theme?: PptxTheme;
}

/** Tamaño de letra según el volumen de texto: nunca se desborda la caja. */
function bulletFontSize(bullets: string[], narrow: boolean): number {
  const chars = bullets.reduce((n, b) => n + b.length, 0) * (narrow ? 1.6 : 1);
  if (chars < 260) return 22;
  if (chars < 420) return 20;
  if (chars < 620) return 18;
  if (chars < 860) return 16;
  return 14;
}

function addTitle(slide: PptxGenJS.Slide, p: Palette, title: string, kickerText: string | null): void {
  if (kickerText) {
    slide.addText(clipWords(kickerText, 70).toUpperCase(), {
      x: MARGIN_X,
      y: 0.45,
      w: CONTENT_W,
      h: 0.35,
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      color: p.accentInk,
      charSpacing: 3,
      margin: 0,
    });
  }
  slide.addText(clipWords(title, 80), {
    x: MARGIN_X,
    y: 0.78,
    w: CONTENT_W,
    h: 0.8,
    fontFace: FONT,
    fontSize: title.length > 50 ? 24 : 30,
    bold: true,
    color: p.ink,
    valign: "top",
    margin: 0,
    fit: "shrink",
  });
}

function addBullets(slide: PptxGenJS.Slide, p: Palette, bullets: string[], x: number, w: number): void {
  if (bullets.length === 0) return;
  const size = bulletFontSize(bullets, w < CONTENT_W - 1);
  slide.addText(
    bullets.map((text) => ({
      text,
      options: { bullet: { indent: 18 }, paraSpaceAfter: size * 0.55, breakLine: true },
    })),
    {
      x,
      y: BODY_Y,
      w,
      h: BODY_H,
      fontFace: FONT,
      fontSize: size,
      color: p.ink,
      valign: "top",
      margin: [4, 4, 4, 0],
      lineSpacingMultiple: 1.1,
      fit: "shrink",
    }
  );
}

function addPhoto(slide: PptxGenJS.Slide, p: Palette, images: EmbeddedImages, photoId: string | null): boolean {
  const image = photoId ? images.get(photoId) : undefined;
  if (!image) return false;
  const x = W - MARGIN_X - PHOTO_COL_W;
  slide.addShape("rect", {
    x,
    y: BODY_Y,
    w: PHOTO_COL_W,
    h: BODY_H,
    fill: { color: p.card },
    line: { color: p.rule, width: 0.75 },
  });
  const pad = 0.15;
  const captionH = 0.4;
  const box = { w: PHOTO_COL_W - pad * 2, h: BODY_H - pad * 2 - captionH };
  const { w, h } = fitInside(image.width, image.height, box.w, box.h);
  slide.addImage({
    data: image.dataUrl,
    x: x + pad + (box.w - w) / 2,
    y: BODY_Y + pad + (box.h - h) / 2,
    w,
    h,
    altText: image.alt,
  });
  slide.addText(clipWords(image.alt, 70), {
    x: x + pad,
    y: BODY_Y + BODY_H - captionH - pad / 2,
    w: box.w,
    h: captionH,
    fontFace: FONT,
    fontSize: 10,
    color: p.muted,
    align: "center",
    valign: "middle",
    margin: 0,
  });
  return true;
}

/** Viñetas en la columna derecha (tablas y cálculos sin foto). */
function addSideBullets(slide: PptxGenJS.Slide, p: Palette, bullets: string[]): boolean {
  if (bullets.length === 0) return false;
  const x = W - MARGIN_X - PHOTO_COL_W;
  slide.addShape("rect", { x, y: BODY_Y, w: PHOTO_COL_W, h: BODY_H, fill: { color: p.card }, line: { color: p.rule, width: 0.75 } });
  const size = Math.min(16, bulletFontSize(bullets, true));
  slide.addText(
    bullets.map((text) => ({ text, options: { bullet: { indent: 14 }, paraSpaceAfter: size * 0.5, breakLine: true } })),
    {
      x: x + 0.2,
      y: BODY_Y + 0.2,
      w: PHOTO_COL_W - 0.4,
      h: BODY_H - 0.4,
      fontFace: FONT,
      fontSize: size,
      color: p.ink,
      valign: "top",
      margin: 0,
      lineSpacingMultiple: 1.1,
      fit: "shrink",
    }
  );
  return true;
}

/** Columna derecha: la foto citada o, si no hay, las viñetas de la diapositiva. */
function addSideColumn(slide: PptxGenJS.Slide, p: Palette, images: EmbeddedImages, slideData: SlideOutline): boolean {
  return addPhoto(slide, p, images, slideData.photoId) || addSideBullets(slide, p, slideData.bullets);
}

// ----------------------------------------------------------------------------
// Diapositivas
// ----------------------------------------------------------------------------

function coverSlide(pptx: PptxGenJS, p: Palette, outline: SlidesOutline, slideData: SlideOutline, images: EmbeddedImages): void {
  const slide = pptx.addSlide({ masterName: "ANDROS_COVER" });
  const hasPhoto = addPhoto(slide, p, images, slideData.photoId);
  const textW = (hasPhoto ? CONTENT_W - PHOTO_COL_W - GAP : CONTENT_W) - 0.5;
  slide.addShape("rect", { x: MARGIN_X, y: 2.2, w: 0.09, h: 2.6, fill: { color: p.accent }, line: { color: p.accent, width: 0 } });
  slide.addText("ANDROS", {
    x: MARGIN_X + 0.35,
    y: 2.15,
    w: 6,
    h: 0.4,
    fontFace: FONT,
    fontSize: 12,
    bold: true,
    color: p.accentInk,
    charSpacing: 6,
    margin: 0,
  });
  slide.addText(clipWords(slideData.title || outline.title, 110), {
    x: MARGIN_X + 0.35,
    y: 2.6,
    w: textW,
    h: 1.6,
    fontFace: FONT,
    fontSize: (slideData.title || outline.title).length > 60 ? 32 : 42,
    bold: true,
    color: p.ink,
    valign: "top",
    margin: 0,
    fit: "shrink",
  });
  const subtitle = slideData.subtitle || outline.subtitle;
  if (subtitle) {
    slide.addText(clipWords(subtitle, 160), {
      x: MARGIN_X + 0.35,
      y: 4.25,
      w: textW,
      h: 0.6,
      fontFace: FONT,
      fontSize: 18,
      color: p.muted,
      valign: "top",
      margin: 0,
    });
  }
}

function bulletsSlide(pptx: PptxGenJS, p: Palette, slideData: SlideOutline, images: EmbeddedImages, kickerText: string): void {
  const slide = pptx.addSlide({ masterName: "ANDROS" });
  addTitle(slide, p, slideData.title, slideData.subtitle ?? kickerText);
  const hasPhoto = addPhoto(slide, p, images, slideData.photoId);
  const width = hasPhoto ? CONTENT_W - PHOTO_COL_W - GAP : CONTENT_W;
  if (slideData.layout === "closing") {
    slide.addShape("rect", { x: MARGIN_X, y: BODY_Y, w: 0.06, h: BODY_H - 0.6, fill: { color: p.accent }, line: { color: p.accent, width: 0 } });
    addBullets(slide, p, slideData.bullets, MARGIN_X + 0.3, width - 0.3);
  } else {
    addBullets(slide, p, slideData.bullets, MARGIN_X, width);
  }
}

function tableSlide(pptx: PptxGenJS, p: Palette, slideData: SlideOutline, table: OutlineTable, images: EmbeddedImages): void {
  const slide = pptx.addSlide({ masterName: "ANDROS" });
  addTitle(slide, p, slideData.title, slideData.subtitle ?? "Tabla");
  const tableW = addSideColumn(slide, p, images, slideData) ? CONTENT_W - PHOTO_COL_W - GAP : CONTENT_W;

  const columns = Math.min(6, Math.max(1, table.header?.length ?? 0, ...table.rows.map((r) => r.length)));
  const visible = table.rows.slice(0, SLIDE_TABLE_MAX_ROWS);
  const hidden = table.rows.length - visible.length;
  const numeric = table.kind !== "fields";
  const fontSize = visible.length > 6 ? 13 : 15;
  const cellText = (text: string) => clipWords(text, columns > 3 || tableW < CONTENT_W ? 40 : 70);
  const base = { fontFace: FONT, fontSize, color: p.ink, valign: "middle" as const, margin: [4, 8, 4, 8] as [number, number, number, number] };
  const border = { type: "solid" as const, pt: 0.75, color: p.rule };
  const pad = (row: string[]) => Array.from({ length: columns }, (_, i) => row[i] ?? "");

  const rows: PptxGenJS.TableRow[] = [];
  if (table.header) {
    rows.push(
      pad(table.header).map((text, i) => ({
        text: cellText(text),
        options: { ...base, bold: true, fill: { color: p.headerFill }, align: numeric && i > 0 ? "right" : "left", border },
      }))
    );
  }
  for (const row of visible) {
    rows.push(
      pad(row).map((text, i) => ({
        text: cellText(text),
        options: {
          ...base,
          color: table.kind === "fields" && i === 0 ? p.muted : p.ink,
          fill: { color: p.card },
          align: numeric && i > 0 ? "right" : "left",
          border,
        },
      }))
    );
  }
  if (hidden > 0) {
    rows.push([
      {
        text: `… y ${hidden} fila${hidden === 1 ? "" : "s"} más en el documento completo`,
        options: { ...base, color: p.muted, fill: { color: p.card }, colspan: columns, border },
      },
    ]);
  }
  if (table.total) {
    rows.push(
      columns > 1
        ? [
            { text: table.total.label, options: { ...base, bold: true, fill: { color: p.headerFill }, border } },
            {
              text: table.total.value,
              options: { ...base, bold: true, color: p.accentInk, fill: { color: p.headerFill }, colspan: columns - 1, align: numeric ? "right" : "left", border },
            },
          ]
        : [{ text: `${table.total.label}: ${table.total.value}`, options: { ...base, bold: true, fill: { color: p.headerFill }, border } }]
    );
  }

  const first = columns === 1 ? tableW : tableW * (columns === 2 ? 0.55 : 0.36);
  const rest = columns === 1 ? [] : Array.from({ length: columns - 1 }, () => (tableW - first) / (columns - 1));
  const rowH = Math.min(0.5, BODY_H / Math.max(1, rows.length));
  slide.addTable(rows, { x: MARGIN_X, y: BODY_Y, w: tableW, colW: [first, ...rest], rowH, autoPage: false });
}

function formulaSlide(pptx: PptxGenJS, p: Palette, slideData: SlideOutline, formula: OutlineFormula, images: EmbeddedImages): void {
  const slide = pptx.addSlide({ masterName: "ANDROS" });
  addTitle(slide, p, slideData.title, slideData.subtitle ?? "Cálculo");
  const cardW = addSideColumn(slide, p, images, slideData) ? CONTENT_W - PHOTO_COL_W - GAP : CONTENT_W;

  slide.addShape("rect", { x: MARGIN_X, y: BODY_Y, w: cardW, h: BODY_H, fill: { color: p.card }, line: { color: p.rule, width: 0.75 } });
  slide.addShape("rect", { x: MARGIN_X, y: BODY_Y, w: 0.07, h: BODY_H, fill: { color: p.accent }, line: { color: p.accent, width: 0 } });

  const innerX = MARGIN_X + 0.4;
  const innerW = cardW - 0.7;
  const label = (text: string, y: number) =>
    slide.addText(text.toUpperCase(), { x: innerX, y, w: innerW, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: p.muted, charSpacing: 2, margin: 0 });

  label("Fórmula", BODY_Y + 0.3);
  slide.addText(clipWords(`${formula.result.label} = ${formula.expression || formula.latex}`, 90), {
    x: innerX,
    y: BODY_Y + 0.6,
    w: innerW,
    h: 0.6,
    fontFace: MONO,
    fontSize: 22,
    color: p.ink,
    margin: 0,
    fit: "shrink",
  });

  let y = BODY_Y + 1.35;
  const variables = formula.variables.slice(0, 4).map((row) => clipWords(`${row[0] ?? ""}: ${row[1] ?? "—"}`, 90));
  if (variables.length > 0) {
    label("Datos", y);
    slide.addText(variables.join("\n"), {
      x: innerX,
      y: y + 0.3,
      w: innerW,
      h: 0.3 * variables.length + 0.1,
      fontFace: FONT,
      fontSize: 13,
      color: p.ink,
      valign: "top",
      margin: 0,
      fit: "shrink",
    });
    y += 0.45 + 0.3 * variables.length;
  }
  if (formula.substitutionText) {
    label("Sustitución", y);
    slide.addText(clipWords(`${formula.result.label} = ${formula.substitutionText}`, 90), {
      x: innerX,
      y: y + 0.3,
      w: innerW,
      h: 0.45,
      fontFace: MONO,
      fontSize: 16,
      color: p.ink,
      margin: 0,
      fit: "shrink",
    });
  }

  label("Resultado", BODY_Y + BODY_H - 1.25);
  slide.addText(clipWords(formula.result.value, 40), {
    x: innerX,
    y: BODY_Y + BODY_H - 0.95,
    w: innerW,
    h: 0.75,
    fontFace: MONO,
    fontSize: 36,
    bold: true,
    color: p.accentInk,
    margin: 0,
    fit: "shrink",
  });
}

const KICKERS: Record<SlideOutline["layout"], string> = {
  cover: "",
  summary: "Resumen",
  content: "Contenido",
  table: "Tabla",
  formula: "Cálculo",
  closing: "Cierre",
};

/** Genera el `.pptx` 16:9 y devuelve sus bytes. */
export async function buildPptx(outline: SlidesOutline, images: EmbeddedImages, options: PptxOptions = {}): Promise<Uint8Array> {
  const p = PALETTES[options.theme ?? "light"];
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Andros";
  pptx.company = "Andros";
  pptx.title = outline.title;
  pptx.subject = outline.subtitle || "Presentación exportada desde Andros";

  pptx.defineSlideMaster({
    title: "ANDROS_COVER",
    background: { color: p.bg },
    objects: [],
  });
  pptx.defineSlideMaster({
    title: "ANDROS",
    background: { color: p.bg },
    objects: [
      { line: { x: MARGIN_X, y: 6.95, w: CONTENT_W, h: 0, line: { color: p.rule, width: 0.75 } } },
      {
        text: {
          text: clipWords(`Andros · ${outline.title}`, 80),
          options: { x: MARGIN_X, y: 7.0, w: 8, h: 0.35, fontFace: FONT, fontSize: 10, color: p.muted, margin: 0 },
        },
      },
    ],
    slideNumber: { x: W - MARGIN_X - 0.6, y: 7.0, w: 0.6, h: 0.35, fontFace: MONO, fontSize: 10, color: p.muted, align: "right" },
  });

  for (const slideData of outline.slides) {
    if (slideData.layout === "cover") coverSlide(pptx, p, outline, slideData, images);
    else if (slideData.table) tableSlide(pptx, p, slideData, slideData.table, images);
    else if (slideData.formula) formulaSlide(pptx, p, slideData, slideData.formula, images);
    else bulletsSlide(pptx, p, slideData, images, KICKERS[slideData.layout]);
  }

  const data = await pptx.write({ outputType: "uint8array" });
  return data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
}
