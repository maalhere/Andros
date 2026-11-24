"use client";

import { useEffect } from "react";
import { startClarity, stopTelemetry } from "@/lib/analytics/telemetry";

// ============================================================================
// ANDROS — PROVEEDOR LIGERO DE TELEMETRÍA (solo cliente)
// AnalyticsGate lo descarga y monta SOLO si hay variables de entorno de
// Clarity/PostHog y la persona pulsó «Aceptar todas». Al desmontarse (retiro
// del consentimiento) apaga Clarity y borra el identificador anónimo.
// PostHog no necesita script: `track()` envía cada evento con un POST.
// ============================================================================

const TelemetryProvider: React.FC = () => {
  useEffect(() => {
    startClarity();
    return () => stopTelemetry();
  }, []);
  return null;
};

export default TelemetryProvider;
