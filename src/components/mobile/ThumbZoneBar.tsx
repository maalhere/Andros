"use client";

import React, { useEffect } from "react";
import { Eye, MousePointer2, PenLine, Plus, Sparkles } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { quickAddSketch } from "@/lib/canvas/quickAdd";

// ============================================================================
// ANDROS — BARRA INFERIOR DEL TELÉFONO (zona del pulgar)
// 4 botones claros con icono + etiqueta: Seleccionar · Agregar · Dibujar · Oráculo IA
// En solo lectura (sala llena 6/6) solo queda «Seleccionar» + aviso «Solo lectura».
// ============================================================================

const BASE =
  "flex-1 min-w-0 min-h-[52px] px-1 rounded-xl flex flex-col items-center justify-center gap-0.5 spring-micro active:scale-[0.96]";

export const ThumbZoneBar: React.FC = () => {
  const activeMobileSheet = useWorkspaceStore((s) => s.activeMobileSheet);
  const setActiveMobileSheet = useWorkspaceStore((s) => s.setActiveMobileSheet);
  const selectNode = useWorkspaceStore((s) => s.selectNode);
  const readOnly = useCanvasReadOnly();

  // Al quedar en solo lectura se cierra cualquier cajón de escritura abierto.
  useEffect(() => {
    if (!readOnly) return;
    const sheet = useWorkspaceStore.getState().activeMobileSheet;
    if (sheet === "new-node" || sheet === "connect" || sheet === "oracle") {
      useWorkspaceStore.getState().setActiveMobileSheet("none");
    }
  }, [readOnly]);

  const toggle = (sheet: "new-node" | "oracle") =>
    setActiveMobileSheet(activeMobileSheet === sheet ? "none" : sheet);

  const isIdle = activeMobileSheet === "none" || activeMobileSheet === "node-detail";

  return (
    <nav
      aria-label={readOnly ? "Navegación Táctil Inferior (solo lectura)" : "Navegación Táctil Inferior"}
      className="fixed left-3 right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-1 p-1.5 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark"
    >
      <button
        type="button"
        onClick={() => {
          setActiveMobileSheet("none");
          selectNode(null);
        }}
        className={`${BASE} ${isIdle ? "text-andros-primary bg-andros-border/60" : "text-andros-muted"}`}
      >
        <MousePointer2 className="w-[18px] h-[18px]" />
        <span className="text-[11px] font-medium">Seleccionar</span>
      </button>

      {readOnly ? (
        <p
          role="status"
          className="flex-[3] min-w-0 min-h-[52px] px-3 flex items-center justify-center gap-2 text-[12px] font-medium text-andros-muted text-center"
        >
          <Eye className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
          <span>Solo lectura · sala llena</span>
        </p>
      ) : (
        <>
          <button
            type="button"
            data-tour="add"
            onClick={() => toggle("new-node")}
            aria-expanded={activeMobileSheet === "new-node"}
            className={`${BASE} ${
              activeMobileSheet === "new-node" ? "text-andros-primary bg-andros-border/60" : "text-andros-muted"
            }`}
          >
            <Plus className="w-[18px] h-[18px]" />
            <span className="text-[11px] font-medium">Agregar</span>
          </button>

          <button
            type="button"
            data-tour="draw"
            onClick={() => quickAddSketch()}
            className={`${BASE} text-andros-muted`}
          >
            <PenLine className="w-[18px] h-[18px]" />
            <span className="text-[11px] font-medium">Dibujar</span>
          </button>

          <button
            type="button"
            data-tour="oracle"
            onClick={() => toggle("oracle")}
            className={`${BASE} bg-andros-primary text-andros-canvas shadow-sm`}
          >
            <Sparkles className="w-[18px] h-[18px] text-andros-accent-ink" />
            <span className="text-[11px] font-semibold">Oráculo IA</span>
          </button>
        </>
      )}
    </nav>
  );
};
