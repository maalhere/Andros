import { create } from "zustand";
import type { BillingCycle, PlanId } from "@/lib/billing/planLimits";

// ============================================================================
// ANDROS — PLAN DE LA PERSONA EN ESTE NAVEGADOR (Sprint 21)
// Lo escribe `src/lib/billing/subscriptionClient.ts` leyendo SU fila de
// `user_subscriptions` (RLS: solo lectura propia). Nunca se escribe el plan
// desde aquí hacia la base: eso solo lo hace el webhook firmado del servidor.
// ============================================================================

interface SubscriptionState {
  plan: PlanId;
  /** Estado del proveedor («active», «cancelled»…) o «inactive» sin suscripción. */
  status: string;
  billingCycle: BillingCycle | null;
  /** Fin del periodo pagado (ISO) o `null`. */
  periodEnd: string | null;
  /** Cuenta a la que corresponde lo leído (`null` sin sesión). */
  userId: string | null;
  /** `true` cuando el plan ya se sabe (con o sin sesión). */
  loaded: boolean;
  setSubscription: (next: Omit<SubscriptionState, "setSubscription" | "reset">) => void;
  reset: () => void;
}

const EMPTY = {
  plan: "free" as PlanId,
  status: "inactive",
  billingCycle: null,
  periodEnd: null,
  userId: null,
  loaded: false,
};

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  ...EMPTY,
  setSubscription: (next) => set(next),
  reset: () => set(EMPTY),
}));

/** Selector: ¿la persona tiene Andros Pro activo? */
export const useIsPro = (): boolean => useSubscriptionStore((s) => s.plan === "pro");
