"use client";

// ============================================================================
// ANDROS — SINCRONIZACIÓN AUTOMÁTICA CON SUPABASE
//
// - Sin `.env.local` o sin sesión: no hace nada (modo local, sin errores).
// - Con sesión de Google:
//     1. Carga el lienzo guardado del usuario (o sube el lienzo local si es
//        la primera vez).
//     2. Cada vez que se mueve, crea, edita, conecta o borra algo, espera
//        1.2 s sin cambios (debounce) y guarda SOLO lo que cambió.
//     3. Los archivos de los `file-node` se suben al bucket `print-files`.
//
// Uso: llamar `useCloudSync()` una sola vez (en `src/app/page.tsx`).
// ============================================================================

import { useEffect } from "react";
import { track } from "@/lib/analytics/telemetry";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, PRINT_FILES_BUCKET } from "@/lib/supabase/client";
import { useCloudStore, type CloudUser } from "@/store/useCloudStore";
import { AUTOSAVE_DELAY_MS, useSettingsStore } from "@/store/useSettingsStore";
import {
  createEmptyCalcLatexPayload,
  createEmptyAiChatPayload,
  createEmptyCodeLabPayload,
  createEmptyFilePayload,
  createEmptyResourceLinkPayload,
  createEmptySketchNotePayload,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import { useLandingStore } from "@/store/useLandingStore";
import { useToastStore } from "@/store/useToastStore";
import { useCollabStore } from "@/store/useCollabStore";
import { shouldSkipAutosaveForRemote } from "@/lib/collab/remoteFlag";
import { sanitizeCanvasStrokes } from "@/lib/canvas/inkGeometry";
import { getDesktopBridge, type AndrosDesktopBridge } from "@/lib/printer/printerClient";
import {
  useWorkspaceManagerStore,
  type SharedWorkspaceSummary,
  type WorkspaceSummary,
} from "@/store/useWorkspaceManagerStore";
import type {
  AiChatPayload,
  CalcLatexPayload,
  CodeLabPayload,
  EngineeringNodeBase,
  EngineeringNodeData,
  FileNodePayload,
  NodeArchetype,
  NodeConnection,
  PortPosition,
  ResourceLinkPayload,
  SketchNotePayload,
  TelemetryMetric,
} from "@/types/workspace";
import type { CanvasStroke } from "@/types/workspace";
import { sanitizeFormSheet } from "@/lib/forms/formSchema";
import { sanitizeFormulaSheet } from "@/lib/math/formulaSchema";

const SAVE_DEBOUNCE_MS = 1200;
/** Duración de los enlaces de descarga firmados (7 días). */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
/** Esperas antes de reintentar una subida fallida (conexión lenta o cortada). */
const UPLOAD_RETRY_DELAYS_MS = [2000, 6000];

// ----------------------------------------------------------------------------
// 1. Filas de la base de datos ↔ objetos del lienzo
// ----------------------------------------------------------------------------

interface NodeRow {
  workspace_id: string;
  id: string;
  owner_id: string;
  type: NodeArchetype;
  title: string;
  code_tag: string;
  summary: string | null;
  action_label: string | null;
  metrics: TelemetryMetric[] | null;
  position_x: number;
  position_y: number;
  payload: unknown;
  updated_label: string | null;
  sort_order: number;
}

interface ConnectionRow {
  workspace_id: string;
  id: string;
  owner_id: string;
  from_node_id: string;
  to_node_id: string;
  from_port: PortPosition;
  to_port: PortPosition;
  label: string | null;
}

const NODE_COLUMNS =
  "id, type, title, code_tag, summary, action_label, metrics, position_x, position_y, payload, updated_label, sort_order";
const CONNECTION_COLUMNS = "id, from_node_id, to_node_id, from_port, to_port, label";

const PORTS: readonly PortPosition[] = ["top", "right", "bottom", "left"];

/** Mensaje si la base de datos todavía no tiene la columna `canvas_strokes`. */
const STROKES_SETUP_HINT =
  "Los dibujos a mano no se pudieron guardar. Ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase";

/**
 * Lo que se guarda del archivo en `workspace_nodes`: SOLO metadatos ligeros.
 * Nunca se guarda contenido (`data:` / base64) ni enlaces temporales (`blob:`
 * o firmados): el contenido vive únicamente en el bucket `print-files`.
 */
function cloudFilePayload(file: FileNodePayload): FileNodePayload {
  return {
    fileName: file.fileName,
    extension: file.extension,
    fileSizeBytes: file.fileSizeBytes,
    mimeType: file.mimeType,
    downloadUrl: "",
    status: file.status,
    uploadProgress: file.uploadProgress,
    ...(file.checksum ? { checksum: file.checksum } : {}),
    ...(file.lastModifiedMs ? { lastModifiedMs: file.lastModifiedMs } : {}),
    ...(file.status === "error" && file.errorMessage
      ? { errorMessage: file.errorMessage.slice(0, 300) }
      : {}),
    ...(file.storagePath ? { storagePath: file.storagePath } : {}),
    ...(file.modelDimensionsMm ? { modelDimensionsMm: file.modelDimensionsMm } : {}),
    ...(file.scale ? { scale: file.scale } : {}),
    ...(file.autoSupports ? { autoSupports: true } : {}),
  };
}

/** Conversación IA: no se guarda el estado transitorio "pensando…". */
function cloudAiChatPayload(data: AiChatPayload): AiChatPayload {
  return {
    ...data,
    messages: data.messages.slice(-200),
    status: data.status === "thinking" ? "idle" : data.status,
  };
}

/** Postgres 23514: la base aún no acepta el tipo de nodo "ai-chat-node". */
const AI_NODE_SETUP_HINT =
  "La base de datos todavía no acepta Nodos IA. Ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase (añade \"ai-chat-node\" a los tipos permitidos)";

/** Postgres 23514: la base aún no acepta el tipo de nodo "form-sheet-node". */
const FORM_NODE_SETUP_HINT =
  "La base de datos todavía no acepta Fichas. Ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase (añade \"form-sheet-node\" a los tipos permitidos); mientras tanto, tus fichas siguen en este dispositivo";

/** Postgres 23514: la base aún no acepta el tipo de nodo "formula-sheet-node". */
const FORMULA_NODE_SETUP_HINT =
  "La base de datos todavía no acepta Fichas de Fórmula. Ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase (añade \"formula-sheet-node\" a los tipos permitidos); mientras tanto, tus fórmulas siguen en este dispositivo";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function nodeToRow(
  node: EngineeringNodeData,
  sortOrder: number,
  workspaceId: string,
  ownerId: string
): NodeRow {
  const payload =
    node.type === "file-node"
      ? cloudFilePayload(node.fileData)
      : node.type === "sketch-note-node"
        ? node.sketchNoteData
        : node.type === "calc-latex-node"
          ? node.calcLatexData
          : node.type === "resource-link-node"
            ? node.resourceLinkData
            : node.type === "ai-chat-node"
              ? cloudAiChatPayload(node.aiChatData)
              : node.type === "form-sheet-node"
                ? node.formSheetData
                : node.type === "formula-sheet-node"
                  ? node.formulaSheetData
                  : node.codeLabData;

  return {
    workspace_id: workspaceId,
    id: node.id,
    owner_id: ownerId,
    type: node.type,
    title: node.title,
    code_tag: node.codeTag,
    summary: node.summary ?? null,
    action_label: node.actionLabel ?? null,
    metrics: node.metrics ?? null,
    position_x: node.position.x,
    position_y: node.position.y,
    payload,
    updated_label: node.updatedAt || null,
    sort_order: sortOrder,
  };
}

function rowToNode(row: NodeRow): EngineeringNodeData | null {
  const payload =
    row.payload && typeof row.payload === "object" ? (row.payload as object) : {};

  const base: EngineeringNodeBase = {
    id: row.id,
    title: row.title ?? "",
    codeTag: row.code_tag ?? "",
    summary: row.summary ?? undefined,
    metrics: row.metrics ?? undefined,
    actionLabel: row.action_label ?? undefined,
    position: { x: Number(row.position_x) || 0, y: Number(row.position_y) || 0 },
    updatedAt: row.updated_label ?? "",
  };

  switch (row.type) {
    case "file-node":
      return {
        ...base,
        type: "file-node",
        fileData: { ...createEmptyFilePayload(), ...(payload as Partial<FileNodePayload>) },
      };
    case "sketch-note-node":
      return {
        ...base,
        type: "sketch-note-node",
        sketchNoteData: {
          ...createEmptySketchNotePayload(),
          ...(payload as Partial<SketchNotePayload>),
        },
      };
    case "calc-latex-node":
      return {
        ...base,
        type: "calc-latex-node",
        calcLatexData: {
          ...createEmptyCalcLatexPayload(),
          ...(payload as Partial<CalcLatexPayload>),
        },
      };
    case "resource-link-node":
      return {
        ...base,
        type: "resource-link-node",
        resourceLinkData: {
          ...createEmptyResourceLinkPayload(),
          ...(payload as Partial<ResourceLinkPayload>),
        },
      };
    case "ai-chat-node": {
      const data = { ...createEmptyAiChatPayload(), ...(payload as Partial<AiChatPayload>) };
      return {
        ...base,
        type: "ai-chat-node",
        aiChatData: {
          ...data,
          messages: Array.isArray(data.messages) ? data.messages : [],
          status: data.status === "thinking" ? "idle" : data.status,
        },
      };
    }
    case "form-sheet-node":
      return {
        ...base,
        type: "form-sheet-node",
        formSheetData: sanitizeFormSheet(payload),
      };
    case "formula-sheet-node":
      return {
        ...base,
        type: "formula-sheet-node",
        formulaSheetData: sanitizeFormulaSheet(payload),
      };
    case "code-lab-node":
      return {
        ...base,
        type: "code-lab-node",
        codeLabData: {
          ...createEmptyCodeLabPayload(),
          ...(payload as Partial<CodeLabPayload>),
        },
      };
    default:
      return null;
  }
}

function connectionToRow(
  connection: NodeConnection,
  workspaceId: string,
  ownerId: string
): ConnectionRow {
  return {
    workspace_id: workspaceId,
    id: connection.id,
    owner_id: ownerId,
    from_node_id: connection.fromNodeId,
    to_node_id: connection.toNodeId,
    from_port: connection.fromPort,
    to_port: connection.toPort,
    label: connection.label ?? null,
  };
}

function rowToConnection(row: ConnectionRow): NodeConnection | null {
  if (!PORTS.includes(row.from_port) || !PORTS.includes(row.to_port)) return null;
  return {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    fromPort: row.from_port,
    toPort: row.to_port,
    ...(row.label ? { label: row.label } : {}),
  };
}

/** Datos con los que se abre un espacio nuevo (por ejemplo, un .andros.zip). */
export interface WorkspaceSeed {
  nodes: EngineeringNodeData[];
  connections: NodeConnection[];
  strokes: CanvasStroke[];
}

const NODE_DATA_KEY: Record<string, string> = {
  "file-node": "fileData",
  "sketch-note-node": "sketchNoteData",
  "calc-latex-node": "calcLatexData",
  "resource-link-node": "resourceLinkData",
  "code-lab-node": "codeLabData",
  "ai-chat-node": "aiChatData",
  "form-sheet-node": "formSheetData",
  "formula-sheet-node": "formulaSheetData",
};

/** Valida un nodo leído de un archivo externo (.andros.zip) y completa lo que falte. */
export function parseImportedNode(raw: unknown): EngineeringNodeData | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const dataKey = typeof n.type === "string" ? NODE_DATA_KEY[n.type] : undefined;
  if (!dataKey || typeof n.id !== "string" || !n.id) return null;
  const pos = (n.position ?? {}) as { x?: unknown; y?: unknown };
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return rowToNode({
    workspace_id: "",
    owner_id: "",
    sort_order: 0,
    id: n.id,
    type: n.type as NodeArchetype,
    title: text(n.title) ?? "",
    code_tag: text(n.codeTag) ?? "",
    summary: text(n.summary),
    action_label: text(n.actionLabel),
    metrics: Array.isArray(n.metrics) ? (n.metrics as TelemetryMetric[]) : null,
    position_x: Number(pos.x) || 0,
    position_y: Number(pos.y) || 0,
    payload: n[dataKey],
    updated_label: text(n.updatedAt),
  });
}

