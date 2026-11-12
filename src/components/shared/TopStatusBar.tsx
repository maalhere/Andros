"use client";

import React from "react";
import { RotateCcw } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

interface TopStatusBarProps {
  isMobile: boolean;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({ isMobile }) => {
  const nodesCount = useWorkspaceStore((s) => s.nodes.length);
  const resetCanvasView = useWorkspaceStore((s) => s.resetCanvasView);

  return (
    <header className="fixed top-3 md:top-4 left-3 right-3 md:left-6 md:right-6 z-40 flex items-center justify-between pointer-events-none">
      {/* Identidad del proyecto y migas de pan */}
      <div className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm">
        <div className="w-6 h-6 rounded-lg bg-andros-primary flex items-center justify-center text-andros-canvas font-bold text-xs tracking-wider">
          A
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-andros-primary">Andros</span>
          <span className="text-andros-muted">/</span>
          <span className="font-mono text-andros-muted text-[11px] truncate max-w-[110px] sm:max-w-none">
            workspace-delta-01
          </span>
        </div>
        <div
          className="w-1.5 h-1.5 rounded-full bg-andros-success animate-pulse ml-0.5"
          title="Sincronización activa"
        />
      </div>

      {/* Acciones rápidas y Colaboradores */}
      <div className="pointer-events-auto flex items-center gap-2">
        {!isMobile && (
          <button
            onClick={resetCanvasView}
            className="px-2.5 py-1.5 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-[11px] font-mono text-andros-muted hover:text-andros-primary flex items-center gap-1.5 spring-micro active:scale-95"
            title="Centrar vista del lienzo"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{nodesCount} nodos</span>
          </button>
        )}

        <ThemeToggle />

        {/* Colaboradores activos */}
        <div className="flex items-center -space-x-2 bg-andros-surface backdrop-blur-md p-1 pl-2 rounded-xl border border-andros-border shadow-sm">
          <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-blue-400 text-blue-500 text-[10px] font-mono flex items-center justify-center font-bold">
            ER
          </div>
          <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-500 text-[10px] font-mono flex items-center justify-center font-bold">
            TU
          </div>
          <span className="hidden sm:inline-block pl-3 pr-2 text-[11px] font-mono text-andros-muted">
            2 en línea
          </span>
        </div>
      </div>
    </header>
  );
};
