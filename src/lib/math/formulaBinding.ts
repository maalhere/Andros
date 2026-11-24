// ============================================================================
// ANDROS — FILTRO DE DATOS PARA LAS FICHAS DE FÓRMULA (0 ms, $0 API)
//
// Las tarjetas conectadas a una Ficha de Fórmula le prestan sus números:
//   · Fichas (`form-sheet-node`): campos «Número» → `fieldKey` (p. ej. peso_kg).
//   · Hojas de Cálculo (`calc-latex-node`): celdas numéricas con su etiqueta
//     de la columna A (p. ej. B4 «Presupuesto total»).
//   · Otras Fichas de Fórmula (solo por cable QUE ENTRA): su resultado.
// Cada variable se resuelve así:
//   1. `sourceBinding` explícito → el valor en vivo de ese campo.
//   2. Auto-emparejado limpio por clave/alias/etiqueta (+ unidad compatible).
//   3. `manualValue` escrito a mano.
// Todo es una función pura del lienzo: el resultado no se guarda, se deriva
// en cada cliente (escritorio, móvil, sala en vivo, Vista Invitado, PDF), así
// que al cambiar `peso_kg` de 70 a 82 la fórmula se actualiza al instante.
// ============================================================================

import type {
  EngineeringNodeData,
  FormulaSheetEngineeringNode,
  FormulaSheetPayload,
  FormulaVariable,
  NodeConnection,
} from "@/types/workspace";
import { toFieldKey } from "@/lib/forms/formSchema";
import { SHEET_COLUMN_LETTERS, parseLooseNumber, sheetNumericValues } from "@/lib/canvas/sheet";
import {
  compileFormula,
  evaluateCompiled,
  formatFormulaInput,
  formatFormulaResult,
  formulaToLatex,
  type FormulaEvalResult,
  type FormulaScope,
} from "./formulaEval";
import { FORMULA_DEFAULT_DECIMALS, latexText } from "./formulaSchema";

export interface FormulaGraph {
  nodes: EngineeringNodeData[];
  connections: NodeConnection[];
}

export type NumericSourceKind = "form" | "sheet" | "formula";

/** Un número que una tarjeta conectada ofrece a la fórmula. */
export interface NumericSourceField {
  nodeId: string;
  nodeTitle: string;
  kind: NumericSourceKind;
  /** Clave del enlace: `fieldKey` de la ficha, celda («B4») o «resultado». */
  fieldKey: string;
  label: string;
  unit?: string;
  value: number | null;
  /** Claves normalizadas (snake_case) para auto-emparejar. */
  matchKeys: string[];
}

export type VariableOrigin = "binding" | "auto" | "manual" | "none";

export interface ResolvedVariable {
  variable: FormulaVariable;
  value: number | null;
  origin: VariableOrigin;
  source?: NumericSourceField;
  /** Hay un enlace explícito, pero ese campo ya no existe o su tarjeta ya no está conectada. */
  brokenBinding?: boolean;
  /** La unidad del campo origen no coincide con la de la variable. */
  unitMismatch?: boolean;
}

export interface ResolvedFormula {
  /** Campos numéricos de las tarjetas conectadas (para el selector de enlace). */
  sources: NumericSourceField[];
  /** Tarjetas conectadas que aportan al menos un número. */
  sourceNodeCount: number;
  variables: ResolvedVariable[];
  result: FormulaEvalResult;
  /** Texto claro para la persona cuando no hay resultado. */
  message: string | null;
  /** Expresión con los números sustituidos, en LaTeX (si hay todos los datos). */
  substitutionLatex: string | null;
  /** Resultado redondeado, sin unidad («26.8»). */
  resultText: string | null;
}

const MAX_SHEET_FIELDS = 48;
const MAX_CHAIN_DEPTH = 6;
/** Puntuación mínima para aceptar un auto-emparejado (solo coincidencias limpias). */
const MIN_MATCH_SCORE = 55;

const uniq = (list: string[]) => [...new Set(list.filter((x) => x && x !== "campo"))];

/** Unidad comparable: «US$», «$» y «dólares» → «usd»; «m²» → «m2». */
export function normalizeUnit(unit: string | undefined): string {
  return (unit ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .replace(/\$|us\$|dolares?|dollars?/g, "usd")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[()[\]]/g, "");
}

/** «Presupuesto total (USD)» → unidad «USD». */
function unitFromLabel(label: string): string | undefined {
  const m = /\(([^()]{1,12})\)\s*$/.exec(label.trim());
  return m ? m[1].trim() : undefined;
}

