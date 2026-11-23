// ============================================================================
// ANDROS — TOPE DIARIO DE RESPALDO EN EL SERVIDOR (solo servidor)
//
// En memoria y por instancia: en serverless se reinicia con cada arranque en
// frío, así que solo frena abusos evidentes. El límite real y amable de 15
// consultas/día vive en el cliente (`useAiQuotaStore`). Usa el doble de margen
// para no castigar a quien comparte IP (escuela, oficina, evento).
// ============================================================================

import { FREE_DAILY_LIMIT } from "@/lib/ai/freeQuota";

const SERVER_LIMIT = FREE_DAILY_LIMIT * 2;
const counts = new Map<string, { day: string; n: number }>();

const utcDay = () => new Date().toISOString().slice(0, 10);

/** IP del cliente tras el proxy (Vercel pone `x-forwarded-for`). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

export function serverQuotaAllows(ip: string): boolean {
  const entry = counts.get(ip);
  return !entry || entry.day !== utcDay() || entry.n < SERVER_LIMIT;
}

export function serverQuotaConsume(ip: string): void {
  const day = utcDay();
  const entry = counts.get(ip);
  if (!entry || entry.day !== day) {
    if (counts.size > 5000) counts.clear();
    counts.set(ip, { day, n: 1 });
  } else {
    entry.n += 1;
  }
}
