// ============================================================================
// ANDROS — APLICAR UN PLANO AL ESPACIO Y GUARDAR EL ESPACIO COMO PLANTILLA
// (solo cliente: usa el store del lienzo)
//
// Layout en flujo horizontal: columnas de 320 px con 90 px de aire para leer
// los cables, y cada fila empieza debajo de la tarjeta más alta de la anterior
// (altura estimada), así que nada se encima. El orden de `cards` es el orden
// de la pila del teléfono (prioridad).
// ============================================================================

import {
  createEmptyCalcLatexPayload,
  createEmptySketchNotePayload,
  estimateNodeHeight,
  nextUniqueId,
  parseAiTextContent,
  resolveAutoPorts,
  textBlocksToHtml,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import { toast } from "@/store/useToastStore";
import { computeCalcCells, noteDataToText } from "@/lib/templates/blueprint";
import { saveCustomTemplate } from "@/lib/templates/localTemplates";
import type { BlueprintCard, BoardBlueprint, BlueprintLink } from "@/lib/templates/blueprint";
import type { EngineeringNodeData, NodeConnection } from "@/types/workspace";

const NODE_WIDTH = 320;
const COLUMN_GAP = 90;
const ROW_GAP = 64;
const ORIGIN_X = 80;
const ORIGIN_Y = 120;

function nodeFromCard(card: BlueprintCard, position: { x: number; y: number }): EngineeringNodeData {
  const base = {
    id: nextUniqueId("node"),
    title: card.title.slice(0, 120),
    codeTag: card.tag.slice(0, 20),
    position,
    updatedAt: "Ahora mismo",
  };
  if (card.kind === "calc") {
    return {
      ...base,
      type: "calc-latex-node",
      calcLatexData: {
        ...createEmptyCalcLatexPayload(),
        justificationText: card.description,
        gridCells: computeCalcCells(card.cells),
        gridSize: { rows: card.rows, columns: card.columns },
      },
    };
  }
  const { textBlocks, checklistItems } = parseAiTextContent(card.text);
  return {
    ...base,
    type: "sketch-note-node",
    sketchNoteData: {
      ...createEmptySketchNotePayload(),
      canvasMode: "text",
      textBlocks,
      checklistItems,
      richTextHtml: textBlocksToHtml(textBlocks),
    },
  };
}

/** Esquina libre para el tablero: debajo de lo que ya haya, o la esquina inicial si el lienzo está vacío. */
function boardOrigin(): { x: number; y: number } {
  const { nodes } = useWorkspaceStore.getState();
  if (nodes.length === 0) return { x: ORIGIN_X, y: ORIGIN_Y };
  const bottom = Math.max(...nodes.map((n) => n.position.y + estimateNodeHeight(n)));
  const left = Math.min(...nodes.map((n) => n.position.x));
  return { x: left, y: bottom + ROW_GAP * 2 };
}

/** Construye nodos y cables de un plano sin tocar el store (útil para probar el layout). */
export function layoutBlueprint(
  blueprint: BoardBlueprint,
  origin: { x: number; y: number }
): { nodes: EngineeringNodeData[]; connections: NodeConnection[] } {
  // 1. Se crean los nodos en (0,0) para estimar su altura real.
  const nodes = blueprint.cards.map((card) => nodeFromCard(card, { x: 0, y: 0 }));

  // 2. Alto de cada fila = la tarjeta más alta de esa fila.
  const rowHeights = new Map<number, number>();
  blueprint.cards.forEach((card, i) => {
    if (card.pos) return;
    const row = card.row ?? 0;
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, estimateNodeHeight(nodes[i])));
  });
  const rowTop = new Map<number, number>();
  let y = 0;
  for (const row of [...rowHeights.keys()].sort((a, b) => a - b)) {
    rowTop.set(row, y);
    y += (rowHeights.get(row) ?? 0) + ROW_GAP;
  }

  // 3. Posiciones finales.
  const positioned = nodes.map((node, i) => {
    const card = blueprint.cards[i];
    const rel = card.pos ?? {
      x: (card.col ?? 0) * (NODE_WIDTH + COLUMN_GAP),
      y: rowTop.get(card.row ?? 0) ?? 0,
    };
    return { ...node, position: { x: Math.round(origin.x + rel.x), y: Math.round(origin.y + rel.y) } };
  });

  // 4. Cables con puertos automáticos (derecha→izquierda, abajo→arriba…).
  const connections: NodeConnection[] = [];
  for (const link of blueprint.links) {
    const from = positioned[link.from];
    const to = positioned[link.to];
    if (!from || !to) continue;
    const ports = resolveAutoPorts(from, to);
    connections.push({
      id: nextUniqueId("conn"),
      fromNodeId: from.id,
      toNodeId: to.id,
      fromPort: ports.fromPort,
      toPort: ports.toPort,
      ...(link.label ? { label: link.label.slice(0, 60) } : {}),
    });
  }
  return { nodes: positioned, connections };
}

