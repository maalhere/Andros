// ============================================================================
// ANDROS — SINCRONIZACIÓN DEL LIENZO EN VIVO (sin bucles)
//
// Emisión: escucha `useWorkspaceStore` y, por cada nodo o cable que cambió
// LOCALMENTE, emite `node:upsert` / `node:delete` / `edge:upsert` /
// `edge:delete` con un `senderId` único. Los arrastres se limitan a ~25 fps
// por nodo (siempre se envía la última posición) y los receptores los suavizan
// con una transición de 75 ms. El texto de notas y celdas viaja igual mientras
// se escribe (cada ~150 ms, ver NodeEditors): el guardado en PostgreSQL va
// aparte, en segundo plano (useCloudSync), y nunca bloquea la escritura.
//
// Recepción: aplica el cambio dentro de `runAsRemoteCollab(…, { persist: false })`:
//   · este mismo módulo NO lo re-emite (nunca hay eco ni bucle infinito), y
//   · (Sprint 17B) NADIE lo guarda en la nube por el remitente: cada persona
//     (dueño o editor) guarda únicamente SUS cambios locales con su propia RLS.
//     `useCloudSync` solo anota lo recibido como «ya guardado» para no
//     reescribirlo ni borrar archivos de Storage por su cuenta.
//
// Alertas anti-malentendidos (`useImpactStore`): cada alta o baja LOCAL viaja
// como `alert:upsert` / `alert:resolve` con el mismo `senderId`; las que llegan
// se aplican con la misma marca remota, así que tampoco rebotan. Solo viven en
// la sesión (no se guardan en la nube).
//
// Permisos y comentarios (Sprint 16 → 17B):
//   · Los cambios de lienzo solo se aplican si el remitente tiene permiso de
//     edición VERIFICADO en la base (`isReadOnlySender` deniega por defecto).
//   · `comment:*` y `access:changed` son solo AVISOS: quien los recibe vuelve
//     a leer de Supabase (con su RLS) los comentarios y los roles reales. Nunca
//     se confía en el contenido ni en el rol que trae el mensaje.
// ============================================================================

import type {
  AlertResolvePayload,
  AlertUpsertPayload,
  EdgeDeletePayload,
  EdgeUpsertPayload,
  NodeDeletePayload,
  NodeUpsertPayload,
} from "@/types/collab";
import type { EngineeringNodeData, FormPhoto } from "@/types/workspace";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useImpactStore } from "@/store/useImpactStore";
import { sanitizeAlertEntry } from "@/lib/canvas/impact";
import { parseImportedConnection, parseImportedNode } from "@/hooks/useCloudSync";
import { isApplyingRemoteCollab, runAsRemoteCollab } from "./remoteFlag";
import { isReadOnlySender } from "@/lib/access/memberRoles";

/** Intervalo mínimo entre dos envíos del mismo nodo (~25 fps). */
export const NODE_SEND_INTERVAL_MS = 40;
/**
 * Cursores remotos a ~14 fps (70 ms). Con 6 personas moviendo el ratón a la vez
 * son ~86 mensajes/s en total: holgado bajo el límite de Realtime del plan
 * gratuito de Supabase. El receptor interpola en CSS (75 ms lineal), así que
 * el movimiento se sigue viendo continuo.
 */
