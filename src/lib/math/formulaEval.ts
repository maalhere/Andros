// ============================================================================
// ANDROS — EVALUADOR MATEMÁTICO SEGURO DE LAS FICHAS DE FÓRMULA
//
// Analizador recursivo descendente propio: texto → tokens → árbol (AST) →
// número. ESTRICTAMENTE sin `eval`, `new Function` ni acceso a propiedades:
// solo números, variables declaradas, + − × ÷ ^, paréntesis y una lista
// cerrada de funciones. Topes de longitud, de tokens y de profundidad para
// que una expresión maliciosa o enorme no bloquee el navegador ni el servidor.
// Funciones puras: sirven en el cliente (0 ms) y en `/api/oracle/formula`.
//
//   compileFormula("m / (h ^ 2)")          → { ok, ast, identifiers: ["m","h"] }
//   evaluateFormula("m / h^2", { m, h })   → { ok: true, value } | error claro
//   formulaToLatex(ast, { m: "82" })       → "\frac{82}{1.75^{2}}"
// ============================================================================

export const FORMULA_MAX_EXPRESSION_CHARS = 400;
const MAX_TOKENS = 300;
const MAX_DEPTH = 48;
const MAX_ARGS = 16;
/** Identificador seguro: letra o «_» inicial, luego letras, dígitos o «_». */
export const FORMULA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

// ----------------------------------------------------------------------------
// Funciones y constantes permitidas (objetos sin prototipo: nada de
// `constructor`, `__proto__` ni `toString` como «función»)
// ----------------------------------------------------------------------------

interface FunctionSpec {
  min: number;
  max: number;
  run: (args: number[]) => number;
  /** Cómo se escribe en LaTeX (los argumentos ya vienen en LaTeX). */
  latex: (args: string[]) => string;
}

const FUNCTIONS: Record<string, FunctionSpec> = Object.assign(Object.create(null) as Record<string, FunctionSpec>, {
  sqrt: { min: 1, max: 1, run: ([x]: number[]) => Math.sqrt(x), latex: ([x]: string[]) => `\\sqrt{${x}}` },
  abs: { min: 1, max: 1, run: ([x]: number[]) => Math.abs(x), latex: ([x]: string[]) => `\\left|${x}\\right|` },
  round: {
    min: 1,
    max: 2,
    run: ([x, digits = 0]: number[]) => {
      const d = Math.max(0, Math.min(10, Math.trunc(digits)));
      const f = 10 ** d;
      return Math.round(x * f) / f;
    },
    latex: (args: string[]) => `\\operatorname{round}\\left(${args.join(", ")}\\right)`,
  },
  floor: { min: 1, max: 1, run: ([x]: number[]) => Math.floor(x), latex: ([x]: string[]) => `\\lfloor ${x} \\rfloor` },
  ceil: { min: 1, max: 1, run: ([x]: number[]) => Math.ceil(x), latex: ([x]: string[]) => `\\lceil ${x} \\rceil` },
  min: { min: 1, max: MAX_ARGS, run: (a: number[]) => Math.min(...a), latex: (a: string[]) => `\\min\\left(${a.join(", ")}\\right)` },
  max: { min: 1, max: MAX_ARGS, run: (a: number[]) => Math.max(...a), latex: (a: string[]) => `\\max\\left(${a.join(", ")}\\right)` },
  /** log(x) = log₁₀(x); log(x, b) = logaritmo en base b. */
  log: {
    min: 1,
    max: 2,
    run: ([x, base]: number[]) => (base === undefined ? Math.log10(x) : Math.log(x) / Math.log(base)),
    latex: ([x, b]: string[]) => (b === undefined ? `\\log_{10}\\left(${x}\\right)` : `\\log_{${b}}\\left(${x}\\right)`),
  },
  ln: { min: 1, max: 1, run: ([x]: number[]) => Math.log(x), latex: ([x]: string[]) => `\\ln\\left(${x}\\right)` },
  exp: { min: 1, max: 1, run: ([x]: number[]) => Math.exp(x), latex: ([x]: string[]) => `e^{${x}}` },
  sin: { min: 1, max: 1, run: ([x]: number[]) => Math.sin(x), latex: ([x]: string[]) => `\\sin\\left(${x}\\right)` },
  cos: { min: 1, max: 1, run: ([x]: number[]) => Math.cos(x), latex: ([x]: string[]) => `\\cos\\left(${x}\\right)` },
  tan: { min: 1, max: 1, run: ([x]: number[]) => Math.tan(x), latex: ([x]: string[]) => `\\tan\\left(${x}\\right)` },
  /** `pi()` también vale (además de la constante `pi`). */
  pi: { min: 0, max: 0, run: () => Math.PI, latex: () => "\\pi" },
});

