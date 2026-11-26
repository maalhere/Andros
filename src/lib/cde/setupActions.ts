// ============================================================================
// ANDROS — APLICAR EL ARRANQUE EN 3 PASOS (navegador)
// 1. Equipo: añade a cada amistad elegida con su permiso (RLS: solo el dueño
//    y solo amistades aceptadas) y avisa a la sala y por correo.
// 2. Áreas: guarda la lista de áreas activas, el área del dueño y la de cada
//    miembro (sin sesión: en este dispositivo).
// 3. Fichas: la IA (o el respaldo local) diseña los formatos; se guardan en la
//    Librería de fichas y se arma el tablero inicial organizado por áreas.
// Cada paso que falla avisa y deja seguir: el tablero siempre se crea.
// ============================================================================

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceStore, estimateNodeHeight } from "@/store/useWorkspaceStore";
import { useFormsLibraryStore } from "@/store/useFormsLibraryStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { toast } from "@/store/useToastStore";
import { renameCloudWorkspace } from "@/hooks/useCloudSync";
import { addWorkspaceMember } from "@/lib/social/repository";
import { setKnownMemberRole } from "@/lib/access/memberRoles";
import type { MemberRole } from "@/lib/access/permissions";
import { broadcastCollabEvent, collabEventBase } from "@/lib/collab/useCollabRoom";
import { requestShareNotification } from "@/lib/share/shareNotifyClient";
import { track } from "@/lib/analytics/telemetry";
import { normalizeAreaName, sanitizeAreaList } from "./areas";
import { CdeSetupError, saveMemberArea, saveWorkspaceAreas } from "./repository";
import { refreshCdeSpace, writeLocalAreas } from "./useCdeSync";
import { requestSetupPlan } from "./aiClient";
import { buildSetupBoard, type SetupPerson } from "./setupBoard";

export interface SetupMemberChoice {
  userId: string;
  name: string;
  username: string | null;
  role: MemberRole;
  area: string;
  /** Ya era miembro (no se vuelve a añadir; solo se le asigna el área). */
  existing?: boolean;
}

export interface SpaceSetupInput {
  projectName: string;
  members: SetupMemberChoice[];
  areas: string[];
  ownerArea: string;
  description: string;
  signal?: AbortSignal;
}

export interface SpaceSetupResult {
  engine: "ai" | "local";
  notice: string | null;
  warnings: string[];
  cards: number;
  templates: number;
}

function originForBoard(): { x: number; y: number } {
  const { nodes } = useWorkspaceStore.getState();
  if (nodes.length === 0) return { x: 80, y: 120 };
  const bottom = Math.max(...nodes.map((n) => n.position.y + estimateNodeHeight(n)));
  const left = Math.min(...nodes.map((n) => n.position.x));
  return { x: left, y: bottom + 128 };
}

export async function applySpaceSetup(input: SpaceSetupInput): Promise<SpaceSetupResult> {
  const warnings: string[] = [];
  const supabase = getSupabaseBrowserClient();
  const { user, workspaceId } = useCloudStore.getState();
  const areas = sanitizeAreaList(input.areas);
  const ownerArea = normalizeAreaName(input.ownerArea);
  const cloud = Boolean(supabase && user && workspaceId);

  // 1. Equipo (solo con sesión y espacio en la nube).
  const added: SetupMemberChoice[] = [];
  if (cloud && supabase && user && workspaceId) {
    for (const m of input.members) {
      if (m.existing) {
        added.push(m);
        continue;
      }
      try {
        await addWorkspaceMember(supabase, workspaceId, user.id, m.userId, m.role);
        added.push(m);
        setKnownMemberRole(workspaceId, m.userId, m.role);
        const base = collabEventBase();
        if (base && base.workspaceId === workspaceId) broadcastCollabEvent("access:changed", { ...base, userId: m.userId, role: m.role });
        void requestShareNotification(workspaceId, m.userId, "added");
      } catch (error) {
        warnings.push(`No se pudo añadir a ${m.name}: ${error instanceof Error ? error.message : "error desconocido"}`);
      }
    }

    // 2. Áreas.
    try {
      await saveWorkspaceAreas(supabase, workspaceId, areas, ownerArea);
      for (const m of added) if (m.area) await saveMemberArea(supabase, workspaceId, m.userId, m.area);
      const base = collabEventBase();
      if (base && base.workspaceId === workspaceId) broadcastCollabEvent("cde:changed", base);
    } catch (error) {
      warnings.push(
        error instanceof CdeSetupError
          ? "Las áreas se guardaron solo en este dispositivo: falta ejecutar de nuevo supabase/schema.sql."
          : `No se pudieron guardar las áreas: ${error instanceof Error ? error.message : "error desconocido"}`
      );
      writeLocalAreas(areas, ownerArea);
    }

    const current = useWorkspaceManagerStore.getState().workspaces.find((w) => w.id === workspaceId);
    const name = input.projectName.trim();
    if (name && current && current.name !== name) await renameCloudWorkspace(workspaceId, name).catch(() => undefined);
  } else {
    writeLocalAreas(areas, ownerArea);
  }
  await refreshCdeSpace();

  // 3. Fichas con IA (o respaldo local) + tablero por áreas.
  const plan = await requestSetupPlan(input.description, areas, input.signal);
  const people: SetupPerson[] = [
    { name: user?.name?.trim() || "Tú", username: null, role: "owner", area: ownerArea },
    ...added.map((m) => ({ name: m.name, username: m.username, role: m.role, area: normalizeAreaName(m.area) })),
  ];
  const board = buildSetupBoard(plan.value, areas, people, originForBoard(), input.projectName.trim());
  const ws = useWorkspaceStore.getState();
  ws.aiInsertBoard(board.nodes, board.connections);
  ws.setActiveTool("pointer");
  ws.setActiveMobileSheet("none");
  const library = useFormsLibraryStore.getState();
  for (const t of board.templates) library.upsertTemplate(t);
  window.setTimeout(() => useWorkspaceStore.getState().requestZoomExtents(), 140);

  const ids = board.nodes.map((n) => n.id);
  toast({
    tone: "success",
    message: `Espacio listo: ${added.length > 0 ? `${added.length} ${added.length === 1 ? "persona" : "personas"} · ` : ""}${areas.length} ${
      areas.length === 1 ? "área" : "áreas"
    } · ${board.templates.length} fichas${plan.engine === "local" ? " (sin IA)" : ""}.`,
    action: {
      label: "Deshacer tablero",
      onAction: () => {
        const store = useWorkspaceStore.getState();
        for (const id of ids) store.removeNode(id);
      },
    },
  });
  for (const w of warnings) toast({ message: w, tone: "error", durationMs: 9000 });
  track("blueprint_generated", { source: plan.engine === "ai" ? "ai" : "base" });
  return { engine: plan.engine, notice: plan.notice, warnings, cards: board.nodes.length, templates: board.templates.length };
}
