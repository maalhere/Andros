"use client";

import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore } from "react";
import { hasAnalyticsConsent, subscribeConsent } from "@/lib/consent";

// ============================================================================
// ANDROS — PUERTA DE ANALÍTICA OPCIONAL
// Nada opcional se carga sin «Aceptar todas»:
//   · Telemetría de producto (Microsoft Clarity + PostHog): solo si existen
//     NEXT_PUBLIC_CLARITY_ID y/o NEXT_PUBLIC_POSTHOG_KEY. Sin ellas, el
//     proveedor ni siquiera se descarga y no hay ninguna petición de red.
//   · NEXT_PUBLIC_ANALYTICS_SCRIPT_URL (script genérico heredado), igual.
// ============================================================================

const SCRIPT_URL = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL;
const SCRIPT_ID = "andros-optional-analytics";

/** Literal para que Next.js lo resuelva en el build (sin variables → false). */
const TELEMETRY_ENV = Boolean(
  process.env.NEXT_PUBLIC_CLARITY_ID?.trim() || process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
);

const TelemetryProvider = dynamic(() => import("@/components/legal/TelemetryProvider"), { ssr: false });

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

  return TELEMETRY_ENV && allowed ? <TelemetryProvider /> : null;
};
