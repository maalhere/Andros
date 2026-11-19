// ============================================================================
// ANDROS — FÍSICA DE ANIMACIÓN COMPARTIDA
// Resorte interrumpible (sin duración fija): responde al instante si el
// usuario cambia de idea a mitad de la animación (umbral de Doherty < 400 ms).
// ============================================================================

/** Resorte estándar de Andros para paneles, menús, avisos y hojas. */
export const SPRING_SNAPPY = { type: "spring", stiffness: 450, damping: 32, mass: 0.8 } as const;

/** Sin animación (preferencia del sistema o ajuste «Animaciones reducidas»). */
export const NO_MOTION = { duration: 0 } as const;

/** Elige el resorte o nada según la preferencia de movimiento reducido. */
export const springOrInstant = (reduced: boolean) => (reduced ? NO_MOTION : SPRING_SNAPPY);