// ----------------------------------------------------------------------------
// Campos numéricos de cada tipo de tarjeta
// ----------------------------------------------------------------------------

function formFields(node: Extract<EngineeringNodeData, { type: "form-sheet-node" }>): NumericSourceField[] {
  const fields = Array.isArray(node.formSheetData.fields) ? node.formSheetData.fields : [];
  return fields
    .filter((f) => f.type === "number")
    .map((f) => {
      const unitKey = toFieldKey(f.unit ?? "");
      const stripped =
        f.unit && f.fieldKey.endsWith(`_${unitKey}`) ? f.fieldKey.slice(0, -(unitKey.length + 1)) : "";
      return {
        nodeId: node.id,
        nodeTitle: node.title,
        kind: "form" as const,
        fieldKey: f.fieldKey,
        label: f.label,
        ...(f.unit ? { unit: f.unit } : {}),
        value: typeof f.value === "number" && Number.isFinite(f.value) ? f.value : null,
        matchKeys: uniq([f.fieldKey, toFieldKey(f.label), stripped]),
      };
    });
}

function sheetFields(node: Extract<EngineeringNodeData, { type: "calc-latex-node" }>): NumericSourceField[] {
  const cells = node.calcLatexData.gridCells ?? {};
  const values = sheetNumericValues(cells);
  const rawAt = (address: string) => (typeof cells[address]?.raw === "string" ? cells[address].raw.trim() : "");
  const isText = (text: string) => text !== "" && !text.startsWith("=") && parseLooseNumber(text) === null;

  const byRow = new Map<number, string[]>();
  for (const address of Object.keys(values)) {
    const m = /^([A-Z]{1,2})(\d{1,3})$/.exec(address);
    if (!m || m[1] === "A") continue;
    const row = Number(m[2]);
    const list = byRow.get(row);
    if (list) list.push(address);
    else byRow.set(row, [address]);
  }

  const out: NumericSourceField[] = [];
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const label = rawAt(`A${row}`);
    const labelKey = isText(label) ? toFieldKey(label) : "";
    const addresses = byRow
      .get(row)!
      .sort((a, b) => SHEET_COLUMN_LETTERS.indexOf(a.replace(/\d+/, "")) - SHEET_COLUMN_LETTERS.indexOf(b.replace(/\d+/, "")));
    addresses.forEach((address, index) => {
      const letter = address.replace(/\d+/, "");
      const header = row > 1 ? rawAt(`${letter}1`) : "";
      const headerKey = isText(header) ? toFieldKey(header) : "";
      const keys: string[] = [];
      if (labelKey && index === 0) keys.push(labelKey);
      if (labelKey && headerKey) keys.push(`${labelKey}_${headerKey}`);
      const unit = (labelKey ? unitFromLabel(label) : undefined) ?? (headerKey ? unitFromLabel(header) : undefined);
      // «Presupuesto total (USD)» también se ofrece como `presupuesto_total`.
      const unitKey = unit ? toFieldKey(unit) : "";
      if (labelKey && index === 0 && unitKey && labelKey.endsWith(`_${unitKey}`)) {
        keys.push(labelKey.slice(0, -(unitKey.length + 1)));
      }
      out.push({
        nodeId: node.id,
        nodeTitle: node.title,
        kind: "sheet",
        fieldKey: address,
        label: labelKey ? (index === 0 ? label : `${label} · ${headerKey ? header : letter}`) : `Celda ${address}`,
        ...(unit ? { unit } : {}),
        value: values[address],
        matchKeys: uniq(keys),
      });
    });
    if (out.length >= MAX_SHEET_FIELDS) break;
  }
  return out.slice(0, MAX_SHEET_FIELDS);
}

/** Números que una tarjeta puede prestar (vacío si no es ficha, hoja ni fórmula). */
export function numericFieldsOf(
  node: EngineeringNodeData,
  graph?: FormulaGraph,
  visiting: Set<string> = new Set()
): NumericSourceField[] {
  if (node.type === "form-sheet-node") return formFields(node);
  if (node.type === "calc-latex-node") return sheetFields(node);
  if (node.type === "formula-sheet-node") {
    const data = node.formulaSheetData;
    const value =
      graph && !visiting.has(node.id) && visiting.size < MAX_CHAIN_DEPTH
        ? resolveInternal(node, graph, visiting).result
        : null;
    return [
      {
        nodeId: node.id,
        nodeTitle: node.title,
        kind: "formula",
        fieldKey: "resultado",
        label: data.resultLabel || node.title,
        ...(data.resultUnit ? { unit: data.resultUnit } : {}),
        value: value && value.ok ? value.value : null,
        matchKeys: uniq([toFieldKey(data.resultLabel || ""), toFieldKey(node.title)]),
      },
    ];
  }
  return [];
}

