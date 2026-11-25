// ============================================================================
// ANDROS — ROLES CONOCIDOS DE LOS MIEMBROS DEL ESPACIO ABIERTO
// Lo llena `useCommentsSync` al abrir un espacio (lectura con RLS de
// `workspace_members`) y lo actualiza `access:changed` en vivo. La sala lo usa
// para IGNORAR cambios de nodos, cables o tinta que lleguen de alguien con
// rol Comentarista o Solo lectura: así ningún cliente los aplica ni los guarda
// en la nube por esa persona. Sin datos (espacio propio sin miembros, base sin
// actualizar) no se filtra nada.
// ============================================================================

import { canEditCanvas, type MemberRole } from "./permissions";

let knownWorkspaceId: string | null = null;
let roles = new Map<string, MemberRole>();

export function setKnownMemberRoles(workspaceId: string | null, entries: Iterable<[string, MemberRole]>): void {
  knownWorkspaceId = workspaceId;
  roles = new Map(entries);
}

export function setKnownMemberRole(workspaceId: string, userId: string, role: MemberRole | null): void {
  if (workspaceId !== knownWorkspaceId) return;
  if (role) roles.set(userId, role);
  else roles.delete(userId);
}

/** `true` si sabemos que `userId` NO puede editar el lienzo de `workspaceId`. */
export function isReadOnlySender(workspaceId: string, userId: string): boolean {
  if (!userId || workspaceId !== knownWorkspaceId) return false;
  const role = roles.get(userId);
  return role !== undefined && !canEditCanvas(role);
}
