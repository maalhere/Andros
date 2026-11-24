// ============================================================================
// ANDROS — CLIENTE DE /api/oracle/formula (solo cliente)
// Cuota diaria amable (15 gratis, sin tope con clave propia), petición con
// cancelación y los NOMBRES de los campos numéricos del tablero (sin valores)
// para que la IA escriba alias que encajen solos con tus fichas.
// ============================================================================

import { getUserAiKey } from "@/store/useAiProvidersStore";
import { checkFreeQuota, recordFreeQuery } from "@/store/useAiQuotaStore";
import type { EngineeringNodeData, FormulaSheetPayload } from "@/types/workspace";
import { numericFieldsOf } from "./formulaBinding";
import {
  FORMULA_MAX_HINT_FIELDS,
  sanitizeFormulaSheet,
  type FormulaFieldHint,
  type FormulaGenerateResponse,
} from "./formulaSchema";

export class FormulaGenError extends Error {
  constructor(
    message: string,
    public code: "quota" | "network" | "service" | "aborted"
  ) {
    super(message);
  }
}

/**
 * Campos numéricos de las fichas y hojas del lienzo: solo `fieldKey`,
 * etiqueta y unidad (los valores NUNCA salen del navegador por esta vía).
 */
export function boardFieldHints(nodes: EngineeringNodeData[]): FormulaFieldHint[] {
  const out: FormulaFieldHint[] = [];
  for (const node of nodes) {
    if (node.type !== "form-sheet-node" && node.type !== "calc-latex-node") continue;
    for (const field of numericFieldsOf(node)) {
      const fieldKey = node.type === "form-sheet-node" ? field.fieldKey : field.matchKeys[0];
      if (!fieldKey || out.some((f) => f.fieldKey === fieldKey)) continue;
      out.push({ fieldKey, label: field.label.slice(0, 80), ...(field.unit ? { unit: field.unit } : {}) });
      if (out.length >= FORMULA_MAX_HINT_FIELDS) return out;
    }
  }
  return out;
}

export interface GeneratedFormula {
  title: string;
  data: FormulaSheetPayload;
  notes: string;
  model: string;
}

export async function generateFormula(
  description: string,
  nodes: EngineeringNodeData[],
  signal?: AbortSignal
): Promise<GeneratedFormula> {
  const quota = checkFreeQuota();
  if (!quota.ok) throw new FormulaGenError(quota.message, "quota");

  const apiKey = getUserAiKey("gemini");
  let res: Response;
  try {
    res = await fetch("/api/oracle/formula", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, fields: boardFieldHints(nodes), ...(apiKey ? { apiKey } : {}) }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new FormulaGenError("Cancelado.", "aborted");
    throw new FormulaGenError("No hay conexión con Andros. Comprueba tu Internet (o que el servidor esté en marcha).", "network");
  }

  let data: FormulaGenerateResponse | null = null;
  try {
    data = (await res.json()) as FormulaGenerateResponse;
  } catch {
    data = null;
  }
  if (!data) {
    throw new FormulaGenError(
      res.status === 408 || res.status === 504
        ? "El servidor tardó demasiado en responder."
        : `El servidor respondió ${res.status}. Inténtalo de nuevo.`,
      "service"
    );
  }
  if (!data.ok) {
    throw new FormulaGenError(
      data.issue.message,
      data.issue.code === "daily_limit" ? "quota" : data.issue.code === "network" ? "network" : "service"
    );
  }
  recordFreeQuery();
  // Defensa extra: lo que llega de la red se vuelve a validar en el cliente.
  return { title: data.title.slice(0, 120), data: { ...sanitizeFormulaSheet(data.data), aiGenerated: true }, notes: data.notes, model: data.model };
}
