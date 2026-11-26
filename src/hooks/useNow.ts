"use client";

import { useSyncExternalStore } from "react";

// ============================================================================
// ANDROS — HORA ACTUAL QUE SE REFRESCA SOLA (cada minuto)
// Para textos como «Vence hoy 18:00» o «Vencida» sin leer el reloj durante el
// render (se suscribe a un temporizador compartido).
// ============================================================================

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let minute = 0;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!timer) {
    timer = setInterval(() => {
      minute = Math.floor(Date.now() / 60_000);
      for (const l of listeners) l();
    }, 30_000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function snapshot(): number {
  const current = Math.floor(Date.now() / 60_000);
  if (current !== minute) minute = current;
  return minute;
}

/** Fecha actual redondeada al minuto (0 en el servidor). */
export function useNowMinute(): Date {
  const m = useSyncExternalStore(subscribe, snapshot, () => 0);
  return new Date(m * 60_000);
}
