// ============================================================================
// ANDROS — PORTAPAPELES DE FICHAS (funciones puras: store y scripts)
//   · La copia es profunda y viaja con sus cables.
//   · COPIAR → pegar crea fichas independientes: ids nuevos y sin referencias a
//     tarjetas que no se copiaron.
//   · CORTAR → el primer pegado en el MISMO espacio es un traslado: se
//     recuperan los cables y las referencias que seguían vivas.
//   · Se guarda en memoria y en `sessionStorage` (solo esta pestaña) para poder
//     pegar en otro espacio o tras recargar.
// ============================================================================

import {
  RESOLUTION_CODE_TAG,
  existingResolutionCodes,
  nextResolutionCode,
  resolutionFields,
} from "@/lib/cde/resolution";
import type { EngineeringNodeData, NodeConnection } from "@/types/workspace";

/** Copia profunda de una ficha tal como estaba al copiarla o cortarla. */
export type CardSnapshot = EngineeringNodeData;

export interface CardClipboard {
  mode: "copy" | "cut";
  cards: CardSnapshot[];
  /** Cables que tocaban las fichas (entre ellas o con otras tarjetas). */
  connections: NodeConnection[];
  sourceWorkspaceId?: string;
  /** Pegados seguidos en `pasteWorkspaceId`: escalonan la posición. */
  pasteCount: number;
  pasteWorkspaceId?: string;
}

/** Desplazamiento de cada pegado respecto al anterior (px del lienzo). */
export const PASTE_OFFSET = 32;
export const CLIPBOARD_STORAGE_KEY = "andros.clipboard";

const CARD_SIZE = { width: 320, height: 220 };

type Point = { x: number; y: number };

const clone = <T>(value: T): T => structuredClone(value);

export function createClipboard(
  mode: CardClipboard["mode"],
  ids: readonly string[],
  nodes: readonly EngineeringNodeData[],
  connections: readonly NodeConnection[],
  sourceWorkspaceId?: string
): CardClipboard | null {
  const wanted = new Set(ids);
  const cards = nodes.filter((n) => wanted.has(n.id));
  if (cards.length === 0) return null;
  const found = new Set(cards.map((n) => n.id));
  return {
    mode,
    cards: clone(cards),
    connections: clone(connections.filter((c) => found.has(c.fromNodeId) || found.has(c.toNodeId))),
    ...(sourceWorkspaceId ? { sourceWorkspaceId } : {}),
    pasteCount: 0,
  };
}

export interface PasteInput {
  clipboard: CardClipboard;
  nodes: EngineeringNodeData[];
  connections: NodeConnection[];
  /** Espacio donde se pega (`undefined` en modo local). */
  workspaceId?: string;
  /** Centro de la vista: se usa al pegar en OTRO espacio. */
  viewCenter?: Point;
  /** Esquina superior izquierda exacta (menú contextual del lienzo). */
  at?: Point;
  newId: (prefix: string) => string;
}

export interface PasteResult {
  nodes: EngineeringNodeData[];
  connections: NodeConnection[];
  pastedIds: string[];
  clipboard: CardClipboard;
}

