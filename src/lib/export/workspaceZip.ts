import JSZip from "jszip";
import {
  createCloudWorkspace,
  parseImportedConnection,
  parseImportedNode,
  type WorkspaceSeed,
} from "@/hooks/useCloudSync";
import { sanitizeCanvasStrokes } from "@/lib/canvas/inkGeometry";
import { useCloudStore } from "@/store/useCloudStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import type { EngineeringNodeData, FileNodePayload } from "@/types/workspace";

// ============================================================================
// ANDROS — PAQUETE PORTABLE `.andros.zip`
//
//   proyecto.andros.zip
//   ├─ workspace.json     nodos, conexiones, trazos de tinta y configuración
//   ├─ modelos-3d/        piezas .stl / .obj / .3mf
//   ├─ archivos/          el resto de archivos adjuntos (PDF, STEP, imágenes…)
//   └─ notas/             cada cuaderno en Markdown (legible fuera de Andros)
//
// `workspace.json` es la fuente de verdad al importar; `notas/` es una copia
// legible. Los enlaces temporales (blob: / firmados) nunca se guardan.
// ============================================================================

export const WORKSPACE_ZIP_FORMAT = "andros.workspace";
export const WORKSPACE_ZIP_VERSION = 1;
export const WORKSPACE_ZIP_EXTENSION = ".andros.zip";

const MODEL_3D_EXTENSIONS = new Set(["stl", "obj", "3mf"]);

interface WorkspaceJson {
  format: typeof WORKSPACE_ZIP_FORMAT;
  version: number;
  exportedAt: string;
  name: string;
  settings: { snapToGrid: boolean; cableStyle: string; canvasBackground: string };
  nodes: EngineeringNodeData[];
  connections: unknown[];
  canvasStrokes: unknown[];
  /** id del nodo → ruta del archivo dentro del zip. */
  files: Record<string, string>;
  notes: Record<string, string>;
}

export interface ExportResult {
  fileName: string;
  fileCount: number;
  noteCount: number;
  /** Archivos que no se pudieron descargar (quedan fuera del paquete). */
  skipped: string[];
}

export interface ImportedProject extends WorkspaceSeed {
  name: string;
  settings: Partial<WorkspaceJson["settings"]>;
  /** Archivos referenciados que no estaban dentro del zip. */
  missingFiles: string[];
}

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------

