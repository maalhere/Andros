// ============================================================================
// ANDROS — POST /api/billing/checkout  { cycle: "monthly" | "annual" }
//
//   0. Sin variables de la pasarela → 503 (antes de tocar la red).
//   1. Exige sesión (`getRequestUser`): el plan queda ligado a ESA cuenta.
//   2. Crea el cobro en el proveedor (Merchant of Record) con la variante
//      mensual o anual y `custom_data.user_id`, que vuelve en el webhook.
//   3. Devuelve `{ url }` (página de pago del proveedor) para redirigir.
//
// Sin variables de la pasarela → 503 con un mensaje limpio para la interfaz
// («Los pagos se activarán muy pronto»), nunca un error que rompa la app.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { getRequestUser } from "@/lib/supabase/server";
import { normalizeBillingCycle } from "@/lib/billing/planLimits";
import { getUserPlan } from "@/lib/billing/serverPlan";
import { BILLING_UNAVAILABLE_MESSAGE, createCheckoutUrl, readBillingConfig } from "@/lib/billing/lemonSqueezy";
import { createRateLimiter } from "@/lib/net/rateLimit";
import { SITE_URL } from "@/lib/site";

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

/** 10 intentos de cobro por persona cada 10 minutos (frena bucles y abusos). */
const limiter = createRateLimiter({ max: 10, windowMs: 10 * 60_000 });

/** Origen público para volver tras pagar (nunca `localhost` en producción). */
function publicOrigin(request: NextRequest): string {
  if (process.env.NODE_ENV === "production") {
    try {
      return new URL(SITE_URL).origin;
    } catch {
      /* SITE_URL inválida: se usa el origen de la petición */
    }
  }
  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Petición inválida.");
  }
  const cycle = normalizeBillingCycle(body.cycle);
  if (!cycle) return fail(400, "Elige el pago mensual o anual.");

  // Primero la configuración: sin pasarela no hace falta ni consultar la sesión.
  const { config, missing } = readBillingConfig(process.env);
  if (!config) {
    console.warn(`[Andros] Pagos sin configurar: faltan ${missing.join(", ")}.`);
    return fail(503, BILLING_UNAVAILABLE_MESSAGE);
  }

  const caller = await getRequestUser(request);
  if (!caller) return fail(401, "Inicia sesión para pasar a Andros Pro.");

  if (!limiter.take(caller.userId)) return fail(429, "Demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.");

  if ((await getUserPlan(caller.supabase, caller.userId)) === "pro") {
    return fail(409, "Tu cuenta ya tiene Andros Pro activo. Puedes gestionarlo desde «Gestionar suscripción».");
  }

  try {
    const url = await createCheckoutUrl(config, {
      userId: caller.userId,
      email: caller.email,
      cycle,
      redirectUrl: `${publicOrigin(request)}/?pro=gracias`,
    });
    return NextResponse.json({ url }, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error("[Andros] No se pudo crear el cobro:", error instanceof Error ? error.message : "error");
    return fail(502, "No pudimos abrir la página de pago. Inténtalo de nuevo en unos minutos.");
  }
}
