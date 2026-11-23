// ============================================================================
// ANDROS — SINCRONIZACIÓN DEL LIENZO EN VIVO (sin bucles)
//
// Emisión: escucha `useWorkspaceStore` y, por cada nodo o cable que cambió
// LOCALMENTE, emite `node:upsert` / `node:delete` / `edge:upsert` /
// `edge:delete` con un `senderId` único. Los arrastres se limitan a ~16 fps
// por nodo (siempre se envía la última posición).
//
// Recepción: aplica el cambio dentro de `runAsRemoteCollab`, así:
//   · este mismo módulo NO lo re-emite (nunca hay eco ni bucle infinito), y
//   · `useCloudSync` decide si lo guarda (solo el dueño del espacio).
// ============================================================================

import type {
  CanvasSnapshotPayload,
  EdgeDeletePayload,
  EdgeUpsertPayload,
  NodeDeletePayload,
  NodeUpsertPayload,
} from "@/types/collab";
import type { EngineeringNodeData, NodeConnection } from "@/types/workspace";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { parseImportedConnection, parseImportedNode } from "@/hooks/useCloudSync";
import { sanitizeCanvasStrokes } from "@/lib/canvas/inkGeometry";
import { isApplyingRemoteCollab, runAsRemoteCollab } from "./remoteFlag";

/** Intervalo mínimo entre dos envíos del mismo nodo (~16 fps). */
export const NODE_SEND_INTERVAL_MS = 60;
/** Realtime limita cada mensaje: se queda holgado por debajo. */
const MAX_EVENT_BYTES = 180_000;
const MAX_SNAPSHOT_PART_BYTES = 120_000;
/** Archivos incrustados (`data:`) más grandes que esto no viajan por la sala. */
const MAX_INLINE_URL_CHARS = 48_000;

type SendFn = (event: string, payload: object) => void;

export interface CanvasSyncOptions {
  selfId: string;
  getUserId: () => string;
  /** Espacio que se está editando en vivo (`null` = no emitir). */
  getWorkspaceId: () => string | null;
  send: SendFn;
}

function byteLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Prepara un nodo para viajar: las URL `blob:` solo existen en tu equipo y
 * los archivos incrustados enormes saturarían el canal.
 */
function nodeForWire(node: EngineeringNodeData): EngineeringNodeData {
  if (node.type !== "file-node") return node;
  const url = node.fileData.downloadUrl;
  const unusable =
    url.startsWith("blob:") || (url.startsWith("data:") && url.length > MAX_INLINE_URL_CHARS);
  return unusable ? { ...node, fileData: { ...node.fileData, downloadUrl: "" } } : node;
}

/** Empieza a emitir los cambios locales del lienzo. Devuelve la función para detenerse. */
export function startCanvasSync(options: CanvasSyncOptions): () => void {
  const pendingNodes = new Map<string, EngineeringNodeData>();
  const nodeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastSentAt = new Map<string, number>();
  let lastWorkspaceId = options.getWorkspaceId();
  let warnedOversize = false;

  const base = (workspaceId: string) => ({
    senderId: options.selfId,
    senderUserId: options.getUserId(),
    workspaceId,
  });

  const sendNodeNow = (node: EngineeringNodeData) => {
    const workspaceId = options.getWorkspaceId();
    if (!workspaceId) return;
    const payload: NodeUpsertPayload = { ...base(workspaceId), node: nodeForWire(node) };
    if (byteLength(payload) > MAX_EVENT_BYTES) {
      if (!warnedOversize) console.warn("[Andros · sala] Un nodo es demasiado grande para enviarlo en vivo.");
      warnedOversize = true;
      return;
    }
    lastSentAt.set(node.id, Date.now());
    options.send("node:upsert", payload);
  };

  const queueNode = (node: EngineeringNodeData) => {
    const now = Date.now();
    const elapsed = now - (lastSentAt.get(node.id) ?? 0);
    if (!nodeTimers.has(node.id) && elapsed >= NODE_SEND_INTERVAL_MS) {
      sendNodeNow(node);
      return;
    }
    pendingNodes.set(node.id, node);
    if (nodeTimers.has(node.id)) return;
    nodeTimers.set(
      node.id,
      setTimeout(() => {
        nodeTimers.delete(node.id);
        const latest = pendingNodes.get(node.id);
        pendingNodes.delete(node.id);
        if (latest) sendNodeNow(latest);
      }, Math.max(16, NODE_SEND_INTERVAL_MS - elapsed))
    );
  };

  const cancelNode = (id: string) => {
    const timer = nodeTimers.get(id);
    if (timer) clearTimeout(timer);
    nodeTimers.delete(id);
    pendingNodes.delete(id);
    lastSentAt.delete(id);
  };

  const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
    if (state.nodes === prev.nodes && state.connections === prev.connections) return;

    const workspaceId = options.getWorkspaceId();
    // Al cambiar de espacio (carga completa del lienzo) no se emite nada.
    if (workspaceId !== lastWorkspaceId) {
      lastWorkspaceId = workspaceId;
      return;
    }
    // Cambio que llegó de la sala: jamás se re-emite.
    if (isApplyingRemoteCollab()) return;
    if (!workspaceId) return;

    if (state.nodes !== prev.nodes) {
      const before = new Map(prev.nodes.map((n) => [n.id, n]));
      for (const node of state.nodes) {
        if (before.get(node.id) !== node) queueNode(node);
        before.delete(node.id);
      }
      for (const id of before.keys()) {
        cancelNode(id);
        const payload: NodeDeletePayload = { ...base(workspaceId), id };
        options.send("node:delete", payload);
      }
    }

    if (state.connections !== prev.connections) {
      const before = new Map(prev.connections.map((c) => [c.id, c]));
      const liveNodeIds = new Set(state.nodes.map((n) => n.id));
      for (const edge of state.connections) {
        if (before.get(edge.id) !== edge) {
          const payload: EdgeUpsertPayload = { ...base(workspaceId), edge };
          options.send("edge:upsert", payload);
        }
        before.delete(edge.id);
      }
      for (const id of before.keys()) {
        // Los cables de un nodo borrado los quita el receptor junto con el nodo.
        const edge = prev.connections.find((c) => c.id === id);
        if (edge && (!liveNodeIds.has(edge.fromNodeId) || !liveNodeIds.has(edge.toNodeId))) continue;
        const payload: EdgeDeletePayload = { ...base(workspaceId), id };
        options.send("edge:delete", payload);
      }
    }
  });

  return () => {
    unsubscribe();
    for (const timer of nodeTimers.values()) clearTimeout(timer);
    nodeTimers.clear();
    pendingNodes.clear();
  };
}

