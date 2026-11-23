// ============================================================================
// ANDROS — @USUARIO, AMISTADES Y MIEMBROS DE ESPACIOS (Sprint 7.6)
// ============================================================================

/** Datos básicos y públicos de una persona (nunca su correo). */
export interface BasicProfile {
  id: string;
  username: string | null;
  fullName: string;
  avatarUrl: string | null;
}

export type FriendshipStatus = "pending" | "accepted" | "rejected";

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: string;
  /** La otra persona de la pareja. */
  other: BasicProfile;
  /** `incoming` = te la enviaron a ti. */
  direction: "incoming" | "outgoing";
}

export interface WorkspaceMember {
  userId: string;
  role: "owner" | "editor";
  profile: BasicProfile;
}

/** Formato de @usuario: minúsculas, números y guion bajo (3–20). */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
