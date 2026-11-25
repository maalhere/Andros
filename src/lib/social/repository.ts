// ============================================================================
// ANDROS — ACCESO A SUPABASE PARA @USUARIO, AMISTADES Y MIEMBROS
// Si las tablas o funciones nuevas aún no existen (no se ejecutó de nuevo
// supabase/schema.sql), todas las funciones lanzan `SocialSetupError` y la UI
// muestra un aviso claro sin tocar el lienzo.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BasicProfile, Friendship, FriendshipStatus, WorkspaceMember } from "@/types/social";
import { normalizeMemberRole, type MemberRole } from "@/lib/access/permissions";

export const SOCIAL_SETUP_HINT =
  "Los amigos y espacios compartidos necesitan tablas nuevas. Ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase.";

export class SocialSetupError extends Error {
  constructor() {
    super(SOCIAL_SETUP_HINT);
    this.name = "SocialSetupError";
  }
}

/** Códigos de Postgres/PostgREST cuando falta una tabla, columna o función. */
const MISSING_CODES = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);

interface DbError {
  code?: string;
  message?: string;
}

function isMissingSetup(error: DbError): boolean {
  if (error.code && MISSING_CODES.has(error.code)) return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("could not find");
}

/** Convierte el error de Supabase en uno legible (o en `SocialSetupError`). */
function fail(error: DbError): never {
  if (isMissingSetup(error)) throw new SocialSetupError();
  throw new Error(error.message || "Error desconocido");
}

function toProfile(raw: Record<string, unknown>): BasicProfile {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const username = text(raw.username);
  return {
    id: String(raw.id),
    username,
    fullName: text(raw.full_name) ?? (username ? `@${username}` : "Persona sin nombre"),
    avatarUrl: text(raw.avatar_url),
  };
}

// ----------------------------------------------------------------------------
// @usuario
// ----------------------------------------------------------------------------

/** Tu @usuario (`null` si aún no elegiste uno). */
export async function fetchOwnUsername(supabase: SupabaseClient, uid: string): Promise<string | null> {
  const { data, error } = await supabase.from("profiles").select("username").eq("id", uid).maybeSingle();
  if (error) fail(error);
  const value = (data as { username?: unknown } | null)?.username;
  return typeof value === "string" && value ? value : null;
}

export async function isUsernameAvailable(supabase: SupabaseClient, candidate: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("username_available", { candidate });
  if (error) fail(error);
  return data === true;
}

/** Guarda tu @usuario. Devuelve `false` si alguien lo tomó justo antes. */
export async function saveUsername(
  supabase: SupabaseClient,
  uid: string,
  email: string,
  username: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ username, email: email || null })
    .eq("id", uid)
    .select("id");
  if (error) {
    if (error.code === "23505") return false;
    fail(error);
  }
  if (Array.isArray(data) && data.length > 0) return true;
  // Perfil creado antes del disparador automático: se crea ahora.
  const { error: insertError } = await supabase
    .from("profiles")
    .insert({ id: uid, email: email || null, username });
  if (insertError) {
    if (insertError.code === "23505") return false;
    fail(insertError);
  }
  return true;
}

// ----------------------------------------------------------------------------
// Perfiles
// ----------------------------------------------------------------------------

/** Busca por @usuario exacto o correo exacto (máx. 5, nunca devuelve correos). */
export async function searchProfiles(supabase: SupabaseClient, query: string): Promise<BasicProfile[]> {
  const { data, error } = await supabase.rpc("search_profiles", { query: query.trim() });
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(toProfile);
}

/** Datos básicos de personas relacionadas contigo (amistades o compañeros). */
export async function fetchBasicProfiles(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, BasicProfile>> {
  const map = new Map<string, BasicProfile>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;
  const { data, error } = await supabase.rpc("get_basic_profiles", { ids: unique });
  if (error) fail(error);
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const profile = toProfile(row);
    map.set(profile.id, profile);
  }
  return map;
}

const unknownProfile = (id: string): BasicProfile => ({
  id,
  username: null,
  fullName: "Persona de Andros",
  avatarUrl: null,
});

// ----------------------------------------------------------------------------
// Amistades
// ----------------------------------------------------------------------------

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
}

