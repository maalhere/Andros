// ============================================================================
// ANDROS — GENERADOR .DOCX (Microsoft Word y Google Docs)
//
// Se carga SOLO con `await import("@/lib/export/docxBuilder")` al pulsar
// «Descargar .docx»: la librería `docx` nunca entra en el JS inicial de `/`.
// Produce un OOXML estándar: portada con marca Andros y fecha, títulos reales
// (Título 1/2, navegables en el panel de Word y en el esquema de Google Docs),
// tablas nativas con totales, bloques de fórmula con sustitución y resultado,
// e imágenes incrustadas con su relación de aspecto. Funciona en el navegador
// y en Node (scripts/verify-export.ts).
// ============================================================================

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import {
  fitInside,
  formatExportDate,
  type DocumentOutline,
  type DocumentOutlineSection,
  type EmbeddedImages,
  type OutlineFormula,
  type OutlineTable,
} from "./exportOutline";

// Paper Modernist: el documento impreso siempre va en claro (legible en papel y en Docs).
const INK = "1A1A18";
const MUTED = "5C5A55";
const ACCENT_INK = "A9452A";
const ACCENT = "C95A3B";
const RULE = "D5D2CB";
const PAPER = "F6F5F2";
const FONT = "Calibri";
const MONO = "Consolas";

/** A4 con márgenes de 2,54 cm: ancho útil en twips (1/1440 in). */
const CONTENT_TWIPS = 11906 - 2 * 1440;
/** Ancho útil en píxeles a 96 ppp (para las imágenes). */
const CONTENT_PX = Math.floor((CONTENT_TWIPS / 1440) * 96);
const PHOTO_MAX_W = Math.min(520, CONTENT_PX);
const PHOTO_MAX_H = 360;

export interface DocxOptions {
  generatedAt?: Date;
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const run = (text: string, opts: { bold?: boolean; color?: string; size?: number; font?: string; allCaps?: boolean } = {}) =>
  new TextRun({ text, bold: opts.bold, color: opts.color ?? INK, size: opts.size, font: opts.font ?? FONT, allCaps: opts.allCaps });

const kicker = (text: string) =>
  new Paragraph({
    spacing: { before: 360, after: 40 },
    keepNext: true,
    children: [new TextRun({ text, allCaps: true, color: ACCENT_INK, size: 16, bold: true, font: FONT, characterSpacing: 30 })],
  });

const body = (children: ParagraphChild[] | string, extra: { keepNext?: boolean } = {}) =>
  new Paragraph({
    spacing: { after: 120, line: 300 },
    keepNext: extra.keepNext,
    children: typeof children === "string" ? [run(children)] : children,
  });

const bullet = (text: string) =>
  new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line: 288 }, children: [run(text)] });

// ----------------------------------------------------------------------------
// Tablas
// ----------------------------------------------------------------------------

const cellBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
};

function columnWidths(columns: number, kind: OutlineTable["kind"]): number[] {
  if (columns <= 1) return [CONTENT_TWIPS];
  if (kind === "fields" && columns === 2) return [Math.round(CONTENT_TWIPS * 0.38), Math.round(CONTENT_TWIPS * 0.62)];
  const first = Math.round(CONTENT_TWIPS * (columns === 2 ? 0.6 : 0.4));
  const rest = Math.floor((CONTENT_TWIPS - first) / (columns - 1));
  return [first, ...Array.from({ length: columns - 1 }, () => rest)];
}

function cell(
  text: string,
  width: number,
  opts: { header?: boolean; bold?: boolean; right?: boolean; muted?: boolean; topRule?: boolean; span?: number } = {}
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: opts.span,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    borders: {
      ...cellBorders,
      bottom: { style: BorderStyle.SINGLE, size: opts.header ? 10 : 4, color: opts.header ? INK : RULE },
      ...(opts.topRule ? { top: { style: BorderStyle.SINGLE, size: 10, color: INK } } : {}),
    },
    shading: opts.header ? { type: ShadingType.CLEAR, color: "auto", fill: PAPER } : undefined,
    children: [
      new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [
          run(text || " ", {
            bold: opts.header || opts.bold,
            color: opts.muted ? MUTED : INK,
            size: opts.header ? 18 : 20,
          }),
        ],
      }),
    ],
  });
}

