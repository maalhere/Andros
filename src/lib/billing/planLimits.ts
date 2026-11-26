// ============================================================================
// ANDROS — PRECIOS Y LÍMITES DE CADA PLAN (fuente única, Sprint 21)
//
// Módulo PURO (sin React, sin Supabase, sin red): lo importan la portada, el
// modal de planes, las rutas /api, la sala en vivo y `npm run verify:billing`.
// Si cambias un número aquí, cambia en TODA la app y en el verificador; el
// SQL (`supabase/schema.sql` §21) repite los topes de espacios y personas en
// vivo, y el verificador comprueba que coincidan.
//
//   Plan Básico (gratis) → 2 espacios, 3 personas en vivo, 1 plantilla propia,
//                          15 consultas IA/día (o ilimitadas con clave propia).
//   Andros Pro           → $5.99 USD/mes o $65.99 USD/año: espacios y
//                          plantillas ilimitados, 6 personas en vivo,
//                          150 consultas IA/día y Modo Experto completo.
// ============================================================================

export type PlanId = "free" | "pro";
export type BillingCycle = "monthly" | "annual";

/** Sin tope (espacios y plantillas en Pro). */
export const UNLIMITED = Number.POSITIVE_INFINITY;

export interface PlanLimits {
  /** Espacios propios («Mis espacios»); los compartidos contigo no cuentan. */
  maxSpaces: number;
  /** Personas editando a la vez un espacio (lo decide el plan del DUEÑO). */
  maxLiveParticipants: number;
  /** Plantillas de tablero guardadas con «Guardar como plantilla». */
  maxCustomTemplates: number;
  /** Consultas al día con la clave de IA del servidor (BYOK no cuenta). */
  aiDailyQueries: number;
  /** Modo Experto: 3D, fórmulas, CodeLab e impresoras. */
  expertMode: boolean;
}

export const PLAN_LIMITS: Readonly<Record<PlanId, Readonly<PlanLimits>>> = {
  free: {
    maxSpaces: 2,
    maxLiveParticipants: 3,
    maxCustomTemplates: 1,
    aiDailyQueries: 15,
    expertMode: false,
  },
  pro: {
    maxSpaces: UNLIMITED,
    maxLiveParticipants: 6,
    maxCustomTemplates: UNLIMITED,
    aiDailyQueries: 150,
    expertMode: true,
  },
};

/** Precios públicos en USD (el proveedor de pagos añade impuestos locales). */
export const PRO_PRICING = {
  monthly: { amount: 5.99, label: "$5.99", period: "USD / mes" },
  annual: { amount: 65.99, label: "$65.99", period: "USD / año" },
} as const satisfies Record<BillingCycle, { amount: number; label: string; period: string }>;

/** Lo que costarían 12 mensualidades: 12 × $5.99 = $71.88. */
export const TWELVE_MONTHLY_TOTAL = Math.round(PRO_PRICING.monthly.amount * 12 * 100) / 100;

/**
 * Ahorro del pago anual en USD, al centavo: $71.88 − $65.99 = $5.89 al año.
 * Se calcula en centavos enteros para evitar errores de coma flotante.
 */
export const ANNUAL_SAVINGS_USD =
  (Math.round(TWELVE_MONTHLY_TOTAL * 100) - Math.round(PRO_PRICING.annual.amount * 100)) / 100;

/**
 * Porcentaje ahorrado frente a 12 mensualidades: $5.89 / $71.88 ≈ 8,19 % → 8.
 * Se redondea HACIA ABAJO, así la promesa «ahorra N%» siempre es cierta.
 */
export const ANNUAL_SAVINGS_PERCENT = Math.floor((ANNUAL_SAVINGS_USD / TWELVE_MONTHLY_TOTAL) * 100);

/**
 * Equivalente mensual del plan anual: $65.99 / 12 ≈ $5.499 → $5.50. Se
 * redondea HACIA ARRIBA al centavo para nunca anunciar un precio menor al real.
 */
export const ANNUAL_MONTHLY_EQUIVALENT = Math.ceil((Math.round(PRO_PRICING.annual.amount * 100) / 12)) / 100;

/** Importe en USD con dos decimales: 5.5 → «$5.50». */
export const formatUsd = (amount: number): string => `$${amount.toFixed(2)}`;

export const limitsFor = (plan: PlanId): Readonly<PlanLimits> => PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

/** ¿Puede crear (o duplicar) un espacio más con `ownedCount` espacios propios? */
export function canCreateSpace(plan: PlanId, ownedCount: number): boolean {
  return ownedCount < limitsFor(plan).maxSpaces;
}

/** Tope de personas en vivo de un espacio según el plan de su dueño. */
export function liveParticipantCap(ownerPlan: PlanId): number {
  return limitsFor(ownerPlan).maxLiveParticipants;
}

/**
 * ¿Se puede guardar otra plantilla propia? Reemplazar una con el MISMO nombre
 * no suma (la lista no crece), así que siempre se permite.
 */
export function canSaveCustomTemplate(plan: PlanId, savedCount: number, replacesExisting: boolean): boolean {
  return replacesExisting || savedCount < limitsFor(plan).maxCustomTemplates;
}

export function aiDailyLimit(plan: PlanId): number {
  return limitsFor(plan).aiDailyQueries;
}

// ----------------------------------------------------------------------------
// Suscripción guardada en Supabase (`user_subscriptions`) → plan efectivo
// ----------------------------------------------------------------------------

/** Fila de `public.user_subscriptions` tal como la lee el navegador o el servidor. */
export interface SubscriptionRow {
  plan?: string | null;
  status?: string | null;
  billing_cycle?: string | null;
  current_period_end?: string | null;
}

/**
 * Estados del proveedor con acceso Pro. `cancelled` mantiene Pro hasta el fin
 * del periodo pagado; `past_due` conserva el acceso mientras se reintenta el
 * cobro. `expired`, `unpaid` y `paused` vuelven al Plan Básico.
 */
export const PRO_STATUSES: ReadonlySet<string> = new Set(["active", "on_trial", "past_due", "cancelled"]);

/** Margen tras `current_period_end` por si el aviso de renovación llega tarde. */
export const PERIOD_GRACE_MS = 72 * 60 * 60 * 1000;

/** Plan efectivo de una fila (o `free` si no hay fila). Lo mismo que `public.user_plan()` en SQL. */
export function planFromSubscription(row: SubscriptionRow | null | undefined, now = Date.now()): PlanId {
  if (!row || row.plan !== "pro" || !row.status || !PRO_STATUSES.has(row.status)) return "free";
  if (!row.current_period_end) return "pro";
  const end = Date.parse(row.current_period_end);
  if (!Number.isFinite(end)) return "pro";
  return end + PERIOD_GRACE_MS > now ? "pro" : "free";
}

export function normalizeBillingCycle(value: unknown): BillingCycle | null {
  return value === "monthly" || value === "annual" ? value : null;
}
