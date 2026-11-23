// ============================================================================
// ANDROS — PLANO DE TABLERO (cliente y servidor, sin dependencias del store)
//
// Un «plano» describe un tablero listo para trabajar: tarjetas de nota o de
// cálculo + los cables entre ellas. Lo producen tres fuentes que comparten el
// mismo formato:
//   · la IA (/api/oracle/blueprint, validada con `blueprintFromAi`),
//   · las plantillas locales (0 ms, sin IA),
//   · las plantillas propias guardadas en localStorage.
// El texto de las notas usa las marcas ligeras de siempre: "# título",
// "- viñeta", "- [ ] tarea".
// ============================================================================

import { SHEET_MAX_ROWS, computeSheet, parseLooseNumber } from "@/lib/canvas/sheet";

export interface BlueprintPosition {
  x: number;
  y: number;
}

interface BlueprintCardBase {
  title: string;
  tag: string;
  /** Rejilla del flujo horizontal (se usa si no hay `pos`). */
  col?: number;
  row?: number;
  /** Posición exacta relativa a la esquina del tablero (plantillas guardadas). */
  pos?: BlueprintPosition;
}

export interface BlueprintNoteCard extends BlueprintCardBase {
  kind: "note";
  text: string;
}

export interface BlueprintCalcCard extends BlueprintCardBase {
  kind: "calc";
  description: string;
  /** Texto crudo de cada celda: "A1" → "Concepto", "B7" → "=SUM(B2:B6)". */
  cells: Record<string, string>;
  rows: number;
  columns: number;
}

export type BlueprintCard = BlueprintNoteCard | BlueprintCalcCard;

export interface BlueprintLink {
  /** Índices en `cards`. */
  from: number;
  to: number;
  label?: string;
}

export interface BoardBlueprint {
  name: string;
  description?: string;
  /** El orden importa: en el teléfono la pila sigue este orden de prioridad. */
  cards: BlueprintCard[];
  links: BlueprintLink[];
}

// ----------------------------------------------------------------------------
// Contrato del JSON que devuelve la IA
// ----------------------------------------------------------------------------

export interface AiBoardJson {
  title?: unknown;
  summary?: { date?: unknown; attendees?: unknown; goal?: unknown } | unknown;
  timeline?: unknown;
  budget?: unknown;
  logistics?: unknown;
  roles?: unknown;
}

const clip = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").replace(/[*_`#]/g, "").trim().slice(0, max) : "";

const listOf = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);

/** Texto de una partida del JSON, tolerando cadenas sueltas o `{when, what}`. */
function pairText(entry: unknown, keys: [string, string], joiner: string): string {
  if (typeof entry === "string") return clip(entry, 160);
  if (!entry || typeof entry !== "object") return "";
  const o = entry as Record<string, unknown>;
  const a = clip(o[keys[0]], 60);
  const b = clip(o[keys[1]], 140);
  return a && b ? `${a}${joiner}${b}` : a || b;
}

/** Monto numérico razonable a partir de lo que mande la IA (número o «$1.200»). */
function amountOf(value: unknown): number {
  const n = typeof value === "number" ? value : parseLooseNumber(String(value ?? "")) ?? 0;
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 1_000_000_000) : 0;
}

/** Hoja de presupuesto: concepto + monto y una fila de total con fórmula. */
export function budgetCalcCard(
  items: { item: string; amount: number }[],
  extra: Partial<BlueprintCalcCard> = {}
): BlueprintCalcCard {
  // Una fila libre entre las partidas y el total: el total ya la suma (para añadir una partida).
  const rows = items.slice(0, SHEET_MAX_ROWS - 3);
  const cells: Record<string, string> = { A1: "Concepto", B1: "Monto" };
  rows.forEach((row, index) => {
    cells[`A${index + 2}`] = row.item;
    cells[`B${index + 2}`] = String(row.amount);
  });
  const totalRow = rows.length + 3;
  cells[`A${totalRow}`] = "Total";
  cells[`B${totalRow}`] = `=SUM(B2:B${totalRow - 1})`;
  return {
    kind: "calc",
    title: "Presupuesto base",
    tag: "PRESUPUESTO",
    description:
      "Montos de ejemplo estimados: toca una cifra de la columna Monto y cámbiala; el total se recalcula al instante.",
    cells,
    rows: totalRow,
    columns: 2,
    ...extra,
  };
}

