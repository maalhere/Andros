"use client";

import React, { useMemo, useState } from "react";
import { AtSign, Check, Link2, Search, Wand2, X } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { commitWithImpact } from "@/lib/canvas/impactClient";
import { updateFormField } from "@/lib/forms/formActions";
import {
  FACT_LABELS,
  appendReference,
  buildFillSuggestions,
  defaultPicks,
  neighborIds,
  nodeReferenceOptions,
  type FillSuggestion,
} from "@/lib/forms/nodeFill";
import { applyNodeFill } from "@/lib/forms/nodeFillActions";
import type { FormField, FormSheetEngineeringNode } from "@/types/workspace";

// ============================================================================
// ANDROS — «LLENAR DESDE NODOS» Y REFERENCIAS RÁPIDAS EN UNA FICHA (Sprint 24)
//   · NodeFillButton: botón compacto si la ficha tiene nodos conectados con
//     datos útiles. Con una sola fuente y solo campos vacíos aplica en 1 clic;
//     si hay varias fuentes o algo que sobrescribir, abre un mini-selector.
//   · NodeReferencePicker: inserta en un campo de texto el nombre, estado o
//     responsable de cualquier nodo del lienzo (conectados primero).
// $0 API: nada de esto usa la IA ni gasta cuota.
// ============================================================================

const CHIP =
  "min-h-11 md:min-h-8 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro";

function useNeighbors(nodeId: string) {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);
  return useMemo(() => {
    const ids = neighborIds(nodeId, connections);
    return { nodes, neighbors: nodes.filter((n) => ids.includes(n.id)), ids };
  }, [nodeId, nodes, connections]);
}