function tableBlock(table: OutlineTable): (Paragraph | Table)[] {
  const columns = Math.max(1, table.header?.length ?? 0, ...table.rows.map((r) => r.length));
  const widths = columnWidths(columns, table.kind);
  const numeric = table.kind !== "fields";
  const pad = (row: string[]) => Array.from({ length: columns }, (_, i) => row[i] ?? "");

  const rows: TableRow[] = [];
  if (table.header) {
    rows.push(
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: pad(table.header).map((text, i) => cell(text, widths[i], { header: true, right: numeric && i > 0 })),
      })
    );
  }
  for (const row of table.rows) {
    rows.push(
      new TableRow({
        cantSplit: true,
        children: pad(row).map((text, i) =>
          cell(text, widths[i], { right: numeric && i > 0, muted: table.kind === "fields" && i === 0 })
        ),
      })
    );
  }
  if (table.total) {
    const restWidth = widths.slice(1).reduce((a, b) => a + b, 0);
    rows.push(
      new TableRow({
        cantSplit: true,
        children:
          columns > 1
            ? [
                cell(table.total.label, widths[0], { bold: true, topRule: true }),
                cell(table.total.value, restWidth, { bold: true, topRule: true, right: numeric, span: columns - 1 }),
              ]
            : [cell(`${table.total.label}: ${table.total.value}`, widths[0], { bold: true, topRule: true })],
      })
    );
  }
  if (rows.length === 0) return [];

  return [
    new Paragraph({
      keepNext: true,
      spacing: { before: 160, after: 80 },
      children: [run(table.title, { bold: true, size: 20, color: MUTED })],
    }),
    new Table({
      rows,
      width: { size: CONTENT_TWIPS, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
    }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
}

// ----------------------------------------------------------------------------
// Fórmulas: caja con expresión, variables, sustitución y resultado
// ----------------------------------------------------------------------------

function formulaBlock(formula: OutlineFormula): Table {
  const line = (label: string, value: string, mono = true) =>
    new Paragraph({
      spacing: { after: 60 },
      keepNext: true,
      children: [run(`${label}  `, { color: MUTED, size: 18 }), run(value, { font: mono ? MONO : FONT, size: 20 })],
    });

  const children: Paragraph[] = [
    new Paragraph({
      spacing: { after: 80 },
      keepNext: true,
      children: [run(formula.title, { bold: true, size: 20 })],
    }),
  ];
  if (formula.expression) children.push(line("Fórmula", `${formula.result.label} = ${formula.expression}`));
  for (const row of formula.variables) {
    const [name, value] = row;
    if (name) children.push(line("•", `${name}: ${value ?? "—"}`, false));
  }
  if (formula.substitutionText) children.push(line("Sustitución", `${formula.result.label} = ${formula.substitutionText}`));
  children.push(
    new Paragraph({
      spacing: { before: 80 },
      children: [
        run(`${formula.result.label}: `, { bold: true, size: 24 }),
        run(formula.result.value, { bold: true, size: 24, color: ACCENT_INK, font: MONO }),
      ],
    })
  );

  return new Table({
    width: { size: CONTENT_TWIPS, type: WidthType.DXA },
    columnWidths: [CONTENT_TWIPS],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: CONTENT_TWIPS, type: WidthType.DXA },
            margins: { top: 140, bottom: 140, left: 200, right: 200 },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: PAPER },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.SINGLE, size: 24, color: ACCENT },
            },
            children,
          }),
        ],
      }),
    ],
  });
}

// ----------------------------------------------------------------------------
// Fotos
// ----------------------------------------------------------------------------

