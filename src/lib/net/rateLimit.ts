// ============================================================================
// ANDROS — LÍMITE DE TASA BÁSICO EN MEMORIA (solo servidor)
// Ventana deslizante por clave (p. ej. `userId`). En serverless vive por
// instancia: frena abusos evidentes sin depender de servicios externos.
// ============================================================================

export interface RateLimiter {
  /** Cuenta un intento; `true` si todavía está dentro del límite. */
  take(key: string, now?: number): boolean;
}

export function createRateLimiter(options: { max: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 5000;
  return {
    take(key: string, now = Date.now()): boolean {
      const since = now - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > since);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return false;
      }
      if (!hits.has(key) && hits.size >= maxKeys) hits.clear();
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