/** Valida un cable leído de un archivo externo (.andros.zip). */
export function parseImportedConnection(raw: unknown): NodeConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.fromNodeId !== "string" || typeof c.toNodeId !== "string")
    return null;
  return rowToConnection({
    workspace_id: "",
    owner_id: "",
    id: c.id,
    from_node_id: c.fromNodeId,
    to_node_id: c.toNodeId,
    from_port: c.fromPort as PortPosition,
    to_port: c.toPort as PortPosition,
    label: typeof c.label === "string" ? c.label : null,
  });
}

/** Orden estable: el nodo más nuevo (primero del arreglo) tiene el número más alto. */
function buildNodeRows(nodes: EngineeringNodeData[], workspaceId: string, ownerId: string) {
  return nodes.map((node, index) =>
    nodeToRow(node, nodes.length - 1 - index, workspaceId, ownerId)
  );
}

function storagePathsOf(nodes: EngineeringNodeData[]): Set<string> {
  const paths = new Set<string>();
  for (const node of nodes) {
    if (node.type === "file-node" && node.fileData.storagePath) {
      paths.add(node.fileData.storagePath);
    }
  }
  return paths;
}

function toCloudUser(user: User): CloudUser {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
  return {
    id: user.id,
    email: user.email ?? "",
    name: text(meta.full_name) ?? text(meta.name) ?? user.email ?? "Usuario",
    avatarUrl: text(meta.avatar_url) ?? text(meta.picture),
  };
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "Error desconocido";
}

/** Nombre seguro para Supabase Storage (sin espacios, tildes ni símbolos raros). */
function safeStorageName(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+/, "");
  return (clean || "archivo").slice(-120);
}

// ----------------------------------------------------------------------------
// 2. Motor de sincronización (uno por pestaña)
// ----------------------------------------------------------------------------

