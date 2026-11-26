"use client";

// ============================================================================
// ANDROS — SUSCRIPCIÓN EN EL NAVEGADOR (Sprint 21)
//   · `useSubscriptionSync()` (se monta una vez en page.tsx): lee la fila
//     propia de `user_subscriptions` al iniciar sesión, al volver a la
//     pestaña y al regresar del cobro (`?pro=gracias`).
//   · `startProCheckout(cycle)`: pide al servidor el enlace de cobro.
//   · `openBillingPortal()`: abre la gestión de la suscripción (Pro activo).
// El navegador SOLO lee su plan: escribirlo es cosa del webhook firmado.
// ============================================================================

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { sessionAuthHeader } from "@/lib/supabase/authHeader";
import { useCloudStore } from "@/store/useCloudStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { toast } from "@/store/useToastStore";
import {
  PLAN_LIMITS,
  liveParticipantCap,
  normalizeBillingCycle,
  planFromSubscription,
  type BillingCycle,
  type PlanId,
  type SubscriptionRow,
} from "./planLimits";

export const CHECKOUT_RETURN_PARAM = "pro";
const CHECKOUT_RETURN_VALUE = "gracias";
const SUBSCRIPTION_COLUMNS = "plan, status, billing_cycle, current_period_end";

let inflight: Promise<PlanId> | null = null;
let inflightFor: string | null = null;

/** Vuelve a leer el plan de la persona con sesión (o `free` sin sesión). */
export function refreshSubscription(): Promise<PlanId> {
  const cloud = useCloudStore.getState();
  const userId = cloud.user?.id ?? null;
  const store = useSubscriptionStore.getState();
  if (!userId) {
    const known = cloud.status === "disabled" || cloud.status === "signed-out";
    store.setSubscription({ plan: "free", status: "inactive", billingCycle: null, periodEnd: null, userId: null, loaded: known });
    return Promise.resolve("free");
  }
  if (inflight && inflightFor === userId) return inflight;
  const supabase = getSupabaseBrowserClient();
  inflightFor = userId;
  inflight = (async (): Promise<PlanId> => {
    let row: SubscriptionRow | null = null;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("user_subscriptions")
          .select(SUBSCRIPTION_COLUMNS)
          .eq("user_id", userId)
          .maybeSingle();
        // Sin tabla (esquema sin ejecutar) o sin fila → Plan Básico.
        if (!error) row = (data as SubscriptionRow | null) ?? null;
      } catch {
        row = null;
      }
    }
    const plan = planFromSubscription(row);
    // Si mientras tanto cambió la sesión, lo leído ya no aplica.
    if (useCloudStore.getState().user?.id === userId) {
      useSubscriptionStore.getState().setSubscription({
        plan,
        status: row?.status ?? "inactive",
        billingCycle: normalizeBillingCycle(row?.billing_cycle),
        periodEnd: row?.current_period_end ?? null,
        userId,
        loaded: true,
      });
    }
    return plan;
  })().finally(() => {
    inflight = null;
    inflightFor = null;
  });
  return inflight;
}

/** Plan actual (ya leído) para decisiones síncronas. */
export const currentPlan = (): PlanId => useSubscriptionStore.getState().plan;

/** Plan actual, esperando la lectura si aún no se hizo para esta sesión. */
export async function ensurePlan(): Promise<PlanId> {
  const state = useSubscriptionStore.getState();
  const userId = useCloudStore.getState().user?.id ?? null;
  if (state.loaded && state.userId === userId) return state.plan;
  return refreshSubscription();
}

/**
 * Tope de personas en vivo de un espacio, según el plan de su DUEÑO. Lo
 * calcula Supabase (`workspace_live_cap`, SECURITY DEFINER y solo para
 * miembros), porque nadie puede leer la suscripción de otra cuenta. Si la
 * función aún no existe: tu propio plan si el espacio es tuyo; si no, el
 * tope del Plan Básico (nunca se promete más de lo que se puede comprobar).
 */
