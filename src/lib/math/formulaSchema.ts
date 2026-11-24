// ============================================================================
// ANDROS — FICHAS DE FÓRMULA: ESQUEMA, PLANTILLAS INSTANTÁNEAS Y VALIDACIÓN
// Funciones puras (cliente y servidor, sin store):
//   · `createEmptyFormulaSheetPayload` y las 3 plantillas de 0 ms (sin IA).
//   · `sanitizeFormulaSheet`: valida datos externos (nube, sala en vivo,
//     Vista Invitado, .andros.zip).
//   · `sanitizeFormulaDraft`: valida lo que devuelve la IA y COMPRUEBA que la
//     expresión se pueda evaluar con `formulaEval.ts` antes de aceptarla.
// ============================================================================

import type { FormulaSheetPayload, FormulaSourceBinding, FormulaVariable } from "@/types/workspace";
import { toFieldKey } from "@/lib/forms/formSchema";
import {
  compileFormula,
  evaluateCompiled,
  formulaToLatex,
  FORMULA_IDENTIFIER,
  FORMULA_MAX_EXPRESSION_CHARS,
  FORMULA_RESERVED_NAMES,
  type FormulaScope,
} from "./formulaEval";

export const FORMULA_SHEET_CODE_TAG = "FÓRMULA";
export const FORMULA_MAX_VARIABLES = 12;
export const FORMULA_MAX_ALIASES = 12;
export const FORMULA_MAX_LATEX_CHARS = 600;
export const FORMULA_DEFAULT_DECIMALS = 2;

// ----------------------------------------------------------------------------
// Valores por defecto y plantillas instantáneas
// ----------------------------------------------------------------------------

export function createEmptyFormulaSheetPayload(): FormulaSheetPayload {
  return {
    latex: "",
    expression: "",
    resultLabel: "Resultado",
    resultUnit: "",
    resultDecimals: FORMULA_DEFAULT_DECIMALS,
    variables: [],
  };
}

export interface FormulaPreset {
  id: string;
  /** Texto del chip. */
  chip: string;
  title: string;
  data: FormulaSheetPayload;
}

const v = (
  key: string,
  label: string,
  unit: string,
  aliases: string[],
  symbolLatex = key
): FormulaVariable => ({ key, symbolLatex, label, unit, aliases, manualValue: null, sourceBinding: null });

/** Plantillas de 0 ms (sin IA): IMC, costo por persona y margen de ganancia. */
export const FORMULA_PRESETS: FormulaPreset[] = [
  {
    id: "imc",
    chip: "IMC",
    title: "Índice de Masa Corporal (IMC)",
    data: {
      latex: "\\text{IMC} = \\frac{m}{h^{2}}",
      expression: "m / h^2",
      resultLabel: "IMC",
      resultUnit: "kg/m²",
      resultDecimals: 1,
      description: "Peso entre estatura al cuadrado.",
      variables: [
        v("m", "Peso corporal", "kg", ["peso", "peso_kg", "peso_corporal", "masa", "masa_kg", "weight"]),
        v("h", "Estatura", "m", ["estatura", "estatura_m", "talla", "talla_m", "altura", "altura_m", "height"]),
      ],
    },
  },
  {
    id: "costo-persona",
    chip: "Costo por persona",
    title: "Costo por asistente",
    data: {
      latex: "C_{p} = \\frac{P}{N}",
      expression: "P / N",
      resultLabel: "Costo por persona",
      resultUnit: "USD",
      resultDecimals: 2,
      description: "Presupuesto total dividido entre el número de asistentes.",
      variables: [
        v("P", "Presupuesto total", "USD", ["presupuesto", "presupuesto_total", "total", "costo_total", "costo_estimado", "budget"]),
        v("N", "Asistentes", "personas", ["asistentes", "personas", "invitados", "participantes", "cantidad", "attendees"]),
      ],
    },
  },
  {
    id: "margen",
    chip: "Margen de ganancia",
    title: "Margen de ganancia",
    data: {
      latex: "M = \\frac{V - C}{V} \\times 100",
      expression: "(V - C) / V * 100",
      resultLabel: "Margen",
      resultUnit: "%",
      resultDecimals: 1,
      description: "Porcentaje del precio de venta que queda después del costo.",
      variables: [
        v("V", "Precio de venta", "USD", ["precio_venta", "precio", "venta", "ingreso", "ingresos", "price"]),
        v("C", "Costo", "USD", ["costo", "costo_unitario", "costo_estimado", "costo_total", "cost"]),
      ],
    },
  },
];

// ----------------------------------------------------------------------------
// Validación de datos externos
// ----------------------------------------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max: number): string => (typeof x === "string" ? x.slice(0, max) : "");
const line = (x: unknown, max: number): string => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Nombres de propiedades de los objetos de JavaScript: nunca como variable (defensa extra). */
const PROTOTYPE_NAMES = new Set(["constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString", "toLocaleString", "valueOf"]);

