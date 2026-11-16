import { useSettingsStore } from "@/store/useSettingsStore";

// Colores de Andros: terracota, salvia, cobalto y esmeralda.
const ANDROS_COLORS = ["#C95A3B", "#4F6B58", "#3B82F6", "#10B981"];

/**
 * Micro-celebración elegante (confeti pequeño). No hace nada si el usuario
 * eligió animaciones reducidas. Carga la librería solo cuando se necesita.
 */
export async function celebrate(origin?: { x: number; y: number }): Promise<void> {
  if (typeof window === "undefined") return;
  if (useSettingsStore.getState().animations === "reduced") return;
  try {
    const { default: confetti } = await import("canvas-confetti");
    confetti({
      particleCount: 46,
      spread: 62,
      startVelocity: 28,
      gravity: 1.1,
      ticks: 110,
      scalar: 0.8,
      colors: ANDROS_COLORS,
      disableForReducedMotion: true,
      origin: origin
        ? { x: origin.x / window.innerWidth, y: origin.y / window.innerHeight }
        : { x: 0.5, y: 0.7 },
      zIndex: 90,
    });
  } catch {
    // El confeti es un adorno: si falla, no pasa nada.
  }
}