interface CloudEngine {
  /** Guarda de inmediato lo pendiente (antes de cerrar sesión). */
  flush: () => Promise<void>;
  /** Detiene la sincronización sin tocar el lienzo. */
  pause: () => void;
  /**
   * Sala en vivo (invitado): guarda lo pendiente y congela el autoguardado
   * mientras ves el lienzo de otra cuenta, para no escribirlo en tu nube.
   */
  suspendForCollabGuest: () => Promise<void>;
  /** Fin de la visita: vuelve a cargar tu propio espacio y reanuda el guardado. */
  resumeAfterCollabGuest: () => Promise<void>;
  stop: () => void;
  /** Vuelve a intentar la subida fallida del archivo de un nodo. */
  retryUpload: (nodeId: string) => void;
  /** Guarda el espacio actual y abre otro (o uno nuevo con `seed`). */
  openWorkspace: (id: string, seed?: WorkspaceSeed) => Promise<void>;
  createWorkspace: (name: string, folder: string, seed?: WorkspaceSeed) => Promise<string | null>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  moveWorkspace: (id: string, folder: string) => Promise<void>;
  renameFolder: (from: string, to: string) => Promise<void>;
  duplicateWorkspace: (id: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  /** Vuelve a leer «Mis espacios» y «Compartidos conmigo». */
  refreshList: () => Promise<void>;
  /** Abre el espacio pedido por un enlace `?espacio=` (si eres miembro). */
  consumeLink: () => Promise<void>;
}

const LAST_WORKSPACE_KEY = "andros:last-workspace:";

function readLastWorkspace(uid: string): string | null {
  try {
    return window.localStorage.getItem(LAST_WORKSPACE_KEY + uid);
  } catch {
    return null;
  }
}

function writeLastWorkspace(uid: string, id: string): void {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY + uid, id);
  } catch {
    /* sin localStorage: se abre el primer espacio */
  }
}

const FOLDERS_SETUP_HINT =
  "Las carpetas necesitan una columna nueva. Ejecuta de nuevo supabase/schema.sql en el SQL Editor de Supabase";

let activeEngine: CloudEngine | null = null;

/** Espacio pedido por un enlace `?espacio=<id>` que aún no se abrió. */
let pendingLinkWorkspaceId: string | null = null;

const NO_ACCESS_MESSAGE =
  "No tienes acceso a ese espacio. Pide a su dueño que te añada desde «Compartir».";

