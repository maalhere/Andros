// ============================================================================
// ANDROS — POST /api/billing/webhook (avisos firmados del proveedor de pagos)
//
//   1. Lee el cuerpo CRUDO y valida `X-Signature` = HMAC-SHA256 con
//      LEMONSQUEEZY_WEBHOOK_SECRET, comparando en tiempo constante
//      (`timingSafeEqual`). Firma ausente, alterada o sin secreto → 401.
//   2. Solo atiende subscription_created / _updated / _cancelled / _expired.
//   3. Escribe `user_subscriptions` con la clave de servicio (variable SOLO de
//      servidor): la RLS no deja que ningún navegador se asigne `pro`.
//
// Respuestas: 200 = procesado o ignorado a propósito (el proveedor no
// reintenta); 401 = firma inválida; 503 = falta configuración (el proveedor
// reintenta más tarde, sin perder el aviso).
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { planFromSubscription, type SubscriptionRow } from "@/lib/billing/planLimits";
import { forgetUserPlan } from "@/lib/billing/serverPlan";
import { parseSubscriptionWebhook, readBillingConfig, readWebhookSecret, verifyWebhookSignature } from "@/lib/billing/lemonSqueezy";

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

/** Un aviso real pesa pocos KB; más de 256 KB no es del proveedor. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const secret = readWebhookSecret(process.env);
  if (!secret) {
    console.warn("[Andros] Webhook de pagos sin LEMONSQUEEZY_WEBHOOK_SECRET.");
    return reply(503, { error: "not_configured" });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply(413, { error: "too_large" });
  if (!verifyWebhookSignature(raw, request.headers.get("x-signature"), secret)) {
    return reply(401, { error: "invalid_signature" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  const { config } = readBillingConfig(process.env);
  const parsed = parseSubscriptionWebhook(payload, config?.variants);
  if (parsed.kind === "ignored") return reply(200, { ok: true, ignored: parsed.reason });

  const service = getServiceClient();
  if (!service) {
    console.warn("[Andros] Webhook de pagos sin SUPABASE_SERVICE_ROLE_KEY: no se puede guardar el plan.");
    return reply(503, { error: "not_configured" });
  }

  const { row } = parsed;

  // Si la cuenta ya tiene OTRA suscripción Pro vigente, el aviso de una
  // suscripción antigua que termina no la degrada a Básico.
  const { data: existing, error: readError } = await service
    .from("user_subscriptions")
    .select("plan, status, billing_cycle, current_period_end, provider_subscription_id")
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (readError) {
    console.error("[Andros] Webhook: no se pudo leer la suscripción:", readError.message);
    return reply(500, { error: "db_read" });
  }
  const current = existing as (SubscriptionRow & { provider_subscription_id?: string | null }) | null;
  if (
    current &&
    current.provider_subscription_id &&
    current.provider_subscription_id !== row.provider_subscription_id &&
    planFromSubscription(current) === "pro" &&
    row.plan === "free"
  ) {
    return reply(200, { ok: true, ignored: "otra suscripción sigue activa" });
  }

  const { error: writeError } = await service
    .from("user_subscriptions")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (writeError) {
    console.error("[Andros] Webhook: no se pudo guardar la suscripción:", writeError.message);
    return reply(500, { error: "db_write" });
  }

  forgetUserPlan(row.user_id);
  return reply(200, { ok: true, event: parsed.event, plan: row.plan });
}
