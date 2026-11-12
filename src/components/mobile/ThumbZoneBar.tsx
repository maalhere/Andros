"use client";

import React from "react";
import { Layers, PlusCircle, Library, Sparkles } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

export const ThumbZoneBar: React.FC = () => {
  const activeMobileSheet = useWorkspaceStore((s) => s.activeMobileSheet);
  const setActiveMobileSheet = useWorkspaceStore((s) => s.setActiveMobileSheet);

  return (
    <nav
      aria-label="Navegación Táctil Inferior"
      className="fixed bottom-3 left-3 right-3 z-40 flex items-center justify-around px-2 py-1.5 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark"
    >
      {/* Vista Pila */}
      <button
        type="button"
        onClick={() => setActiveMobileSheet("none")}
        className={`min-w-[48px] min-h-[44px] px-3 rounded-xl flex flex-col items-center justify-center gap-0.5 spring-micro active:scale-95 ${
          activeMobileSheet === "none"
            ? "text-andros-primary bg-andros-border/60"
            : "text-andros-muted"
        }`}
      >
        <Layers className="w-4 h-4" />
        <span className="text-[10px] font-medium">Nodos</span>
      </button>

      {/* Crear Nodo */}
      <button
        type="button"
        onClick={() =>
          setActiveMobileSheet(
            activeMobileSheet === "new-node" ? "none" : "new-node"
          )
        }
        className={`min-w-[48px] min-h-[44px] px-3 rounded-xl flex flex-col items-center justify-center gap-0.5 spring-micro active:scale-95 ${
          activeMobileSheet === "new-node"
            ? "text-andros-primary bg-andros-border/60"
            : "text-andros-muted"
        }`}
      >
        <PlusCircle className="w-4 h-4" />
        <span className="text-[10px] font-medium">Nuevo</span>
      </button>

      {/* Biblioteca */}
      <button
        type="button"
        onClick={() =>
          setActiveMobileSheet(
            activeMobileSheet === "library" ? "none" : "library"
          )
        }
        className={`min-w-[48px] min-h-[44px] px-3 rounded-xl flex flex-col items-center justify-center gap-0.5 spring-micro active:scale-95 ${
          activeMobileSheet === "library"
            ? "text-andros-primary bg-andros-border/60"
            : "text-andros-muted"
        }`}
      >
        <Library className="w-4 h-4" />
        <span className="text-[10px] font-medium">Biblioteca</span>
      </button>

      {/* Oráculo IA */}
      <button
        type="button"
        onClick={() =>
          setActiveMobileSheet(
            activeMobileSheet === "oracle" ? "none" : "oracle"
          )
        }
        className="min-w-[88px] min-h-[44px] px-3.5 rounded-xl bg-andros-primary text-andros-canvas flex items-center justify-center gap-1.5 spring-micro active:scale-95 shadow-sm"
      >
        <Sparkles className="w-4 h-4 text-andros-accent" />
        <span className="text-xs font-semibold">Oráculo</span>
      </button>
    </nav>
  );
};
