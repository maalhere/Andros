"use client";

// ============================================================================
// ANDROS — SALA EN VIVO (SPRINT 7 → 7.6): canal de voz persistente estilo
// Discord, presencia, cursores, cámara, pantalla compartida y edición
// simultánea del lienzo, con $0 de infraestructura:
//   · Supabase Realtime Presence  → quién está en el espacio y quién en voz.
//   · Supabase Realtime Broadcast → cursores, cambios del lienzo y señales.
//   · WebRTC nativo (malla 2–6)   → audio, cámara y pantalla, con STUN
//                                   público (+ TURN opcional NEXT_PUBLIC_TURN_*).
//
// Dos capas separadas:
//   1. PRESENCIA PASIVA (automática): al abrir un espacio en la nube te
//      suscribes al canal con { inCall: false } SIN pedir micrófono ni abrir
//      conexiones WebRTC. Así todos ven en vivo quién está en voz.
//   2. LLAMADA ACTIVA («Unirse a voz»): presencia { inCall: true }, se pide el
//      micrófono elegido y se conecta SOLO con quien también está en voz.
//      «Salir de voz» cierra los RTCPeerConnection y apaga micrófono/cámara,
//      pero sigues en el espacio viendo quién queda en el canal.
//
// `useCollabRoom()` se monta UNA vez (page.tsx). Las acciones se pueden llamar
// desde cualquier componente. Al cerrar sesión, salir de la página o
// desmontar se cierra TODO: nada queda encendido.
// ============================================================================

import { track } from "@/lib/analytics/telemetry";
import { useEffect } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useToastStore } from "@/store/useToastStore";
import {
  SCREEN_NODE_DEFAULT_SIZE,
  colorForPeer,
  isCanvasReadOnly,
  useCollabStore,
} from "@/store/useCollabStore";
import {
  openCloudWorkspace,
  openWorkspaceFromLink,
  refreshCloudWorkspaceList,
  resumeCloudAfterCollabGuest,
  suspendCloudForCollabGuest,
} from "@/hooks/useCloudSync";
import { currentWorkspaceRole } from "@/lib/access/workspaceRole";
import { ROLE_LABELS } from "@/lib/access/permissions";
import {
  MAX_SPACE_PARTICIPANTS,
  MAX_VOICE_PARTICIPANTS,
  type AccessChangedPayload,
  type AlertResolvePayload,
  AlertUpsertPayload,
  type CanvasRequestPayload,
  type CanvasSnapshotPayload,
  type CollabPresence,
  type CommentDeletePayload,
  type CommentResolvePayload,
  type CommentUpsertPayload,
  type CursorPayload,
  type EdgeDeletePayload,
  type EdgeUpsertPayload,
  type NodeDeletePayload,
  type NodeUpsertPayload,
  type RemoteEditor,
  type RtcSignalPayload,
  type ScreenShareNodeData,
  type ScreenStopPayload,
} from "@/types/collab";
import { PeerMesh } from "./peerMesh";
import { VoiceActivityMonitor } from "./voiceActivity";
import {
  refreshMediaDevices,
  selectedDeviceId,
  supportsSpeakerSelection,
  useMediaDevicesStore,
} from "./mediaDevices";
import {
  CURSOR_SEND_INTERVAL_MS,
  SnapshotAssembler,
  applyRemoteAccessChanged,
  applyRemoteAlertResolve,
  applyRemoteAlertUpsert,
  applyRemoteCommentDelete,
  applyRemoteCommentResolve,
  applyRemoteCommentUpsert,
  applyRemoteEdgeDelete,
  applyRemoteEdgeUpsert,
  applyRemoteNodeDelete,
  applyRemoteNodeUpsert,
  buildSnapshotParts,
  startCanvasSync,
} from "./canvasSync";
import {
  buildWorkspaceLink,
  channelNameFor,
  consumeInviteFromUrl,
  copyText,
  resolveCurrentRoom,
} from "./room";

/** ~14 fps para los cursores (definido en `canvasSync.ts`; el receptor los interpola en CSS). */
export { CURSOR_SEND_INTERVAL_MS };
/** Un cursor sin moverse durante este tiempo se oculta. */
const CURSOR_STALE_MS = 6000;
/** Un nodo de pantalla finalizado se retira solo tras este tiempo. */
const ENDED_SHARE_REMOVE_MS = 8000;
const SNAPSHOT_RETRY_MS = 3000;
const SNAPSHOT_MAX_ATTEMPTS = 5;
/** Pausa entre partes del lienzo (respeta el límite de mensajes de Realtime). */
const SNAPSHOT_PART_GAP_MS = 60;

/** Cámara ligera: 640×360 a 24 fps (suficiente para 2–5 personas en malla). */
const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24 },
};

/**
 * Pantalla compartida a 720p y 15 fps como máximo: legible y estable incluso
 * por datos móviles (el bitrate se limita además en cada enlace).
 */
const SCREEN_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280, max: 1280 },
  height: { ideal: 720, max: 720 },
  frameRate: { ideal: 15, max: 15 },
};

/** Agrupa los cambios de «escribiendo en…» (tabular por celdas no satura Presence). */
const EDITING_PRESENCE_DELAY_MS = 150;

export const LOCAL_MODE_MESSAGE = "Modo local — inicia sesión para colaborar en vivo";

const toast = (message: string, tone: "neutral" | "success" | "error" = "neutral") =>
  useToastStore.getState().show({ message, tone });

const collab = useCollabStore.getState;

// ----------------------------------------------------------------------------
// Estado privado (fuera de React para que la limpieza sea total)
// ----------------------------------------------------------------------------

/** Capa 1: presencia pasiva del espacio (canal de Realtime). */
interface PresenceSession {
  supabase: SupabaseClient;
  channel: RealtimeChannel;
  roomId: string;
  assembler: SnapshotAssembler;
  stopCanvasSync: (() => void) | null;
  subscribed: boolean;
  /** `true` si el canal se pidió como privado (config.private). */
  isPrivate: boolean;
  /** Ya llegó a SUBSCRIBED alguna vez (para distinguir "sin permisos" de "se cayó la red"). */
  everSubscribed: boolean;
  snapshotReceived: boolean;
  snapshotTimer: ReturnType<typeof setTimeout> | null;
  cursorPruneTimer: ReturnType<typeof setInterval> | null;
}

/** Capa 2: llamada activa (WebRTC + medidor de voz). */
interface CallSession {
  mesh: PeerMesh;
  voice: VoiceActivityMonitor;
  /** Id de esta entrada a la voz (si cambia, los demás rehacen el enlace). */
  callId: string;
}

let session: PresenceSession | null = null;

/**
 * Canales Realtime PRIVADOS (config.private): solo entran usuarios autenticados
 * que pasen las políticas RLS de `realtime.messages` (ver supabase/schema.sql,
 * sección 8). Si el proyecto aún no las tiene, el primer intento falla y la
 * sala vuelve a un canal público con un aviso discreto en consola, sin romperse.
 */
