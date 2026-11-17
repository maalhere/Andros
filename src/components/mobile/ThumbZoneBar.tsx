"use client";

import React from "react";
import { MousePointer2, PenLine, Plus, Sparkles } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { quickAddSketch } from "@/lib/canvas/quickAdd";

// ============================================================================
// ANDROS — BARRA INFERIOR DEL TELÉFONO (zona del pulgar)
// 4 botones claros con icono + etiqueta: Seleccionar · Agregar · Dibujar · Oráculo IA
// ============================================================================

const BASE =
  "flex-1 min-w-0 min-h-[52px] px-1 rounded-xl flex flex-col items-center justify-center gap-0.5 spring-micro active:scale-95";

export const ThumbZoneBar: React.FC = () => {
  const activeMobileSheet = useWorkspaceStore((s) => s.activeMobileSheet);
  const setActiveMobileSheet = useWorkspaceStore((s) => s.setActiveMobileSheet);
  const selectNode = useWorkspaceStore((s) => s.selectNode);

  const toggle = (sheet: "new-node" | "oracle") =>
    setActiveMobileSheet(activeMobileSheet === sheet ? "none" : sheet);

  const isIdle = activeMobileSheet === "none" || activeMobileSheet === "node-detail";

  return (
    <nav
      aria-label="Navegación Táctil Inferior"
      className="fixed bottom-3 left-3 right-3 z-40 flex items-center gap-1 p-1.5 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
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
        <Sparkles className="w-[18px] h-[18px] text-andros-accent" />
        <span className="text-[11px] font-semibold">Oráculo IA</span>
      </button>
    </nav>
  );
};
