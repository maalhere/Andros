// ============================================================================
// ANDROS — BORRADOS CON «DESHACER»
// Cada borrado destructivo guarda una copia, muestra un aviso con «Deshacer»
// durante unos segundos y solo libera los archivos locales (blob:) cuando el
// aviso expira sin deshacer.
// ============================================================================

import {
  revokeLocalFileUrl,
  useWorkspaceStore,
  type CanvasSnapshot,
} from "@/store/useWorkspaceStore";
import { toast } from "@/store/useToastStore";
import type { EngineeringNodeData } from "@/types/workspace";

const ws = () => useWorkspaceStore.getState();

const revokeFiles = (nodes: EngineeringNodeData[]) => {
  const alive = new Set(ws().nodes.map((n) => n.id));
  for (const node of nodes) {
    // Si el nodo volvió (deshacer), su archivo sigue en uso.
    if (node.type === "file-node" && !alive.has(node.id)) {
      revokeLocalFileUrl(node.fileData.downloadUrl);
    }
  }
};

const offerUndo = (message: string, snapshot: CanvasSnapshot) =>
  toast({
    message,
    action: { label: "Deshacer", onAction: () => ws().restoreSnapshot(snapshot) },
    onExpire: () => revokeFiles(snapshot.nodes),
  });

/** Borra un nodo (y sus cables) con opción de deshacer. */
export function deleteNodeWithUndo(id: string): void {
  const { nodes, connections } = ws();
  const node = nodes.find((n) => n.id === id);
  if (!node) return;
  const snapshot: CanvasSnapshot = {
    nodes: [node],
    connections: connections.filter((c) => c.fromNodeId === id || c.toNodeId === id),
  };
  ws().removeNode(id, { keepFileUrl: true });
  offerUndo(`«${node.title.slice(0, 40)}» eliminado.`, snapshot);
}

/** Borra todos los trazos de tinta; «Deshacer» usa el propio historial de tinta. */
export function clearInkWithUndo(): number {
  const count = ws().clearInkStrokes();
  if (count === 0) return 0;
  const entry = ws().inkHistory.at(-1);
  toast({
    message: `${count} trazo(s) borrado(s).`,
    action: {
      label: "Deshacer",
      onAction: () => {
        // Solo si nadie ha dibujado después: así no se deshace otra cosa.
        if (ws().inkHistory.at(-1) === entry) ws().undoCanvasInk();
      },
    },
  });
  return count;
}

/** Elimina los nodos sin cables, con opción de deshacer. */
export function removeOrphansWithUndo(): number {
  const { nodes, connections } = ws();
  const connected = new Set(connections.flatMap((c) => [c.fromNodeId, c.toNodeId]));
  const orphans = nodes.filter((n) => !connected.has(n.id));
  const count = ws().removeOrphanNodes({ keepFileUrl: true });
  if (count > 0) offerUndo(`${count} nodo(s) desconectado(s) eliminado(s).`, { nodes: orphans, connections: [] });
  return count;
}

/** Vacía el lienzo entero (nodos, cables y tinta) con opción de deshacer. */
export function resetWorkspaceWithUndo(): void {
  const { nodes, connections, canvasStrokes, inkHistory } = ws();
  if (nodes.length === 0 && canvasStrokes.length === 0) return;
  ws().resetWorkspace({ keepFileUrl: true });
  offerUndo("Lienzo vaciado.", { nodes, connections, canvasStrokes, inkHistory });
}