function photoBlock(photoId: string, images: EmbeddedImages): Paragraph[] {
  const image = images.get(photoId);
  if (!image) return [];
  const { w, h } = fitInside(image.width, image.height, PHOTO_MAX_W, PHOTO_MAX_H);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 160, after: 40 },
      children: [
        new ImageRun({
          type: image.type,
          data: dataUrlBytes(image.dataUrl),
          transformation: { width: Math.round(w), height: Math.round(h) },
          altText: { title: image.alt, description: image.alt, name: image.alt },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [run(image.alt, { color: MUTED, size: 16 })],
    }),
  ];
}

// ----------------------------------------------------------------------------
// Documento
// ----------------------------------------------------------------------------

function sectionBlocks(section: DocumentOutlineSection, images: EmbeddedImages): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (section.kicker) out.push(kicker(section.kicker));
  out.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { before: section.kicker ? 0 : 360, after: 120 },
      children: [run(section.heading, { bold: true, size: 30 })],
    })
  );
  for (const block of section.blocks) {
    if (block.type === "heading") {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          keepNext: true,
          spacing: { before: 200, after: 80 },
          children: [run(block.text, { bold: true, size: 24 })],
        })
      );
    } else if (block.type === "bullet") {
      out.push(bullet(block.text));
    } else {
      out.push(body(block.text));
    }
  }
  for (const table of section.tables) out.push(...tableBlock(table));
  for (const formula of section.formulas) {
    out.push(formulaBlock(formula), new Paragraph({ spacing: { after: 120 }, children: [] }));
  }
  for (const photoId of section.photoIds) out.push(...photoBlock(photoId, images));
  return out;
}

/** Genera el `.docx` y devuelve sus bytes (listos para `Blob` o para escribir a disco). */
export async function buildDocx(outline: DocumentOutline, images: EmbeddedImages, options: DocxOptions = {}): Promise<Uint8Array> {
  const generatedAt = options.generatedAt ?? new Date();
  const children: (Paragraph | Table)[] = [];

  // Portada / encabezado editorial.
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: "ANDROS", bold: true, color: ACCENT_INK, size: 18, font: FONT, characterSpacing: 60 })],
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
      children: [run(outline.title, { bold: true, size: 52 })],
    })
  );
  if (outline.subtitle) {
    children.push(new Paragraph({ spacing: { after: 80 }, children: [run(outline.subtitle, { color: MUTED, size: 24 })] }));
  }
  children.push(
    new Paragraph({
      spacing: { after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 8 } },
      children: [
        run(`Generado el ${formatExportDate(generatedAt)}`, { color: MUTED, size: 18 }),
        run(outline.source === "ai" ? "  ·  Redactado con IA a partir del tablero" : "  ·  Contenido directo del tablero", {
          color: MUTED,
          size: 18,
        }),
      ],
    })
  );

  if (outline.executiveSummary.length > 0) {
    children.push(
      kicker("Resumen ejecutivo"),
      ...outline.executiveSummary.map(
        (text) =>
          new Paragraph({
            spacing: { after: 120, line: 312 },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: PAPER },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 10 } },
            indent: { left: 200, right: 120 },
            children: [run(text, { size: 22 })],
          })
      )
    );
  }

  if (outline.keyFindings.length > 0) {
    children.push(kicker("Hallazgos clave"), ...outline.keyFindings.map(bullet));
  }

  for (const section of outline.sections) children.push(...sectionBlocks(section, images));

  const doc = new Document({
    creator: "Andros",
    title: outline.title,
    description: outline.subtitle || "Documento exportado desde Andros",
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, color: INK } },
        heading1: { run: { font: FONT, size: 30, bold: true, color: INK } },
        heading2: { run: { font: FONT, size: 24, bold: true, color: INK } },
        title: { run: { font: FONT, size: 52, bold: true, color: INK } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [run(`Andros · ${outline.title}`, { color: MUTED, size: 16 })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: ["Página ", PageNumber.CURRENT, " de ", PageNumber.TOTAL_PAGES], color: MUTED, size: 16, font: FONT }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(buffer);
}