let privateChannelsAvailable = true;
let call: CallSession | null = null;
let micStream: MediaStream | null = null;
let cameraStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
/** Cambia con cada conexión/desconexión del canal: invalida respuestas viejas. */
let presenceToken = 0;
/** Cambia con cada entrada/salida de la voz: invalida operaciones asíncronas viejas. */
let joinToken = 0;
let mutedBeforeDeafen = false;
const endedShareTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Vídeos recibidos por participante y `MediaStream.id` (cámara o pantalla). */
const remoteVideos = new Map<string, Map<string, MediaStream>>();
/** Último `callId` visto de cada participante en voz. */
const peerCallIds = new Map<string, string>();

/** Cuándo entraste a tu espacio actual (orden estable para el tope de 6). */
let spaceJoinedAt = Date.now();
let spaceJoinedFor: string | null = null;
/** Cuándo entraste a la voz (orden estable para el tope de 5). */
let callJoinedAt: number | null = null;
let editingRetrackTimer: ReturnType<typeof setTimeout> | null = null;

let cursorTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCursor: { x: number; y: number } | null = null;
let lastCursorAt = 0;

const screenShareIdFor = (peerId: string) => `screen-${peerId}`;

function randomId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Espacio que se edita en vivo: el del anfitrión si eres invitado, si no el tuyo. */
export function liveWorkspaceId(): string | null {
  return collab().guest?.workspaceId ?? useCloudStore.getState().workspaceId;
}

function currentWorkspaceName(): string {
  const guest = collab().guest;
  if (guest) return guest.workspaceName;
  const id = useCloudStore.getState().workspaceId;
  const manager = useWorkspaceManagerStore.getState();
  return (
    manager.workspaces.find((w) => w.id === id)?.name ??
    manager.sharedWorkspaces.find((w) => w.id === id)?.name ??
    "Espacio actual"
  );
}

function selfDisplayName(): string {
  const user = useCloudStore.getState().user;
  return user?.name?.trim() || "Participante";
}

/** Marca de entrada a tu espacio actual: se renueva solo al cambiar de espacio. */
function selfSpaceJoinedAt(): number {
  const workspaceId = liveWorkspaceId();
  if (workspaceId !== spaceJoinedFor) {
    spaceJoinedFor = workspaceId;
    spaceJoinedAt = Date.now();
  }
  return spaceJoinedAt;
}

function presencePayload(): CollabPresence {
  const state = collab();
  const user = useCloudStore.getState().user;
  const streamIds = call?.mesh.outStreamIds() ?? null;
  const joinedAt = selfSpaceJoinedAt();
  return {
    peerId: state.selfPeerId,
    userId: user?.id ?? "",
    name: selfDisplayName(),
    avatarUrl: null,
    color: state.selfColor,
    workspaceId: liveWorkspaceId(),
    workspaceName: currentWorkspaceName(),
    muted: state.muted,
    deafened: state.deafened,
    hasMic: state.hasMic,
    sharing: state.sharing,
    guest: Boolean(state.guest),
    joinedAt,
    callJoinedAt: call ? callJoinedAt : null,
    editingNodeId: state.editingNodeId,
    inCall: Boolean(call),
    hasVideo: Boolean(call) && state.hasVideo,
    callId: call?.callId ?? null,
    cameraStreamId: streamIds?.camera ?? null,
    screenStreamId: streamIds?.screen ?? null,
  };
}

function send(event: string, payload: object): void {
  if (!session?.subscribed) return;
  void session.channel.send({ type: "broadcast", event, payload }).catch(() => undefined);
}

/** Hay alguien más en el espacio (si no, no se gastan mensajes de Realtime). */
function hasPeers(): boolean {
  return Object.keys(collab().peers).length > 0;
}

/**
 * (Sprint 16) Aviso en vivo que NO es un cambio del lienzo (comentarios,
 * permisos): viaja aunque tu rol sea Comentarista. Sin nadie más, no se envía.
 */
export function broadcastCollabEvent(event: string, payload: object): void {
  if (hasPeers()) send(event, payload);
}

/** Datos comunes de un aviso en vivo (`senderId`, `senderUserId`, `workspaceId`). */
export function collabEventBase(): { senderId: string; senderUserId: string; workspaceId: string } | null {
  const workspaceId = liveWorkspaceId();
  const userId = useCloudStore.getState().user?.id;
  if (!workspaceId || !userId) return null;
  return { senderId: collab().selfPeerId, senderUserId: userId, workspaceId };
}

/** El dueño cambió tu permiso: se vuelve a leer tu rol REAL de la base. */
async function refreshOwnAccess(): Promise<void> {
  const before = currentWorkspaceRole();
  await refreshCloudWorkspaceList();
  const after = currentWorkspaceRole();
  if (after === before) return;
  useToastStore.getState().show({
    message: `Tu permiso en este espacio ahora es: ${ROLE_LABELS[after]}.`,
    tone: "neutral",
  });
}

/** Publica de nuevo tu presencia (al silenciarte, compartir o cambiar de espacio). */
function retrackPresence(): void {
  if (!session?.subscribed) return;
  void session.channel.track(presencePayload()).catch(() => undefined);
}

/** Punto del lienzo en el centro de la vista (con un pequeño escalonado). */
function viewportSlot(index: number): { x: number; y: number } {
  const { x, y, scale } = useWorkspaceStore.getState().canvasTransform;
  const width = typeof window === "undefined" ? 1280 : window.innerWidth;
  const height = typeof window === "undefined" ? 800 : window.innerHeight;
  return {
    x: Math.round((width / 2 - x) / scale - SCREEN_NODE_DEFAULT_SIZE.width / 2 + index * 32),
    y: Math.round((height / 2 - y) / scale - SCREEN_NODE_DEFAULT_SIZE.height / 2 + index * 32),
  };
}

// ----------------------------------------------------------------------------
// Pantallas compartidas (nodo efímero `screen-share-node`)
// ----------------------------------------------------------------------------

function cancelEndedRemoval(shareId: string): void {
  const timer = endedShareTimers.get(shareId);
  if (timer) clearTimeout(timer);
  endedShareTimers.delete(shareId);
}

function ensureRemoteShare(peer: CollabPresence, stream?: MediaStream | null): void {
  const id = screenShareIdFor(peer.peerId);
  cancelEndedRemoval(id);
  const existing = collab().screenShares.find((s) => s.id === id);
  const status = stream ? "live" : existing && existing.status !== "ended" ? existing.status : "connecting";
  const share: ScreenShareNodeData = {
    id,
    type: "screen-share-node",
    peerId: peer.peerId,
    presenterName: peer.name,
    presenterColor: peer.color,
    isLocal: false,
    status,
    position: existing?.position ?? viewportSlot(collab().screenShares.length),
    size: existing?.size ?? SCREEN_NODE_DEFAULT_SIZE,
    startedAt: existing?.startedAt ?? Date.now(),
  };
  collab().upsertScreenShare(share, stream === undefined ? undefined : stream);
}

