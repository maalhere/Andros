// ============================================================================
// ANDROS — ACCIONES DE LAS FICHAS DE RESOLUCIÓN (navegador)
// Una Ficha de Resolución es una `form-sheet-node` con `resolution`: se guarda
// y viaja en vivo como cualquier ficha (lo guarda quien la edita, con su RLS).
// Solo dueño y Editor pueden crearla o cambiar su estado (edición del lienzo).
// ============================================================================

import { estimateNodeHeight, nextUniqueId, resolveAutoPorts, useWorkspaceStore } from "@/store/useWorkspaceStore";
import { isCanvasReadOnly } from "@/store/useCollabStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useImpactStore } from "@/store/useImpactStore";
import { toast } from "@/store/useToastStore";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { freeSlotsForSheets, patchFormSheet } from "@/lib/forms/formActions";
import type { EngineeringNodeData, NodeConnection, ResolutionMeta } from "@/types/workspace";
import {
  RESOLUTION_CATEGORY,
  RESOLUTION_STATUS_LABEL,
  RESOLUTION_TEMPLATE_ID,
  completeResolution,
  createResolution,
  existingResolutionCodes,
  reopenResolution,
  resolutionFields,
  resolutionTitle,
} from "./resolution";
import type { UnifiedAlert } from "./alerts";

/** Nombre visible de quien actúa (para la trazabilidad). */
export function actorName(): string {
  return useCloudStore.getState().user?.name?.trim() || "Persona de Andros";
}

function titleOf(nodeId: string): string | null {
  return useWorkspaceStore.getState().nodes.find((n) => n.id === nodeId)?.title ?? null;
}

export interface NewResolutionCard {
  description: string;
  area?: string;
  assigneeName?: string;
  assigneeId?: string | null;
  affectedNodeIds?: string[];
  sourceAlertIds?: string[];
  /** No mover la vista (creación automática desde el chat). */
  quiet?: boolean;
}

/** Crea una Ficha de Resolución en Rojo (Pendiente). Devuelve su id o `null`. */
export function createResolutionCard(input: NewResolutionCard): string | null {
  if (isCanvasReadOnly()) {
    toast({ message: "Tu permiso no permite crear fichas en este lienzo. Avísalo en el chat a un Editor.", tone: "error" });
    return null;
  }
  const ws = useWorkspaceStore.getState();
  const valid = new Set(ws.nodes.map((n) => n.id));
  const meta = createResolution({
    existingCodes: existingResolutionCodes(ws.nodes),
    description: input.description,
    area: input.area,
    assigneeName: input.assigneeName,
    assigneeId: input.assigneeId ?? null,
    affectedNodeIds: (input.affectedNodeIds ?? []).filter((id) => valid.has(id)),
    sourceAlertIds: input.sourceAlertIds,
    by: actorName(),
    at: new Date().toISOString(),
  });
  const draft: EngineeringNodeData = {
    id: nextUniqueId("node"),
    type: "form-sheet-node",
    title: resolutionTitle(meta),
    codeTag: meta.code,
    position: { x: 0, y: 0 },
    updatedAt: "Ahora mismo",
    formSheetData: {
      templateId: RESOLUTION_TEMPLATE_ID,
      category: RESOLUTION_CATEGORY,
      fields: resolutionFields(meta, titleOf),
      attachments: [],
      ...(meta.area ? { area: meta.area } : {}),
      resolution: meta,
    },
  };
  const [position] = freeSlotsForSheets([estimateNodeHeight(draft)]);
  const node = { ...draft, position };
  const connections: NodeConnection[] = meta.affectedNodeIds.flatMap((targetId) => {
    const target = ws.nodes.find((n) => n.id === targetId);
    if (!target) return [];
    return [{ id: nextUniqueId("conn"), fromNodeId: node.id, toNodeId: targetId, ...resolveAutoPorts(node, target), label: "Afecta a" }];
  });
  ws.aiInsertBoard([node], connections);

  // Las alertas de descuadre que pasa a seguir se cierran (y se avisa a la sala).
  const impact = useImpactStore.getState();
  for (const id of meta.sourceAlertIds) if (impact.alerts.some((a) => a.id === id)) impact.resolveAlert(id);

  if (!input.quiet) requestAnimationFrame(() => focusNodeOnScreen(node.id));
  toast({
    tone: "success",
    message: `Ficha ${meta.code} creada en Rojo (Pendiente).`,
    action: { label: "Deshacer", onAction: () => useWorkspaceStore.getState().removeNode(node.id) },
  });
  return node.id;
}

/** Ficha de Resolución a partir de una alerta unificada (1 clic). */
export function createResolutionFromAlert(alert: UnifiedAlert): string | null {
  const reasons = alert.reasons.map((r) => r.summary);
  const description = [alert.headline, ...reasons.filter((r) => r !== alert.headline)].join(" · ");
  return createResolutionCard({
    description: alert.suggestedAction ? `${description}. Acción: ${alert.suggestedAction}` : description,
    area: alert.affectedAreas[0],
    affectedNodeIds: alert.affectedNodeIds,
    sourceAlertIds: alert.sourceIds,
  });
}

function applyMeta(nodeId: string, next: (meta: ResolutionMeta) => ResolutionMeta): ResolutionMeta | null {
  const node = useWorkspaceStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "form-sheet-node" || !node.formSheetData.resolution) return null;
  const meta = next(node.formSheetData.resolution);
  if (meta === node.formSheetData.resolution) return meta;
  patchFormSheet(nodeId, () => ({ resolution: meta, fields: resolutionFields(meta, titleOf) }));
  return meta;
}

/** Rojo ⇄ Verde con registro de quién y cuándo. */
export function setResolutionDone(nodeId: string, done: boolean): void {
  if (isCanvasReadOnly()) {
    toast({ message: "Tu permiso no permite cambiar el estado de esta ficha.", tone: "error" });
    return;
  }
  const at = new Date().toISOString();
  const by = actorName();
  const meta = applyMeta(nodeId, (m) => (done ? completeResolution(m, by, at) : reopenResolution(m, by, at)));
  if (!meta) return;
  toast({
    tone: done ? "success" : "neutral",
    message: `${meta.code}: ${done ? "Verde" : "Rojo"} (${RESOLUTION_STATUS_LABEL[meta.status]}).`,
    action: { label: "Deshacer", onAction: () => setResolutionDone(nodeId, !done) },
  });
}
