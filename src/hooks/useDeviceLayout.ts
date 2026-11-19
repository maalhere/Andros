"use client";

import { useSyncExternalStore } from "react";
import { ViewportMode } from "@/types/workspace";

const DESKTOP_BREAKPOINT = 768;

interface DeviceLayoutResult {
  viewportMode: ViewportMode;
  isMobile: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
  isMounted: boolean;
}

// ----------------------------------------------------------------------------
// Fuentes externas (ventana del navegador) leídas con useSyncExternalStore:
// sin setState dentro de efectos y sin desajustes de hidratación (en el
// servidor se asume escritorio sin montar).
// ----------------------------------------------------------------------------

const subscribeResize = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
const subscribeNever = () => () => {};

const readViewportMode = (): ViewportMode =>
  window.innerWidth < DESKTOP_BREAKPOINT ? "mobile" : "desktop";
const readTouchCapable = () => "ontouchstart" in window || navigator.maxTouchPoints > 0;

export function useDeviceLayout(): DeviceLayoutResult {
  const isMounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const viewportMode = useSyncExternalStore<ViewportMode>(
    subscribeResize,
    readViewportMode,
    () => "desktop"
  );
  const isTouchDevice = useSyncExternalStore(subscribeResize, readTouchCapable, () => false);

  return {
    viewportMode,
    isMobile: viewportMode === "mobile",
    isDesktop: viewportMode === "desktop",
    isTouchDevice,
    isMounted,
  };
}