// ----------------------------------------------------------------------------
// Recepción
// ----------------------------------------------------------------------------

/**
 * Un nodo de archivo recibido conserva el enlace local si es el mismo archivo:
 * así el dueño no pierde su copia ni su subida pendiente a la nube.
 */
function mergeIncomingNode(
  incoming: EngineeringNodeData,
  local: EngineeringNodeData | undefined
): EngineeringNodeData {
  if (incoming.type !== "file-node" || local?.type !== "file-node") return incoming;
  const sameFile =
    local.fileData.checksum === incoming.fileData.checksum &&
    local.fileData.fileName === incoming.fileData.fileName;
  if (!sameFile || !local.fileData.downloadUrl) return incoming;
  return {
    ...incoming,
    fileData: {
      ...incoming.fileData,
      downloadUrl: local.fileData.downloadUrl,
      storagePath: local.fileData.storagePath ?? incoming.fileData.storagePath,
      status: local.fileData.status,
      uploadProgress: local.fileData.uploadProgress,
      errorMessage: local.fileData.errorMessage,
    },
  };
}

/** `persist`: el cambio vino de otra cuenta → el dueño debe guardarlo. */
function persistFor(senderUserId: string, selfUserId: string): boolean {
  return senderUserId !== selfUserId;
}

export function applyRemoteNodeUpsert(payload: NodeUpsertPayload, selfUserId: string): void {
  const node = parseImportedNode(payload.node);
  if (!node) return;
  runAsRemoteCollab(
    () =>
      useWorkspaceStore.setState((state) => {
        const index = state.nodes.findIndex((n) => n.id === node.id);
        if (index === -1) return { nodes: [node, ...state.nodes] };
        const nodes = [...state.nodes];
        nodes[index] = mergeIncomingNode(node, state.nodes[index]);
        return { nodes };
      }),
    { persist: persistFor(payload.senderUserId, selfUserId) }
  );
}

export function applyRemoteNodeDelete(payload: NodeDeletePayload, selfUserId: string): void {
  if (typeof payload.id !== "string") return;
  runAsRemoteCollab(
    () =>
      useWorkspaceStore.setState((state) => {
        if (!state.nodes.some((n) => n.id === payload.id)) return {};
        const connections = state.connections.filter(
          (c) => c.fromNodeId !== payload.id && c.toNodeId !== payload.id
        );
        return {
          nodes: state.nodes.filter((n) => n.id !== payload.id),
          connections,
          selectedNodeId: state.selectedNodeId === payload.id ? null : state.selectedNodeId,
          selectedConnectionId: connections.some((c) => c.id === state.selectedConnectionId)
            ? state.selectedConnectionId
            : null,
          connectingFrom: state.connectingFrom?.nodeId === payload.id ? null : state.connectingFrom,
        };
      }),
    { persist: persistFor(payload.senderUserId, selfUserId) }
  );
}

