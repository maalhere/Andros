// ============================================================================
// ANDROS — LÍMITE DIARIO DE LA IA INCLUIDA (cliente y servidor)
//
// Las consultas que usan la clave de Gemini DEL SERVIDOR tienen un tope diario
// según el plan (fuente única: `src/lib/billing/planLimits.ts`):
//   · Plan Básico → 15 por persona y día.
//   · Andros Pro  → 150 por persona y día.
// Quien configura su propia clave (BYOK) no tiene tope: paga su propio
// consumo. El contador del cliente (`useAiQuotaStore`) avisa con amabilidad;
// el del servidor (`serverQuota`) aplica el MISMO tope por persona con el plan
// leído de Supabase.
// ============================================================================

import { PLAN_LIMITS, type PlanId } from "@/lib/billing/planLimits";

export const FREE_DAILY_LIMIT = PLAN_LIMITS.free.aiDailyQueries;
export const PRO_DAILY_LIMIT = PLAN_LIMITS.pro.aiDailyQueries;

/** Aviso al llegar al tope del día, según el plan. */
export function dailyLimitMessage(plan: PlanId = "free"): string {
  const limit = PLAN_LIMITS[plan].aiDailyQueries;
  return plan === "pro"
    ? `Llegaste al límite de ${limit} consultas de hoy con la IA de Andros (Andros Pro). ` +
        "Vuelve mañana, o añade tu propia clave de Gemini en Claves IA para seguir sin límite diario."
    : `Llegaste al límite de ${limit} consultas gratis de hoy con la IA de Andros. ` +
        `Vuelve mañana, pasa a Andros Pro (${PRO_DAILY_LIMIT} al día) o añade tu propia clave de Gemini (gratis en Google AI Studio) en Claves IA para usarla sin límite diario.`;
}

/** Aviso del Plan Básico (rutas sin sesión y textos antiguos). */
export const DAILY_LIMIT_MESSAGE = dailyLimitMessage("free");

/** Día local en formato AAAA-MM-DD (el contador se reinicia a medianoche). */
export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
