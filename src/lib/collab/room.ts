// ============================================================================
// ANDROS — SALA POR CARPETA O ESPACIO + ENLACES DE INVITACIÓN
//   · Espacio dentro de una carpeta → una sala para toda la carpeta
//     (cada participante muestra qué espacio tiene abierto).
//   · Espacio suelto → sala propia con su `workspaceId`.
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
  const summary = useWorkspaceManagerStore.getState().workspaces.find((w) => w.id === workspaceId);
  const workspaceName = summary?.name ?? "Espacio actual";
  const folder = summary?.folder.trim() ?? "";
  if (folder) {
    return {
      roomId: `f-${user.id}-${shortHash(folder)}`,
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

/** Enlace para invitar a otra persona a la sala y al espacio actual. */
export function buildInviteLink(roomId: string, workspaceId: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("sala", roomId);
  url.searchParams.set("espacio", workspaceId);
  return url.toString();
}

/**
 * Lee `?sala=…&espacio=…` de la URL (si es válido) y lo quita de la barra de
 * direcciones para que recargar no vuelva a pedir unirse.
 */
export function consumeInviteFromUrl(): CollabInvite | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const roomId = url.searchParams.get("sala");
  const workspaceId = url.searchParams.get("espacio");
  if (!roomId) return null;
  url.searchParams.delete("sala");
  url.searchParams.delete("espacio");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  if (!ROOM_ID_PATTERN.test(roomId)) return null;
  return {
    roomId,
    workspaceId: workspaceId && WORKSPACE_ID_PATTERN.test(workspaceId) ? workspaceId : null,
  };
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
