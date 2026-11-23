"use client";

// ============================================================================
// ANDROS — SALA EN VIVO (SPRINT 7): voz, presencia, cursores, pantalla
// compartida y edición simultánea del lienzo, con $0 de infraestructura:
//   · Supabase Realtime Presence  → quién está en la sala y qué espacio ve.
//   · Supabase Realtime Broadcast → cursores, cambios del lienzo y señales.
//   · WebRTC nativo (malla 2–6)   → audio y pantalla, con STUN público.
//
// `useCollabRoom()` se monta UNA vez (page.tsx). Las acciones (`joinCollabRoom`,
// `leaveCollabRoom`, …) se pueden llamar desde cualquier componente.
// Al salir o desmontar se cierran TODAS las conexiones, se detienen TODOS los
// micrófonos/pantallas y se abandona el canal: nada queda encendido.
// ============================================================================

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
  useCollabStore,
} from "@/store/useCollabStore";
import {
  openCloudWorkspace,
  resumeCloudAfterCollabGuest,
  suspendCloudForCollabGuest,
} from "@/hooks/useCloudSync";
import type {
  CanvasRequestPayload,
  CanvasSnapshotPayload,
  CollabPresence,
  CursorPayload,
  EdgeDeletePayload,
  EdgeUpsertPayload,
  NodeDeletePayload,
  NodeUpsertPayload,
  RtcSignalPayload,
  ScreenShareNodeData,
  ScreenStopPayload,
} from "@/types/collab";
import { PeerMesh } from "./peerMesh";
import { VoiceActivityMonitor } from "./voiceActivity";
import {
  SnapshotAssembler,
  applyRemoteEdgeDelete,
  applyRemoteEdgeUpsert,
  applyRemoteNodeDelete,
  applyRemoteNodeUpsert,
  buildSnapshotParts,
  startCanvasSync,
} from "./canvasSync";
import {
  buildInviteLink,
  channelNameFor,
  consumeInviteFromUrl,
  copyText,
  resolveCurrentRoom,
} from "./room";

/** ~16 fps para los cursores. */
export const CURSOR_SEND_INTERVAL_MS = 60;
/** Un cursor sin moverse durante este tiempo se oculta. */
const CURSOR_STALE_MS = 6000;
/** Un nodo de pantalla finalizado se retira solo tras este tiempo. */
const ENDED_SHARE_REMOVE_MS = 8000;
const SNAPSHOT_RETRY_MS = 3000;
const SNAPSHOT_MAX_ATTEMPTS = 5;
/** Pausa entre partes del lienzo (respeta el límite de mensajes de Realtime). */
const SNAPSHOT_PART_GAP_MS = 60;

export const LOCAL_MODE_MESSAGE = "Modo local — inicia sesión para colaborar en vivo";

const toast = (message: string, tone: "neutral" | "success" | "error" = "neutral") =>
  useToastStore.getState().show({ message, tone });

const collab = useCollabStore.getState;

// ----------------------------------------------------------------------------
// Estado privado de la sesión (fuera de React para que la limpieza sea total)
// ----------------------------------------------------------------------------

interface RoomSession {
  supabase: SupabaseClient;
  channel: RealtimeChannel;
  mesh: PeerMesh;
  voice: VoiceActivityMonitor;
  assembler: SnapshotAssembler;
  stopCanvasSync: (() => void) | null;
  subscribed: boolean;
  snapshotReceived: boolean;
  snapshotTimer: ReturnType<typeof setTimeout> | null;
  cursorPruneTimer: ReturnType<typeof setInterval> | null;
}

let session: RoomSession | null = null;
let micStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
/** Cambia con cada entrada/salida: invalida operaciones asíncronas viejas. */
let joinToken = 0;
let mutedBeforeDeafen = false;
const endedShareTimers = new Map<string, ReturnType<typeof setTimeout>>();

let cursorTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCursor: { x: number; y: number } | null = null;
let lastCursorAt = 0;

const screenShareIdFor = (peerId: string) => `screen-${peerId}`;