export function applyRemoteEdgeUpsert(payload: EdgeUpsertPayload, selfUserId: string): void {
  const edge = parseImportedConnection(payload.edge);
  if (!edge) return;
  runAsRemoteCollab(
    () =>
      useWorkspaceStore.setState((state) => {
        const ids = new Set(state.nodes.map((n) => n.id));
        if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) return {};
        const index = state.connections.findIndex((c) => c.id === edge.id);
        if (index === -1) return { connections: [...state.connections, edge] };
        const connections = [...state.connections];
        connections[index] = edge;
        return { connections };
      }),
    { persist: persistFor(payload.senderUserId, selfUserId) }
  );
}

export function applyRemoteEdgeDelete(payload: EdgeDeletePayload, selfUserId: string): void {
  if (typeof payload.id !== "string") return;
  runAsRemoteCollab(
    () =>
      useWorkspaceStore.setState((state) => {
        if (!state.connections.some((c) => c.id === payload.id)) return {};
        return {
          connections: state.connections.filter((c) => c.id !== payload.id),
          selectedConnectionId:
            state.selectedConnectionId === payload.id ? null : state.selectedConnectionId,
        };
      }),
    { persist: persistFor(payload.senderUserId, selfUserId) }
  );
}

// ----------------------------------------------------------------------------
// Lienzo completo para invitados (en partes)
// ----------------------------------------------------------------------------

/** Parte el lienzo actual en mensajes que caben en Realtime. */
export function buildSnapshotParts(
  senderId: string,
  to: string,
  workspaceId: string,
  workspaceName: string
): CanvasSnapshotPayload[] {
  const { nodes, connections, canvasStrokes } = useWorkspaceStore.getState();
  const snapshotId = `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const chunks: EngineeringNodeData[][] = [[]];
  let chunkBytes = 0;
  for (const raw of nodes) {
    const node = nodeForWire(raw);
    const size = byteLength(node);
    if (size > MAX_EVENT_BYTES) continue;
    if (chunkBytes + size > MAX_SNAPSHOT_PART_BYTES && chunks[chunks.length - 1].length > 0) {
      chunks.push([]);
      chunkBytes = 0;
    }
    chunks[chunks.length - 1].push(node);
    chunkBytes += size;
  }
  const strokes = byteLength(canvasStrokes) <= MAX_SNAPSHOT_PART_BYTES ? canvasStrokes : [];
  const extras = { connections, strokes };
  // Cables y tinta viajan en una parte propia al final.
  chunks.push([]);

  return chunks.map((chunk, part) => ({
    senderId,
    to,
    workspaceId,
    workspaceName,
    snapshotId,
    part,
    total: chunks.length,
    nodes: chunk,
    connections: part === chunks.length - 1 ? extras.connections : [],
    strokes: part === chunks.length - 1 ? extras.strokes : [],
  }));
}

/** Junta las partes de un lienzo y lo aplica cuando están todas. */
export class SnapshotAssembler {
  private readonly parts = new Map<string, Map<number, CanvasSnapshotPayload>>();

  /** Devuelve `true` cuando el lienzo quedó aplicado. */
  accept(payload: CanvasSnapshotPayload): boolean {
    if (
      typeof payload.snapshotId !== "string" ||
      !Number.isInteger(payload.part) ||
      !Number.isInteger(payload.total) ||
      payload.total < 1 ||
      payload.total > 500
    ) {
      return false;
    }
    const bucket = this.parts.get(payload.snapshotId) ?? new Map<number, CanvasSnapshotPayload>();
    bucket.set(payload.part, payload);
    this.parts.set(payload.snapshotId, bucket);
    if (bucket.size < payload.total) return false;

    const ordered = [...bucket.values()].sort((a, b) => a.part - b.part);
    this.parts.clear();
    const nodes = ordered
      .flatMap((p) => (Array.isArray(p.nodes) ? p.nodes : []))
      .map(parseImportedNode)
      .filter((n): n is EngineeringNodeData => n !== null);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const connections = ordered
      .flatMap((p) => (Array.isArray(p.connections) ? p.connections : []))
      .map(parseImportedConnection)
      .filter(
        (c): c is NodeConnection => c !== null && nodeIds.has(c.fromNodeId) && nodeIds.has(c.toNodeId)
      );
    const strokes = sanitizeCanvasStrokes(ordered[ordered.length - 1]?.strokes);

    runAsRemoteCollab(
      () => {
        const store = useWorkspaceStore.getState();
        store.hydrateWorkspace(nodes, connections);
        store.hydrateCanvasStrokes(strokes);
      },
      { persist: false }
    );
    return true;
  }

  clear(): void {
    this.parts.clear();
  }
}
