"use client";

import { useEffect, useSyncExternalStore } from "react";
import { hasAnalyticsConsent, subscribeConsent } from "@/lib/consent";

// ============================================================================
// ANDROS — PUERTA DE ANALÍTICA OPCIONAL
// Hoy Andros NO usa analítica. Si en el futuro se define
// NEXT_PUBLIC_ANALYTICS_SCRIPT_URL, el script solo se inyecta DESPUÉS de que
// la persona pulse «Aceptar todas». Sin consentimiento no se carga nada.
// ============================================================================

const SCRIPT_URL = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL;
const SCRIPT_ID = "andros-optional-analytics";

export const AnalyticsGate: React.FC = () => {
  const allowed = useSyncExternalStore(subscribeConsent, hasAnalyticsConsent, () => false);

  useEffect(() => {
    if (!SCRIPT_URL) return;
    const existing = document.getElementById(SCRIPT_ID);
    if (!allowed) {
      // Retirar el consentimiento detiene la carga en la próxima navegación.
      existing?.remove();
      return;
    }
    if (existing) return;
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.defer = true;
    document.head.appendChild(script);
  }, [allowed]);

  return null;
};
