"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { useWorkspaceStore, parseAiTextContent, textBlocksToHtml } from "@/store/useWorkspaceStore";
import { useCollabStore } from "@/store/useCollabStore";
import { noteDataToText } from "@/lib/templates/blueprint";
import { SHEET_MAX_COLUMNS, SHEET_MAX_ROWS, SHEET_COLUMN_LETTERS, setSheetCell } from "@/lib/canvas/sheet";
import { commitWithImpact, snapshotOf } from "@/lib/canvas/impactClient";
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
//
// Colaboración en vivo: mientras escribes, el texto se aplica al lienzo cada
// ~150 ms (viaja por Broadcast a los demás) y el guardado en la nube ocurre en
// segundo plano sin bloquear la escritura. Además se anuncia en Presence qué
// tarjeta editas, para que los demás vean «Editando: Nombre» y no se pisen.
// La revisión de impacto sigue siendo SOLO al confirmar (Guardar / salir).
// ============================================================================

const MAX_NOTE_CHARS = 8000;
/** Retardo del envío en vivo mientras se escribe. */
const LIVE_SYNC_MS = 150;

/** Envío en vivo con debounce; el temporizador se libera al desmontar. */
function useLiveSync() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const schedule = (run: () => void) => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      run();
    }, LIVE_SYNC_MS);
  };
  return { schedule, cancel };
}

/** Anuncia en la sala que estás escribiendo en `nodeId` mientras `active`. */
function useEditingPresence(nodeId: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    useCollabStore.getState().setEditingNodeId(nodeId);
    return () => useCollabStore.getState().clearEditingNodeId(nodeId);
  }, [nodeId, active]);
}

type NoteText = Pick<SketchNotePayload, "textBlocks" | "checklistItems" | "richTextHtml">;

function noteTextFrom(text: string): NoteText {
  const { textBlocks, checklistItems } = parseAiTextContent(text);
  return { textBlocks, checklistItems, richTextHtml: textBlocksToHtml(textBlocks) };
}

export const NoteTextEditor: React.FC<{ nodeId: string; data: SketchNotePayload }> = ({ nodeId, data }) => {
  const updateNodePayload = useWorkspaceStore((s) => s.updateNodePayload);
  const [draft, setDraft] = useState<string | null>(null);
  /** Edición en curso: texto original (para «Cancelar») y foto para el detector de impacto. */
  const session = useRef<{ before: string | null; original: NoteText; dirty: boolean } | null>(null);
  const live = useLiveSync();
  useEditingPresence(nodeId, draft !== null);

  const finish = () => {
    live.cancel();
    session.current = null;
    setDraft(null);
  };

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          session.current = {
            before: snapshotOf(nodeId),
            original: {
              textBlocks: data.textBlocks,
              checklistItems: data.checklistItems,
              richTextHtml: data.richTextHtml,
            },
            dirty: false,
          };
          setDraft(noteDataToText(data.textBlocks, data.checklistItems));
        }}
        className="min-h-11 md:min-h-8 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
      >
        <Pencil className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
        Editar texto
      </button>
    );
  }

  const handleChange = (value: string) => {
    const next = value.slice(0, MAX_NOTE_CHARS);
    setDraft(next);
    // En vivo: los demás ven el texto mientras escribes (sin esperar a Guardar).
    live.schedule(() => {
      updateNodePayload(nodeId, noteTextFrom(next));
      if (session.current) session.current.dirty = true;
    });
  };

  const save = () => {
    const before = session.current ? session.current.before : undefined;
    const text = draft;
    finish();
    // Al GUARDAR (nunca por tecla) se decide si el cambio merece revisión de impacto.
    commitWithImpact(nodeId, () => updateNodePayload(nodeId, noteTextFrom(text)), before);
  };

  const cancel = () => {
    const current = session.current;
    finish();
    // Lo que ya viajó en vivo se deshace: vuelve el texto de antes de editar.
    if (current?.dirty) updateNodePayload(nodeId, current.original);
  };

  return (
    <div data-no-drag className="space-y-2">
      <label className="block text-[11px] text-andros-muted" htmlFor={`note-edit-${nodeId}`}>
        Una idea por línea: «# título», «- viñeta», «- [ ] tarea».
      </label>
      <textarea
        id={`note-edit-${nodeId}`}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") cancel();
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
          onClick={cancel}
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

/** Escribe una celda sobre la hoja MÁS RECIENTE del store (otra celda pudo cambiar). */
function writeSheetCell(nodeId: string, address: string, text: string): boolean {
  const store = useWorkspaceStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (node?.type !== "calc-latex-node") return false;
  store.updateNodePayload(nodeId, { gridCells: setSheetCell(node.calcLatexData.gridCells, address, text) });
  return true;
}

interface CellSession {
  /** Foto de la tarjeta al entrar en la celda (para el detector de impacto). */
  before: string | null;
  /** Valor original: Escape lo restaura aunque ya haya viajado en vivo. */
  originalRaw: string;
  dirty: boolean;
  cancelled: boolean;
}

const SheetCellInput: React.FC<{
  nodeId: string;
  address: string;
  label: string;
  numeric: boolean;
  isHeader: boolean;
  cell: CalcLatexPayload["gridCells"][string] | undefined;
  placeholder?: string;
}> = ({ nodeId, address, label, numeric, isHeader, cell, placeholder }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const session = useRef<CellSession | null>(null);
  const live = useLiveSync();
  useEditingPresence(nodeId, draft !== null);

  const commit = () => {
    live.cancel();
    const current = session.current;
    const text = draft;
    session.current = null;
    setDraft(null);
    if (!current || text === null) return;
    if (current.cancelled) {
      if (current.dirty) writeSheetCell(nodeId, address, current.originalRaw);
      return;
    }
    if (!current.dirty && text === current.originalRaw) return;
    // Al salir de la celda (nunca por tecla) se decide si el cambio merece revisión de impacto.
    commitWithImpact(nodeId, () => writeSheetCell(nodeId, address, text), current.before);
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
        const originalRaw = cell?.raw ?? "";
        session.current = { before: snapshotOf(nodeId), originalRaw, dirty: false, cancelled: false };
        setDraft(originalRaw);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        // En vivo: la hoja se recalcula y viaja a los demás mientras escribes.
        live.schedule(() => {
          if (writeSheetCell(nodeId, address, next) && session.current) session.current.dirty = true;
        });
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          if (session.current) session.current.cancelled = true;
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
