"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { useCloudSync } from "@/hooks/useCloudSync";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { useFormLibrarySync } from "@/hooks/useFormLibrarySync";
import { useOpenedOnce } from "@/hooks/useOpenedOnce";
import { QualityOfLifeModal } from "@/components/settings/QualityOfLifeModal";
import { AiKeysModal } from "@/components/settings/AiKeysModal";
import { WorkspaceManagerDrawer } from "@/components/workspaces/WorkspaceManagerDrawer";
import { UpgradeModal } from "@/components/shared/UpgradeModal";
import { ProWaitlistModal } from "@/components/shared/ProWaitlistModal";
import { ExportPlanModal } from "@/components/plan/ExportPlanModal";
import { TopStatusBar } from "@/components/shared/TopStatusBar";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useMarketStore } from "@/store/useMarketStore";
import { useFormsLibraryStore } from "@/store/useFormsLibraryStore";
import { useFormulaCreatorStore } from "@/store/useFormulaCreatorStore";
import { SpatialCanvas } from "@/components/desktop/SpatialCanvas";
import { FloatingHudDock } from "@/components/desktop/FloatingHudDock";
import { TacticalCardStack } from "@/components/mobile/TacticalCardStack";
import { ThumbZoneBar } from "@/components/mobile/ThumbZoneBar";
import { MobileBottomSheet } from "@/components/mobile/MobileBottomSheet";
import { LandingOverlay } from "@/components/landing/LandingOverlay";
import { useLandingStore } from "@/store/useLandingStore";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { CommandPalette } from "@/components/shared/CommandPalette";
import { Toaster } from "@/components/shared/Toaster";
import { WorkspaceTabsBar } from "@/components/workspaces/WorkspaceTabsBar";
import { ShortcutsGuideModal } from "@/components/shared/ShortcutsGuideModal";
import { CloudLoadingSkeleton } from "@/components/shared/CloudLoadingSkeleton";
import { SITE_DESCRIPTION, SITE_TAGLINE, LEGAL_LINKS } from "@/lib/site";
import { useCollabRoom } from "@/lib/collab/useCollabRoom";
import { VoiceRoomBar } from "@/components/collab/VoiceRoomBar";
import { ScreenShareDock } from "@/components/nodes/ScreenShareNode";
import { CollabVideoStrip } from "@/components/collab/CollabVideoStrip";
import { useSocialSync } from "@/lib/social/useSocialSync";
import { UsernameSetupModal } from "@/components/social/UsernameSetupModal";
import { FriendsModal } from "@/components/social/FriendsModal";
import { ShareWorkspaceModal } from "@/components/social/ShareWorkspaceModal";
import { EmptyWorkspaceStarter } from "@/components/shared/EmptyWorkspaceStarter";
import { ImpactAlertsBanner } from "@/components/shared/ImpactAlertsBanner";

// Paneles pesados (Oráculo con Markdown + KaTeX, Biblioteca y Arena): fuera del
// JavaScript inicial. Se descargan la primera vez que se abren.
const OracleModal = dynamic(
  () => import("@/components/shared/OracleModal").then((m) => m.OracleModal),
  { ssr: false }
);
const LibraryDrawer = dynamic(
  () => import("@/components/library/LibraryDrawer").then((m) => m.LibraryDrawer),
  { ssr: false }
);
// Librería de fichas y auto-llenado IA: se descargan la primera vez que se abren.
const FormsLibraryModal = dynamic(
  () => import("@/components/forms/FormsLibraryModal").then((m) => m.FormsLibraryModal),
  { ssr: false }
);
const AutoFillModal = dynamic(
  () => import("@/components/forms/AutoFillModal").then((m) => m.AutoFillModal),
  { ssr: false }
);
// «Nueva fórmula» (plantillas + generación con IA): se descarga la primera vez que se abre.
const FormulaCreatorModal = dynamic(
  () => import("@/components/math/FormulaCreatorModal").then((m) => m.FormulaCreatorModal),
  { ssr: false }
);
const ArenaModal = dynamic(
  () => import("@/components/arena/ArenaModal").then((m) => m.ArenaModal),
  { ssr: false }
);