const CONSTANTS: Record<string, number> = Object.assign(Object.create(null) as Record<string, number>, {
  pi: Math.PI,
});

/** Nombres que no pueden usarse como variable (funciones y constantes). */
export const FORMULA_RESERVED_NAMES: ReadonlySet<string> = new Set([...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS)]);

export const FORMULA_FUNCTION_NAMES: readonly string[] = Object.keys(FUNCTIONS);

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

// ----------------------------------------------------------------------------
// Tipos públicos
// ----------------------------------------------------------------------------

export type FormulaNode =
  | { kind: "num"; value: number; text: string }
  | { kind: "var"; name: string }
  | { kind: "const"; name: string }
  | { kind: "neg"; arg: FormulaNode }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: FormulaNode; right: FormulaNode }
  | { kind: "call"; name: string; args: FormulaNode[] }
  | { kind: "group"; inner: FormulaNode };

export type FormulaErrorCode =
  | "empty"
  | "syntax"
  | "too-long"
  | "unknown-function"
  | "unknown-variable"
  | "missing"
  | "division-by-zero"
  | "domain"
  | "overflow";

export type FormulaEvalResult =
  | { ok: true; value: number }
  | { ok: false; code: FormulaErrorCode; message: string; missing?: string[] };

export type CompiledFormula =
  | { ok: true; ast: FormulaNode; identifiers: string[] }
  | { ok: false; code: FormulaErrorCode; message: string };

class FormulaError extends Error {
  constructor(
    public code: FormulaErrorCode,
    message: string
  ) {
    super(message);
  }
}

// ----------------------------------------------------------------------------
// Tokens
// ----------------------------------------------------------------------------

type Token =
  | { type: "num"; value: number; text: string; at: number }
  | { type: "id"; text: string; at: number }
  | { type: "op"; text: "+" | "-" | "*" | "/" | "^"; at: number }
  | { type: "lp" | "rp" | "comma"; at: number };

const OP_ALIASES: Record<string, "+" | "-" | "*" | "/" | "^"> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "–": "-",
  "*": "*",
  "×": "*",
  "·": "*",
  "/": "/",
  "÷": "/",
  "^": "^",
};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    // «**» como potencia (costumbre de Python/JS).
    if (ch === "*" && source[i + 1] === "*") {
      tokens.push({ type: "op", text: "^", at: i });
      i += 2;
      continue;
    }
    const rest = source.slice(i);
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      const value = Number(num[0]);
      if (!Number.isFinite(value)) throw new FormulaError("syntax", `Número fuera de rango: ${num[0].slice(0, 20)}`);
      tokens.push({ type: "num", value, text: num[0], at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (id) {
      if (id[0].length > 32) throw new FormulaError("syntax", "Nombre de variable demasiado largo (máx. 32 caracteres).");
      tokens.push({ type: "id", text: id[0], at: i });
      i += id[0].length;
      continue;
    }
    if (ch === "π") tokens.push({ type: "id", text: "pi", at: i });
    else if (hasOwn(OP_ALIASES, ch)) tokens.push({ type: "op", text: OP_ALIASES[ch], at: i });
    else if (ch === "(") tokens.push({ type: "lp", at: i });
    else if (ch === ")") tokens.push({ type: "rp", at: i });
    else if (ch === ",") tokens.push({ type: "comma", at: i });
    else throw new FormulaError("syntax", `Carácter no permitido «${ch}» en la posición ${i + 1}.`);
    i += 1;
    if (tokens.length > MAX_TOKENS) throw new FormulaError("too-long", "La expresión es demasiado larga.");
  }
  if (tokens.length > MAX_TOKENS) throw new FormulaError("too-long", "La expresión es demasiado larga.");
  return tokens;
}

