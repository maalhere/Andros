// ============================================================================
// ANDROS — CLIENTE DE /api/oracle/autofill (solo cliente)
// Cuota diaria amable (15 gratis, sin tope con clave propia), petición con
// cancelación y aplicación del resultado al lienzo:
//   · Formatos de la librería → fichas nuevas llenas, colocadas sin solapes y
//     cableadas por expediente/lote.
//   · Fichas ya presentes en el lienzo → se llenan SOLO sus campos vacíos.
// ============================================================================

import { getUserAiKey } from "@/store/useAiProvidersStore";
import { checkFreeQuota, recordFreeQuery } from "@/store/useAiQuotaStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import type { FormField, FormSheetEngineeringNode, FormSheetPayload } from "@/types/workspace";
import type { FormTemplate } from "@/types/forms";
import {
  AUTOFILL_MAX_CONTEXT_CHARS,
  localIsoDate,
  type AutofillResponse,
  type AutofillSheetResult,
  type AutofillSheetSchema,
  type AutofillValue,
} from "./autofill";
import { instantiateTemplate, isFieldFilled } from "./formSchema";
import { insertSheetBatch, patchFormSheet } from "./formActions";
import { connectedContextSummary } from "./nodeFill";

export class AutofillError extends Error {
  constructor(
    message: string,
    public code: "quota" | "network" | "service" | "aborted"
  ) {
    super(message);
  }
}

export type AutofillSource =
  | { kind: "template"; template: FormTemplate }
  | { kind: "canvas"; node: FormSheetEngineeringNode };

function schemaFor(source: AutofillSource, ref: string): AutofillSheetSchema {
  const fields =
    source.kind === "template"
      ? source.template.fields
      : // En una ficha existente solo se piden los campos todavía vacíos.
        source.node.formSheetData.fields.filter((f) => !isFieldFilled(f));
  return {
    ref,
    title: source.kind === "template" ? source.template.title : source.node.title,
    category: source.kind === "template" ? source.template.category : source.node.formSheetData.category,
    existing: source.kind === "canvas",
    fields: fields
      .filter((f) => f.type !== "photo")
      .map((f) => ({
        key: f.fieldKey,
        label: f.label,
        type: f.type as Exclude<FormField["type"], "photo">,
        ...(f.unit ? { unit: f.unit } : {}),
        ...(f.type === "select" ? { options: f.options ?? [] } : {}),
      })),
  };
}

/**
 * (Sprint 24) Resumen de los nodos conectados a las fichas del lienzo elegidas,
 * para que la IA complete con datos reales del proyecto. Vacío si no hay.
 */
export function autofillContextFor(sources: readonly AutofillSource[]): string {
  const { nodes, connections } = useWorkspaceStore.getState();
  const parts: string[] = [];
  for (const source of sources) {
    if (source.kind !== "canvas") continue;
    const summary = connectedContextSummary(source.node.id, nodes, connections);
    if (summary) parts.push(`Ficha «${source.node.title.slice(0, 80)}» conectada a:\n${summary}`);
  }
  return parts.join("\n\n").slice(0, AUTOFILL_MAX_CONTEXT_CHARS);
}

export interface AutofillOutcome {
  created: number;
  updated: number;
  filledFields: number;
  reviewFields: number;
  notes: string;
}

/** Aplica los valores a los campos de una ficha (`onlyEmpty` para las existentes). */
function applyValues(fields: FormField[], values: Record<string, AutofillValue>, onlyEmpty: boolean) {
  let filled = 0;
  let review = 0;
  const next = fields.map((field) => {
    const v = values[field.fieldKey];
    if (!v || field.type === "photo") return field;
    if (onlyEmpty && isFieldFilled(field)) return field;
    const hasValue = v.value !== null && v.value !== "";
    if (hasValue) filled += 1;
    if (v.needsReview) review += 1;
    return {
      ...field,
      ...(hasValue ? { value: v.value } : {}),
      ...(v.needsReview ? { needsReview: true } : { needsReview: undefined }),
    };
  });
  return { fields: next, filled, review };
}

