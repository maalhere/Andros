"use client";

import React from "react";
import { createPortal } from "react-dom";
import { AndrosMark } from "@/components/brand/AndrosMark";
import {
  PLAN_CATEGORY_LABELS,
  formatPlanDate,
  groupBlocks,
  type PlanDocument,
  type PlanSection,
} from "@/lib/plan/planDocument";
import { LazyKatex } from "@/components/math/LazyKatex";

// ============================================================================
// ANDROS — HOJA IMPRIMIBLE DEL «PLAN DEL DÍA»
// Invisible en pantalla (ver `.andros-plan-sheet` en globals.css). Al llamar a
// `window.print()` es lo único que sale: el navegador ofrece «Guardar como
// PDF» sin librerías pesadas. Se monta en <body> solo mientras el modal de
// exportación está abierto.
// ============================================================================

const PrintSection: React.FC<{ section: PlanSection }> = ({ section }) => {
  const table = section.table;
  return (
    <section>
      <p className="aps-kicker">{PLAN_CATEGORY_LABELS[section.category]}</p>
      <h2>{section.title}</h2>

      {groupBlocks(section).map((group, i) =>
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

      {section.checklist.length > 0 && (
        <ul className="aps-checklist">
          {section.checklist.map((item, i) => (
            <li key={i}>
              <span className="aps-box" aria-hidden="true">
                {item.checked ? "✓" : ""}
              </span>
              <span className={item.checked ? "aps-done" : undefined}>
                {item.checked ? <span className="sr-only">Hecho: </span> : null}
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      {section.formula && (
        <div className="aps-formula">
          {section.formula.latex && <LazyKatex latex={section.formula.latex} display />}
          {section.formula.substitutionLatex && <LazyKatex latex={`= ${section.formula.substitutionLatex}`} display />}
        </div>
      )}

      {table && (
        <table className={table.kind === "fields" ? "aps-fields" : undefined}>
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
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {table.total && (
            <tfoot>
              <tr>
                <td>{table.total.label}</td>
                <td colSpan={Math.max(1, (table.header ?? table.rows[0] ?? ["", ""]).length - 1)}>
                  {table.total.value}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      )}

      {section.link && (
        <p>
          <a href={section.link.url}>{section.link.label}</a>
          {section.link.label !== section.link.url ? ` — ${section.link.url}` : null}
        </p>
      )}
      {section.note && <p className="aps-note">{section.note}</p>}
      {section.images.length > 0 && (
        <div className="aps-photos">
          {section.images.map((image, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={image.src} alt={image.alt} />
          ))}
        </div>
      )}
    </section>
  );
};

export const PlanPrintSheet: React.FC<{ doc: PlanDocument }> = ({ doc }) => {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="andros-plan-sheet">
      <header className="aps-header">
        <div>
          <p className="aps-brand">
            <AndrosMark />
            Andros · Plan del día
          </p>
          <h1>{doc.title}</h1>
        </div>
        <div className="aps-meta">
          {doc.budgetTotal && (
            <>
              Presupuesto total
              <strong>{doc.budgetTotal}</strong>
            </>
          )}
          <span>Generado el {formatPlanDate(doc.generatedAt)}</span>
        </div>
      </header>

      {doc.sections.length === 0 ? (
        <p className="aps-note">El tablero todavía no tiene tarjetas con contenido.</p>
      ) : (
        doc.sections.map((section) => <PrintSection key={section.id} section={section} />)
      )}

      <p className="aps-footer">Organizado en Andros.</p>
    </div>,
    document.body
  );
};
