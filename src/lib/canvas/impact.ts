// ============================================================================
// ANDROS — DETECTOR "ANTI-MALENTENDIDOS" (funciones puras, cliente y servidor)
//
// Cuando alguien guarda una edición en una tarjeta conectada, se comprueba en
// 0 ms si el cambio es IMPORTANTE (cambió un número, una fecha/hora o más de
// ~15 caracteres). Solo entonces se ofrece —o se lanza— la revisión con IA en
// /api/oracle/impact, que compara ANTES y DESPUÉS con las tarjetas conectadas
// directamente y devuelve, como mucho, 3 alertas concretas.
// ============================================================================

import type { EngineeringNodeData, NodeConnection } from "@/types/workspace";
import type { OracleIssue } from "@/types/oracle";
import { clipCleanly, MAX_TOTAL_CHARS, serializeNodeForContext } from "@/lib/canvas/contextGraph";

/** Más de este número de caracteres cambiados cuenta como cambio importante. */
export const TEXT_CHANGE_THRESHOLD = 15;
/** Límites de lo que viaja al endpoint (el servidor vuelve a recortar). */
export const IMPACT_MAX_SIDE_CHARS = 3000;
export const IMPACT_MAX_NEIGHBORS = 8;
export const IMPACT_MAX_ALERTS = 3;
const NEIGHBOR_MAX_CHARS = 2500;
const ROLES_MAX_CHARS = 1500;

export type ImpactSeverity = "warning" | "info";

/** Alerta tal como la devuelve el endpoint. */
export interface ImpactAlert {
  /** Tarjeta afectada (conectada directamente a la editada). */
  targetNodeId: string;
  severity: ImpactSeverity;
  /** 1 frase en español cotidiano. */
  summary: string;
  /** Rol o persona a avisar (si aparece en la tarjeta de roles) o `null`. */
  notifyWho: string | null;
  suggestedAction: string;
}

/** Alerta activa en el espacio (local o recibida de la sala en vivo). */
export interface ImpactAlertEntry extends ImpactAlert {
  id: string;
  /** Tarjeta cuya edición la provocó. */
  sourceNodeId: string;
  sourceTitle: string;
  targetTitle: string;
  createdAt: number;
  /** Nombre de quien hizo el cambio (si hay sesión). */
  authorName?: string;
}

export type ImpactRelation = "entrada" | "salida" | "ambas";

export interface ImpactNeighborInput {
  id: string;
  title: string;
  relation: ImpactRelation;
  via?: string;
  text: string;
}

export interface ImpactRequestBody {
  source: { id: string; title: string; before: string; after: string };
  neighbors: ImpactNeighborInput[];
  /** Tarjeta de roles/responsables NO conectada: solo para sugerir a quién avisar. */
  roles?: { title: string; text: string };
  apiKey?: string;
}

export type ImpactResponse =
  | { ok: true; hasConflict: boolean; alerts: ImpactAlert[]; model: string }
  | { ok: false; issue: OracleIssue };

// ----------------------------------------------------------------------------
// Filtro local (0 ms)
// ----------------------------------------------------------------------------

const NUMBER_RE = /\d+(?:[.,:]\d+)*/g;
const DATE_WORD_RE =
  /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|hoy|ma[ñn]ana|pasado ma[ñn]ana|mediod[ií]a|medianoche|am|pm|a\.\s?m\.|p\.\s?m\.)\b/gi;

function sortedMatches(text: string, re: RegExp): string {
  return (text.match(re) ?? []).map((m) => m.toLowerCase().replace(/\s+/g, "")).sort().join("|");
}