// ----------------------------------------------------------------------------
// Analizador: expr := term (('+'|'-') term)*
//             term := unary (('*'|'/') unary)*
//             unary := '-' unary | '+' unary | power
//             power := atom ('^' unary)?        (asociativa a la derecha: 2^3^2 = 2^9)
//             atom := num | id | id '(' args ')' | '(' expr ')'
// ----------------------------------------------------------------------------

function parse(tokens: Token[]): FormulaNode {
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const enter = () => {
    depth += 1;
    if (depth > MAX_DEPTH) throw new FormulaError("too-long", "La expresión anida demasiados paréntesis.");
  };
  const leave = () => {
    depth -= 1;
  };
  const describe = (t: Token | undefined) => (t ? `la posición ${t.at + 1}` : "el final");

  const parseExpr = (): FormulaNode => {
    enter();
    let left = parseTerm();
    for (let t = peek(); t?.type === "op" && (t.text === "+" || t.text === "-"); t = peek()) {
      pos += 1;
      left = { kind: "bin", op: t.text, left, right: parseTerm() };
    }
    leave();
    return left;
  };

  const parseTerm = (): FormulaNode => {
    let left = parseUnary();
    for (let t = peek(); t?.type === "op" && (t.text === "*" || t.text === "/"); t = peek()) {
      pos += 1;
      left = { kind: "bin", op: t.text, left, right: parseUnary() };
    }
    return left;
  };

  const parseUnary = (): FormulaNode => {
    const t = peek();
    if (t?.type === "op" && (t.text === "-" || t.text === "+")) {
      pos += 1;
      enter();
      const arg = parseUnary();
      leave();
      return t.text === "-" ? { kind: "neg", arg } : arg;
    }
    return parsePower();
  };

  const parsePower = (): FormulaNode => {
    const base = parseAtom();
    const t = peek();
    if (t?.type === "op" && t.text === "^") {
      pos += 1;
      enter();
      const exponent = parseUnary();
      leave();
      return { kind: "bin", op: "^", left: base, right: exponent };
    }
    return base;
  };

  const parseAtom = (): FormulaNode => {
    const t = peek();
    if (!t) throw new FormulaError("syntax", "La expresión termina antes de tiempo.");
    pos += 1;
    if (t.type === "num") return { kind: "num", value: t.value, text: t.text };
    if (t.type === "lp") {
      const inner = parseExpr();
      if (peek()?.type !== "rp") throw new FormulaError("syntax", `Falta cerrar un paréntesis «)» en ${describe(peek())}.`);
      pos += 1;
      return { kind: "group", inner };
    }
    if (t.type === "id") {
      if (peek()?.type === "lp") {
        const name = t.text.toLowerCase();
        if (!hasOwn(FUNCTIONS, name)) {
          throw new FormulaError("unknown-function", `Función desconocida «${t.text}». Usa: ${FORMULA_FUNCTION_NAMES.join(", ")}.`);
        }
        const spec = FUNCTIONS[name];
        pos += 1;
        const args: FormulaNode[] = [];
        if (peek()?.type !== "rp") {
          for (;;) {
            args.push(parseExpr());
            if (args.length > MAX_ARGS) throw new FormulaError("syntax", "Demasiados argumentos.");
            if (peek()?.type === "comma") {
              pos += 1;
              continue;
            }
            break;
          }
        }
        if (peek()?.type !== "rp") throw new FormulaError("syntax", `Falta cerrar «${name}(» en ${describe(peek())}.`);
        pos += 1;
        if (args.length < spec.min || args.length > spec.max) {
          const expected = spec.min === spec.max ? `${spec.min}` : `${spec.min} a ${spec.max === MAX_ARGS ? "varios" : spec.max}`;
          throw new FormulaError("syntax", `«${name}» espera ${expected} argumento(s).`);
        }
        return { kind: "call", name, args };
      }
      if (t.text === "pi") return { kind: "const", name: "pi" };
      return { kind: "var", name: t.text };
    }
    throw new FormulaError("syntax", `Símbolo inesperado en la posición ${t.at + 1}.`);
  };

  const ast = parseExpr();
  if (pos < tokens.length) throw new FormulaError("syntax", `Sobra algo en la posición ${tokens[pos].at + 1}.`);
  return ast;
}

