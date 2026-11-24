"use client";

import React, { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// ============================================================================
// ANDROS — FÓRMULA RENDERIZADA CON KATEX
// Este módulo (y su CSS) solo se descarga cuando aparece la primera Ficha de
// Fórmula, la Vista Invitado o el PDF del Plan del Día: nunca en el JS inicial
// de `/`. `trust: false` (por defecto) bloquea \href, \url y \html*, así que
// un LaTeX escrito por otra persona o por la IA no puede inyectar enlaces ni
// HTML; `maxExpand` frena las macros recursivas.
// ============================================================================

export interface KatexMathProps {
  latex: string;
  /** `true`: bloque centrado (modo display). */
  display?: boolean;
  className?: string;
}

interface Rendered {
  html: string | null;
  error: string | null;
}

/** LaTeX → HTML + MathML (accesible para lectores de pantalla). Nunca lanza. */
export function renderLatex(latex: string, display = false): Rendered {
  const source = latex.trim();
  if (!source) return { html: null, error: null };
  try {
    const html = katex.renderToString(source, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: "ignore",
      maxSize: 12,
      maxExpand: 200,
      output: "htmlAndMathml",
    });
    return { html, error: null };
  } catch (error) {
    return { html: null, error: error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, "") : "LaTeX no válido" };
  }
}

export const KatexMath: React.FC<KatexMathProps> = ({ latex, display = false, className }) => {
  const { html, error } = useMemo(() => renderLatex(latex, display), [latex, display]);
  if (!html && !error) return null;
  if (error) {
    return (
      <span className={`block font-mono text-[11px] text-andros-warning break-all ${className ?? ""}`} title={error}>
        LaTeX con errores: {latex}
      </span>
    );
  }
  return (
    <span
      className={`${display ? "block" : "inline-block"} max-w-full overflow-x-auto overflow-y-hidden ${className ?? ""}`}
      // HTML generado por KaTeX con `trust: false`: escapa todo el texto de entrada.
      dangerouslySetInnerHTML={{ __html: html! }}
    />
  );
};

export default KatexMath;
