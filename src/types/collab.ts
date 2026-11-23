// ============================================================================
// ANDROS — CONTRATOS DE LA COLABORACIÓN EN VIVO (SPRINT 7)
// Sala de voz, presencia, cursores, pantalla compartida y eventos del lienzo
// que viajan por Supabase Realtime (Presence + Broadcast) y WebRTC.
// ============================================================================

import type { CanvasStroke, EngineeringNodeData, NodeConnection } from "./workspace";

/** Estado de la sala para la barra de voz. */
export type CollabRoomStatus =
  | "idle" // No has entrado a ninguna sala.
  | "local" // Sin sesión o sin Supabase: barra visible, sin red.
  | "connecting" // Suscribiéndose al canal de Realtime.
  | "connected" // Dentro de la sala.
  | "error"; // El canal falló (se puede reintentar).

/** Datos que cada participante publica en Presence. */
export interface CollabPresence {
  /** Id único de ESTA pestaña (un mismo usuario puede entrar desde 2 equipos). */
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Color asignado a su cursor y avatar (AA con texto blanco). */
  color: string;
  /** Espacio que tiene abierto ahora (dentro de la carpeta de la sala). */
  workspaceId: string | null;
  workspaceName: string;
  muted: boolean;
  deafened: boolean;
  /** `true` si tiene el micrófono conectado (pudo dar permiso). */
  hasMic: boolean;
  /** `true` mientras comparte pantalla. */
  sharing: boolean;
  /** `true` si ve el lienzo de otro como invitado (no es dueño del espacio). */
  guest: boolean;
  joinedAt: number;
}

/** Cursor remoto en coordenadas del lienzo. */
export interface CollabCursor {
  peerId: string;
  x: number;
  y: number;
  workspaceId: string | null;
  /** Marca local (ms) de la última actualización: los cursores quietos se ocultan. */
  at: number;
}

// ----------------------------------------------------------------------------
// Nodo efímero de pantalla compartida (`screen-share-node`)
//   · Vive SOLO en la sesión (useCollabStore); nunca se guarda en Supabase,
//     así no quedan "pantallas muertas" en el lienzo al cerrar.
// ----------------------------------------------------------------------------

export type ScreenShareStatus = "live" | "connecting" | "ended";

export interface ScreenShareNodeData {
  id: string;
  type: "screen-share-node";
  /** Participante que comparte. */
  peerId: string;
  presenterName: string;
  presenterColor: string;
  /** `true` si la pantalla es tuya (vista previa local, sin red). */
  isLocal: boolean;
  status: ScreenShareStatus;
  position: { x: number; y: number };
  size: { width: number; height: number };
  startedAt: number;
}

// ----------------------------------------------------------------------------
// Mensajes Broadcast del canal `andros-collab:<roomId>`
// ----------------------------------------------------------------------------

/** Señalización WebRTC (negociación perfecta, dirigida a un solo peer). */
export interface RtcSignalPayload {
  from: string;
  to: string;
  description?: { type: RTCSdpType; sdp?: string };
  candidate?: RTCIceCandidateInit;
}

export interface CursorPayload {
  senderId: string;
  workspaceId: string | null;
  x: number;
  y: number;
}

export interface NodeUpsertPayload {
  senderId: string;
  senderUserId: string;
  workspaceId: string;
  node: EngineeringNodeData;
}

export interface NodeDeletePayload {
  senderId: string;
  senderUserId: string;
  workspaceId: string;
  id: string;
}

export interface EdgeUpsertPayload {
  senderId: string;
  senderUserId: string;
  workspaceId: string;
  edge: NodeConnection;
}

export interface EdgeDeletePayload {
  senderId: string;
  senderUserId: string;
  workspaceId: string;
  id: string;
}

/** Un invitado pide el lienzo completo de un espacio. */
export interface CanvasRequestPayload {
  senderId: string;
  workspaceId: string;
}

/** Lienzo completo en partes (Realtime limita el tamaño de cada mensaje). */
export interface CanvasSnapshotPayload {
  senderId: string;
  to: string;
  workspaceId: string;
  workspaceName: string;
  snapshotId: string;
  part: number;
  total: number;
  nodes: EngineeringNodeData[];
  connections: NodeConnection[];
  strokes: CanvasStroke[];
}

export interface ScreenStopPayload {
  senderId: string;
}

/** Invitación leída de la URL (`?sala=…&espacio=…`). */
export interface CollabInvite {
  roomId: string;
  workspaceId: string | null;
}

/** Sesión de invitado: ves y editas el lienzo de otra persona sin guardarlo en tu nube. */
export interface CollabGuestSession {
  workspaceId: string;
  workspaceName: string;
  hostName: string;
}
