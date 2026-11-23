// ============================================================================
// ANDROS — MOTOR MÍNIMO DE HOJA DE CÁLCULO (tarjeta «Cálculo»)
//
// Evalúa lo que la gente escribe en las celdas: números, + − × ÷, paréntesis,
// referencias (B2) y SUMA / SUM / PROMEDIO / AVERAGE / MIN / MAX sobre rangos
// (B2:B6). Sin `eval`: un analizador recursivo propio. Funciona en cliente y
// servidor, así que la IA puede generar fórmulas y el resultado ya sale calculado.
// ============================================================================

import type { SpreadsheetCell } from "@/types/workspace";

export const SHEET_COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Límite de la cuadrícula editable (la tarjeta no pretende ser Excel). */
export const SHEET_MAX_ROWS = 14;
export const SHEET_MAX_COLUMNS = 4;

type Raw = Record<string, string>;
type Computed = { value: number | string; error?: string };

class SheetError extends Error {}

const FUNCTIONS: Record<string, (values: number[]) => number> = {
  SUM: (v) => v.reduce((a, b) => a + b, 0),
  SUMA: (v) => v.reduce((a, b) => a + b, 0),
  AVERAGE: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0),
  PROMEDIO: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0),
  MIN: (v) => (v.length ? Math.min(...v) : 0),
  MAX: (v) => (v.length ? Math.max(...v) : 0),
};

/** Número tal como lo escribe una persona: «1.200,50», «1200.5», «$ 300», «15%». */
export function parseLooseNumber(text: string): number | null {
  let t = text.trim().replace(/[$€£\s]/g, "");
  if (!t) return null;
  let percent = false;
  if (t.endsWith("%")) {
    percent = true;
    t = t.slice(0, -1);
  }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? (percent ? n / 100 : n) : null;
}

/** Texto corto y legible para un número calculado («1.250», «3,5»). */
export function formatSheetNumber(value: number): string {
  if (!Number.isFinite(value)) return "#ERROR";
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString("es", { maximumFractionDigits: 2 });
}