export async function fetchWorkspaceLiveCap(workspaceId: string, ownedBySelf: boolean): Promise<number> {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("workspace_live_cap", { ws_id: workspaceId });
      const cap = typeof data === "number" ? data : Number(data);
      if (!error && Number.isInteger(cap) && cap >= 1) return Math.min(cap, PLAN_LIMITS.pro.maxLiveParticipants);
    } catch {
      /* respaldo abajo */
    }
  }
  return liveParticipantCap(ownedBySelf ? await ensurePlan() : "free");
}

// ----------------------------------------------------------------------------
// Cobro y portal
// ----------------------------------------------------------------------------

export type CheckoutResult =
  | { status: "redirect"; url: string }
  | { status: "signin"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

const GENERIC_ERROR = "No pudimos abrir el pago ahora mismo. Inténtalo de nuevo en unos minutos.";

async function postJson(path: string, body?: unknown, method: "POST" | "GET" = "POST") {
  const response = await fetch(path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(await sessionAuthHeader()) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as { url?: unknown; error?: unknown };
  return { status: response.status, url: typeof json.url === "string" ? json.url : null, error: typeof json.error === "string" ? json.error : null };
}

/** Pide al servidor el enlace de cobro de Andros Pro (mensual o anual). */
export async function startProCheckout(cycle: BillingCycle): Promise<CheckoutResult> {
  if (!useCloudStore.getState().user) {
    return { status: "signin", message: "Inicia sesión para pasar a Andros Pro: el plan queda ligado a tu cuenta." };
  }
  try {
    const res = await postJson("/api/billing/checkout", { cycle });
    if (res.status === 200 && res.url?.startsWith("https://")) return { status: "redirect", url: res.url };
    if (res.status === 401) return { status: "signin", message: res.error ?? "Inicia sesión para continuar." };
    if (res.status === 503) return { status: "unavailable", message: res.error ?? "Los pagos se activarán muy pronto." };
    return { status: "error", message: res.error ?? GENERIC_ERROR };
  } catch {
    return { status: "error", message: GENERIC_ERROR };
  }
}

/** Abre el portal del proveedor para cambiar tarjeta, ciclo o cancelar. */
export async function openBillingPortal(): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await postJson("/api/billing/portal", undefined, "GET");
    if (res.status === 200 && res.url?.startsWith("https://")) {
      window.location.assign(res.url);
      return { ok: true };
    }
    return { ok: false, message: res.error ?? GENERIC_ERROR };
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// ----------------------------------------------------------------------------
// Sincronización (montada una vez)
// ----------------------------------------------------------------------------

const FOCUS_REFRESH_MS = 5 * 60 * 1000;
/** Tras pagar, el webhook puede tardar unos segundos: se reintenta un rato. */
const RETURN_POLL_MS = 3000;
const RETURN_POLL_TRIES = 12;

function consumeCheckoutReturn(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(CHECKOUT_RETURN_PARAM) !== CHECKOUT_RETURN_VALUE) return false;
    url.searchParams.delete(CHECKOUT_RETURN_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    return true;
  } catch {
    return false;
  }
}

export function useSubscriptionSync(): void {
  useEffect(() => {
    let lastRefresh = 0;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingReturn = consumeCheckoutReturn();

    const pollAfterCheckout = (tries: number) => {
      void refreshSubscription().then((plan) => {
        if (plan === "pro") {
          toast({ tone: "success", message: "¡Listo! Andros Pro está activo en tu cuenta." });
          return;
        }
        if (tries <= 1) {
          toast({ message: "Recibimos tu pago; Pro se activará en cuanto el proveedor lo confirme. Vuelve a abrir Andros en unos minutos." });
          return;
        }
        pollTimer = setTimeout(() => pollAfterCheckout(tries - 1), RETURN_POLL_MS);
      });
    };

    const sync = () => {
      lastRefresh = Date.now();
      const userId = useCloudStore.getState().user?.id ?? null;
      if (pendingReturn && userId) {
        pendingReturn = false;
        toast({ message: "Gracias: estamos activando Andros Pro en tu cuenta…" });
        pollAfterCheckout(RETURN_POLL_TRIES);
        return;
      }
      void refreshSubscription();
    };

    sync();
    const unsubscribe = useCloudStore.subscribe((state, prev) => {
      if (state.user?.id !== prev.user?.id || (state.status !== prev.status && !state.user)) sync();
    });
    const onFocus = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh > FOCUS_REFRESH_MS) sync();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onFocus);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, []);
}