export const CURSOR_SEND_INTERVAL_MS = 70;
/** Realtime limita cada mensaje: se queda holgado por debajo. */
const MAX_EVENT_BYTES = 180_000;
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
  if (node.type === "form-sheet-node") {
    // Fichas con varias fotos: si no caben en un mensaje, viajan solo las
    // miniaturas (el receptor conserva su imagen completa si ya la tenía).
    if (byteLength(node) <= MAX_EVENT_BYTES - 4_000) return node;
    const light = (photos: FormPhoto[] | undefined) => (photos ?? []).map((p) => ({ ...p, src: "" }));
    const data = node.formSheetData;
    return {
      ...node,
      formSheetData: {
        ...data,
        attachments: light(data.attachments),
        fields: data.fields.map((f) => (f.type === "photo" ? { ...f, photos: light(f.photos) } : f)),
      },
    };
  }
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

  const unsubscribeAlerts = useImpactStore.subscribe((state, prev) => {
    if (state.alerts === prev.alerts) return;
    // Alerta que llegó de la sala: jamás se re-emite.
    if (isApplyingRemoteCollab()) return;
    const workspaceId = options.getWorkspaceId();
    if (!workspaceId) return;
    const before = new Map(prev.alerts.map((a) => [a.id, a]));
    for (const alert of state.alerts) {
      if (before.get(alert.id) !== alert) {
        const payload: AlertUpsertPayload = { ...base(workspaceId), alert };
        options.send("alert:upsert", payload);
      }
      before.delete(alert.id);
    }
    for (const id of before.keys()) {
      const payload: AlertResolvePayload = { ...base(workspaceId), id };
      options.send("alert:resolve", payload);
    }
  });

  return () => {
    unsubscribe();
    unsubscribeAlerts();
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
  if (incoming.type === "form-sheet-node" && local?.type === "form-sheet-node") {
    // Foto que llegó solo como miniatura: se conserva la imagen completa local.
    const fullById = new Map<string, string>();
    for (const p of local.formSheetData.attachments) if (p.src) fullById.set(p.id, p.src);
    for (const f of local.formSheetData.fields) for (const p of f.photos ?? []) if (p.src) fullById.set(p.id, p.src);
    if (fullById.size === 0) return incoming;
    const restore = (photos: FormPhoto[] | undefined) =>
      (photos ?? []).map((p) => (p.src ? p : { ...p, src: fullById.get(p.id) ?? "" }));
    const data = incoming.formSheetData;
    return {
      ...incoming,
      formSheetData: {
        ...data,
        attachments: restore(data.attachments),
        fields: data.fields.map((f) => (f.type === "photo" ? { ...f, photos: restore(f.photos) } : f)),
      },
    };
  }
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

/** Sin permiso de edición verificado en este espacio: se descarta (denegar por defecto). */
function blocked(payload: { workspaceId: unknown; senderUserId: unknown }): boolean {
  if (typeof payload.workspaceId !== "string" || typeof payload.senderUserId !== "string") return true;
  return isReadOnlySender(payload.workspaceId, payload.senderUserId);
}

/**
 * Todo lo que llega por la sala se aplica SOLO en memoria: el remitente ya lo
 * guardó con su propia sesión. El receptor nunca escribe ni borra por él.
 */
export const REMOTE_APPLY_OPTIONS = { persist: false } as const;

export function applyRemoteNodeUpsert(payload: NodeUpsertPayload): void {
  if (blocked(payload)) return;
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
    REMOTE_APPLY_OPTIONS
  );
}

export function applyRemoteNodeDelete(payload: NodeDeletePayload): void {
  if (blocked(payload)) return;
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
    REMOTE_APPLY_OPTIONS
  );
}

export function applyRemoteEdgeUpsert(payload: EdgeUpsertPayload): void {
  if (blocked(payload)) return;
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
    REMOTE_APPLY_OPTIONS
  );
}

export function applyRemoteEdgeDelete(payload: EdgeDeletePayload): void {
  if (blocked(payload)) return;
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
    REMOTE_APPLY_OPTIONS
  );
}

export function applyRemoteAlertUpsert(payload: AlertUpsertPayload): void {
  const alert = sanitizeAlertEntry(payload.alert);
  if (!alert) return;
  runAsRemoteCollab(() => useImpactStore.getState().upsertAlert(alert), REMOTE_APPLY_OPTIONS);
}

export function applyRemoteAlertResolve(payload: AlertResolvePayload): void {
  if (typeof payload.id !== "string") return;
  runAsRemoteCollab(() => useImpactStore.getState().resolveAlert(payload.id), REMOTE_APPLY_OPTIONS);
}

// ----------------------------------------------------------------------------
// Comentarios y permisos (Sprint 16 → 17B): solo avisos de «vuelve a leer»
// ----------------------------------------------------------------------------

/**
 * Aviso de la sala sobre comentarios (`comment:*`) o permisos
 * (`access:changed`). Solo indica que hay que volver a leer de Supabase: el
 * contenido, el autor y el rol del mensaje se IGNORAN (los podría inventar
 * cualquiera que esté en la sala). `true` si el aviso es para `workspaceId`.
 */
export function isRefreshNotice(payload: unknown, workspaceId: string | null): boolean {
  if (!payload || typeof payload !== "object" || !workspaceId) return false;
  return (payload as { workspaceId?: unknown }).workspaceId === workspaceId;
}

// ----------------------------------------------------------------------------
// (Sprint 17B) El intercambio de «lienzo completo» por la sala (`canvas:request`
// / `canvas:snapshot`, enlaces antiguos `?sala=`) se RETIRÓ: entregaba todo el
// tablero (chats IA y URLs firmadas incluidos) a quien lo pidiera. Ahora cada
// miembro lee el lienzo de Supabase con su propia RLS.
// ----------------------------------------------------------------------------