function collectIdentifiers(node: FormulaNode, out: Set<string>): void {
  switch (node.kind) {
    case "var":
      out.add(node.name);
      break;
    case "neg":
      collectIdentifiers(node.arg, out);
      break;
    case "group":
      collectIdentifiers(node.inner, out);
      break;
    case "bin":
      collectIdentifiers(node.left, out);
      collectIdentifiers(node.right, out);
      break;
    case "call":
      for (const a of node.args) collectIdentifiers(a, out);
      break;
  }
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

/** Caché pequeña: el mismo texto se compila una sola vez (recalcular = 0 ms). */
const compileCache = new Map<string, CompiledFormula>();

/** Analiza la expresión y lista sus variables (en orden de aparición). */
export function compileFormula(expression: string): CompiledFormula {
  const source = typeof expression === "string" ? expression : "";
  const cached = compileCache.get(source);
  if (cached) return cached;
  let result: CompiledFormula;
  if (!source.trim()) {
    result = { ok: false, code: "empty", message: "Escribe la expresión a calcular." };
  } else if (source.length > FORMULA_MAX_EXPRESSION_CHARS) {
    result = { ok: false, code: "too-long", message: `La expresión supera ${FORMULA_MAX_EXPRESSION_CHARS} caracteres.` };
  } else {
    try {
      const ast = parse(tokenize(source));
      const ids = new Set<string>();
      collectIdentifiers(ast, ids);
      result = { ok: true, ast, identifiers: [...ids] };
    } catch (error) {
      result =
        error instanceof FormulaError
          ? { ok: false, code: error.code, message: error.message }
          : { ok: false, code: "syntax", message: "La expresión no es válida." };
    }
  }
  if (compileCache.size > 200) compileCache.clear();
  compileCache.set(source, result);
  return result;
}

/** Valores de las variables: número finito o «sin dato». */
export type FormulaScope = Record<string, number | null | undefined>;

function applyBinary(op: "+" | "-" | "*" | "/" | "^", a: number, b: number): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") {
    if (b === 0) throw new FormulaError("division-by-zero", "División entre cero.");
    return a / b;
  }
  const r = a ** b;
  if (Number.isNaN(r)) throw new FormulaError("domain", "Potencia no definida (base negativa con exponente fraccionario).");
  return r;
}

function evalNode(node: FormulaNode, scope: FormulaScope): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "const":
      return CONSTANTS[node.name];
    case "var": {
      const v = hasOwn(scope, node.name) ? scope[node.name] : undefined;
      if (typeof v !== "number" || !Number.isFinite(v)) throw new FormulaError("missing", node.name);
      return v;
    }
    case "group":
      return evalNode(node.inner, scope);
    case "neg":
      return -evalNode(node.arg, scope);
    case "bin":
      return applyBinary(node.op, evalNode(node.left, scope), evalNode(node.right, scope));
    case "call": {
      const args = node.args.map((a) => evalNode(a, scope));
      const r = FUNCTIONS[node.name].run(args);
      if (Number.isNaN(r)) {
        throw new FormulaError("domain", `«${node.name}» no está definida para ese valor (p. ej. raíz o logaritmo de un negativo).`);
      }
      return r;
    }
  }
  throw new FormulaError("syntax", "Expresión no válida.");
}

/**
 * Evalúa una expresión con los valores dados. Nunca lanza: devuelve un error
 * claro (faltan datos, división entre cero, dominio, sintaxis…).
 */
export function evaluateFormula(expression: string, scope: FormulaScope): FormulaEvalResult {
  const compiled = compileFormula(expression);
  if (!compiled.ok) return compiled;
  return evaluateCompiled(compiled, scope);
}

