"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CloudCheck,
  CloudUpload,
  Database,
  Download,
  File as FileIcon,
  FileArchive,
  FileBox,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Film,
  LogIn,
  Printer,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FileEngineeringNode } from "@/types/workspace";
import {
  DEFAULT_FILE_NODE_TITLE,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  createEmptyFilePayload,
  revokeLocalFileUrl,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import { useCloudStore } from "@/store/useCloudStore";
import { retryFileUpload } from "@/hooks/useCloudSync";
import { takePendingFile } from "@/lib/canvas/quickAdd";
import { requestFileDownload } from "@/lib/downloadWithPermission";
import {
  Model3DPreview,
  isPreviewable3D,
  type ModelDimensions,
} from "@/components/nodes/Model3DPreview";
import { Print3DModal, isPrintable3D } from "@/components/nodes/Print3DModal";
import {
  isIdentityScale,
  normalizeScale,
  scaleDimensions,
  scaleKey,
  type ModelScale,
} from "@/lib/3d/modelScale";

/** Medidas (ya escaladas) redondeadas a centésimas de mm, como se guardan en el nodo. */
function roundedDimensions(dims: ModelDimensions): ModelDimensions {
  const round = (v: number) => Math.round(v * 100) / 100;
  return { widthMm: round(dims.widthMm), depthMm: round(dims.depthMm), heightMm: round(dims.heightMm) };
}

// ============================================================================
// NODO TIPO 1 — ARCHIVO DESCARGABLE UNIVERSAL
// Adjunta cualquier archivo de la computadora o del teléfono (hasta 50 MB por
// pieza; el archivo nunca se carga completo en memoria), muestra nombre,
// extensión y peso exacto, y lo descarga con un clic.
// ============================================================================

interface FileNodeViewProps {
  node: FileEngineeringNode;
  variant: "canvas" | "stack";
}

type FileKind =
  | "cad"
  | "document"
  | "archive"
  | "sheet"
  | "code"
  | "image"
  | "video"
  | "data"
  | "other";

const EXTENSIONS_BY_KIND: Record<Exclude<FileKind, "other">, string[]> = {
  cad: ["step", "stp", "stl", "iges", "igs", "dwg", "dxf", "obj", "3mf", "sldprt", "sldasm", "ipt", "iam", "f3d", "fbx", "ifc", "rvt", "x_t", "sat"],
  document: ["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "tex", "ppt", "pptx"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  sheet: ["csv", "tsv", "xls", "xlsx", "xlsm", "ods"],
  code: ["py", "m", "js", "ts", "tsx", "jsx", "c", "cpp", "h", "hpp", "ino", "json", "xml", "yaml", "yml", "html", "css", "ipynb", "gcode", "nc"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic"],
  video: ["mp4", "mov", "avi", "mkv", "webm"],
  data: ["h5", "hdf5", "mat", "parquet", "npy", "npz", "db", "sqlite", "dat", "bin"],
};

const KIND_LABELS: Record<FileKind, string> = {
  cad: "Modelo CAD / 3D",
  document: "Documento",
  archive: "Archivo comprimido",
  sheet: "Tabla de datos",
  code: "Código fuente",
  image: "Imagen",
  video: "Video",
  data: "Dataset",
  other: "Archivo",
};

function detectFileKind(extension: string, mimeType: string): FileKind {
  const kinds = Object.keys(EXTENSIONS_BY_KIND) as Exclude<FileKind, "other">[];
  for (const kind of kinds) {
    if (EXTENSIONS_BY_KIND[kind].includes(extension)) return kind;
  }
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("text/")) return "document";
  if (mimeType.startsWith("model/")) return "cad";
  return "other";
}

function renderKindIcon(kind: FileKind) {
  const iconClass = "w-5 h-5 text-andros-accent-ink";
  switch (kind) {
    case "cad":
      return <FileBox className={iconClass} />;
    case "document":
      return <FileText className={iconClass} />;
    case "archive":
      return <FileArchive className={iconClass} />;
    case "sheet":
      return <FileSpreadsheet className={iconClass} />;
    case "code":
      return <FileCode className={iconClass} />;
    case "image":
      return <FileImage className={iconClass} />;
    case "video":
      return <Film className={iconClass} />;
    case "data":
      return <Database className={iconClass} />;
    case "other":
      return <FileIcon className={iconClass} />;
  }
}

/** "ensamble.final.STEP" → "step". Sin extensión → "". */
function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function getBaseName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex <= 0 ? fileName : fileName.slice(0, dotIndex);
}

/** 18734592 → "18,734,592" (siempre igual en cualquier navegador). */
function formatExactBytes(bytes: number): string {
  return Math.round(bytes)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 18734592 → "17.87 MB" (base 1024, como el Explorador de Windows). */
function formatReadableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

// --- Lectura por fragmentos con suma de verificación CRC-32 -----------------

const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB por fragmento

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function updateCrc32(crc: number, bytes: Uint8Array): number {
  const table = getCrcTable();
  let c = crc;
  for (let i = 0; i < bytes.length; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

/**
 * Trabajo de lectura vigente por nodo. Si el usuario adjunta otro archivo (o
 * quita el actual) mientras uno se está leyendo, el trabajo anterior se detiene.
 */
const activeJobByNode = new Map<string, number>();
let jobCounter = 0;

export const FileNodeView: React.FC<FileNodeViewProps> = ({ node, variant }) => {
  const updateNodePayload = useWorkspaceStore((s) => s.updateNodePayload);
  const updateNodeMeta = useWorkspaceStore((s) => s.updateNodeMeta);

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const file = node.fileData;
  const kind = detectFileKind(file.extension, file.mimeType);
  const hasFile = file.status !== "empty";

  // --- Nube, visor 3D e impresión -------------------------------------------
  const isSignedIn = useCloudStore((s) => s.user !== null);
  const cloudUploadError = useCloudStore((s) => s.uploadErrors[node.id]);

  const [isPrintOpen, setIsPrintOpen] = useState(false);
  /** Aviso cuando se intenta adjuntar un archivo por encima del límite. */
  const [sizeNotice, setSizeNotice] = useState<string | null>(null);
  const [measured, setMeasured] = useState<{ url: string; dimensions: ModelDimensions } | null>(
    null
  );

  const isReady = file.status === "ready" && file.downloadUrl !== "";
  const canPreview3D = isReady && isPreviewable3D(file.extension);
  const canPrint3D = isReady && isPrintable3D(file.extension);
  const isCloudWorthy = canPrint3D || file.extension === "pdf";
  const isLocalOnly = file.downloadUrl.startsWith("blob:") && !file.storagePath;
  const dimensions = measured?.url === file.downloadUrl ? measured.dimensions : null;
  const modelScale = normalizeScale(file.scale);
  const supportsEnabled = file.autoSupports ?? false;

  /**
   * Guarda en el nodo las medidas YA escaladas: los CodeLab (model_x/y/z) y el
   * chat IA conectados las leen del grafo y se actualizan al instante.
   */
  const storeScaledDimensions = (base: ModelDimensions, scale: ModelScale, patchScale: boolean) => {
    const next = roundedDimensions(scaleDimensions(base, scale));
    const prev = useWorkspaceStore.getState().nodes.find((n) => n.id === node.id);
    const prevData = prev?.type === "file-node" ? prev.fileData : undefined;
    const stored = prevData?.modelDimensionsMm;
    const sameDims =
      !!stored &&
      stored.widthMm === next.widthMm &&
      stored.depthMm === next.depthMm &&
      stored.heightMm === next.heightMm;
    const sameScale = scaleKey(normalizeScale(prevData?.scale)) === scaleKey(scale);
    // Solo se versiona un cambio real: así el grafo no se re-renderiza en vano.
    const contentVersion = (prevData?.contentVersion ?? 0) + 1;
    if (patchScale) {
      if (sameDims && sameScale) return;
      updateNodePayload(node.id, {
        scale: isIdentityScale(scale) ? undefined : scale,
        ...(sameDims ? {} : { modelDimensionsMm: next }),
        contentVersion,
      });
    } else if (!sameDims) {
      updateNodePayload(node.id, { modelDimensionsMm: next, contentVersion });
    }
  };

  const openFilePicker = () => inputRef.current?.click();

  const attachFile = async (selected: File) => {
    // Límite por pieza: se avisa ANTES de leer o subir nada, y el archivo que
    // ya tuviera el nodo se conserva intacto.
    if (selected.size > MAX_FILE_SIZE_BYTES) {
      setSizeNotice(
        `"${selected.name}" pesa ${formatReadableSize(selected.size)}. El límite actual por pieza es de ${MAX_FILE_SIZE_LABEL}, así que no se adjuntó. Prueba con una versión más ligera del archivo (por ejemplo, exportando el modelo con menos detalle).`
      );
      return;
    }
    setSizeNotice(null);

    jobCounter += 1;
    const jobId = jobCounter;
    activeJobByNode.set(node.id, jobId);
    const isCurrentJob = () => activeJobByNode.get(node.id) === jobId;

    // 1. Liberar el archivo local anterior (si lo había) y enlazar el nuevo.
    //    `createObjectURL` es instantáneo y no copia el archivo a memoria,
    //    por eso adjuntar es inmediato incluso con piezas pesadas.
    revokeLocalFileUrl(file.downloadUrl);
    const extension = getExtension(selected.name);
    const downloadUrl = URL.createObjectURL(selected);

    updateNodePayload(node.id, {
      fileName: selected.name,
      extension,
      fileSizeBytes: selected.size,
      mimeType: selected.type || "application/octet-stream",
      downloadUrl,
      status: "uploading",
      uploadProgress: 0,
      checksum: undefined,
      errorMessage: undefined,
      lastModifiedMs: selected.lastModified,
      // Archivo nuevo: `useCloudSync` lo subirá y escribirá su nueva ruta.
      storagePath: undefined,
      // Las dimensiones 3D se volverán a medir con la pieza nueva.
      modelDimensionsMm: undefined,
      // Pieza nueva: vuelve al 100 %.
      scale: undefined,
    });

    updateNodeMeta(node.id, {
      codeTag: extension ? extension.toUpperCase().slice(0, 8) : "FILE",
      ...(node.title === DEFAULT_FILE_NODE_TITLE || node.title === getBaseName(file.fileName)
        ? { title: getBaseName(selected.name) }
        : {}),
    });

    // 2. Leer el archivo por fragmentos de 8 MB: alimenta la barra de estado
    //    con progreso real y calcula la suma de verificación CRC-32.
    try {
      let crc = 0xffffffff;
      let offset = 0;
      let lastReportedProgress = 0;

      while (offset < selected.size) {
        const end = Math.min(offset + CHUNK_SIZE_BYTES, selected.size);
        const chunk = new Uint8Array(await selected.slice(offset, end).arrayBuffer());
        if (!isCurrentJob()) return;

        crc = updateCrc32(crc, chunk);
        offset = end;

        const progress = Math.floor((offset / selected.size) * 100);
        if (progress !== lastReportedProgress && progress < 100) {
          lastReportedProgress = progress;
          updateNodePayload(node.id, { uploadProgress: progress });
        }
      }

      if (!isCurrentJob()) return;
      const checksum = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
      updateNodePayload(node.id, {
        status: "ready",
        uploadProgress: 100,
        checksum: `crc32:${checksum}`,
      });
    } catch {
      if (!isCurrentJob()) return;
      updateNodePayload(node.id, {
        status: "error",
        errorMessage:
          "No se pudo leer el archivo completo. Comprueba que siga disponible en tu dispositivo e inténtalo de nuevo.",
      });
    } finally {
      if (isCurrentJob()) activeJobByNode.delete(node.id);
    }
  };

  // Archivo elegido desde "+ Agregar → Archivo 3D": se adjunta al aparecer el nodo.
  useEffect(() => {
    const pending = takePendingFile(node.id);
    if (pending) void Promise.resolve().then(() => attachFile(pending));
    // Solo al montar el nodo: `attachFile` usa el estado de ese momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    // Permite volver a elegir el mismo archivo más adelante.
    e.target.value = "";
    if (selected) void attachFile(selected);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) void attachFile(dropped);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleRemoveFile = () => {
    activeJobByNode.delete(node.id);
    revokeLocalFileUrl(file.downloadUrl);
    updateNodePayload(node.id, {
      ...createEmptyFilePayload(),
      checksum: undefined,
      errorMessage: undefined,
      lastModifiedMs: undefined,
      storagePath: undefined,
      modelDimensionsMm: undefined,
      scale: undefined,
      autoSupports: undefined,
    });
    updateNodeMeta(node.id, {
      codeTag: "FILE",
      // Si el título era el nombre del archivo, vuelve al título por defecto.
      ...(node.title === getBaseName(file.fileName)
        ? { title: DEFAULT_FILE_NODE_TITLE }
        : {}),
    });
  };

  const touchTarget = variant === "stack" ? "min-h-[44px]" : "min-h-[34px]";

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`py-3 rounded-xl spring-micro ${
        isDragOver ? "ring-2 ring-andros-accent/60 bg-andros-accent/5" : ""
      }`}
    >
      {/* Selector nativo: sin `accept` (cualquier formato) */}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleInputChange}
        aria-label="Adjuntar archivo"
      />

      {sizeNotice && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 flex items-start gap-2"
        >
          <CircleAlert className="w-4 h-4 shrink-0 mt-0.5 text-andros-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-andros-danger">
              Archivo demasiado pesado (máximo {MAX_FILE_SIZE_LABEL})
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-andros-primary break-words">
              {sizeNotice}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSizeNotice(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 min-w-[28px] min-h-[28px] rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!hasFile ? (
        /* ------------------------------------------------------------------
           ESTADO VACÍO — Zona para adjuntar
           ------------------------------------------------------------------ */
        <button
          type="button"
          onClick={openFilePicker}
          className={`w-full px-4 py-5 rounded-xl border border-dashed flex flex-col items-center gap-2 text-center spring-micro active:scale-98 ${
            isDragOver
              ? "border-andros-accent bg-andros-accent/10"
              : "border-andros-border-active bg-andros-canvas hover:border-andros-accent"
          }`}
        >
          <div className="p-2 rounded-lg bg-andros-accent/10 text-andros-accent-ink">
            <Upload className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold text-andros-primary">
            {variant === "stack" ? "Toca para adjuntar un archivo" : "Adjuntar archivo"}
          </span>
          <span className="text-[11px] leading-relaxed text-andros-muted">
            {variant === "stack"
              ? `Cualquier formato · hasta ${MAX_FILE_SIZE_LABEL} por pieza`
              : `Haz clic o arrastra aquí · cualquier formato · hasta ${MAX_FILE_SIZE_LABEL} por pieza`}
          </span>
        </button>
      ) : (
        /* ------------------------------------------------------------------
           ARCHIVO ADJUNTO — Ficha, barra de estado y acciones
           ------------------------------------------------------------------ */
        <div className="space-y-3">
          {/* Ficha del archivo */}
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-11 h-11 rounded-xl bg-andros-accent/10 flex items-center justify-center">
              {renderKindIcon(kind)}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-xs font-semibold text-andros-primary truncate"
                title={file.fileName}
              >
                {file.fileName}
              </p>
              <div className="mt-1 flex items-center gap-1.5 min-w-0">
                <span className="shrink-0 text-[10px] font-mono font-semibold uppercase tabular-nums bg-andros-accent/10 text-andros-accent-ink px-1.5 py-0.5 rounded">
                  {file.extension ? `.${file.extension}` : "sin ext."}
                </span>
                <span className="text-[11px] text-andros-muted truncate">
                  {KIND_LABELS[kind]}
                </span>
              </div>
            </div>
          </div>

          {/* Visor 3D de solo lectura (.stl / .obj / .3mf) */}
          {canPreview3D && (
            <Model3DPreview
              key={file.downloadUrl}
              url={file.downloadUrl}
              extension={file.extension}
              fileSizeBytes={file.fileSizeBytes}
              variant={variant}
              pieceName={node.title || file.fileName}
              scale={modelScale}
              supportsEnabled={supportsEnabled}
              onSupportsChange={(enabled) =>
                updateNodePayload(node.id, { autoSupports: enabled || undefined })
              }
              onDimensions={(dims) => {
                setMeasured({ url: file.downloadUrl, dimensions: dims });
                // Se guardan en el nodo (y en la nube) para que el Oráculo IA
                // conozca el tamaño de la pieza con su escala. Solo si cambiaron.
                const prev = useWorkspaceStore.getState().nodes.find((n) => n.id === node.id);
                const storedScale = normalizeScale(
                  prev?.type === "file-node" ? prev.fileData.scale : undefined
                );
                storeScaledDimensions(dims, storedScale, false);
              }}
              onScaleChange={(next) => {
                if (dimensions) storeScaledDimensions(dimensions, next, true);
                else updateNodePayload(node.id, { scale: isIdentityScale(next) ? undefined : next });
              }}
            />
          )}

          {/* Telemetría tabular del archivo */}
          <div className="space-y-1.5 text-xs font-mono tabular-telemetry tabular-nums">
            <div className="flex justify-between items-baseline gap-3">
              <span className="text-andros-muted">Peso:</span>
              <span className="text-andros-primary font-semibold">
                {formatReadableSize(file.fileSizeBytes)}
              </span>
            </div>
            <div className="flex justify-between items-baseline gap-3">
              <span className="text-andros-muted">Exacto:</span>
              <span className="text-andros-primary">
                {formatExactBytes(file.fileSizeBytes)} bytes
              </span>
            </div>
            <div className="flex justify-between items-baseline gap-3">
              <span className="text-andros-muted shrink-0">Tipo:</span>
              <span className="text-andros-primary truncate" title={file.mimeType}>
                {file.mimeType || "desconocido"}
              </span>
            </div>
            {file.checksum && (
              <div className="flex justify-between items-baseline gap-3">
                <span className="text-andros-muted">Verif.:</span>
                <span className="text-andros-primary">{file.checksum}</span>
              </div>
            )}
          </div>

          {/* Barra de estado */}
          <div className="space-y-1.5" role="status" aria-live="polite">
            <div className="h-1.5 w-full rounded-full bg-andros-border overflow-hidden">
              <div
                className={`h-full rounded-full spring-micro ${
                  file.status === "error"
                    ? "bg-red-500"
                    : file.status === "ready"
                      ? "bg-andros-success"
                      : "bg-andros-accent-fill"
                }`}
                style={{
                  width: `${file.status === "error" ? 100 : file.uploadProgress}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-telemetry tabular-nums">
              {file.status === "uploading" && (
                <>
                  <span className="text-andros-accent-ink">● LEYENDO POR FRAGMENTOS</span>
                  <span className="text-andros-primary">{file.uploadProgress}%</span>
                </>
              )}
              {file.status === "ready" && (
                <>
                  <span className="text-andros-success">● LISTO PARA DESCARGAR</span>
                  <span className="text-andros-muted">100%</span>
                </>
              )}
              {file.status === "error" && (
                <span className="text-andros-danger flex items-start gap-1.5 font-sans text-[11px] leading-relaxed">
                  <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{file.errorMessage || "Ocurrió un error con este archivo."}</span>
                </span>
              )}
            </div>
          </div>

          {/* Estado del guardado en la nube del usuario */}
          {isReady && !isSignedIn && isLocalOnly && (
            <p className="flex items-start gap-2 rounded-xl bg-andros-accent/5 border border-andros-border px-3 py-2 text-[11px] leading-relaxed text-andros-muted">
              <LogIn className="w-3.5 h-3.5 shrink-0 mt-0.5 text-andros-accent-ink" />
              <span>
                {isCloudWorthy && file.extension !== "pdf"
                  ? "Inicia sesión con Google arriba para guardar este archivo 3D en tu nube"
                  : "Inicia sesión con Google arriba para guardar este archivo en tu nube"}
              </span>
            </p>
          )}
          {isReady && isSignedIn && file.storagePath && (
            <p className="flex items-center gap-2 text-[11px] text-andros-success">
              <CloudCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Guardado en tu nube · disponible en cualquier dispositivo</span>
            </p>
          )}
          {isReady && isSignedIn && isLocalOnly && !cloudUploadError && (
            <p className="flex items-center gap-2 text-[11px] text-andros-muted" role="status">
              <CloudUpload className="w-3.5 h-3.5 shrink-0 text-andros-accent-ink animate-pulse" />
              <span>Guardando en tu nube…</span>
            </p>
          )}
          {isReady && isSignedIn && isLocalOnly && cloudUploadError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 space-y-1.5">
              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-andros-danger">
                <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  No se pudo guardar en tu nube ({cloudUploadError}). El archivo sigue
                  disponible solo en este dispositivo.
                </span>
              </p>
              <button
                type="button"
                onClick={() => retryFileUpload(node.id)}
                className={`${touchTarget} px-3 rounded-lg bg-andros-border/50 hover:bg-andros-border text-andros-primary text-[11px] font-medium flex items-center gap-1.5 active:scale-95 spring-micro`}
              >
                <RefreshCw className="w-3.5 h-3.5 text-andros-accent-ink" />
                <span>Reintentar</span>
              </button>
            </div>
          )}

          {/* Acción principal: asistente de impresión 3D */}
          {canPrint3D && (
            <button
              type="button"
              onClick={() => setIsPrintOpen(true)}
              className="w-full min-h-[44px] px-3 rounded-xl bg-andros-accent-fill text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] spring-micro"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir en 3D</span>
            </button>
          )}

          {/* Acciones */}
          <div className="flex items-center gap-2">
            {file.status === "ready" ? (
              <button
                type="button"
                onClick={() =>
                  void requestFileDownload({
                    filename: file.fileName || `archivo.${file.extension || "bin"}`,
                    blobOrUrl: file.downloadUrl,
                    sizeBytes: file.fileSizeBytes,
                    mimeType: file.mimeType,
                    description: `Archivo del nodo "${node.title}".`,
                  })
                }
                className={`flex-1 ${touchTarget} px-3 rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 active:scale-95 spring-micro`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar</span>
              </button>
            ) : (
              <span
                className={`flex-1 ${touchTarget} px-3 rounded-xl bg-andros-border/50 text-andros-muted text-xs font-semibold flex items-center justify-center gap-1.5 cursor-not-allowed`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>{file.status === "uploading" ? "Preparando…" : "Descargar"}</span>
              </span>
            )}

            <button
              type="button"
              onClick={openFilePicker}
              title="Reemplazar por otro archivo"
              aria-label="Reemplazar por otro archivo"
              className={`${touchTarget} px-3 rounded-xl bg-andros-border/50 hover:bg-andros-border text-andros-primary text-xs font-medium flex items-center justify-center gap-1.5 active:scale-95 spring-micro`}
            >
              <RefreshCw className="w-3.5 h-3.5 text-andros-accent-ink" />
              <span>Reemplazar</span>
            </button>

            <button
              type="button"
              onClick={handleRemoveFile}
              title="Quitar archivo del nodo"
              aria-label="Quitar archivo del nodo"
              className={`${touchTarget} px-2.5 rounded-xl bg-andros-border/50 hover:bg-andros-border text-andros-muted hover:text-andros-danger flex items-center justify-center active:scale-95 spring-micro`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {isPrintOpen && canPrint3D && (
        <Print3DModal
          pieceName={node.title}
          fileName={file.fileName}
          extension={file.extension}
          downloadUrl={file.downloadUrl}
          storagePath={file.storagePath}
          dimensions={dimensions}
          scale={modelScale}
          supportsEnabled={supportsEnabled}
          onSupportsChange={(enabled) =>
            updateNodePayload(node.id, { autoSupports: enabled || undefined })
          }
          onClose={() => setIsPrintOpen(false)}
        />
      )}
    </div>
  );
};
