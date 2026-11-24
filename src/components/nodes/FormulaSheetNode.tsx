"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Cable,
  Check,
  Link2,
  Link2Off,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCanvasReadOnly, useCollabStore } from "@/store/useCollabStore";
import { commitWithImpact, snapshotOf } from "@/lib/canvas/impactClient";
import { KatexMath } from "@/components/math/KatexMath";
import {
  expressionLatex,
  formulaSignature,
  originLabel,
  resolveFormula,
  type NumericSourceField,
  type ResolvedFormula,
  type ResolvedVariable,
} from "@/lib/math/formulaBinding";
import { compileFormula, formatFormulaInput } from "@/lib/math/formulaEval";
import {
  FORMULA_MAX_VARIABLES,
  clampDecimals,
  latexFromExpression,
  latexText,
  missingVariablesFor,
} from "@/lib/math/formulaSchema";
import {
  addFormulaVariable,
  addVariables,
  patchFormulaSheet,
  removeFormulaVariableWithUndo,
  renameFormulaVariable,
  setVariableAliases,
  setVariableSource,
  updateFormulaVariable,
} from "@/lib/math/formulaActions";
import type { FormulaSheetEngineeringNode, FormulaVariable } from "@/types/workspace";

// ============================================================================
// ANDROS — NODO «FICHA DE FÓRMULA LATEX REACTIVA» (`formula-sheet-node`)
//
// 1. Fórmula simbólica con KaTeX (este módulo se descarga solo cuando aparece
//    la primera fórmula del lienzo: KaTeX no entra en el JS inicial de `/`).
// 2. Tabla de variables con el valor inyectado, su unidad, el origen
//    («← Historial Clínico · peso_kg» o «Manual») y un selector para enlazar
//    cualquier campo numérico de las tarjetas conectadas.
// 3. Sustitución numérica y resultado final destacado.
// Todo se recalcula en 0 ms y sin IA cuando cambia un dato de una ficha
// conectada (aquí o en la sala en vivo). Respeta el modo solo lectura.
// ============================================================================

const LIVE_SYNC_MS = 150;

const INPUT =
  "w-full min-w-0 h-11 md:h-8 px-2.5 rounded-lg bg-andros-canvas border border-andros-border outline-none text-[12px] text-andros-primary placeholder:text-andros-muted focus:border-andros-accent disabled:opacity-60";

/** Anuncia en la sala qué tarjeta editas mientras el foco esté dentro de ella. */
function usePresenceHandlers(nodeId: string) {
  return {
    onFocusCapture: () => useCollabStore.getState().setEditingNodeId(nodeId),
    onBlurCapture: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      useCollabStore.getState().clearEditingNodeId(nodeId);
    },
  };
}

// ----------------------------------------------------------------------------
// Resolución en vivo (selector estable de Zustand)
// ----------------------------------------------------------------------------

/**
 * Última resolución por tarjeta. El selector devuelve el MISMO objeto mientras
 * no cambie nada que la tarjeta muestre: arrastrar otras tarjetas no la repinta.
 */
const resolvedCache = new Map<string, { signature: string; value: ResolvedFormula }>();

function useResolvedFormula(nodeId: string): ResolvedFormula | null {
  useEffect(() => () => void resolvedCache.delete(nodeId), [nodeId]);
  return useWorkspaceStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId);
    if (node?.type !== "formula-sheet-node") return null;
    const value = resolveFormula(node, s);
    const signature = `${formulaSignature(value)}|${JSON.stringify(node.formulaSheetData)}`;
    const hit = resolvedCache.get(nodeId);
    if (hit && hit.signature === signature) return hit.value;
    resolvedCache.set(nodeId, { signature, value });
    return value;
  });
}

// ----------------------------------------------------------------------------
// Valor manual con envío en vivo (y revisión de impacto al confirmar)
// ----------------------------------------------------------------------------

interface ManualSession {
  before: string | null;
  original: number | null;
  dirty: boolean;
  cancelled: boolean;
}

const parseNumber = (text: string): number | null => {
  const n = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(n) ? null : n;
};

