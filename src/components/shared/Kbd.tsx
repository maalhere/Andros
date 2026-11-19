"use client";

import React, { useSyncExternalStore } from "react";

// ============================================================================
// ANDROS — TECLA DE ATAJO <kbd> (solo escritorio: oculta en pantallas táctiles)
// ============================================================================

const subscribeNever = () => () => {};
const readIsMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** `true` en macOS/iOS (⌘); `false` en Windows/Linux (Ctrl). */
export const useIsMac = () => useSyncExternalStore(subscribeNever, readIsMac, () => false);

/** Texto de la tecla modificadora según el sistema. */
export const useModKey = () => (useIsMac() ? "⌘" : "Ctrl");

export const Kbd: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => (
  <kbd
    className={`hidden md:inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-md border border-andros-border bg-andros-canvas font-mono text-[10px] leading-none tabular-nums text-andros-muted ${className}`}
  >
    {children}
  </kbd>
);