export async function runAutofill(
  rawText: string,
  sources: AutofillSource[],
  signal?: AbortSignal
): Promise<AutofillOutcome> {
  const quota = checkFreeQuota();
  if (!quota.ok) throw new AutofillError(quota.message, "quota");

  let templateCount = 0;
  let canvasCount = 0;
  const refs = sources.map((s) => (s.kind === "template" ? `F${++templateCount}` : `C${++canvasCount}`));
  const schemas = sources.map((s, i) => schemaFor(s, refs[i]));
  if (schemas.every((s) => s.fields.length === 0)) {
    throw new AutofillError("Las fichas elegidas no tienen campos vacíos que llenar.", "service");
  }

  const context = autofillContextFor(sources);
  const apiKey = getUserAiKey("gemini");
  let res: Response;
  try {
    res = await fetch("/api/oracle/autofill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText,
        sheets: schemas.filter((s) => s.fields.length > 0),
        ...(context ? { context } : {}),
        today: localIsoDate(),
        ...(apiKey ? { apiKey } : {}),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new AutofillError("Cancelado.", "aborted");
    throw new AutofillError("No hay conexión con Andros. Comprueba tu Internet (o que el servidor esté en marcha).", "network");
  }

  let data: AutofillResponse | null = null;
  try {
    data = (await res.json()) as AutofillResponse;
  } catch {
    data = null;
  }
  if (!data) {
    throw new AutofillError(
      res.status === 408 || res.status === 504
        ? "El servidor tardó demasiado en responder."
        : `El servidor respondió ${res.status}. Inténtalo de nuevo.`,
      "service"
    );
  }
  if (!data.ok) {
    throw new AutofillError(
      data.issue.message,
      data.issue.code === "daily_limit" ? "quota" : data.issue.code === "network" ? "network" : "service"
    );
  }
  recordFreeQuery();
  return applyAutofill(data.sheets, data.notes, sources, refs);
}

function applyAutofill(
  results: AutofillSheetResult[],
  notes: string,
  sources: AutofillSource[],
  refs: string[]
): AutofillOutcome {
  const outcome: AutofillOutcome = { created: 0, updated: 0, filledFields: 0, reviewFields: 0, notes };
  const sourceByRef = new Map(refs.map((ref, i) => [ref, sources[i]]));
  const toCreate: { title: string; data: FormSheetPayload; group: string }[] = [];
  const existingByGroup = new Map<string, string>();

  for (const result of results) {
    const source = sourceByRef.get(result.ref);
    if (!source) continue;
    if (source.kind === "template") {
      const { title, data } = instantiateTemplate(source.template);
      const applied = applyValues(data.fields, result.values, false);
      outcome.filledFields += applied.filled;
      outcome.reviewFields += applied.review;
      const label = result.group && result.group !== "Lote" ? result.group : "";
      toCreate.push({
        title: label ? `${title} · ${label}`.slice(0, 120) : title,
        data: { ...data, fields: applied.fields, aiFilled: true, ...(label ? { batchLabel: label } : {}) },
        group: result.group,
      });
    } else {
      const nodeId = source.node.id;
      patchFormSheet(nodeId, (latest) => {
        const applied = applyValues(latest.fields, result.values, true);
        outcome.filledFields += applied.filled;
        outcome.reviewFields += applied.review;
        return {
          fields: applied.fields,
          aiFilled: true,
          ...(result.group && result.group !== "Lote" && !latest.batchLabel ? { batchLabel: result.group } : {}),
        };
      });
      outcome.updated += 1;
      if (!existingByGroup.has(result.group)) existingByGroup.set(result.group, nodeId);
    }
  }

  const newIds = insertSheetBatch(toCreate);
  outcome.created = newIds.length;

  // Una ficha que ya estaba en el lienzo se cablea con las nuevas de su mismo expediente.
  const ws = useWorkspaceStore.getState();
  const linked = new Set<string>();
  toCreate.forEach((sheet, i) => {
    const existingId = existingByGroup.get(sheet.group);
    if (!existingId || linked.has(sheet.group)) return;
    linked.add(sheet.group);
    ws.aiConnectNodes(existingId, newIds[i], sheet.group.length <= 40 ? `Expediente: ${sheet.group}` : "Mismo expediente");
  });
  return outcome;
}
