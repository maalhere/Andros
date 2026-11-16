"use client";

import { useEffect } from "react";

/** Registra el service worker que habilita la instalación de Andros como app. */
export function PwaRegister(): null {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* La app funciona igual sin service worker. */
    });
  }, []);
  return null;
}