/**
 * Tarjetas que alimentan a la fórmula: todas las que llegan por un cable QUE
 * ENTRA y, por comodidad, también fichas y hojas unidas con el cable al revés
 * (nunca otra fórmula aguas abajo, para no crear ciclos).
 */
export function formulaSourceNodes(graph: FormulaGraph, formulaId: string): EngineeringNodeData[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming: EngineeringNodeData[] = [];
  const reversed: EngineeringNodeData[] = [];
  const seen = new Set<string>([formulaId]);
  for (const c of graph.connections) {
    if (c.toNodeId === formulaId && !seen.has(c.fromNodeId)) {
      const n = byId.get(c.fromNodeId);
      if (n) {
        seen.add(n.id);
        incoming.push(n);
      }
    }
  }
  for (const c of graph.connections) {
    if (c.fromNodeId === formulaId && !seen.has(c.toNodeId)) {
      const n = byId.get(c.toNodeId);
      if (n && (n.type === "form-sheet-node" || n.type === "calc-latex-node")) {
        seen.add(n.id);
        reversed.push(n);
      }
    }
  }
  return [...incoming, ...reversed];
}

// ----------------------------------------------------------------------------
// Auto-emparejado
// ----------------------------------------------------------------------------

function wantedKeys(variable: FormulaVariable): { key: string; weight: number }[] {
  const out: { key: string; weight: number }[] = [];
  const push = (key: string, weight: number) => {
    if (key && key !== "campo" && !out.some((x) => x.key === key)) out.push({ key, weight });
  };
  // La clave (`m`, `h`) solo empareja si es igual; los alias y la etiqueta son la vía principal.
  push(toFieldKey(variable.key), 100);
  for (const alias of variable.aliases) push(alias, 100);
  push(toFieldKey(variable.label), 90);
  return out;
}

const tokensOf = (key: string) => key.split("_").filter(Boolean);

/** Puntuación de un campo para una variable (0 = no encaja). */
export function matchScore(variable: FormulaVariable, field: NumericSourceField): number {
  let best = 0;
  for (const { key, weight } of wantedKeys(variable)) {
    for (const candidate of field.matchKeys) {
      if (candidate === key) {
        best = Math.max(best, weight);
        continue;
      }
      // «presupuesto» ⊂ «presupuesto_evento»: todas las palabras del alias están en el campo.
      const want = tokensOf(key);
      const have = new Set(tokensOf(candidate));
      const meaningful = want.length >= 2 || (want.length === 1 && want[0].length >= 4);
      if (meaningful && want.every((t) => have.has(t))) best = Math.max(best, weight - 40);
    }
  }
  if (best === 0) return 0;
  const a = normalizeUnit(variable.unit);
  const b = normalizeUnit(field.unit);
  if (a && b) best += a === b ? 5 : -40;
  return best;
}

// ----------------------------------------------------------------------------
// Resolución
// ----------------------------------------------------------------------------

const describeVariable = (v: FormulaVariable) => `${v.label || v.key}${v.unit ? ` (${v.unit})` : ""}`;

function unitsDiffer(variable: FormulaVariable, field: NumericSourceField | undefined): boolean {
  const a = normalizeUnit(variable.unit);
  const b = normalizeUnit(field?.unit);
  return Boolean(a && b && a !== b);
}

function resolveInternal(
  node: FormulaSheetEngineeringNode,
  graph: FormulaGraph,
  visiting: Set<string>
): ResolvedFormula {
  const data = node.formulaSheetData;
  const nextVisiting = new Set(visiting).add(node.id);
  const sourceNodes = formulaSourceNodes(graph, node.id).filter((n) => !nextVisiting.has(n.id));
  const sources = sourceNodes.flatMap((n) => numericFieldsOf(n, graph, nextVisiting));
  return resolveWithSources(data, sources);
}

