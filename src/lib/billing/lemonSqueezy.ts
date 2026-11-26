// ============================================================================
// ANDROS — PASARELA DE PAGO (Lemon Squeezy, Merchant of Record) · SOLO SERVIDOR
//
// Sin SDK: API REST JSON:API con `fetch`. Todo lo que no toca la red es puro
// para que `npm run verify:billing` lo compruebe sin conexión:
//   · `readBillingConfig(env)`        → configuración o lista de lo que falta.
//   · `verifyWebhookSignature(...)`   → HMAC-SHA256 en tiempo constante.
//   · `buildCheckoutBody(...)`        → cuerpo de POST /v1/checkouts.
//   · `parseSubscriptionWebhook(...)` → fila de `user_subscriptions`.
//
// Andros nunca ve ni guarda datos de tarjeta: el cobro ocurre en la página
// del proveedor, que actúa como vendedor registrado (impuestos y facturas).
// ============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeBillingCycle, type BillingCycle, type PlanId } from "./planLimits";

export const LEMONSQUEEZY_API = "https://api.lemonsqueezy.com/v1";

/** Texto que ve la persona mientras la pasarela no está configurada. */
export const BILLING_UNAVAILABLE_MESSAGE =
  "Los pagos se activarán muy pronto. Mientras tanto, sigues con todo el Plan Básico sin costo.";

/** Eventos del webhook que actualizan `user_subscriptions`. */
export const HANDLED_EVENTS = [
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_expired",
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^\d{1,20}$/;

// ----------------------------------------------------------------------------
// Configuración (variables de servidor, nunca NEXT_PUBLIC_)
// ----------------------------------------------------------------------------

export interface CheckoutConfig {
  apiKey: string;
  storeId: string;
  variants: Record<BillingCycle, string>;
}

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined) => value?.trim() ?? "";

/** Variables para crear el cobro; `missing` lista las que faltan (solo para el registro). */
export function readBillingConfig(env: Env): { config: CheckoutConfig | null; missing: string[] } {
  const apiKey = clean(env.LEMONSQUEEZY_API_KEY);
  const storeId = clean(env.LEMONSQUEEZY_STORE_ID);
  const monthly = clean(env.LEMONSQUEEZY_VARIANT_MONTHLY);
  const annual = clean(env.LEMONSQUEEZY_VARIANT_ANNUAL);
  const missing: string[] = [];
  if (apiKey.length < 20) missing.push("LEMONSQUEEZY_API_KEY");
  if (!ID_RE.test(storeId)) missing.push("LEMONSQUEEZY_STORE_ID");
  if (!ID_RE.test(monthly)) missing.push("LEMONSQUEEZY_VARIANT_MONTHLY");
  if (!ID_RE.test(annual)) missing.push("LEMONSQUEEZY_VARIANT_ANNUAL");
  return {
    config: missing.length > 0 ? null : { apiKey, storeId, variants: { monthly, annual } },
    missing,
  };
}

/** Secreto del webhook (mín. 16 caracteres) o `null`. */
export function readWebhookSecret(env: Env): string | null {
  const secret = clean(env.LEMONSQUEEZY_WEBHOOK_SECRET);
  return secret.length >= 16 ? secret : null;
}

// ----------------------------------------------------------------------------
// Firma del webhook: X-Signature = hex(HMAC-SHA256(cuerpo crudo, secreto))
// ----------------------------------------------------------------------------

export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * `true` solo si la firma coincide. Compara en tiempo constante
 * (`timingSafeEqual`) y rechaza firmas ausentes, con otro largo o no-hex.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string | null): boolean {
  if (!secret || typeof signature !== "string") return false;
  const received = signature.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  const expected = Buffer.from(signWebhookBody(rawBody, secret), "hex");
  const given = Buffer.from(received, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ----------------------------------------------------------------------------
// Checkout
// ----------------------------------------------------------------------------

export interface CheckoutInput {
  userId: string;
  email?: string | null;
  cycle: BillingCycle;
  /** Adónde vuelve la persona tras pagar (mismo origen de Andros). */
  redirectUrl: string;
}

/** Cuerpo JSON:API para `POST /v1/checkouts`. `custom.user_id` vuelve en el webhook. */
export function buildCheckoutBody(config: CheckoutConfig, input: CheckoutInput) {
  const email = input.email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.email) && input.email.length <= 254 ? input.email : undefined;
  return {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          ...(email ? { email } : {}),
          custom: { user_id: input.userId, billing_cycle: input.cycle },
        },
        product_options: { redirect_url: input.redirectUrl },
        checkout_options: { embed: false },
      },
      relationships: {
        store: { data: { type: "stores", id: config.storeId } },
        variant: { data: { type: "variants", id: config.variants[input.cycle] } },
      },
    },
  };
}

