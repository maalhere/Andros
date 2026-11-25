// ============================================================================
// ANDROS — ACCIONES DE COMENTARIOS (navegador)
// Guardan en Supabase con TU sesión (la RLS decide si tu rol puede) y, si
// sale bien, avisan a la sala en vivo para que los demás lo vean al instante.
// Borrar tiene «Deshacer»: se oculta al momento y se borra al expirar el aviso.
// ============================================================================

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useCommentsStore } from "@/store/useCommentsStore";
import { toast } from "@/store/useToastStore";
import { broadcastCollabEvent, collabEventBase } from "@/lib/collab/useCollabRoom";
import type { CommentDeletePayload, CommentResolvePayload, CommentUpsertPayload } from "@/types/collab";
import { CommentsSetupError, deleteComment, insertComment, updateCommentResolved } from "./repository";
import type { WorkspaceComment } from "./commentModel";

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback;
}

function handleError(error: unknown, fallback: string): void {
  if (error instanceof CommentsSetupError) {
    useCommentsStore.getState().setStatus("setup-missing");
    return;
  }
  toast({ message: describe(error, fallback), tone: "error" });
}

/** Publica un comentario. Devuelve `true` si quedó guardado. */
export async function addComment(body: string, nodeId: string | null): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  const user = useCloudStore.getState().user;
  const workspaceId = useCommentsStore.getState().workspaceId;
  if (!supabase || !user || !workspaceId || !body.trim()) return false;
  try {
    const comment = await insertComment(supabase, {
      workspaceId,
      nodeId,
      authorId: user.id,
      authorName: user.name?.trim() || "Persona de Andros",
      body,
    });
    useCommentsStore.getState().upsert(comment);
    const base = collabEventBase();
    if (base && base.workspaceId === workspaceId) {
      const payload: CommentUpsertPayload = { ...base, comment };
      broadcastCollabEvent("comment:upsert", payload);
    }
    return true;
  } catch (error) {
    handleError(error, "No se pudo publicar el comentario");
    return false;
  }
}

/** Marca como resuelto o lo reabre (optimista; se revierte si la base lo rechaza). */
export async function setCommentResolved(comment: WorkspaceComment, resolved: boolean): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  const store = useCommentsStore.getState();
  store.setResolved(comment.id, resolved);
  try {
    await updateCommentResolved(supabase, comment.id, resolved);
    const base = collabEventBase();
    if (base && base.workspaceId === comment.workspaceId) {
      const payload: CommentResolvePayload = { ...base, id: comment.id, resolved };
      broadcastCollabEvent("comment:resolve", payload);
    }
  } catch (error) {
    useCommentsStore.getState().setResolved(comment.id, !resolved);
    handleError(error, resolved ? "No se pudo resolver" : "No se pudo reabrir");
  }
}

/** Borra con «Deshacer» (se borra de verdad cuando expira el aviso). */
export function deleteCommentWithUndo(comment: WorkspaceComment): void {
  const store = useCommentsStore.getState();
  store.hide(comment.id, true);
  toast({
    message: "Comentario borrado.",
    action: { label: "Deshacer", onAction: () => useCommentsStore.getState().hide(comment.id, false) },
    onExpire: () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      void deleteComment(supabase, comment.id)
        .then(() => {
          useCommentsStore.getState().remove(comment.id);
          const base = collabEventBase();
          if (base && base.workspaceId === comment.workspaceId) {
            const payload: CommentDeletePayload = { ...base, id: comment.id };
            broadcastCollabEvent("comment:delete", payload);
          }
        })
        .catch((error: unknown) => {
          useCommentsStore.getState().hide(comment.id, false);
          handleError(error, "No se pudo borrar el comentario");
        });
    },
  });
}
