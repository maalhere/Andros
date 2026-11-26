import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { markPendingImportPanel } from "@/lib/ai/nodeChatClient";
import { useFormsLibraryStore } from "@/store/useFormsLibraryStore";
import { useFormulaCreatorStore } from "@/store/useFormulaCreatorStore";
import { createResolutionCard } from "@/lib/cde/resolutionActions";

// ============================================================================
// ANDROS — MENÚ "+ AGREGAR" (dock de escritorio y cajón del teléfono)
// Las opciones visibles para cualquier persona: Archivo 3D, Nota, Enlace
// Web/YouTube, Cálculo, Ficha (librería de formatos), Fórmula LaTeX, Nodo IA e
// Importar chat. Ambos viewports usan estas mismas funciones.
// ============================================================================

export type QuickAddKind = "file3d" | "note" | "link" | "calc" | "forms" | "resolution" | "formula" | "ai" | "ai-import";

export const QUICK_ADD_OPTIONS: { kind: QuickAddKind; label: string; description: string }[] = [
  { kind: "file3d", label: "Archivo 3D", description: "Sube una pieza .stl, .obj o .3mf" },
  { kind: "note", label: "Nota", description: "Texto, listas y bocetos rápidos" },
  { kind: "link", label: "Enlace web", description: "Video, paper o página con vista previa" },
  { kind: "calc", label: "Cálculo", description: "Hoja con fórmulas y ecuaciones" },
  { kind: "forms", label: "Librería de fichas", description: "Fichas con campos y fotos, replicables o llenadas con IA" },
  { kind: "resolution", label: "Ficha de resolución", description: "Algo pendiente por resolver: Rojo hasta pasarla a Verde" },
  { kind: "formula", label: "Fórmula LaTeX", description: "Se calcula sola con los datos de tus fichas conectadas" },
  { kind: "ai", label: "Nuevo Nodo IA", description: "El modelo de IA que elijas, con el contexto de sus cables" },
  { kind: "ai-import", label: "Importar chat", description: "Trae una conversación de un chat de IA externo" },
];

/**
 * Herramientas técnicas de ingeniería: solo en Modo Experto (Sprint 19).
 * Archivo 3D (visor + impresoras), Cálculo (hoja LaTeX) y Fórmula LaTeX.
 */
export const EXPERT_ONLY_QUICK_ADD: ReadonlySet<QuickAddKind> = new Set<QuickAddKind>(["file3d", "calc", "formula"]);

/** Opciones de «+ Agregar» según el modo: el Modo Simple oculta 3D, cálculo y fórmulas LaTeX. */
export function quickAddOptionsFor(expert: boolean) {
  return expert ? QUICK_ADD_OPTIONS : QUICK_ADD_OPTIONS.filter((o) => !EXPERT_ONLY_QUICK_ADD.has(o.kind));
}

// ----------------------------------------------------------------------------
// Archivos elegidos en el menú que esperan a que su nodo aparezca en pantalla.
// FileNodeView los recoge al montarse y los adjunta (lectura + subida a la nube).
// ----------------------------------------------------------------------------

const pendingFiles = new Map<string, File>();

/** Devuelve (y olvida) el archivo pendiente de un nodo recién creado. */
export function takePendingFile(nodeId: string): File | null {
  const file = pendingFiles.get(nodeId) ?? null;
  pendingFiles.delete(nodeId);
  return file;
}

/**
 * Punto del lienzo que el usuario está viendo ahora mismo (centro de la
 * pantalla), con un pequeño escalonado para que varios nodos seguidos no se
 * tapen por completo.
 */
export function visibleSpawnPoint(): { x: number; y: number } {
  const { canvasTransform, nodes } = useWorkspaceStore.getState();
  const cascade = (nodes.length % 6) * 36;
  const centerX = (window.innerWidth / 2 - canvasTransform.x) / canvasTransform.scale;
  const centerY = (window.innerHeight / 2 - canvasTransform.y) / canvasTransform.scale;
  return { x: Math.round(centerX - 170 + cascade), y: Math.round(centerY - 140 + cascade) };
}

/**
 * Crea el nodo de la opción elegida en la zona visible del lienzo.
 * «Librería de fichas» y «Fórmula LaTeX» abren su diálogo (devuelven "" porque aún no crean nodo).
 */
export function quickAdd(kind: QuickAddKind, file?: File): string {
  const ws = useWorkspaceStore.getState();
  if (kind === "forms") {
    ws.setActiveTool("pointer");
    ws.setActiveMobileSheet("none");
    useFormsLibraryStore.getState().openLibrary("catalog");
    return "";
  }
  if (kind === "resolution") {
    ws.setActiveTool("pointer");
    ws.setActiveMobileSheet("none");
    const selected = ws.selectedNodeId;
    return (
      createResolutionCard({
        description: "Describe aquí qué falta resolver",
        affectedNodeIds: selected ? [selected] : [],
      }) ?? ""
    );
  }
  if (kind === "formula") {
    ws.setActiveTool("pointer");
    ws.setActiveMobileSheet("none");
    useFormulaCreatorStore.getState().setOpen(true);
    return "";
  }
  const position = visibleSpawnPoint();
  let id: string;
  switch (kind) {
    case "file3d":
      id = ws.aiCreateNode({ type: "file-node", position });
      if (file) pendingFiles.set(id, file);
      break;
    case "note":
      id = ws.aiCreateNode({ type: "sketch-note-node", title: "Nota", position });
      break;
    case "link":
      id = ws.aiCreateNode({ type: "resource-link-node", position });
      break;
    case "calc":
      id = ws.aiCreateNode({ type: "calc-latex-node", position });
      break;
    default:
      id = "";
      break;
    case "ai":
    case "ai-import": {
      const { defaultModels } = useAiProvidersStore.getState();
      id = ws.aiCreateNode({
        type: "ai-chat-node",
        title: kind === "ai-import" ? "Chat importado" : "Nodo IA",
        position,
        aiChatData: { provider: "gemini", model: defaultModels.gemini },
      });
      if (kind === "ai-import") markPendingImportPanel(id);
      break;
    }
  }
  ws.setActiveTool("pointer");
  ws.setActiveMobileSheet("none");
  return id;
}

/** Hoja de boceto a mano alzada (botón "Dibujar" del teléfono). */
export function quickAddSketch(): string {
  const ws = useWorkspaceStore.getState();
  const id = ws.aiCreateNode({
    type: "sketch-note-node",
    title: "Boceto",
    sketchNoteData: { canvasMode: "draw" },
  });
  ws.setActiveMobileSheet("none");
  return id;
}
