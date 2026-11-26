// ============================================================================
// ANDROS — ACCIONES DEL CHAT DEL LIENZO (navegador)
//   · Enviar: se guarda con TU sesión (el trigger pone autor, nombre y área) y
//     se avisa a la sala con `chat:new` (los demás releen de Supabase).
//   · «Incidencia»: además crea al instante una Ficha de Resolución en Rojo.
//   · «@IA …»: la IA (o el respaldo local) evalúa qué tarjetas y áreas afecta
//     y lo guarda como UNA alerta del canal unificado (`kind = 'ai-alert'`).
//   · Borrar tiene «Deshacer» (se borra de verdad al expirar el aviso).
// ============================================================================

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useCdeStore } from "@/store/useCdeStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { isCanvasReadOnly } from "@/store/useCollabStore";
import { toast } from "@/store/useToastStore";
import { broadcastCollabEvent, collabEventBase } from "@/lib/collab/useCollabRoom";
import { mentionsAi, parseMentions, type Mention, type MentionDirectory } from "./mentions";
import { CdeSetupError, deleteChatMessage, insertChatMessage } from "./repository";
import { evaluateReport, reportCardsFrom } from "./aiClient";
import { createResolutionCard } from "./resolutionActions";
import type { ChatMessage } from "./chatModel";

/** Áreas y personas del espacio abierto para reconocer menciones. */
export function mentionDirectory(): MentionDirectory {
  const { areas, people } = useCdeStore.getState();
  return {
    areas,
    users: people.map((p) => ({ id: p.userId, username: p.username, name: p.name, area: p.area })),
  };
}

function notifyRoom(workspaceId: string): void {
  const base = collabEventBase();
  if (base && base.workspaceId === workspaceId) broadcastCollabEvent("chat:new", base);
}

function handleError(error: unknown, fallback: string): void {
  if (error instanceof CdeSetupError) {
    useCdeStore.getState().setChatStatus("setup-missing", null);
    return;
  }
  toast({ message: error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback, tone: "error" });
}

export interface SendOptions {
  linkedNodeId: string | null;
  /** Crear también una Ficha de Resolución (solo dueño y Editor). */
  incident: boolean;
}

/** Envía un mensaje. Devuelve `true` si quedó guardado. */
export async function sendChatMessage(rawBody: string, options: SendOptions): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  const user = useCloudStore.getState().user;
  const workspaceId = useCdeStore.getState().workspaceId;
  const body = rawBody.trim();
  if (!supabase || !user || !workspaceId || !body) return false;
  const dir = mentionDirectory();
  const { mentions } = parseMentions(body, dir);
  let message: ChatMessage;
  try {
    message = await insertChatMessage(supabase, { workspaceId, body, mentions, linkedNodeId: options.linkedNodeId });
  } catch (error) {
    handleError(error, "No se pudo enviar el mensaje");
    return false;
  }
  useCdeStore.getState().upsertMessage(message);
  useCdeStore.getState().markRead();
  notifyRoom(workspaceId);

  if (options.incident && !isCanvasReadOnly()) {
    const area = mentions.find((m): m is Extract<Mention, { kind: "area" }> => m.kind === "area")?.value;
    const userMention = mentions.find((m): m is Extract<Mention, { kind: "user" }> => m.kind === "user");
    const assignee = userMention ? dir.users.find((u) => u.id === userMention.id) : undefined;
    createResolutionCard({
      description: body.replace(/@IA\b/gi, "").replace(/\s+/g, " ").trim(),
      area,
      assigneeName: assignee ? assignee.name : "",
      assigneeId: assignee?.id ?? null,
      affectedNodeIds: options.linkedNodeId ? [options.linkedNodeId] : [],
      quiet: true,
    });
  }

  if (mentionsAi(mentions)) void reportToAi(message, mentions);
  return true;
}

/** Evalúa un reporte a @IA y lo guarda como alerta unificada del espacio. */
async function reportToAi(source: ChatMessage, mentions: Mention[]): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const workspaceId = source.workspaceId;
  if (!supabase) return;
  const store = useCdeStore.getState();
  store.setEvaluating(true);
  try {
    const { nodes, connections } = useWorkspaceStore.getState();
    const mentionedAreas = mentions.filter((m) => m.kind === "area").map((m) => m.value);
    const cards = reportCardsFrom(nodes, connections);
    const result = await evaluateReport(source.body, cards, store.areas, mentionedAreas);
    const ev = result.value;
    // El mensaje enlazado a una tarjeta cuenta como afectada aunque la IA no la nombre.
    if (source.linkedNodeId && !ev.affectedNodeIds.includes(source.linkedNodeId)) {
      ev.affectedNodeIds = [source.linkedNodeId, ...ev.affectedNodeIds].slice(0, 4);
    }
    if (!ev.isIssue && ev.affectedNodeIds.length === 0) {
      toast({ message: "La IA no encontró nada que requiera acción en ese reporte." });
      return;
    }
    if (useCdeStore.getState().workspaceId !== workspaceId) return;
    const alertMentions: Mention[] = ev.affectedAreas.map((value) => ({ kind: "area", value }));
    const titles = ev.affectedNodeIds
      .map((id) => nodes.find((n) => n.id === id)?.title)
      .filter((t): t is string => Boolean(t));
    const body = [
      `Alerta unificada: ${ev.summary}`,
      titles.length > 0 ? `Tarjetas afectadas: ${titles.map((t) => `«${t}»`).join(", ")}.` : "",
      ev.affectedAreas.length > 0 ? `Avisar a: ${ev.affectedAreas.map((a) => `@${a}`).join(" ")}.` : "",
      ev.suggestedAction ? `Sugerencia: ${ev.suggestedAction}.` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\.\./g, ".")
      .slice(0, 1900);
    const saved = await insertChatMessage(supabase, {
      workspaceId,
      body,
      mentions: alertMentions,
      linkedNodeId: ev.affectedNodeIds[0] ?? null,
      kind: "ai-alert",
      alert: {
        summary: ev.summary,
        severity: ev.severity,
        affectedNodeIds: ev.affectedNodeIds,
        affectedAreas: ev.affectedAreas,
        suggestedAction: ev.suggestedAction,
        message: source.body.replace(/@IA\b/gi, "").trim().slice(0, 600),
        engine: result.engine,
      },
    });
    useCdeStore.getState().upsertMessage(saved);
    useCdeStore.getState().markRead();
    notifyRoom(workspaceId);
    toast({
      tone: "success",
      message: result.notice ? `Alerta registrada (${result.notice})` : "La IA registró la alerta en el canal unificado.",
    });
  } catch (error) {
    handleError(error, "No se pudo registrar la alerta");
  } finally {
    useCdeStore.getState().setEvaluating(false);
  }
}

/** Borra con «Deshacer». */
export function deleteChatMessageWithUndo(message: ChatMessage): void {
  useCdeStore.getState().hideMessage(message.id, true);
  toast({
    message: "Mensaje borrado.",
    action: { label: "Deshacer", onAction: () => useCdeStore.getState().hideMessage(message.id, false) },
    onExpire: () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      void deleteChatMessage(supabase, message.id)
        .then(() => {
          useCdeStore.getState().removeMessage(message.id);
          notifyRoom(message.workspaceId);
        })
        .catch((error: unknown) => {
          useCdeStore.getState().hideMessage(message.id, false);
          handleError(error, "No se pudo borrar el mensaje");
        });
    },
  });
}