export const NodeFillButton: React.FC<{ node: FormSheetEngineeringNode }> = ({ node }) => {
  const { neighbors } = useNeighbors(node.id);
  const plan = useMemo(() => buildFillSuggestions(node, neighbors), [node, neighbors]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [withArea, setWithArea] = useState(true);

  if (plan.suggestions.length === 0 && !plan.area) return null;

  const fieldIds = new Set(plan.suggestions.map((s) => s.fieldId));
  const simple =
    plan.sourceCount <= 1 && plan.suggestions.every((s) => !s.overwrites) && fieldIds.size === plan.suggestions.length;

  const openSelector = () => {
    setPicked(new Set(defaultPicks(plan).map((s) => s.id)));
    setWithArea(Boolean(plan.area));
    setOpen(true);
  };

  const onClick = () => {
    if (open) return setOpen(false);
    if (simple) {
      applyNodeFill(node.id, plan.suggestions, { area: plan.area?.value ?? null });
      return;
    }
    openSelector();
  };

  const toggle = (s: FillSuggestion) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(s.id)) next.delete(s.id);
      else {
        // Una sola propuesta por campo.
        for (const other of plan.suggestions) if (other.fieldId === s.fieldId) next.delete(other.id);
        next.add(s.id);
      }
      return next;
    });

  const chosen = plan.suggestions.filter((s) => picked.has(s.id));
  const apply = (picks: FillSuggestion[], overwrite: boolean, area: boolean) => {
    applyNodeFill(node.id, picks, { overwrite, area: area ? plan.area?.value ?? null : null });
    setOpen(false);
  };

  return (
    <div className={open ? "w-full space-y-1.5" : undefined}>
      <button type="button" onClick={onClick} aria-expanded={simple ? undefined : open} className={CHIP}>
        <Wand2 className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
        Llenar desde nodos
        <span className="font-mono tabular-nums text-[11px] text-andros-muted">{plan.suggestions.length + (plan.area ? 1 : 0)}</span>
      </button>

      {open && (
        <div
          role="group"
          aria-label="Datos de los nodos conectados"
          className="p-2 rounded-xl border border-andros-border bg-andros-canvas space-y-1.5"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <p className="text-[11px] text-andros-muted">
            Elige qué copiar. Los campos que ya llenaste quedan sin marcar: márcalos solo si quieres sobrescribirlos.
          </p>
          <ul className="space-y-1">
            {plan.area && (
              <li>
                <label className="min-h-11 md:min-h-8 flex items-start gap-2 text-[12px] text-andros-primary cursor-pointer">
                  <input type="checkbox" checked={withArea} onChange={() => setWithArea((v) => !v)} className="mt-1 w-4 h-4 shrink-0 accent-[var(--accent-fill)]" />
                  <span className="min-w-0">
                    <span className="font-medium">Área de la ficha:</span> @{plan.area.value}
                    <span className="block text-[11px] text-andros-muted truncate">desde «{plan.area.sourceTitle}»</span>
                  </span>
                </label>
              </li>
            )}
            {plan.suggestions.map((s) => (
              <li key={s.id}>
                <label className="min-h-11 md:min-h-8 flex items-start gap-2 text-[12px] text-andros-primary cursor-pointer">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s)} className="mt-1 w-4 h-4 shrink-0 accent-[var(--accent-fill)]" />
                  <span className="min-w-0">
                    <span className="font-medium">{s.fieldLabel}:</span> <span className="break-words">{s.value.slice(0, 120)}</span>
                    <span className="block text-[11px] text-andros-muted truncate">
                      {FACT_LABELS[s.kind]} desde «{s.sourceTitle}»
                      {s.overwrites && <span className="text-andros-warning"> · sobrescribe «{s.currentValue.slice(0, 30)}»</span>}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => apply(defaultPicks(plan), false, Boolean(plan.area))}
              className="min-h-11 md:min-h-8 px-3 rounded-xl bg-andros-accent-fill text-white text-xs font-semibold flex items-center gap-1.5 active:scale-[0.96] spring-micro"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              Aplicar todo (solo vacíos)
            </button>
            <button
              type="button"
              disabled={chosen.length === 0 && !(withArea && plan.area)}
              onClick={() => apply(chosen, chosen.some((s) => s.overwrites), withArea)}
              className={`${CHIP} disabled:opacity-50`}
            >
              Aplicar selección
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar el selector" className="w-11 h-11 md:w-8 md:h-8 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center justify-center">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Botón «@» de un campo de texto: abre el selector de datos de nodos. */
export const NodeReferenceToggle: React.FC<{ open: boolean; label: string; onToggle: () => void }> = ({ open, label, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    aria-label={`Insertar un dato de otro nodo en «${label}»`}
    title="Insertar dato de un nodo"
    className={`hit-slop shrink-0 p-0.5 rounded text-andros-muted hover:text-andros-accent-ink hover:bg-andros-border/40 active:scale-[0.96] spring-micro ${open ? "text-andros-accent-ink" : ""}`}
  >
    <AtSign className="w-3.5 h-3.5" aria-hidden="true" />
  </button>
);

export const NodeReferencePicker: React.FC<{ sheetId: string; field: FormField; onClose: () => void }> = ({ sheetId, field, onClose }) => {
  const { nodes, ids } = useNeighbors(sheetId);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes
      .filter((n) => n.id !== sheetId && (!q || n.title.toLowerCase().includes(q)))
      .sort((a, b) => Number(ids.includes(b.id)) - Number(ids.includes(a.id)))
      .slice(0, 12);
  }, [nodes, ids, query, sheetId]);

  const insert = (value: string) => {
    const latest = useWorkspaceStore.getState().nodes.find((n) => n.id === sheetId);
    const current = latest?.type === "form-sheet-node" ? latest.formSheetData.fields.find((f) => f.id === field.id)?.value : "";
    const text = appendReference(typeof current === "string" ? current : "", value).slice(0, field.type === "textarea" ? 4000 : 400);
    commitWithImpact(sheetId, () => updateFormField(sheetId, field.id, { value: text, needsReview: undefined }));
    onClose();
  };

  return (
    <div
      data-no-drag
      className="p-2 rounded-xl border border-andros-border bg-andros-canvas space-y-1.5"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5 shrink-0 text-andros-muted" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar nodo del lienzo"
          aria-label="Buscar nodo del lienzo"
          className="w-full min-w-0 h-11 md:h-8 px-2 rounded-lg bg-andros-card border border-andros-border outline-none text-[12px] text-andros-primary placeholder:text-andros-muted focus:border-andros-accent"
        />
        <button type="button" onClick={onClose} aria-label="Cerrar el selector de nodos" className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center justify-center">
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-andros-muted">No hay otros nodos en el lienzo.</p>
      ) : (
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {list.map((n) => {
            const isOpen = expanded === n.id;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : n.id)}
                  className="w-full min-h-11 md:min-h-8 px-2 rounded-lg text-left text-[12px] text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5"
                >
                  {ids.includes(n.id) && <Link2 className="w-3 h-3 shrink-0 text-andros-accent-ink" aria-label="Conectado" />}
                  <span className="truncate">{n.title || "Sin título"}</span>
                </button>
                {isOpen && (
                  <div className="pl-2 pt-1 flex flex-wrap gap-1">
                    {nodeReferenceOptions(n).map((o) => (
                      <button
                        key={`${o.label}-${o.value}`}
                        type="button"
                        onClick={() => insert(o.value)}
                        title={o.value}
                        className="max-w-full min-h-11 md:min-h-7 px-2 rounded-lg border border-andros-border bg-andros-card text-[11px] text-andros-primary hover:border-andros-accent active:scale-[0.96] spring-micro truncate"
                      >
                        <span className="text-andros-muted">{o.label}:</span> {o.value.slice(0, 40)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