/** Marca la pantalla como finalizada y la retira sola en unos segundos. */
function endRemoteShare(shareId: string): void {
  const share = collab().screenShares.find((s) => s.id === shareId);
  if (!share || share.isLocal) return;
  collab().setScreenStream(shareId, null);
  if (share.status !== "ended") collab().patchScreenShare(shareId, { status: "ended" });
  if (endedShareTimers.has(shareId)) return;
  endedShareTimers.set(
    shareId,
    setTimeout(() => {
      endedShareTimers.delete(shareId);
      if (collab().screenShares.find((s) => s.id === shareId)?.status === "ended") {
        collab().removeScreenShare(shareId);
      }
    }, ENDED_SHARE_REMOVE_MS)
  );
}

function handleRemoteScreen(peerId: string, stream: MediaStream | null): void {
  const shareId = screenShareIdFor(peerId);
  if (!stream) {
    endRemoteShare(shareId);
    return;
  }
  const peer = collab().peers[peerId];
  ensureRemoteShare(
    peer ?? {
      ...presencePayload(),
      peerId,
      name: "Participante",
      color: colorForPeer(peerId),
    },
    stream
  );
}

// ----------------------------------------------------------------------------
// Vídeo remoto: cámara y pantalla separadas por el `MediaStream.id` anunciado
// ----------------------------------------------------------------------------

/** Reparte los vídeos de un participante entre su cámara y su pantalla. */
function routeRemoteVideos(peerId: string): void {
  const peer = collab().peers[peerId];
  const videos = remoteVideos.get(peerId);
  let camera: MediaStream | null = null;
  let screen: MediaStream | null = null;

  if (peer && videos) {
    for (const [streamId, stream] of [...videos]) {
      if (peer.cameraStreamId && streamId === peer.cameraStreamId) {
        // Cámara apagada: se descarta el flujo viejo (al volver llega uno nuevo).
        if (peer.hasVideo) camera = stream;
        else videos.delete(streamId);
      } else if (peer.screenStreamId && streamId === peer.screenStreamId) {
        if (peer.sharing) screen = stream;
        else videos.delete(streamId);
      } else if (!peer.cameraStreamId && !peer.screenStreamId && peer.sharing && !peer.hasVideo) {
        // Cliente sin ids anunciados: lo único que puede enviar es su pantalla.
        screen = stream;
      }
    }
  }

  collab().setRemoteCamera(peerId, camera);
  if (screen && collab().screenStreams[screenShareIdFor(peerId)] !== screen) {
    handleRemoteScreen(peerId, screen);
  }
}

function handleRemoteVideo(peerId: string, streamId: string | null, stream: MediaStream | null): void {
  if (streamId === null || !stream) {
    remoteVideos.delete(peerId);
    collab().setRemoteCamera(peerId, null);
    handleRemoteScreen(peerId, null);
    return;
  }
  let videos = remoteVideos.get(peerId);
  if (!videos) {
    videos = new Map();
    remoteVideos.set(peerId, videos);
  }
  videos.set(streamId, stream);
  routeRemoteVideos(peerId);
}

// ----------------------------------------------------------------------------
// Presencia
// ----------------------------------------------------------------------------

function sanitizePresence(raw: unknown, key: string): CollabPresence | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<CollabPresence>;
  const text = (v: unknown, fallback: string, max = 80) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
  const optionalId = (v: unknown) =>
    typeof v === "string" && /^[A-Za-z0-9{}_-]{1,100}$/.test(v) ? v : null;
  return {
    peerId: key,
    userId: text(p.userId, ""),
    name: text(p.name, "Participante", 60),
    avatarUrl: null,
    color: typeof p.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : colorForPeer(key),
    workspaceId: typeof p.workspaceId === "string" ? p.workspaceId : null,
    workspaceName: text(p.workspaceName, "Espacio", 80),
    muted: Boolean(p.muted),
    deafened: Boolean(p.deafened),
    hasMic: Boolean(p.hasMic),
    sharing: Boolean(p.sharing),
    guest: Boolean(p.guest),
    joinedAt: Number(p.joinedAt) || 0,
    callJoinedAt: Number.isFinite(p.callJoinedAt) ? Number(p.callJoinedAt) : null,
    // Ids de tarjeta: cualquier texto corto (plantillas e importaciones usan otros formatos).
    editingNodeId:
      typeof p.editingNodeId === "string" && p.editingNodeId.length > 0 && p.editingNodeId.length <= 160
        ? p.editingNodeId
        : null,
    // Clientes anteriores (sin `inCall`) siempre estaban dentro de la llamada.
    inCall: typeof p.inCall === "boolean" ? p.inCall : true,
    hasVideo: Boolean(p.hasVideo),
    callId: optionalId(p.callId),
    cameraStreamId: optionalId(p.cameraStreamId),
    screenStreamId: optionalId(p.screenStreamId),
  };
}

// ----------------------------------------------------------------------------
// Tope de participantes: 6 por espacio y 5 en voz (orden de llegada estable)
// ----------------------------------------------------------------------------

/** Orden de llegada determinista: todos calculan el mismo resultado. */
function arrivalOrder(entries: { peerId: string; at: number }[]): string[] {
  return entries
    .sort((a, b) => a.at - b.at || (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0))
    .map((entry) => entry.peerId);
}

/** Participantes con lugar en la voz (los 5 primeros en entrar), tú incluido. */
function voiceSlots(peers: Record<string, CollabPresence>): Set<string> {
  const entries = Object.values(peers)
    .filter((peer) => peer.inCall)
    .map((peer) => ({ peerId: peer.peerId, at: peer.callJoinedAt ?? peer.joinedAt }));
  if (call && callJoinedAt !== null) entries.push({ peerId: collab().selfPeerId, at: callJoinedAt });
  return new Set(arrivalOrder(entries).slice(0, MAX_VOICE_PARTICIPANTS));
}

/** Calcula tu lugar en el espacio (lectura si llegaste 7.º) y quién escribe dónde. */
function syncCapacity(peers: Record<string, CollabPresence>, slots: Set<string>): void {
  const state = collab();
  const workspaceId = liveWorkspaceId();
  const inSpace = Object.values(peers).filter((peer) => workspaceId && peer.workspaceId === workspaceId);
  const order = arrivalOrder([
    { peerId: state.selfPeerId, at: selfSpaceJoinedAt() },
    ...inSpace.map((peer) => ({ peerId: peer.peerId, at: peer.joinedAt })),
  ]);
  const readOnly = Boolean(workspaceId) && order.indexOf(state.selfPeerId) >= MAX_SPACE_PARTICIPANTS;
  const wasReadOnly = state.capacity.readOnly;
  state.setCapacity({
    spaceCount: Math.min(order.length, MAX_SPACE_PARTICIPANTS),
    voiceCount: Object.values(peers).filter((peer) => peer.inCall && slots.has(peer.peerId)).length + (call ? 1 : 0),
    readOnly,
  });
  if (wasReadOnly && !readOnly) toast("Se liberó un lugar: ya puedes editar el espacio en vivo.", "success");

  // «Editando: Nombre» en cada tarjeta (solo de quien tiene lugar en tu espacio).
  const active = new Set(order.slice(0, MAX_SPACE_PARTICIPANTS));
  const editors: Record<string, RemoteEditor> = {};
  for (const peer of inSpace) {
    if (!peer.editingNodeId || !active.has(peer.peerId) || editors[peer.editingNodeId]) continue;
    editors[peer.editingNodeId] = { peerId: peer.peerId, name: peer.name, color: peer.color };
  }
  state.setRemoteEditors(editors);
}

