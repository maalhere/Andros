// ============================================================================
// ANDROS — FICHAS DE RESOLUCIÓN (semáforo Rojo / Verde con trazabilidad CDE)
// Funciones puras (cliente, servidor y scripts de verificación):
//   · Código correlativo por espacio: RES-001, RES-002…
//   · Ciclo de vida: Rojo «Pendiente» → Verde «Completado» (con quién y cuándo)
//     y, si hace falta, «Reabrir» (vuelve a Rojo; el historial lo conserva).
//   · `resolutionFields`: los mismos datos como campos de ficha, para que la
//     Vista Invitado, la exportación y la IA los lean sin conocer este tipo.
// ============================================================================

import type {
  EngineeringNodeData,
  FormField,
  ResolutionEvent,
  ResolutionMeta,
  ResolutionStatus,
} from "@/types/workspace";
import { normalizeAreaName } from "./areas";

export const RESOLUTION_TEMPLATE_ID = "cde-resolution";
export const RESOLUTION_CODE_TAG = "RES";
export const RESOLUTION_CATEGORY = "Resolución";
export const RESOLUTION_MAX_AFFECTED = 12;
export const RESOLUTION_MAX_HISTORY = 30;
export const RESOLUTION_DESCRIPTION_MAX = 600;

export const RESOLUTION_STATUS_LABEL: Record<ResolutionStatus, string> = {
  pending: "Pendiente",
  done: "Completado",
};

/** Color del semáforo en palabras (para lectores de pantalla y texto). */
export const RESOLUTION_STATUS_COLOR: Record<ResolutionStatus, string> = {
  pending: "Rojo",
  done: "Verde",
};

const CODE_RE = /^RES-(\d{1,6})$/;

export function formatResolutionCode(n: number): string {
  return `RES-${String(Math.max(1, Math.floor(n))).padStart(3, "0")}`;
}

/** Siguiente código libre: uno más que el mayor existente (huecos no se reutilizan). */
export function nextResolutionCode(existing: readonly string[]): string {
  let max = 0;
  for (const code of existing) {
    const n = Number(code.match(CODE_RE)?.[1] ?? 0);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return formatResolutionCode(max + 1);
}

export interface NewResolutionInput {
  existingCodes: readonly string[];
  description: string;
  area?: string;
  assigneeName?: string;
  assigneeId?: string | null;
  affectedNodeIds?: readonly string[];
  sourceAlertIds?: readonly string[];
  by: string;
  at: string;
}

const oneLine = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);
const uniq = (list: readonly string[], max: number) => [...new Set(list.filter(Boolean))].slice(0, max);

/** Ficha nueva: siempre nace en Rojo (Pendiente) con su evento «creada». */
export function createResolution(input: NewResolutionInput): ResolutionMeta {
  const by = oneLine(input.by, 120) || "Persona de Andros";
  return {
    code: nextResolutionCode(input.existingCodes),
    status: "pending",
    area: normalizeAreaName(input.area ?? ""),
    assigneeName: oneLine(input.assigneeName ?? "", 120),
    assigneeId: input.assigneeId ?? null,
    description: input.description.trim().slice(0, RESOLUTION_DESCRIPTION_MAX) || "Asunto por resolver",
    affectedNodeIds: uniq(input.affectedNodeIds ?? [], RESOLUTION_MAX_AFFECTED),
    sourceAlertIds: uniq(input.sourceAlertIds ?? [], 20),
    createdAt: input.at,
    createdBy: by,
    completedAt: null,
    completedBy: null,
    history: [{ at: input.at, by, action: "created" }],
  };
}

function withEvent(meta: ResolutionMeta, event: ResolutionEvent): ResolutionEvent[] {
  return [...meta.history, event].slice(-RESOLUTION_MAX_HISTORY);
}

/** Rojo → Verde. Registra quién y cuándo. Si ya estaba en Verde no cambia nada. */
export function completeResolution(meta: ResolutionMeta, by: string, at: string): ResolutionMeta {
  if (meta.status === "done") return meta;
  const who = oneLine(by, 120) || "Persona de Andros";
  return {
    ...meta,
    status: "done",
    completedAt: at,
    completedBy: who,
    history: withEvent(meta, { at, by: who, action: "completed" }),
  };
}

/** Verde → Rojo (algo volvió a fallar). El historial conserva el cierre anterior. */
export function reopenResolution(meta: ResolutionMeta, by: string, at: string): ResolutionMeta {
  if (meta.status === "pending") return meta;
  const who = oneLine(by, 120) || "Persona de Andros";
  return {
    ...meta,
    status: "pending",
    completedAt: null,
    completedBy: null,
    history: withEvent(meta, { at, by: who, action: "reopened" }),
  };
}

/** Título de la tarjeta: «RES-001 · Proveedor de audio retrasado». */
export function resolutionTitle(meta: ResolutionMeta): string {
  const short = oneLine(meta.description, 60);
  return `${meta.code} · ${short}`.slice(0, 120);
}

