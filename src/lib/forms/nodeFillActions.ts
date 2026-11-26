"use client";

// ============================================================================
// ANDROS — «LLENAR DESDE NODOS» EN EL NAVEGADOR (Sprint 24)
// Lee la ficha y sus nodos conectados del store, aplica las propuestas con
// «Deshacer» y, al conectar por primera vez una ficha vacía, la completa sola
// (solo campos vacíos, solo en el navegador de quien hizo la conexión).
// ============================================================================

import { useEffect } from "react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { isCanvasReadOnly } from "@/store/useCollabStore";
import { toast } from "@/store/useToastStore";
import { isApplyingRemoteCollab } from "@/lib/collab/remoteFlag";
import type { FormField, FormSheetEngineeringNode } from "@/types/workspace";
import { patchFormSheet } from "./formActions";
import {
  applyFillSuggestions,
  buildFillSuggestions,
  defaultPicks,
  neighborIds,
  sheetIsBlank,
  type FillPlan,
  type FillSuggestion,
} from "./nodeFill";

function sheetById(nodeId: string): FormSheetEngineeringNode | null {
  const node = useWorkspaceStore.getState().nodes.find((n) => n.id === nodeId);
  return node?.type === "form-sheet-node" && !node.formSheetData.resolution ? node : null;
}

/** Propuestas para una ficha a partir de lo que tiene conectado. */
export function planForSheet(nodeId: string): FillPlan | null {
  const { nodes, connections } = useWorkspaceStore.getState();
  const sheet = sheetById(nodeId);
  if (!sheet) return null;
  const ids = new Set(neighborIds(nodeId, connections));
  return buildFillSuggestions(sheet, nodes.filter((n) => ids.has(n.id)));
}

/**
 * Aplica las propuestas elegidas (y el área de la ficha, si se pide).
 * Devuelve cuántos campos cambió. Siempre con «Deshacer».
 */
export function applyNodeFill(
  nodeId: string,
  picks: readonly FillSuggestion[],
  options: { overwrite?: boolean; area?: string | null; quietSource?: string } = {}
): number {
  if (isCanvasReadOnly()) {
    toast({ message: "Tu permiso no permite llenar fichas en este lienzo.", tone: "error" });
    return 0;
  }
  const sheet = sheetById(nodeId);
  if (!sheet) return 0;
  const beforeFields: FormField[] = sheet.formSheetData.fields;
  const beforeArea = sheet.formSheetData.area;
  let applied = 0;
  patchFormSheet(nodeId, (latest) => {
    const result = applyFillSuggestions(latest.fields, picks, { overwrite: options.overwrite });
    applied = result.applied;
    const setArea = options.area && !latest.area ? { area: options.area } : {};
    if (result.applied === 0 && !("area" in setArea)) return null;
    return { fields: result.fields, ...setArea };
  });
  const areaSet = Boolean(options.area && !beforeArea);
  if (applied === 0 && !areaSet) {
    toast({ message: "No había datos nuevos que copiar: los campos ya tienen información.", tone: "neutral" });
    return 0;
  }
  const what = [
    applied > 0 ? `${applied} campo${applied === 1 ? "" : "s"}` : "",
    areaSet ? `área @${options.area}` : "",
  ]
    .filter(Boolean)
    .join(" y ");
  toast({
    tone: "success",
    message: options.quietSource ? `Ficha completada desde «${options.quietSource.slice(0, 40)}»: ${what}.` : `Llenado desde nodos: ${what}.`,
    action: {
      label: "Deshacer",
      onAction: () => patchFormSheet(nodeId, () => ({ fields: beforeFields, area: beforeArea })),
    },
  });
  return applied;
}

/**
 * Al conectar por primera vez una ficha vacía, la completa con los datos del
 * nodo conectado (solo campos vacíos). No actúa con cambios que llegan de la
 * sala en vivo, al abrir otro espacio ni cuando se insertan tableros enteros.
 */
export function useNodeAutoFillOnConnect(): void {
  useEffect(() => {
    let known = new Set(useWorkspaceStore.getState().connections.map((c) => c.id));
    return useWorkspaceStore.subscribe((state, prev) => {
      if (state.connections === prev.connections) return;
      const added = state.connections.filter((c) => !known.has(c.id));
      known = new Set(state.connections.map((c) => c.id));
      // Solo una conexión hecha a mano (no hidratación, tableros ni la sala).
      if (added.length !== 1 || isApplyingRemoteCollab() || isCanvasReadOnly()) return;
      if (state.nodes.length !== prev.nodes.length) return;
      const conn = added[0];
      for (const sheetId of [conn.fromNodeId, conn.toNodeId]) {
        const sheet = sheetById(sheetId);
        if (!sheet || !sheetIsBlank(sheet)) continue;
        // Primera conexión de la ficha.
        if (state.connections.some((c) => c.id !== conn.id && (c.fromNodeId === sheetId || c.toNodeId === sheetId))) continue;
        const plan = planForSheet(sheetId);
        if (!plan) continue;
        const picks = defaultPicks(plan);
        if (picks.length === 0 && !plan.area) continue;
        const otherId = sheetId === conn.fromNodeId ? conn.toNodeId : conn.fromNodeId;
        const other = state.nodes.find((n) => n.id === otherId);
        queueMicrotask(() => applyNodeFill(sheetId, picks, { area: plan.area?.value ?? null, quietSource: other?.title ?? "nodo" }));
      }
    });
  }, []);
}
