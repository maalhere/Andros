"use client";

// ============================================================================
// ANDROS — CARGA DE COMENTARIOS Y ROLES DEL ESPACIO ABIERTO (Sprint 16)
// Al abrir un espacio de la nube lee sus comentarios y los roles de sus
// miembros. Después, la sala en vivo los mantiene al día (canvasSync); por si
// no hay sala (Realtime apagado) se vuelve a leer al volver a la pestaña y
// cada 2 minutos mientras está visible. Sin sesión: cajón en modo «idle».
// ============================================================================

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useCommentsStore } from "@/store/useCommentsStore";
import { setKnownMemberRoles } from "@/lib/access/memberRoles";
import { CommentsSetupError, listComments, listMemberRoles } from "./repository";

const REFRESH_MS = 120_000;

let loadToken = 0;

/** Vuelve a leer los comentarios (y roles) del espacio abierto. */
export async function refreshComments(options: { quiet?: boolean } = {}): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { user, workspaceId } = useCloudStore.getState();
  const store = useCommentsStore.getState();
  const token = ++loadToken;
  if (!supabase || !user || !workspaceId) {
    store.hydrate(null, []);
    store.setStatus("idle", null);
    setKnownMemberRoles(null, []);
    return;
  }
  if (store.workspaceId !== workspaceId) {
    store.hydrate(workspaceId, []);
    setKnownMemberRoles(workspaceId, []);
  }
  if (!options.quiet || store.status !== "ready") store.setStatus("loading", null);
  try {
    const [comments, roles] = await Promise.all([
      listComments(supabase, workspaceId),
      listMemberRoles(supabase, workspaceId),
    ]);
    if (token !== loadToken || useCloudStore.getState().workspaceId !== workspaceId) return;
    setKnownMemberRoles(workspaceId, roles);
    useCommentsStore.getState().hydrate(workspaceId, comments);
    useCommentsStore.getState().setStatus("ready", null);
  } catch (error) {
    if (token !== loadToken) return;
    if (error instanceof CommentsSetupError) {
      useCommentsStore.getState().setStatus("setup-missing", null);
    } else {
      useCommentsStore
        .getState()
        .setStatus("error", error instanceof Error ? error.message : "No se pudieron leer los comentarios.");
    }
  }
}

/** Montar UNA vez (page.tsx). */
export function useCommentsSync(): void {
  useEffect(() => {
    const unsubscribe = useCloudStore.subscribe((state, prev) => {
      if (state.workspaceId === prev.workspaceId && state.user?.id === prev.user?.id) return;
      void refreshComments();
    });
    void refreshComments();

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (useCommentsStore.getState().status === "setup-missing") return;
      void refreshComments({ quiet: true });
    };
    document.addEventListener("visibilitychange", refreshIfVisible);
    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", refreshIfVisible);
      clearInterval(timer);
    };
  }, []);
}
