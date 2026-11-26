// ============================================================================
// ANDROS — TOPE DIARIO DE LA IA EN EL SERVIDOR (solo servidor)
//
// (Sprint 21) El tope es el MISMO que ve la persona en la app:
//   · Con sesión → clave `user:<id>` y tope de SU plan, leído de Supabase
//     (`user_subscriptions`): 15/día en Plan Básico y 150/día en Andros Pro.
//   · Sin sesión → clave `ip:<dirección>` con el tope del Plan Básico × 2
//     (margen para quien comparte IP: escuela, oficina, evento).
// En memoria y por instancia: en serverless se reinicia con cada arranque en
// frío, así que es un freno de abusos; el contador amable vive en el cliente
// (`useAiQuotaStore`) con los mismos números.
// ============================================================================

import type { NextRequest } from "next/server";
import { FREE_DAILY_LIMIT, dailyLimitMessage } from "@/lib/ai/freeQuota";
import { aiDailyLimit, type PlanId } from "@/lib/billing/planLimits";
import { getUserPlan } from "@/lib/billing/serverPlan";
import { getRequestUser } from "@/lib/supabase/server";

/** Tope por IP (rutas sin sesión): Plan Básico con margen para IP compartidas. */
export const IP_FALLBACK_LIMIT = FREE_DAILY_LIMIT * 2;

const counts = new Map<string, { day: string; n: number }>();

const utcDay = () => new Date().toISOString().slice(0, 10);

/** IP del cliente tras el proxy (el alojamiento pone `x-forwarded-for`). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

/** Clave del contador: la persona si hay sesión; si no, la IP (respaldo). */
export function serverQuotaKey(caller: { userId?: string | null; ip?: string | null }): string {
  return caller.userId ? `user:${caller.userId}` : `ip:${caller.ip || "local"}`;
}

/**
 * `key`: una clave de `serverQuotaKey` (o una IP, en rutas antiguas).
 * `limit`: tope del plan (por defecto, el de las rutas sin sesión).
 */
export function serverQuotaAllows(key: string, limit = IP_FALLBACK_LIMIT): boolean {
  const entry = counts.get(key);
  return !entry || entry.day !== utcDay() || entry.n < limit;
}

export function serverQuotaConsume(key: string): void {
  const day = utcDay();
  const entry = counts.get(key);
  if (!entry || entry.day !== day) {
    if (counts.size > 5000) counts.clear();
    counts.set(key, { day, n: 1 });
  } else {
    entry.n += 1;
  }
}

/** Cuota de quien llama: clave, tope de su plan y el aviso que corresponde. */
export interface QuotaCaller {
  key: string;
  limit: number;
  plan: PlanId;
  userId: string | null;
  message: string;
}

/** Tope para una persona con sesión, según su plan (sin red: para pruebas). */
export function quotaForUser(userId: string, plan: PlanId): QuotaCaller {
  return { key: serverQuotaKey({ userId }), limit: aiDailyLimit(plan), plan, userId, message: dailyLimitMessage(plan) };
}

/**
 * Identifica a quien llama (Bearer o cookies de sesión) y lee su plan en
 * Supabase. Sin sesión, cae a la IP con el tope del Plan Básico × 2.
 */
export async function resolveQuotaCaller(request: NextRequest): Promise<QuotaCaller> {
  const user = await getRequestUser(request).catch(() => null);
  if (user) return quotaForUser(user.userId, await getUserPlan(user.supabase, user.userId));
  return {
    key: serverQuotaKey({ ip: clientIp(request.headers) }),
    limit: IP_FALLBACK_LIMIT,
    plan: "free",
    userId: null,
    message: dailyLimitMessage("free"),
  };
}
