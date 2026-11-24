// ============================================================================
// ANDROS — VERIFICACIÓN RÁPIDA DE LAS FICHAS DE FÓRMULA (sin dependencias)
// Ejecuta: npm run verify:formulas
// Comprueba el evaluador seguro (operadores, funciones, casos borde, intentos
// de inyección) y el filtro de datos: al cambiar `peso_kg` en una ficha
// conectada, la fórmula se recalcula; enlaces explícitos, auto-emparejado,
// valor manual, hojas de cálculo, cadenas de fórmulas y ciclos.
// ============================================================================

import { compileFormula, evaluateFormula, formatFormulaResult } from "@/lib/math/formulaEval";
import { resolveFormula, serializeFormulaSheet, type FormulaGraph } from "@/lib/math/formulaBinding";
import { FORMULA_PRESETS, sanitizeFormulaDraft, sanitizeFormulaSheet } from "@/lib/math/formulaSchema";
import type {
  CalcLatexEngineeringNode,
  EngineeringNodeData,
  FormSheetEngineeringNode,
  FormulaSheetEngineeringNode,
  FormulaSheetPayload,
  NodeConnection,
} from "@/types/workspace";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  }
}

const near = (a: number | undefined, b: number, eps = 1e-9) => typeof a === "number" && Math.abs(a - b) <= eps;
const valueOf = (expr: string, scope: Record<string, number | null> = {}) => {
  const r = evaluateFormula(expr, scope);
  return r.ok ? r.value : undefined;
};

// ----------------------------------------------------------------------------
console.log("\n1) Evaluador seguro");
check("precedencia 2 + 3 * 4 = 14", valueOf("2 + 3 * 4") === 14);
check("paréntesis (2 + 3) * 4 = 20", valueOf("(2 + 3) * 4") === 20);
check("potencia asociativa a la derecha 2^3^2 = 512", valueOf("2^3^2") === 512);
check("menos unario -2^2 = -4", valueOf("-2^2") === -4);
check("operadores tipográficos 6 × 2 ÷ 4 − 1 = 2", valueOf("6 × 2 ÷ 4 − 1") === 2);
check("sqrt, abs, round, min, max", valueOf("sqrt(16) + abs(-2) + round(2.456, 2) + min(3, 1, 2) + max(1, 9)") === 4 + 2 + 2.46 + 1 + 9);
check("log (base 10), ln, exp", near(valueOf("log(1000) + ln(exp(2))"), 5));
check("sin, cos, tan y pi", near(valueOf("sin(pi / 2) + cos(0) + tan(0)"), 2));
check("pi() y π", near(valueOf("pi() + π"), 2 * Math.PI));
check("IMC m / h^2 con m=82, h=1.75", near(valueOf("m / h^2", { m: 82, h: 1.75 }), 82 / 1.75 ** 2));

const div = evaluateFormula("a / b", { a: 1, b: 0 });
check("división entre cero → error claro, sin lanzar", !div.ok && div.code === "division-by-zero", div);
const miss = evaluateFormula("m / h^2", { m: 70 });
check("variable faltante → «Faltan datos: h»", !miss.ok && miss.code === "missing" && miss.missing?.join() === "h", miss);
const nan = evaluateFormula("sqrt(x)", { x: -4 });
check("raíz de negativo → error de dominio (no NaN)", !nan.ok && nan.code === "domain", nan);
const nanIn = evaluateFormula("x + 1", { x: Number.NaN });
check("NaN en una variable cuenta como dato faltante", !nanIn.ok && nanIn.code === "missing", nanIn);
const overflow = evaluateFormula("10^400", {});
check("desbordamiento → error claro", !overflow.ok && (overflow.code === "overflow" || overflow.code === "syntax"), overflow);

const injections = [
  "constructor.constructor('return process')()",
  "process.exit(1)",
  "this",
  "globalThis.alert(1)",
  "__proto__",
  "toString()",
  "a; b",
  "`x`",
  "require('fs')",
  "eval('1')",
  "Function('return 1')()",
  "[1,2].map(x => x)",
  "a = 2",
  "1 +",
  "((((1)))",
  "(".repeat(200) + "1" + ")".repeat(200),
  "x".repeat(500),
];
for (const attempt of injections) {
  const r = evaluateFormula(attempt, { a: 1, b: 2, x: 3 });
  check(`inyección/malformada rechazada: ${attempt.slice(0, 40)}`, !r.ok, r);
}
check("variables con nombre de propiedad del prototipo no se resuelven", !evaluateFormula("toString", {}).ok);
check("compileFormula lista identificadores en orden", (() => {
  const c = compileFormula("P / N + P");
  return c.ok && c.identifiers.join() === "P,N";
})());
check("formatFormulaResult redondea y agrupa miles", formatFormulaResult(12345.678, 2) === "12 345.68", formatFormulaResult(12345.678, 2));

// ----------------------------------------------------------------------------
console.log("\n2) Filtro de datos y reactividad (0 ms, sin IA)");

