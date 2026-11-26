// ============================================================================
// ANDROS — ACCESO A SUPABASE DEL CDE (áreas nominales + chat del lienzo)
// Todo con la sesión y la RLS de quien llama (supabase/schema.sql §18). Si
// faltan las columnas o la tabla nueva, se lanza `CdeSetupError` y la interfaz
// muestra un aviso claro (el lienzo sigue funcionando).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMemberRole, type WorkspaceRole } from "@/lib/access/permissions";
import { fetchBasicProfiles } from "@/lib/social/repository";
import { normalizeAreaName, sanitizeAreaList } from "./areas";
import { CHAT_MAX_CHARS, sanitizeChatMessage, sortChat, type ChatMessage } from "./chatModel";
import type { Mention } from "./mentions";

export const CDE_SETUP_HINT =
  "El chat del lienzo y las áreas de trabajo necesitan las columnas y la tabla nuevas (workspace_chat_messages). Ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase.";

export class CdeSetupError extends Error {
  constructor() {
    super(CDE_SETUP_HINT);
    this.name = "CdeSetupError";
  }
}

const MISSING_CODES = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);
const CHAT_COLUMNS = "id, workspace_id, author_id, author_name, author_area, body, mentions, linked_node_id, kind, alert, created_at";
const MAX_LOADED = 300;

interface DbError {
  code?: string;
  message?: string;
}

function fail(error: DbError): never {
  const message = (error.message ?? "").toLowerCase();
  if ((error.code && MISSING_CODES.has(error.code)) || message.includes("does not exist") || message.includes("could not find")) {
    throw new CdeSetupError();
  }
  if (error.code === "42501") throw new Error("Tu permiso en este espacio no permite esta acción.");
  throw new Error(error.message || "Error desconocido");
}

/** Persona del espacio (dueño incluido) con su área nominal. */
export interface CdePerson {
  userId: string;
  name: string;
  username: string | null;
  role: WorkspaceRole;
  area: string;
}

export interface CdeSpace {
  ownerId: string | null;
  areas: string[];
  people: CdePerson[];
}

/** Áreas del espacio y personas con su área (lectura con TU RLS). */
export async function loadCdeSpace(supabase: SupabaseClient, workspaceId: string): Promise<CdeSpace> {
  const [ws, members] = await Promise.all([
    supabase.from("workspaces").select("owner_id, work_areas, owner_work_area").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("user_id, role, work_area").eq("workspace_id", workspaceId),
  ]);
  if (ws.error) fail(ws.error);
  if (members.error) fail(members.error);
  const row = (ws.data ?? {}) as { owner_id?: unknown; work_areas?: unknown; owner_work_area?: unknown };
  const ownerId = typeof row.owner_id === "string" ? row.owner_id : null;
  const rows = ((members.data ?? []) as { user_id: unknown; role: unknown; work_area: unknown }[]).filter(
    (r) => typeof r.user_id === "string" && isMemberRole(r.role)
  );
  let profiles = new Map<string, { fullName: string; username: string | null }>();
  try {
    profiles = await fetchBasicProfiles(supabase, [...(ownerId ? [ownerId] : []), ...rows.map((r) => r.user_id as string)]);
  } catch {
    // Sin perfiles: se muestran nombres genéricos (las áreas siguen sirviendo).
  }
  const people: CdePerson[] = [];
  if (ownerId) {
    const p = profiles.get(ownerId);
    people.push({
      userId: ownerId,
      name: p?.fullName ?? "Dueño del espacio",
      username: p?.username ?? null,
      role: "owner",
      area: normalizeAreaName(row.owner_work_area),
    });
  }
  for (const r of rows) {
    const id = r.user_id as string;
    if (id === ownerId) continue;
    const p = profiles.get(id);
    people.push({
      userId: id,
      name: p?.fullName ?? "Persona de Andros",
      username: p?.username ?? null,
      role: r.role as WorkspaceRole,
      area: normalizeAreaName(r.work_area),
    });
  }
  return { ownerId, areas: sanitizeAreaList(row.work_areas), people };
}

/** Solo el dueño: lista de áreas activas y su propia área. */
export async function saveWorkspaceAreas(
  supabase: SupabaseClient,
  workspaceId: string,
  areas: string[],
  ownerArea: string
): Promise<void> {
  const { data, error } = await supabase
    .from("workspaces")
    .update({ work_areas: sanitizeAreaList(areas), owner_work_area: normalizeAreaName(ownerArea) })
    .eq("id", workspaceId)
    .select("id");
  if (error) fail(error);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Solo el dueño puede cambiar las áreas del espacio.");
}

/** Solo el dueño: área nominal de un miembro. */
export async function saveMemberArea(supabase: SupabaseClient, workspaceId: string, userId: string, area: string): Promise<void> {
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ work_area: normalizeAreaName(area) })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) fail(error);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Solo el dueño puede asignar áreas a los miembros.");
}

export async function listChatMessages(supabase: SupabaseClient, workspaceId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("workspace_chat_messages")
    .select(CHAT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(MAX_LOADED);
  if (error) fail(error);
  return sortChat(((data ?? []) as unknown[]).map(sanitizeChatMessage).filter((m): m is ChatMessage => m !== null));
}

export interface ChatInsert {
  workspaceId: string;
  body: string;
  mentions: Mention[];
  linkedNodeId: string | null;
  kind?: "message" | "ai-alert";
  alert?: Record<string, unknown> | null;
}

/** El autor, su nombre y su área los pone el trigger: el navegador no los manda. */
export async function insertChatMessage(supabase: SupabaseClient, input: ChatInsert): Promise<ChatMessage> {
  const kind = input.kind ?? "message";
  const { data, error } = await supabase
    .from("workspace_chat_messages")
    .insert({
      workspace_id: input.workspaceId,
      body: input.body.trim().slice(0, CHAT_MAX_CHARS),
      mentions: input.mentions,
      linked_node_id: input.linkedNodeId,
      kind,
      alert: kind === "ai-alert" ? input.alert ?? null : null,
    })
    .select(CHAT_COLUMNS)
    .single();
  if (error) fail(error);
  const message = sanitizeChatMessage(data);
  if (!message) throw new Error("La base devolvió un mensaje inválido.");
  return message;
}

export async function deleteChatMessage(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.from("workspace_chat_messages").delete().eq("id", id).select("id");
  if (error) fail(error);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Tu permiso no permite borrar este mensaje.");
}