/** Resuelve variables, evalúa y prepara la sustitución numérica. */
export function resolveWithSources(data: FormulaSheetPayload, sources: NumericSourceField[]): ResolvedFormula {
  const variables = Array.isArray(data.variables) ? data.variables : [];
  const resolved: ResolvedVariable[] = variables.map((variable) => ({ variable, value: null, origin: "none" }));
  const used = new Set<string>();
  const fieldId = (f: NumericSourceField) => `${f.nodeId}::${f.fieldKey}`;

  // 1. Enlaces explícitos.
  resolved.forEach((entry) => {
    const binding = entry.variable.sourceBinding;
    if (!binding || entry.variable.lockManual) return;
    const field = sources.find((f) => f.nodeId === binding.nodeId && f.fieldKey === binding.fieldKey);
    if (!field) {
      entry.brokenBinding = true;
      return;
    }
    used.add(fieldId(field));
    entry.origin = "binding";
    entry.source = field;
    entry.value = field.value;
    entry.unitMismatch = unitsDiffer(entry.variable, field);
  });

  // 2. Auto-emparejado: las parejas con mejor puntuación primero; cada campo se usa una vez.
  const candidates: { i: number; field: NumericSourceField; score: number; order: number }[] = [];
  resolved.forEach((entry, i) => {
    if (entry.origin !== "none" || entry.variable.lockManual) return;
    sources.forEach((field, order) => {
      if (used.has(fieldId(field))) return;
      const score = matchScore(entry.variable, field);
      if (score >= MIN_MATCH_SCORE) candidates.push({ i, field, score, order });
    });
  });
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.field.value !== null) - Number(a.field.value !== null) ||
      a.order - b.order
  );
  for (const c of candidates) {
    const entry = resolved[c.i];
    if (entry.origin !== "none" || used.has(fieldId(c.field))) continue;
    used.add(fieldId(c.field));
    entry.origin = "auto";
    entry.source = c.field;
    entry.value = c.field.value;
    entry.unitMismatch = unitsDiffer(entry.variable, c.field);
  }

  // 3. Valor manual (si la ficha conectada no trae el dato, o no hay ficha).
  for (const entry of resolved) {
    const manual = entry.variable.manualValue;
    const hasManual = typeof manual === "number" && Number.isFinite(manual);
    if (entry.origin === "none" && hasManual) {
      entry.origin = "manual";
      entry.value = manual;
    } else if ((entry.origin === "auto" || entry.origin === "binding") && entry.value === null && hasManual) {
      // Campo enlazado todavía vacío: se usa el número escrito a mano, pero se muestra el origen.
      entry.value = manual;
    }
  }

  const sourceNodeCount = new Set(sources.map((s) => s.nodeId)).size;
  const base = { sources, sourceNodeCount, variables: resolved };

  const compiled = compileFormula(data.expression);
  if (!compiled.ok) {
    return {
      ...base,
      result: compiled,
      message: compiled.code === "empty" ? "Escribe la expresión a calcular." : `La expresión no es válida: ${compiled.message}`,
      substitutionLatex: null,
      resultText: null,
    };
  }

  const scope: FormulaScope = Object.create(null);
  for (const entry of resolved) scope[entry.variable.key] = entry.value;
  const result = evaluateCompiled(compiled, scope);

  let message: string | null = null;
  if (!result.ok) {
    if (result.code === "missing") {
      const names = (result.missing ?? []).map((key) => {
        const variable = variables.find((x) => x.key === key);
        return variable ? describeVariable(variable) : `${key} (variable sin definir)`;
      });
      message = `Faltan datos: ${names.join(", ")}`;
    } else if (result.code === "division-by-zero") {
      message = "División entre cero: algún divisor vale 0. Revisa los datos.";
    } else {
      message = result.message;
    }
  }

  const allKnown = compiled.identifiers.every((id) => {
    const value = scope[id];
    return typeof value === "number" && Number.isFinite(value);
  });
  const substitutionLatex = allKnown
    ? formulaToLatex(compiled.ast, (name) => {
        const value = scope[name] as number;
        const text = formatFormulaInput(value);
        return value < 0 ? `\\left(${text}\\right)` : text;
      })
    : null;

  return {
    ...base,
    result,
    message,
    substitutionLatex,
    resultText: result.ok ? formatFormulaResult(result.value, data.resultDecimals ?? FORMULA_DEFAULT_DECIMALS) : null,
  };
}

/** Resuelve una Ficha de Fórmula con el lienzo actual (fichas conectadas + valores manuales). */
export function resolveFormula(node: FormulaSheetEngineeringNode, graph: FormulaGraph): ResolvedFormula {
  return resolveInternal(node, graph, new Set());
}

