import React from "react";
import { Check, ExternalLink, Square } from "lucide-react";
import {
  PLAN_CATEGORY_LABELS,
  groupBlocks,
  type PlanDocument,
  type PlanSection,
} from "@/lib/plan/planDocument";
import { LazyKatex } from "@/components/math/LazyKatex";

// ============================================================================
// ANDROS — TABLERO EN SOLO LECTURA (Vista Invitado)
// Las tarjetas se leen en orden de prioridad (Resumen → Cronograma →
// Presupuesto → Logística → Roles → resto). En el teléfono es una pila de
// una columna; en escritorio, el resumen ocupa el ancho y el resto va en 2
// columnas. Nada es editable: sin inputs, sin arrastres, sin Realtime.
// ============================================================================

const SectionCard: React.FC<{ section: PlanSection; wide: boolean }> = ({ section, wide }) => {
  const table = section.table;
  const columnCount = table ? (table.header ?? table.rows[0] ?? ["", ""]).length : 0;
  const fieldsTable = table?.kind === "fields";
  return (
    <article
      aria-labelledby={`plan-${section.id}`}
      className={`rounded-xl border border-andros-border bg-andros-card p-4 md:p-5 shadow-card-light dark:shadow-card-dark ${
        wide ? "md:col-span-2" : ""
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.14em] text-andros-accent-ink">
        {PLAN_CATEGORY_LABELS[section.category]}
      </p>
      <h2 id={`plan-${section.id}`} className="mt-1 text-base font-semibold text-andros-primary">
        {section.title}
      </h2>

      <div className="mt-2.5 space-y-2 text-sm leading-relaxed text-andros-primary">
        {groupBlocks(section).map((group, i) =>
          group.kind === "list" ? (
            <ul key={i} className="space-y-1 pl-4 list-disc marker:text-andros-muted">
              {group.items.map((text, j) => (
                <li key={j}>{text}</li>
              ))}
            </ul>
          ) : group.kind === "heading" ? (
            <h3 key={i} className="font-semibold">
              {group.text}
            </h3>
          ) : (
            <p key={i}>{group.text}</p>
          )
        )}

        {section.checklist.length > 0 && (
          <ul className="space-y-1.5" aria-label="Lista de tareas">
            {section.checklist.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                {item.checked ? (
                  <Check className="w-4 h-4 mt-0.5 shrink-0 text-andros-success" aria-hidden="true" />
                ) : (
                  <Square className="w-4 h-4 mt-0.5 shrink-0 text-andros-muted" aria-hidden="true" />
                )}
                <span className={item.checked ? "text-andros-muted line-through" : undefined}>
                  <span className="sr-only">{item.checked ? "Hecho: " : "Pendiente: "}</span>
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        )}

        {section.formula && (
          <div
            role="group"
            aria-label={`Fórmula de «${section.title}»`}
            className="rounded-lg border border-andros-border bg-andros-canvas px-3 py-2 space-y-1"
          >
            {section.formula.latex && <LazyKatex latex={section.formula.latex} display />}
            {section.formula.substitutionLatex && (
              <LazyKatex latex={`= ${section.formula.substitutionLatex}`} display className="text-andros-muted" />
            )}
          </div>
        )}

        {table && (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-sm">
              {table.header && (
                <thead>
                  <tr className="border-b border-andros-border-active">
                    {table.header.map((cell, i) => (
                      <th
                        key={i}
                        scope="col"
                        className={`px-1 py-1.5 text-xs font-medium text-andros-muted ${i > 0 && !fieldsTable ? "text-right" : "text-left"}`}
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-andros-border">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-1 py-1.5 ${
                          fieldsTable ? (j === 0 ? "text-andros-muted pr-3 align-top" : "") : j > 0 ? "text-right tabular-nums" : ""
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {table.total && (
                <tfoot>
                  <tr>
                    <td className="px-1 pt-2 font-semibold">{table.total.label}</td>
                    <td colSpan={Math.max(1, columnCount - 1)} className="px-1 pt-2 text-right font-semibold tabular-nums">
                      {table.total.value}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {section.link && (
          <p>
            <a
              href={section.link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 min-h-[44px] md:min-h-0 text-andros-accent-ink underline underline-offset-2 break-all"
            >
              {section.link.label}
              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            </a>
          </p>
        )}
        {section.note && <p className="text-xs leading-relaxed text-andros-muted">{section.note}</p>}
        {section.images.length > 0 && (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2" aria-label="Fotos de la ficha">
            {section.images.map((image, i) => (
              <li key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.src}
                  alt={image.alt}
                  loading="lazy"
                  className="w-full aspect-square object-cover rounded-lg border border-andros-border bg-andros-canvas"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
};

export const PlanBoardView: React.FC<{ doc: PlanDocument }> = ({ doc }) => {
  if (doc.sections.length === 0) {
    return (
      <p className="rounded-xl border border-andros-border bg-andros-card p-5 text-sm text-andros-muted">
        Este tablero todavía no tiene tarjetas con contenido.
      </p>
    );
  }
  return (
    <div className="grid gap-3 md:gap-4 md:grid-cols-2">
      {doc.sections.map((section, i) => (
        <SectionCard key={section.id} section={section} wide={i === 0 && section.category === "summary"} />
      ))}
    </div>
  );
};