/** Calcula el lienzo resultante de un pegado sin modificar las entradas. */
export function planPaste(input: PasteInput): PasteResult {
  const { clipboard, nodes, connections, workspaceId, viewCenter, at, newId } = input;
  const sameWorkspace = clipboard.sourceWorkspaceId === workspaceId;
  const isMove = clipboard.mode === "cut" && sameWorkspace;
  const previousPastes = clipboard.pasteWorkspaceId === workspaceId ? clipboard.pasteCount : 0;

  const idMap = new Map(clipboard.cards.map((card) => [card.id, newId("node")]));
  const liveIds = new Set(nodes.map((n) => n.id));
  /** Id válido en el lienzo destino, o `null` si la referencia quedaría huérfana. */
  const resolveRef = (id: string): string | null =>
    idMap.get(id) ?? (isMove && liveIds.has(id) ? id : null);

  // --- Posición ---------------------------------------------------------------
  const minX = Math.min(...clipboard.cards.map((c) => c.position.x));
  const minY = Math.min(...clipboard.cards.map((c) => c.position.y));
  let delta: Point;
  if (at) {
    delta = { x: at.x - minX, y: at.y - minY };
  } else if (!sameWorkspace && viewCenter) {
    const maxX = Math.max(...clipboard.cards.map((c) => c.position.x + CARD_SIZE.width));
    const maxY = Math.max(...clipboard.cards.map((c) => c.position.y + CARD_SIZE.height));
    const step = PASTE_OFFSET * previousPastes;
    delta = {
      x: viewCenter.x - (minX + maxX) / 2 + step,
      y: viewCenter.y - (minY + maxY) / 2 + step,
    };
  } else {
    const step = PASTE_OFFSET * (previousPastes + 1);
    delta = { x: step, y: step };
  }
  const place = (card: CardSnapshot): Point => ({
    x: Math.round(card.position.x + delta.x),
    y: Math.round(card.position.y + delta.y),
  });
  // Ninguna ficha pegada queda exactamente encima de otra.
  const covers = (p: Point) =>
    nodes.some((n) => Math.abs(n.position.x - p.x) < 8 && Math.abs(n.position.y - p.y) < 8);
  while (clipboard.cards.some((card) => covers(place(card)))) {
    delta = { x: delta.x + PASTE_OFFSET, y: delta.y + PASTE_OFFSET };
  }

  // --- Fichas nuevas ----------------------------------------------------------
  const codes = existingResolutionCodes(nodes);
  const titleById = new Map<string, string>([
    ...nodes.map((n) => [n.id, n.title] as const),
    ...clipboard.cards.map((c) => [idMap.get(c.id) as string, c.title] as const),
  ]);
  const titleOf = (id: string) => titleById.get(id) ?? null;

  const pasted = clipboard.cards.map((source): EngineeringNodeData => {
    const card = clone(source);
    card.id = idMap.get(source.id) as string;
    card.position = place(source);
    card.updatedAt = "Ahora mismo";

    if (card.type === "file-node") {
      // Una lectura a medias no continúa en la copia: el archivo local ya está completo.
      if (card.fileData.status === "uploading" && card.fileData.downloadUrl) {
        card.fileData.status = "ready";
        card.fileData.uploadProgress = 100;
      }
    } else if (card.type === "ai-chat-node") {
      if (card.aiChatData.status === "thinking") card.aiChatData.status = "idle";
      if (!isMove) delete card.aiChatData.contextFingerprint;
    } else if (card.type === "formula-sheet-node") {
      card.formulaSheetData.variables = card.formulaSheetData.variables.map((variable) => {
        const binding = variable.sourceBinding;
        if (!binding) return variable;
        const nodeId = resolveRef(binding.nodeId);
        return { ...variable, sourceBinding: nodeId ? { ...binding, nodeId } : null };
      });
    } else if (card.type === "form-sheet-node" && card.formSheetData.resolution) {
      const meta = card.formSheetData.resolution;
      // El código correlativo es único por espacio: solo un traslado lo conserva.
      const keepCode = clipboard.mode === "cut" && !codes.includes(meta.code);
      const code = keepCode ? meta.code : nextResolutionCode(codes);
      codes.push(code);
      const resolution = {
        ...meta,
        code,
        affectedNodeIds: meta.affectedNodeIds.flatMap((id) => resolveRef(id) ?? []),
        sourceAlertIds: isMove ? meta.sourceAlertIds : [],
        assigneeId: sameWorkspace ? meta.assigneeId : null,
      };
      if (code !== meta.code) {
        card.title = card.title.replace(meta.code, code);
        if (card.codeTag === meta.code || card.codeTag === RESOLUTION_CODE_TAG) card.codeTag = code;
      }
      card.formSheetData.resolution = resolution;
      card.formSheetData.fields = resolutionFields(resolution, titleOf);
    }
    return card;
  });

  // --- Tarjetas que apuntaban a una ficha trasladada --------------------------
  const existing = !isMove
    ? nodes
    : nodes.map((node): EngineeringNodeData => {
        if (node.type === "formula-sheet-node") {
          const variables = node.formulaSheetData.variables;
          if (!variables.some((v) => v.sourceBinding && idMap.has(v.sourceBinding.nodeId))) return node;
          return {
            ...node,
            formulaSheetData: {
              ...node.formulaSheetData,
              variables: variables.map((v) => {
                const nodeId = v.sourceBinding && idMap.get(v.sourceBinding.nodeId);
                return nodeId && v.sourceBinding
                  ? { ...v, sourceBinding: { ...v.sourceBinding, nodeId } }
                  : v;
              }),
            },
          };
        }
        if (node.type === "form-sheet-node" && node.formSheetData.resolution) {
          const meta = node.formSheetData.resolution;
          if (!meta.affectedNodeIds.some((id) => idMap.has(id))) return node;
          const resolution = {
            ...meta,
            affectedNodeIds: meta.affectedNodeIds.map((id) => idMap.get(id) ?? id),
          };
          return {
            ...node,
            formSheetData: {
              ...node.formSheetData,
              resolution,
              fields: resolutionFields(resolution, titleOf),
            },
          };
        }
        return node;
      });

  // --- Cables -------------------------------------------------------------------
  const newConnections = clipboard.connections.flatMap((edge): NodeConnection[] => {
    const fromNodeId = resolveRef(edge.fromNodeId);
    const toNodeId = resolveRef(edge.toNodeId);
    return fromNodeId && toNodeId ? [{ ...edge, id: newId("conn"), fromNodeId, toNodeId }] : [];
  });

  return {
    nodes: [...pasted, ...existing],
    connections: newConnections.length > 0 ? [...connections, ...newConnections] : connections,
    pastedIds: pasted.map((n) => n.id),
    clipboard: {
      ...clipboard,
      // Tras el primer pegado ya no es un traslado: pegar otra vez duplica a propósito.
      mode: "copy",
      pasteCount: previousPastes + 1,
      pasteWorkspaceId: workspaceId,
    },
  };
}

