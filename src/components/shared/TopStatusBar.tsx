"use client";

import React from "react";
import { Swords } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { useMarketStore } from "@/store/useMarketStore";
import { MoreMenu } from "./MoreMenu";
import { useLandingStore } from "@/store/useLandingStore";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { WorkspaceQuickSwitcher } from "@/components/workspaces/WorkspaceQuickSwitcher";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { InstallAppButton } from "@/components/pwa/InstallAppButton";

// ============================================================================
// ANDROS — BARRA SUPERIOR (mínima)
//   Izquierda: logo + selector de proyecto/carpeta.
//   Derecha:   Día/Noche · Instalar App · Cuenta de Google · ⋯ Más opciones.
// ============================================================================

interface TopStatusBarProps {
  isMobile: boolean;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({ isMobile }) => {
  const openLanding = useLandingStore((s) => s.openLanding);
  const isLandingDone = useLandingStore((s) => s.phase === "workspace");

  return (
    <header className="fixed top-3 md:top-4 left-3 right-3 md:left-6 md:right-6 z-40 flex items-center justify-between gap-2 pointer-events-none">
      {/* Logo + proyecto actual */}
      <div className="pointer-events-auto min-w-0 flex items-center gap-2 px-2.5 md:px-3 h-9 md:h-10 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm">
        {/* Destino del vuelo de la marca de la portada (LandingOverlay) */}
        <button
          type="button"
          onClick={openLanding}
          title="Volver a la portada"
          aria-label="Volver a la portada de Andros"
          data-andros-mark
          className="w-6 h-6 shrink-0 flex items-center justify-center spring-bounce hover:scale-110 active:scale-95"
          style={{ opacity: isLandingDone ? 1 : 0 }}
        >
          <AndrosMark className="w-6 h-6" />
        </button>
        <div className="min-w-0 flex items-center gap-1.5 text-xs">
          {/* Destino del vuelo del logo mutante (LandingOverlay) */}
          <button
            type="button"
            onClick={openLanding}
            title="Volver a la portada"
            data-andros-wordmark
            className="hidden sm:inline font-semibold text-andros-primary hover:text-andros-accent transition-colors"
            style={{ opacity: isLandingDone ? 1 : 0 }}
          >
            Andros
          </button>
          <span className="hidden sm:inline text-andros-muted">/</span>
          <WorkspaceQuickSwitcher />
        </div>
      </div>

      {/* Acciones: solo lo esencial */}
      <div className="pointer-events-auto shrink-0 flex items-center gap-1.5 md:gap-2">
        <button
          type="button"
          onClick={() => useMarketStore.getState().setArenaOpen(true)}
          title="Andros Arena: retos, actividades, prácticas y empleos"
          aria-label="Abrir Andros Arena"
          className="min-w-[40px] min-h-[40px] md:min-w-0 md:min-h-0 p-2 md:px-3 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-95 spring-micro flex items-center justify-center gap-1.5"
        >
          <Swords className="w-4 h-4 text-andros-accent" />
          <span className="hidden md:inline text-xs font-medium text-andros-primary">Arena</span>
        </button>
        <ThemeToggle />
        <InstallAppButton isMobile={isMobile} />
        <GoogleAuthButton isMobile={isMobile} />
        <MoreMenu />
      </div>
    </header>
  );
};
