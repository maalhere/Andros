// ============================================================================
// ANDROS — CLIENTE IA DEL CDE (arranque en 3 pasos y reportes a @IA)
// Siempre hay respaldo local sin IA: sin sesión, sin cuota, sin red o con la
// IA saturada, el arranque usa `buildLocalSetupPlan` y el reporte usa
// `evaluateReportLocally`. La clave propia (BYOK) solo viaja en la petición.
// ============================================================================

import { getUserAiKey } from "@/store/useAiProvidersStore";
import { checkFreeQuota, recordFreeQuery } from "@/store/useAiQuotaStore";
import { sessionAuthHeader } from "@/lib/supabase/authHeader";
import { impactSnapshot } from "@/lib/canvas/impact";
import type { EngineeringNodeData, NodeConnection } from "@/types/workspace";
import type { CdeSetupResponse } from "@/app/api/oracle/cde-setup/route";
import type { CdeReportResponse } from "@/app/api/oracle/cde-report/route";
import { buildLocalSetupPlan, type SetupPlan } from "./setup";
import { evaluateReportLocally, type ReportCardInput, type ReportEvaluation } from "./alerts";

export interface WithNotice<T> {
  value: T;
  engine: "ai" | "local";
  /** Por qué se usó el respaldo local (o `null` si respondió la IA). */
  notice: string | null;
}

async function postJson<T>(url: string, body: object, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionAuthHeader()) },
      body: JSON.stringify(body),
      signal,
    });
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}

/** Paso 3: formatos de ficha para el proyecto (IA o respaldo local). */
export async function requestSetupPlan(description: string, areas: string[], signal?: AbortSignal): Promise<WithNotice<SetupPlan>> {
  const local = (notice: string): WithNotice<SetupPlan> => ({ value: buildLocalSetupPlan(description, areas), engine: "local", notice });
  if (!description.trim()) return local("Sin descripción: preparé fichas base de tareas e incidencias.");
  const apiKey = getUserAiKey("gemini");
  if (!apiKey) {
    const quota = checkFreeQuota();
    if (!quota.ok) return local(quota.message);
  }
  const data = await postJson<CdeSetupResponse>("/api/oracle/cde-setup", { description, areas, ...(apiKey ? { apiKey } : {}) }, signal);
  if (!data) return local("Sin conexión con la IA: preparé las fichas sin IA.");
  if (!data.ok) return local(data.issue.message);
  if (!apiKey) recordFreeQuery();
  return { value: { templates: data.templates, engine: "ai" }, engine: "ai", notice: null };
}

/** Tarjetas del lienzo como contexto corto para evaluar un reporte. */
export function reportCardsFrom(nodes: readonly EngineeringNodeData[], connections: readonly NodeConnection[]): ReportCardInput[] {
  const graph = { nodes: [...nodes], connections: [...connections] };
  return nodes.slice(0, 40).map((n) => ({
    id: n.id,
    title: n.title,
    area: n.type === "form-sheet-node" ? n.formSheetData.area : undefined,
    text: impactSnapshot(n, graph).slice(0, 1500),
  }));
}

/** Reporte a @IA → evaluación (IA o respaldo local). */
export async function evaluateReport(
  message: string,
  cards: ReportCardInput[],
  areas: string[],
  mentionedAreas: string[]
): Promise<WithNotice<ReportEvaluation>> {
  const local = (notice: string): WithNotice<ReportEvaluation> => ({
    value: evaluateReportLocally(message, cards, areas, mentionedAreas),
    engine: "local",
    notice,
  });
  const apiKey = getUserAiKey("gemini");
  if (!apiKey) {
    const quota = checkFreeQuota();
    if (!quota.ok) return local(quota.message);
  }
  const data = await postJson<CdeReportResponse>("/api/oracle/cde-report", {
    message,
    areas,
    cards: cards.map((c) => ({ ...c, area: c.area ?? "" })),
    ...(apiKey ? { apiKey } : {}),
  });
  if (!data) return local("Sin conexión con la IA: evalué el reporte sin IA.");
  if (!data.ok) return local(data.issue.message);
  if (!apiKey) recordFreeQuery();
  const evaluation = data.evaluation;
  // Si la IA no marcó áreas, se conservan las que la persona mencionó.
  if (evaluation.affectedAreas.length === 0 && mentionedAreas.length > 0) evaluation.affectedAreas = mentionedAreas.slice(0, 3);
  return { value: evaluation, engine: "ai", notice: null };
}