export async function listFriendships(supabase: SupabaseClient, uid: string): Promise<Friendship[]> {
  const { data, error } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status, created_at")
    .order("created_at", { ascending: false });
  if (error) fail(error);
  const rows = (data ?? []) as unknown as FriendshipRow[];
  const otherIds = rows.map((r) => (r.requester_id === uid ? r.addressee_id : r.requester_id));
  const profiles = await fetchBasicProfiles(supabase, otherIds);
  return rows.map((r) => {
    const otherId = r.requester_id === uid ? r.addressee_id : r.requester_id;
    return {
      id: r.id,
      requesterId: r.requester_id,
      addresseeId: r.addressee_id,
      status: r.status,
      createdAt: r.created_at,
      other: profiles.get(otherId) ?? unknownProfile(otherId),
      direction: r.addressee_id === uid ? "incoming" : "outgoing",
    };
  });
}

export type FriendRequestResult = "sent" | "accepted" | "already-friends" | "already-sent";

/**
 * Envía (o resuelve) una solicitud de amistad. Si la otra persona ya te
 * había escrito, se acepta directamente.
 */
export async function sendFriendRequest(
  supabase: SupabaseClient,
  uid: string,
  targetId: string,
  existing: Friendship[]
): Promise<FriendRequestResult> {
  const current = existing.find((f) => f.other.id === targetId);
  if (current) {
    if (current.status === "accepted") return "already-friends";
    if (current.direction === "incoming") {
      await respondFriendRequest(supabase, current.id, true);
      return "accepted";
    }
    if (current.status === "pending") return "already-sent";
    // Tu solicitud anterior fue rechazada: se borra y se envía de nuevo.
    await removeFriendship(supabase, current.id);
  }
  const { error } = await supabase
    .from("friendships")
    .insert({ requester_id: uid, addressee_id: targetId, status: "pending" });
  if (error) {
    if (error.code === "23505") return "already-sent";
    fail(error);
  }
  return "sent";
}

export async function respondFriendRequest(
  supabase: SupabaseClient,
  friendshipId: string,
  accept: boolean
): Promise<void> {
  const { error } = await supabase
    .from("friendships")
    .update({ status: accept ? "accepted" : "rejected" })
    .eq("id", friendshipId);
  if (error) fail(error);
}

export async function removeFriendship(supabase: SupabaseClient, friendshipId: string): Promise<void> {
  const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
  if (error) fail(error);
}

// ----------------------------------------------------------------------------
// Miembros de un espacio
// ----------------------------------------------------------------------------

export async function listWorkspaceMembers(
  supabase: SupabaseClient,
  workspaceId: string,
  ownerId: string
): Promise<WorkspaceMember[]> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) fail(error);
  const rows = (data ?? []) as { user_id: string; role: string }[];
  const profiles = await fetchBasicProfiles(supabase, [ownerId, ...rows.map((r) => r.user_id)]);
  const members: WorkspaceMember[] = [
    { userId: ownerId, role: "owner", profile: profiles.get(ownerId) ?? unknownProfile(ownerId) },
  ];
  for (const row of rows) {
    if (row.user_id === ownerId) continue;
    members.push({
      userId: row.user_id,
      role: normalizeMemberRole(row.role),
      profile: profiles.get(row.user_id) ?? unknownProfile(row.user_id),
    });
  }
  return members;
}

export async function addWorkspaceMember(
  supabase: SupabaseClient,
  workspaceId: string,
  uid: string,
  userId: string,
  role: MemberRole = "editor"
): Promise<void> {
  const { error } = await supabase
    .from("workspace_members")
    .insert({ workspace_id: workspaceId, user_id: userId, role, added_by: uid });
  if (error) {
    if (error.code === "23505") return; // ya era miembro
    if (error.code === "23514") throw new SocialSetupError(); // check antiguo sin los roles nuevos
    if (error.code === "42501") {
      throw new Error("Solo puedes añadir a amistades aceptadas en espacios que son tuyos.");
    }
    fail(error);
  }
}

/** (Sprint 16) El dueño cambia el permiso de un miembro en 1 clic. */
export async function updateWorkspaceMemberRole(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  role: MemberRole
): Promise<void> {
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    // Base sin la política nueva o con el check antiguo ('owner' | 'editor').
    if (error.code === "23514" || error.code === "42501") throw new SocialSetupError();
    fail(error);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No se pudo cambiar el permiso. Solo el dueño del espacio puede hacerlo.");
  }
}

export async function removeWorkspaceMember(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) fail(error);
}