/**
 * Inserta el plano en el espacio actual (una sola operación) y encuadra la
 * vista. Devuelve los ids creados; «Deshacer» los quita.
 */
export function applyBlueprint(blueprint: BoardBlueprint, message?: string): string[] {
  const ws = useWorkspaceStore.getState();
  const { nodes, connections } = layoutBlueprint(blueprint, boardOrigin());
  ws.aiInsertBoard(nodes, connections);
  ws.setActiveTool("pointer");
  ws.setActiveMobileSheet("none");
  // Un instante para que el lienzo mida las tarjetas antes de encuadrar.
  window.setTimeout(() => useWorkspaceStore.getState().requestZoomExtents(), 140);

  const ids = nodes.map((n) => n.id);
  toast({
    message: message ?? `Tablero «${blueprint.name.slice(0, 40)}» listo.`,
    tone: "success",
    action: {
      label: "Deshacer",
      onAction: () => {
        const store = useWorkspaceStore.getState();
        for (const id of ids) store.removeNode(id);
      },
    },
  });
  return ids;
}

// ----------------------------------------------------------------------------
// Guardar el espacio actual como plantilla
// ----------------------------------------------------------------------------

/**
 * Convierte las tarjetas de nota y de cálculo del espacio en un plano. Los
 * archivos, enlaces, código y chats IA no se guardan (no son reutilizables).
 */
export function blueprintFromWorkspace(name: string): { blueprint: BoardBlueprint; skipped: number } | null {
  const { nodes, connections } = useWorkspaceStore.getState();
  const usable = nodes.filter((n) => n.type === "sketch-note-node" || n.type === "calc-latex-node");
  if (usable.length === 0) return null;

  const minX = Math.min(...usable.map((n) => n.position.x));
  const minY = Math.min(...usable.map((n) => n.position.y));
  const indexById = new Map(usable.map((n, i) => [n.id, i]));

  const cards: BlueprintCard[] = usable.map((node) => {
    const pos = { x: Math.round(node.position.x - minX), y: Math.round(node.position.y - minY) };
    if (node.type === "calc-latex-node") {
      const d = node.calcLatexData;
      return {
        kind: "calc",
        title: node.title,
        tag: node.codeTag,
        pos,
        description: d.justificationText,
        cells: Object.fromEntries(Object.entries(d.gridCells).map(([address, cell]) => [address, cell.raw])),
        rows: d.gridSize.rows,
        columns: d.gridSize.columns,
      };
    }
    if (node.type !== "sketch-note-node") throw new Error("Tipo no admitido");
    const d = node.sketchNoteData;
    // Las tareas guardadas vuelven sin marcar: la plantilla es para empezar de cero.
    const text = noteDataToText(d.textBlocks, d.checklistItems, true);
    return { kind: "note", title: node.title, tag: node.codeTag, pos, text };
  });

  const links: BlueprintLink[] = [];
  for (const c of connections) {
    const from = indexById.get(c.fromNodeId);
    const to = indexById.get(c.toNodeId);
    if (from !== undefined && to !== undefined) links.push({ from, to, ...(c.label ? { label: c.label } : {}) });
  }
  return { blueprint: { name, cards, links }, skipped: nodes.length - usable.length };
}

/** Acción del menú ⋯ → «Guardar como plantilla». Devuelve el aviso que se mostró. */
export function saveWorkspaceAsTemplate(name: string): boolean {
  const result = blueprintFromWorkspace(name);
  if (!result) {
    toast({ message: "Este espacio no tiene tarjetas de nota o cálculo para guardar como plantilla.", tone: "error" });
    return false;
  }
  if (!saveCustomTemplate(name, result.blueprint)) {
    toast({ message: "El navegador no permitió guardar la plantilla (almacenamiento bloqueado).", tone: "error" });
    return false;
  }
  const n = result.blueprint.cards.length;
  toast({
    tone: "success",
    message: `Plantilla «${name.slice(0, 40)}» guardada (${n} tarjeta${n === 1 ? "" : "s"}${
      result.skipped > 0 ? `; ${result.skipped} de otro tipo no se incluyeron` : ""
    }).`,
  });
  return true;
}
