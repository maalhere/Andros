"use client";

import { useCallback, useRef, useState } from "react";

// ============================================================================
// ANDROS — GUARDA DE ENVÍO IDEMPOTENTE
// `disabled` llega tarde (tras re-render): un doble clic rápido puede disparar
// dos envíos. El candado síncrono (ref) bloquea el segundo al instante.
// ============================================================================

export function useSubmitGuard() {
  const lockRef = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    if (lockRef.current) return undefined;
    lockRef.current = true;
    setPending(true);
    try {
      return await task();
    } finally {
      lockRef.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}
