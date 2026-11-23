// ============================================================================
// ANDROS — SALA POR CARPETA O ESPACIO + ENLACE ÚNICO DEL ESPACIO
//   · Espacio dentro de una carpeta → una sala para toda la carpeta
//     (cada participante muestra qué espacio tiene abierto).
//   · Espacio suelto → sala propia con su `workspaceId`.
//   · Espacio compartido contigo → la sala del DUEÑO (su id + su carpeta),
//     así dueño y miembros coinciden en el mismo canal de voz.
//   · Un solo enlace por espacio: `?espacio=<workspaceId>` (sin enlace de
//     llamada aparte). Los enlaces antiguos `?sala=…` siguen funcionando.
// ============================================================================

import type { CollabInvite } from "@/types/collab";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";

export interface ResolvedRoom {
  roomId: string;
  label: string;
  workspaceId: string;
  workspaceName: string;
}

/** Hash corto y estable (djb2) para no exponer el nombre de la carpeta en la red. */
function shortHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

const ROOM_ID_PATTERN = /^[fw]-[A-Za-z0-9-]{8,120}$/;
const WORKSPACE_ID_PATTERN = /^[0-9a-f-]{36}$/i;

/** Sala del espacio abierto ahora, o `null` si no hay sesión con un espacio en la nube. */
export function resolveCurrentRoom(): ResolvedRoom | null {
  const { user, workspaceId } = useCloudStore.getState();
  if (!user || !workspaceId) return null;
  const manager = useWorkspaceManagerStore.getState();
  const own = manager.workspaces.find((w) => w.id === workspaceId);
  const shared = own ? undefined : manager.sharedWorkspaces.find((w) => w.id === workspaceId);
  const summary = own ?? shared;
  const ownerId = shared?.ownerId ?? user.id;
  const workspaceName = summary?.name ?? "Espacio actual";
  const folder = summary?.folder.trim() ?? "";
  if (folder) {
    return {
      roomId: `f-${ownerId}-${shortHash(folder)}`,
      label: `Carpeta ${folder}`,
      workspaceId,
      workspaceName,
    };
  }
  return { roomId: `w-${workspaceId}`, label: workspaceName, workspaceId, workspaceName };
}

/** Nombre del canal de Realtime para una sala. */
export function channelNameFor(roomId: string): string {
  return `andros-collab:${roomId}`;
}

/** Enlace ÚNICO del espacio: abre el espacio (y su canal de voz) a sus miembros. */
export function buildWorkspaceLink(workspaceId: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("espacio", workspaceId);
  return url.toString();
}

export interface UrlInvite {
  /** Enlace antiguo con `?sala=…` (sesión de invitado en vivo). */
  legacy: CollabInvite | null;
  /** Enlace nuevo `?espacio=<id>`: abrir ese espacio si eres miembro. */
  workspaceId: string | null;
}

/**
 * Lee `?espacio=…` (y el antiguo `?sala=…`) de la URL y lo quita de la barra
 * de direcciones para que recargar no lo vuelva a procesar.
 */
export function consumeInviteFromUrl(): UrlInvite {
  const empty: UrlInvite = { legacy: null, workspaceId: null };
  if (typeof window === "undefined") return empty;
  const url = new URL(window.location.href);
  const roomId = url.searchParams.get("sala");
  const rawWorkspaceId = url.searchParams.get("espacio");
  if (!roomId && !rawWorkspaceId) return empty;
  url.searchParams.delete("sala");
  url.searchParams.delete("espacio");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  const workspaceId =
    rawWorkspaceId && WORKSPACE_ID_PATTERN.test(rawWorkspaceId) ? rawWorkspaceId : null;
  if (roomId && ROOM_ID_PATTERN.test(roomId)) {
    return { legacy: { roomId, workspaceId }, workspaceId: null };
  }
  return { legacy: null, workspaceId };
}

/** Copia texto al portapapeles. Devuelve `false` si el navegador no lo permite. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