const lines = (...parts: string[]) => parts.join("\n");

/** Datos mínimos por si la IA omite una sección: el tablero nunca queda cojo. */
const FALLBACK = {
  timeline: [
    "Definir fecha, lugar y responsables",
    "Confirmar presupuesto y proveedores",
    "Comunicar la convocatoria",
    "Preparación y ensayo general",
    "Día del evento",
    "Cierre y balance",
  ],
  budget: [
    { item: "Lugar / espacio", amount: 0 },
    { item: "Materiales", amount: 0 },
    { item: "Comida y bebida", amount: 0 },
    { item: "Imprevistos", amount: 0 },
  ],
  logistics: ["Reservar el espacio", "Comprar materiales", "Preparar la comunicación", "Revisar permisos", "Confirmar asistentes"],
  roles: [
    "Coordinación general — decide y da seguimiento",
    "Logística — espacio, materiales y compras",
    "Comunicación — convocatoria y redes",
    "Finanzas — presupuesto y pagos",
  ],
};

/**
 * Convierte el JSON del modelo en un plano de 5 tarjetas conectadas
 * (Resumen → Cronograma → Presupuesto, Cronograma → Logística, Resumen → Roles).
 * Recorta textos, limita cantidades y rellena lo que falte.
 */
export function blueprintFromAi(raw: unknown, phrase: string): BoardBlueprint {
  const json = (raw && typeof raw === "object" ? raw : {}) as AiBoardJson;
  const summary = (json.summary && typeof json.summary === "object" ? json.summary : {}) as Record<string, unknown>;

  const name = clip(json.title, 80) || clip(phrase, 80) || "Mi evento";
  const date = clip(summary.date, 80) || "Por definir";
  const attendees = clip(summary.attendees, 60) || "Por definir";
  const goal = clip(summary.goal, 220) || clip(phrase, 220);

  const timeline = listOf(json.timeline, 6).map((e) => pairText(e, ["when", "what"], " — ")).filter(Boolean);
  const logistics = listOf(json.logistics, 8).map((e) => clip(typeof e === "string" ? e : (e as Record<string, unknown>)?.task, 140)).filter(Boolean);
  const roles = listOf(json.roles, 6).map((e) => pairText(e, ["role", "duty"], " — ")).filter(Boolean);
  const budget = listOf(json.budget, SHEET_MAX_ROWS - 3)
    .map((e) => {
      const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      return { item: clip(o.item, 48), amount: amountOf(o.amount) };
    })
    .filter((row) => row.item);

  const cards: BlueprintCard[] = [
    {
      kind: "note",
      title: "Resumen y meta",
      tag: "RESUMEN",
      col: 0,
      row: 0,
      text: lines(`# ${name}`, `- Fecha tentativa: ${date}`, `- Asistentes estimados: ${attendees}`, `- Objetivo: ${goal}`),
    },
    {
      kind: "note",
      title: "Cronograma",
      tag: "CRONOGRAMA",
      col: 1,
      row: 0,
      text: (timeline.length >= 3 ? timeline : FALLBACK.timeline.slice(0, 5))
        .map((entry) => `- ${entry}`)
        .join("\n"),
    },
    budgetCalcCard(budget.length >= 2 ? budget : FALLBACK.budget, { col: 2, row: 0 }),
    {
      kind: "note",
      title: "Logística y pendientes",
      tag: "LOGÍSTICA",
      col: 1,
      row: 1,
      text: (logistics.length >= 3 ? logistics : FALLBACK.logistics).map((t) => `- [ ] ${t}`).join("\n"),
    },
    {
      kind: "note",
      title: "Responsables y roles",
      tag: "ROLES",
      col: 0,
      row: 1,
      text: lines(
        ...(roles.length >= 2 ? roles : FALLBACK.roles).map((r) => `- [ ] ${r} · Asignar a: ___`)
      ),
    },
  ];

  return {
    name,
    description: goal,
    cards,
    links: [
      { from: 0, to: 1, label: "Plan" },
      { from: 1, to: 2, label: "Costos" },
      { from: 1, to: 3, label: "Preparativos" },
      { from: 0, to: 4, label: "Equipo" },
    ],
  };
}