const ManualValueInput: React.FC<{
  nodeId: string;
  variable: FormulaVariable;
  missing: boolean;
  disabled: boolean;
}> = ({ nodeId, variable, missing, disabled }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const session = useRef<ManualSession | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const stored = typeof variable.manualValue === "number" ? formatFormulaInput(variable.manualValue) : "";
  const shown = draft ?? stored;

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const current = session.current;
    const text = draft;
    session.current = null;
    setDraft(null);
    if (!current || text === null) return;
    if (current.cancelled) {
      if (current.dirty) updateFormulaVariable(nodeId, variable.key, { manualValue: current.original });
      return;
    }
    const value = parseNumber(text);
    if (!current.dirty && value === current.original) return;
    commitWithImpact(nodeId, () => updateFormulaVariable(nodeId, variable.key, { manualValue: value }), current.before);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      disabled={disabled}
      placeholder="—"
      aria-label={`Valor manual de «${variable.label}»${variable.unit ? ` en ${variable.unit}` : ""}`}
      aria-invalid={missing}
      onFocus={() => {
        session.current = {
          before: snapshotOf(nodeId),
          original: typeof variable.manualValue === "number" ? variable.manualValue : null,
          dirty: false,
          cancelled: false,
        };
        setDraft(stored);
      }}
      onChange={(e) => {
        const next = e.target.value.slice(0, 32);
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          // En vivo: la fórmula se recalcula y viaja a la sala mientras escribes.
          if (updateFormulaVariable(nodeId, variable.key, { manualValue: parseNumber(next) }) && session.current) {
            session.current.dirty = true;
          }
        }, LIVE_SYNC_MS);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          if (session.current) session.current.cancelled = true;
          e.currentTarget.blur();
        }
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`w-24 shrink-0 h-11 md:h-7 px-2 rounded-lg bg-andros-canvas border outline-none text-right font-mono tabular-nums text-[12px] text-andros-primary placeholder:text-andros-muted focus:border-andros-accent disabled:opacity-60 ${
        missing ? "border-andros-warning" : "border-andros-border"
      }`}
    />
  );
};

// ----------------------------------------------------------------------------
// Fila de una variable
// ----------------------------------------------------------------------------

const sourceValue = (field: NumericSourceField) => `${field.nodeId}::${field.fieldKey}`;

