"use client";

import React from "react";
import { RotateCcw } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCloudStore } from "@/store/useCloudStore";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";

interface TopStatusBarProps {
  isMobile: boolean;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({ isMobile }) => {
  const nodesCount = useWorkspaceStore((s) => s.nodes.length);
  const resetCanvasView = useWorkspaceStore((s) => s.resetCanvasView);
  const isCloudActive = useCloudStore((s) => s.user !== null && s.status !== "error");

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
          className={`w-1.5 h-1.5 rounded-full ml-0.5 ${
            isCloudActive ? "bg-andros-success animate-pulse" : "bg-andros-muted"
          }`}
          title={isCloudActive ? "Sincronización con la nube activa" : "Modo local"}
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

        {/* Cuenta de Google + estado de guardado en la nube */}
        <GoogleAuthButton isMobile={isMobile} />
      </div>
    </header>
  );
};
