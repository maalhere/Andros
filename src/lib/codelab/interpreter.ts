// ============================================================================
// ANDROS — INTÉRPRETE SEGURO DEL LABORATORIO DE CÓDIGO (NODO TIPO 5)
//
// Ejecutor matemático ligero tipo MATLAB, 100% en el navegador. NUNCA usa
// `eval` ni `new Function`: es un tokenizador + parser de descenso recursivo
// + evaluador escritos a mano, así que el código del usuario no puede
// ejecutar nada fuera de esta aritmética (sin acceso a `window`, DOM, red...).
//
// Sintaxis soportada:
//   F = 500; A = 25; esfuerzo = F / A;
//   x = linspace(0, 10, 50);
//   y = sin(x) * 2;
//   plot(x, y);
// Operadores: + - * / ^ (potencia), paréntesis, negativo unario.
// Funciones: sin cos tan asin acos atan sqrt log ln exp abs pow min max
//            round floor ceil linspace plot
// Constantes: pi, e
// Variables de una pieza 3D conectada (si el visor ya la midió):
//   model_x, model_y, model_z (ancho, profundidad y alto en mm)
// ============================================================================

import type { CodeLabPlotData, CodeLabRunResult, CodeLabValue } from "@/types/workspace";

export class CodeLabError extends Error {}

// ----------------------------------------------------------------------------
// 1. Tokenizador
// ----------------------------------------------------------------------------

type TokenType =
  | "number"
  | "identifier"
  | "operator"
  | "lparen"
  | "rparen"
  | "comma"
  | "semicolon"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = new Set(["+", "-", "*", "/", "^", "="]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];

    if (ch === " " || ch === "\t" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      tokens.push({ type: "semicolon", value: "\n" });
      i += 1;
      continue;
    }
    // Comentarios: "# ..." o "// ..." hasta fin de línea.
    if (ch === "#" || (ch === "/" && source[i + 1] === "/")) {
      while (i < len && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === ";") {
      tokens.push({ type: "semicolon", value: ";" });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch });
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      let j = i;
      while (j < len && /[0-9.]/.test(source[j])) j += 1;
      // Notación científica: 1e-3, 2.5E10
      if (source[j] === "e" || source[j] === "E") {
        let k = j + 1;
        if (source[k] === "+" || source[k] === "-") k += 1;
        if (/[0-9]/.test(source[k] ?? "")) {
          j = k;
          while (j < len && /[0-9]/.test(source[j])) j += 1;
        }
      }
      tokens.push({ type: "number", value: source.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < len && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      tokens.push({ type: "identifier", value: source.slice(i, j) });
      i = j;
      continue;
    }
    if (OPERATORS.has(ch)) {
      tokens.push({ type: "operator", value: ch });
      i += 1;
      continue;
    }
    throw new CodeLabError(`Carácter no reconocido: "${ch}"`);
  }

  tokens.push({ type: "eof", value: "" });
  return tokens;
}

// ----------------------------------------------------------------------------
// 2. AST
// ----------------------------------------------------------------------------

type Expr =
  | { kind: "number"; value: number }
  | { kind: "identifier"; name: string }
  | { kind: "unary"; op: "-" | "+"; value: Expr }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[] };

type Statement =
  | { kind: "assign"; name: string; value: Expr }
  | { kind: "expr"; value: Expr }
  | { kind: "call"; name: string; args: Expr[] };

