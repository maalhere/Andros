"use client";

import React from "react";
import { RotateCcw, Settings } from "lucide-react";
import { useSettingsStore } from "@/store/useSettingsStore";
import { ThemeToggle } from "./ThemeToggle";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useLandingStore } from "@/store/useLandingStore";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { WorkspaceQuickSwitcher } from "@/components/workspaces/WorkspaceQuickSwitcher";
import { AndrosMark } from "@/components/brand/AndrosMark";

interface TopStatusBarProps {
  isMobile: boolean;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({ isMobile }) => {
  const nodesCount = useWorkspaceStore((s) => s.nodes.length);
  const resetCanvasView = useWorkspaceStore((s) => s.resetCanvasView);
  const isCloudActive = useCloudStore((s) => s.user !== null && s.status !== "error");
  const setSettingsOpen = useSettingsStore((s) => s.setModalOpen);
  const openLanding =useLandingStore((s) => s.openLanding);
  const isLandingDone = useLandingStore((s) => s.phase === "workspace");

  return (
    <header className="fixed top-3 md:top-4 left-3 right-3 md:left-6 md:right-6 z-40 flex items-center justify-between pointer-events-none">
      {/* Identidad del proyecto y migas de pan */}
      <div className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm">
        {/* Destino del vuelo de la marca de la portada (LandingOverlay) */}
        <button
          type="button"
          onClick={openLanding}
          title="Volver al inicio"
          aria-label="Volver a la portada de Andros"
          data-andros-mark
          className="w-6 h-6 flex items-center justify-center spring-bounce hover:scale-110 hover:-translate-y-0.5 active:scale-95"
          style={{ opacity: isLandingDone ? 1 : 0 }}
        >
          <AndrosMark className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-1.5 text-xs">
          {/* Destino del vuelo del logo mutante (LandingOverlay) */}
          <button
            type="button"
            onClick={openLanding}
            title="Volver al inicio"
            data-andros-wordmark
            className="font-semibold text-andros-primary hover:text-andros-accent transition-colors"
            style={{ opacity: isLandingDone ? 1 : 0 }}
          >
            Andros
          </button>
          <span className="text-andros-muted">/</span>
          <WorkspaceQuickSwitcher />
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

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Abrir ajustes de comodidad"
          title="Ajustes"
          className="min-w-[40px] min-h-[40px] md:min-w-0 md:min-h-0 p-2 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm hover:scale-105 hover:rotate-45 active:scale-95 spring-micro flex items-center justify-center"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Cuenta de Google + estado de guardado en la nube */}
        <GoogleAuthButton isMobile={isMobile} />
      </div>
    </header>
  );
};
