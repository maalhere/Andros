import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { markPendingImportPanel } from "@/lib/ai/nodeChatClient";

// ============================================================================
// ANDROS — MENÚ "+ AGREGAR" (dock de escritorio y cajón del teléfono)
// Las opciones visibles para cualquier persona: Archivo 3D, Nota, Enlace
// Web/YouTube, Cálculo, Nodo IA e Importar chat. Ambos viewports usan estas
// mismas funciones.
// ============================================================================

export type QuickAddKind = "file3d" | "note" | "link" | "calc" | "ai" | "ai-import";

export const QUICK_ADD_OPTIONS: { kind: QuickAddKind; label: string; description: string }[] = [
  { kind: "file3d", label: "Archivo 3D", description: "Sube una pieza .stl, .obj o .3mf" },
  { kind: "note", label: "Nota", description: "Texto, listas y bocetos rápidos" },
  { kind: "link", label: "Enlace Web/YouTube", description: "Video, paper o página con vista previa" },
  { kind: "calc", label: "Cálculo", description: "Hoja con fórmulas y ecuaciones" },
  { kind: "ai", label: "Nuevo Nodo IA", description: "Gemini, Claude o ChatGPT con el contexto de sus cables" },
  { kind: "ai-import", label: "Importar chat", description: "Trae una conversación de ChatGPT, Claude o Gemini" },
];

/** Opciones de «+ Agregar» según el modo: el Modo Simple oculta la subida de archivos 3D. */
export function quickAddOptionsFor(expert: boolean) {
  return expert ? QUICK_ADD_OPTIONS : QUICK_ADD_OPTIONS.filter((o) => o.kind !== "file3d");
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

/** Crea el nodo de la opción elegida en la zona visible del lienzo. */
export function quickAdd(kind: QuickAddKind, file?: File): string {
  const ws = useWorkspaceStore.getState();
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
