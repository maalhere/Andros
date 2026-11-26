// ============================================================================
// ANDROS — PLAN DE QUIEN LLAMA, LEÍDO EN EL SERVIDOR (solo rutas /api)
//
// Lee `user_subscriptions` con la sesión de la propia persona (RLS: solo ve su
// fila), así que nadie puede «decir» desde el navegador que es Pro. Si la
// tabla aún no existe o falla la lectura, el plan es `free` (nunca se regala
// Pro por error). Caché en memoria de 60 s por instancia para no consultar
// la base en cada mensaje de IA.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { planFromSubscription, type PlanId, type SubscriptionRow } from "./planLimits";

const CACHE_MS = 60_000;
const cache = new Map<string, { plan: PlanId; at: number }>();

export const SUBSCRIPTION_COLUMNS = "plan, status, billing_cycle, current_period_end";

export async function getUserPlan(supabase: SupabaseClient, userId: string): Promise<PlanId> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.plan;
  let plan: PlanId = "free";
  try {
    const { data, error } = await supabase
      .from("user_subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (!error) plan = planFromSubscription(data as SubscriptionRow | null);
  } catch {
    plan = "free";
  }
  if (cache.size > 5000) cache.clear();
  cache.set(userId, { plan, at: Date.now() });
  return plan;
}

/** El webhook cambió el plan: la próxima consulta lee la base de nuevo. */
export function forgetUserPlan(userId: string): void {
  cache.delete(userId);
}