const imc = FORMULA_PRESETS.find((p) => p.id === "imc")!;
const formula = (id: string, data: FormulaSheetPayload, title = "IMC"): FormulaSheetEngineeringNode => ({
  id,
  type: "formula-sheet-node",
  title,
  codeTag: "FÓRMULA",
  position: { x: 0, y: 0 },
  updatedAt: "",
  formulaSheetData: structuredClone(data),
});
const historial = (peso: number | null, estatura: number | null = null): FormSheetEngineeringNode => ({
  id: "hc",
  type: "form-sheet-node",
  title: "Historial Clínico",
  codeTag: "FICHA",
  position: { x: 0, y: 0 },
  updatedAt: "",
  formSheetData: {
    templateId: "tpl-historial-clinico",
    category: "Salud",
    attachments: [],
    fields: [
      { id: "f1", fieldKey: "paciente", label: "Paciente", type: "text", value: "Ejemplo" },
      { id: "f2", fieldKey: "peso_kg", label: "Peso", type: "number", value: peso, unit: "kg" },
      { id: "f3", fieldKey: "estatura_m", label: "Estatura", type: "number", value: estatura, unit: "m" },
      { id: "f4", fieldKey: "edad", label: "Edad", type: "number", value: 34, unit: "años" },
    ],
  },
});
const edge = (from: string, to: string, id = `${from}-${to}`): NodeConnection => ({
  id,
  fromNodeId: from,
  toNodeId: to,
  fromPort: "right",
  toPort: "left",
});
const graphOf = (nodes: EngineeringNodeData[], connections: NodeConnection[]): FormulaGraph => ({ nodes, connections });

const f = formula("fx", imc.data);
let g = graphOf([historial(70, 1.75), f], [edge("hc", "fx")]);
let r = resolveFormula(f, g);
check("auto-empareja peso_kg → m y estatura_m → h", r.variables.every((v) => v.origin === "auto"), r.variables.map((v) => [v.variable.key, v.origin, v.source?.fieldKey]));
check("IMC con 70 kg / 1.75 m = 22.9", r.resultText === "22.9", r.resultText);

// La persona edita la ficha conectada: 70 → 82 kg. Mismo nodo de fórmula, solo cambia el lienzo.
g = graphOf([historial(82, 1.75), f], [edge("hc", "fx")]);
r = resolveFormula(f, g);
check("al cambiar peso_kg 70 → 82 la fórmula se recalcula (26.8)", r.resultText === "26.8", r.resultText);
check("sustitución numérica en LaTeX", r.substitutionLatex === "\\frac{82}{{1.75}^{2}}", r.substitutionLatex);

g = graphOf([historial(82, null), f], [edge("hc", "fx")]);
r = resolveFormula(f, g);
check("campo conectado vacío → «Faltan datos: Estatura (m)»", r.message === "Faltan datos: Estatura (m)", r.message);

const withManual = formula("fx", {
  ...imc.data,
  variables: imc.data.variables.map((v) => (v.key === "h" ? { ...v, manualValue: 1.8 } : v)),
});
r = resolveFormula(withManual, graphOf([historial(81, null), withManual], [edge("hc", "fx")]));
check("si la ficha no trae el dato se usa el valor manual (81 / 1.8² = 25)", r.resultText === "25", r.resultText);

const explicit = formula("fx", {
  ...imc.data,
  variables: imc.data.variables.map((v) => (v.key === "m" ? { ...v, sourceBinding: { nodeId: "hc", fieldKey: "edad" } } : v)),
});
r = resolveFormula(explicit, graphOf([historial(82, 2), explicit], [edge("hc", "fx")]));
check("enlace explícito manda sobre el auto-emparejado (m ← edad = 34)", r.variables[0].origin === "binding" && r.variables[0].value === 34, r.variables[0]);

r = resolveFormula(explicit, graphOf([historial(82, 2), explicit], []));
check("sin cable: el enlace queda roto y no se leen datos", r.variables[0].brokenBinding === true && r.variables[1].origin === "none", r.variables);

r = resolveFormula(f, graphOf([historial(82, 1.75), f], [edge("fx", "hc")]));
check("cable al revés (fórmula → ficha) también presta los datos", r.resultText === "26.8", r.resultText);

const locked = formula("fx", {
  ...imc.data,
  variables: imc.data.variables.map((v) => ({ ...v, lockManual: true, manualValue: v.key === "m" ? 50 : 2 })),
});
r = resolveFormula(locked, graphOf([historial(82, 1.75), locked], [edge("hc", "fx")]));
check("«Solo manual» ignora la ficha conectada (50 / 2² = 12.5)", r.resultText === "12.5", r.resultText);

const zero = formula("fx", imc.data);
r = resolveFormula(zero, graphOf([historial(82, 0), zero], [edge("hc", "fx")]));
check("estatura 0 → mensaje de división entre cero, sin romper", r.result.ok === false && /División entre cero/.test(r.message ?? ""), r.message);

