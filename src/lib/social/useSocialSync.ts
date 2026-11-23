"use client";

// ============================================================================
// ANDROS — SINCRONIZACIÓN DE @USUARIO Y AMISTADES
// Al iniciar sesión lee tu @usuario y tus amistades; las vuelve a leer al
// volver a la pestaña y cada 90 s (sin Realtime: $0 y sin tablas publicadas).
// Si las tablas nuevas no existen, marca `setupMissing` y no insiste.
// ============================================================================

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useSocialStore } from "@/store/useSocialStore";
import { SocialSetupError, fetchOwnUsername, listFriendships } from "./repository";

const REFRESH_MS = 90_000;

let refreshing: Promise<void> | null = null;

/** Vuelve a leer tus amistades (y tu @usuario si aún no se conoce). */
export async function refreshSocial(): Promise<void> {
  if (refreshing) return refreshing;
  const supabase = getSupabaseBrowserClient();
  const user = useCloudStore.getState().user;
  if (!supabase || !user) return;
  const social = useSocialStore.getState;
  refreshing = (async () => {
    try {
      if (social().username === undefined) {
        const username = await fetchOwnUsername(supabase, user.id);
        if (useCloudStore.getState().user?.id !== user.id) return;
        social().setUsername(username);
      }
      const friendships = await listFriendships(supabase, user.id);
      if (useCloudStore.getState().user?.id !== user.id) return;
      social().setFriendships(friendships);
      social().setSetupMissing(false);
    } catch (error) {
      if (error instanceof SocialSetupError) {
        social().setSetupMissing(true);
      } else {
        console.warn("[Andros · amigos] No se pudieron leer las amistades.", error);
      }
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Montar UNA vez (page.tsx). */
export function useSocialSync(): void {
  useEffect(() => {
    const unsubscribe = useCloudStore.subscribe((state, prev) => {
      if (state.user?.id === prev.user?.id) return;
      useSocialStore.getState().reset();
      if (state.user) void refreshSocial();
    });
    if (useCloudStore.getState().user) void refreshSocial();

    const onVisible = () => {
      if (document.visibilityState === "visible" && !useSocialStore.getState().setupMissing) {
        void refreshSocial();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !useSocialStore.getState().setupMissing) {
        void refreshSocial();
      }
    }, REFRESH_MS);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);
}
