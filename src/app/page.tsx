"use client";

import React from "react";
import { useDeviceLayout } from "@/hooks/useDeviceLayout";
import { TopStatusBar } from "@/components/shared/TopStatusBar";
import { OracleModal } from "@/components/shared/OracleModal";
import { SpatialCanvas } from "@/components/desktop/SpatialCanvas";
import { FloatingHudDock } from "@/components/desktop/FloatingHudDock";
import { TacticalCardStack } from "@/components/mobile/TacticalCardStack";
import { ThumbZoneBar } from "@/components/mobile/ThumbZoneBar";
import { MobileBottomSheet } from "@/components/mobile/MobileBottomSheet";

export default function AndrosWorkspacePage() {
  const { isMobile, isMounted } = useDeviceLayout();

  if (!isMounted) {
    return <div className="w-screen h-screen canvas-grid" />;
  }

  return (
    <div className="relative w-full min-h-screen overflow-hidden">
      <TopStatusBar isMobile={isMobile} />

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
    </div>
  );
}
