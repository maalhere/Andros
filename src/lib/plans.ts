// ============================================================================
// ANDROS — PLANES (fuente única para la portada y el modal de planes)
//
// Precios y límites transparentes: Gratis $0 vs. Andros Pro $9 USD/mes.
// Pro todavía no se cobra: el botón abre la lista de espera / acceso
// anticipado. Para conectar Lemon Squeezy o Paddle basta con implementar
// `startProCheckout` (crear la sesión de cobro en el servidor y redirigir);
// mientras devuelva `{ status: "waitlist" }`, la app muestra la lista de espera.
// ============================================================================

import { FREE_DAILY_LIMIT } from "@/lib/ai/freeQuota";
import { MAX_SPACE_PARTICIPANTS, MAX_VOICE_PARTICIPANTS } from "@/types/collab";

export type PlanId = "free" | "pro";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Precio legible, p. ej. «$9». */
  price: string;
  period: string;
  tagline: string;
  features: string[];
}

export const PRO_PRICE_USD = 9;

export const FREE_PLAN: PlanDefinition = {
  id: "free",
  name: "Gratis",
  price: "$0",
  period: "para siempre",
  tagline: "Para organizar tu primer evento o equipo.",
  features: [
    "Hasta 2 espacios activos",
    "Hasta 3 personas en vivo en el lienzo",
    `${FREE_DAILY_LIMIT} consultas IA al día (o ilimitadas con tu propia clave)`,
    "1 plantilla propia",
  ],
};

export const PRO_PLAN: PlanDefinition = {
  id: "pro",
  name: "Andros Pro",
  price: `$${PRO_PRICE_USD}`,
  period: "USD / mes",
  tagline: "Para quien coordina a muchas personas a la vez.",
  features: [
    "Espacios y plantillas ilimitados",
    `Hasta ${MAX_SPACE_PARTICIPANTS} personas en vivo, con voz, video y pantalla compartida (${MAX_VOICE_PARTICIPANTS} en el canal de voz)`,
    "Enlaces públicos «Vista Invitado»: solo lectura y sin cuenta",
    "Exportar el Plan del Día en PDF y resumen para WhatsApp",
    "150 consultas IA al día y alertas anti-malentendidos prioritarias",
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
  { label: "Espacios activos", free: "Hasta 2", pro: "Ilimitados" },
  {
    label: "Personas en vivo",
    free: "Hasta 3",
    pro: `Hasta ${MAX_SPACE_PARTICIPANTS}, con voz, video y pantalla (${MAX_VOICE_PARTICIPANTS} en voz)`,
  },
  {
    label: "Consultas IA",
    free: `${FREE_DAILY_LIMIT} al día, o ilimitadas con tu propia clave`,
    pro: "150 al día y alertas prioritarias",
  },
  { label: "Plantillas propias", free: "1", pro: "Ilimitadas" },
  { label: "Enlace público «Vista Invitado»", free: null, pro: "Solo lectura, sin cuenta" },
  { label: "Plan del Día", free: null, pro: "PDF imprimible y resumen para WhatsApp" },
];

export type CheckoutResult = { status: "redirect"; url: string } | { status: "waitlist" };

/**
 * PUNTO DE INTEGRACIÓN DE LA PASARELA DE PAGO (Lemon Squeezy / Paddle).
 * Hoy no hay cobro: siempre devuelve «lista de espera», sin bloquear nada.
 * Ejemplo futuro:
 *   const res = await fetch("/api/checkout", { method: "POST" });
 *   const { url } = await res.json();
 *   return { status: "redirect", url };
 */
export async function startProCheckout(): Promise<CheckoutResult> {
  return { status: "waitlist" };
}