/** Abre o cierra enlaces WebRTC según quién está DENTRO de la voz (y con lugar). */
function syncCallLinks(peers: Record<string, CollabPresence>, slots: Set<string>): void {
  if (!call) return;
  const { mesh, voice } = call;
  for (const id of mesh.peerIds()) {
    const peer = peers[id];
    const knownCallId = peerCallIds.get(id);
    const rejoined = Boolean(peer?.callId && knownCallId && peer.callId !== knownCallId);
    // Salió del espacio o de la voz: su enlace, su temporizador ICE y su
    // aviso de «Sin audio» se borran AL INSTANTE.
    if (!peer || !peer.inCall || rejoined || !slots.has(id)) {
      mesh.removePeer(id);
      voice.unwatch(id);
      peerCallIds.delete(id);
    }
  }
  for (const peer of Object.values(peers)) {
    if (!peer.inCall || !slots.has(peer.peerId)) continue;
    if (peer.callId) peerCallIds.set(peer.peerId, peer.callId);
    mesh.ensurePeer(peer.peerId);
  }
}

/** Dos personas entraron a la vez y quedaste 6.º en voz: sales de la voz (no del espacio). */
function dropFromFullVoice(): void {
  teardownCall();
  collab().resetCall();
  retrackPresence();
  toast(`Canal de voz lleno (${MAX_VOICE_PARTICIPANTS}/${MAX_VOICE_PARTICIPANTS}). Sigues en el espacio.`, "error");
}

function handlePresenceSync(): void {
  if (!session) return;
  const raw = session.channel.presenceState();
  const selfId = collab().selfPeerId;
  const peers: Record<string, CollabPresence> = {};
  for (const [key, metas] of Object.entries(raw)) {
    if (key === selfId || !Array.isArray(metas) || metas.length === 0) continue;
    const presence = sanitizePresence(metas[metas.length - 1], key);
    if (presence) peers[key] = presence;
  }

  collab().setPeers(peers);
  for (const id of [...peerCallIds.keys()]) if (!peers[id]) peerCallIds.delete(id);
  const slots = voiceSlots(peers);
  syncCapacity(peers, slots);
  if (call && !slots.has(selfId)) {
    dropFromFullVoice();
    return;
  }
  syncCallLinks(peers, slots);

  // Pantallas: la presencia es la fuente de verdad de quién comparte (y
  // solo llegan por WebRTC si TÚ también estás dentro de la voz, con lugar).
  const receivesScreen = (peer: CollabPresence | undefined): peer is CollabPresence =>
    Boolean(call && peer?.sharing && peer.inCall && slots.has(peer.peerId));
  for (const peer of Object.values(peers)) {
    if (receivesScreen(peer)) ensureRemoteShare(peer);
  }
  for (const share of collab().screenShares) {
    if (!share.isLocal && !receivesScreen(peers[share.peerId])) endRemoteShare(share.id);
  }
  for (const id of new Set([...Object.keys(peers), ...remoteVideos.keys()])) routeRemoteVideos(id);

  // Invitado: nombre real del anfitrión y del espacio.
  const guest = collab().guest;
  if (guest) {
    const host = Object.values(peers).find((p) => p.workspaceId === guest.workspaceId && !p.guest);
    if (host && (host.name !== guest.hostName || host.workspaceName !== guest.workspaceName)) {
      collab().setGuest({ ...guest, hostName: host.name, workspaceName: host.workspaceName });
    }
  }
}

// ----------------------------------------------------------------------------
// Lienzo completo para invitados (enlaces antiguos `?sala=`)
// ----------------------------------------------------------------------------

function requestSnapshot(attempt: number): void {
  if (!session || session.snapshotReceived) return;
  const guest = collab().guest;
  if (!guest) return;
  if (attempt >= SNAPSHOT_MAX_ATTEMPTS) {
    toast(
      "Nadie tiene ese espacio abierto ahora. Pide al anfitrión que lo abra y vuelve a unirte.",
      "error"
    );
    return;
  }
  const payload: CanvasRequestPayload = {
    senderId: collab().selfPeerId,
    workspaceId: guest.workspaceId,
  };
  send("canvas:request", payload);
  session.snapshotTimer = setTimeout(() => requestSnapshot(attempt + 1), SNAPSHOT_RETRY_MS);
}

async function answerSnapshotRequest(payload: CanvasRequestPayload): Promise<void> {
  const cloud = useCloudStore.getState();
  if (collab().guest || !cloud.workspaceId || payload.workspaceId !== cloud.workspaceId) return;
  if (typeof payload.senderId !== "string") return;
  const token = presenceToken;
  const parts = buildSnapshotParts(
    collab().selfPeerId,
    payload.senderId,
    cloud.workspaceId,
    currentWorkspaceName()
  );
  for (const part of parts) {
    if (token !== presenceToken) return;
    send("canvas:snapshot", part);
    await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_PART_GAP_MS));
  }
}

function acceptSnapshot(payload: CanvasSnapshotPayload): void {
  if (!session || session.snapshotReceived) return;
  const guest = collab().guest;
  if (!guest || payload.to !== collab().selfPeerId || payload.workspaceId !== guest.workspaceId) return;
  if (!session.assembler.accept(payload)) return;
  session.snapshotReceived = true;
  if (session.snapshotTimer) clearTimeout(session.snapshotTimer);
  session.snapshotTimer = null;
  const name = typeof payload.workspaceName === "string" ? payload.workspaceName.slice(0, 80) : guest.workspaceName;
  collab().setGuest({ ...guest, workspaceName: name });
  useWorkspaceStore.getState().requestZoomExtents();
  toast(`Ves «${name}» en vivo. Tus cambios los guarda el anfitrión.`, "success");
}

// ----------------------------------------------------------------------------
// Capa 1: presencia pasiva del espacio
// ----------------------------------------------------------------------------

/** Cierra el canal de Realtime (sin tocar la llamada: usa `teardownCall`). */
function disconnectPresence(): void {
  presenceToken += 1;
  const current = session;
  session = null;

  if (cursorTimer) clearTimeout(cursorTimer);
  cursorTimer = null;
  pendingCursor = null;
  if (editingRetrackTimer) clearTimeout(editingRetrackTimer);
  editingRetrackTimer = null;

  if (!current) return;
  current.stopCanvasSync?.();
  if (current.snapshotTimer) clearTimeout(current.snapshotTimer);
  if (current.cursorPruneTimer) clearInterval(current.cursorPruneTimer);
  current.assembler.clear();
  void current.channel.untrack().catch(() => undefined);
  void current.supabase.removeChannel(current.channel).catch(() => undefined);
}

