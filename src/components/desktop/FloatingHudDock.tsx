"use client";

import React from "react";
import {
  MousePointer,
  PlusCircle,
  GitBranch,
  Library,
  Sparkles,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

export const FloatingHudDock: React.FC = () => {
  const activeTool = useWorkspaceStore((s) => s.activeTool);
  const setActiveTool = useWorkspaceStore((s) => s.setActiveTool);
  const spawnNode = useWorkspaceStore((s) => s.spawnNode);
  const setOracleModalOpen = useWorkspaceStore((s) => s.setOracleModalOpen);

  return (
    <nav
      aria-label="Herramientas del Lienzo"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 px-3 py-2 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark spring-micro"
    >
      {/* 1. Puntero (V) */}
      <button
        type="button"
        onClick={() => setActiveTool("pointer")}
        title="Puntero (V)"
        className={`flex items-center gap-1.5 p-2.5 rounded-xl hover:scale-105 active:scale-95 spring-micro ${
          activeTool === "pointer"
            ? "text-andros-primary bg-andros-border/70"
            : "text-andros-muted hover:text-andros-primary hover:bg-andros-border/30"
        }`}
      >
        <MousePointer className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">V</kbd>
      </button>

      {/* 2. Nuevo Nodo (N) */}
      <button
        type="button"
        onClick={() => spawnNode()}
        title="Nuevo Nodo (N)"
        className="flex items-center gap-1.5 p-2.5 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/30 hover:scale-105 active:scale-95 spring-micro"
      >
        <PlusCircle className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">N</kbd>
      </button>

      {/* 3. Conexión (C) */}
      <button
        type="button"
        onClick={() => setActiveTool("connect")}
        title="Conexión (C)"
        className={`flex items-center gap-1.5 p-2.5 rounded-xl hover:scale-105 active:scale-95 spring-micro ${
          activeTool === "connect"
            ? "text-andros-primary bg-andros-border/70"
            : "text-andros-muted hover:text-andros-primary hover:bg-andros-border/30"
        }`}
      >
        <GitBranch className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">C</kbd>
      </button>

      <div className="w-px h-5 bg-andros-border mx-1" />

      {/* 4. Biblioteca Técnica (B) */}
      <button
        type="button"
        onClick={() =>
          spawnNode({
            type: "reference",
            title: "Paper • Eurocode 3 Joints",
            codeTag: "DOI-10.1016",
            summary:
              "Diseño de uniones tubulares soldadas sometidas a fatiga multiaxial.",
          })
        }
        title="Insertar desde Biblioteca Técnica (B)"
        className="flex items-center gap-1.5 p-2.5 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/30 hover:scale-105 active:scale-95 spring-micro"
      >
        <Library className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">B</kbd>
      </button>

      {/* 5. Oráculo IA (⌘K) */}
      <button
        type="button"
        onClick={() => setOracleModalOpen(true)}
        title="Oráculo IA (⌘K)"
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-andros-primary text-andros-canvas hover:opacity-90 hover:scale-105 active:scale-95 spring-micro ml-1 shadow-sm"
      >
        <Sparkles className="w-3.5 h-3.5 text-andros-accent" />
        <span className="text-xs font-semibold tracking-wide">Oráculo</span>
        <kbd className="text-[10px] font-mono opacity-70 bg-andros-canvas/20 px-1 py-0.5 rounded">
          ⌘K
        </kbd>
      </button>
    </nav>
  );
};