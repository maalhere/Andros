// ============================================================================
// ANDROS — MODELO DEL CHAT DEL LIENZO (funciones puras, sin store)
// Filas de `workspace_chat_messages` (supabase/schema.sql §18) → mensajes
// validados. `author_name` y `author_area` los pone el trigger de la base.
// ============================================================================

import { sanitizeMentions, type Mention } from "./mentions";
import { sanitizeReportAlert, type ReportAlert } from "./alerts";
import { normalizeAreaName } from "./areas";

export const CHAT_MAX_CHARS = 2000;

export interface ChatMessage {
  id: string;
  workspaceId: string;
  authorId: string;
  authorName: string;
  authorArea: string;
  body: string;
  mentions: Mention[];
  linkedNodeId: string | null;
  kind: "message" | "ai-alert";
  /** Solo en `ai-alert`: la evaluación de un reporte hecho a @IA. */
  alert: ReportAlert | null;
  /** ISO 8601. */
  createdAt: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function sanitizeChatMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id).trim();
  const workspaceId = str(o.workspace_id ?? o.workspaceId).trim();
  const authorId = str(o.author_id ?? o.authorId).trim();
  const body = str(o.body).trim().slice(0, CHAT_MAX_CHARS);
  if (!id || id.length > 64 || !workspaceId || !authorId || !body) return null;
  const createdRaw = str(o.created_at ?? o.createdAt);
  const createdAt = Number.isFinite(Date.parse(createdRaw)) ? createdRaw : new Date(0).toISOString();
  const linkedRaw = str(o.linked_node_id ?? o.linkedNodeId).trim();
  const authorName = str(o.author_name ?? o.authorName).trim().slice(0, 120) || "Persona de Andros";
  const kind = (o.kind === "ai-alert" ? "ai-alert" : "message") as ChatMessage["kind"];
  const alert =
    kind === "ai-alert"
      ? sanitizeReportAlert(o.alert, {
          id: `rep-${id}`,
          createdAt: Date.parse(createdAt),
          reporterName: authorName,
          reporterId: authorId,
        })
      : null;
  return {
    id,
    workspaceId,
    authorId,
    authorName,
    authorArea: normalizeAreaName(o.author_area ?? o.authorArea),
    body,
    mentions: sanitizeMentions(o.mentions),
    linkedNodeId: linkedRaw ? linkedRaw.slice(0, 120) : null,
    kind: kind === "ai-alert" && !alert ? "message" : kind,
    alert,
    createdAt,
  };
}

/** Más antiguos primero (el chat se lee de arriba abajo). */
export function sortChat(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/** Reportes evaluados (para la alerta unificada). */
export function reportAlertsOf(list: readonly ChatMessage[]): ReportAlert[] {
  return list.filter((m) => m.kind === "ai-alert" && m.alert).map((m) => m.alert as ReportAlert);
}
