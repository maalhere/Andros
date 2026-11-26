// ============================================================================
// ANDROS — GET /api/billing/portal → { url }
// Enlace firmado (válido ~24 h) al portal del proveedor de pagos, donde la
// persona cambia su tarjeta, pasa de mensual a anual o cancela. Solo para
// cuentas con Andros Pro vigente; la fila se lee con SU sesión (RLS).
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/supabase/server";
import { planFromSubscription, type SubscriptionRow } from "@/lib/billing/planLimits";
import { BILLING_UNAVAILABLE_MESSAGE, fetchCustomerPortalUrl, readBillingConfig } from "@/lib/billing/lemonSqueezy";

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(request: NextRequest) {
  const { config } = readBillingConfig(process.env);
  if (!config) return fail(503, BILLING_UNAVAILABLE_MESSAGE);

  const caller = await getRequestUser(request);
  if (!caller) return fail(401, "Inicia sesión para gestionar tu suscripción.");

  const { data, error } = await caller.supabase
    .from("user_subscriptions")
    .select("plan, status, billing_cycle, current_period_end, provider, provider_subscription_id")
    .eq("user_id", caller.userId)
    .maybeSingle();
  const row = (error ? null : data) as (SubscriptionRow & { provider?: string | null; provider_subscription_id?: string | null }) | null;
  if (!row || planFromSubscription(row) !== "pro" || row.provider !== "lemonsqueezy" || !row.provider_subscription_id) {
    return fail(404, "Tu cuenta no tiene una suscripción Pro activa que gestionar.");
  }

  try {
    const url = await fetchCustomerPortalUrl(config.apiKey, row.provider_subscription_id);
    return NextResponse.json({ url }, { status: 200, headers: NO_STORE });
  } catch (err) {
    console.error("[Andros] No se pudo abrir el portal de pagos:", err instanceof Error ? err.message : "error");
    return fail(502, "No pudimos abrir la gestión de tu suscripción. Inténtalo de nuevo en unos minutos.");
  }
}
