// ============================================================================
// ANDROS — ACCIONES LOCALES DE LAS FICHAS DE FÓRMULA (solo cliente, 0 ms)
// Editar variables, enlazar campos, insertar fórmulas sin solapes y cablear
// solas las fichas del lienzo que aportan sus datos. Siempre se trabaja sobre
// la versión MÁS RECIENTE del store (otro miembro pudo cambiarla en la sala);
// `canvasSync` emite cada cambio a los demás.
// ============================================================================

import { estimateNodeHeight, useWorkspaceStore } from "@/store/useWorkspaceStore";
import { toast } from "@/store/useToastStore";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { freeSlotsForSheets } from "@/lib/forms/formActions";
import type {
  EngineeringNodeData,
  FormulaSheetEngineeringNode,
  FormulaSheetPayload,
  FormulaSourceBinding,
  FormulaVariable,
} from "@/types/workspace";
import { FORMULA_MAX_VARIABLES, FORMULA_SHEET_CODE_TAG, isValidVariableKey, sanitizeAliases } from "./formulaSchema";
import { numericFieldsOf, resolveWithSources } from "./formulaBinding";

const ws = () => useWorkspaceStore.getState();

export function getFormulaNode(nodeId: string): FormulaSheetEngineeringNode | null {
  const node = ws().nodes.find((n) => n.id === nodeId);
  return node?.type === "formula-sheet-node" ? node : null;
}

/** Aplica un cambio sobre la versión más reciente de la fórmula. */
export function patchFormulaSheet(
  nodeId: string,
  patch: (data: FormulaSheetPayload) => Partial<FormulaSheetPayload> | null
): boolean {
  const node = getFormulaNode(nodeId);
  if (!node) return false;
  const next = patch(node.formulaSheetData);
  if (!next) return false;
  ws().updateNodePayload(nodeId, next);
  return true;
}

export function updateFormulaVariable(nodeId: string, key: string, patch: Partial<FormulaVariable>): boolean {
  return patchFormulaSheet(nodeId, (data) => {
    if (!data.variables.some((v) => v.key === key)) return null;
    return { variables: data.variables.map((v) => (v.key === key ? { ...v, ...patch } : v)) };
  });
}

export type SourceChoice = "auto" | "manual" | FormulaSourceBinding;

/** Automático (alias), un campo concreto de una tarjeta conectada o «solo manual». */
export function setVariableSource(nodeId: string, key: string, choice: SourceChoice): boolean {
  if (choice === "auto") return updateFormulaVariable(nodeId, key, { sourceBinding: null, lockManual: undefined });
  if (choice === "manual") return updateFormulaVariable(nodeId, key, { sourceBinding: null, lockManual: true });
  return updateFormulaVariable(nodeId, key, { sourceBinding: choice, lockManual: undefined });
}

/**
 * Cambia la clave de una variable y la reemplaza también en la expresión
 * (palabra completa). Devuelve un mensaje de error o `null` si todo fue bien.
 */
