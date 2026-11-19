"use client";

import React from "react";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { useCloudSync } from "@/hooks/useCloudSync";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { QualityOfLifeModal } from "@/components/settings/QualityOfLifeModal";
import { AiKeysModal } from "@/components/settings/AiKeysModal";
import { WorkspaceManagerDrawer } from "@/components/workspaces/WorkspaceManagerDrawer";
import { ArenaModal } from "@/components/arena/ArenaModal";
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

export default function AndrosWorkspacePage() {
  const { isMobile, isMounted } = useDeviceLayout();
  // Login con Google + guardado automático en Supabase (no hace nada en modo local).
  useCloudSync();
  // Ajustes de comodidad: localStorage + perfil de Supabase.
  useSettingsSync();
  const showLanding = useLandingStore((s) => s.phase !== "workspace");

  if (!isMounted) {
    return <div className="w-screen h-screen canvas-grid" />;
  }

  return (
    <div className="relative w-full min-h-screen overflow-hidden">
      <TopStatusBar isMobile={isMobile} />
      <QualityOfLifeModal />
      <AiKeysModal />
      <WorkspaceManagerDrawer />
      <ArenaModal />
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

      {/* Tutorial guiado de 4 pasos (1.ª vez en un lienzo vacío o desde ⋯ → Ver tutorial) */}
      <OnboardingTour isMobile={isMobile} />

      {/* Portada: entrada para quien no tiene sesión, o al pulsar el logo de Andros */}
      {showLanding && <LandingOverlay isMobile={isMobile} />}
    </div>
  );
}