/** Rutas de Storage que el portapapeles todavía necesita (no se deben borrar). */
export function clipboardStoragePaths(clipboard: CardClipboard | null): Set<string> {
  return new Set(
    (clipboard?.cards ?? []).flatMap((c) =>
      c.type === "file-node" && c.fileData.storagePath ? [c.fileData.storagePath] : []
    )
  );
}

// ----------------------------------------------------------------------------
// Persistencia en la pestaña
// ----------------------------------------------------------------------------

const PAYLOAD_KEYS: Record<EngineeringNodeData["type"], string> = {
  "file-node": "fileData",
  "sketch-note-node": "sketchNoteData",
  "calc-latex-node": "calcLatexData",
  "resource-link-node": "resourceLinkData",
  "code-lab-node": "codeLabData",
  "ai-chat-node": "aiChatData",
  "form-sheet-node": "formSheetData",
  "formula-sheet-node": "formulaSheetData",
};

function isCard(value: unknown): value is CardSnapshot {
  if (!value || typeof value !== "object") return false;
  const card = value as Record<string, unknown>;
  const position = card.position as Record<string, unknown> | undefined;
  const payloadKey = PAYLOAD_KEYS[card.type as EngineeringNodeData["type"]];
  return (
    typeof card.id === "string" &&
    typeof card.title === "string" &&
    typeof position?.x === "number" &&
    typeof position?.y === "number" &&
    typeof payloadKey === "string" &&
    typeof card[payloadKey] === "object" &&
    card[payloadKey] !== null
  );
}

export function parseClipboard(raw: string | null): CardClipboard | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<CardClipboard>;
    const cards = Array.isArray(data.cards) ? data.cards.filter(isCard) : [];
    if (cards.length === 0) return null;
    for (const card of cards) {
      // Los enlaces `blob:` mueren al recargar la página.
      if (card.type !== "file-node" || !card.fileData.downloadUrl?.startsWith("blob:")) continue;
      card.fileData.downloadUrl = "";
      if (!card.fileData.storagePath) {
        card.fileData.status = "error";
        card.fileData.errorMessage = "El archivo local no sobrevivió a la recarga. Vuelve a adjuntarlo.";
      }
    }
    return {
      mode: data.mode === "cut" ? "cut" : "copy",
      cards,
      connections: Array.isArray(data.connections) ? data.connections : [],
      ...(typeof data.sourceWorkspaceId === "string" ? { sourceWorkspaceId: data.sourceWorkspaceId } : {}),
      pasteCount: Number.isFinite(data.pasteCount) ? Number(data.pasteCount) : 0,
      ...(typeof data.pasteWorkspaceId === "string" ? { pasteWorkspaceId: data.pasteWorkspaceId } : {}),
    };
  } catch {
    return null;
  }
}

export function readStoredClipboard(): CardClipboard | null {
  try {
    return typeof window === "undefined"
      ? null
      : parseClipboard(window.sessionStorage.getItem(CLIPBOARD_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredClipboard(clipboard: CardClipboard | null): void {
  if (typeof window === "undefined") return;
  try {
    if (clipboard) {
      window.sessionStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(clipboard));
    } else {
      window.sessionStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    }
  } catch {
    // Sin espacio (fichas con fotos): queda solo en memoria, sin una copia vieja.
    try {
      window.sessionStorage.removeItem(CLIPBOARD_STORAGE_KEY);
    } catch {
      /* sin sessionStorage */
    }
  }
}
