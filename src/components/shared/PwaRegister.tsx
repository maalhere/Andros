"use client";

import { useEffect } from "react";
import { startInstallPromptListener } from "@/hooks/useInstallPrompt";

/**
 * Registra el service worker que habilita la instalación de Andros como app
 * y empieza a escuchar `beforeinstallprompt` desde el layout (lo antes posible).
 */
export function PwaRegister(): null {
  useEffect(() => {
    startInstallPromptListener();
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* La app funciona igual sin service worker. */
    });
  }, []);
  return null;
}
