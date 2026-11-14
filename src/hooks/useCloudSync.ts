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
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, PRINT_FILES_BUCKET } from "@/lib/supabase/client";
import { useCloudStore, type CloudUser } from "@/store/useCloudStore";
import {
  createEmptyCalcLatexPayload,
  createEmptyFilePayload,
  createEmptySketchNotePayload,
  INITIAL_CONNECTIONS,
  INITIAL_NODES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import type {
  CalcLatexPayload,
  EngineeringNodeBase,
  EngineeringNodeData,
  FileNodePayload,
  NodeArchetype,
  NodeConnection,
  PortPosition,
  SketchNotePayload,
  TelemetryMetric,
} from "@/types/workspace";

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
  };
}

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
        : node.calcLatexData;

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
  stop: () => void;
  /** Vuelve a intentar la subida fallida del archivo de un nodo. */
  retryUpload: (nodeId: string) => void;
}

let activeEngine: CloudEngine | null = null;

function startCloudEngine(supabase: SupabaseClient): CloudEngine {
  const cloud = useCloudStore.getState;

  let disposed = false;
  /** Cambia con cada inicio/cierre de sesión: invalida respuestas viejas. */
  let epoch = 0;
  let userId: string | null = null;
  let workspaceId: string | null = null;
  let ready = false;

  let nodeSnapshot = new Map<string, string>();
  let connectionSnapshot = new Map<string, string>();
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
    nodeSnapshot = new Map();
    connectionSnapshot = new Map();
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
    if (!ready || !userId || !workspaceId || disposed) return;
    const ep = epoch;
    const ws = workspaceId;
    const uid = userId;

    const { nodes, connections } = useWorkspaceStore.getState();
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
      removedConnectionIds.length === 0;

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
        if (error) throw error;
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
    if (!ready || disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncNow();
    }, SAVE_DEBOUNCE_MS);
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
    if (!ready || disposed) return;
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

  const loadWorkspace = async (uid: string) => {
    const ep = epoch;
    cloud().setStatus("loading", null);

    try {
      // 1. Primer workspace del usuario (o uno nuevo).
      const { data: existing, error: wsError } = await supabase
        .from("workspaces")
        .select("id")
        .eq("owner_id", uid)
        .order("created_at", { ascending: true })
        .limit(1);
      if (wsError) throw wsError;

      let wsId = (existing?.[0] as { id: string } | undefined)?.id ?? null;
      if (!wsId) {
        const { data: created, error: createError } = await supabase
          .from("workspaces")
          .insert({ owner_id: uid })
          .select("id")
          .single();
        if (createError) throw createError;
        wsId = (created as { id: string }).id;
      }

      // 2. Nodos y cables guardados.
      const [nodesResult, connectionsResult] = await Promise.all([
        supabase
          .from("workspace_nodes")
          .select(NODE_COLUMNS)
          .eq("workspace_id", wsId)
          .order("sort_order", { ascending: false }),
        supabase.from("workspace_connections").select(CONNECTION_COLUMNS).eq("workspace_id", wsId),
      ]);
      if (nodesResult.error) throw nodesResult.error;
      if (connectionsResult.error) throw connectionsResult.error;
      if (ep !== epoch || disposed) return;

      workspaceId = wsId;
      cloud().setWorkspaceId(wsId);

      const nodeRows = (nodesResult.data ?? []) as unknown as NodeRow[];
      const connectionRows = (connectionsResult.data ?? []) as unknown as ConnectionRow[];

      if (nodeRows.length === 0 && connectionRows.length === 0) {
        // Primera vez: el lienzo local actual se convierte en el lienzo en la nube.
        nodeSnapshot = new Map();
        connectionSnapshot = new Map();
        syncedStoragePaths = new Set();
        ready = true;
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
        const normalized = nodeToRow(node, Number(row.sort_order) || 0, wsId, uid);
        nodeSnapshot.set(row.id, JSON.stringify(normalized));
      }
      connectionSnapshot = new Map(
        loadedConnections.map((c) => [c.id, JSON.stringify(connectionToRow(c, wsId, uid))])
      );
      syncedStoragePaths = storagePathsOf(loadedNodes);

      ready = true;
      useWorkspaceStore.getState().hydrateWorkspace(loadedNodes, loadedConnections);
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
    if (state.nodes === prev.nodes && state.connections === prev.connections) return;
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

/** Abre la ventana de Google. Al volver, /auth/callback crea la sesión. */
export async function signInWithGoogle(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const cloud = useCloudStore.getState();
  if (!supabase) return;

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
 * Guarda lo pendiente, cierra la sesión y deja el lienzo de demostración
 * (así el siguiente usuario de este equipo no ve los datos del anterior).
 */
export async function signOutFromCloud(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;

  await activeEngine?.flush();
  activeEngine?.pause();
  await supabase.auth.signOut();

  useWorkspaceStore.getState().hydrateWorkspace(INITIAL_NODES, INITIAL_CONNECTIONS);
  useCloudStore.getState().setUser(null);
  useCloudStore.getState().setStatus("signed-out", null);
}

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
    return () => {
      engine.stop();
      if (activeEngine === engine) activeEngine = null;
    };
  }, []);
}
