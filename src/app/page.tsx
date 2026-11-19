"use client";

import React from "react";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { useCloudSync } from "@/hooks/useCloudSync";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { QualityOfLifeModal } from "@/components/settings/QualityOfLifeModal";
import { AiKeysModal } from "@/components/settings/AiKeysModal";
import { WorkspaceManagerDrawer } from "@/components/workspaces/WorkspaceManagerDrawer";
import { ArenaModal } from "@/components/arena/ArenaModal";
import { LibraryDrawer } from "@/components/library/LibraryDrawer";
import { UpgradeModal } from "@/components/shared/UpgradeModal";
import { TopStatusBar } from "@/components/shared/TopStatusBar";
import { OracleModal } from "@/components/shared/OracleModal";
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

export default function AndrosWorkspacePage() {
  const { isMobile, isMounted } = useDeviceLayout();
  // Login con Google + guardado automático en Supabase (no hace nada en modo local).
  useCloudSync();
  // Ajustes de comodidad: localStorage + perfil de Supabase.
  useSettingsSync();
  const showLanding = useLandingStore((s) => s.phase !== "workspace");
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
      <QualityOfLifeModal />
      <AiKeysModal />
      <WorkspaceManagerDrawer />
      <ArenaModal />
      <LibraryDrawer />
      <UpgradeModal />

      {isMobile ? (
        /* MODO TELÉFONO (< 768px): Tactile Deck & Bottom Sheet Mode */
        <>
          <TacticalCardStack />
          <ThumbZoneBar />
          <MobileBottomSheet />
        </>
      ) : (
        /* MODO COMPUTADORA (>= 768px): Spatial Infinite Canvas Mode */
        <>
          <SpatialCanvas />
          <FloatingHudDock />
        </>
      )}

      {/* Oráculo IA: Estudio a pantalla completa (chat + documento) en PC y móvil */}
      <OracleModal />

      {/* Esqueleto mientras se descarga el lienzo guardado en la nube */}
      <CloudLoadingSkeleton isMobile={isMobile} />

      {/* Paleta de comandos (⌘K) y avisos con «Deshacer» */}
      <CommandPalette />
      <Toaster />
      <ShortcutsGuideModal />

      {/* Tutorial guiado de 5 pasos (1.ª vez en un lienzo vacío o desde ⋯ → Ver tutorial) */}
      <OnboardingTour isMobile={isMobile} />

      {/* Portada: entrada para quien no tiene sesión, o al pulsar el logo de Andros */}
      {showLanding && <LandingOverlay isMobile={isMobile} />}
    </div>
  );
}
