"use client";

import React, { useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { useWorkspaceStore, parseAiTextContent, textBlocksToHtml } from "@/store/useWorkspaceStore";
import { noteDataToText } from "@/lib/templates/blueprint";
import { SHEET_MAX_COLUMNS, SHEET_MAX_ROWS, SHEET_COLUMN_LETTERS, setSheetCell } from "@/lib/canvas/sheet";
import { commitWithImpact } from "@/lib/canvas/impactClient";
import type { CalcLatexPayload, SketchNotePayload } from "@/types/workspace";

// ============================================================================
// ANDROS — EDICIÓN DIRECTA EN LAS TARJETAS DE NOTA Y DE CÁLCULO
//
// Las tarjetas generadas (o aplicadas desde una plantilla) deben poder
// retocarse al momento, también con una sola mano en el teléfono:
//   · Nota: «Editar» abre un área de texto con las marcas ligeras de siempre
//     ("# título", "- viñeta", "- [ ] tarea"). Guardar actualiza el cuaderno.
//   · Cálculo: cada celda es un campo; al escribir un número (o una fórmula
//     como =SUM(B2:B6)) toda la hoja se recalcula al instante.
// Los campos llevan `data-no-drag` / son <input>, así que no arrastran el nodo.
// ============================================================================

const MAX_NOTE_CHARS = 8000;

export const NoteTextEditor: React.FC<{ nodeId: string; data: SketchNotePayload }> = ({ nodeId, data }) => {
  const updateNodePayload = useWorkspaceStore((s) => s.updateNodePayload);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(noteDataToText(data.textBlocks, data.checklistItems));
        }}
        className="min-h-11 md:min-h-8 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
      >
        <Pencil className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
        Editar texto
      </button>
    );
  }

  const save = () => {
    const { textBlocks, checklistItems } = parseAiTextContent(draft);
    // Al GUARDAR (nunca por tecla) se decide si el cambio merece revisión de impacto.
    commitWithImpact(nodeId, () =>
      updateNodePayload(nodeId, { textBlocks, checklistItems, richTextHtml: textBlocksToHtml(textBlocks) })
    );
    setDraft(null);
  };

  return (
    <div data-no-drag className="space-y-2">
      <label className="block text-[11px] text-andros-muted" htmlFor={`note-edit-${nodeId}`}>
        Una idea por línea: «# título», «- viñeta», «- [ ] tarea».
      </label>
      <textarea
        id={`note-edit-${nodeId}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX_NOTE_CHARS))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") setDraft(null);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        rows={9}
        className="w-full resize-y rounded-xl bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none p-2.5 text-xs leading-relaxed text-andros-primary"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          className="flex-1 min-h-11 md:min-h-8 rounded-xl bg-andros-accent-fill text-white text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro"
        >
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          Guardar
        </button>
        <button
          type="button"
          onClick={() => setDraft(null)}
          className="min-h-11 md:min-h-8 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Hoja de cálculo editable
// ----------------------------------------------------------------------------

const SheetCellInput: React.FC<{
  nodeId: string;
  address: string;
  label: string;
  numeric: boolean;
  isHeader: boolean;
  cell: CalcLatexPayload["gridCells"][string] | undefined;
  placeholder?: string;
}> = ({ nodeId, address, label, numeric, isHeader, cell, placeholder }) => {
  const updateNodePayload = useWorkspaceStore((s) => s.updateNodePayload);
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const commit = () => {
    const text = draft;
    setDraft(null);
    if (cancelled.current || text === null || text === (cell?.raw ?? "")) {
      cancelled.current = false;
      return;
    }
    // Se lee la hoja más reciente del store: otra celda pudo cambiar mientras tanto.
    const node = useWorkspaceStore.getState().nodes.find((n) => n.id === nodeId);
    if (node?.type !== "calc-latex-node") return;
    // Al salir de la celda (nunca por tecla) se decide si el cambio merece revisión de impacto.
    commitWithImpact(nodeId, () =>
      updateNodePayload(nodeId, { gridCells: setSheetCell(node.calcLatexData.gridCells, address, text) })
    );
  };

  const isFormula = cell?.raw.startsWith("=") ?? false;
  return (
    <input
      type="text"
      inputMode={numeric ? "decimal" : "text"}
      aria-label={label}
      title={isFormula ? cell?.raw : undefined}
      value={draft ?? cell?.computed ?? ""}
      placeholder={placeholder}
      onFocus={(e) => {
        setDraft(cell?.raw ?? "");
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={`w-full min-w-0 h-11 md:h-8 px-2 bg-transparent outline-none focus:bg-andros-canvas focus:ring-1 focus:ring-inset focus:ring-andros-accent placeholder:text-andros-muted text-[12px] ${
        numeric ? "text-right font-mono tabular-nums" : "text-left"
      } ${
        cell?.error
          ? "text-andros-danger"
          : isHeader
            ? "text-andros-muted"
            : isFormula
              ? "text-andros-accent-ink font-semibold"
              : "text-andros-primary"
      }`}
    />
  );
};

export const CalcSheetEditor: React.FC<{ nodeId: string; data: CalcLatexPayload }> = ({ nodeId, data }) => {
  const rows = Math.min(Math.max(data.gridSize.rows, 1), SHEET_MAX_ROWS);
  const columns = SHEET_COLUMN_LETTERS.slice(0, Math.min(Math.max(data.gridSize.columns, 1), SHEET_MAX_COLUMNS)).split("");
  const setRows = (next: number) =>
    useWorkspaceStore.getState().updateNodePayload(nodeId, { gridSize: { ...data.gridSize, rows: next } });

  return (
    <div data-no-drag className="rounded-xl border border-andros-border overflow-hidden">
      <div
        role="group"
        aria-label="Hoja de cálculo editable"
        className="grid"
        style={{ gridTemplateColumns: `minmax(0,1fr) ${columns.slice(1).map(() => "minmax(0,5.5rem)").join(" ")}`.trim() }}
      >
        {Array.from({ length: rows }, (_, i) => i + 1).flatMap((row) =>
          columns.map((column, columnIndex) => {
            const address = `${column}${row}`;
            const cell = data.gridCells[address];
            // Fila libre del presupuesto: invita a escribir una partida nueva.
            const isSpare = row > 1 && columnIndex <= 1 && !cell && !data.gridCells[`A${row}`] && !data.gridCells[`B${row}`];
            return (
              <div key={address} className={`border-b border-andros-border ${columnIndex > 0 ? "border-l" : ""} ${row === 1 ? "bg-andros-canvas" : ""}`}>
                <SheetCellInput
                  nodeId={nodeId}
                  address={address}
                  label={`Celda ${address}`}
                  numeric={columnIndex > 0}
                  isHeader={row === 1}
                  cell={cell}
                  placeholder={isSpare ? (columnIndex === 0 ? "Nueva partida" : "0") : undefined}
                />
              </div>
            );
          })
        )}
      </div>
      {rows < SHEET_MAX_ROWS && (
        <button
          type="button"
          onClick={() => setRows(rows + 1)}
          className="w-full min-h-11 md:min-h-8 text-[11px] text-andros-muted hover:text-andros-primary hover:bg-andros-border/30 active:scale-[0.98] spring-micro"
        >
          + Fila
        </button>
      )}
    </div>
  );
};