/**
 * Entra (sin micrófono) al canal del espacio abierto o al de `target`. Si ya
 * estás en esa sala solo actualiza tu presencia. Cambiar de sala cierra la
 * llamada de la sala anterior y, si estabas en voz, vuelve a entrar en la nueva.
 */
function connectPresence(target?: { roomId: string; label: string }): void {
  const supabase = getSupabaseBrowserClient();
  const cloud = useCloudStore.getState();
  if (!supabase || !cloud.user) return;
  const room = target ?? resolveCurrentRoom();
  if (!room) return;

  if (session && session.roomId === room.roomId) {
    collab().setRoom(room.roomId, room.label);
    retrackPresence();
    return;
  }

  // Solo se cierra una llamada que EXISTE (una entrada a la voz en curso,
  // p. ej. desde un enlace antiguo, no se cancela: continúa en la sala nueva).
  const wasInCall = Boolean(call);
  if (wasInCall) {
    teardownCall();
    collab().resetCall();
  }
  if (session) {
    disconnectPresence();
    collab().setPeers({});
  }

  const token = ++presenceToken;
  const selfId = collab().selfPeerId;
  collab().setRoom(room.roomId, room.label);
  collab().setStatus("connecting", null);

  const isPrivate = privateChannelsAvailable;
  const channel = supabase.channel(channelNameFor(room.roomId), {
    config: { private: isPrivate, broadcast: { self: false, ack: false }, presence: { key: selfId } },
  });

  session = {
    supabase,
    channel,
    roomId: room.roomId,
    assembler: new SnapshotAssembler(),
    stopCanvasSync: null,
    subscribed: false,
    isPrivate,
    everSubscribed: false,
    snapshotReceived: false,
    snapshotTimer: null,
    cursorPruneTimer: setInterval(() => {
      const now = Date.now();
      for (const cursor of Object.values(collab().cursors)) {
        if (now - cursor.at > CURSOR_STALE_MS) collab().removeCursor(cursor.peerId);
      }
    }, 2000),
  };

  const selfUserId = () => useCloudStore.getState().user?.id ?? "";
  const forLiveWorkspace = (payload: { workspaceId?: unknown }) =>
    typeof payload.workspaceId === "string" && payload.workspaceId === liveWorkspaceId();

  channel
    .on("presence", { event: "sync" }, handlePresenceSync)
    .on("broadcast", { event: "rtc:signal" }, ({ payload }) => {
      // Fuera de la voz no se acepta ninguna conexión WebRTC.
      void call?.mesh.handleSignal(payload as RtcSignalPayload);
    })
    .on("broadcast", { event: "cursor" }, ({ payload }) => {
      const p = payload as CursorPayload;
      if (typeof p.senderId !== "string" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      collab().setCursor({
        peerId: p.senderId,
        x: p.x,
        y: p.y,
        workspaceId: typeof p.workspaceId === "string" ? p.workspaceId : null,
        at: Date.now(),
      });
    })
    .on("broadcast", { event: "node:upsert" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteNodeUpsert(payload as NodeUpsertPayload, selfUserId());
    })
    .on("broadcast", { event: "node:delete" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteNodeDelete(payload as NodeDeletePayload, selfUserId());
    })
    .on("broadcast", { event: "edge:upsert" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteEdgeUpsert(payload as EdgeUpsertPayload, selfUserId());
    })
    .on("broadcast", { event: "edge:delete" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteEdgeDelete(payload as EdgeDeletePayload, selfUserId());
    })
    .on("broadcast", { event: "alert:upsert" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteAlertUpsert(payload as AlertUpsertPayload);
    })
    .on("broadcast", { event: "alert:resolve" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteAlertResolve(payload as AlertResolvePayload);
    })
    // (Sprint 16) Comentarios y permisos: la base (RLS) es la fuente de verdad.
    .on("broadcast", { event: "comment:upsert" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteCommentUpsert(payload as CommentUpsertPayload);
    })
    .on("broadcast", { event: "comment:resolve" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteCommentResolve(payload as CommentResolvePayload);
    })
    .on("broadcast", { event: "comment:delete" }, ({ payload }) => {
      if (forLiveWorkspace(payload)) applyRemoteCommentDelete(payload as CommentDeletePayload);
    })
    .on("broadcast", { event: "access:changed" }, ({ payload }) => {
      if (!forLiveWorkspace(payload)) return;
      if (applyRemoteAccessChanged(payload as AccessChangedPayload, selfUserId())) void refreshOwnAccess();
    })
    .on("broadcast", { event: "canvas:request" }, ({ payload }) => {
      void answerSnapshotRequest(payload as CanvasRequestPayload);
    })
    .on("broadcast", { event: "canvas:snapshot" }, ({ payload }) => {
      acceptSnapshot(payload as CanvasSnapshotPayload);
    })
    .on("broadcast", { event: "screen:stop" }, ({ payload }) => {
      const p = payload as ScreenStopPayload;
      if (typeof p.senderId === "string") endRemoteShare(screenShareIdFor(p.senderId));
    })
    .subscribe((status) => {
      if (token !== presenceToken || !session) return;
      if (status === "SUBSCRIBED") {
        session.subscribed = true;
        session.everSubscribed = true;
        collab().setStatus("connected", null);
        retrackPresence();
        if (!session.stopCanvasSync) {
          session.stopCanvasSync = startCanvasSync({
            selfId,
            getUserId: selfUserId,
            getWorkspaceId: liveWorkspaceId,
            // Sin nadie más en el espacio, en sala llena o con rol Comentarista /
            // Solo lectura, no se envía ningún cambio del lienzo.
            send: (event, payload) => {
              if (hasPeers() && !isCanvasReadOnly()) send(event, payload);
            },
          });
        }
        if (collab().guest && !session.snapshotReceived && !session.snapshotTimer) requestSnapshot(0);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Canal privado rechazado antes de entrar (sin políticas RLS de Realtime):
        // se reintenta una vez como canal público sin romper la sala.
        if (session.isPrivate && !session.everSubscribed) {
          privateChannelsAvailable = false;
          console.warn(
            "[Andros] Realtime privado no disponible en este proyecto de Supabase (faltan las políticas de realtime.messages, ver supabase/schema.sql §8). Se usa el canal público."
          );
          disconnectPresence();
          connectPresence(room);
          return;
        }
        session.subscribed = false;
        collab().setStatus(
          "error",
          "Se perdió la conexión con el espacio en vivo. Reintentando… (revisa que Realtime esté activo en Supabase)."
        );
      }
    });

  if (wasInCall) void joinCollabRoom();
}

/** Presencia pasiva del espacio abierto (no hace nada si eres invitado). */
function ensurePresence(): void {
  if (collab().guest || collab().status === "local") return;
  connectPresence();
}

// ----------------------------------------------------------------------------
// Audio remoto: reproducción garantizada + salida elegida (setSinkId)
// ----------------------------------------------------------------------------

/** Elementos <audio> reales del DOM (los registra VoiceRoomBar). */
const remoteAudioElements = new Set<HTMLAudioElement>();

type SinkCapableElement = HTMLMediaElement & { setSinkId: (sinkId: string) => Promise<void> };

/** Aplica la salida de audio elegida (Chrome, Edge, Firefox y Electron). */
async function applySpeaker(element: HTMLAudioElement): Promise<void> {
  if (!supportsSpeakerSelection()) return;
  try {
    await (element as SinkCapableElement).setSinkId(selectedDeviceId("speaker"));
  } catch {
    /* dispositivo desconectado: el sistema usa su salida predeterminada */
  }
}

export function registerRemoteAudioElement(element: HTMLAudioElement): () => void {
  remoteAudioElements.add(element);
  void applySpeaker(element);
  return () => {
    remoteAudioElements.delete(element);
  };
}

/** Intenta reproducir un <audio>; si el navegador lo bloquea, avisa a la barra. */
export async function playRemoteAudio(element: HTMLAudioElement): Promise<void> {
  try {
    await element.play();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      collab().setAudioBlocked(true);
    } else if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.warn("[Andros · sala] No se pudo reproducir el audio remoto.", error);
    }
  }
}