export function evaluateCompiled(compiled: Extract<CompiledFormula, { ok: true }>, scope: FormulaScope): FormulaEvalResult {
  // Primero se listan TODAS las variables sin dato (mensaje completo, no solo la primera).
  const missing = compiled.identifiers.filter((id) => {
    const v = hasOwn(scope, id) ? scope[id] : undefined;
    return typeof v !== "number" || !Number.isFinite(v);
  });
  if (missing.length > 0) {
    return { ok: false, code: "missing", message: `Faltan datos: ${missing.join(", ")}`, missing };
  }
  try {
    const value = evalNode(compiled.ast, scope);
    if (!Number.isFinite(value)) {
      return { ok: false, code: "overflow", message: "El resultado es demasiado grande para mostrarse." };
    }
    return { ok: true, value: Object.is(value, -0) ? 0 : value };
  } catch (error) {
    if (error instanceof FormulaError) {
      if (error.code === "missing") return { ok: false, code: "missing", message: `Faltan datos: ${error.message}`, missing: [error.message] };
      return { ok: false, code: error.code, message: error.message };
    }
    return { ok: false, code: "syntax", message: "No se pudo calcular la expresión." };
  }
}

// ----------------------------------------------------------------------------
// Árbol → LaTeX (para la sustitución numérica que ve la persona)
// ----------------------------------------------------------------------------

const PRECEDENCE: Record<FormulaNode["kind"], number> = {
  num: 5,
  var: 5,
  const: 5,
  call: 5,
  group: 5,
  neg: 3,
  bin: 0,
};

const BIN_PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 4 } as const;

function precedenceOf(node: FormulaNode): number {
  return node.kind === "bin" ? BIN_PRECEDENCE[node.op] : PRECEDENCE[node.kind];
}

/** Quita los paréntesis escritos por la persona (la fracción ya agrupa). */
const unwrap = (node: FormulaNode): FormulaNode => (node.kind === "group" ? unwrap(node.inner) : node);

/**
 * Escribe el árbol en LaTeX. `render(name)` decide cómo se ve cada variable:
 * su símbolo (`m`) o su valor sustituido (`82`).
 */
export function formulaToLatex(node: FormulaNode, render: (name: string) => string): string {
  const wrap = (child: FormulaNode, min: number) => {
    const text = formulaToLatex(child, render);
    return precedenceOf(unwrap(child)) < min ? `\\left(${text}\\right)` : text;
  };
  switch (node.kind) {
    case "num":
      return node.text.replace(/[eE]([+-]?\d+)/, "\\times 10^{$1}");
    case "var":
      return render(node.name);
    case "const":
      return "\\pi";
    case "group": {
      const inner = unwrap(node.inner);
      return inner.kind === "bin" && inner.op !== "/" && inner.op !== "^"
        ? `\\left(${formulaToLatex(inner, render)}\\right)`
        : formulaToLatex(inner, render);
    }
    case "neg":
      return `-${wrap(node.arg, 3)}`;
    case "call":
      return FUNCTIONS[node.name].latex(node.args.map((a) => formulaToLatex(unwrap(a), render)));
    case "bin": {
      const left = unwrap(node.left);
      const right = unwrap(node.right);
      switch (node.op) {
        case "/":
          return `\\frac{${formulaToLatex(left, render)}}{${formulaToLatex(right, render)}}`;
        case "^":
          return `{${wrap(node.left, 5)}}^{${formulaToLatex(right, render)}}`;
        case "*":
          return `${wrap(node.left, 2)} \\cdot ${wrap(node.right, 2)}`;
        case "+":
          return `${wrap(node.left, 1)} + ${wrap(node.right, 1)}`;
        case "-":
          return `${wrap(node.left, 1)} - ${wrap(node.right, 2)}`;
      }
    }
  }
  return "";
}

// ----------------------------------------------------------------------------
// Números legibles
// ----------------------------------------------------------------------------

/** Valor para la sustitución numérica: hasta 6 decimales, sin ceros sobrantes. */
export function formatFormulaInput(value: number): string {
  if (!Number.isFinite(value)) return "?";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e9 || abs < 1e-6)) return value.toExponential(4).replace(/\.?0+e/, "e");
  return String(Number(value.toFixed(6)));
}

/** Resultado redondeado a `decimals` (0–6), sin ceros sobrantes y con separador de miles. */
export function formatFormulaResult(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const d = Math.max(0, Math.min(6, Math.trunc(decimals)));
  const abs = Math.abs(value);
  // Muy grande, o tan pequeño que el redondeo lo dejaría en 0: notación científica.
  if (abs !== 0 && (abs >= 1e12 || abs < 10 ** -Math.max(d, 1) / 2)) return value.toExponential(3);
  return value.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0, useGrouping: true }).replace(/,/g, " ");
}
