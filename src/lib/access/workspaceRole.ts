// ============================================================================
// ANDROS — TU ROL EN EL ESPACIO ABIERTO (derivado, sin estado propio)
//
//   · Espacio propio, modo local o sin sesión → `owner` (control total).
//   · Espacio compartido contigo → el rol de tu fila en `workspace_members`
//     (lo lee useCloudSync al listar «Compartidos conmigo»).
// La RLS de Supabase es la que realmente bloquea; esto adapta la interfaz.
// ============================================================================

import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import type { WorkspaceRole } from "./permissions";

function roleFor(workspaceId: string | null, shared: { id: string; role: WorkspaceRole }[]): WorkspaceRole {
  if (!workspaceId) return "owner";
  return shared.find((w) => w.id === workspaceId)?.role ?? "owner";
}

/** Lectura puntual (fuera de React: guardado, atajos, sala en vivo). */
export function currentWorkspaceRole(): WorkspaceRole {
  return roleFor(useCloudStore.getState().workspaceId, useWorkspaceManagerStore.getState().sharedWorkspaces);
}

/** Hook: se repinta solo cuando cambia el rol (no con cada cambio de la lista). */
export function useWorkspaceRole(): WorkspaceRole {
  const workspaceId = useCloudStore((s) => s.workspaceId);
  return useWorkspaceManagerStore((s) => roleFor(workspaceId, s.sharedWorkspaces));
}
