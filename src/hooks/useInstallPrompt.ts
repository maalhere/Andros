"use client";

import { useCallback, useSyncExternalStore } from "react";

// ============================================================================
// ANDROS — INSTALAR LA APP (PWA)
//   · Chrome / Edge (Windows, macOS, Linux, Android): captura
//     `beforeinstallprompt` para lanzar el instalador nativo en 1 clic.
//   · Safari (iPhone/iPad/Mac) y navegadores sin ese evento: `canPrompt` es
//     false y la UI muestra los pasos manuales según el dispositivo.
//   · Ya instalada (`display-mode: standalone`): `isInstalled` es true y el
//     botón "Instalar App" se oculta.
// ============================================================================

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Familia de dispositivo/navegador para elegir las instrucciones manuales. */
export type InstallPlatform =
  | "ios" // iPhone / iPad (Safari, Chrome iOS, etc.)
  | "android" // Android sin prompt automático
  | "mac-safari" // Safari en macOS (Archivo → Agregar al Dock)
  | "desktop-chromium" // Chrome / Edge / Brave / Opera de escritorio
  | "firefox" // Firefox de escritorio (no instala apps web)
  | "other";

interface InstallSnapshot {
  deferred: BeforeInstallPromptEvent | null;
  standalone: boolean;
  installedThisSession: boolean;
  platform: InstallPlatform;
}

const SERVER_SNAPSHOT: InstallSnapshot = {
  deferred: null,
  // En el servidor se asume "instalada" para no pintar el botón antes de saberlo.
  standalone: true,
  installedThisSession: false,
  platform: "other",
};

let snapshot: InstallSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let started = false;

function emit(patch: Partial<InstallSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function detectStandalone(): boolean {
  const modes = ["standalone", "window-controls-overlay", "fullscreen"];
  const byMedia = modes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return byMedia || iosStandalone;
}

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  const isIPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIPadOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
    return "mac-safari";
  }
  if (/Chrome|Chromium|Edg\//.test(ua)) return "desktop-chromium";
  return "other";
}

/**
 * Empieza a escuchar el evento de instalación lo antes posible (se dispara
 * una sola vez por carga de página). Es seguro llamarla varias veces.
 */
export function startInstallPromptListener(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  snapshot = {
    deferred: null,
    standalone: detectStandalone(),
    installedThisSession: false,
    platform: detectPlatform(),
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    // Evita el mini-banner automático: se lanza al pulsar "Instalar App".
    event.preventDefault();
    emit({ deferred: event as BeforeInstallPromptEvent });
  });

  window.addEventListener("appinstalled", () => {
    emit({ deferred: null, installedThisSession: true });
  });

  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener?.("change", () => emit({ standalone: detectStandalone() }));
}

// Registrar al cargar el módulo: el evento puede llegar antes del primer render.
startInstallPromptListener();

function subscribe(listener: () => void) {
  startInstallPromptListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => SERVER_SNAPSHOT;

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export function useInstallPrompt() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /** Lanza el instalador nativo. Devuelve "unavailable" si el navegador no lo ofrece. */
  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const deferred = snapshot.deferred;
    if (!deferred) return "unavailable";
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      // El evento solo sirve una vez; si lo rechaza, quedan los pasos manuales.
      emit({ deferred: null, installedThisSession: choice.outcome === "accepted" });
      return choice.outcome;
    } catch {
      emit({ deferred: null });
      return "unavailable";
    }
  }, []);

  return {
    /** El navegador permite instalar en 1 clic con su diálogo nativo. */
    canPrompt: state.deferred !== null,
    /** Andros ya corre como app instalada (o se acaba de instalar). */
    isInstalled: state.standalone || state.installedThisSession,
    platform: state.platform,
    promptInstall,
  };
}