/** «Activar sonido»: con un clic reanuda todos los <audio> y el AudioContext. */
export async function resumeCollabAudio(): Promise<void> {
  await call?.voice.resume();
  const results = await Promise.all(
    [...remoteAudioElements].map((element) =>
      element.play().then(
        () => true,
        () => false
      )
    )
  );
  collab().setAudioBlocked(results.some((ok) => !ok));
}

// ----------------------------------------------------------------------------
// Micrófono y cámara
// ----------------------------------------------------------------------------

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** El dispositivo guardado ya no existe (se desconectó): usar el predeterminado. */
function isMissingDevice(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "OverconstrainedError" || error.name === "NotFoundError")
  );
}

async function requestMicrophone(deviceId = ""): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { ...MIC_CONSTRAINTS, deviceId: { exact: deviceId } } : MIC_CONSTRAINTS,
      video: false,
    });
  } catch (error) {
    if (deviceId && isMissingDevice(error)) return requestMicrophone("");
    return null;
  }
}

async function requestCamera(deviceId = ""): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { ...CAMERA_CONSTRAINTS, deviceId: { exact: deviceId } } : CAMERA_CONSTRAINTS,
    });
  } catch (error) {
    if (deviceId && isMissingDevice(error)) return requestCamera("");
    return null;
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

/** Si el micrófono se desconecta (audífonos USB/Bluetooth), pasa al predeterminado. */
function watchMicEnded(stream: MediaStream | null): void {
  const track = stream?.getAudioTracks()[0];
  if (!track) return;
  track.onended = () => {
    if (micStream !== stream || !call) return;
    toast("Se desconectó el micrófono. Cambiando al predeterminado…");
    void swapMicrophone("");
  };
}

function applyMicEnabled(): void {
  const { muted, deafened } = collab();
  micStream?.getAudioTracks().forEach((track) => {
    track.enabled = !muted && !deafened;
  });
}

/** Cambia de micrófono EN CALIENTE: replaceTrack en todos los enlaces. */
async function swapMicrophone(deviceId: string): Promise<void> {
  if (!call || !micStream) return;
  const token = joinToken;
  const next = await requestMicrophone(deviceId);
  if (!next) {
    toast("No se pudo usar ese micrófono. Revisa que esté conectado y con permiso.", "error");
    return;
  }
  if (token !== joinToken || !call) {
    stopStream(next);
    return;
  }
  const previous = micStream;
  micStream = next;
  watchMicEnded(next);
  call.mesh.setMicStream(next);
  call.voice.watch(collab().selfPeerId, next);
  applyMicEnabled();
  stopStream(previous);
  void refreshMediaDevices();
}

/** Elige micrófono (se recuerda en este equipo) y lo cambia sin cortar la llamada. */
export async function selectMicrophone(deviceId: string): Promise<void> {
  useMediaDevicesStore.getState().setSelected("mic", deviceId);
  await swapMicrophone(deviceId);
}

/** Elige cámara y, si está encendida, la cambia sin cortar la llamada. */
export async function selectCamera(deviceId: string): Promise<void> {
  useMediaDevicesStore.getState().setSelected("camera", deviceId);
  if (!call || !cameraStream) return;
  const token = joinToken;
  const next = await requestCamera(deviceId);
  if (!next) {
    toast("No se pudo usar esa cámara. Revisa que esté conectada y con permiso.", "error");
    return;
  }
  if (token !== joinToken || !call || !cameraStream) {
    stopStream(next);
    return;
  }
  const previous = cameraStream;
  cameraStream = next;
  const track = next.getVideoTracks()[0] ?? null;
  if (track) track.onended = () => stopCollabCamera();
  call.mesh.setCameraTrack(track);
  collab().setLocalCamera(next);
  stopStream(previous);
}

/** Elige la salida de audio (audífonos/altavoces) para todo el audio remoto. */
export async function selectSpeaker(deviceId: string): Promise<void> {
  useMediaDevicesStore.getState().setSelected("speaker", deviceId);
  await Promise.all([...remoteAudioElements].map((element) => applySpeaker(element)));
}

/** Nivel actual de TU micrófono (0–1) para el medidor del popover. */
export function getMicLevel(): number {
  if (!call || !micStream) return 0;
  return call.voice.level(collab().selfPeerId);
}

export function canUseCamera(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export async function toggleCollabCamera(): Promise<void> {
  if (cameraStream) {
    stopCollabCamera();
    return;
  }
  if (!call) {
    toast("Únete a la voz para encender la cámara.");
    return;
  }
  const token = joinToken;
  const stream = await requestCamera(selectedDeviceId("camera"));
  if (!stream) {
    toast("El navegador no dio acceso a la cámara. Revisa los permisos del sitio.", "error");
    return;
  }
  if (token !== joinToken || !call || cameraStream) {
    stopStream(stream);
    return;
  }
  cameraStream = stream;
  const track = stream.getVideoTracks()[0] ?? null;
  // «Dejar de usar la cámara» desde el sistema o al desconectarla.
  if (track) track.onended = () => stopCollabCamera();
  call.mesh.setCameraTrack(track);
  collab().setLocalCamera(stream);
  collab().setMedia({ hasVideo: true });
  collab().setVideoStripOpen(true);
  void refreshMediaDevices();
  retrackPresence();
}

export function stopCollabCamera(): void {
  if (!cameraStream) return;
  stopStream(cameraStream);
  cameraStream = null;
  call?.mesh.setCameraTrack(null);
  collab().setLocalCamera(null);
  collab().setMedia({ hasVideo: false });
  retrackPresence();
}

// ----------------------------------------------------------------------------
// Capa 2: entrar / salir de la voz
// ----------------------------------------------------------------------------

/** Cierra la llamada (WebRTC, micrófono, cámara y pantalla) sin tocar el canal. */
function teardownCall(): void {
  joinToken += 1;
  const current = call;
  call = null;
  if (current) {
    if (screenStream) {
      const payload: ScreenStopPayload = { senderId: collab().selfPeerId };
      send("screen:stop", payload);
    }
    current.mesh.closeAll();
    current.voice.dispose();
  }
  stopStream(micStream);
  micStream = null;
  stopStream(cameraStream);
  cameraStream = null;
  stopStream(screenStream);
  screenStream = null;
  mutedBeforeDeafen = false;
  callJoinedAt = null;
  remoteVideos.clear();
  peerCallIds.clear();
  for (const timer of endedShareTimers.values()) clearTimeout(timer);
  endedShareTimers.clear();
}

/** Cierra TODO (llamada + canal) y vacía la sala. */
function closeEverything(): void {
  teardownCall();
  disconnectPresence();
  collab().resetRoom();
}

/**
 * «Unirse a voz»: presencia { inCall: true }, micrófono elegido y WebRTC solo
 * con quien también está en voz. Sin sesión, abre la barra en modo local.
 */
export async function joinCollabRoom(): Promise<void> {
  const state = collab();
  if (state.inCall || state.callConnecting) return;
  const token = ++joinToken;

  const supabase = getSupabaseBrowserClient();
  const cloud = useCloudStore.getState();
  state.setPanelOpen(true);

  // Sin Supabase o sin sesión: la barra sigue viva en modo local.
  if (!supabase || !cloud.user) {
    state.setRoom(null, "Modo local");
    state.setStatus("local", LOCAL_MODE_MESSAGE);
    state.setCall({ inCall: true });
    track("voice_joined", { mode: "local" });
    return;
  }

  // Enlace ANTIGUO `?sala=…`: sesión de invitado en vivo (como en Sprint 7).
  const invite = state.invite;
  if (invite) {
    state.setInvite(null);
    const ownRoom = resolveCurrentRoom();
    const label = ownRoom?.roomId === invite.roomId ? ownRoom.label : "Sala compartida";
    const manager = useWorkspaceManagerStore.getState();
    const accessible =
      Boolean(invite.workspaceId) &&
      (manager.workspaces.some((w) => w.id === invite.workspaceId) ||
        manager.sharedWorkspaces.some((w) => w.id === invite.workspaceId));
    if (invite.workspaceId && accessible) {
      // Eres dueño o miembro: se abre de verdad (la presencia cambia sola).
      if (cloud.workspaceId !== invite.workspaceId) await openCloudWorkspace(invite.workspaceId);
    } else {
      if (invite.workspaceId) {
        // Espacio de otra cuenta: lo verás en vivo sin guardarlo en tu nube.
        await suspendCloudForCollabGuest();
        collab().setGuest({
          workspaceId: invite.workspaceId,
          workspaceName: "Espacio compartido",
          hostName: "tu anfitrión",
        });
      }
      connectPresence({ roomId: invite.roomId, label });
    }
    if (token !== joinToken) return;
  }

  if (!session) connectPresence();
  if (!session) {
    collab().setStatus("error", "Tu espacio aún se está cargando. Inténtalo en unos segundos.");
    return;
  }

  // Topes: en modo lectura no se abre WebRTC; con 5 en voz no se entra.
  const capacityState = collab();
  if (capacityState.capacity.readOnly) {
    toast(`Sala completa (${MAX_SPACE_PARTICIPANTS}/${MAX_SPACE_PARTICIPANTS}): la voz se habilita cuando se libere un lugar.`, "error");
    return;
  }
  const voiceTaken = Object.values(capacityState.peers).filter((peer) => peer.inCall).length;
  if (voiceTaken >= MAX_VOICE_PARTICIPANTS) {
    toast(`Canal de voz lleno (${MAX_VOICE_PARTICIPANTS}/${MAX_VOICE_PARTICIPANTS}). Sigues en el espacio con el lienzo en vivo.`, "error");
    return;
  }

  collab().setCall({ callConnecting: true });

  // Micrófono elegido (si se niega, entras igual para escuchar).
  const mic = await requestMicrophone(selectedDeviceId("mic"));
  if (token !== joinToken || !session) {
    stopStream(mic);
    if (token === joinToken) collab().setCall({ callConnecting: false });
    return;
  }
  micStream = mic;
  watchMicEnded(mic);
  collab().setMedia({ hasMic: Boolean(mic), muted: !mic, deafened: false, hasVideo: false });
  if (mic) void refreshMediaDevices();
  else toast("Sin acceso al micrófono: entraste a la voz solo para escuchar.");

  const selfId = collab().selfPeerId;
  const voice = new VoiceActivityMonitor((id, speaking) => collab().setSpeaking(id, speaking));
  if (mic) voice.watch(selfId, mic);

  const mesh = new PeerMesh({
    selfId,
    sendSignal: (payload) => send("rtc:signal", payload),
    onRemoteAudio: (peerId, stream) => {
      collab().setRemoteAudio(peerId, stream);
      if (stream) call?.voice.watch(peerId, stream);
      else call?.voice.unwatch(peerId);
    },
    onRemoteVideo: handleRemoteVideo,
    onLinkState: (peerId, linkState) => collab().setLinkState(peerId, linkState),
    // Solo se acepta una oferta de quien sigue dentro de la voz (o aún no aparece en Presence).
    acceptPeer: (peerId) => {
      const peer = collab().peers[peerId];
      return !peer || peer.inCall;
    },
  });
  mesh.setMicStream(mic);
  if (screenStream) mesh.setScreenStream(screenStream);

  call = { mesh, voice, callId: randomId() };
  callJoinedAt = Date.now();
  collab().setCall({ inCall: true, callConnecting: false });
  track("voice_joined", { mode: "cloud" });

  // Primero se anuncia { inCall: true } (con acuse del servidor) y DESPUÉS se
  // conecta: así los demás ya te ven en voz cuando llega tu oferta WebRTC.
  const current = session;
  if (current.subscribed) await current.channel.track(presencePayload()).catch(() => undefined);
  if (token !== joinToken || !call) return;
  handlePresenceSync();
}

/**
 * «Salir de voz»: cierra los RTCPeerConnection y apaga micrófono, cámara y
 * pantalla, pero SIGUES en el espacio viendo quién queda en el canal.
 */
export async function leaveCollabRoom(): Promise<void> {
  const state = collab();
  const wasGuest = Boolean(state.guest);
  const wasLocal = state.status === "local";
  teardownCall();
  collab().resetCall();

  if (wasLocal) {
    collab().resetRoom();
    return;
  }
  if (wasGuest) {
    // Fin de la visita (enlace antiguo): vuelves a tu propio espacio.
    disconnectPresence();
    collab().resetRoom();
    await resumeCloudAfterCollabGuest();
    ensurePresence();
    return;
  }
  retrackPresence();
}

// ----------------------------------------------------------------------------
// Controles tipo Discord
// ----------------------------------------------------------------------------

export async function toggleCollabMute(): Promise<void> {
  const state = collab();
  if (state.status === "local") return;
  // Sin micrófono todavía: se vuelve a pedir permiso.
  if (!micStream) {
    const mic = await requestMicrophone(selectedDeviceId("mic"));
    if (!mic) {
      toast("El navegador no dio acceso al micrófono. Revisa los permisos del sitio.", "error");
      return;
    }
    if (!call) {
      stopStream(mic);
      return;
    }
    micStream = mic;
    watchMicEnded(mic);
    call.mesh.setMicStream(mic);
    call.voice.watch(state.selfPeerId, mic);
    collab().setMedia({ hasMic: true, muted: false, deafened: false });
    applyMicEnabled();
    retrackPresence();
    void refreshMediaDevices();
    return;
  }
  const muted = !state.muted;
  collab().setMedia(state.deafened && !muted ? { muted, deafened: false } : { muted });
  applyMicEnabled();
  retrackPresence();
}

export function toggleCollabDeafen(): void {
  const state = collab();
  if (state.status === "local") return;
  if (!state.deafened) {
    mutedBeforeDeafen = state.muted;
    collab().setMedia({ deafened: true, muted: true });
  } else {
    collab().setMedia({ deafened: false, muted: state.hasMic ? mutedBeforeDeafen : true });
  }
  applyMicEnabled();
  retrackPresence();
}

export function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export async function startCollabScreenShare(): Promise<void> {
  if (screenStream) return;
  if (!canShareScreen()) {
    toast("Este navegador no permite compartir pantalla (prueba en una computadora).", "error");
    return;
  }
  const token = joinToken;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN_CONSTRAINTS, audio: false });
  } catch (error) {
    // Cancelar el selector del navegador no es un error.
    if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
      toast("No se pudo compartir la pantalla.", "error");
    }
    return;
  }
  if (token !== joinToken || !collab().inCall) {
    stopStream(stream);
    return;
  }
  screenStream = stream;
  const track = stream.getVideoTracks()[0];
  // Algunos navegadores ignoran los topes en getDisplayMedia: se reaplican.
  void track?.applyConstraints(SCREEN_CONSTRAINTS).catch(() => undefined);
  // «Dejar de compartir» desde la barra del propio navegador.
  if (track) track.onended = () => stopCollabScreenShare();

  const state = collab();
  const id = screenShareIdFor(state.selfPeerId);
  cancelEndedRemoval(id);
  state.upsertScreenShare(
    {
      id,
      type: "screen-share-node",
      peerId: state.selfPeerId,
      presenterName: `${selfDisplayName()} (tú)`,
      presenterColor: state.selfColor,
      isLocal: true,
      status: "live",
      position: viewportSlot(state.screenShares.length),
      size: SCREEN_NODE_DEFAULT_SIZE,
      startedAt: Date.now(),
    },
    stream
  );
  collab().setMedia({ sharing: true });
  call?.mesh.setScreenStream(stream);
  retrackPresence();
}

