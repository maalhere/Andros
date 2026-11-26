// ============================================================================
// ANDROS — ROLES VERIFICADOS DE LOS MIEMBROS DEL ESPACIO ABIERTO
// Lo llena `useCommentsSync` al abrir un espacio (lectura con RLS de
// `workspaces.owner_id` y `workspace_members`) y se vuelve a leer de la base
// cada vez que llega `access:changed` (nunca se confía en el rol del mensaje).
//
// (Sprint 17B) DENEGAR POR DEFECTO: la sala solo aplica cambios de nodos,
// cables o tinta de alguien cuyo permiso de edición está VERIFICADO (el dueño
// leído de la base o un miembro con rol Editor). Rol desconocido, espacio aún
// sin cargar o base sin actualizar → solo lectura. Aun así, lo recibido por la
// sala se aplica solo en memoria: nadie lo guarda en la nube por otra persona.
// ============================================================================

import { canEditCanvas, type MemberRole } from "./permissions";

let knownWorkspaceId: string | null = null;
let knownOwnerId: string | null = null;
let roles = new Map<string, MemberRole>();

/**
 * Reemplaza los roles conocidos del espacio abierto. `ownerId` es el dueño
 * leído de la base (sin él, ni siquiera el dueño se acepta como editor).
 */
export function setKnownMemberRoles(
  workspaceId: string | null,
  entries: Iterable<[string, MemberRole]>,
  ownerId: string | null = null
): void {
  knownWorkspaceId = workspaceId;
  knownOwnerId = workspaceId ? ownerId : null;
  roles = new Map(entries);
}

/** Cambio hecho por el propio dueño desde «Compartir» (ya confirmado por la base). */
export function setKnownMemberRole(workspaceId: string, userId: string, role: MemberRole | null): void {
  if (workspaceId !== knownWorkspaceId) return;
  if (role) roles.set(userId, role);
  else roles.delete(userId);
}

/** `true` solo si sabemos (por la base) que `userId` puede editar el lienzo de `workspaceId`. */
export function canSenderEditCanvas(workspaceId: string, userId: string): boolean {
  if (!userId || !workspaceId || workspaceId !== knownWorkspaceId) return false;
  if (knownOwnerId !== null && userId === knownOwnerId) return true;
  const role = roles.get(userId);
  return role !== undefined && canEditCanvas(role);
}

/** `true` si NO consta que `userId` pueda editar el lienzo (denegar por defecto). */
export function isReadOnlySender(workspaceId: string, userId: string): boolean {
  return !canSenderEditCanvas(workspaceId, userId);
}