/** Espacio que se edita en vivo: el del anfitrión si eres invitado, si no el tuyo. */
export function liveWorkspaceId(): string | null {
  return collab().guest?.workspaceId ?? useCloudStore.getState().workspaceId;
}

function currentWorkspaceName(): string {
  const guest = collab().guest;
  if (guest) return guest.workspaceName;
  const id = useCloudStore.getState().workspaceId;
  return useWorkspaceManagerStore.getState().workspaces.find((w) => w.id === id)?.name ?? "Espacio actual";
}

function selfDisplayName(): string {
  const user = useCloudStore.getState().user;
  return user?.name?.trim() || "Participante";
}

function presencePayload(): CollabPresence {
  const state = collab();
  const user = useCloudStore.getState().user;
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
    joinedAt: Date.now(),
  };
}

function send(event: string, payload: object): void {
  if (!session?.subscribed) return;
  void session.channel.send({ type: "broadcast", event, payload }).catch(() => undefined);
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
// Presencia
// ----------------------------------------------------------------------------

function sanitizePresence(raw: unknown, key: string): CollabPresence | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<CollabPresence>;
  const text = (v: unknown, fallback: string, max = 80) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
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
  };
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

  const previous = collab().peers;
  collab().setPeers(peers);

  for (const id of Object.keys(previous)) {
    if (!peers[id]) {
      session.mesh.removePeer(id);
      session.voice.unwatch(id);
    }
  }
  for (const id of Object.keys(peers)) session.mesh.ensurePeer(id);

  // Pantallas: la presencia es la fuente de verdad de quién comparte.
  for (const peer of Object.values(peers)) {
    if (peer.sharing) ensureRemoteShare(peer);
  }
  for (const share of collab().screenShares) {
    if (!share.isLocal && !peers[share.peerId]?.sharing) endRemoteShare(share.id);
  }

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
// Lienzo completo para invitados
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
  const token = joinToken;
  const parts = buildSnapshotParts(
    collab().selfPeerId,
    payload.senderId,
    cloud.workspaceId,
    currentWorkspaceName()
  );
  for (const part of parts) {
    if (token !== joinToken) return;
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
// Entrar / salir
// ----------------------------------------------------------------------------

async function requestMicrophone(): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch {
    return null;
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

/** Entra a la sala del espacio actual (o a la del enlace de invitación). */
export async function joinCollabRoom(): Promise<void> {
  const state = collab();
  if (state.status === "connecting" || state.status === "connected" || state.status === "local") return;
  const token = ++joinToken;

  const supabase = getSupabaseBrowserClient();
  const cloud = useCloudStore.getState();
  state.setPanelOpen(true);

  // Sin Supabase o sin sesión: la barra sigue viva en modo local.
  if (!supabase || !cloud.user) {
    state.setRoom(null, "Modo local");
    state.setStatus("local", LOCAL_MODE_MESSAGE);
    return;
  }

  const invite = state.invite;
  const ownRoom = resolveCurrentRoom();
  let roomId: string;
  let label: string;

  if (invite) {
    state.setInvite(null);
    roomId = invite.roomId;
    label = ownRoom?.roomId === invite.roomId ? ownRoom.label : "Sala compartida";
    if (invite.workspaceId) {
      const isOwn = useWorkspaceManagerStore
        .getState()
        .workspaces.some((w) => w.id === invite.workspaceId);
      if (isOwn) {
        if (cloud.workspaceId !== invite.workspaceId) await openCloudWorkspace(invite.workspaceId);
      } else {
        // Espacio de otra cuenta: lo verás en vivo sin guardarlo en tu nube.
        await suspendCloudForCollabGuest();
        collab().setGuest({
          workspaceId: invite.workspaceId,
          workspaceName: "Espacio compartido",
          hostName: "tu anfitrión",
        });
      }
    }
  } else if (ownRoom) {
    roomId = ownRoom.roomId;
    label = ownRoom.label;
  } else {
    state.setStatus("error", "Tu espacio aún se está cargando. Inténtalo en unos segundos.");
    return;
  }
  if (token !== joinToken) return;

  collab().setRoom(roomId, label);
  collab().setStatus("connecting", null);

  // Micrófono (si se niega, entras igual para escuchar).
  const mic = await requestMicrophone();
  if (token !== joinToken) {
    stopStream(mic);
    return;
  }
  micStream = mic;
  collab().setMedia({ hasMic: Boolean(mic), muted: !mic, deafened: false });
  if (!mic) toast("Sin acceso al micrófono: entraste a la sala solo para escuchar.");

  const selfId = collab().selfPeerId;
  const voice = new VoiceActivityMonitor((id, speaking) => collab().setSpeaking(id, speaking));
  if (mic) voice.watch(selfId, mic);

  const mesh = new PeerMesh({
    selfId,
    sendSignal: (payload) => send("rtc:signal", payload),
    onRemoteAudio: (peerId, stream) => {
      collab().setRemoteAudio(peerId, stream);
      if (stream) session?.voice.watch(peerId, stream);
      else session?.voice.unwatch(peerId);
    },
    onRemoteScreen: handleRemoteScreen,
  });
  mesh.setMicStream(mic);
  if (screenStream) mesh.setScreenStream(screenStream);

  const channel = supabase.channel(channelNameFor(roomId), {
    config: { broadcast: { self: false, ack: false }, presence: { key: selfId } },
  });

  session = {
    supabase,
    channel,
    mesh,
    voice,
    assembler: new SnapshotAssembler(),
    stopCanvasSync: null,
    subscribed: false,
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
      void session?.mesh.handleSignal(payload as RtcSignalPayload);
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
      if (token !== joinToken || !session) return;
      if (status === "SUBSCRIBED") {
        session.subscribed = true;
        collab().setStatus("connected", null);
        retrackPresence();
        if (!session.stopCanvasSync) {
          session.stopCanvasSync = startCanvasSync({
            selfId,
            getUserId: selfUserId,
            getWorkspaceId: liveWorkspaceId,
            send,
          });
        }
        if (collab().guest && !session.snapshotReceived && !session.snapshotTimer) requestSnapshot(0);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        session.subscribed = false;
        collab().setStatus(
          "error",
          "Se perdió la conexión con la sala. Reintentando… (revisa que Realtime esté activo en Supabase)."
        );
      }
    });
}

/** Sale de la llamada y limpia TODO: conexiones, micrófono, pantalla y canal. */
export async function leaveCollabRoom(): Promise<void> {
  joinToken += 1;
  const wasGuest = Boolean(collab().guest);
  const current = session;
  session = null;

  if (cursorTimer) clearTimeout(cursorTimer);
  cursorTimer = null;
  pendingCursor = null;
  for (const timer of endedShareTimers.values()) clearTimeout(timer);
  endedShareTimers.clear();

  if (current) {
    current.stopCanvasSync?.();
    if (current.snapshotTimer) clearTimeout(current.snapshotTimer);
    if (current.cursorPruneTimer) clearInterval(current.cursorPruneTimer);
    if (current.subscribed && screenStream) {
      const payload: ScreenStopPayload = { senderId: collab().selfPeerId };
      void current.channel.send({ type: "broadcast", event: "screen:stop", payload }).catch(() => undefined);
    }
    current.mesh.closeAll();
    current.voice.dispose();
    current.assembler.clear();
    void current.channel.untrack().catch(() => undefined);
    void current.supabase.removeChannel(current.channel).catch(() => undefined);
  }

  stopStream(micStream);
  micStream = null;
  stopStream(screenStream);
  screenStream = null;
  mutedBeforeDeafen = false;

  collab().resetRoom();
  if (wasGuest) await resumeCloudAfterCollabGuest();
}

// ----------------------------------------------------------------------------
// Controles tipo Discord
// ----------------------------------------------------------------------------

function applyMicEnabled(): void {
  const { muted, deafened } = collab();
  micStream?.getAudioTracks().forEach((track) => {
    track.enabled = !muted && !deafened;
  });
}

export async function toggleCollabMute(): Promise<void> {
  const state = collab();
  if (state.status === "local") return;
  // Sin micrófono todavía: se vuelve a pedir permiso.
  if (!micStream) {
    const mic = await requestMicrophone();
    if (!mic) {
      toast("El navegador no dio acceso al micrófono. Revisa los permisos del sitio.", "error");
      return;
    }
    if (!session) {
      stopStream(mic);
      return;
    }
    micStream = mic;
    session.mesh.setMicStream(mic);
    session.voice.watch(state.selfPeerId, mic);
    collab().setMedia({ hasMic: true, muted: false, deafened: false });
    applyMicEnabled();
    retrackPresence();
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
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (error) {
    // Cancelar el selector del navegador no es un error.
    if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
      toast("No se pudo compartir la pantalla.", "error");
    }
    return;
  }
  if (token !== joinToken || collab().status === "idle") {
    stopStream(stream);
    return;
  }
  screenStream = stream;
  const track = stream.getVideoTracks()[0];
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
  session?.mesh.setScreenStream(stream);
  retrackPresence();
}

export function stopCollabScreenShare(): void {
  if (!screenStream) return;
  stopStream(screenStream);
  screenStream = null;
  const state = collab();
  session?.mesh.setScreenStream(null);
  state.removeScreenShare(screenShareIdFor(state.selfPeerId));
  state.setMedia({ sharing: false });
  const payload: ScreenStopPayload = { senderId: state.selfPeerId };
  send("screen:stop", payload);
  retrackPresence();
}

/** Copia el enlace de invitación a la sala y al espacio actual. */
export async function copyCollabInviteLink(): Promise<void> {
  const guest = collab().guest;
  const roomId = collab().roomId ?? resolveCurrentRoom()?.roomId ?? null;
  const workspaceId = guest?.workspaceId ?? useCloudStore.getState().workspaceId;
  if (!roomId || !workspaceId) {
    toast("Inicia sesión y abre un espacio en la nube para invitar a alguien.", "error");
    return;
  }
  const ok = await copyText(buildInviteLink(roomId, workspaceId));
  toast(
    ok ? "Enlace de invitación copiado. Quien lo abra podrá unirse a la sala." : "No se pudo copiar el enlace.",
    ok ? "success" : "error"
  );
}

/** Envía tu cursor (coordenadas del lienzo) a ~16 fps, siempre con la última posición. */
export function sendCollabCursor(x: number, y: number): void {
  if (!session?.subscribed) return;
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
    const invite = consumeInviteFromUrl();
    if (invite) collab().setInvite(invite);

    // Si cambias de espacio estando en la sala: misma carpeta → solo se
    // actualiza tu presencia; otra carpeta/espacio → se cambia de sala.
    const unsubscribeCloud = useCloudStore.subscribe((state, prev) => {
      if (state.user?.id !== prev.user?.id) {
        const status = collab().status;
        if (!state.user && status !== "idle") {
          void leaveCollabRoom();
          return;
        }
        // Iniciaste sesión estando en modo local: ya puedes entrar de verdad.
        if (state.user && status === "local") {
          void leaveCollabRoom().then(() =>
            toast("Sesión iniciada: pulsa «Sala» para colaborar en vivo.", "success")
          );
          return;
        }
      }
      if (state.workspaceId === prev.workspaceId || !state.workspaceId) return;
      const room = collab();
      if (room.status !== "connected" || room.guest) return;
      const next = resolveCurrentRoom();
      if (next && next.roomId !== room.roomId) {
        void leaveCollabRoom().then(() => joinCollabRoom());
      } else {
        retrackPresence();
      }
    });

    const handlePageHide = () => {
      if (collab().status !== "idle") void leaveCollabRoom();
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      unsubscribeCloud();
      window.removeEventListener("pagehide", handlePageHide);
      if (collab().status !== "idle" || screenStream || micStream) void leaveCollabRoom();
    };
  }, []);
}
