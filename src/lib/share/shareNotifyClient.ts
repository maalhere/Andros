// ============================================================================
// ANDROS — PEDIR EL AVISO POR CORREO AL COMPARTIR (navegador)
// Nunca lanza errores ni bloquea: compartir ya quedó guardado en la base.
// Devuelve una nota corta para mostrar (o `null` si no hace falta decir nada).
// ============================================================================

import { sessionAuthHeader } from "@/lib/supabase/authHeader";

export type ShareNotifyOutcome =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "no_email" | "throttled" | "send_failed" | "error" };

/** Cabecera Authorization con tu sesión actual (se mantiene por compatibilidad). */
export { sessionAuthHeader };

export async function requestShareNotification(
  workspaceId: string,
  memberId: string,
  reason: "added" | "role_changed"
): Promise<ShareNotifyOutcome> {
  try {
    const response = await fetch("/api/workspaces/share-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionAuthHeader()) },
      body: JSON.stringify({ workspaceId, memberId, reason }),
    });
    const json = (await response.json().catch(() => ({}))) as { sent?: unknown; reason?: unknown };
    if (json.sent === true) return { sent: true };
    const known = ["not_configured", "no_email", "throttled", "send_failed"] as const;
    const reasonValue = known.find((r) => r === json.reason) ?? "error";
    return { sent: false, reason: reasonValue };
  } catch {
    return { sent: false, reason: "error" };
  }
}

/** Nota discreta para la interfaz según el resultado del aviso. */
export function shareNotifyNote(outcome: ShareNotifyOutcome, name: string): string | null {
  if (outcome.sent) return `Le avisamos por correo a ${name}.`;
  switch (outcome.reason) {
    case "not_configured":
      return "Aviso por correo desactivado en este servidor: comparte el enlace por tu cuenta.";
    case "throttled":
      return null;
    case "no_email":
      return `${name} no tiene un correo para avisos: comparte el enlace por tu cuenta.`;
    default:
      return "No se pudo enviar el aviso por correo, pero el acceso ya quedó guardado.";
  }
}
