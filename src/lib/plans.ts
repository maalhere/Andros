// ============================================================================
// ANDROS — PLANES (textos de la portada y del modal de planes)
//
// Precios y límites salen de `src/lib/billing/planLimits.ts` (fuente única):
// Plan Básico $0 vs. Andros Pro $5.99 USD/mes o $65.99 USD/año. Cada fila que
// se promete aquí se aplica de verdad en el código (Sprint 21):
//   · Espacios        → `guardSpaceCreation` + trigger SQL `workspaces_enforce_plan_limit`.
//   · Personas en vivo → tope del plan del DUEÑO (`workspace_live_cap()` en la sala).
//   · Plantillas      → `guardTemplateSave` al «Guardar como plantilla».
//   · Consultas IA    → contador del cliente + `serverQuota` con el plan de Supabase.
//   · Modo Experto    → `chooseExperienceMode` / `usePlanEnforcement`.
// El cobro lo inicia `startProCheckout` (src/lib/billing/subscriptionClient.ts).
// ============================================================================

import { FREE_DAILY_LIMIT, PRO_DAILY_LIMIT } from "@/lib/ai/freeQuota";
import {
  ANNUAL_MONTHLY_EQUIVALENT,
  ANNUAL_SAVINGS_PERCENT,
  ANNUAL_SAVINGS_USD,
  PLAN_LIMITS,
  PRO_PRICING,
  formatUsd,
  type PlanId,
} from "@/lib/billing/planLimits";
import { MAX_VOICE_PARTICIPANTS } from "@/types/collab";

export type { PlanId };

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Precio legible, p. ej. «$5.99». */
  price: string;
  period: string;
  /** Línea secundaria de precio (pago anual) o `null`. */
  altPrice: string | null;
  tagline: string;
  features: string[];
}

const FREE = PLAN_LIMITS.free;
const PRO = PLAN_LIMITS.pro;

/** «$5.50/mes»: equivalente mensual del pago anual (ver planLimits.ts). */
export const ANNUAL_MONTHLY_LABEL = `${formatUsd(ANNUAL_MONTHLY_EQUIVALENT)}/mes`;

/** «ahorra 8% al año»: calculado con los precios reales (ver planLimits.ts). */
export const ANNUAL_SAVINGS_LABEL = `ahorra ${ANNUAL_SAVINGS_PERCENT}% al año`;

/** «Ahorras $5.89 al año»: ahorro exacto al centavo. */
export const ANNUAL_SAVINGS_USD_LABEL = `ahorras ${formatUsd(ANNUAL_SAVINGS_USD)} al año`;

export const FREE_PLAN: PlanDefinition = {
  id: "free",
  name: "Plan Básico",
  price: "$0",
  period: "USD / mes · gratis",
  altPrice: null,
  tagline: "Para organizar tu primer evento o equipo, sin tarjeta.",
  features: [
    `Hasta ${FREE.maxSpaces} espacios activos`,
    `Hasta ${FREE.maxLiveParticipants} participantes en vivo por espacio`,
    `${FREE.maxCustomTemplates} plantilla personalizada guardada`,
    `${FREE_DAILY_LIMIT} consultas IA al día (o ilimitadas con tu propia clave)`,
    "Chat del espacio con @menciones y fichas Rojo / Verde",
    "Calendarios externos",
  ],
};

export const PRO_PLAN: PlanDefinition = {
  id: "pro",
  name: "Andros Pro",
  price: PRO_PRICING.monthly.label,
  period: PRO_PRICING.monthly.period,
  altPrice: `o ${PRO_PRICING.annual.label} ${PRO_PRICING.annual.period} (${ANNUAL_MONTHLY_LABEL} · ${ANNUAL_SAVINGS_LABEL})`,
  tagline: "Para quien coordina a muchas personas a la vez.",
  features: [
    "Espacios ilimitados",
    `Hasta ${PRO.maxLiveParticipants} participantes en vivo por espacio (${MAX_VOICE_PARTICIPANTS} a la vez en el canal de voz)`,
    "Plantillas personalizadas ilimitadas",
    `${PRO_DAILY_LIMIT} consultas IA al día con la IA de Andros`,
    "Modo Experto completo: visor 3D, fórmulas, CodeLab e impresoras",
    "Todo lo del Plan Básico",
  ],
};

export const PLANS: PlanDefinition[] = [FREE_PLAN, PRO_PLAN];

/** Comparación fila a fila (portada). `null` = no incluido en ese plan. */
export interface PlanComparisonRow {
  label: string;
  free: string | null;
  pro: string;
}

export const PLAN_COMPARISON: PlanComparisonRow[] = [
  { label: "Espacios activos", free: `Hasta ${FREE.maxSpaces}`, pro: "Ilimitados" },
  {
    label: "Participantes en vivo por espacio",
    free: `Hasta ${FREE.maxLiveParticipants}`,
    pro: `Hasta ${PRO.maxLiveParticipants} (${MAX_VOICE_PARTICIPANTS} en el canal de voz)`,
  },
  { label: "Plantillas personalizadas", free: String(FREE.maxCustomTemplates), pro: "Ilimitadas" },
  {
    label: "Consultas IA al día",
    free: `${FREE_DAILY_LIMIT}, o ilimitadas con tu propia clave`,
    pro: `${PRO_DAILY_LIMIT}, o ilimitadas con tu propia clave`,
  },
  { label: "Chat del espacio, fichas Rojo / Verde y calendarios", free: "Incluido", pro: "Incluido" },
  { label: "Modo Experto (3D, fórmulas, CodeLab e impresoras)", free: null, pro: "Completo" },
];
