"use client";

// ============================================================================
// ANDROS — CARGA DEL CDE DEL ESPACIO ABIERTO (áreas, personas y chat)
// Igual que los comentarios (Sprint 16 → 17B): al abrir un espacio de la nube
// se leen sus áreas, personas y mensajes con TU RLS. Cada aviso `chat:new` o
// `cde:changed` de la sala solo provoca una nueva lectura (nunca se aplica lo
// que trae el mensaje). Respaldo: al volver a la pestaña y cada 60 s.
// Sin sesión (modo local) las áreas viven en este dispositivo y no hay chat.
// ============================================================================

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useCdeStore } from "@/store/useCdeStore";
import { toast } from "@/store/useToastStore";
import { normalizeAreaName, sanitizeAreaList } from "./areas";
import { mentionsTarget } from "./mentions";
import { CdeSetupError, listChatMessages, loadCdeSpace, type CdePerson } from "./repository";

const REFRESH_MS = 60_000;
const LOCAL_KEY = "andros:cde-local:v1";

let spaceToken = 0;
let chatToken = 0;
/** Mensajes ya vistos por espacio (para avisar solo de los nuevos). */
let seen: { workspaceId: string | null; ids: Set<string> } = { workspaceId: null, ids: new Set() };

/** Áreas del modo local (sin sesión). */
export function readLocalAreas(): { areas: string[]; ownerArea: string } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? "{}") as { areas?: unknown; ownerArea?: unknown };
    return { areas: sanitizeAreaList(raw.areas), ownerArea: normalizeAreaName(raw.ownerArea) };
  } catch {
    return { areas: [], ownerArea: "" };
  }
}

export function writeLocalAreas(areas: string[], ownerArea: string): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify({ areas: sanitizeAreaList(areas), ownerArea: normalizeAreaName(ownerArea) }));
  } catch {
    // Sin almacenamiento: solo esta visita.
  }
}

function localPeople(ownerArea: string): CdePerson[] {
  const user = useCloudStore.getState().user;
  return [{ userId: user?.id ?? "local", name: user?.name?.trim() || "Tú", username: null, role: "owner", area: ownerArea }];
}

/** Tu área nominal en el espacio abierto (o `null`). */
export function currentArea(): string | null {
  const { people } = useCdeStore.getState();
  const uid = useCloudStore.getState().user?.id ?? "local";
  return people.find((p) => p.userId === uid)?.area || null;
}

/** Vuelve a leer áreas y personas del espacio abierto. */
export async function refreshCdeSpace(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { user, workspaceId } = useCloudStore.getState();
  const store = useCdeStore.getState();
  const token = ++spaceToken;
  if (!supabase || !user || !workspaceId) {
    const local = readLocalAreas();
    store.hydrateSpace(null, { ownerId: user?.id ?? "local", areas: local.areas, people: localPeople(local.ownerArea) });
    store.setSpaceStatus("idle");
    store.setChatStatus("idle", null);
    return;
  }
  if (store.workspaceId !== workspaceId) {
    store.hydrateSpace(workspaceId, { ownerId: null, areas: [], people: [] });
    store.setSpaceStatus("loading");
  }
  try {
    const space = await loadCdeSpace(supabase, workspaceId);
    if (token !== spaceToken || useCloudStore.getState().workspaceId !== workspaceId) return;
    useCdeStore.getState().hydrateSpace(workspaceId, space);
    useCdeStore.getState().setSpaceStatus("ready");
  } catch (error) {
    if (token !== spaceToken) return;
    useCdeStore.getState().setSpaceStatus(error instanceof CdeSetupError ? "setup-missing" : "error");
  }
}

/** Vuelve a leer el chat del espacio abierto y avisa de menciones nuevas. */
export async function refreshChat(options: { quiet?: boolean } = {}): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { user, workspaceId } = useCloudStore.getState();
  const token = ++chatToken;
  if (!supabase || !user || !workspaceId) {
    useCdeStore.getState().setChatStatus("idle", null);
    return;
  }
  const store = useCdeStore.getState();
  if (!options.quiet || store.chatStatus !== "ready") store.setChatStatus("loading", null);
  try {
    const messages = await listChatMessages(supabase, workspaceId);
    if (token !== chatToken || useCloudStore.getState().workspaceId !== workspaceId) return;
    const firstLoad = seen.workspaceId !== workspaceId;
    const fresh = firstLoad ? [] : messages.filter((m) => !seen.ids.has(m.id));
    seen = { workspaceId, ids: new Set(messages.map((m) => m.id)) };
    useCdeStore.getState().hydrateChat(workspaceId, messages);
    useCdeStore.getState().setChatStatus("ready", null);

    // Bandeja interna: aviso de las menciones nuevas a ti o a tu área.
    const me = { userId: user.id, area: currentArea() };
    const forMe = fresh.filter((m) => mentionsTarget(m.mentions, me, m.authorId));
    if (forMe.length > 0 && !(useCdeStore.getState().panelOpen && useCdeStore.getState().tab === "inbox")) {
      const last = forMe[forMe.length - 1];
      toast({
        message:
          forMe.length === 1
            ? `${last.authorName} te mencionó en el chat: «${last.body.slice(0, 60)}${last.body.length > 60 ? "…" : ""}»`
            : `Tienes ${forMe.length} menciones nuevas en el chat.`,
        action: { label: "Ver", onAction: () => useCdeStore.getState().openPanel("inbox") },
      });
    }
  } catch (error) {
    if (token !== chatToken) return;
    if (error instanceof CdeSetupError) useCdeStore.getState().setChatStatus("setup-missing", null);
    else useCdeStore.getState().setChatStatus("error", error instanceof Error ? error.message : "No se pudo leer el chat.");
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let noticeSpace = false;

/**
 * (Regla 17B) Aviso de la sala `chat:new` / `cde:changed`: no se confía en su
 * contenido; se agrupan los avisos y se vuelve a leer de Supabase.
 */
export function scheduleCdeRefresh(spaceChanged: boolean): void {
  if (spaceChanged) noticeSpace = true;
  if (noticeTimer) return;
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    const space = noticeSpace;
    noticeSpace = false;
    if (space) void refreshCdeSpace();
    void refreshChat({ quiet: true });
  }, 400);
}

/** Montar UNA vez (page.tsx). */
export function useCdeSync(): void {
  useEffect(() => {
    const reload = () => {
      void refreshCdeSpace();
      void refreshChat();
    };
    const unsubscribe = useCloudStore.subscribe((state, prev) => {
      if (state.workspaceId === prev.workspaceId && state.user?.id === prev.user?.id) return;
      reload();
    });
    reload();

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (useCdeStore.getState().chatStatus === "setup-missing") return;
      void refreshChat({ quiet: true });
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshCdeSpace();
      refreshIfVisible();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);
}
