"use client";

import React, { useRef } from "react";
import { AlertCircle, Play } from "lucide-react";
import { CodeLabEngineeringNode } from "@/types/workspace";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { runCodeLab } from "@/lib/codelab/interpreter";

// ============================================================================
// NODO TIPO 5 — LABORATORIO DE CÓDIGO / CÁLCULO RÁPIDO (TIPO MATLAB LIGERO)
// Editor compacto en JetBrains Mono. Ejecuta variables, funciones matemáticas
// (sin, cos, sqrt, log, linspace…) y, si el código usa plot(x, y), dibuja al
// instante una gráfica SVG con los colores del sistema Dual-Engine. Todo corre
// en un intérprete propio (`src/lib/codelab/interpreter.ts`): nunca usa `eval`
// ni llama a un servidor externo. Variables y resultados quedan en
// `codeLabData` para que el Oráculo IA los pueda leer.
// ============================================================================

interface CodeLabNodeProps {
  node: CodeLabEngineeringNode;
  variant: "canvas" | "stack";
}

const PLACEHOLDER = `F = 500; A = 25;\nesfuerzo = F / A;\nx = linspace(0, 10, 50);\ny = sin(x) * esfuerzo;\nplot(x, y);`;

/** Convierte una serie (x, y) en un trazo SVG limpio de 0 a 100 en ambos ejes. */
function buildPlotPath(x: number[], y: number[]): { path: string; minY: number; maxY: number } {
  const minX = Math.min(...x);
  const maxX = Math.max(...x);
  const minY = Math.min(...y);
  const maxY = Math.max(...y);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const points = x.map((xi, i) => {
    const px = ((xi - minX) / spanX) * 100;
    const py = 100 - ((y[i] - minY) / spanY) * 100;
    return `${px.toFixed(2)},${py.toFixed(2)}`;
  });
  return { path: points.join(" "), minY, maxY };
}

export const CodeLabNodeView: React.FC<CodeLabNodeProps> = ({ node }) => {
  const updateNodePayload = useWorkspaceStore((s) => s.updateNodePayload);
  const data = node.codeLabData;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const run = () => {
    const result = runCodeLab(data.code);
    updateNodePayload(node.id, { result, lastRunAt: "Ahora mismo" });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      run();
    }
    if (e.key === "Tab") {
      // Tabulación simple: inserta 2 espacios en vez de cambiar de campo.
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const { selectionStart, selectionEnd, value } = el;
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      updateNodePayload(node.id, { code: next });
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = selectionStart + 2;
      });
    }
  };

  const variableEntries = Object.entries(data.result?.variables ?? {});
  const plot = data.result?.plot;
  const plotGeometry = plot ? buildPlotPath(plot.x, plot.y) : null;

  return (
    <div className="py-3 space-y-2.5" data-no-drag>
      <textarea
        ref={textareaRef}
        value={data.code}
        onChange={(e) => updateNodePayload(node.id, { code: e.target.value })}
        onKeyDown={handleKeyDown}
        placeholder={PLACEHOLDER}
        rows={5}
        spellCheck={false}
        data-no-drag
        className="w-full resize-none rounded-xl bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none px-3 py-2 text-[12px] leading-relaxed font-mono text-andros-primary placeholder:text-andros-muted/70 spring-micro"
      />

      <button
        type="button"
        onClick={run}
        data-no-drag
        className="w-full min-h-[36px] rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold flex items-center justify-center gap-1.5 spring-micro active:scale-95"
      >
        <Play className="w-3.5 h-3.5 text-andros-accent" />
        Ejecutar
        <kbd className="text-[10px] font-mono opacity-70">Shift+Enter</kbd>
      </button>

      {data.result?.errorMessage && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-[11px] font-mono text-red-500 leading-relaxed">{data.result.errorMessage}</p>
        </div>
      )}

      {plot && plotGeometry && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full h-32 rounded-xl bg-andros-canvas border border-andros-border"
          role="img"
          aria-label="Gráfica generada por plot(x, y)"
        >
          <polyline
            points={plotGeometry.path}
            fill="none"
            stroke="var(--accent-primary)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {variableEntries.length > 0 && (
        <div className="space-y-1 font-mono text-[11px]">
          {variableEntries.slice(0, 6).map(([name, value]) => (
            <div key={name} className="flex justify-between gap-2 tabular-nums">
              <span className="text-andros-muted truncate">{name}</span>
              <span className="text-andros-primary font-semibold truncate">
                {Array.isArray(value)
                  ? `[${value.slice(0, 4).map((n) => n.toPrecision(4)).join(", ")}${value.length > 4 ? "…" : ""}]`
                  : value.toPrecision(6).replace(/\.?0+$/, "")}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.lastRunAt && (
        <p className="text-[10px] font-mono text-andros-muted">Última ejecución: {data.lastRunAt}</p>
      )}
    </div>
  );
};