// ----------------------------------------------------------------------------
// 3. Parser de descenso recursivo
// ----------------------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private advance(): Token {
    return this.tokens[this.pos++];
  }
  private expect(type: TokenType, label: string): Token {
    const t = this.advance();
    if (t.type !== type) throw new CodeLabError(`Se esperaba ${label}, llegó "${t.value}"`);
    return t;
  }

  parseProgram(): Statement[] {
    const statements: Statement[] = [];
    this.skipSeparators();
    while (this.peek().type !== "eof") {
      statements.push(this.parseStatement());
      this.skipSeparators();
    }
    return statements;
  }

  private skipSeparators() {
    while (this.peek().type === "semicolon") this.advance();
  }

  private parseStatement(): Statement {
    const start = this.peek();
    // Asignación: identificador "=" expresión (y no "==", que no existe aquí).
    if (start.type === "identifier") {
      const next = this.tokens[this.pos + 1];
      if (next && next.type === "operator" && next.value === "=") {
        const name = this.advance().value;
        this.advance(); // "="
        const value = this.parseExpr();
        return { kind: "assign", name, value };
      }
      // Llamada a función de nivel superior, ej. plot(x, y)
      if (next && next.type === "lparen") {
        const expr = this.parseExpr();
        if (expr.kind === "call") return { kind: "call", name: expr.name, args: expr.args };
        return { kind: "expr", value: expr };
      }
    }
    return { kind: "expr", value: this.parseExpr() };
  }

  private parseExpr(): Expr {
    return this.parseAddSub();
  }

  private parseAddSub(): Expr {
    let left = this.parseMulDiv();
    while (this.peek().type === "operator" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.advance().value as "+" | "-";
      const right = this.parseMulDiv();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMulDiv(): Expr {
    let left = this.parsePow();
    while (this.peek().type === "operator" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.advance().value as "*" | "/";
      const right = this.parsePow();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parsePow(): Expr {
    const left = this.parseUnary();
    if (this.peek().type === "operator" && this.peek().value === "^") {
      this.advance();
      const right = this.parsePow(); // asociativo a la derecha
      return { kind: "binary", op: "^", left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.peek().type === "operator" && (this.peek().value === "-" || this.peek().value === "+")) {
      const op = this.advance().value as "-" | "+";
      return { kind: "unary", op, value: this.parseUnary() };
    }
    return this.parseAtom();
  }

  private parseAtom(): Expr {
    const t = this.peek();

    if (t.type === "number") {
      this.advance();
      return { kind: "number", value: Number(t.value) };
    }
    if (t.type === "lparen") {
      this.advance();
      const expr = this.parseExpr();
      this.expect("rparen", "')'");
      return expr;
    }
    if (t.type === "identifier") {
      this.advance();
      if (this.peek().type === "lparen") {
        this.advance();
        const args: Expr[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek().type === "comma") {
            this.advance();
            args.push(this.parseExpr());
          }
        }
        this.expect("rparen", "')'");
        return { kind: "call", name: t.value, args };
      }
      return { kind: "identifier", name: t.value };
    }
    throw new CodeLabError(`Expresión inválida cerca de "${t.value || "fin del código"}"`);
  }
}

// ----------------------------------------------------------------------------
// 4. Evaluador
// ----------------------------------------------------------------------------

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

type Scalar1 = (x: number) => number;

const UNARY_FUNCTIONS: Record<string, Scalar1> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  log: Math.log10,
  log10: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

function isArray(v: CodeLabValue): v is number[] {
  return Array.isArray(v);
}

/** Aplica una función escalar elemento a elemento si el valor es un vector. */
function mapValue(v: CodeLabValue, fn: Scalar1): CodeLabValue {
  return isArray(v) ? v.map(fn) : fn(v);
}

/** Operación binaria con "broadcast": escalar-vector, vector-vector o escalar-escalar. */
function binaryOp(
  a: CodeLabValue,
  b: CodeLabValue,
  fn: (x: number, y: number) => number
): CodeLabValue {
  if (!isArray(a) && !isArray(b)) return fn(a, b);
  if (isArray(a) && isArray(b)) {
    if (a.length !== b.length) {
      throw new CodeLabError(
        `No se pueden combinar vectores de distinto tamaño (${a.length} y ${b.length})`
      );
    }
    return a.map((x, i) => fn(x, b[i]));
  }
  if (isArray(a)) return a.map((x) => fn(x, b as number));
  return (b as number[]).map((y) => fn(a as number, y));
}

function formatValue(v: CodeLabValue): string {
  if (isArray(v)) {
    const preview = v.slice(0, 6).map((n) => formatNumber(n));
    return `[${preview.join(", ")}${v.length > 6 ? `, … (${v.length} valores)` : ""}]`;
  }
  return formatNumber(v);
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return n.toPrecision(6).replace(/\.?0+$/, "").replace(/\.$/, "");
}

const MAX_LOGS = 200;
const MAX_LINSPACE_POINTS = 5000;

class Evaluator {
  variables: Record<string, CodeLabValue> = {};
  logs: string[] = [];
  plot: CodeLabPlotData | undefined;

  private evalExpr(expr: Expr): CodeLabValue {
    switch (expr.kind) {
      case "number":
        return expr.value;
      case "identifier": {
        if (expr.name in this.variables) return this.variables[expr.name];
        if (expr.name in CONSTANTS) return CONSTANTS[expr.name];
        throw new CodeLabError(`Variable no definida: "${expr.name}"`);
      }
      case "unary": {
        const v = this.evalExpr(expr.value);
        return expr.op === "-" ? mapValue(v, (x) => -x) : v;
      }
      case "binary": {
        const left = this.evalExpr(expr.left);
        const right = this.evalExpr(expr.right);
        switch (expr.op) {
          case "+":
            return binaryOp(left, right, (x, y) => x + y);
          case "-":
            return binaryOp(left, right, (x, y) => x - y);
          case "*":
            return binaryOp(left, right, (x, y) => x * y);
          case "/":
            return binaryOp(left, right, (x, y) => x / y);
          case "^":
            return binaryOp(left, right, (x, y) => Math.pow(x, y));
        }
        break;
      }
      case "call":
        return this.evalCall(expr.name, expr.args);
    }
  }

  private evalCall(name: string, argExprs: Expr[]): CodeLabValue {
    if (name === "linspace") {
      if (argExprs.length !== 3) throw new CodeLabError("linspace(inicio, fin, n) necesita 3 argumentos");
      const start = this.requireScalar(this.evalExpr(argExprs[0]), "linspace");
      const end = this.requireScalar(this.evalExpr(argExprs[1]), "linspace");
      const count = Math.round(this.requireScalar(this.evalExpr(argExprs[2]), "linspace"));
      if (count < 1 || count > MAX_LINSPACE_POINTS) {
        throw new CodeLabError(`linspace: n debe estar entre 1 y ${MAX_LINSPACE_POINTS}`);
      }
      if (count === 1) return [start];
      const step = (end - start) / (count - 1);
      return Array.from({ length: count }, (_, i) => start + step * i);
    }

    if (name === "pow") {
      if (argExprs.length !== 2) throw new CodeLabError("pow(base, exponente) necesita 2 argumentos");
      return binaryOp(
        this.evalExpr(argExprs[0]),
        this.evalExpr(argExprs[1]),
        (x, y) => Math.pow(x, y)
      );
    }
    if (name === "min" || name === "max") {
      const values = argExprs.map((a) => this.evalExpr(a));
      const flat = values.flatMap((v) => (isArray(v) ? v : [v]));
      if (flat.length === 0) throw new CodeLabError(`${name}() necesita al menos un argumento`);
      return name === "min" ? Math.min(...flat) : Math.max(...flat);
    }

    const unary = UNARY_FUNCTIONS[name];
    if (unary) {
      if (argExprs.length !== 1) throw new CodeLabError(`${name}(x) necesita exactamente 1 argumento`);
      return mapValue(this.evalExpr(argExprs[0]), unary);
    }

    throw new CodeLabError(`Función desconocida: "${name}()"`);
  }

  private requireScalar(v: CodeLabValue, context: string): number {
    if (isArray(v)) throw new CodeLabError(`${context}: se esperaba un número, llegó un vector`);
    return v;
  }

  runStatement(stmt: Statement) {
    if (stmt.kind === "assign") {
      const value = this.evalExpr(stmt.value);
      this.variables[stmt.name] = value;
      if (this.logs.length < MAX_LOGS) {
        this.logs.push(`${stmt.name} = ${formatValue(value)}`);
      }
      return;
    }
    if (stmt.kind === "call" && stmt.name === "plot") {
      if (stmt.args.length !== 2) throw new CodeLabError("plot(x, y) necesita 2 argumentos");
      const x = this.evalExpr(stmt.args[0]);
      const y = this.evalExpr(stmt.args[1]);
      if (!isArray(x) || !isArray(y)) {
        throw new CodeLabError("plot(x, y) necesita dos vectores (usa linspace para generarlos)");
      }
      if (x.length !== y.length) {
        throw new CodeLabError(`plot: x e y deben tener el mismo tamaño (${x.length} vs ${y.length})`);
      }
      this.plot = { x, y };
      if (this.logs.length < MAX_LOGS) this.logs.push(`plot(x, y) · ${x.length} puntos`);
      return;
    }
    if (stmt.kind === "call") {
      this.evalCall(stmt.name, stmt.args);
      return;
    }
    // Expresión suelta: se evalúa y se muestra el resultado.
    const value = this.evalExpr(stmt.value);
    if (this.logs.length < MAX_LOGS) this.logs.push(formatValue(value));
  }
}

// ----------------------------------------------------------------------------
// 5. API pública
// ----------------------------------------------------------------------------

const MAX_SOURCE_CHARS = 20_000;

/**
 * Ejecuta el código del Laboratorio y devuelve variables, logs y la última
 * gráfica. Nunca lanza: los errores quedan en `errorMessage` para mostrarlos
 * en el nodo sin romper el resto de la app.
 */
export function runCodeLab(
  source: string,
  /**
   * Variables predefinidas antes de ejecutar (p. ej. model_x, model_y y
   * model_z de una pieza 3D conectada). El código puede sobrescribirlas.
   */
  presets: Record<string, CodeLabValue> = {}
): CodeLabRunResult {
  const clipped = source.slice(0, MAX_SOURCE_CHARS);
  const evaluator = new Evaluator();
  evaluator.variables = { ...presets };
  try {
    const tokens = tokenize(clipped);
    const statements = new Parser(tokens).parseProgram();
    for (const stmt of statements) evaluator.runStatement(stmt);
    return {
      variables: evaluator.variables,
      logs: evaluator.logs,
      ...(evaluator.plot ? { plot: evaluator.plot } : {}),
    };
  } catch (error) {
    const message = error instanceof CodeLabError ? error.message : "Error al ejecutar el código";
    return {
      variables: evaluator.variables,
      logs: evaluator.logs,
      ...(evaluator.plot ? { plot: evaluator.plot } : {}),
      errorMessage: message,
    };
  }
}
