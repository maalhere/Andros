// ============================================================================
// ANDROS — LLENADO RÁPIDO DE FICHAS DESDE NODOS CONECTADOS (Sprint 24)
// Funciones puras (0 ms, $0 API, sin cuota IA):
//   · `extractNodeFacts`: datos útiles de una tarjeta (área, responsable,
//     equipo, fecha, estado, proyecto, observaciones), según su tipo:
//       – nota «Área: X» → área y personas; «Coordinación: P» → proyecto y equipo;
//       – Ficha de Resolución → área, asignado, estado, fecha límite y descripción;
//       – ficha normal → su área y los campos que ya tienen dato;
//       – líneas «Responsable: Ana», «Fecha: 12/12/2026»… en cualquier nota.
//   · `fieldFactKind`: qué tipo de dato acepta cada campo (por etiqueta y clave).
//   · `buildFillSuggestions` / `applyFillSuggestions`: propuestas por campo y
//     aplicación SIN sobrescribir lo que la persona ya llenó (salvo que lo pida).
//   · `connectedContextSummary`: resumen estructurado para «Llenar con IA».
//   · `nodeReferenceOptions`: datos copiables de cualquier nodo (nombre,
//     estado, responsable…) para insertarlos en un campo de texto.
// ============================================================================

import type { EngineeringNodeData, FormField, FormSheetEngineeringNode, NodeConnection } from "@/types/workspace";
import { isFieldFilled } from "./formSchema";
import { areaKey, normalizeAreaName } from "@/lib/cde/areas";
import { RESOLUTION_STATUS_LABEL } from "@/lib/cde/resolution";

export type FactKind = "area" | "responsible" | "team" | "date" | "status" | "project" | "notes";

export const FACT_LABELS: Record<FactKind, string> = {
  area: "Área",
  responsible: "Responsable",
  team: "Equipo",
  date: "Fecha",
  status: "Estado",
  project: "Proyecto",
  notes: "Observaciones",
};