interface Token {
  type: "num" | "ref" | "range" | "name" | "op" | "lp" | "rp" | "comma";
  text: string;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const rest = source.slice(i);
    const range = /^[A-Za-z]{1,2}\d{1,3}:[A-Za-z]{1,2}\d{1,3}/.exec(rest);
    if (range) {
      tokens.push({ type: "range", text: range[0].toUpperCase() });
      i += range[0].length;
      continue;
    }
    const ref = /^[A-Za-z]{1,2}\d{1,3}(?![A-Za-z(])/.exec(rest);
    if (ref) {
      tokens.push({ type: "ref", text: ref[0].toUpperCase() });
      i += ref[0].length;
      continue;
    }
    const name = /^[A-Za-zÁÉÍÓÚáéíóú]+(?=\()/.exec(rest);
    if (name) {
      tokens.push({ type: "name", text: name[0].toUpperCase() });
      i += name[0].length;
      continue;
    }
    const num = /^(\d+([.,]\d+)?|[.,]\d+)/.exec(rest);
    if (num) {
      tokens.push({ type: "num", text: num[0].replace(",", ".") });
      i += num[0].length;
      continue;
    }
    if ("+-*/×÷^".includes(ch)) tokens.push({ type: "op", text: ch === "×" ? "*" : ch === "÷" ? "/" : ch });
    else if (ch === "(") tokens.push({ type: "lp", text: ch });
    else if (ch === ")") tokens.push({ type: "rp", text: ch });
    else if (ch === "," || ch === ";") tokens.push({ type: "comma", text: ch });
    else throw new SheetError("#ERROR");
    i += 1;
  }
  return tokens;
}

function splitAddress(address: string): { col: number; row: number } {
  const m = /^([A-Z]{1,2})(\d{1,3})$/.exec(address);
  if (!m) throw new SheetError("#REF!");
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

function columnName(col: number): string {
  let name = "";
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Calcula todas las celdas (con referencias entre sí). Una celda con fórmula
 * que falla guarda el error («#REF!», «#DIV/0!», «#CICLO!»); el texto libre
 * se muestra tal cual.
 */
export function computeSheet(raw: Raw): Record<string, SpreadsheetCell> {
  const cache = new Map<string, Computed>();
  const visiting = new Set<string>();

  const evalCell = (address: string): Computed => {
    const hit = cache.get(address);
    if (hit) return hit;
    const text = (raw[address] ?? "").trim();
    let result: Computed;
    if (!text.startsWith("=")) {
      const n = parseLooseNumber(text);
      result = n !== null ? { value: n } : { value: text };
    } else {
      if (visiting.has(address)) return { value: "#CICLO!", error: "#CICLO!" };
      visiting.add(address);
      try {
        result = { value: evaluateFormula(text.slice(1)) };
      } catch (error) {
        const code = error instanceof SheetError ? error.message : "#ERROR";
        result = { value: code, error: code };
      } finally {
        visiting.delete(address);
      }
    }
    cache.set(address, result);
    return result;
  };

  const numericOf = (address: string): number => {
    const cell = evalCell(address);
    if (cell.error) throw new SheetError(cell.error);
    // El texto cuenta como 0 (como en Excel).
    return typeof cell.value === "number" ? cell.value : 0;
  };

  const rangeValues = (range: string): number[] => {
    const [a, b] = range.split(":");
    const from = splitAddress(a);
    const to = splitAddress(b);
    const values: number[] = [];
    for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1) {
      for (let col = Math.min(from.col, to.col); col <= Math.max(from.col, to.col); col += 1) {
        const address = `${columnName(col)}${row}`;
        if (!(address in raw)) continue;
        const cell = evalCell(address);
        if (cell.error) throw new SheetError(cell.error);
        // Los rangos solo suman números (el texto se ignora, como en Excel).
        if (typeof cell.value === "number") values.push(cell.value);
      }
    }
    return values;
  };

  const evaluateFormula = (source: string): number => {
    const tokens = tokenize(source);
    let pos = 0;
    const peek = () => tokens[pos];
    const take = () => tokens[pos++];

    const parseExpression = (): number => {
      let left = parseTerm();
      while (peek()?.type === "op" && (peek().text === "+" || peek().text === "-")) {
        const op = take().text;
        const right = parseTerm();
        left = op === "+" ? left + right : left - right;
      }
      return left;
    };
    const parseTerm = (): number => {
      let left = parsePower();
      while (peek()?.type === "op" && (peek().text === "*" || peek().text === "/")) {
        const op = take().text;
        const right = parsePower();
        if (op === "/" && right === 0) throw new SheetError("#DIV/0!");
        left = op === "*" ? left * right : left / right;
      }
      return left;
    };
    const parsePower = (): number => {
      const base = parseUnary();
      if (peek()?.type === "op" && peek().text === "^") {
        take();
        return base ** parsePower();
      }
      return base;
    };
    const parseUnary = (): number => {
      if (peek()?.type === "op" && (peek().text === "-" || peek().text === "+")) {
        const sign = take().text;
        const value = parseUnary();
        return sign === "-" ? -value : value;
      }
      return parseAtom();
    };
    const parseAtom = (): number => {
      const token = take();
      if (!token) throw new SheetError("#ERROR");
      if (token.type === "num") return Number(token.text);
      if (token.type === "ref") return numericOf(token.text);
      if (token.type === "range") {
        const values = rangeValues(token.text);
        return values.reduce((a, b) => a + b, 0);
      }
      if (token.type === "lp") {
        const value = parseExpression();
        if (take()?.type !== "rp") throw new SheetError("#ERROR");
        return value;
      }
      if (token.type === "name") {
        const fn = FUNCTIONS[token.text];
        if (!fn || take()?.type !== "lp") throw new SheetError("#NOMBRE?");
        const values: number[] = [];
        if (peek()?.type !== "rp") {
          for (;;) {
            const next = peek();
            if (next?.type === "range") {
              take();
              values.push(...rangeValues(next.text));
            } else {
              values.push(parseExpression());
            }
            if (peek()?.type === "comma") {
              take();
              continue;
            }
            break;
          }
        }
        if (take()?.type !== "rp") throw new SheetError("#ERROR");
        return fn(values);
      }
      throw new SheetError("#ERROR");
    };

    const result = parseExpression();
    if (pos < tokens.length) throw new SheetError("#ERROR");
    if (!Number.isFinite(result)) throw new SheetError("#ERROR");
    return result;
  };

  const out: Record<string, SpreadsheetCell> = {};
  for (const address of Object.keys(raw)) {
    const text = raw[address];
    if (text.trim() === "") continue;
    const cell = evalCell(address);
    out[address] = {
      raw: text,
      computed: typeof cell.value === "number" ? formatSheetNumber(cell.value) : String(cell.value),
      ...(cell.error ? { error: cell.error } : {}),
    };
  }
  return out;
}

/** Texto crudo de cada celda (lo que la persona escribió). */
export function rawOfCells(cells: Record<string, SpreadsheetCell>): Raw {
  return Object.fromEntries(Object.entries(cells).map(([address, cell]) => [address, cell.raw]));
}

/** Cambia una celda y recalcula toda la hoja (las fórmulas que dependen de ella se actualizan). */
export function setSheetCell(
  cells: Record<string, SpreadsheetCell>,
  address: string,
  text: string
): Record<string, SpreadsheetCell> {
  const raw = rawOfCells(cells);
  if (text.trim() === "") delete raw[address];
  else raw[address] = text.slice(0, 120);
  return computeSheet(raw);
}