/** Fecha legible (es) para campos espejo y la tarjeta: «26 nov 2026, 10:42». */
export function formatResolutionDate(iso: string | null): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return new Date(at).toLocaleString("es", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Campos espejo (solo lectura de facto): la fuente de verdad es `resolution`,
 * estos campos se regeneran en cada cambio de estado.
 */
export function resolutionFields(meta: ResolutionMeta, titleOf: (nodeId: string) => string | null): FormField[] {
  const affected = meta.affectedNodeIds.map((id) => titleOf(id) ?? "Tarjeta eliminada");
  const field = (key: string, label: string, value: string, type: FormField["type"] = "text"): FormField => ({
    id: `res-${key}`,
    fieldKey: key,
    label,
    type,
    value,
    ...(type === "select" ? { options: [RESOLUTION_STATUS_LABEL.pending, RESOLUTION_STATUS_LABEL.done] } : {}),
  });
  return [
    field("codigo", "Código", meta.code),
    field("estado", "Estado", RESOLUTION_STATUS_LABEL[meta.status], "select"),
    field("area_responsable", "Área responsable", meta.area ? `@${meta.area}` : ""),
    field("asignado_a", "Asignado a", meta.assigneeName),
    field("descripcion", "Descripción", meta.description, "textarea"),
    field("tarjetas_afectadas", "Tarjetas afectadas", affected.join("\n"), "textarea"),
    field("creada", "Creada", `${formatResolutionDate(meta.createdAt)} · ${meta.createdBy}`),
    field("completada_por", "Completada por", meta.completedBy ?? ""),
    field("completada_el", "Completada el", formatResolutionDate(meta.completedAt)),
  ];
}

// ----------------------------------------------------------------------------
// Validación (nube, sala en vivo, .andros.zip)
// ----------------------------------------------------------------------------

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v: unknown): string | null => {
  const s = str(v, 40);
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};
const ids = (v: unknown, max: number): string[] =>
  uniq((Array.isArray(v) ? v : []).map((x) => str(x, 120).trim()), max);

export function sanitizeResolution(raw: unknown): ResolutionMeta | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const code = str(r.code, 12).trim();
  if (!CODE_RE.test(code)) return undefined;
  const status: ResolutionStatus = r.status === "done" ? "done" : "pending";
  const createdAt = iso(r.createdAt) ?? new Date(0).toISOString();
  const history: ResolutionEvent[] = (Array.isArray(r.history) ? r.history : [])
    .map((e): ResolutionEvent | null => {
      if (!e || typeof e !== "object") return null;
      const o = e as Record<string, unknown>;
      const at = iso(o.at);
      const action = o.action === "completed" || o.action === "reopened" || o.action === "created" ? o.action : null;
      return at && action ? { at, by: str(o.by, 120) || "Persona de Andros", action } : null;
    })
    .filter((e): e is ResolutionEvent => e !== null)
    .slice(-RESOLUTION_MAX_HISTORY);
  const completedAt = status === "done" ? iso(r.completedAt) : null;
  const assigneeId = str(r.assigneeId, 64).trim();
  return {
    code,
    status,
    area: normalizeAreaName(r.area),
    assigneeName: str(r.assigneeName, 120).trim(),
    assigneeId: assigneeId || null,
    description: str(r.description, RESOLUTION_DESCRIPTION_MAX).trim() || "Asunto por resolver",
    affectedNodeIds: ids(r.affectedNodeIds, RESOLUTION_MAX_AFFECTED),
    sourceAlertIds: ids(r.sourceAlertIds, 20),
    createdAt,
    createdBy: str(r.createdBy, 120).trim() || "Persona de Andros",
    completedAt,
    completedBy: status === "done" ? str(r.completedBy, 120).trim() || null : null,
    history: history.length > 0 ? history : [{ at: createdAt, by: str(r.createdBy, 120) || "Persona de Andros", action: "created" }],
  };
}

// ----------------------------------------------------------------------------
// Lectura del lienzo
// ----------------------------------------------------------------------------

export interface ResolutionCardRef {
  nodeId: string;
  title: string;
  meta: ResolutionMeta;
}

/** Fichas de Resolución del lienzo, ordenadas por código. */
export function listResolutions(nodes: readonly EngineeringNodeData[]): ResolutionCardRef[] {
  const out: ResolutionCardRef[] = [];
  for (const n of nodes) {
    if (n.type === "form-sheet-node" && n.formSheetData.resolution) {
      out.push({ nodeId: n.id, title: n.title, meta: n.formSheetData.resolution });
    }
  }
  return out.sort((a, b) => a.meta.code.localeCompare(b.meta.code, "es", { numeric: true }));
}

/** Conteo del semáforo: Rojo (pendientes) y Verde (completadas). */
export function countResolutions(nodes: readonly EngineeringNodeData[]): { pending: number; done: number } {
  let pending = 0;
  let done = 0;
  for (const r of listResolutions(nodes)) {
    if (r.meta.status === "done") done += 1;
    else pending += 1;
  }
  return { pending, done };
}

/** Ids de alertas que ya sigue alguna ficha (se ocultan de la barra de alertas). */
export function trackedAlertIds(nodes: readonly EngineeringNodeData[]): Set<string> {
  const set = new Set<string>();
  for (const r of listResolutions(nodes)) for (const id of r.meta.sourceAlertIds) set.add(id);
  return set;
}

export function existingResolutionCodes(nodes: readonly EngineeringNodeData[]): string[] {
  return listResolutions(nodes).map((r) => r.meta.code);
}
