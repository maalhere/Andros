// ============================================================================
// ANDROS — ACCESO A `workspace_comments` (Supabase, con la RLS de cada quien)
// Sin la tabla (no se ejecutó supabase/schema.sql §12) todo lanza
// `CommentsSetupError` y el cajón muestra un aviso claro.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMemberRole, type MemberRole } from "@/lib/access/permissions";
import { COMMENT_MAX_CHARS, sanitizeComment, type WorkspaceComment } from "./commentModel";

export const COMMENTS_SETUP_HINT =
  "Los comentarios necesitan la tabla nueva workspace_comments. Ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase.";

export class CommentsSetupError extends Error {
  constructor() {
    super(COMMENTS_SETUP_HINT);
    this.name = "CommentsSetupError";
  }
}

const MISSING_CODES = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);
const COLUMNS = "id, workspace_id, node_id, author_id, author_name, body, resolved, created_at";
/** Tope de lectura: suficiente para cualquier tablero real sin cargar de más. */
const MAX_LOADED = 400;

interface DbError {
  code?: string;
  message?: string;
}

function fail(error: DbError): never {
  const message = (error.message ?? "").toLowerCase();
  if ((error.code && MISSING_CODES.has(error.code)) || message.includes("does not exist") || message.includes("could not find")) {
    throw new CommentsSetupError();
  }
  if (error.code === "42501") throw new Error("Tu permiso en este espacio no permite esta acción.");
  throw new Error(error.message || "Error desconocido");
}

export async function listComments(supabase: SupabaseClient, workspaceId: string): Promise<WorkspaceComment[]> {
  const { data, error } = await supabase
    .from("workspace_comments")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(MAX_LOADED);
  if (error) fail(error);
  return ((data ?? []) as unknown[]).map(sanitizeComment).filter((c): c is WorkspaceComment => c !== null);
}

export async function insertComment(
  supabase: SupabaseClient,
  input: { workspaceId: string; nodeId: string | null; authorId: string; authorName: string; body: string }
): Promise<WorkspaceComment> {
  const { data, error } = await supabase
    .from("workspace_comments")
    .insert({
      workspace_id: input.workspaceId,
      node_id: input.nodeId,
      author_id: input.authorId,
      author_name: input.authorName.slice(0, 120),
      body: input.body.trim().slice(0, COMMENT_MAX_CHARS),
    })
    .select(COLUMNS)
    .single();
  if (error) fail(error);
  const comment = sanitizeComment(data);
  if (!comment) throw new Error("La base devolvió un comentario inválido.");
  return comment;
}

export async function updateCommentResolved(supabase: SupabaseClient, id: string, resolved: boolean): Promise<void> {
  const { data, error } = await supabase.from("workspace_comments").update({ resolved }).eq("id", id).select("id");
  if (error) fail(error);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Tu permiso no permite resolver este comentario.");
}

export async function deleteComment(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.from("workspace_comments").delete().eq("id", id).select("id");
  if (error) fail(error);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Tu permiso no permite borrar este comentario.");
}

/** Roles de los miembros del espacio (para ignorar ediciones en vivo sin permiso). */
export async function listMemberRoles(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<[string, MemberRole][]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId);
  if (error) return [];
  return ((data ?? []) as { user_id: unknown; role: unknown }[])
    .filter((r) => typeof r.user_id === "string")
    .map((r) => [r.user_id as string, normalizeMemberRole(r.role)]);
}
