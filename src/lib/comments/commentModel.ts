// ============================================================================
// ANDROS — MODELO DE COMENTARIOS DEL TABLERO (funciones puras, sin store)
// Filas de `workspace_comments` (supabase/schema.sql §12) y mensajes de la
// sala en vivo pasan por `sanitizeComment`: nada llega a la interfaz sin
// validar tipos y longitudes.
// ============================================================================

export const COMMENT_MAX_CHARS = 2000;
export const COMMENT_AUTHOR_MAX_CHARS = 120;

export interface WorkspaceComment {
  id: string;
  workspaceId: string;
  /** `null` = comentario general del tablero; si no, id de la tarjeta. */
  nodeId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  resolved: boolean;
  /** ISO 8601. */
  createdAt: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Fila de Supabase (snake_case) o comentario ya normalizado (camelCase). */
export function sanitizeComment(raw: unknown): WorkspaceComment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id).trim();
  const workspaceId = str(o.workspaceId ?? o.workspace_id).trim();
  const authorId = str(o.authorId ?? o.author_id).trim();
  const body = str(o.body).trim().slice(0, COMMENT_MAX_CHARS);
  if (!id || id.length > 64 || !workspaceId || !authorId || !body) return null;
  const nodeRaw = o.nodeId ?? o.node_id;
  const nodeId = typeof nodeRaw === "string" && nodeRaw.trim() ? nodeRaw.trim().slice(0, 120) : null;
  const createdRaw = str(o.createdAt ?? o.created_at);
  const createdAt = Number.isFinite(Date.parse(createdRaw)) ? createdRaw : new Date(0).toISOString();
  return {
    id,
    workspaceId,
    nodeId,
    authorId,
    authorName: str(o.authorName ?? o.author_name).trim().slice(0, COMMENT_AUTHOR_MAX_CHARS) || "Persona de Andros",
    body,
    resolved: o.resolved === true,
    createdAt,
  };
}

/** Más recientes primero (orden estable por id en empates). */
export function sortComments(list: WorkspaceComment[]): WorkspaceComment[] {
  return [...list].sort((a, b) => {
    const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/** Comentarios abiertos (sin resolver) por tarjeta: para el contador de cada una. */
export function openCountsByNode(list: WorkspaceComment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of list) {
    if (c.resolved || !c.nodeId) continue;
    counts[c.nodeId] = (counts[c.nodeId] ?? 0) + 1;
  }
  return counts;
}

/** «hace 5 min», «ayer», «12 nov» (sin librerías, en español). */
export function relativeTimeEs(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "ahora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return new Date(at).toLocaleDateString("es", { day: "numeric", month: "short" });
}
