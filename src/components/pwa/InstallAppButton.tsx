"use client";

import React, { useCallback, useState } from "react";
import { MonitorDown } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { InstallAppModal } from "./InstallAppModal";

// ============================================================================
// ANDROS — BOTÓN "INSTALAR APP" (barra superior)
//   · Chrome/Edge/Android con instalador nativo → 1 clic.
//   · iPhone/iPad, Safari, Firefox o instalador rechazado → modal con pasos.
//   · Ya instalada (display-mode: standalone) → no se muestra.
// ============================================================================

export const InstallAppButton: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const { canPrompt, isInstalled, platform, promptInstall } = useInstallPrompt();
  const [guideOpen, setGuideOpen] = useState(false);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (canPrompt) {
      const outcome = await promptInstall();
      if (outcome !== "unavailable") return;
    }
    setGuideOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        title="Instalar Andros como app en este dispositivo"
        aria-label="Instalar App"
        className="h-9 md:h-8 min-w-[36px] px-2 md:px-2.5 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm text-andros-primary hover:border-andros-border-active active:scale-95 spring-micro flex items-center justify-center gap-1.5 text-xs font-medium"
      >
        <MonitorDown className="w-4 h-4 text-andros-accent" />
        {!isMobile && <span>Instalar App</span>}
      </button>
      <InstallAppModal open={guideOpen} platform={platform} onClose={closeGuide} />
    </>
  );
};