function startCloudEngine(supabase: SupabaseClient): CloudEngine {
  const cloud = useCloudStore.getState;

  let disposed = false;
  /** Cambia con cada inicio/cierre de sesión: invalida respuestas viejas. */
  let epoch = 0;
  let userId: string | null = null;
  let workspaceId: string | null = null;
  /**
   * `owner_id` de las filas que se guardan: SIEMPRE el dueño del espacio
   * (también si escribe un miembro de un espacio compartido).
   */
  let rowOwnerId: string | null = null;
  let ready = false;
  /** `true` mientras el lienzo muestra el espacio de otra cuenta (sala en vivo). */
  let collabGuest = false;

  let nodeSnapshot = new Map<string, string>();
  let connectionSnapshot = new Map<string, string>();
  /** JSON de los trazos de tinta ya guardados (null = aún no se guardaron). */
  let strokesSnapshot: string | null = null;
  let syncedStoragePaths = new Set<string>();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let syncPromise: Promise<void> | null = null;
  let rerunAfterSync = false;

  const uploadsInFlight = new Set<string>();
  const failedUploads = new Set<string>();

  // --- Error devuelto por /auth/callback (ej. el usuario canceló en Google) ---
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("auth_error");
    if (authError) {
      cloud().setStatus(cloud().status, `Inicio de sesión cancelado: ${authError}`);
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }

  const resetSession = () => {
    epoch += 1;
    ready = false;
    userId = null;
    workspaceId = null;
    rowOwnerId = null;
    nodeSnapshot = new Map();
    connectionSnapshot = new Map();
    strokesSnapshot = null;
    syncedStoragePaths = new Set();
    failedUploads.clear();
    cloud().clearUploadErrors();
    if (timer) clearTimeout(timer);
    timer = null;
    cloud().setWorkspaceId(null);
  };

  // --------------------------------------------------------------------------
  // Guardado incremental (solo filas que cambiaron)
  // --------------------------------------------------------------------------

  const runSync = async (): Promise<void> => {
    if (!ready || !userId || !workspaceId || disposed || collabGuest) return;
    const ep = epoch;
    const ws = workspaceId;
    const uid = rowOwnerId ?? userId;

    const { nodes, connections, canvasStrokes } = useWorkspaceStore.getState();
    const nextStrokesSnapshot = JSON.stringify(canvasStrokes);
    const strokesChanged = nextStrokesSnapshot !== strokesSnapshot;
    const nodeRows = buildNodeRows(nodes, ws, uid);
    const connectionRows = connections.map((c) => connectionToRow(c, ws, uid));

    const nextNodeSnapshot = new Map(nodeRows.map((r) => [r.id, JSON.stringify(r)]));
    const nextConnectionSnapshot = new Map(
      connectionRows.map((r) => [r.id, JSON.stringify(r)])
    );

    const changedNodes = nodeRows.filter(
      (r) => nodeSnapshot.get(r.id) !== nextNodeSnapshot.get(r.id)
    );
    const changedConnections = connectionRows.filter(
      (r) => connectionSnapshot.get(r.id) !== nextConnectionSnapshot.get(r.id)
    );
    const removedNodeIds = [...nodeSnapshot.keys()].filter((id) => !nextNodeSnapshot.has(id));
    const removedConnectionIds = [...connectionSnapshot.keys()].filter(
      (id) => !nextConnectionSnapshot.has(id)
    );

    const nothingChanged =
      changedNodes.length === 0 &&
      changedConnections.length === 0 &&
      removedNodeIds.length === 0 &&
      removedConnectionIds.length === 0 &&
      !strokesChanged;

    if (nothingChanged) {
      if (cloud().status !== "error") cloud().setStatus("saved");
      return;
    }

    cloud().setStatus("saving");

    try {
      // Orden importante: nodos antes que cables (los cables apuntan a nodos).
      if (changedNodes.length > 0) {
        const { error } = await supabase
          .from("workspace_nodes")
          .upsert(changedNodes, { onConflict: "workspace_id,id" });
        if (error) {
          if (error.code === "23514" && changedNodes.some((r) => r.type === "formula-sheet-node")) {
            throw new Error(FORMULA_NODE_SETUP_HINT);
          }
          if (error.code === "23514" && changedNodes.some((r) => r.type === "form-sheet-node")) {
            throw new Error(FORM_NODE_SETUP_HINT);
          }
          if (error.code === "23514" && changedNodes.some((r) => r.type === "ai-chat-node")) {
            throw new Error(AI_NODE_SETUP_HINT);
          }
          throw error;
        }
      }
      if (removedConnectionIds.length > 0) {
        const { error } = await supabase
          .from("workspace_connections")
          .delete()
          .eq("workspace_id", ws)
          .in("id", removedConnectionIds);
        if (error) throw error;
      }
      if (changedConnections.length > 0) {
        const { error } = await supabase
          .from("workspace_connections")
          .upsert(changedConnections, { onConflict: "workspace_id,id" });
        if (error) throw error;
      }
      if (removedNodeIds.length > 0) {
        const { error } = await supabase
          .from("workspace_nodes")
          .delete()
          .eq("workspace_id", ws)
          .in("id", removedNodeIds);
        if (error) throw error;
      }

      if (ep !== epoch) return;
      nodeSnapshot = nextNodeSnapshot;
      connectionSnapshot = nextConnectionSnapshot;

      // Borra del bucket los archivos que ya no usa ningún nodo.
      const currentPaths = storagePathsOf(nodes);
      const orphanPaths = [...syncedStoragePaths].filter((p) => !currentPaths.has(p));
      syncedStoragePaths = currentPaths;
      if (orphanPaths.length > 0) {
        void supabase.storage.from(PRINT_FILES_BUCKET).remove(orphanPaths);
      }

      // Tinta libre del lienzo (Lápiz D): se guarda en el propio workspace.
      if (strokesChanged) {
        const { error } = await supabase
          .from("workspaces")
          .update({ canvas_strokes: canvasStrokes })
          .eq("id", ws);
        if (ep !== epoch) return;
        if (error) {
          cloud().setStatus("error", `${STROKES_SETUP_HINT} (${describeError(error)}).`);
          return;
        }
        strokesSnapshot = nextStrokesSnapshot;
      }

      cloud().setStatus("saved", null);
    } catch (error) {
      if (ep !== epoch) return;
      cloud().setStatus("error", `No se pudo guardar en la nube: ${describeError(error)}`);
    }
  };

  const syncNow = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (syncPromise) {
      rerunAfterSync = true;
      return syncPromise;
    }
    syncPromise = runSync().finally(() => {
      syncPromise = null;
      if (rerunAfterSync) {
        rerunAfterSync = false;
        void syncNow();
      }
    });
    return syncPromise;
  };

  const scheduleSync = () => {
    if (!ready || disposed || collabGuest) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncNow();
    }, AUTOSAVE_DELAY_MS[useSettingsStore.getState().autosave] ?? SAVE_DEBOUNCE_MS);
  };

  // --------------------------------------------------------------------------
  // Subida de archivos de `file-node` al bucket `print-files`
  // --------------------------------------------------------------------------

  /** `true` si el nodo todavía tiene exactamente ese archivo local sin subir. */
  const stillNeedsUpload = (nodeId: string, file: FileNodePayload): boolean => {
    const current = useWorkspaceStore.getState().nodes.find((n) => n.id === nodeId);
    return (
      current?.type === "file-node" &&
      current.fileData.downloadUrl === file.downloadUrl &&
      current.fileData.checksum === file.checksum &&
      !current.fileData.storagePath
    );
  };

  /** Sube UN archivo. Nunca lanza errores: los deja anotados en el nodo. */
  const uploadFile = async (
    nodeId: string,
    file: FileNodePayload,
    key: string,
    queuedEpoch: number
  ) => {
    try {
      if (queuedEpoch !== epoch || !userId || !workspaceId) return;
      if (!stillNeedsUpload(nodeId, file)) return;

      const checksumHex = (file.checksum ?? "").replace(/^crc32:/, "") || "sin-crc";
      const path = `${userId}/${workspaceId}/${safeStorageName(nodeId)}/${checksumHex}-${safeStorageName(file.fileName)}`;

      // `blob()` solo enlaza el archivo del disco: no lo copia a la memoria.
      const blob = await (await fetch(file.downloadUrl)).blob();
      if (blob.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`el límite actual por pieza es de ${MAX_FILE_SIZE_LABEL}`);
      }

      let lastError: unknown = null;
      for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) await wait(UPLOAD_RETRY_DELAYS_MS[attempt - 1]);
        if (queuedEpoch !== epoch) return;
        if (!stillNeedsUpload(nodeId, file)) return;

        const { error } = await supabase.storage.from(PRINT_FILES_BUCKET).upload(path, blob, {
          upsert: true,
          contentType: file.mimeType || "application/octet-stream",
        });
        lastError = error;
        if (!error) break;
      }
      if (lastError) throw lastError;
      if (queuedEpoch !== epoch) return;

      // Solo se enlaza si el nodo todavía tiene ese mismo archivo.
      if (stillNeedsUpload(nodeId, file)) {
        useWorkspaceStore.getState().updateNodePayload(nodeId, { storagePath: path });
      } else if (!storagePathsOf(useWorkspaceStore.getState().nodes).has(path)) {
        void supabase.storage.from(PRINT_FILES_BUCKET).remove([path]);
      }
    } catch (error) {
      if (queuedEpoch !== epoch) return;
      failedUploads.add(key);
      cloud().setUploadError(nodeId, describeError(error));
      cloud().setStatus(
        "error",
        `No se pudo subir "${file.fileName}" a la nube: ${describeError(error)}`
      );
    } finally {
      uploadsInFlight.delete(key);
      cloud().changePendingUploads(-1);
    }
  };

  /**
   * Cola de subidas: los archivos se suben DE UNO EN UNO. Varias piezas
   * pesadas a la vez saturan la conexión y hacen fallar la sincronización.
   */
  let uploadChain: Promise<void> = Promise.resolve();

  const queueUploads = () => {
    if (!ready || disposed || collabGuest) return;
    for (const node of useWorkspaceStore.getState().nodes) {
      if (node.type !== "file-node") continue;
      const file = node.fileData;
      const isInline = file.downloadUrl.startsWith("data:");
      const isLocalFile = file.downloadUrl.startsWith("blob:") || isInline;
      if (file.status !== "ready" || !isLocalFile || file.storagePath) continue;

      const key = `${node.id}|${file.checksum ?? ""}|${isInline ? "inline" : file.downloadUrl}`;
      if (uploadsInFlight.has(key) || failedUploads.has(key)) continue;

      uploadsInFlight.add(key);
      cloud().changePendingUploads(1);
      cloud().setUploadError(node.id, null);
      const queuedEpoch = epoch;
      uploadChain = uploadChain.then(() => uploadFile(node.id, file, key, queuedEpoch));
    }
  };

  // --------------------------------------------------------------------------
  // Carga del lienzo guardado al iniciar sesión
  // --------------------------------------------------------------------------

  const signFileUrls = async (nodes: EngineeringNodeData[]) =>
    Promise.all(
      nodes.map(async (node): Promise<EngineeringNodeData> => {
        if (node.type !== "file-node") return node;
        const file = node.fileData;

        if (file.storagePath) {
          const { data, error } = await supabase.storage
            .from(PRINT_FILES_BUCKET)
            .createSignedUrl(file.storagePath, SIGNED_URL_TTL_SECONDS, {
              download: file.fileName || true,
            });
          if (error || !data) {
            return {
              ...node,
              fileData: {
                ...file,
                downloadUrl: "",
                status: "error",
                errorMessage: "No se encontró el archivo en la nube. Vuelve a adjuntarlo.",
              },
            };
          }
          return { ...node, fileData: { ...file, downloadUrl: data.signedUrl } };
        }

        // El archivo se adjuntó, pero nunca terminó de subirse.
        const lostLocalFile =
          (file.status === "ready" || file.status === "uploading") && !file.downloadUrl;
        if (lostLocalFile) {
          return {
            ...node,
            fileData: {
              ...file,
              status: "error",
              uploadProgress: 0,
              errorMessage: "Este archivo no llegó a guardarse en la nube. Vuelve a adjuntarlo.",
            },
          };
        }
        return node;
      })
    );

  /**
   * «Compartidos conmigo»: espacios de otras cuentas que la RLS te deja leer
   * por ser miembro. Si las tablas nuevas aún no existen, la lista queda vacía
   * (sin romper nada).
   */
  const refreshSharedList = async (uid: string): Promise<SharedWorkspaceSummary[]> => {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name, folder, owner_id, created_at, updated_at")
      .neq("owner_id", uid)
      .order("updated_at", { ascending: false });
    if (error) {
      useWorkspaceManagerStore.getState().setSharedWorkspaces([]);
      return [];
    }
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const ownerIds = [...new Set(rows.map((r) => String(r.owner_id ?? "")).filter(Boolean))];
    const names = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: profiles } = await supabase.rpc("get_basic_profiles", { ids: ownerIds });
      for (const profile of (profiles ?? []) as Record<string, unknown>[]) {
        const username =
          typeof profile.username === "string" && profile.username ? `@${profile.username}` : "";
        const fullName = typeof profile.full_name === "string" ? profile.full_name.trim() : "";
        names.set(String(profile.id), fullName || username || "Otra cuenta");
      }
    }
    const list: SharedWorkspaceSummary[] = rows.map((r) => ({
      id: String(r.id),
      name: typeof r.name === "string" && r.name ? r.name : "Sin nombre",
      folder: typeof r.folder === "string" ? r.folder : "",
      createdAt: String(r.created_at ?? ""),
      updatedAt: String(r.updated_at ?? ""),
      ownerId: String(r.owner_id ?? ""),
      ownerName: names.get(String(r.owner_id ?? "")) ?? "Otra cuenta",
    }));
    useWorkspaceManagerStore.getState().setSharedWorkspaces(list);
    return list;
  };

  /** Lista los espacios del usuario (con carpeta si la columna existe). */
  const refreshWorkspaceList = async (uid: string): Promise<WorkspaceSummary[]> => {
    const toSummary = (r: Record<string, unknown>): WorkspaceSummary => ({
      id: String(r.id),
      name: typeof r.name === "string" && r.name ? r.name : "Sin nombre",
      folder: typeof r.folder === "string" ? r.folder : "",
      createdAt: String(r.created_at ?? ""),
      updatedAt: String(r.updated_at ?? ""),
    });
    let foldersSupported = true;
    let result: { data: unknown; error: unknown } = await supabase
      .from("workspaces")
      .select("id, name, folder, created_at, updated_at")
      .eq("owner_id", uid)
      .order("created_at", { ascending: true });
    if (result.error) {
      foldersSupported = false;
      result = await supabase
        .from("workspaces")
        .select("id, name, created_at, updated_at")
        .eq("owner_id", uid)
        .order("created_at", { ascending: true });
    }
    if (result.error) throw result.error;
    const list = ((result.data ?? []) as unknown as Record<string, unknown>[]).map(toSummary);
    useWorkspaceManagerStore.getState().setWorkspaces(list, foldersSupported);
    await refreshSharedList(uid).catch(() => [] as SharedWorkspaceSummary[]);
    return list;
  };

  const loadWorkspace = async (
    uid: string,
    opts: { workspaceId?: string; seed?: WorkspaceSeed } = {}
  ) => {
    const ep = epoch;
    cloud().setStatus("loading", null);

    try {
      // 1. Espacio pedido (o del enlace ?espacio=), último usado, o el primero
      //    del usuario (o uno nuevo). Los compartidos contigo también valen.
      const list = await refreshWorkspaceList(uid);
      const shared = useWorkspaceManagerStore.getState().sharedWorkspaces;
      const accessible = (id: string | null | undefined): id is string =>
        Boolean(id) && (list.some((w) => w.id === id) || shared.some((w) => w.id === id));
      let requested = opts.workspaceId ?? null;
      let fromLink = false;
      if (!requested && pendingLinkWorkspaceId) {
        requested = pendingLinkWorkspaceId;
        pendingLinkWorkspaceId = null;
        fromLink = true;
      }
      let wsId: string | null = null;
      if (accessible(requested)) {
        wsId = requested;
      } else {
        if (fromLink) useToastStore.getState().show({ message: NO_ACCESS_MESSAGE, tone: "error" });
        const last = readLastWorkspace(uid);
        wsId = (accessible(last) ? last : null) || list[0]?.id || null;
      }
      if (!wsId) {
        const { data: created, error: createError } = await supabase
          .from("workspaces")
          .insert({ owner_id: uid })
          .select("id")
          .single();
        if (createError) throw createError;
        wsId = (created as { id: string }).id;
        await refreshWorkspaceList(uid);
      }
      writeLastWorkspace(uid, wsId);
      const sharedSummary = shared.find((w) => w.id === wsId);
      const ownerForRows = sharedSummary?.ownerId ?? uid;

      // 2. Nodos, cables y trazos de tinta guardados.
      const [nodesResult, connectionsResult, strokesResult] = await Promise.all([
        supabase
          .from("workspace_nodes")
          .select(NODE_COLUMNS)
          .eq("workspace_id", wsId)
          .order("sort_order", { ascending: false }),
        supabase.from("workspace_connections").select(CONNECTION_COLUMNS).eq("workspace_id", wsId),
        supabase.from("workspaces").select("canvas_strokes").eq("id", wsId).maybeSingle(),
      ]);
      if (nodesResult.error) throw nodesResult.error;
      if (connectionsResult.error) throw connectionsResult.error;
      if (ep !== epoch || disposed) return;

      workspaceId = wsId;
      rowOwnerId = ownerForRows;
      cloud().setWorkspaceId(wsId);

      const nodeRows = (nodesResult.data ?? []) as unknown as NodeRow[];
      const connectionRows = (connectionsResult.data ?? []) as unknown as ConnectionRow[];
      // Si falta la columna `canvas_strokes`, el lienzo carga igual (sin dibujos).
      const strokesAvailable = !strokesResult.error;
      const loadedStrokes = strokesAvailable
        ? sanitizeCanvasStrokes(
            (strokesResult.data as { canvas_strokes?: unknown } | null)?.canvas_strokes
          )
        : [];

      if (nodeRows.length === 0 && connectionRows.length === 0 && loadedStrokes.length === 0) {
        nodeSnapshot = new Map();
        connectionSnapshot = new Map();
        strokesSnapshot = strokesAvailable ? "[]" : null;
        syncedStoragePaths = new Set();
        ready = true;
        if (opts.seed) {
          // Espacio nuevo con contenido (importado de un .andros.zip).
          useWorkspaceStore.getState().hydrateWorkspace(opts.seed.nodes, opts.seed.connections);
          useWorkspaceStore.getState().hydrateCanvasStrokes(opts.seed.strokes);
        } else if (opts.workspaceId || wsId === requested || sharedSummary) {
          // Espacio vacío abierto desde el gestor, un enlace o compartido
          // contigo: lienzo en blanco (tu lienzo local nunca se sube a él).
          useWorkspaceStore.getState().hydrateWorkspace([], []);
          useWorkspaceStore.getState().hydrateCanvasStrokes([]);
        }
        // Si no, es la primera vez: el lienzo local actual pasa a ser el de la nube.
        await syncNow();
        queueUploads();
        return;
      }

      const loadedNodes = await signFileUrls(
        nodeRows.map(rowToNode).filter((n): n is EngineeringNodeData => n !== null)
      );
      const nodeIds = new Set(loadedNodes.map((n) => n.id));
      const loadedConnections = connectionRows
        .map(rowToConnection)
        .filter(
          (c): c is NodeConnection =>
            c !== null && nodeIds.has(c.fromNodeId) && nodeIds.has(c.toNodeId)
        );
      if (ep !== epoch || disposed) return;

      // "Foto" de lo que ya está guardado, en el mismo formato que usa `runSync`.
      // Se toma ANTES de firmar enlaces o corregir estados, así cualquier
      // corrección hecha al cargar se vuelve a guardar sola.
      nodeSnapshot = new Map();
      for (const row of nodeRows) {
        const node = rowToNode(row);
        if (!node) continue;
        const normalized = nodeToRow(node, Number(row.sort_order) || 0, wsId, ownerForRows);
        nodeSnapshot.set(row.id, JSON.stringify(normalized));
      }
      connectionSnapshot = new Map(
        loadedConnections.map((c) => [
          c.id,
          JSON.stringify(connectionToRow(c, wsId, ownerForRows)),
        ])
      );
      syncedStoragePaths = storagePathsOf(loadedNodes);
      strokesSnapshot = strokesAvailable ? JSON.stringify(loadedStrokes) : null;

      ready = true;
      useWorkspaceStore.getState().hydrateWorkspace(loadedNodes, loadedConnections);
      if (strokesAvailable) {
        useWorkspaceStore.getState().hydrateCanvasStrokes(loadedStrokes);
      }
      await syncNow();
      // Archivos de versiones anteriores que aún estaban incrustados: al bucket.
      queueUploads();
    } catch (error) {
      if (ep !== epoch) return;
      ready = false;
      cloud().setStatus(
        "error",
        `No se pudo cargar tu lienzo de la nube (${describeError(error)}). Recarga la página para reintentar.`
      );
    }
  };

  // --------------------------------------------------------------------------
  // Gestor de espacios: abrir, crear, renombrar, mover, duplicar y borrar
  // --------------------------------------------------------------------------

  const manager = useWorkspaceManagerStore.getState;

  /** Envuelve una operación: marca "ocupado" y muestra el error si falla. */
  const guarded = async <T,>(op: () => Promise<T>): Promise<T | null> => {
    manager().setBusy(true);
    manager().setMessage(null);
    try {
      return await op();
    } catch (error) {
      manager().setMessage({ kind: "error", text: describeError(error) });
      return null;
    } finally {
      manager().setBusy(false);
    }
  };

  const openWorkspaceRaw = async (id: string, seed?: WorkspaceSeed): Promise<void> => {
    const uid = userId;
    if (!uid || disposed) return;
    // Si estabas de invitado en una sala, el lienzo en pantalla NO es tuyo:
    // no se guarda; se termina la visita y se abre el espacio pedido.
    const wasCollabGuest = collabGuest;
    if (wasCollabGuest) {
      collabGuest = false;
      useCollabStore.getState().setGuest(null);
    }
    if (id === workspaceId && !seed && !wasCollabGuest) return;
    // Lo pendiente del espacio actual se guarda antes de salir de él.
    if (ready && !wasCollabGuest) {
      await uploadChain;
      await syncNow();
    }
    resetSession();
    userId = uid;
    await loadWorkspace(uid, { workspaceId: id, seed });
  };

  const createWorkspace = async (
    name: string,
    folder: string,
    seed?: WorkspaceSeed
  ): Promise<string | null> =>
    guarded(async () => {
      const uid = userId;
      if (!uid) throw new Error("Inicia sesión para crear espacios.");
      const row: Record<string, unknown> = {
        owner_id: uid,
        name: name.trim() || "Nuevo espacio",
      };
      if (folder.trim()) {
        if (!manager().foldersSupported) throw new Error(FOLDERS_SETUP_HINT);
        row.folder = folder.trim();
      }
      const { data, error } = await supabase.from("workspaces").insert(row).select("id").single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      await openWorkspaceRaw(id, seed ?? { nodes: [], connections: [], strokes: [] });
      track("workspace_created", { seeded: Boolean(seed && seed.nodes.length > 0) });
      return id;
    });

  const renameWorkspace = async (id: string, name: string): Promise<void> => {
    await guarded(async () => {
      const clean = name.trim();
      if (!clean) return;
      const { error } = await supabase.from("workspaces").update({ name: clean }).eq("id", id);
      if (error) throw error;
      if (userId) await refreshWorkspaceList(userId);
    });
  };

  const moveWorkspace = async (id: string, folder: string): Promise<void> => {
    await guarded(async () => {
      if (!manager().foldersSupported) throw new Error(FOLDERS_SETUP_HINT);
      const { error } = await supabase
        .from("workspaces")
        .update({ folder: folder.trim() })
        .eq("id", id);
      if (error) throw error;
      if (userId) await refreshWorkspaceList(userId);
    });
  };

  const renameFolder = async (from: string, to: string): Promise<void> => {
    await guarded(async () => {
      if (!userId) return;
      if (!manager().foldersSupported) throw new Error(FOLDERS_SETUP_HINT);
      const { error } = await supabase
        .from("workspaces")
        .update({ folder: to.trim() })
        .eq("owner_id", userId)
        .eq("folder", from);
      if (error) throw error;
      await refreshWorkspaceList(userId);
    });
  };

  const duplicateWorkspace = async (id: string): Promise<void> => {
    await guarded(async () => {
      const uid = userId;
      if (!uid) return;
      if (id === workspaceId && ready) {
        await uploadChain;
        await syncNow();
      }
      const source = manager().workspaces.find((w) => w.id === id);
      const [nodesResult, connectionsResult, strokesResult] = await Promise.all([
        supabase.from("workspace_nodes").select(NODE_COLUMNS).eq("workspace_id", id),
        supabase.from("workspace_connections").select(CONNECTION_COLUMNS).eq("workspace_id", id),
        supabase.from("workspaces").select("canvas_strokes").eq("id", id).maybeSingle(),
      ]);
      if (nodesResult.error) throw nodesResult.error;
      if (connectionsResult.error) throw connectionsResult.error;

      const insertRow: Record<string, unknown> = {
        owner_id: uid,
        name: (source?.name ?? "Espacio") + " (copia)",
      };
      if (source?.folder && manager().foldersSupported) insertRow.folder = source.folder;
      if (!strokesResult.error) {
        insertRow.canvas_strokes =
          (strokesResult.data as { canvas_strokes?: unknown } | null)?.canvas_strokes ?? [];
      }
      const { data: created, error: createError } = await supabase
        .from("workspaces")
        .insert(insertRow)
        .select("id")
        .single();
      if (createError) throw createError;
      const newId = (created as { id: string }).id;

      try {
        const nodeRows = (nodesResult.data ?? []) as unknown as NodeRow[];
        const newNodes: NodeRow[] = [];
        for (const row of nodeRows) {
          const copy: NodeRow = { ...row, workspace_id: newId, owner_id: uid };
          if (row.type === "file-node" && row.payload && typeof row.payload === "object") {
            const payload = { ...(row.payload as FileNodePayload) };
            if (payload.storagePath) {
              // Cada espacio tiene su propia copia: borrar un archivo en uno no rompe el otro.
              const oldPath = payload.storagePath;
              const prefix = uid + "/" + id + "/";
              const newPath = oldPath.startsWith(prefix)
                ? uid + "/" + newId + "/" + oldPath.slice(prefix.length)
                : uid +
                  "/" +
                  newId +
                  "/" +
                  safeStorageName(row.id) +
                  "/" +
                  safeStorageName(payload.fileName);
              const { error: copyError } = await supabase.storage
                .from(PRINT_FILES_BUCKET)
                .copy(oldPath, newPath);
              if (copyError) {
                delete payload.storagePath;
                payload.status = "error";
                payload.errorMessage = "No se pudo copiar este archivo. Vuelve a adjuntarlo.";
              } else {
                payload.storagePath = newPath;
              }
            }
            copy.payload = payload;
          }
          newNodes.push(copy);
        }
        if (newNodes.length > 0) {
          const { error } = await supabase.from("workspace_nodes").insert(newNodes);
          if (error) throw error;
        }
        const newConnections = ((connectionsResult.data ?? []) as unknown as ConnectionRow[]).map(
          (c) => ({ ...c, workspace_id: newId, owner_id: uid })
        );
        if (newConnections.length > 0) {
          const { error } = await supabase.from("workspace_connections").insert(newConnections);
          if (error) throw error;
        }
      } catch (error) {
        // Sin copia a medias: se borra el espacio recién creado.
        await supabase.from("workspaces").delete().eq("id", newId);
        throw error;
      }

      await refreshWorkspaceList(uid);
      manager().setMessage({ kind: "info", text: "Espacio duplicado." });
    });
  };

  const deleteWorkspace = async (id: string): Promise<void> => {
    await guarded(async () => {
      const uid = userId;
      if (!uid) return;

      // Si es el espacio abierto, primero se pasa a otro (o se crea uno en blanco).
      if (id === workspaceId) {
        const other = manager().workspaces.find((w) => w.id !== id);
        if (other) {
          await openWorkspaceRaw(other.id);
        } else {
          const { data, error } = await supabase
            .from("workspaces")
            .insert({ owner_id: uid, name: "Mi primer espacio" })
            .select("id")
            .single();
          if (error) throw error;
          await openWorkspaceRaw((data as { id: string }).id, {
            nodes: [],
            connections: [],
            strokes: [],
          });
        }
        if (workspaceId === id) throw new Error("No se pudo cambiar de espacio antes de borrar.");
      }

      // Archivos del bucket que solo usaba este espacio.
      const { data: fileRows } = await supabase
        .from("workspace_nodes")
        .select("payload")
        .eq("workspace_id", id)
        .eq("type", "file-node");
      const paths = ((fileRows ?? []) as { payload: FileNodePayload | null }[])
        .map((r) => r.payload?.storagePath)
        .filter((p): p is string => typeof p === "string" && p.length > 0);

      const { error } = await supabase.from("workspaces").delete().eq("id", id);
      if (error) throw error;
      if (paths.length > 0) void supabase.storage.from(PRINT_FILES_BUCKET).remove(paths);
      await refreshWorkspaceList(uid);
    });
  };

  // --------------------------------------------------------------------------
  // Sesión de Google
  // --------------------------------------------------------------------------

  const handleUser = (user: User | null) => {
    if (disposed) return;

    if (!user) {
      if (userId !== null) resetSession();
      cloud().setUser(null);
      cloud().setStatus("signed-out");
      return;
    }

    cloud().setUser(toCloudUser(user));
    if (user.id === userId) return;

    resetSession();
    userId = user.id;
    void loadWorkspace(user.id);
  };

  // Evento inicial + cambios de sesión. Se difiere con setTimeout porque
  // Supabase recomienda no llamar a la base de datos dentro de este callback.
  const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleUser(session?.user ?? null), 0);
  });

  // Cambios del lienzo → subida de archivos inmediata + guardado con debounce.
  const unsubscribeStore = useWorkspaceStore.subscribe((state, prev) => {
    if (
      state.nodes === prev.nodes &&
      state.connections === prev.connections &&
      state.canvasStrokes === prev.canvasStrokes
    ) {
      return;
    }
    // Cambio recibido de otro equipo de tu misma cuenta: ese equipo ya lo guarda.
    if (shouldSkipAutosaveForRemote()) return;
    queueUploads();
    scheduleSync();
  });

  // Si el usuario cambia de pestaña o cierra, se guarda sin esperar el debounce.
  const handleVisibility = () => {
    if (document.visibilityState === "hidden" && timer) void syncNow();
  };
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pagehide", handleVisibility);

  return {
    flush: async () => {
      if (ready) await syncNow();
    },
    pause: () => {
      resetSession();
    },
    suspendForCollabGuest: async () => {
      if (collabGuest || disposed) return;
      if (ready) {
        await uploadChain;
        await syncNow();
      }
      collabGuest = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    resumeAfterCollabGuest: async () => {
      if (!collabGuest || disposed) return;
      collabGuest = false;
      const uid = userId;
      const ownWorkspace = workspaceId;
      if (!uid) return;
      resetSession();
      userId = uid;
      await loadWorkspace(uid, ownWorkspace ? { workspaceId: ownWorkspace } : {});
    },
    openWorkspace: async (id, seed) => {
      await guarded(() => openWorkspaceRaw(id, seed));
    },
    refreshList: async () => {
      if (userId && !disposed) await refreshWorkspaceList(userId).catch(() => undefined);
    },
    consumeLink: async () => {
      const uid = userId;
      const id = pendingLinkWorkspaceId;
      // Sin sesión o sin lienzo cargado: lo abrirá `loadWorkspace` al entrar.
      if (!uid || !id || !ready || disposed) return;
      pendingLinkWorkspaceId = null;
      const list = await refreshWorkspaceList(uid).catch(() => [] as WorkspaceSummary[]);
      const ok =
        list.some((w) => w.id === id) ||
        useWorkspaceManagerStore.getState().sharedWorkspaces.some((w) => w.id === id);
      if (!ok) {
        useToastStore.getState().show({ message: NO_ACCESS_MESSAGE, tone: "error" });
        return;
      }
      await guarded(() => openWorkspaceRaw(id));
    },
    createWorkspace,
    renameWorkspace,
    moveWorkspace,
    renameFolder,
    duplicateWorkspace,
    deleteWorkspace,
    retryUpload: (nodeId: string) => {
      for (const key of [...failedUploads]) {
        if (key.startsWith(`${nodeId}|`)) failedUploads.delete(key);
      }
      cloud().setUploadError(nodeId, null);
      queueUploads();
    },
    stop: () => {
      disposed = true;
      resetSession();
      authListener.subscription.unsubscribe();
      unsubscribeStore();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handleVisibility);
    },
  };
}

