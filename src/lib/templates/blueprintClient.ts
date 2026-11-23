// ============================================================================
// ANDROS — CLIENTE DE /api/oracle/blueprint
// Cuota diaria amable (15 gratis, sin tope con clave propia), traducción de
// fallos a mensajes claros y cancelación. Cualquier fallo es recuperable con
// «Usar plantilla base sin IA».
// ============================================================================

import type { BoardBlueprint } from "@/lib/templates/blueprint";
import type { BlueprintResponse } from "@/app/api/oracle/blueprint/route";
import { getUserAiKey } from "@/store/useAiProvidersStore";
import { checkFreeQuota, recordFreeQuery } from "@/store/useAiQuotaStore";

/** Aviso listo para mostrar + si conviene ofrecer añadir una clave propia. */
export class BlueprintError extends Error {
  constructor(
    message: string,
    public code: "quota" | "network" | "service" | "aborted"
  ) {
    super(message);
  }
}

export async function generateBlueprint(prompt: string, signal?: AbortSignal): Promise<BoardBlueprint> {
  const quota = checkFreeQuota();
  if (!quota.ok) throw new BlueprintError(quota.message, "quota");

  const apiKey = getUserAiKey("gemini");
  let res: Response;
  try {
    res = await fetch("/api/oracle/blueprint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, ...(apiKey ? { apiKey } : {}) }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new BlueprintError("Cancelado.", "aborted");
    throw new BlueprintError(
      "No hay conexión con Andros. Comprueba tu Internet (o que el servidor esté en marcha).",
      "network"
    );
  }

  let data: BlueprintResponse | null = null;
  try {
    data = (await res.json()) as BlueprintResponse;
  } catch {
    data = null;
  }
  if (!data) {
    throw new BlueprintError(
      res.status === 408 || res.status === 504
        ? "El servidor tardó demasiado en responder."
        : `El servidor respondió ${res.status}. Inténtalo de nuevo.`,
      "service"
    );
  }
  if (!data.ok) {
    throw new BlueprintError(data.issue.message, data.issue.code === "daily_limit" ? "quota" : data.issue.code === "network" ? "network" : "service");
  }
  // Solo cuenta si de verdad se usó la clave gratuita del servidor.
  recordFreeQuery();
  return data.blueprint;
}