export function renameFormulaVariable(nodeId: string, oldKey: string, newKey: string): string | null {
  const key = newKey.trim();
  if (key === oldKey) return null;
  if (!isValidVariableKey(key)) {
    return "Usa letras, números o «_», empieza por letra y evita nombres de funciones (sqrt, log…).";
  }
  let error: string | null = null;
  patchFormulaSheet(nodeId, (data) => {
    if (data.variables.some((v) => v.key === key)) {
      error = `Ya existe una variable «${key}».`;
      return null;
    }
    // Identificadores completos (y números, para no tocar «2e3»): solo cambia el que coincide.
    return {
      expression: data.expression.replace(/\d*\.?\d+(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*/g, (word) =>
        word === oldKey ? key : word
      ),
      variables: data.variables.map((v) =>
        v.key === oldKey ? { ...v, key, symbolLatex: v.symbolLatex === oldKey ? key : v.symbolLatex } : v
      ),
    };
  });
  return error;
}

export function addFormulaVariable(nodeId: string): void {
  patchFormulaSheet(nodeId, (data) => {
    if (data.variables.length >= FORMULA_MAX_VARIABLES) {
      toast({ message: `Una fórmula admite hasta ${FORMULA_MAX_VARIABLES} variables.`, tone: "error" });
      return null;
    }
    let n = data.variables.length + 1;
    let key = `x${n}`;
    while (data.variables.some((v) => v.key === key)) key = `x${++n}`;
    const variable: FormulaVariable = {
      key,
      symbolLatex: `x_{${n}}`,
      label: `Variable ${n}`,
      aliases: [],
      manualValue: null,
      sourceBinding: null,
    };
    return { variables: [...data.variables, variable] };
  });
}

export function addVariables(nodeId: string, variables: FormulaVariable[]): void {
  if (variables.length === 0) return;
  patchFormulaSheet(nodeId, (data) => ({
    variables: [...data.variables, ...variables.filter((v) => !data.variables.some((x) => x.key === v.key))].slice(
      0,
      FORMULA_MAX_VARIABLES
    ),
  }));
}

/** Quita una variable con «Deshacer» (vuelve a su posición). */
export function removeFormulaVariableWithUndo(nodeId: string, key: string): void {
  const node = getFormulaNode(nodeId);
  const index = node?.formulaSheetData.variables.findIndex((v) => v.key === key) ?? -1;
  if (!node || index === -1) return;
  const variable = node.formulaSheetData.variables[index];
  patchFormulaSheet(nodeId, (data) => ({ variables: data.variables.filter((v) => v.key !== key) }));
  toast({
    message: `Variable «${variable.label.slice(0, 40)}» quitada.`,
    action: {
      label: "Deshacer",
      onAction: () =>
        patchFormulaSheet(nodeId, (data) => {
          if (data.variables.some((v) => v.key === key)) return null;
          const variables = [...data.variables];
          variables.splice(Math.min(index, variables.length), 0, variable);
          return { variables };
        }),
    },
  });
}

export function setVariableAliases(nodeId: string, key: string, text: string): void {
  updateFormulaVariable(nodeId, key, { aliases: sanitizeAliases(text) });
}

// ----------------------------------------------------------------------------
// Insertar en el lienzo y cablear las fichas que aportan los datos
// ----------------------------------------------------------------------------

const MAX_AUTO_SOURCES = 3;

/**
 * Tarjetas del lienzo (fichas y hojas) cuyos campos encajan con las variables.
 * Si hay una tarjeta seleccionada que encaja, manda; si no, solo se elige una
 * tarjeta cuando gana sin empate (con dos pacientes iguales no se adivina).
 */
export function pickSourceNodes(
  data: FormulaSheetPayload,
  nodes: EngineeringNodeData[],
  selectedNodeId: string | null
): EngineeringNodeData[] {
  const candidates = nodes.filter((n) => n.type === "form-sheet-node" || n.type === "calc-latex-node");
  const chosen: EngineeringNodeData[] = [];
  let pending = data.variables.map((v) => v.key);

  const coverage = (node: EngineeringNodeData) => {
    const pendingData = { ...data, variables: data.variables.filter((v) => pending.includes(v.key)) };
    const resolved = resolveWithSources(pendingData, numericFieldsOf(node));
    return resolved.variables.filter((v) => v.origin === "auto").map((v) => v.variable.key);
  };

  for (let round = 0; round < MAX_AUTO_SOURCES && pending.length > 0; round += 1) {
    const scored = candidates
      .filter((n) => !chosen.includes(n))
      .map((node) => ({ node, keys: coverage(node) }))
      .filter((x) => x.keys.length > 0);
    if (scored.length === 0) break;
    const selected = scored.find((x) => x.node.id === selectedNodeId);
    let pick = selected;
    if (!pick) {
      scored.sort((a, b) => b.keys.length - a.keys.length);
      if (scored.length > 1 && scored[0].keys.length === scored[1].keys.length) break;
      pick = scored[0];
    }
    chosen.push(pick.node);
    pending = pending.filter((k) => !pick.keys.includes(k));
  }
  return chosen;
}

export interface InsertedFormula {
  id: string;
  /** Tarjetas cableadas automáticamente hacia la fórmula. */
  connectedTitles: string[];
}

/** Crea la Ficha de Fórmula sin solapar nada, la cablea con sus fuentes y la enfoca. */
export function insertFormulaNode(title: string, data: FormulaSheetPayload): InsertedFormula {
  const { nodes, selectedNodeId } = ws();
  const draft: FormulaSheetEngineeringNode = {
    id: "tmp",
    type: "formula-sheet-node",
    title,
    codeTag: FORMULA_SHEET_CODE_TAG,
    position: { x: 0, y: 0 },
    updatedAt: "Ahora mismo",
    formulaSheetData: data,
  };
  const sources = pickSourceNodes(data, nodes, selectedNodeId);
  const [position] = freeSlotsForSheets([estimateNodeHeight(draft)]);
  const id = ws().aiCreateNode({
    type: "formula-sheet-node",
    title: title.slice(0, 120) || "Fórmula",
    codeTag: FORMULA_SHEET_CODE_TAG,
    position,
    formulaSheetData: data,
  });
  for (const source of sources) ws().aiConnectNodes(source.id, id, "Datos para la fórmula");
  ws().selectNode(id);
  ws().setActiveTool("pointer");
  ws().setActiveMobileSheet("none");
  requestAnimationFrame(() => focusNodeOnScreen(id));
  return { id, connectedTitles: sources.map((s) => s.title) };
}
