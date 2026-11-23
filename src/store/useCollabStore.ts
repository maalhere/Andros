import { create } from "zustand";
import type {
  CollabCursor,
  CollabGuestSession,
  CollabInvite,
  CollabPresence,
  CollabRoomStatus,
  ScreenShareNodeData,
} from "@/types/collab";

// ============================================================================
// ANDROS — ESTADO DE LA SALA EN VIVO (voz, presencia, cursores, pantallas)
// Lo escribe `useCollabRoom` (src/lib/collab); lo leen VoiceRoomBar,
// CollabVideoStrip, CollabCursorsLayer y ScreenShareNode. Nada de aquí se
// guarda en la nube.
//   · `status`  → presencia PASIVA del espacio (canal de Realtime).
//   · `inCall`  → estás DENTRO del canal de voz (micrófono + WebRTC).
// ============================================================================

/** Colores de participante: todos ≥ 4.5:1 con texto blanco (etiquetas del cursor). */
export const COLLAB_COLORS = [
  "#B04A2D",
  "#2563EB",
  "#047857",
  "#7C3AED",
  "#B45309",
  "#BE185D",
] as const;

/** Color estable para un id (el mismo participante siempre igual). */
export function colorForPeer(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length];
}

function createPeerId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `peer-${Date.now().toString(36)}-${random}`;
}

/** Tamaño inicial del nodo de pantalla compartida (16:9 + cabecera). */
export const SCREEN_NODE_DEFAULT_SIZE = { width: 480, height: 310 };
export const SCREEN_NODE_MIN_SIZE = { width: 280, height: 190 };

interface CollabState {
  status: CollabRoomStatus;
  errorMessage: string | null;
  roomId: string | null;
  /** Nombre legible de la sala (carpeta o espacio). */
  roomLabel: string;
  /** Id de ESTA pestaña: es el `senderId` de todos los eventos. */
  selfPeerId: string;
  selfColor: string;

  /** Dentro del canal de voz (WebRTC activo con quien también está dentro). */
  inCall: boolean;
  /** Pidiendo el micrófono / entrando a la voz. */
  callConnecting: boolean;

  muted: boolean;
  deafened: boolean;
  hasMic: boolean;
  sharing: boolean;
  /** Tu cámara está encendida. */
  hasVideo: boolean;
  /** Vista previa de tu propia cámara. */
  localCamera: MediaStream | null;
  /** Cámara de cada participante (separada de su pantalla compartida). */
  remoteCameras: Record<string, MediaStream>;
  /** Tira de vídeo desplegada (se puede plegar sin apagar cámaras). */
  videoStripOpen: boolean;

  /** Participantes del espacio, dentro o fuera de la voz (sin incluirte). */
  peers: Record<string, CollabPresence>;
  /** Quién está hablando ahora (incluye tu propio id). */
  speaking: Record<string, boolean>;
  cursors: Record<string, CollabCursor>;
  /** Audio remoto por participante (se reproduce en VoiceRoomBar). */
  remoteAudio: Record<string, MediaStream>;
  /** Estado real del enlace WebRTC de audio con cada participante. */
  linkStates: Record<string, "connecting" | "connected" | "failed">;
  /** El navegador bloqueó la reproducción automática del audio remoto. */
  audioBlocked: boolean;

  /** Nodos efímeros de pantalla compartida (no se guardan en la nube). */
  screenShares: ScreenShareNodeData[];
  /** Flujo de vídeo de cada nodo de pantalla (id del nodo → stream). */
  screenStreams: Record<string, MediaStream>;

  invite: CollabInvite | null;
  guest: CollabGuestSession | null;
  /** Barra de la sala desplegada (se puede plegar sin salir de la llamada). */
  panelOpen: boolean;

  setStatus: (status: CollabRoomStatus, errorMessage?: string | null) => void;
  setRoom: (roomId: string | null, roomLabel: string) => void;
  setMedia: (
    patch: Partial<Pick<CollabState, "muted" | "deafened" | "hasMic" | "sharing" | "hasVideo">>
  ) => void;
  setCall: (patch: Partial<Pick<CollabState, "inCall" | "callConnecting">>) => void;
  setLocalCamera: (stream: MediaStream | null) => void;
  setRemoteCamera: (peerId: string, stream: MediaStream | null) => void;
  setVideoStripOpen: (open: boolean) => void;
  setPeers: (peers: Record<string, CollabPresence>) => void;
  setSpeaking: (peerId: string, speaking: boolean) => void;
  setCursor: (cursor: CollabCursor) => void;
  removeCursor: (peerId: string) => void;
  setRemoteAudio: (peerId: string, stream: MediaStream | null) => void;
  setLinkState: (peerId: string, state: "connecting" | "connected" | "failed" | null) => void;
  setAudioBlocked: (blocked: boolean) => void;

  upsertScreenShare: (share: ScreenShareNodeData, stream?: MediaStream | null) => void;
  setScreenStream: (shareId: string, stream: MediaStream | null) => void;
  patchScreenShare: (
    shareId: string,
    patch: Partial<Pick<ScreenShareNodeData, "status" | "position" | "size" | "presenterName">>
  ) => void;
  removeScreenShare: (shareId: string) => void;

  setInvite: (invite: CollabInvite | null) => void;
  setGuest: (guest: CollabGuestSession | null) => void;
  setPanelOpen: (open: boolean) => void;
  /** Vacía todo lo de la LLAMADA (sigues en el espacio con presencia pasiva). */
  resetCall: () => void;
  /** Vacía todo lo de la sala (al cerrar sesión, cambiar de sala o desmontar). */
  resetRoom: () => void;
}

const initialPeerId = createPeerId();

