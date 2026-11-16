"use client";

import React from "react";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { useCloudSync } from "@/hooks/useCloudSync";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { QualityOfLifeModal } from "@/components/settings/QualityOfLifeModal";
import { WorkspaceManagerDrawer } from "@/components/workspaces/WorkspaceManagerDrawer";
import { TopStatusBar } from "@/components/shared/TopStatusBar";
import { OracleModal } from "@/components/shared/OracleModal";
import { SpatialCanvas } from "@/components/desktop/SpatialCanvas";
import { FloatingHudDock } from "@/components/desktop/FloatingHudDock";
import { TacticalCardStack } from "@/components/mobile/TacticalCardStack";
import { ThumbZoneBar } from "@/components/mobile/ThumbZoneBar";
import { MobileBottomSheet } from "@/components/mobile/MobileBottomSheet";
import { LandingOverlay } from "@/components/landing/LandingOverlay";
import { useLandingStore } from "@/store/useLandingStore";

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
      <WorkspaceManagerDrawer />

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
          <OracleModal />
        </>
      )}

      {/* Portada inmersiva: primera visita o al pulsar el logo de Andros */}
      {showLanding && <LandingOverlay isMobile={isMobile} />}
    </div>
  );
}