/** Nombre apto para cualquier sistema de archivos (Windows, macOS, Linux). */
function safeName(name: string, fallback: string): string {
  const clean = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

function uniquePath(used: Set<string>, folder: string, name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = `${folder}/${name}`;
  for (let i = 2; used.has(candidate.toLowerCase()); i += 1) {
    candidate = `${folder}/${base} (${i})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function activeWorkspaceName(): string {
  const id = useCloudStore.getState().workspaceId;
  const found = useWorkspaceManagerStore.getState().workspaces.find((w) => w.id === id);
  return found?.name ?? "Espacio local";
}

/** Un cuaderno (`sketch-note-node`) como Markdown. */
function noteToMarkdown(node: Extract<EngineeringNodeData, { type: "sketch-note-node" }>): string {
  const lines: string[] = [`# ${node.title || "Nota sin título"}`, ""];
  for (const block of node.sketchNoteData.textBlocks) {
    if (block.type === "heading") lines.push(`## ${block.text}`, "");
    else if (block.type === "bullet") lines.push(`- ${block.text}`);
    else lines.push(block.text, "");
  }
  const items = node.sketchNoteData.checklistItems;
  if (items.length > 0) {
    lines.push("", "## Lista de verificación", "");
    for (const item of items) lines.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ----------------------------------------------------------------------------
// Exportar
// ----------------------------------------------------------------------------

/** Empaqueta el lienzo actual y lo descarga como `<nombre>.andros.zip`. */
export async function downloadWorkspaceZip(): Promise<ExportResult> {
  const { nodes, connections, canvasStrokes } = useWorkspaceStore.getState();
  const settings = useSettingsStore.getState();
  const name = activeWorkspaceName();

  const zip = new JSZip();
  const used = new Set<string>();
  const files: Record<string, string> = {};
  const notes: Record<string, string> = {};
  const skipped: string[] = [];

  const jsonNodes: EngineeringNodeData[] = [];
  for (const node of nodes) {
    if (node.type === "sketch-note-node") {
      const path = uniquePath(used, "notas", `${safeName(node.title, "nota")}.md`);
      zip.file(path, noteToMarkdown(node));
      notes[node.id] = path;
    }

    if (node.type !== "file-node") {
      jsonNodes.push(node);
      continue;
    }

    // Los enlaces blob:/firmados no sirven fuera de esta sesión: se omiten.
    const file = node.fileData;
    const cleanFile: FileNodePayload = { ...file, downloadUrl: "" };
    delete cleanFile.storagePath;

    if (file.status === "ready" && file.downloadUrl) {
      try {
        const response = await fetch(file.downloadUrl);
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.blob();
        const fileName = safeName(file.fileName, "archivo");
        const folder = MODEL_3D_EXTENSIONS.has(file.extension.toLowerCase())
          ? "modelos-3d"
          : "archivos";
        const path = uniquePath(used, folder, fileName);
        zip.file(path, data, { binary: true });
        files[node.id] = path;
      } catch {
        skipped.push(file.fileName || node.title);
        cleanFile.status = "error";
        cleanFile.errorMessage = "Este archivo no pudo incluirse en el paquete.";
      }
    }
    jsonNodes.push({ ...node, fileData: cleanFile });
  }

  const manifest: WorkspaceJson = {
    format: WORKSPACE_ZIP_FORMAT,
    version: WORKSPACE_ZIP_VERSION,
    exportedAt: new Date().toISOString(),
    name,
    settings: {
      snapToGrid: settings.snapToGrid,
      cableStyle: settings.cableStyle,
      canvasBackground: settings.canvasBackground,
    },
    nodes: jsonNodes,
    connections,
    canvasStrokes,
    files,
    notes,
  };
  zip.file("workspace.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const fileName = `${safeName(name, "andros")}${WORKSPACE_ZIP_EXTENSION}`;
  triggerDownload(blob, fileName);

  return {
    fileName,
    fileCount: Object.keys(files).length,
    noteCount: Object.keys(notes).length,
    skipped,
  };
}

// ----------------------------------------------------------------------------
// Importar
// ----------------------------------------------------------------------------

/** Lee un `.andros.zip` y reconstruye nodos, cables, tinta y archivos. */
export async function readWorkspaceZip(file: File): Promise<ImportedProject> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("El archivo no es un paquete .zip válido.");
  }

  const jsonEntry = zip.file("workspace.json");
  if (!jsonEntry) throw new Error("Este zip no es un proyecto de Andros (falta workspace.json).");

  let raw: Partial<WorkspaceJson>;
  try {
    raw = JSON.parse(await jsonEntry.async("string")) as Partial<WorkspaceJson>;
  } catch {
    throw new Error("workspace.json está dañado y no se pudo leer.");
  }
  if (raw.format !== WORKSPACE_ZIP_FORMAT) {
    throw new Error("Este zip no es un proyecto de Andros.");
  }
  if (typeof raw.version === "number" && raw.version > WORKSPACE_ZIP_VERSION) {
    throw new Error("Este proyecto se creó con una versión más nueva de Andros.");
  }

  const filePaths = raw.files && typeof raw.files === "object" ? raw.files : {};
  const missingFiles: string[] = [];

  const nodes: EngineeringNodeData[] = [];
  const seen = new Set<string>();
  for (const rawNode of Array.isArray(raw.nodes) ? raw.nodes : []) {
    const parsed = parseImportedNode(rawNode);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);

    if (parsed.type === "file-node") {
      const path = filePaths[parsed.id];
      const entry = typeof path === "string" ? zip.file(path) : null;
      const base: FileNodePayload = { ...parsed.fileData, downloadUrl: "" };
      delete base.storagePath;

      if (entry) {
        const buffer = await entry.async("arraybuffer");
        const blob = new Blob([buffer], {
          type: base.mimeType || "application/octet-stream",
        });
        nodes.push({
          ...parsed,
          fileData: {
            ...base,
            downloadUrl: URL.createObjectURL(blob),
            fileSizeBytes: blob.size,
            status: "ready",
            uploadProgress: 100,
            errorMessage: undefined,
          },
        });
        continue;
      }

      if (base.status === "ready" || base.status === "uploading") {
        missingFiles.push(base.fileName || parsed.title);
        base.status = "error";
        base.uploadProgress = 0;
        base.errorMessage = "Este archivo no venía dentro del paquete. Vuelve a adjuntarlo.";
      }
      nodes.push({ ...parsed, fileData: base });
      continue;
    }
    nodes.push(parsed);
  }

  const connections = (Array.isArray(raw.connections) ? raw.connections : [])
    .map(parseImportedConnection)
    .filter((c): c is NonNullable<typeof c> => c !== null && seen.has(c.fromNodeId) && seen.has(c.toNodeId));

  const baseName = file.name.replace(/\.andros\.zip$/i, "").replace(/\.zip$/i, "");
  return {
    name:
      typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : baseName,
    nodes,
    connections,
    strokes: sanitizeCanvasStrokes(raw.canvasStrokes),
    settings: raw.settings && typeof raw.settings === "object" ? raw.settings : {},
    missingFiles,
  };
}

/**
 * Pone el proyecto en el lienzo al instante. Con sesión iniciada se crea un
 * espacio nuevo en la nube (carpeta "Importados") y los archivos se suben solos.
 */
export async function applyImportedProject(
  project: ImportedProject
): Promise<"cloud" | "local" | "cloud-failed"> {
  const { cableStyle, canvasBackground, snapToGrid } = project.settings;
  useSettingsStore.getState().applyPreferences({
    ...(cableStyle === "bezier" || cableStyle === "orthogonal" || cableStyle === "straight"
      ? { cableStyle }
      : {}),
    ...(canvasBackground === "dots" || canvasBackground === "grid" || canvasBackground === "plain"
      ? { canvasBackground }
      : {}),
    ...(typeof snapToGrid === "boolean" ? { snapToGrid } : {}),
  });

  const seed: WorkspaceSeed = {
    nodes: project.nodes,
    connections: project.connections,
    strokes: project.strokes,
  };

  const signedIn = useCloudStore.getState().user !== null;
  if (signedIn) {
    const folder = useWorkspaceManagerStore.getState().foldersSupported ? "Importados" : "";
    const id = await createCloudWorkspace(project.name, folder, seed);
    if (id) return "cloud";
    return "cloud-failed";
  }

  useWorkspaceStore.getState().hydrateWorkspace(seed.nodes, seed.connections);
  useWorkspaceStore.getState().hydrateCanvasStrokes(seed.strokes);
  return "local";
}
