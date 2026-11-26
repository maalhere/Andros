// ============================================================================
// ANDROS — DESCARGAS CON PERMISO
//
// Ningún archivo se guarda en el equipo sin que el usuario lo autorice:
//   requestFileDownload({ filename, blobOrUrl, sizeBytes, description })
// abre el modal global (DownloadPermissionModal) con nombre, tipo y peso, y
// solo al pulsar "Permitir y descargar" se inicia la descarga. Devuelve
// `true` si se inició y `false` si el usuario canceló.
//
// En la app de Windows, después aparece además el diálogo nativo
// "Guardar como…" (electron/main.cjs) para elegir la carpeta.
// ============================================================================

import { create } from "zustand";

export type DownloadSource = Blob | Uint8Array<ArrayBuffer> | ArrayBuffer | string;

export interface FileDownloadRequest {
  /** Nombre con el que se guardará (ej. `ANDROS_ADV3_pieza.gx`). */
  filename: string;
  /** Contenido ya generado o URL (`blob:`, `data:`, `https:`). */
  blobOrUrl: DownloadSource;
  /** Peso en bytes si se conoce (para URLs; en blobs se calcula solo). */
  sizeBytes?: number | null;
  /** Frase corta para el usuario: qué es este archivo. */
  description?: string;
  /** Tipo MIME para el contenido binario (por defecto application/octet-stream). */
  mimeType?: string;
}

export interface PendingDownload {
  id: number;
  filename: string;
  description: string | null;
  /** `null` = desconocido (el modal intenta estimarlo). */
  sizeBytes: number | null;
  typeLabel: string;
  extension: string;
  /** "Generado en Andros" o el dominio de origen. */
  origin: string;
  source: Blob | string;
  phase: "asking" | "starting";
  resolve: (started: boolean) => void;
}

interface DownloadPermissionState {
  queue: PendingDownload[];
  /** Hay un modal montado que puede preguntar. Sin él se usa `window.confirm`. */
  modalMounted: number;
  setModalMounted: (delta: 1 | -1) => void;
  enqueue: (item: PendingDownload) => void;
  patch: (id: number, patch: Partial<Pick<PendingDownload, "sizeBytes" | "phase">>) => void;
  remove: (id: number) => void;
}

export const useDownloadPermissionStore = create<DownloadPermissionState>((set) => ({
  queue: [],
  modalMounted: 0,
  setModalMounted: (delta) => set((s) => ({ modalMounted: Math.max(0, s.modalMounted + delta) })),
  enqueue: (item) => set((s) => ({ queue: [...s.queue, item] })),
  patch: (id, patch) => set((s) => ({ queue: s.queue.map((q) => (q.id === id ? { ...q, ...patch } : q)) })),
  remove: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
}));

// ----------------------------------------------------------------------------
// Utilidades de presentación
// ----------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  "andros.zip": "Paquete de espacio Andros",
  gx: "Archivo de impresión FlashForge", // brand-ok: formato .gx propio de esa impresora (Modo Experto)
  gcode: "G-code de impresión 3D",
  stl: "Modelo 3D STL",
  obj: "Modelo 3D OBJ",
  "3mf": "Proyecto de impresión 3MF",
  step: "Modelo CAD STEP",
  stp: "Modelo CAD STEP",
  json: "Respaldo de datos JSON",
  zip: "Archivo comprimido ZIP",
  exe: "Instalador de Windows",
  pdf: "Documento PDF",
  csv: "Tabla CSV",
  md: "Nota Markdown",
  txt: "Texto plano",
  png: "Imagen PNG",
  jpg: "Imagen JPEG",
  jpeg: "Imagen JPEG",
  svg: "Imagen SVG",
};

/** Extensión "lógica": `pieza.andros.zip` → `andros.zip`, `pieza.gx` → `gx`. */
export function fileExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".andros.zip")) return "andros.zip";
  const dot = lower.lastIndexOf(".");
  return dot > 0 && dot < lower.length - 1 ? lower.slice(dot + 1) : "";
}