// ----------------------------------------------------------------------------
// 3. Acciones públicas (las usa GoogleAuthButton)
// ----------------------------------------------------------------------------

type DesktopAuthBridge = NonNullable<AndrosDesktopBridge["auth"]>;

const DESKTOP_AUTH_NOTICE =
  "Termina el inicio de sesión en tu navegador. Andros se abrirá sola al terminar.";

/**
 * App de Windows: Google bloquea el login dentro de ventanas embebidas, así
 * que se abre en el navegador del sistema. La URL se genera AQUÍ (el
 * verificador PKCE queda en esta ventana) y el código vuelve por la app
 * (127.0.0.1) → `completeDesktopSignIn`.
 */
async function signInWithGoogleDesktop(supabase: SupabaseClient, auth: DesktopAuthBridge): Promise<void> {
  const cloud = useCloudStore.getState();
  cloud.setAuthNotice(null);
  try {
    const { port, state } = await auth.begin();
    const redirect = new URL("/auth/callback", window.location.origin);
    redirect.searchParams.set("desktop_port", String(port));
    redirect.searchParams.set("desktop_state", state);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirect.toString(),
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) throw error;
    if (!data.url) throw new Error("Supabase no devolvió la dirección de Google.");

    await auth.openInBrowser(data.url);
    useCloudStore.getState().setAuthNotice(DESKTOP_AUTH_NOTICE);
  } catch (error) {
    void auth.cancel().catch(() => undefined);
    cloud.setStatus("signed-out", `No se pudo abrir Google en tu navegador: ${describeError(error)}`);
  }
}

