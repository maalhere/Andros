// ============================================================================
// ANDROS — MATRIZ DE PERMISOS DE UN ESPACIO (funciones puras, sin store)
//
// Espejo exacto de las funciones SQL de supabase/schema.sql (§4b y §12):
//   · get_workspace_role()      → `WorkspaceRole`
//   · can_edit_workspace()      → `canEditCanvas`
//   · can_comment_workspace()   → `canCreateComment`
// La base de datos es la que manda (RLS); esto solo decide qué se muestra en
// la interfaz, para no ofrecer botones que el servidor va a rechazar.
// ============================================================================

/** Rol de la persona actual en el espacio abierto. */
export type WorkspaceRole = "owner" | "editor" | "commenter" | "viewer";

/** Rol que el dueño puede asignar a un miembro (el dueño es implícito). */
export type MemberRole = Exclude<WorkspaceRole, "owner">;

export const MEMBER_ROLES: readonly MemberRole[] = ["editor", "commenter", "viewer"];

/** Etiqueta corta para selectores y listas. */
export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Dueño",
  editor: "Editor",
  commenter: "Comentarista",
  viewer: "Solo lectura",
};

/** Qué puede hacer cada rol, en una frase (ayuda del selector y correo). */
export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Control total: edita, comparte y cambia permisos.",
  editor: "Puede editar tarjetas, cables y tinta, y comentar.",
  commenter: "Ve el lienzo y puede dejar comentarios, sin editarlo.",
  viewer: "Solo puede ver el lienzo y leer los comentarios.",
};

/** Convierte cualquier valor leído de la base en un rol de miembro válido. */
export function normalizeMemberRole(raw: unknown): MemberRole {
  return raw === "commenter" || raw === "viewer" ? raw : "editor";
}

export function isMemberRole(raw: unknown): raw is MemberRole {
  return raw === "editor" || raw === "commenter" || raw === "viewer";
}

/** Crear, mover o borrar nodos, cables y tinta. */
export function canEditCanvas(role: WorkspaceRole): boolean {
  return role === "owner" || role === "editor";
}

/** Leer los comentarios del tablero (cualquiera con acceso). */
export function canReadComments(role: WorkspaceRole | null): boolean {
  return role !== null;
}

/** Escribir un comentario nuevo. */
export function canCreateComment(role: WorkspaceRole): boolean {
  return role === "owner" || role === "editor" || role === "commenter";
}

/** Marcar como resuelto o borrar: dueño, editores o el propio autor. */
export function canModerateComment(role: WorkspaceRole | null, isAuthor: boolean): boolean {
  if (role === null) return false;
  return canEditCanvas(role) || isAuthor;
}

/** Añadir o quitar miembros y cambiar su rol. */
export function canManageMembers(role: WorkspaceRole): boolean {
  return role === "owner";
}

/** Qué ve la persona en el lienzo: escritura completa o solo lectura. */
export function canvasModeFor(role: WorkspaceRole): "edit" | "comment" | "view" {
  if (canEditCanvas(role)) return "edit";
  return role === "commenter" ? "comment" : "view";
}
