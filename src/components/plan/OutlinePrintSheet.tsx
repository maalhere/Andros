"use client";

import React from "react";
import { createPortal } from "react-dom";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { LazyKatex } from "@/components/math/LazyKatex";
import type {
  DocumentOutline,
  DocumentOutlineSection,
  ExportPhotoAsset,
  OutlineBlock,
  OutlineFormula,
  OutlineTable,
} from "@/lib/export/exportOutline";
import { formatPlanDate } from "@/lib/plan/planDocument";

// ============================================================================
// ANDROS — PDF IMPRIMIBLE ENRIQUECIDO (síntesis del Estudio de Exportación)
// Misma hoja `.andros-plan-sheet` que el Plan del Día (invisible en pantalla,
// lo único que sale con `window.print()`), pero con la estructura del
// documento: resumen ejecutivo, hallazgos clave, secciones con tablas y
// totales, fórmulas (KaTeX) con su resultado y fotos, con saltos limpios.
// ============================================================================

type Group = { kind: "list"; items: string[] } | { kind: "heading" | "paragraph"; text: string };

function groupBlocks(blocks: OutlineBlock[]): Group[] {
  const groups: Group[] = [];
  for (const block of blocks) {
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

const PrintTable: React.FC<{ table: OutlineTable }> = ({ table }) => {
  const columns = Math.max(1, table.header?.length ?? 0, ...table.rows.map((r) => r.length));
  return (
    <table className={table.kind === "fields" ? "aps-fields" : undefined}>
      <caption>{table.title}</caption>
      {table.header && (
        <thead>
          <tr>
            {table.header.map((cell, i) => (
              <th key={i} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {Array.from({ length: columns }, (_, j) => (
              <td key={j}>{row[j] ?? ""}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {table.total && (
        <tfoot>
          <tr>
            <td>{table.total.label}</td>
            <td colSpan={Math.max(1, columns - 1)}>{table.total.value}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
};

const PrintFormula: React.FC<{ formula: OutlineFormula }> = ({ formula }) => (
  <div className="aps-formula">
    <p className="aps-formula-title">{formula.title}</p>
    {formula.latex ? <LazyKatex latex={formula.latex} display /> : <p>{formula.expression}</p>}
    {formula.substitutionLatex && <LazyKatex latex={`= ${formula.substitutionLatex}`} display />}
    {formula.variables.length > 0 && (
      <ul>
        {formula.variables.map((row, i) => (
          <li key={i}>
            {row[0]}: {row[1] ?? "—"}
          </li>
        ))}
      </ul>
    )}
    <p className="aps-result">
      {formula.result.label}: <strong>{formula.result.value}</strong>
    </p>
  </div>
);

const PrintSection: React.FC<{ section: DocumentOutlineSection; photos: Map<string, ExportPhotoAsset> }> = ({
  section,
  photos,
}) => {
  const images = section.photoIds.map((id) => photos.get(id)).filter((p): p is ExportPhotoAsset => Boolean(p));
  return (
    <section>
      {section.kicker && <p className="aps-kicker">{section.kicker}</p>}
      <h2>{section.heading}</h2>
      {groupBlocks(section.blocks).map((group, i) =>
        group.kind === "list" ? (
          <ul key={i}>
            {group.items.map((text, j) => (
              <li key={j}>{text}</li>
            ))}
          </ul>
        ) : group.kind === "heading" ? (
          <h3 key={i}>{group.text}</h3>
        ) : (
          <p key={i}>{group.text}</p>
        )
      )}
      {section.tables.map((table, i) => (
        <PrintTable key={`t${i}`} table={table} />
      ))}
      {section.formulas.map((formula, i) => (
        <PrintFormula key={`f${i}`} formula={formula} />
      ))}
      {images.length > 0 && (
        <div className="aps-photos">
          {images.map((image) => (
            <figure key={image.photoId}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.src} alt={image.alt} />
              <figcaption>{image.alt}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
};

export const OutlinePrintSheet: React.FC<{
  outline: DocumentOutline;
  photos: Map<string, ExportPhotoAsset>;
  generatedAt: Date;
}> = ({ outline, photos, generatedAt }) => {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="andros-plan-sheet">
      <header className="aps-header">
        <div>
          <p className="aps-brand">
            <AndrosMark />
            Andros · Informe
          </p>
          <h1>{outline.title}</h1>
          {outline.subtitle && <p className="aps-subtitle">{outline.subtitle}</p>}
        </div>
        <div className="aps-meta">
          <span>Generado el {formatPlanDate(generatedAt)}</span>
          <span>{outline.source === "ai" ? "Redactado con IA a partir del tablero" : "Contenido directo del tablero"}</span>
        </div>
      </header>

      {outline.executiveSummary.length > 0 && (
        <section className="aps-summary">
          <p className="aps-kicker">Resumen ejecutivo</p>
          {outline.executiveSummary.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </section>
      )}

      {outline.keyFindings.length > 0 && (
        <section>
          <p className="aps-kicker">Hallazgos clave</p>
          <ul>
            {outline.keyFindings.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </section>
      )}

      {outline.sections.map((section, i) => (
        <PrintSection key={i} section={section} photos={photos} />
      ))}

      <p className="aps-footer">Organizado en Andros.</p>
    </div>,
    document.body
  );
};