export function describeFileType(filename: string, mimeType?: string): string {
  const ext = fileExtension(filename);
  const label = TYPE_LABELS[ext];
  if (label) return `${label} (.${ext})`;
  if (ext) return `Archivo .${ext.toUpperCase()}`;
  return mimeType && mimeType !== "application/octet-stream" ? mimeType : "Archivo";
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "Desconocido";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function describeOrigin(source: Blob | string): string {
  if (typeof source !== "string" || /^(blob|data):/i.test(source)) return "Generado en Andros (este equipo)";
  try {
    const url = new URL(source, window.location.href);
    return url.origin === window.location.origin ? "Andros" : url.hostname;
  } catch {
    return "Desconocido";
  }
}

// ----------------------------------------------------------------------------
// Descarga real (solo tras el permiso)
// ----------------------------------------------------------------------------

function clickAnchor(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  clickAnchor(href, filename);
  // Margen amplio: en Electron el diálogo "Guardar como…" puede seguir abierto.
  window.setTimeout(() => URL.revokeObjectURL(href), 120_000);
}

/**
 * Inicia la descarga. Las URLs remotas se leen primero en memoria para
 * respetar el nombre del archivo (y que Electron muestre "Guardar como…");
 * si el servidor no lo permite (CORS), se usa el enlace directo.
 */
async function performDownload(source: Blob | string, filename: string): Promise<void> {
  if (typeof source !== "string") {
    saveBlob(source, filename);
    return;
  }
  if (/^(blob|data):/i.test(source)) {
    clickAnchor(source, filename);
    return;
  }
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(String(response.status));
    saveBlob(await response.blob(), filename);
  } catch {
    clickAnchor(source, filename);
  }
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

let nextId = 1;

function toSource(data: DownloadSource, mimeType?: string): Blob | string {
  if (typeof data === "string" || data instanceof Blob) return data;
  return new Blob([data], { type: mimeType || "application/octet-stream" });
}

/**
 * Pide permiso y, si el usuario acepta, descarga el archivo.
 * @returns `true` si la descarga se inició; `false` si se canceló.
 */
export function requestFileDownload(request: FileDownloadRequest): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);

  const filename = request.filename.trim() || "descarga";
  const source = toSource(request.blobOrUrl, request.mimeType);
  const sizeBytes =
    typeof request.sizeBytes === "number" && request.sizeBytes >= 0
      ? request.sizeBytes
      : source instanceof Blob
        ? source.size
        : null;
  const mime = request.mimeType ?? (source instanceof Blob ? source.type : undefined);
  const store = useDownloadPermissionStore.getState();

  // Sin modal montado (no debería pasar): confirmación nativa del navegador.
  if (store.modalMounted === 0) {
    const ok = window.confirm(
      `¿Permitir la descarga de "${filename}"?\n${describeFileType(filename, mime)} · ${formatBytes(sizeBytes)}`
    );
    if (!ok) return Promise.resolve(false);
    return performDownload(source, filename).then(() => true);
  }

  return new Promise<boolean>((resolve) => {
    store.enqueue({
      id: nextId++,
      filename,
      description: request.description?.trim() || null,
      sizeBytes,
      typeLabel: describeFileType(filename, mime),
      extension: fileExtension(filename),
      origin: describeOrigin(source),
      source,
      phase: "asking",
      resolve,
    });
  });
}

/** "Permitir y descargar" (llamar desde el clic, para conservar el gesto del usuario). */
export function approveDownload(id: number): void {
  const store = useDownloadPermissionStore.getState();
  const item = store.queue.find((q) => q.id === id);
  if (!item || item.phase !== "asking") return;
  store.patch(id, { phase: "starting" });
  void performDownload(item.source, item.filename)
    .then(() => item.resolve(true))
    .catch(() => item.resolve(false))
    .finally(() => useDownloadPermissionStore.getState().remove(id));
}

/** "Cancelar": no se descarga nada. */
export function declineDownload(id: number): void {
  const store = useDownloadPermissionStore.getState();
  const item = store.queue.find((q) => q.id === id);
  if (!item || item.phase !== "asking") return;
  store.remove(id);
  item.resolve(false);
}

/** El modal intenta averiguar el peso de una URL sin descargarla (HEAD). */
export async function estimateRemoteSize(source: string, signal: AbortSignal): Promise<number | null> {
  try {
    if (/^blob:/i.test(source)) {
      const blob = await (await fetch(source, { signal })).blob();
      return blob.size;
    }
    if (/^data:/i.test(source)) {
      const comma = source.indexOf(",");
      const body = source.slice(comma + 1);
      return /;base64,/i.test(source.slice(0, comma + 1))
        ? Math.floor((body.length * 3) / 4)
        : decodeURIComponent(body).length;
    }
    const response = await fetch(source, { method: "HEAD", signal });
    const length = Number(response.headers.get("content-length"));
    return response.ok && Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}