export const useCollabStore = create<CollabState>((set) => ({
  status: "idle",
  errorMessage: null,
  roomId: null,
  roomLabel: "",
  selfPeerId: initialPeerId,
  selfColor: colorForPeer(initialPeerId),

  inCall: false,
  callConnecting: false,

  muted: false,
  deafened: false,
  hasMic: false,
  sharing: false,
  hasVideo: false,
  localCamera: null,
  remoteCameras: {},
  videoStripOpen: true,

  peers: {},
  speaking: {},
  cursors: {},
  remoteAudio: {},
  linkStates: {},
  audioBlocked: false,

  screenShares: [],
  screenStreams: {},

  invite: null,
  guest: null,
  panelOpen: true,

  setStatus: (status, errorMessage) =>
    set((state) => ({
      status,
      errorMessage: errorMessage === undefined ? state.errorMessage : errorMessage,
    })),
  setRoom: (roomId, roomLabel) => set({ roomId, roomLabel }),
  setMedia: (patch) => set(patch),
  setCall: (patch) => set(patch),
  setLocalCamera: (localCamera) => set({ localCamera }),
  setRemoteCamera: (peerId, stream) =>
    set((state) => {
      if ((state.remoteCameras[peerId] ?? null) === stream) return {};
      const remoteCameras = { ...state.remoteCameras };
      if (stream) remoteCameras[peerId] = stream;
      else delete remoteCameras[peerId];
      return { remoteCameras };
    }),
  setVideoStripOpen: (videoStripOpen) => set({ videoStripOpen }),
  setPeers: (peers) =>
    set((state) => {
      // Cursores y "hablando" de quien ya salió se descartan.
      const cursors: Record<string, CollabCursor> = {};
      for (const [id, cursor] of Object.entries(state.cursors)) {
        if (peers[id]) cursors[id] = cursor;
      }
      const speaking: Record<string, boolean> = {};
      for (const [id, value] of Object.entries(state.speaking)) {
        if (peers[id] || id === state.selfPeerId) speaking[id] = value;
      }
      return { peers, cursors, speaking };
    }),
  setSpeaking: (peerId, speaking) =>
    set((state) =>
      Boolean(state.speaking[peerId]) === speaking
        ? {}
        : { speaking: { ...state.speaking, [peerId]: speaking } }
    ),
  setCursor: (cursor) => set((state) => ({ cursors: { ...state.cursors, [cursor.peerId]: cursor } })),
  removeCursor: (peerId) =>
    set((state) => {
      if (!state.cursors[peerId]) return {};
      const cursors = { ...state.cursors };
      delete cursors[peerId];
      return { cursors };
    }),
  setRemoteAudio: (peerId, stream) =>
    set((state) => {
      const remoteAudio = { ...state.remoteAudio };
      if (stream) remoteAudio[peerId] = stream;
      else delete remoteAudio[peerId];
      return { remoteAudio };
    }),
  setLinkState: (peerId, linkState) =>
    set((state) => {
      if ((state.linkStates[peerId] ?? null) === linkState) return {};
      const linkStates = { ...state.linkStates };
      if (linkState) linkStates[peerId] = linkState;
      else delete linkStates[peerId];
      return { linkStates };
    }),
  setAudioBlocked: (audioBlocked) => set((state) => (state.audioBlocked === audioBlocked ? {} : { audioBlocked })),

  upsertScreenShare: (share, stream) =>
    set((state) => {
      const exists = state.screenShares.some((s) => s.id === share.id);
      const screenShares = exists
        ? state.screenShares.map((s) =>
            // Si ya existe se conserva dónde lo dejó el usuario (posición y tamaño).
            s.id === share.id ? { ...share, position: s.position, size: s.size } : s
          )
        : [...state.screenShares, share];
      const screenStreams =
        stream === undefined
          ? state.screenStreams
          : stream
            ? { ...state.screenStreams, [share.id]: stream }
            : Object.fromEntries(Object.entries(state.screenStreams).filter(([id]) => id !== share.id));
      return { screenShares, screenStreams };
    }),
  setScreenStream: (shareId, stream) =>
    set((state) => {
      const screenStreams = { ...state.screenStreams };
      if (stream) screenStreams[shareId] = stream;
      else delete screenStreams[shareId];
      return { screenStreams };
    }),
  patchScreenShare: (shareId, patch) =>
    set((state) => ({
      screenShares: state.screenShares.map((s) => (s.id === shareId ? { ...s, ...patch } : s)),
    })),
  removeScreenShare: (shareId) =>
    set((state) => {
      const screenStreams = { ...state.screenStreams };
      delete screenStreams[shareId];
      return {
        screenShares: state.screenShares.filter((s) => s.id !== shareId),
        screenStreams,
      };
    }),

  setInvite: (invite) => set({ invite }),
  setGuest: (guest) => set({ guest }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  resetCall: () =>
    set({
      inCall: false,
      callConnecting: false,
      muted: false,
      deafened: false,
      hasMic: false,
      sharing: false,
      hasVideo: false,
      localCamera: null,
      remoteCameras: {},
      speaking: {},
      remoteAudio: {},
      linkStates: {},
      audioBlocked: false,
      screenShares: [],
      screenStreams: {},
    }),
  resetRoom: () =>
    set({
      status: "idle",
      errorMessage: null,
      roomId: null,
      roomLabel: "",
      inCall: false,
      callConnecting: false,
      muted: false,
      deafened: false,
      hasMic: false,
      sharing: false,
      hasVideo: false,
      localCamera: null,
      remoteCameras: {},
      peers: {},
      speaking: {},
      cursors: {},
      remoteAudio: {},
      linkStates: {},
      audioBlocked: false,
      screenShares: [],
      screenStreams: {},
      guest: null,
    }),
}));