/** Sin lienzo (p. ej. una tarjeta suelta): solo cuentan los valores manuales. */
export function resolveFormulaStandalone(data: FormulaSheetPayload): ResolvedFormula {
  return resolveWithSources(data, []);
}

/**
 * Huella corta de lo que se ve en la tarjeta. Sirve como selector estable de
 * Zustand: la tarjeta solo se repinta si cambia un dato que la afecta (no al
 * arrastrar otras tarjetas).
 */
export function formulaSignature(resolved: ResolvedFormula): string {
  return JSON.stringify([
    resolved.variables.map((v) => [v.value, v.origin, v.source ? `${v.source.nodeId}:${v.source.fieldKey}:${v.source.nodeTitle}` : "", v.brokenBinding ? 1 : 0]),
    resolved.sources.map((s) => `${s.nodeId}:${s.fieldKey}:${s.label}:${s.value}:${s.unit ?? ""}:${s.nodeTitle}`),
    resolved.resultText,
    resolved.message,
  ]);
}

// ----------------------------------------------------------------------------
// Texto para el Oráculo, el Motor Anti-Malentendidos y la exportación
// ----------------------------------------------------------------------------

/** «← Historial Clínico · peso_kg», «Manual» o «Sin dato». */
export function originLabel(entry: ResolvedVariable): string {
  if ((entry.origin === "binding" || entry.origin === "auto") && entry.source) {
    return `← ${entry.source.nodeTitle} · ${entry.source.fieldKey}${entry.source.value === null && entry.value !== null ? " (vacío, se usa el manual)" : ""}`;
  }
  if (entry.origin === "manual") return "Manual";
  return "Sin dato";
}

export function formatVariableValue(entry: ResolvedVariable): string {
  if (entry.value === null) return "—";
  const unit = entry.variable.unit ? ` ${entry.variable.unit}` : "";
  return `${formatFormulaInput(entry.value)}${unit}`;
}

/** Resultado con unidad («26.8 kg/m²») o el motivo por el que no hay resultado. */
export function formulaResultLine(data: FormulaSheetPayload, resolved: ResolvedFormula): string {
  if (resolved.resultText !== null) return `${resolved.resultText}${data.resultUnit ? ` ${data.resultUnit}` : ""}`;
  return resolved.message ?? "Sin resultado";
}

/** LaTeX de la expresión con símbolos (respaldo cuando la ficha no trae su propio LaTeX). */
export function expressionLatex(data: FormulaSheetPayload): string {
  const compiled = compileFormula(data.expression);
  if (!compiled.ok) return "";
  const symbols = new Map(data.variables.map((x) => [x.key, x.symbolLatex || x.key]));
  return formulaToLatex(compiled.ast, (name) => symbols.get(name) ?? (name.length > 1 ? `\\text{${latexText(name)}}` : name));
}

/**
 * Contenido de la Ficha de Fórmula para la IA: título, LaTeX, expresión,
 * variables con su valor inyectado y origen, y el resultado final calculado.
 */
export function serializeFormulaSheet(node: FormulaSheetEngineeringNode, graph?: FormulaGraph): string {
  const data = node.formulaSheetData;
  const resolved = graph ? resolveFormula(node, graph) : resolveFormulaStandalone(data);
  const lines = [`Ficha de fórmula «${node.title}»`];
  if (data.description) lines.push(`Para qué sirve: ${data.description}`);
  if (data.latex) lines.push(`Fórmula (LaTeX): ${data.latex}`);
  lines.push(`Expresión evaluada: ${data.expression || "(vacía)"}`);
  if (resolved.variables.length > 0) {
    lines.push("Variables:");
    for (const entry of resolved.variables) {
      lines.push(`- ${entry.variable.label} (${entry.variable.key}) = ${formatVariableValue(entry)} · origen: ${originLabel(entry)}`);
    }
  }
  if (resolved.substitutionLatex) lines.push(`Sustitución: ${resolved.substitutionLatex}`);
  lines.push(
    resolved.resultText !== null
      ? `Resultado calculado: ${data.resultLabel} = ${formulaResultLine(data, resolved)}`
      : `Sin resultado: ${resolved.message ?? "faltan datos"}`
  );
  if (!graph) lines.push("(Valores de fichas conectadas no disponibles en este contexto)");
  return lines.join("\n");
}
