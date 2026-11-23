import { create } from "zustand";
import type { Friendship } from "@/types/social";

// ============================================================================
// ANDROS — ESTADO DE @USUARIO, AMISTADES Y MODALES DE COMPARTIR
// Lo escribe `useSocialSync` (src/lib/social); lo leen UsernameSetupModal,
// FriendsModal, ShareWorkspaceModal y el menú ⋯.
// ============================================================================

interface SocialState {
  /** `undefined` = aún sin comprobar; `null` = sin @usuario todavía. */
  username: string | null | undefined;
  /** Las tablas/funciones nuevas no existen en Supabase (falta ejecutar schema.sql). */
  setupMissing: boolean;
  friendships: Friendship[];
  friendshipsLoaded: boolean;
  /** Ids de amistades ocultas mientras dura su «Deshacer». */
  hiddenFriendshipIds: string[];

  usernamePromptDismissed: boolean;
  friendsOpen: boolean;
  shareOpen: boolean;

  setUsername: (username: string | null | undefined) => void;
  setSetupMissing: (missing: boolean) => void;
  setFriendships: (friendships: Friendship[]) => void;
  hideFriendship: (id: string, hidden: boolean) => void;
  dismissUsernamePrompt: () => void;
  setFriendsOpen: (open: boolean) => void;
  setShareOpen: (open: boolean) => void;
  reset: () => void;
}

export const useSocialStore = create<SocialState>((set) => ({
  username: undefined,
  setupMissing: false,
  friendships: [],
  friendshipsLoaded: false,
  hiddenFriendshipIds: [],
  usernamePromptDismissed: false,
  friendsOpen: false,
  shareOpen: false,

  setUsername: (username) => set({ username }),
  setSetupMissing: (setupMissing) => set({ setupMissing }),
  setFriendships: (friendships) => set({ friendships, friendshipsLoaded: true }),
  hideFriendship: (id, hidden) =>
    set((state) => ({
      hiddenFriendshipIds: hidden
        ? [...new Set([...state.hiddenFriendshipIds, id])]
        : state.hiddenFriendshipIds.filter((x) => x !== id),
    })),
  dismissUsernamePrompt: () => set({ usernamePromptDismissed: true }),
  setFriendsOpen: (friendsOpen) => set({ friendsOpen }),
  setShareOpen: (shareOpen) => set({ shareOpen }),
  reset: () =>
    set({
      username: undefined,
      setupMissing: false,
      friendships: [],
      friendshipsLoaded: false,
      hiddenFriendshipIds: [],
      usernamePromptDismissed: false,
      friendsOpen: false,
      shareOpen: false,
    }),
}));

/** Solicitudes recibidas sin responder (para el contador). */
export function selectIncomingCount(state: SocialState): number {
  return state.friendships.filter(
    (f) => f.direction === "incoming" && f.status === "pending" && !state.hiddenFriendshipIds.includes(f.id)
  ).length;
}