/** Caracteres que cambiaron (sin contar el principio y el final comunes). */
export function changedCharCount(before: string, after: string): number {
  let start = 0;
  const min = Math.min(before.length, after.length);
  while (start < min && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < min - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  return Math.max(before.length - start - end, after.length - start - end);
}

export type ChangeKind = "numeric" | "date" | "text";

/**
 * ¿El cambio merece revisión? `numeric`: cambió algún número (asistentes,
 * montos, cantidades, horas «18:30»); `date`: cambió un día o mes escrito;
 * `text`: más de ~15 caracteres distintos. `null`: retoque menor.
 */
export function detectSignificantChange(before: string, after: string): ChangeKind | null {
  if (before === after) return null;
  if (sortedMatches(before, NUMBER_RE) !== sortedMatches(after, NUMBER_RE)) return "numeric";
  if (sortedMatches(before, DATE_WORD_RE) !== sortedMatches(after, DATE_WORD_RE)) return "date";
  return changedCharCount(before, after) > TEXT_CHANGE_THRESHOLD ? "text" : null;
}

// ----------------------------------------------------------------------------
// Grafo: vecinos directos
// ----------------------------------------------------------------------------

export interface DirectNeighbor {
  node: EngineeringNodeData;
  relation: ImpactRelation;
  via?: string;
}

/** Tarjetas conectadas directamente (cables que entran o salen), sin repetir. */
export function directNeighbors(
  nodes: EngineeringNodeData[],
  connections: NodeConnection[],
  nodeId: string
): DirectNeighbor[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, DirectNeighbor>();
  for (const c of connections) {
    const outgoing = c.fromNodeId === nodeId;
    if (!outgoing && c.toNodeId !== nodeId) continue;
    const otherId = outgoing ? c.toNodeId : c.fromNodeId;
    if (otherId === nodeId) continue;
    const node = byId.get(otherId);
    if (!node) continue;
    const relation: ImpactRelation = outgoing ? "salida" : "entrada";
    const existing = out.get(otherId);
    if (existing) {
      if (existing.relation !== relation) existing.relation = "ambas";
      if (!existing.via && c.label) existing.via = c.label;
      continue;
    }
    out.set(otherId, { node, relation, ...(c.label ? { via: c.label } : {}) });
  }
  return [...out.values()];
}

/** `true` si la tarjeta tiene al menos un cable (entrante o saliente) válido. */
export function hasDirectNeighbors(
  nodes: EngineeringNodeData[],
  connections: NodeConnection[],
  nodeId: string
): boolean {
  return directNeighbors(nodes, connections, nodeId).length > 0;
}

/**
 * Texto comparable de una tarjeta (el mismo que ve la IA). Con el lienzo
 * (`graph`), una Ficha de Fórmula incluye su resultado ya recalculado.
 */
export function impactSnapshot(
  node: EngineeringNodeData,
  graph?: { nodes: EngineeringNodeData[]; connections: NodeConnection[] }
): string {
  return serializeNodeForContext(node, graph);
}

const ROLES_RE = /\b(roles?|responsables?|equipo|encargad[oa]s?)\b/i;

/**
 * Cuerpo de la petición: la tarjeta editada (antes/después), sus vecinas
 * directas y, si existe y no está conectada, la tarjeta de roles como
 * referencia para «a quién avisar». Todo cabe en el tope de 12 000 caracteres.
 */
export function buildImpactRequest(
  nodes: EngineeringNodeData[],
  connections: NodeConnection[],
  nodeId: string,
  before: string,
  after: string
): ImpactRequestBody | null {
  const source = nodes.find((n) => n.id === nodeId);
  if (!source) return null;
  const neighbors = directNeighbors(nodes, connections, nodeId).slice(0, IMPACT_MAX_NEIGHBORS);
  if (neighbors.length === 0) return null;

  const beforeText = clipCleanly(before, IMPACT_MAX_SIDE_CHARS);
  const afterText = clipCleanly(after, IMPACT_MAX_SIDE_CHARS);
  let room = MAX_TOTAL_CHARS - beforeText.length - afterText.length;

  const inputs: ImpactNeighborInput[] = [];
  for (const n of neighbors) {
    const share = Math.max(300, Math.min(NEIGHBOR_MAX_CHARS, Math.floor(room / Math.max(1, neighbors.length - inputs.length))));
    const text = clipCleanly(impactSnapshot(n.node, { nodes, connections }), share);
    room -= text.length;
    inputs.push({
      id: n.node.id,
      title: `${n.node.title}${n.node.codeTag ? ` [${n.node.codeTag}]` : ""}`.slice(0, 140),
      relation: n.relation,
      ...(n.via ? { via: n.via.slice(0, 60) } : {}),
      text,
    });
  }

  const linked = new Set([nodeId, ...neighbors.map((n) => n.node.id)]);
  const rolesNode = nodes.find(
    (n) => !linked.has(n.id) && (ROLES_RE.test(n.title) || ROLES_RE.test(n.codeTag ?? ""))
  );
  const roles =
    rolesNode && room > 400
      ? { title: rolesNode.title.slice(0, 120), text: clipCleanly(impactSnapshot(rolesNode, { nodes, connections }), Math.min(ROLES_MAX_CHARS, room - 100)) }
      : undefined;

  return {
    source: { id: source.id, title: source.title.slice(0, 140), before: beforeText, after: afterText },
    neighbors: inputs,
    ...(roles ? { roles } : {}),
  };
}

// ----------------------------------------------------------------------------
// Validación de alertas (respuesta del modelo y mensajes de la sala)
// ----------------------------------------------------------------------------

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Alerta recibida por la sala: se descarta cualquier campo inválido. */
export function sanitizeAlertEntry(raw: unknown): ImpactAlertEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const targetNodeId = str(r.targetNodeId, 120);
  const sourceNodeId = str(r.sourceNodeId, 120);
  const summary = str(r.summary, 220);
  if (!id || !targetNodeId || !sourceNodeId || !summary) return null;
  const notify = str(r.notifyWho, 80);
  const author = str(r.authorName, 80);
  return {
    id,
    targetNodeId,
    sourceNodeId,
    severity: r.severity === "info" ? "info" : "warning",
    summary,
    notifyWho: notify || null,
    suggestedAction: str(r.suggestedAction, 180),
    sourceTitle: str(r.sourceTitle, 140) || "Tarjeta",
    targetTitle: str(r.targetTitle, 140) || "Tarjeta",
    createdAt: typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    ...(author ? { authorName: author } : {}),
  };
}

/** Mensaje corto listo para chats de grupo o para decirlo en la sala de voz. */
export function alertShareText(alert: ImpactAlertEntry): string {
  const parts = [
    `Aviso de Andros: cambió «${alert.sourceTitle}» y «${alert.targetTitle}» quedó por revisar.`,
    alert.summary.endsWith(".") ? alert.summary : `${alert.summary}.`,
  ];
  if (alert.suggestedAction) {
    parts.push(`Sugerencia: ${alert.suggestedAction.replace(/\.$/, "")}.`);
  }
  if (alert.notifyWho) parts.push(`Avisar a: ${alert.notifyWho}.`);
  return parts.join(" ");
}
