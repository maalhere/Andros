// ============================================================================
// ANDROS — CANAL DE ALERTA UNIFICADA DE IA (funciones puras, sin store)
// (Sprint 18) Una sola bandeja para todo lo que la IA detecta o le reportan:
//   · descuadres del detector anti-malentendidos (`ImpactAlertEntry`), y
//   · reportes de personas a la IA («@IA se retrasó el proveedor 2 días»),
//     evaluados por /api/oracle/cde-report o, sin IA, por `evaluateReportLocally`.
// `unifyAlerts` quita duplicados exactos (mismo texto y mismas tarjetas) y
// junta en UNA alerta todo lo que afecta a las mismas tarjetas (o, si no hay
// tarjetas, a la misma área). Lo que ya sigue una Ficha de Resolución o lo
// que descartaste deja de mostrarse.
// ============================================================================

import type { ImpactAlertEntry } from "@/lib/canvas/impact";
import { areaKey, canonicalArea, normalizeAreaName } from "./areas";

export type AlertSeverity = "warning" | "info";
export type AlertSource = "impact" | "report";

/** Evaluación de un reporte (lo que guarda la fila `kind = 'ai-alert'` del chat). */
export interface ReportAlert {
  id: string;
  summary: string;
  severity: AlertSeverity;
  affectedNodeIds: string[];
  affectedAreas: string[];
  suggestedAction: string;
  reporterName: string;
  reporterId: string | null;
  /** Mensaje original (sin la mención @IA). */
  message: string;
  createdAt: number;
  /** `ai` = lo evaluó la IA; `local` = respaldo sin IA (palabras clave). */
  engine: "ai" | "local";
}

export interface AlertReason {
  sourceId: string;
  source: AlertSource;
  severity: AlertSeverity;
  summary: string;
  suggestedAction: string;
  by: string | null;
  at: number;
}

export interface UnifiedAlert {
  id: string;
  severity: AlertSeverity;
  headline: string;
  affectedNodeIds: string[];
  affectedAreas: string[];
  notifyWho: string | null;
  suggestedAction: string;
  /** Motivos distintos (sin duplicados exactos), el más reciente primero. */
  reasons: AlertReason[];
  /** Todas las alertas de origen (incluidos duplicados): para seguirlas o descartarlas juntas. */
  sourceIds: string[];
  /** Veces que se detectó o reportó (incluye duplicados). */
  occurrences: number;
  createdAt: number;
  updatedAt: number;
}

export interface UnifyInput {
  impact: readonly ImpactAlertEntry[];
  reports: readonly ReportAlert[];
  /** Alertas que ya sigue una Ficha de Resolución. */
  tracked?: ReadonlySet<string>;
  /** Alertas descartadas en este dispositivo. */
  dismissed?: ReadonlySet<string>;
  /** Tarjetas que siguen en el lienzo (las demás se ignoran). */
  validNodeIds?: ReadonlySet<string>;
}

interface Candidate extends AlertReason {
  nodes: string[];
  areas: string[];
  notifyWho: string | null;
}

/** Huella para quitar duplicados exactos: texto normalizado + tarjetas + áreas. */
export function alertFingerprint(summary: string, nodes: readonly string[], areas: readonly string[]): string {
  const text = areaKey(summary).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return `${text}|${[...nodes].sort().join(",")}|${[...areas].map(areaKey).sort().join(",")}`;
}

function candidatesFrom(input: UnifyInput): Candidate[] {
  const skip = (id: string) => input.tracked?.has(id) || input.dismissed?.has(id);
  const valid = (id: string) => !input.validNodeIds || input.validNodeIds.has(id);
  const out: Candidate[] = [];
  for (const a of input.impact) {
    if (skip(a.id) || !valid(a.targetNodeId)) continue;
    out.push({
      sourceId: a.id,
      source: "impact",
      severity: a.severity,
      summary: a.summary,
      suggestedAction: a.suggestedAction,
      by: a.authorName ?? null,
      at: a.createdAt,
      nodes: [a.targetNodeId],
      areas: [],
      notifyWho: a.notifyWho,
    });
  }
  for (const r of input.reports) {
    if (skip(r.id)) continue;
    const nodes = r.affectedNodeIds.filter(valid);
    out.push({
      sourceId: r.id,
      source: "report",
      severity: r.severity,
      summary: r.summary,
      suggestedAction: r.suggestedAction,
      by: r.reporterName || null,
      at: r.createdAt,
      nodes,
      areas: r.affectedAreas,
      notifyWho: r.affectedAreas.length > 0 ? r.affectedAreas.map((a) => `@${a}`).join(", ") : null,
    });
  }
  return out;
}

