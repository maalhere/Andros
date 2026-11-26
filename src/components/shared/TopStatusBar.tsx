"use client";

import React from "react";
import { CircleHelp, Search, Swords } from "lucide-react";
import { useCommandPaletteStore } from "@/store/useCommandPaletteStore";
import { Kbd, useModKey } from "./Kbd";
import { ThemeToggle } from "./ThemeToggle";
import { useMarketStore } from "@/store/useMarketStore";
import { MoreMenu } from "./MoreMenu";
import { useLandingStore } from "@/store/useLandingStore";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { WorkspaceQuickSwitcher } from "@/components/workspaces/WorkspaceQuickSwitcher";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { InstallAppButton } from "@/components/pwa/InstallAppButton";
import { useTabsBarVisible } from "@/store/useTabsStore";
import { useShortcutsGuideStore } from "@/store/useShortcutsGuideStore";
import { CollabRoomButton } from "@/components/collab/VoiceRoomBar";
import { ShareWorkspaceButton } from "@/components/social/ShareWorkspaceModal";
import { CommentsButton } from "@/components/comments/CommentsDrawer";
import { ExperienceModeToggle } from "./ExperienceModeToggle";
import { ChatButton } from "@/components/cde/WorkspaceChatPanel";
import { ResolutionStatusPill } from "@/components/cde/ResolutionStatusPill";
import { useIsExpert } from "@/store/useSettingsStore";
import { useCollabStore } from "@/store/useCollabStore";
import { ExternalCalendarsButton } from "@/components/calendar/ExternalCalendarsButton";

// ============================================================================
// ANDROS — BARRA SUPERIOR (mínima)
//   Izquierda: logo + selector de proyecto/carpeta.
//   Modo Experto: Buscar · Arena · ? · Simple|Experto · Voz · Rojo/Verde ·
//                 Compartir · Chat · Comentarios · Día/Noche · Instalar · Cuenta · ⋯
//   Modo Simple (Sprint 19, se entiende en < 5 s): solo lo esencial para
//                 equipos → Rojo/Verde · Calendarios · Compartir · Chat/Bandeja ·
//                 Cuenta · ⋯. Lo demás (buscar, voz, comentarios, tema,
//                 instalar, modo y ayuda) vive agrupado en ⋯. La voz reaparece
//                 en la barra solo mientras hay alguien en la sala.
// ============================================================================

/** ¿Hay una llamada en curso (yo o alguien del espacio)? */
const useVoiceActive = (): boolean =>
  useCollabStore((s) => s.inCall || s.callConnecting || Boolean(s.invite) || Object.values(s.peers).some((p) => p.inCall));

interface TopStatusBarProps {
  isMobile: boolean;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({ isMobile }) => {
  const openLanding = useLandingStore((s) => s.openLanding);
  const isLandingDone = useLandingStore((s) => s.phase === "workspace");
  const modKey = useModKey();
  // Con pestañas visibles (h-11 móvil / h-9 escritorio) la barra baja para no solaparse.
  const hasTabs = useTabsBarVisible();
  // (Sprint 18/19) Modo Simple: chat, alertas Rojo/Verde, calendarios y compartir.
  const expert = useIsExpert();
  const voiceActive = useVoiceActive();

  return (
    <header
      className={`fixed ${
        hasTabs ? "top-14 md:top-[3.25rem]" : "top-3 md:top-4"
      } left-3 right-3 md:left-6 md:right-6 z-40 flex items-center justify-between gap-2 pointer-events-none`}
    >
      {/* Logo + proyecto actual */}
      <div className="pointer-events-auto min-w-0 flex items-center gap-2 px-2 md:px-2.5 h-11 md:h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm">
        {/* Destino del vuelo de la marca de la portada (LandingOverlay) */}
        <button
          type="button"
          onClick={openLanding}
          title="Volver a la portada"
          aria-label="Volver a la portada de Andros"
          data-andros-mark
          className="hit-slop w-7 h-7 shrink-0 flex items-center justify-center rounded-lg active:scale-[0.96] spring-micro"
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
            className="hidden sm:inline font-semibold text-andros-primary hover:text-andros-accent-ink transition-colors"
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
        {expert ? (
          <>
            {/* Paleta de comandos: solo escritorio (en el teléfono ya hay barra táctil) */}
            <button
              type="button"
              onClick={() => useCommandPaletteStore.getState().setOpen(true)}
              aria-label="Buscar nodos y acciones"
              aria-keyshortcuts="Control+K Meta+K"
              className="hidden md:flex items-center gap-2 h-9 pl-2.5 pr-1.5 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro"
            >
              <Search className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Buscar</span>
              <Kbd>{modKey} K</Kbd>
            </button>
            <button
              type="button"
              onClick={() => useMarketStore.getState().setArenaOpen(true)}
              aria-label="Abrir Andros Arena"
              className="w-11 h-11 md:w-auto md:h-9 md:px-3 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro flex items-center justify-center gap-1.5"
            >
              <Swords className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />
              <span className="hidden md:inline text-xs font-medium text-andros-primary">Arena</span>
            </button>
            <button
              type="button"
              onClick={() => useShortcutsGuideStore.getState().openGuide()}
              aria-label="Abrir guía de atajos y ayuda"
              aria-keyshortcuts="Shift+/"
              title="Atajos y ayuda (?)"
              className="hidden md:flex w-9 h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro items-center justify-center"
            >
              <CircleHelp className="w-4 h-4" aria-hidden="true" />
            </button>
            <ExperienceModeToggle />
            <CollabRoomButton />
            {/* Filtro rápido Rojo / Verde (en el teléfono va dentro de la pila) */}
            {!isMobile && <ResolutionStatusPill />}
            <ShareWorkspaceButton />
            <ChatButton />
            <CommentsButton />
            <ThemeToggle />
            <InstallAppButton isMobile={isMobile} />
          </>
        ) : (
          <>
            {/* La voz solo ocupa sitio mientras alguien está en la sala */}
            {voiceActive && <CollabRoomButton />}
            {/* Alertas unificadas: filtro Rojo / Verde (en el teléfono va dentro de la pila) */}
            {!isMobile && <ResolutionStatusPill />}
            <ExternalCalendarsButton />
            <ShareWorkspaceButton showOnMobile />
            <ChatButton />
          </>
        )}
        <GoogleAuthButton isMobile={isMobile} />
        <MoreMenu />
      </div>
    </header>
  );
};