export interface NodeFact {
  kind: FactKind;
  value: string;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .trim();

const clip = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** Tarjetas unidas por cable (en cualquier sentido), sin repetir. */
export function neighborIds(nodeId: string, connections: readonly NodeConnection[]): string[] {
  const out: string[] = [];
  for (const c of connections) {
    const other = c.fromNodeId === nodeId ? c.toNodeId : c.toNodeId === nodeId ? c.fromNodeId : null;
    if (other && other !== nodeId && !out.includes(other)) out.push(other);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Tipo de dato de un campo (o de una etiqueta «Responsable: …»)
// ----------------------------------------------------------------------------

const KIND_PATTERNS: [FactKind, RegExp][] = [
  ["area", /\b(area|departamento|depto|seccion|unidad)\b/],
  ["responsible", /(responsable|encargad|asignad|a cargo|coordinador|lider|contacto)/],
  ["team", /\b(equipo|integrantes|participantes|personal|miembros)\b/],
  ["status", /\b(estado|estatus|status|situacion|avance)\b/],
  ["date", /\b(fecha|vence|vencimiento|plazo|limite|entrega|deadline)\b/],
  ["project", /\b(proyecto|evento|obra|cliente)\b/],
  ["notes", /\b(observacion(es)?|notas?|comentarios?|detalles?|descripcion|resumen)\b/],
];

/** Tipo de dato por texto: gana la palabra clave que aparece PRIMERO («Área responsable» → área). */
export function kindOfLabel(label: string): FactKind | null {
  const text = norm(label);
  let best: { kind: FactKind; index: number } | null = null;
  for (const [kind, re] of KIND_PATTERNS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = { kind, index: m.index };
  }
  return best?.kind ?? null;
}

/** Qué dato acepta un campo de ficha (`null` = ninguno: números, casillas, fotos). */
export function fieldFactKind(field: FormField): FactKind | null {
  if (field.type === "number" || field.type === "checkbox" || field.type === "photo") return null;
  if (field.type === "date") return "date";
  const kind = kindOfLabel(`${field.label} ${field.fieldKey.replace(/_/g, " ")}`);
  if (kind === "date" && field.type !== "text") return null;
  if (kind === "notes" && field.type === "select") return null;
  return kind;
}

/** «12/12/2026», «2026-12-12» o un ISO completo → «2026-12-12». */
export function toIsoDay(raw: string): string | null {
  const text = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(text);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if (d.getUTCMonth() !== +m[2] - 1) return null;
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/** Fecha local (AAAA-MM-DD) de un ISO con hora. */
function localDay(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ----------------------------------------------------------------------------
// Datos de una tarjeta
// ----------------------------------------------------------------------------

/** «Ana (@ana) · Editor · @Logística» → «Ana». */
function personName(line: string): string {
  return clip(line.replace(/^[-*•]\s*/, "").split(/\s+\(@|\s+·\s+/)[0] ?? "", 80);
}

const EMPTY_PEOPLE = /^(sin personas|proyecto personal|ninguna)/i;

function push(facts: NodeFact[], kind: FactKind, value: string | null | undefined): void {
  const v = clip(value ?? "", kind === "notes" ? 400 : 160);
  if (!v || facts.some((f) => f.kind === kind)) return;
  facts.push({ kind, value: v });
}

function factsFromLines(facts: NodeFact[], lines: readonly string[]): void {
  for (const line of lines) {
    const m = /^([^:]{2,40}):\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const kind = kindOfLabel(m[1]);
    if (!kind) continue;
    push(facts, kind, kind === "date" ? toIsoDay(m[2]) : kind === "area" ? normalizeAreaName(m[2]) : m[2]);
  }
}

export function extractNodeFacts(node: EngineeringNodeData): NodeFact[] {
  const facts: NodeFact[] = [];
  if (node.type === "sketch-note-node") {
    const d = node.sketchNoteData;
    const title = node.title.trim();
    const areaTitle = /^[ÁáAa]rea:\s*(.+)$/.exec(title);
    const coordTitle = /^Coordinaci[óo]n:\s*(.+)$/i.exec(title);
    if (areaTitle) push(facts, "area", normalizeAreaName(areaTitle[1]));
    if (coordTitle) push(facts, "project", coordTitle[1]);

    // Personas bajo «# Personas» / «# Equipo».
    const people: string[] = [];
    let heading = "";
    for (const b of d.textBlocks) {
      if (b.type === "heading") {
        heading = norm(b.text);
        continue;
      }
      if (/^(personas|equipo|integrantes|responsables?)$/.test(heading) && !EMPTY_PEOPLE.test(b.text.replace(/^[-*•]\s*/, ""))) {
        const name = personName(b.text);
        if (name) people.push(name);
      }
    }
    if (people.length > 0) {
      push(facts, "responsible", people[0]);
      push(facts, "team", people.join(", "));
    }
    const lines = [...d.textBlocks.map((b) => b.text), ...d.checklistItems.map((c) => c.text)];
    factsFromLines(facts, lines);
    if (!areaTitle && !coordTitle) {
      const firstText = d.textBlocks.find((b) => b.type === "paragraph" && !/^[^:]{2,40}:/.test(b.text))?.text;
      push(facts, "notes", firstText ?? node.summary);
    }
    return facts;
  }

  if (node.type === "form-sheet-node") {
    const data = node.formSheetData;
    const res = data.resolution;
    if (res) {
      push(facts, "area", res.area);
      push(facts, "responsible", res.assigneeName);
      push(facts, "status", RESOLUTION_STATUS_LABEL[res.status]);
      push(facts, "date", res.dueAt ? localDay(res.dueAt) : null);
      push(facts, "notes", res.description);
      return facts;
    }
    push(facts, "area", data.area);
    for (const f of data.fields) {
      if (!isFieldFilled(f) || typeof f.value !== "string") continue;
      const kind = fieldFactKind(f);
      if (!kind) continue;
      push(facts, kind, kind === "date" ? toIsoDay(f.value) : kind === "area" ? normalizeAreaName(f.value) : f.value);
    }
    push(facts, "project", data.batchLabel);
    return facts;
  }

  if (node.type === "ai-chat-node") push(facts, "notes", node.aiChatData.summary);
  else if (node.type === "resource-link-node") push(facts, "notes", node.resourceLinkData.description);
  else push(facts, "notes", node.summary);
  return facts;
}

// ----------------------------------------------------------------------------
// Propuestas por campo
// ----------------------------------------------------------------------------

export interface FillSuggestion {
  /** Id estable de la propuesta («campo|nodo»). */
  id: string;
  fieldId: string;
  fieldLabel: string;
  kind: FactKind;
  value: string;
  sourceNodeId: string;
  sourceTitle: string;
  /** El campo ya tiene dato: aplicarla lo sobrescribe (requiere confirmación). */
  overwrites: boolean;
  currentValue: string;
}

export interface FillPlan {
  suggestions: FillSuggestion[];
  /** Área de la ficha (si no tiene) sacada de un nodo de Área conectado. */
  area: { value: string; sourceNodeId: string; sourceTitle: string } | null;
  /** Nodos conectados que aportan algo. */
  sourceCount: number;
}

/** Prioridad de las fuentes: Área > Coordinación > fichas > el resto. */
function sourceRank(node: EngineeringNodeData): number {
  if (node.type === "sketch-note-node" && /^[ÁáAa]rea:/.test(node.title)) return 0;
  if (node.type === "sketch-note-node" && /^Coordinaci[óo]n:/i.test(node.title)) return 1;
  if (node.type === "form-sheet-node" && node.formSheetData.resolution) return 2;
  if (node.type === "form-sheet-node") return 3;
  return 4;
}

function valueFits(field: FormField, kind: FactKind, value: string): string | null {
  if (field.type === "date") return kind === "date" ? toIsoDay(value) : null;
  if (field.type === "select") {
    const option = (field.options ?? []).find((o) => norm(o) === norm(value) || norm(o).startsWith(norm(value)));
    if (option) return option;
    // «Completado» ↔ «Resuelto» / «Cerrado», «Pendiente» ↔ «Abierto».
    const done = /^(completad|resuelt|cerrad|hech|terminad|listo)/;
    const open = /^(pendiente|abiert|en curso|por hacer|rojo)/;
    const want = done.test(norm(value)) ? done : open.test(norm(value)) ? open : null;
    return want ? (field.options ?? []).find((o) => want.test(norm(o))) ?? null : null;
  }
  return value;
}

export function buildFillSuggestions(sheet: FormSheetEngineeringNode, neighbors: readonly EngineeringNodeData[]): FillPlan {
  const sources = neighbors
    .filter((n) => n.id !== sheet.id)
    .map((n) => ({ node: n, facts: extractNodeFacts(n) }))
    .filter((s) => s.facts.length > 0)
    .sort((a, b) => sourceRank(a.node) - sourceRank(b.node));

  const suggestions: FillSuggestion[] = [];
  const contributing = new Set<string>();
  for (const field of sheet.formSheetData.fields) {
    const kind = fieldFactKind(field);
    if (!kind) continue;
    const current = typeof field.value === "string" ? field.value : "";
    for (const { node, facts } of sources) {
      const fact = facts.find((f) => f.kind === kind);
      if (!fact) continue;
      const value = valueFits(field, kind, fact.value);
      if (!value || norm(value) === norm(current)) continue;
      if (suggestions.some((s) => s.fieldId === field.id && norm(s.value) === norm(value))) continue;
      suggestions.push({
        id: `${field.id}|${node.id}`,
        fieldId: field.id,
        fieldLabel: field.label,
        kind,
        value,
        sourceNodeId: node.id,
        sourceTitle: node.title,
        overwrites: isFieldFilled(field),
        currentValue: current,
      });
      contributing.add(node.id);
    }
  }

  let area: FillPlan["area"] = null;
  if (!sheet.formSheetData.area) {
    for (const { node, facts } of sources) {
      const fact = facts.find((f) => f.kind === "area");
      if (fact) {
        area = { value: normalizeAreaName(fact.value), sourceNodeId: node.id, sourceTitle: node.title };
        contributing.add(node.id);
        break;
      }
    }
  }
  return { suggestions, area, sourceCount: contributing.size };
}

/** Primera propuesta de cada campo vacío (lo que hace «Aplicar todo»). */
export function defaultPicks(plan: FillPlan): FillSuggestion[] {
  const out: FillSuggestion[] = [];
  for (const s of plan.suggestions) {
    if (s.overwrites || out.some((p) => p.fieldId === s.fieldId)) continue;
    out.push(s);
  }
  return out;
}

/**
 * Aplica propuestas a los campos. Sin `overwrite`, un campo que ya tiene dato
 * NO se toca (se cuenta en `skipped`). Una sola propuesta por campo.
 */
export function applyFillSuggestions(
  fields: readonly FormField[],
  picks: readonly FillSuggestion[],
  options: { overwrite?: boolean } = {}
): { fields: FormField[]; applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  const used = new Set<string>();
  const next = fields.map((field) => {
    const pick = picks.find((p) => p.fieldId === field.id);
    if (!pick || used.has(field.id)) return field;
    used.add(field.id);
    if (isFieldFilled(field) && !options.overwrite) {
      skipped += 1;
      return field;
    }
    const value = valueFits(field, pick.kind, pick.value);
    if (!value) {
      skipped += 1;
      return field;
    }
    applied += 1;
    return { ...field, value, needsReview: undefined };
  });
  return { fields: next, applied, skipped };
}

/** ¿Todos los campos con texto de la ficha están vacíos? (para el llenado automático al conectar). */
export function sheetIsBlank(sheet: FormSheetEngineeringNode): boolean {
  return sheet.formSheetData.fields.every((f) => f.type === "photo" || !isFieldFilled(f));
}

// ----------------------------------------------------------------------------
// Contexto para «Llenar con IA» y referencias rápidas
// ----------------------------------------------------------------------------

/** Resumen estructurado de los nodos conectados a una ficha (≤ 2 400 caracteres). */
export function connectedContextSummary(
  sheetId: string,
  nodes: readonly EngineeringNodeData[],
  connections: readonly NodeConnection[]
): string {
  const ids = neighborIds(sheetId, connections);
  const lines: string[] = [];
  for (const id of ids.slice(0, 8)) {
    const node = nodes.find((n) => n.id === id);
    if (!node) continue;
    const facts = extractNodeFacts(node);
    const detail = facts.map((f) => `${FACT_LABELS[f.kind]}: ${f.value}`).join("; ");
    lines.push(`- «${clip(node.title, 80)}»${detail ? ` → ${detail}` : ""}`);
  }
  return lines.join("\n").slice(0, 2400);
}

export interface NodeReference {
  label: string;
  value: string;
}

/** Datos copiables de un nodo: su nombre y los datos que tenga (estado, responsable…). */
export function nodeReferenceOptions(node: EngineeringNodeData): NodeReference[] {
  const out: NodeReference[] = [{ label: "Nombre", value: clip(node.title, 160) }];
  for (const f of extractNodeFacts(node)) {
    if (f.kind === "notes") continue;
    const value = f.kind === "area" ? `@${f.value}` : f.value;
    if (!out.some((o) => areaKey(o.value) === areaKey(value))) out.push({ label: FACT_LABELS[f.kind], value });
  }
  return out;
}

/** Inserta un dato al final del texto de un campo (con separador). */
export function appendReference(current: string, value: string): string {
  const base = current.replace(/\s+$/, "");
  if (!base) return value;
  return `${base} ${value}`;
}