/** Código devuelto por el navegador del sistema → sesión de Supabase en esta ventana. */
async function completeDesktopSignIn(
  supabase: SupabaseClient,
  result: { code?: string; error?: string }
): Promise<void> {
  const cloud = useCloudStore.getState();
  cloud.setAuthNotice(null);
  if (!result.code) {
    cloud.setStatus(cloud.user ? cloud.status : "signed-out", `Inicio de sesión cancelado: ${result.error ?? "sin respuesta de Google"}`);
    return;
  }
  cloud.setStatus("connecting", null);
  const { data, error } = await supabase.auth.exchangeCodeForSession(result.code);
  if (error || !data.session) {
    useCloudStore
      .getState()
      .setStatus(
        "signed-out",
        `No se pudo completar el inicio de sesión con Google: ${error ? describeError(error) : "sin sesión"}`
      );
    return;
  }
  // Sesión activa en esta ventana: se sale de la portada al instante (aunque se
  // hubiera abierto a mano desde el logo); onAuthStateChange (SIGNED_IN) carga
  // el lienzo del usuario.
  useLandingStore.getState().skipToWorkspace();
}

/** Abre la ventana de Google. Al volver, /auth/callback crea la sesión. */
export async function signInWithGoogle(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const cloud = useCloudStore.getState();
  if (!supabase) return;

  const desktopAuth = getDesktopBridge()?.auth;
  if (desktopAuth) {
    await signInWithGoogleDesktop(supabase, desktopAuth);
    return;
  }

  cloud.setStatus("connecting", null);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    cloud.setStatus("signed-out", `No se pudo abrir Google: ${describeError(error)}`);
  }
}

