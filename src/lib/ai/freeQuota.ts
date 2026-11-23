// ============================================================================
// ANDROS — LÍMITE DIARIO DE IA GRATUITA (cliente y servidor)
//
// Las consultas que usan la clave de Gemini DEL SERVIDOR tienen un tope diario
// (15 por persona y día). Quien configura su propia clave (BYOK) no tiene
// tope: paga su propio consumo. El contador del cliente (`useAiQuotaStore`)
// es el límite amable; el del servidor (`serverQuota`) es solo un respaldo
// contra abusos, con el doble de margen para IP compartidas.
// ============================================================================

export const FREE_DAILY_LIMIT = 15;

export const DAILY_LIMIT_MESSAGE =
  `Llegaste al límite de ${FREE_DAILY_LIMIT} consultas gratis de hoy con la IA de Andros. ` +
  "Vuelve mañana, o añade tu propia clave de Gemini (gratis en Google AI Studio) en Claves IA para usarla sin límite diario.";

/** Día local en formato AAAA-MM-DD (el contador se reinicia a medianoche). */
export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