/** Alertas unificadas: sin duplicados y una sola por grupo de tarjetas afectadas. */
export function unifyAlerts(input: UnifyInput): UnifiedAlert[] {
  const all = candidatesFrom(input).sort((a, b) => a.at - b.at || a.sourceId.localeCompare(b.sourceId));

  // 1. Duplicados exactos → una sola entrada (se cuentan las repeticiones).
  const byPrint = new Map<string, { first: Candidate; ids: string[]; latest: number }>();
  for (const c of all) {
    const print = alertFingerprint(c.summary, c.nodes, c.areas);
    const hit = byPrint.get(print);
    if (hit) {
      hit.ids.push(c.sourceId);
      hit.latest = Math.max(hit.latest, c.at);
    } else {
      byPrint.set(print, { first: c, ids: [c.sourceId], latest: c.at });
    }
  }
  const unique = [...byPrint.values()];

  // 2. Agrupar: comparten alguna tarjeta, o (sin tarjetas) comparten un área.
  const parent = unique.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const ownerOfNode = new Map<string, number>();
  const ownerOfArea = new Map<string, number>();
  unique.forEach(({ first }, i) => {
    for (const n of first.nodes) {
      const j = ownerOfNode.get(n);
      if (j === undefined) ownerOfNode.set(n, i);
      else union(i, j);
    }
    if (first.nodes.length === 0) {
      for (const a of first.areas) {
        const key = areaKey(a);
        const j = ownerOfArea.get(key);
        if (j === undefined) ownerOfArea.set(key, i);
        else union(i, j);
      }
    }
  });

  const groups = new Map<number, typeof unique>();
  unique.forEach((entry, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), entry]);
  });

  const result: UnifiedAlert[] = [];
  for (const members of groups.values()) {
    const reasons = members
      .map(({ first, latest }) => ({
        sourceId: first.sourceId,
        source: first.source,
        severity: first.severity,
        summary: first.summary,
        suggestedAction: first.suggestedAction,
        by: first.by,
        at: latest,
      }))
      .sort((a, b) => b.at - a.at || a.sourceId.localeCompare(b.sourceId));
    const warning = reasons.some((r) => r.severity === "warning");
    const lead = reasons.find((r) => r.severity === (warning ? "warning" : "info")) ?? reasons[0];
    const sourceIds = members.flatMap((m) => m.ids);
    const nodes = [...new Set(members.flatMap((m) => m.first.nodes))];
    const areas: string[] = [];
    for (const a of members.flatMap((m) => m.first.areas)) {
      if (!areas.some((x) => areaKey(x) === areaKey(a))) areas.push(a);
    }
    const notify = members.map((m) => m.first.notifyWho).find(Boolean) ?? null;
    result.push({
      id: `ua-${[...sourceIds].sort()[0]}`,
      severity: warning ? "warning" : "info",
      headline: lead.summary,
      affectedNodeIds: nodes,
      affectedAreas: areas,
      notifyWho: notify,
      suggestedAction: lead.suggestedAction || reasons.find((r) => r.suggestedAction)?.suggestedAction || "",
      reasons,
      sourceIds,
      occurrences: sourceIds.length,
      createdAt: Math.min(...members.map((m) => m.first.at)),
      updatedAt: Math.max(...members.map((m) => m.latest)),
    });
  }
  return result.sort(
    (a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1) || b.updatedAt - a.updatedAt
  );
}

// ----------------------------------------------------------------------------
// Validación de la evaluación guardada (jsonb `alert` del chat)
// ----------------------------------------------------------------------------

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function sanitizeReportAlert(raw: unknown, fallback: { id: string; createdAt: number; reporterName: string; reporterId: string | null }): ReportAlert | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const summary = str(r.summary, 220);
  if (!summary) return null;
  const nodes = [...new Set((Array.isArray(r.affectedNodeIds) ? r.affectedNodeIds : []).map((x) => str(x, 120)).filter(Boolean))].slice(0, 8);
  const areas: string[] = [];
  for (const a of Array.isArray(r.affectedAreas) ? r.affectedAreas : []) {
    const name = normalizeAreaName(a);
    if (name && !areas.some((x) => areaKey(x) === areaKey(name))) areas.push(name);
    if (areas.length >= 6) break;
  }
  return {
    id: fallback.id,
    summary,
    severity: r.severity === "info" ? "info" : "warning",
    affectedNodeIds: nodes,
    affectedAreas: areas,
    suggestedAction: str(r.suggestedAction, 180),
    reporterName: fallback.reporterName,
    reporterId: fallback.reporterId,
    message: str(r.message, 600),
    createdAt: fallback.createdAt,
    engine: r.engine === "local" ? "local" : "ai",
  };
}

