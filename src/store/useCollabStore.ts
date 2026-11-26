import { create } from "zustand";
import type {
  CollabCapacity,
  CollabCursor,
  CollabGuestSession,
  CollabInvite,
  CollabPresence,
  CollabRoomStatus,
  LinkState,
  RemoteEditor,
  ScreenShareNodeData,
} from "@/types/collab";
import { MAX_SPACE_PARTICIPANTS } from "@/types/collab";
import { canEditCanvas, type WorkspaceRole } from "@/lib/access/permissions";
import { currentWorkspaceRole, useWorkspaceRole } from "@/lib/access/workspaceRole";

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
  linkStates: Record<string, LinkState>;
  /** El navegador bloqueó la reproducción automática del audio remoto. */
  audioBlocked: boolean;

  /** Nodos efímeros de pantalla compartida (no se guardan en la nube). */
  screenShares: ScreenShareNodeData[];
  /** Flujo de vídeo de cada nodo de pantalla (id del nodo → stream). */
  screenStreams: Record<string, MediaStream>;

  invite: CollabInvite | null;
  guest: CollabGuestSession | null;
  /** Tu lugar en el espacio (tope de 6) y en la voz (tope de 5). */
  capacity: CollabCapacity;
  /** Tarjeta que TÚ estás escribiendo (se anuncia en Presence). */
  editingNodeId: string | null;
  /** Quién está escribiendo en cada tarjeta de tu espacio (id del nodo → persona). */
  remoteEditors: Record<string, RemoteEditor>;
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
  setLinkState: (peerId: string, state: LinkState | null) => void;
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
  setCapacity: (capacity: CollabCapacity) => void;
  /** Empieza (`nodeId`) o termina (`null`) de escribir en una tarjeta. */
  setEditingNodeId: (nodeId: string | null) => void;
  /** Termina de escribir en `nodeId` solo si sigue siendo la tarjeta activa. */
  clearEditingNodeId: (nodeId: string) => void;
  setRemoteEditors: (editors: Record<string, RemoteEditor>) => void;
  /** Vacía todo lo de la LLAMADA (sigues en el espacio con presencia pasiva). */
  resetCall: () => void;
  /** Vacía todo lo de la sala (al cerrar sesión, cambiar de sala o desmontar). */
  resetRoom: () => void;
}

const EMPTY_CAPACITY: CollabCapacity = { spaceCount: 0, voiceCount: 0, readOnly: false, limit: MAX_SPACE_PARTICIPANTS };

function sameEditors(a: Record<string, RemoteEditor>, b: Record<string, RemoteEditor>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => b[k] && b[k].peerId === a[k].peerId && b[k].name === a[k].name && b[k].color === a[k].color);
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
  capacity: EMPTY_CAPACITY,
  editingNodeId: null,
  remoteEditors: {},

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
      if ((state.remoteAudio[peerId] ?? null) === stream) return {};
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
  setCapacity: (capacity) =>
    set((state) =>
      state.capacity.spaceCount === capacity.spaceCount &&
      state.capacity.voiceCount === capacity.voiceCount &&
      state.capacity.readOnly === capacity.readOnly &&
      state.capacity.limit === capacity.limit
        ? {}
        : { capacity }
    ),
  setEditingNodeId: (editingNodeId) =>
    set((state) => (state.editingNodeId === editingNodeId ? {} : { editingNodeId })),
  clearEditingNodeId: (nodeId) =>
    set((state) => (state.editingNodeId === nodeId ? { editingNodeId: null } : {})),
  setRemoteEditors: (remoteEditors) =>
    set((state) => (sameEditors(state.remoteEditors, remoteEditors) ? {} : { remoteEditors })),
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
      capacity: EMPTY_CAPACITY,
      remoteEditors: {},
    }),
}));

// ---------------------------------------------------------------------------
// Modo solo lectura del lienzo
//   · 7.º en un espacio lleno (6/6): ve el lienzo en vivo pero no lo modifica.
//   · Vista Invitado (`/ver/<token>`): nunca monta este lienzo editable, pero
//     cualquier vista compartida que lo reutilice pasa por el mismo selector.
// ---------------------------------------------------------------------------

//   · (Sprint 16) Rol «Comentarista» o «Solo lectura» en un espacio compartido:
//     el mismo modo de solo lectura (la RLS de Supabase lo exige igualmente).

/** Sala llena (7.º en el espacio): solo depende del estado de la sala. */
export const selectCanvasReadOnly = (s: CollabState): boolean => s.capacity.readOnly;

/** Por qué el lienzo está en solo lectura (o `null` si se puede editar). */
export type ReadOnlyReason = "capacity" | "commenter" | "viewer";

function reasonFor(capacityReadOnly: boolean, role: WorkspaceRole): ReadOnlyReason | null {
  if (!canEditCanvas(role)) return role === "commenter" ? "commenter" : "viewer";
  return capacityReadOnly ? "capacity" : null;
}

/** `true` cuando el lienzo NO debe aceptar cambios locales (crear, dibujar, conectar, importar). */
export const useCanvasReadOnly = (): boolean => useReadOnlyReason() !== null;

export const useReadOnlyReason = (): ReadOnlyReason | null => {
  const capacityReadOnly = useCollabStore(selectCanvasReadOnly);
  const role = useWorkspaceRole();
  return reasonFor(capacityReadOnly, role);
};

/** Lectura puntual (atajos de teclado, paleta de comandos, acciones fuera de React). */
export const isCanvasReadOnly = (): boolean =>
  reasonFor(selectCanvasReadOnly(useCollabStore.getState()), currentWorkspaceRole()) !== null;

/** Texto corto del aviso «Solo lectura» del dock y la barra del teléfono. */
export const READ_ONLY_LABELS: Record<ReadOnlyReason, { short: string; long: string }> = {
  capacity: {
    short: "Solo lectura · sala llena",
    long: "La sala está llena: ves el lienzo en vivo, pero no puedes modificarlo.",
  },
  commenter: {
    short: "Comentarista",
    long: "Tu permiso es Comentarista: ves el lienzo y puedes dejar comentarios, sin editarlo.",
  },
  viewer: {
    short: "Solo lectura",
    long: "Tu permiso es Solo lectura: ves el lienzo y los comentarios, sin modificarlos.",
  },
};