/**
 * Guarda lo pendiente, cierra la sesión, deja el lienzo en blanco (así el
 * siguiente usuario de este equipo no ve los datos del anterior) y vuelve a
 * la portada, que es la entrada para quien no tiene sesión.
 */
export async function signOutFromCloud(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;

  await activeEngine?.flush();
  activeEngine?.pause();
  await supabase.auth.signOut();

  useWorkspaceStore.getState().hydrateWorkspace([], []);
  useWorkspaceStore.getState().hydrateCanvasStrokes([]);
  useCloudStore.getState().setUser(null);
  useWorkspaceManagerStore.getState().setWorkspaces([]);
  useCloudStore.getState().setStatus("signed-out", null);
  useLandingStore.getState().resetToLanding();
}

// Acciones del gestor de espacios (las usa WorkspaceManagerDrawer).
export const openCloudWorkspace = async (id: string, seed?: WorkspaceSeed): Promise<void> =>
  activeEngine?.openWorkspace(id, seed);
export const createCloudWorkspace = async (
  name: string,
  folder: string,
  seed?: WorkspaceSeed
): Promise<string | null> => (await activeEngine?.createWorkspace(name, folder, seed)) ?? null;
export const renameCloudWorkspace = async (id: string, name: string): Promise<void> =>
  activeEngine?.renameWorkspace(id, name);