export function stopCollabScreenShare(): void {
  if (!screenStream) return;
  stopStream(screenStream);
  screenStream = null;
  const state = collab();
  call?.mesh.setScreenStream(null);
  state.removeScreenShare(screenShareIdFor(state.selfPeerId));
  state.setMedia({ sharing: false });
  const payload: ScreenStopPayload = { senderId: state.selfPeerId };
  send("screen:stop", payload);
  retrackPresence();
}

/**
 * Copia el enlace ÚNICO del espacio (`?espacio=<id>`). Abre el espacio y su
 * canal de voz a quien sea miembro; no hay enlace de llamada aparte.
 */
export async function copyWorkspaceLink(workspaceId?: string | null): Promise<void> {
  const id = workspaceId ?? liveWorkspaceId();
  if (!id) {
    toast("Inicia sesión y abre un espacio en la nube para compartirlo.", "error");
    return;
  }
  const ok = await copyText(buildWorkspaceLink(id));
  toast(
    ok
      ? "Enlace del espacio copiado. Solo lo abren las personas que añadas como miembros."
      : "No se pudo copiar el enlace.",
    ok ? "success" : "error"
  );
}

/** Envía tu cursor (coordenadas del lienzo) a ~14 fps, siempre con la última posición. */
export function sendCollabCursor(x: number, y: number): void {
  if (!session?.subscribed || !hasPeers() || collab().capacity.readOnly) return;
  pendingCursor = { x: Math.round(x), y: Math.round(y) };
  if (cursorTimer) return;
  const flush = () => {
    cursorTimer = null;
    if (!pendingCursor) return;
    const payload: CursorPayload = {
      senderId: collab().selfPeerId,
      workspaceId: liveWorkspaceId(),
      ...pendingCursor,
    };
    pendingCursor = null;
    lastCursorAt = Date.now();
    send("cursor", payload);
  };
  const elapsed = Date.now() - lastCursorAt;
  if (elapsed >= CURSOR_SEND_INTERVAL_MS) flush();
  else cursorTimer = setTimeout(flush, CURSOR_SEND_INTERVAL_MS - elapsed);
}