export default function AndrosWorkspacePage() {
  const { isMobile, isMounted } = useDeviceLayout();
  // Login con Google + guardado automático en Supabase (no hace nada en modo local).
  useCloudSync();
  // Ajustes de comodidad: localStorage + perfil de Supabase.
  useSettingsSync();
  // Librería de fichas replicables: localStorage + perfil de Supabase.
  useFormLibrarySync();
  // Sala en vivo: voz, presencia, cursores, pantalla compartida y edición simultánea.
  useCollabRoom();
  // @usuario y amistades (espacios compartidos).
  useSocialSync();
  const showLanding = useLandingStore((s) => s.phase !== "workspace");
  const oracleOpen = useWorkspaceStore((s) => s.isOracleModalOpen);
  const libraryMounted = useOpenedOnce(useLibraryStore((s) => s.open));
  const arenaMounted = useOpenedOnce(useMarketStore((s) => s.arenaOpen));
  const formsMounted = useOpenedOnce(useFormsLibraryStore((s) => s.libraryOpen));
  const autofillMounted = useOpenedOnce(useFormsLibraryStore((s) => s.autofillOpen));
  const formulaMounted = useOpenedOnce(useFormulaCreatorStore((s) => s.open));
  // ⌘K / Ctrl+K (paleta) en todas partes; atajos de letra solo en escritorio.
  useGlobalShortcuts(!isMobile);

  if (!isMounted) {
    // HTML del servidor: retícula vacía + texto legible para buscadores y
    // lectores de pantalla (el mismo mensaje que muestra la portada).
    return (
      <div className="w-screen h-screen canvas-grid">
        <main className="sr-only">
          <h1>Andros: {SITE_TAGLINE}</h1>
          <p>{SITE_DESCRIPTION}</p>
          <nav aria-label="Información legal">
            {LEGAL_LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
        </main>
      </div>
    );
  }

  return (
    <div className="relative w-full min-h-screen overflow-hidden">
      <WorkspaceTabsBar isMobile={isMobile} />
      <TopStatusBar isMobile={isMobile} />
      <VoiceRoomBar isMobile={isMobile} />
      <CollabVideoStrip />
      <QualityOfLifeModal />
      <AiKeysModal />
      <WorkspaceManagerDrawer />
      {arenaMounted && <ArenaModal />}
      {libraryMounted && <LibraryDrawer />}
      {formsMounted && <FormsLibraryModal />}
      {autofillMounted && <AutoFillModal />}
      {formulaMounted && <FormulaCreatorModal />}
      <UpgradeModal />
      <ProWaitlistModal />
      <ExportPlanModal />
      <FriendsModal />
      <ShareWorkspaceModal />
      <UsernameSetupModal />

      {isMobile ? (
        /* MODO TELÉFONO (< 768px): Tactile Deck & Bottom Sheet Mode */
        <>
          <TacticalCardStack />
          <ThumbZoneBar />
          <MobileBottomSheet />
          <ScreenShareDock />
        </>
      ) : (
        /* MODO COMPUTADORA (>= 768px): Spatial Infinite Canvas Mode */
        <>
          <SpatialCanvas />
          <FloatingHudDock />
          <EmptyWorkspaceStarter variant="canvas" />
          {/* Descuadres entre tarjetas conectadas (detector anti-malentendidos) */}
          <ImpactAlertsBanner variant="floating" />
        </>
      )}

      {/* Oráculo IA: Estudio a pantalla completa (chat + documento) en PC y móvil */}
      {oracleOpen && <OracleModal />}

      {/* Esqueleto mientras se descarga el lienzo guardado en la nube */}
      <CloudLoadingSkeleton isMobile={isMobile} />

      {/* Paleta de comandos (⌘K) y avisos con «Deshacer» */}
      <CommandPalette />
      <Toaster />
      <ShortcutsGuideModal />

      {/* Tutorial guiado de 5 pasos (en Modo Simple solo desde ? / ⋯ → Ver tutorial; en Experto, también la 1.ª vez en un lienzo vacío) */}
      <OnboardingTour isMobile={isMobile} />

      {/* Portada: entrada para quien no tiene sesión, o al pulsar el logo de Andros */}
      {showLanding && <LandingOverlay isMobile={isMobile} />}
    </div>
  );
}
