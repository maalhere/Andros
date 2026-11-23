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
// CollabCursorsLayer y ScreenShareNode. Nada de aquí se guarda en la nube.
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

  muted: boolean;
  deafened: boolean;
  hasMic: boolean;
  sharing: boolean;

  /** Otros participantes (sin incluirte). */
  peers: Record<string, CollabPresence>;
  /** Quién está hablando ahora (incluye tu propio id). */
  speaking: Record<string, boolean>;
  cursors: Record<string, CollabCursor>;
  /** Audio remoto por participante (se reproduce en VoiceRoomBar). */
  remoteAudio: Record<string, MediaStream>;

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
  setMedia: (patch: Partial<Pick<CollabState, "muted" | "deafened" | "hasMic" | "sharing">>) => void;
  setPeers: (peers: Record<string, CollabPresence>) => void;
  setSpeaking: (peerId: string, speaking: boolean) => void;
  setCursor: (cursor: CollabCursor) => void;
  removeCursor: (peerId: string) => void;
  setRemoteAudio: (peerId: string, stream: MediaStream | null) => void;

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
  /** Vacía todo lo de la sala (al salir o al desmontar). */
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

  muted: false,
  deafened: false,
  hasMic: false,
  sharing: false,

  peers: {},
  speaking: {},
  cursors: {},
  remoteAudio: {},

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
  resetRoom: () =>
    set({
      status: "idle",
      errorMessage: null,
      roomId: null,
      roomLabel: "",
      muted: false,
      deafened: false,
      hasMic: false,
      sharing: false,
      peers: {},
      speaking: {},
      cursors: {},
      remoteAudio: {},
      screenShares: [],
      screenStreams: {},
      guest: null,
    }),
}));