const apiHeaders = (apiKey: string) => ({
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
  Authorization: `Bearer ${apiKey}`,
});

const TIMEOUT_MS = 10_000;

/** Crea el cobro y devuelve la URL https del proveedor (o lanza un error genérico). */
export async function createCheckoutUrl(config: CheckoutConfig, input: CheckoutInput, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(`${LEMONSQUEEZY_API}/checkouts`, {
    method: "POST",
    headers: apiHeaders(config.apiKey),
    body: JSON.stringify(buildCheckoutBody(config, input)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`checkout ${response.status}`);
  const json = (await response.json()) as { data?: { attributes?: { url?: unknown } } };
  const url = json.data?.attributes?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("checkout sin URL");
  return url;
}

/** Enlace firmado (válido ~24 h) al portal del cliente para gestionar o cancelar. */
export async function fetchCustomerPortalUrl(apiKey: string, subscriptionId: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!ID_RE.test(subscriptionId)) throw new Error("suscripción inválida");
  const response = await fetcher(`${LEMONSQUEEZY_API}/subscriptions/${subscriptionId}`, {
    headers: apiHeaders(apiKey),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`portal ${response.status}`);
  const json = (await response.json()) as { data?: { attributes?: { urls?: { customer_portal?: unknown } } } };
  const url = json.data?.attributes?.urls?.customer_portal;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("portal sin URL");
  return url;
}

// ----------------------------------------------------------------------------
// Webhook → fila de `user_subscriptions`
// ----------------------------------------------------------------------------

export interface SubscriptionUpsert {
  user_id: string;
  plan: PlanId;
  status: string;
  billing_cycle: BillingCycle | null;
  provider: "lemonsqueezy";
  provider_customer_id: string | null;
  provider_subscription_id: string;
  current_period_end: string | null;
}

export type ParsedWebhook =
  | { kind: "subscription"; event: HandledEvent; row: SubscriptionUpsert }
  | { kind: "ignored"; reason: string };

/** Estados del proveedor que dan acceso Pro (ver `PRO_STATUSES`). */
const PRO_PROVIDER_STATUSES = new Set(["active", "on_trial", "past_due", "cancelled"]);

const idString = (value: unknown): string | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0
    ? String(value)
    : typeof value === "string" && ID_RE.test(value)
      ? value
      : null;

const isoOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/**
 * Traduce el evento firmado a la fila que se guarda. El ciclo se deduce de la
 * variante (mensual / anual) y, si no coincide, del `custom_data` del cobro.
 */
export function parseSubscriptionWebhook(payload: unknown, variants?: Partial<Record<BillingCycle, string>>): ParsedWebhook {
  if (!payload || typeof payload !== "object") return { kind: "ignored", reason: "cuerpo inválido" };
  const root = payload as { meta?: Record<string, unknown>; data?: Record<string, unknown> };
  const eventName = root.meta?.event_name;
  if (typeof eventName !== "string" || !(HANDLED_EVENTS as readonly string[]).includes(eventName)) {
    return { kind: "ignored", reason: "evento no manejado" };
  }
  const custom = (root.meta?.custom_data ?? {}) as Record<string, unknown>;
  const userId = typeof custom.user_id === "string" ? custom.user_id : "";
  if (!UUID_RE.test(userId)) return { kind: "ignored", reason: "sin user_id válido" };

  const data = root.data ?? {};
  if (data.type !== "subscriptions") return { kind: "ignored", reason: "no es una suscripción" };
  const subscriptionId = idString(data.id);
  if (!subscriptionId) return { kind: "ignored", reason: "sin id de suscripción" };
  const attrs = (data.attributes ?? {}) as Record<string, unknown>;

  const rawStatus = typeof attrs.status === "string" ? attrs.status.toLowerCase().slice(0, 32) : "";
  const status = eventName === "subscription_expired" ? "expired" : rawStatus || "inactive";
  const variantId = idString(attrs.variant_id);
  const cycle: BillingCycle | null =
    variantId && variants?.monthly === variantId
      ? "monthly"
      : variantId && variants?.annual === variantId
        ? "annual"
        : normalizeBillingCycle(custom.billing_cycle);

  // Cancelada: Pro hasta `ends_at`. Activa: hasta la próxima renovación.
  const periodEnd = isoOrNull(status === "cancelled" || status === "expired" ? attrs.ends_at : attrs.renews_at) ?? isoOrNull(attrs.ends_at);

  return {
    kind: "subscription",
    event: eventName as HandledEvent,
    row: {
      user_id: userId,
      plan: PRO_PROVIDER_STATUSES.has(status) ? "pro" : "free",
      status,
      billing_cycle: cycle,
      provider: "lemonsqueezy",
      provider_customer_id: idString(attrs.customer_id),
      provider_subscription_id: subscriptionId,
      current_period_end: periodEnd,
    },
  };
}