export const moveCloudWorkspace = async (id: string, folder: string): Promise<void> =>
  activeEngine?.moveWorkspace(id, folder);
export const renameCloudFolder = async (from: string, to: string): Promise<void> =>
  activeEngine?.renameFolder(from, to);
export const duplicateCloudWorkspace = async (id: string): Promise<void> =>
  activeEngine?.duplicateWorkspace(id);
export const deleteCloudWorkspace = async (id: string): Promise<void> =>
  activeEngine?.deleteWorkspace(id);

/** Vuelve a leer «Mis espacios» y «Compartidos conmigo». */
export const refreshCloudWorkspaceList = async (): Promise<void> => activeEngine?.refreshList();

/**
 * Enlace `?espacio=<id>`: abre ese espacio si eres su dueño o miembro. Si aún
 * no hay sesión, queda pendiente y se abre al iniciar sesión.
 */
export function openWorkspaceFromLink(workspaceId: string): void {
  pendingLinkWorkspaceId = workspaceId;
  const status = useCloudStore.getState().status;
  if (status === "signed-out" || status === "disabled") {
    useToastStore.getState().show({
      message: "Inicia sesión con Google para abrir el espacio compartido.",
    });
  }
  void activeEngine?.consumeLink();
}

/** Sala en vivo: congela el autoguardado mientras ves el lienzo de otra cuenta. */
export const suspendCloudForCollabGuest = async (): Promise<void> =>
  activeEngine?.suspendForCollabGuest();
/** Sala en vivo: vuelve a tu propio espacio y reanuda el autoguardado. */
export const resumeCloudAfterCollabGuest = async (): Promise<void> =>
  activeEngine?.resumeAfterCollabGuest();

/** Reintenta subir a la nube el archivo de un nodo cuya subida falló. */
export function retryFileUpload(nodeId: string): void {
  activeEngine?.retryUpload(nodeId);
}

/**
 * Enlace temporal (1 hora) a un archivo guardado en la nube del usuario.
 * Sirve para que un programa de impresión 3D lo abra directamente.
 * Devuelve `null` si no hay sesión o el archivo no existe.
 */
export async function getCloudFileLink(storagePath: string): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !storagePath) return null;
  const { data, error } = await supabase.storage
    .from(PRINT_FILES_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

// ----------------------------------------------------------------------------
// 4. Hook
// ----------------------------------------------------------------------------

export function useCloudSync(): void {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      useCloudStore.getState().setStatus("disabled", null);
      return;
    }

    const engine = startCloudEngine(supabase);
    activeEngine = engine;
    // App de Windows: vuelta del login hecho en el navegador del sistema.
    const stopDesktopAuth = getDesktopBridge()?.auth?.onResult((result) => {
      void completeDesktopSignIn(supabase, result);
    });
    return () => {
      stopDesktopAuth?.();
      engine.stop();
      if (activeEngine === engine) activeEngine = null;
    };
  }, []);
}