const VariableRow: React.FC<{
  nodeId: string;
  entry: ResolvedVariable;
  sources: NumericSourceField[];
  readOnly: boolean;
}> = ({ nodeId, entry, sources, readOnly }) => {
  const { variable } = entry;
  const fromSource = (entry.origin === "auto" || entry.origin === "binding") && entry.source;
  const sourceHasValue = fromSource && entry.source?.value !== null;
  const showManual = !readOnly && !sourceHasValue;
  const missing = entry.value === null;
  const selectId = `formula-src-${nodeId}-${variable.key}`;

  const current = variable.lockManual
    ? "manual"
    : entry.origin === "binding" && entry.source
      ? sourceValue(entry.source)
      : "auto";

  const onPick = (value: string) => {
    const before = snapshotOf(nodeId);
    commitWithImpact(
      nodeId,
      () => {
        if (value === "auto" || value === "manual") setVariableSource(nodeId, variable.key, value);
        else {
          const [sourceNodeId, fieldKey] = value.split("::");
          setVariableSource(nodeId, variable.key, { nodeId: sourceNodeId, fieldKey });
        }
      },
      before
    );
  };

  return (
    <li className="py-2 border-b border-andros-border last:border-b-0 space-y-1">
      <div className="flex items-center gap-2 min-h-7">
        <span className="shrink-0 min-w-[1.75rem] text-center text-[13px] text-andros-primary" aria-hidden="true">
          <KatexMath latex={variable.symbolLatex || variable.key} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-andros-primary" title={`Clave: ${variable.key}`}>
            {variable.label}
          </span>
          {variable.unit && <span className="block text-[10px] text-andros-muted">{variable.unit}</span>}
        </span>
        {showManual ? (
          <ManualValueInput nodeId={nodeId} variable={variable} missing={missing} disabled={readOnly} />
        ) : (
          <span
            className={`shrink-0 font-mono tabular-nums text-[13px] font-semibold ${missing ? "text-andros-warning" : "text-andros-primary"}`}
          >
            {entry.value === null ? "—" : formatFormulaInput(entry.value)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 pl-9">
        <span
          className={`min-w-0 flex-1 flex items-center gap-1 text-[10px] ${
            fromSource ? "text-andros-success" : entry.origin === "manual" ? "text-andros-muted" : "text-andros-warning"
          }`}
        >
          {fromSource ? (
            <Link2 className="w-3 h-3 shrink-0" aria-hidden="true" />
          ) : entry.origin === "none" ? (
            <TriangleAlert className="w-3 h-3 shrink-0" aria-hidden="true" />
          ) : null}
          <span className="truncate font-mono" title={originLabel(entry)}>
            {originLabel(entry)}
          </span>
        </span>
        {!readOnly && sources.length > 0 && (
          <>
            <label htmlFor={selectId} className="sr-only">
              Origen del dato de «{variable.label}»
            </label>
            <select
              id={selectId}
              value={current}
              onChange={(e) => onPick(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="shrink-0 max-w-[7.5rem] h-11 md:h-6 px-1.5 rounded-md bg-andros-canvas border border-andros-border text-[10px] text-andros-primary outline-none focus:border-andros-accent"
            >
              <option value="auto">Automático</option>
              {sources.map((field) => (
                <option key={sourceValue(field)} value={sourceValue(field)}>
                  {field.nodeTitle.slice(0, 24)} · {field.label.slice(0, 28)}
                  {field.value !== null ? ` = ${formatFormulaInput(field.value)}` : " (vacío)"}
                  {field.unit ? ` ${field.unit}` : ""}
                </option>
              ))}
              <option value="manual">Solo manual</option>
            </select>
          </>
        )}
      </div>
      {entry.brokenBinding && (
        <p className="pl-9 flex items-center gap-1 text-[10px] text-andros-warning">
          <Link2Off className="w-3 h-3 shrink-0" aria-hidden="true" />
          El campo enlazado ya no está conectado.
        </p>
      )}
      {entry.unitMismatch && entry.source?.unit && (
        <p className="pl-9 flex items-center gap-1 text-[10px] text-andros-warning">
          <TriangleAlert className="w-3 h-3 shrink-0" aria-hidden="true" />
          Unidad distinta: la ficha usa {entry.source.unit}, la fórmula espera {variable.unit}.
        </p>
      )}
    </li>
  );
};

// ----------------------------------------------------------------------------
// Editor de la estructura (LaTeX, expresión, resultado y variables)
// ----------------------------------------------------------------------------

const stopKeys = (e: React.KeyboardEvent<HTMLElement>) => {
  e.stopPropagation();
  if (e.key === "Enter" && e.currentTarget.tagName === "INPUT") (e.currentTarget as HTMLInputElement).blur();
};

const VariableEditor: React.FC<{ nodeId: string; variable: FormulaVariable }> = ({ nodeId, variable }) => {
  const [key, setKey] = useState(variable.key);
  const [symbol, setSymbol] = useState(variable.symbolLatex);
  const [label, setLabel] = useState(variable.label);
  const [unit, setUnit] = useState(variable.unit ?? "");
  const [aliases, setAliases] = useState(variable.aliases.join(", "));
  const [keyError, setKeyError] = useState<string | null>(null);
  const base = `fx-${nodeId}-${variable.key}`;

  return (
    <li className="p-2 rounded-xl border border-andros-border bg-andros-canvas space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          id={`${base}-key`}
          aria-label="Clave de la variable (se usa en la expresión)"
          value={key}
          maxLength={32}
          onChange={(e) => {
            setKey(e.target.value);
            setKeyError(null);
          }}
          onBlur={() => {
            const error = renameFormulaVariable(nodeId, variable.key, key);
            if (error) {
              setKeyError(error);
              setKey(variable.key);
            }
          }}
          onKeyDown={stopKeys}
          aria-invalid={Boolean(keyError)}
          className={`${INPUT} bg-andros-card max-w-[5.5rem] font-mono`}
        />
        <input
          aria-label="Símbolo LaTeX"
          placeholder="Símbolo LaTeX"
          value={symbol}
          maxLength={60}
          onChange={(e) => setSymbol(e.target.value)}
          onBlur={() => updateFormulaVariable(nodeId, variable.key, { symbolLatex: symbol.trim() || variable.key })}
          onKeyDown={stopKeys}
          className={`${INPUT} bg-andros-card font-mono`}
        />
        <button
          type="button"
          onClick={() => removeFormulaVariableWithUndo(nodeId, variable.key)}
          aria-label={`Quitar la variable «${variable.label}»`}
          className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg text-andros-muted hover:text-andros-danger hover:bg-andros-border/40 flex items-center justify-center active:scale-[0.96] spring-micro"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      {keyError && (
        <p role="alert" className="text-[10px] text-andros-danger">
          {keyError}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <input
          aria-label="Nombre de la variable"
          placeholder="Nombre (p. ej. Peso corporal)"
          value={label}
          maxLength={80}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => updateFormulaVariable(nodeId, variable.key, { label: label.trim() || variable.key })}
          onKeyDown={stopKeys}
          className={`${INPUT} bg-andros-card`}
        />
        <input
          aria-label={`Unidad de «${variable.label}»`}
          placeholder="Unidad"
          value={unit}
          maxLength={24}
          onChange={(e) => setUnit(e.target.value)}
          onBlur={() => updateFormulaVariable(nodeId, variable.key, { unit: unit.trim() || undefined })}
          onKeyDown={stopKeys}
          className={`${INPUT} bg-andros-card max-w-[5.5rem] font-mono`}
        />
      </div>
      <input
        aria-label={`Alias para auto-emparejar «${variable.label}», separados por comas`}
        placeholder="Alias: peso, peso_kg, masa"
        value={aliases}
        onChange={(e) => setAliases(e.target.value)}
        onBlur={() => {
          setVariableAliases(nodeId, variable.key, aliases);
          setAliases(
            aliases
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean)
              .join(", ")
          );
        }}
        onKeyDown={stopKeys}
        className={`${INPUT} bg-andros-card font-mono`}
      />
    </li>
  );
};

const FormulaEditor: React.FC<{ node: FormulaSheetEngineeringNode }> = ({ node }) => {
  const data = node.formulaSheetData;
  const [latex, setLatex] = useState(data.latex);
  const [expression, setExpression] = useState(data.expression);
  const [resultLabel, setResultLabel] = useState(data.resultLabel);
  const [resultUnit, setResultUnit] = useState(data.resultUnit);
  const compiled = useMemo(() => compileFormula(expression), [expression]);
  const missing = useMemo(() => missingVariablesFor(expression, data.variables), [expression, data.variables]);
  const base = `fx-${node.id}`;

  const saveExpression = () => {
    if (expression !== data.expression) {
      commitWithImpact(node.id, () => patchFormulaSheet(node.id, () => ({ expression: expression.trim() })));
    }
  };

  return (
    <div data-no-drag className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${base}-latex`} className="block text-[11px] font-medium text-andros-muted">
          Fórmula en LaTeX (lo que se ve)
        </label>
        <textarea
          id={`${base}-latex`}
          value={latex}
          rows={2}
          maxLength={600}
          placeholder="\text{IMC} = \frac{m}{h^{2}}"
          onChange={(e) => setLatex(e.target.value)}
          onBlur={() => latex !== data.latex && patchFormulaSheet(node.id, () => ({ latex: latex.trim() }))}
          onKeyDown={(e) => e.stopPropagation()}
          className="w-full resize-y rounded-lg bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none p-2 font-mono text-[11px] text-andros-primary placeholder:text-andros-muted"
        />
        {latex.trim() && latex !== data.latex && (
          <div className="px-2 py-1 rounded-lg border border-dashed border-andros-border text-andros-primary">
            <KatexMath latex={latex} display />
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor={`${base}-expr`} className="block text-[11px] font-medium text-andros-muted">
          Expresión a calcular (usa las claves de las variables)
        </label>
        <input
          id={`${base}-expr`}
          value={expression}
          maxLength={400}
          placeholder="m / h^2"
          onChange={(e) => setExpression(e.target.value)}
          onBlur={saveExpression}
          onKeyDown={stopKeys}
          aria-invalid={!compiled.ok && compiled.code !== "empty"}
          aria-describedby={`${base}-expr-help`}
          className={`${INPUT} font-mono ${!compiled.ok && compiled.code !== "empty" ? "border-andros-danger" : ""}`}
        />
        <p id={`${base}-expr-help`} className="text-[10px] leading-relaxed text-andros-muted">
          {!compiled.ok && compiled.code !== "empty" ? (
            <span className="text-andros-danger">{compiled.message}</span>
          ) : (
            "+ − * / ^ ( ) y sqrt, abs, round, min, max, log, ln, exp, sin, cos, tan, pi."
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {missing.length > 0 && (
            <button
              type="button"
              onClick={() => {
                saveExpression();
                addVariables(node.id, missing);
              }}
              className="min-h-11 md:min-h-7 px-2 rounded-lg border border-andros-border text-[11px] text-andros-primary hover:bg-andros-border/40 flex items-center gap-1 active:scale-[0.96] spring-micro"
            >
              <Plus className="w-3 h-3 text-andros-accent-ink" aria-hidden="true" />
              Añadir {missing.map((v) => v.key).join(", ")}
            </button>
          )}
          {compiled.ok && (
            <button
              type="button"
              onClick={() => {
                const generated = latexFromExpression({ expression, resultLabel, variables: data.variables });
                if (!generated) return;
                setLatex(generated);
                patchFormulaSheet(node.id, () => ({ latex: generated, expression: expression.trim() }));
              }}
              className="min-h-11 md:min-h-7 px-2 rounded-lg border border-andros-border text-[11px] text-andros-primary hover:bg-andros-border/40 flex items-center gap-1 active:scale-[0.96] spring-micro"
            >
              <Wand2 className="w-3 h-3 text-andros-accent-ink" aria-hidden="true" />
              LaTeX desde la expresión
            </button>
          )}
        </div>
      </div>

      <div className="flex items-end gap-1.5">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`${base}-rlabel`} className="block text-[11px] font-medium text-andros-muted">
            Resultado
          </label>
          <input
            id={`${base}-rlabel`}
            value={resultLabel}
            maxLength={80}
            onChange={(e) => setResultLabel(e.target.value)}
            onBlur={() => patchFormulaSheet(node.id, () => ({ resultLabel: resultLabel.trim() || "Resultado" }))}
            onKeyDown={stopKeys}
            className={INPUT}
          />
        </div>
        <div className="w-20 space-y-1">
          <label htmlFor={`${base}-runit`} className="block text-[11px] font-medium text-andros-muted">
            Unidad
          </label>
          <input
            id={`${base}-runit`}
            value={resultUnit}
            maxLength={24}
            onChange={(e) => setResultUnit(e.target.value)}
            onBlur={() => patchFormulaSheet(node.id, () => ({ resultUnit: resultUnit.trim() }))}
            onKeyDown={stopKeys}
            className={`${INPUT} font-mono`}
          />
        </div>
        <div className="w-16 space-y-1">
          <label htmlFor={`${base}-rdec`} className="block text-[11px] font-medium text-andros-muted">
            Decimales
          </label>
          <select
            id={`${base}-rdec`}
            value={clampDecimals(data.resultDecimals ?? 2)}
            onChange={(e) => patchFormulaSheet(node.id, () => ({ resultDecimals: clampDecimals(e.target.value) }))}
            onKeyDown={(e) => e.stopPropagation()}
            className={`${INPUT} font-mono`}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-andros-muted">
          Variables <span className="font-mono tabular-nums">({data.variables.length}/{FORMULA_MAX_VARIABLES})</span>
        </p>
        {data.variables.length > 0 && (
          <ul className="space-y-1.5">
            {data.variables.map((variable) => (
              <VariableEditor key={variable.key} nodeId={node.id} variable={variable} />
            ))}
          </ul>
        )}
        {data.variables.length < FORMULA_MAX_VARIABLES && (
          <button
            type="button"
            onClick={() => addFormulaVariable(node.id)}
            className="min-h-11 md:min-h-7 px-2 rounded-lg border border-andros-border text-[11px] text-andros-primary hover:bg-andros-border/40 flex items-center gap-1 active:scale-[0.96] spring-micro"
          >
            <Plus className="w-3 h-3 text-andros-accent-ink" aria-hidden="true" />
            Variable
          </button>
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Nodo completo
// ----------------------------------------------------------------------------

export const FormulaSheetNodeView: React.FC<{ node: FormulaSheetEngineeringNode; variant: "canvas" | "stack" }> = ({
  node,
}) => {
  const data = node.formulaSheetData;
  const readOnly = useCanvasReadOnly();
  const [editing, setEditing] = useState(false);
  const presence = usePresenceHandlers(node.id);
  const resolved = useResolvedFormula(node.id);

  const latex = data.latex.trim() || expressionLatex(data);
  const result = resolved?.result;
  const severe = result && !result.ok && result.code !== "missing" && result.code !== "empty";

  return (
    <div className="py-3 space-y-3" {...presence}>
      {/* Resumen */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {data.aiGenerated && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-andros-border text-andros-muted">
            <Sparkles className="w-3 h-3 text-andros-accent-ink" aria-hidden="true" />
            Generada con IA
          </span>
        )}
        {resolved && resolved.sourceNodeCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-andros-muted" title="Tarjetas conectadas que aportan datos">
            <Cable className="w-3 h-3" aria-hidden="true" />
            <span className="font-mono tabular-nums">{resolved.sourceNodeCount}</span>
            {resolved.sourceNodeCount === 1 ? "fuente" : "fuentes"}
          </span>
        )}
      </div>
      {data.description && <p className="text-xs leading-relaxed text-andros-muted">{data.description}</p>}

      {/* 1. Fórmula simbólica */}
      <div
        data-no-drag
        role="group"
        aria-label={`Fórmula de «${node.title}»`}
        className="rounded-xl border border-andros-border bg-andros-canvas px-3 py-2.5 text-andros-primary"
      >
        {latex ? (
          <KatexMath latex={latex} display />
        ) : (
          <p className="text-xs text-andros-muted">Sin fórmula todavía. Pulsa «Editar fórmula» para escribirla.</p>
        )}
      </div>

      {editing && !readOnly ? (
        <FormulaEditor node={node} />
      ) : (
        <>
          {/* 2. Variables con su valor inyectado */}
          {resolved && resolved.variables.length > 0 && (
            <ul data-no-drag aria-label="Variables de la fórmula" className="rounded-xl border border-andros-border px-2.5">
              {resolved.variables.map((entry) => (
                <VariableRow
                  key={entry.variable.key}
                  nodeId={node.id}
                  entry={entry}
                  sources={resolved.sources}
                  readOnly={readOnly}
                />
              ))}
            </ul>
          )}
          {resolved && resolved.sourceNodeCount === 0 && resolved.variables.length > 0 && !readOnly && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-andros-muted">
              <Cable className="w-3.5 h-3.5 mt-0.5 shrink-0 text-andros-accent-ink" aria-hidden="true" />
              Conecta una ficha o una hoja de cálculo hacia esta fórmula y sus números se llenarán solos.
            </p>
          )}

          {/* 3. Sustitución numérica y resultado final */}
          {resolved && (
            <div className="rounded-xl border border-andros-border bg-andros-accent/5 px-3 py-2.5 space-y-1.5">
              {resolved.substitutionLatex && (
                <div data-no-drag className="text-[12px] text-andros-muted">
                  <KatexMath latex={`\\text{${latexText(data.resultLabel || "Resultado")}} = ${resolved.substitutionLatex}`} display />
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] font-medium text-andros-muted">
                  {data.resultLabel || "Resultado"}
                </span>
                <output
                  aria-live="polite"
                  className={`shrink-0 font-mono tabular-nums text-2xl font-semibold leading-none ${
                    resolved.resultText !== null ? "text-andros-accent-ink" : "text-andros-muted"
                  }`}
                >
                  {resolved.resultText ?? "—"}
                  {resolved.resultText !== null && data.resultUnit && (
                    <span className="ml-1 text-sm font-medium text-andros-muted">{data.resultUnit}</span>
                  )}
                </output>
              </div>
              {resolved.message && (
                <p
                  role="status"
                  className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${severe ? "text-andros-danger" : "text-andros-warning"}`}
                >
                  <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  {resolved.message}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {!readOnly && (
        <div data-no-drag className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            className={`min-h-11 md:min-h-8 px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 active:scale-[0.96] spring-micro ${
              editing
                ? "bg-andros-accent-fill border-transparent text-white"
                : "border-andros-border text-andros-primary hover:bg-andros-border/40"
            }`}
          >
            {editing ? (
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Settings2 className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
            )}
            {editing ? "Listo" : "Editar fórmula"}
          </button>
        </div>
      )}
    </div>
  );
};