export function isValidVariableKey(key: string): boolean {
  return (
    FORMULA_IDENTIFIER.test(key) &&
    !FORMULA_RESERVED_NAMES.has(key) &&
    !FORMULA_RESERVED_NAMES.has(key.toLowerCase()) &&
    !PROTOTYPE_NAMES.has(key) &&
    !key.startsWith("__")
  );
}

/** Alias limpios en snake_case, sin repetir. */
export function sanitizeAliases(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.trim()) continue;
    const key = toFieldKey(item);
    if (key && key !== "campo" && !out.includes(key)) out.push(key);
    if (out.length >= FORMULA_MAX_ALIASES) break;
  }
  return out;
}

function sanitizeBinding(raw: unknown): FormulaSourceBinding | null {
  if (!isObj(raw)) return null;
  const nodeId = str(raw.nodeId, 120);
  const fieldKey = str(raw.fieldKey, 40);
  if (!nodeId || !/^[A-Za-z0-9_]{1,40}$/.test(fieldKey)) return null;
  return { nodeId, fieldKey };
}

const finiteOrNull = (x: unknown): number | null => {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim()) {
    const n = Number(x.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export function sanitizeFormulaVariable(raw: unknown): FormulaVariable | null {
  if (!isObj(raw)) return null;
  const key = line(raw.key, 32);
  if (!isValidVariableKey(key)) return null;
  const unit = line(raw.unit, 24);
  return {
    key,
    symbolLatex: line(raw.symbolLatex, 60) || key,
    label: line(raw.label, 80) || key,
    ...(unit ? { unit } : {}),
    aliases: sanitizeAliases(raw.aliases),
    manualValue: finiteOrNull(raw.manualValue),
    sourceBinding: sanitizeBinding(raw.sourceBinding),
    ...(raw.lockManual === true ? { lockManual: true } : {}),
  };
}

function sanitizeVariables(raw: unknown): FormulaVariable[] {
  const out: FormulaVariable[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const variable = sanitizeFormulaVariable(item);
    if (variable && !out.some((x) => x.key === variable.key)) out.push(variable);
    if (out.length >= FORMULA_MAX_VARIABLES) break;
  }
  return out;
}

export function clampDecimals(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(6, Math.round(n))) : FORMULA_DEFAULT_DECIMALS;
}

/** Completa y valida una Ficha de Fórmula leída de la nube, de la sala o de un archivo. */
export function sanitizeFormulaSheet(raw: unknown): FormulaSheetPayload {
  const r = isObj(raw) ? raw : {};
  const description = line(r.description, 300);
  return {
    latex: str(r.latex, FORMULA_MAX_LATEX_CHARS),
    expression: str(r.expression, FORMULA_MAX_EXPRESSION_CHARS),
    resultLabel: line(r.resultLabel, 80) || "Resultado",
    resultUnit: line(r.resultUnit, 24),
    resultDecimals: clampDecimals(r.resultDecimals ?? FORMULA_DEFAULT_DECIMALS),
    variables: sanitizeVariables(r.variables),
    ...(description ? { description } : {}),
    ...(r.aiGenerated === true ? { aiGenerated: true } : {}),
  };
}

// ----------------------------------------------------------------------------
// LaTeX de respaldo y detección de variables
// ----------------------------------------------------------------------------

/** Texto seguro dentro de `\text{…}` (sin comandos ni llaves sueltas). */
export function latexText(text: string): string {
  return text
    .replace(/\\/g, " ")
    .replace(/[{}]/g, "")
    .replace(/([#$%&_^~])/g, (m) => (m === "^" ? "\\^{}" : m === "~" ? "\\~{}" : `\\${m}`))
    .slice(0, 60);
}

/**
 * LaTeX generado a partir de la expresión (`\text{IMC} = \frac{m}{h^{2}}`).
 * Se usa cuando la persona no escribe la fórmula simbólica o la IA la manda
 * mal escrita: así la tarjeta siempre muestra algo correcto.
 */
export function latexFromExpression(data: Pick<FormulaSheetPayload, "expression" | "resultLabel" | "variables">): string {
  const compiled = compileFormula(data.expression);
  if (!compiled.ok) return "";
  const symbols = new Map(data.variables.map((x) => [x.key, x.symbolLatex || x.key]));
  const rhs = formulaToLatex(compiled.ast, (name) => symbols.get(name) ?? (name.length > 1 ? `\\text{${latexText(name)}}` : name));
  const label = data.resultLabel.trim();
  return label ? `\\text{${latexText(label)}} = ${rhs}` : rhs;
}

/** Variables nuevas para los identificadores de la expresión que aún no existen. */
export function missingVariablesFor(expression: string, variables: FormulaVariable[]): FormulaVariable[] {
  const compiled = compileFormula(expression);
  if (!compiled.ok) return [];
  const known = new Set(variables.map((x) => x.key));
  return compiled.identifiers
    .filter((id) => !known.has(id) && isValidVariableKey(id))
    .map((id) => ({
      key: id,
      symbolLatex: id,
      label: id,
      aliases: sanitizeAliases([id]),
      manualValue: null,
      sourceBinding: null,
    }));
}

// ----------------------------------------------------------------------------
// Contrato de /api/oracle/formula
// ----------------------------------------------------------------------------

export const FORMULA_MAX_DESCRIPTION_CHARS = 600;
export const FORMULA_MAX_HINT_FIELDS = 60;

/** Campo numérico del tablero que se le enseña a la IA (solo nombres, nunca valores). */
export interface FormulaFieldHint {
  fieldKey: string;
  label: string;
  unit?: string;
}

export type FormulaGenerateResponse =
  | { ok: true; title: string; data: FormulaSheetPayload; notes: string; model: string }
  | { ok: false; issue: { code: string; message: string } };

/** Valida la lista de campos que manda el cliente (solo claves, etiquetas y unidades). */
export function sanitizeFieldHints(raw: unknown): FormulaFieldHint[] {
  const out: FormulaFieldHint[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isObj(item)) continue;
    const fieldKey = line(item.fieldKey, 40);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(fieldKey) || out.some((f) => f.fieldKey === fieldKey)) continue;
    const unit = line(item.unit, 16);
    out.push({ fieldKey, label: line(item.label, 80) || fieldKey, ...(unit ? { unit } : {}) });
    if (out.length >= FORMULA_MAX_HINT_FIELDS) break;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Borrador de la IA → ficha validada (servidor)
// ----------------------------------------------------------------------------

/** Juegos de prueba: la expresión es válida si al menos uno da un número finito. */
const SAMPLE_VALUES = [
  [72, 1.7, 3, 12, 5, 9, 2.5, 40, 0.8, 15, 7, 11],
  [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
  [0.5, 0.25, 0.75, 0.6, 0.4, 0.3, 0.2, 0.9, 0.1, 0.35, 0.45, 0.55],
];

export type FormulaDraftResult =
  | { ok: true; title: string; data: FormulaSheetPayload; notes: string }
  | { ok: false; message: string };

/**
 * Valida la ficha que propone la IA: claves seguras, alias limpios, sin
 * variables sobrantes, expresión EVALUABLE con `formulaEval.ts` y LaTeX de
 * respaldo si falta. `isLatexValid` (opcional, servidor) comprueba el LaTeX
 * con KaTeX; si falla, se usa el generado desde la expresión.
 */
export function sanitizeFormulaDraft(raw: unknown, isLatexValid?: (latex: string) => boolean): FormulaDraftResult {
  if (!isObj(raw)) return { ok: false, message: "La IA no devolvió una ficha con el formato esperado." };
  const expression = line(raw.expression, FORMULA_MAX_EXPRESSION_CHARS);
  const compiled = compileFormula(expression);
  if (!compiled.ok) return { ok: false, message: `Expresión no evaluable: ${compiled.message}` };

  let variables: FormulaVariable[] = sanitizeVariables(raw.variables).map((x) => ({
    ...x,
    manualValue: null,
    sourceBinding: null,
  }));
  // Identificadores que la IA usó sin declarar: se añaden con su nombre.
  variables = [...variables, ...missingVariablesFor(expression, variables)];
  const unknown = compiled.identifiers.filter((id) => !variables.some((x) => x.key === id));
  if (unknown.length > 0) return { ok: false, message: `Variables no válidas en la expresión: ${unknown.join(", ")}` };
  // Variables declaradas que la expresión no usa: fuera.
  variables = variables.filter((x) => compiled.identifiers.includes(x.key)).slice(0, FORMULA_MAX_VARIABLES);
  if (variables.length === 0) return { ok: false, message: "La fórmula no tiene variables que calcular." };
  // Cada variable conserva al menos un alias (su etiqueta), para auto-emparejar.
  variables = variables.map((x) =>
    x.aliases.length > 0 ? x : { ...x, aliases: sanitizeAliases([x.label, x.key]) }
  );

  const evaluable = SAMPLE_VALUES.some((sample) => {
    const scope: FormulaScope = Object.create(null);
    variables.forEach((x, i) => {
      scope[x.key] = sample[i % sample.length];
    });
    return evaluateCompiled(compiled, scope).ok;
  });
  if (!evaluable) return { ok: false, message: "La expresión no da un resultado numérico con valores de prueba." };

  const base: FormulaSheetPayload = {
    latex: "",
    expression,
    resultLabel: line(raw.resultLabel, 80) || "Resultado",
    resultUnit: line(raw.resultUnit, 24),
    resultDecimals: clampDecimals(raw.resultDecimals ?? raw.decimals ?? FORMULA_DEFAULT_DECIMALS),
    variables,
    aiGenerated: true,
  };
  const description = line(raw.description, 300);
  if (description) base.description = description;

  const latex = str(raw.latex, FORMULA_MAX_LATEX_CHARS).trim();
  base.latex = latex && (!isLatexValid || isLatexValid(latex)) ? latex : latexFromExpression(base);

  return {
    ok: true,
    title: line(raw.title, 120) || base.resultLabel,
    data: base,
    notes: line(raw.notes, 240),
  };
}
