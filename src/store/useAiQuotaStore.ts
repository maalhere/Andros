import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DAILY_LIMIT_MESSAGE, FREE_DAILY_LIMIT, todayKey } from "@/lib/ai/freeQuota";
import { getUserAiKey } from "@/store/useAiProvidersStore";

// ============================================================================
// ANDROS — CONTADOR DIARIO DE CONSULTAS GRATIS (clave del servidor)
//
// 15 consultas al día con la clave de Gemini del servidor; ilimitado si la
// persona configuró su propia clave de Gemini (BYOK). Solo cuentan las
// respuestas que sí se obtuvieron. Se guarda en este navegador (localStorage).
// ============================================================================

interface AiQuotaState {
  day: string;
  used: number;
  /** Suma una consulta gratis (reinicia el contador si cambió el día). */
  consume: () => void;
}

export const useAiQuotaStore = create<AiQuotaState>()(
  persist(
    (set) => ({
      day: todayKey(),
      used: 0,
      consume: () =>
        set((s) => {
          const today = todayKey();
          return s.day === today ? { used: s.used + 1 } : { day: today, used: 1 };
        }),
    }),
    {
      name: "andros-ai-quota",
      storage: createJSONStorage(() => window.localStorage),
      partialize: (s) => ({ day: s.day, used: s.used }),
    }
  )
);

/** ¿Esta persona usa su propia clave de Gemini? (entonces no hay tope). */
export const hasOwnGeminiKey = (): boolean => Boolean(getUserAiKey("gemini"));

/** Consultas gratis restantes hoy (`Infinity` con clave propia). */
export function freeQueriesLeft(): number {
  if (hasOwnGeminiKey()) return Infinity;
  const { day, used } = useAiQuotaStore.getState();
  return day === todayKey() ? Math.max(0, FREE_DAILY_LIMIT - used) : FREE_DAILY_LIMIT;
}

/** `true` si todavía puede consultar; si no, devuelve el aviso amable. */
export function checkFreeQuota(): { ok: true } | { ok: false; message: string } {
  return freeQueriesLeft() > 0 ? { ok: true } : { ok: false, message: DAILY_LIMIT_MESSAGE };
}

/** Registra una consulta gratis lograda (no cuenta si usa clave propia). */
export function recordFreeQuery(): void {
  if (!hasOwnGeminiKey()) useAiQuotaStore.getState().consume();
}