// ----------------------------------------------------------------------------
// Respaldo sin IA: evaluación local de un reporte (0 ms, $0)
// ----------------------------------------------------------------------------

export interface ReportCardInput {
  id: string;
  title: string;
  area?: string;
  text: string;
}

export interface ReportEvaluation {
  isIssue: boolean;
  severity: AlertSeverity;
  summary: string;
  affectedNodeIds: string[];
  affectedAreas: string[];
  suggestedAction: string;
}

const STOPWORDS = new Set(
  "para pero como este esta estos estas ese esa esos esas aqui alli donde cuando porque sobre entre desde hasta hacia tiene tienen hace hacer todo toda todos todas otro otra otros otras mismo misma algo nada cada solo muy mas menos ayer manana tarde noche semana semanas dias dia horas hora favor gracias revisar ahora sigue siguen".split(
    " "
  )
);

const ISSUE_RE =
  /(retras|atras|demor|falt|problem|cancel|fall[oóa]|error|no lleg|averi|rot[oa]|dañ|danad|sin stock|agotad|subi[oó]|baj[oó]|cambi[oó]|descuadr|urgent|bloque|incidenc|queja|reclam|perdid|exced|sobrecost|no alcanza)/i;
const DELAY_RE = /(retras|atras|demor|posterg|aplaz|no lleg)/i;
const MONEY_RE = /(presupuest|costo|coste|precio|pago|factur|monto|\$|dinero|sobrecost)/i;

/** Palabras con significado del mensaje (sin tildes, sin menciones, ≥ 4 letras). */
export function significantWords(text: string): string[] {
  const words = areaKey(text.replace(/@\S+/g, " "))
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)];
}

/** Raíz corta para que «proveedor» encuentre «proveedores» y «audio» encuentre «audios». */
const stem = (w: string) => (w.length > 6 ? w.slice(0, w.length - 2) : w);

export function evaluateReportLocally(
  message: string,
  cards: readonly ReportCardInput[],
  areas: readonly string[],
  mentionedAreas: readonly string[] = []
): ReportEvaluation {
  const clean = message.replace(/@IA\b/gi, " ").replace(/\s+/g, " ").trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const summary = (firstSentence.charAt(0).toLocaleUpperCase("es") + firstSentence.slice(1)).slice(0, 160) || "Reporte sin detalle";
  const issue = ISSUE_RE.test(clean);
  const stems = significantWords(clean).map(stem);

  const scored = cards
    .map((card) => {
      const title = areaKey(card.title);
      const body = areaKey(card.text);
      let score = 0;
      for (const s of stems) {
        if (title.includes(s)) score += 2;
        else if (body.includes(s)) score += 1;
      }
      return { card, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  const affected = scored.filter((x) => x.score >= Math.max(1, Math.ceil(best / 2))).slice(0, 4).map((x) => x.card);

  const affectedAreas: string[] = [];
  const pushArea = (raw: string | undefined) => {
    const name = raw ? canonicalArea(raw, areas) ?? normalizeAreaName(raw) : "";
    if (name && !affectedAreas.some((a) => areaKey(a) === areaKey(name))) affectedAreas.push(name);
  };
  mentionedAreas.forEach(pushArea);
  affected.forEach((c) => pushArea(c.area));
  const words = areaKey(clean);
  for (const a of areas) if (words.includes(areaKey(a))) pushArea(a);
  if (MONEY_RE.test(clean)) pushArea(canonicalArea("Presupuesto", areas) ?? undefined);

  const suggestedAction = DELAY_RE.test(clean)
    ? "Ajustar el cronograma y avisar a las áreas afectadas"
    : MONEY_RE.test(clean)
      ? "Revisar el presupuesto y confirmar el nuevo monto"
      : "Revisar las tarjetas afectadas y asignar un responsable";

  return {
    isIssue: issue,
    severity: issue ? "warning" : "info",
    summary,
    affectedNodeIds: affected.map((c) => c.id),
    affectedAreas: affectedAreas.slice(0, 6),
    suggestedAction,
  };
}