// ----------------------------------------------------------------------------
// Validación de planos guardados (localStorage puede traer cualquier cosa)
// ----------------------------------------------------------------------------

const asNumber = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Lee un plano guardado y descarta lo que no encaje; `null` si no sirve. */
export function sanitizeStoredBlueprint(value: unknown): BoardBlueprint | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const rawCards = Array.isArray(o.cards) ? o.cards.slice(0, 20) : [];
  const cards: BlueprintCard[] = [];
  const keep: number[] = [];

  rawCards.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const c = entry as Record<string, unknown>;
    const base = {
      title: clip(c.title, 80) || "Tarjeta",
      tag: clip(c.tag, 20) || "NOTA",
      ...(typeof c.col === "number" ? { col: c.col } : {}),
      ...(typeof c.row === "number" ? { row: c.row } : {}),
      ...(c.pos && typeof c.pos === "object"
        ? { pos: { x: asNumber((c.pos as BlueprintPosition).x, 0), y: asNumber((c.pos as BlueprintPosition).y, 0) } }
        : {}),
    };
    if (c.kind === "note" && typeof c.text === "string") {
      cards.push({ ...base, kind: "note", text: c.text.slice(0, 8000) });
      keep.push(index);
    } else if (c.kind === "calc" && c.cells && typeof c.cells === "object") {
      const cells: Record<string, string> = {};
      for (const [address, text] of Object.entries(c.cells as Record<string, unknown>).slice(0, 80)) {
        if (/^[A-D]\d{1,2}$/.test(address) && typeof text === "string") cells[address] = text.slice(0, 120);
      }
      cards.push({
        ...base,
        kind: "calc",
        description: typeof c.description === "string" ? c.description.slice(0, 400) : "",
        cells,
        rows: Math.min(Math.max(asNumber(c.rows, 6), 1), SHEET_MAX_ROWS),
        columns: Math.min(Math.max(asNumber(c.columns, 2), 1), 4),
      });
      keep.push(index);
    }
  });
  if (cards.length === 0) return null;

  const links: BlueprintLink[] = [];
  for (const entry of Array.isArray(o.links) ? o.links.slice(0, 40) : []) {
    if (!entry || typeof entry !== "object") continue;
    const l = entry as Record<string, unknown>;
    const from = keep.indexOf(asNumber(l.from, -1));
    const to = keep.indexOf(asNumber(l.to, -1));
    if (from >= 0 && to >= 0 && from !== to) {
      const label = clip(l.label, 60);
      links.push({ from, to, ...(label ? { label } : {}) });
    }
  }
  return { name: clip(o.name, 80) || "Plantilla", description: clip(o.description, 220), cards, links };
}

/**
 * Texto con marcas ligeras de un cuaderno (para editarlo en un área de texto o
 * guardarlo en una plantilla). Es el inverso de `parseAiTextContent`. Con
 * `resetChecks` las tareas vuelven sin marcar (plantillas).
 */
export function noteDataToText(
  textBlocks: { type: "heading" | "paragraph" | "bullet"; text: string }[],
  checklistItems: { text: string; checked: boolean }[],
  resetChecks = false
): string {
  return [
    ...textBlocks.map((b) => (b.type === "heading" ? `# ${b.text}` : b.type === "bullet" ? `- ${b.text}` : b.text)),
    ...checklistItems.map((c) => `- [${c.checked && !resetChecks ? "x" : " "}] ${c.text}`),
  ].join("\n");
}

/** Recalcula las celdas de una tarjeta de cálculo (para guardar `computed` junto a `raw`). */
export const computeCalcCells = (cells: Record<string, string>) => computeSheet(cells);