// ----------------------------------------------------------------------------
// Hook (montar una sola vez en page.tsx)
// ----------------------------------------------------------------------------

export function useCollabRoom(): void {
  useEffect(() => {
    const { legacy, workspaceId: linkedWorkspaceId } = consumeInviteFromUrl();
    if (legacy) collab().setInvite(legacy);
    // Enlace único `?espacio=<id>`: se abre el espacio (si eres miembro).
    if (linkedWorkspaceId) openWorkspaceFromLink(linkedWorkspaceId);

    // Presencia pasiva: sigue al espacio abierto (sin micrófono ni WebRTC).
    const unsubscribeCloud = useCloudStore.subscribe((state, prev) => {
      if (state.user?.id !== prev.user?.id) {
        if (!state.user) {
          closeEverything();
          return;
        }
        // Iniciaste sesión estando en modo local: ya puedes entrar de verdad.
        if (collab().status === "local") {
          closeEverything();
          toast("Sesión iniciada: ya puedes unirte a la voz del espacio.", "success");
        }
        if (state.workspaceId) ensurePresence();
        return;
      }
      if (state.workspaceId !== prev.workspaceId && state.workspaceId) ensurePresence();
    });

    // Renombrar o mover el espacio a otra carpeta cambia la sala o el nombre.
    const unsubscribeManager = useWorkspaceManagerStore.subscribe((state, prev) => {
      if (state.workspaces === prev.workspaces && state.sharedWorkspaces === prev.sharedWorkspaces) return;
      if (!session || collab().guest) return;
      const next = resolveCurrentRoom();
      if (next && next.roomId !== session.roomId) ensurePresence();
      else retrackPresence();
    });

    // «Editando: Nombre»: se anuncia al empezar o dejar de escribir en una tarjeta.
    const unsubscribeEditing = useCollabStore.subscribe((state, prev) => {
      if (state.editingNodeId === prev.editingNodeId) return;
      if (editingRetrackTimer) clearTimeout(editingRetrackTimer);
      editingRetrackTimer = setTimeout(() => {
        editingRetrackTimer = null;
        retrackPresence();
      }, EDITING_PRESENCE_DELAY_MS);
    });

    ensurePresence();

    const handlePageHide = () => closeEverything();
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      unsubscribeCloud();
      unsubscribeManager();
      unsubscribeEditing();
      window.removeEventListener("pagehide", handlePageHide);
      closeEverything();
    };
  }, []);
}