// Hoja de cálculo: presupuesto con fila Total y asistentes.
const costo = FORMULA_PRESETS.find((p) => p.id === "costo-persona")!;
const sheet: CalcLatexEngineeringNode = {
  id: "calc",
  type: "calc-latex-node",
  title: "Presupuesto",
  codeTag: "CALC",
  position: { x: 0, y: 0 },
  updatedAt: "",
  calcLatexData: {
    justificationText: "",
    latexEquations: [],
    gridSize: { rows: 6, columns: 2 },
    gridCells: {
      A1: { raw: "Partida", computed: "Partida" },
      B1: { raw: "Monto", computed: "Monto" },
      A2: { raw: "Salón", computed: "Salón" },
      B2: { raw: "1200", computed: "1.200" },
      A3: { raw: "Comida", computed: "Comida" },
      B3: { raw: "800.5", computed: "800,5" },
      A4: { raw: "Total", computed: "Total" },
      B4: { raw: "=SUM(B2:B3)", computed: "2.000,5" },
      A5: { raw: "Asistentes", computed: "Asistentes" },
      B5: { raw: "40", computed: "40" },
    },
  },
};
const fc = formula("fc", costo.data, "Costo por persona");
r = resolveFormula(fc, graphOf([sheet, fc], [edge("calc", "fc")]));
check("hoja: P ← Total (B4 = 2000.5) y N ← Asistentes (B5)", r.variables[0].source?.fieldKey === "B4" && r.variables[1].source?.fieldKey === "B5", r.variables.map((v) => v.source?.fieldKey));
check("costo por persona = 50.01 (valor exacto, no el redondeado de la celda)", r.resultText === "50.01", r.resultText);

// Cadena de fórmulas y ciclo.
const doble = formula("f2", {
  latex: "",
  expression: "x * 2",
  resultLabel: "Doble",
  resultUnit: "",
  variables: [{ key: "x", symbolLatex: "x", label: "IMC", aliases: ["imc"], manualValue: null, sourceBinding: null }],
}, "Doble del IMC");
r = resolveFormula(doble, graphOf([historial(82, 1.75), f, doble], [edge("hc", "fx"), edge("fx", "f2")]));
check("cadena: otra fórmula toma el resultado del IMC (26.775… × 2)", r.resultText === "53.55", r.resultText);
r = resolveFormula(doble, graphOf([historial(82, 1.75), f, doble], [edge("hc", "fx"), edge("fx", "f2"), edge("f2", "fx", "back")]));
check("ciclo A → B → A no se cuelga", typeof r.message === "string" || r.resultText !== null);

const text = serializeFormulaSheet(f, graphOf([historial(82, 1.75), f], [edge("hc", "fx")]));
check("el Oráculo lee variables y resultado", /Resultado calculado: IMC = 26\.8 kg\/m²/.test(text) && /peso_kg/.test(text), text);

// ----------------------------------------------------------------------------
console.log("\n3) Validación de datos externos y borradores de la IA");
const dirty = sanitizeFormulaSheet({
  expression: "m / h^2",
  variables: [
    { key: "m", label: "Peso", aliases: ["Peso (kg)", "peso", 3] },
    { key: "constructor", label: "x" },
    { key: "sqrt", label: "x" },
    { key: "m", label: "duplicada" },
    { key: "1abc", label: "x" },
  ],
  resultDecimals: 99,
});
check("sanitize: descarta claves reservadas, duplicadas o inválidas", dirty.variables.map((v) => v.key).join() === "m", dirty.variables.map((v) => v.key));
check("sanitize: alias en snake_case", dirty.variables[0].aliases.join() === "peso_kg,peso", dirty.variables[0].aliases);
check("sanitize: decimales acotados a 6", dirty.resultDecimals === 6);

const draft = sanitizeFormulaDraft({
  title: "Dosis pediátrica",
  latex: "D = p \\cdot d",
  expression: "p * d",
  resultLabel: "Dosis",
  resultUnit: "mg",
  variables: [
    { key: "p", symbolLatex: "p", label: "Peso", unit: "kg", aliases: ["peso", "peso_kg"] },
    { key: "d", symbolLatex: "d", label: "Dosis por kilo", unit: "mg/kg", aliases: ["dosis_por_kg"] },
    { key: "z", label: "sobrante" },
  ],
});
check("borrador IA válido: quita variables que la expresión no usa", draft.ok && draft.data.variables.map((v) => v.key).join() === "p,d", draft);
const bad = sanitizeFormulaDraft({ expression: "alert(1)", variables: [] });
check("borrador IA con expresión no evaluable → rechazado", !bad.ok, bad);
const noLatex = sanitizeFormulaDraft({ expression: "a / b", resultLabel: "Esfuerzo", variables: [{ key: "a" }, { key: "b" }] }, () => false);
check("LaTeX inválido → se genera desde la expresión", noLatex.ok && noLatex.data.latex === "\\text{Esfuerzo} = \\frac{a}{b}", noLatex.ok ? noLatex.data.latex : noLatex);

console.log(`\n${passed} correctas · ${failed} fallidas\n`);
if (failed > 0) process.exit(1);
