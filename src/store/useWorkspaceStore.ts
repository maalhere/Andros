import { create } from "zustand";
import {
  ActiveTool,
  CanvasInkColor,
  CanvasInkMode,
  CanvasInkTip,
  CanvasStroke,
  CalcLatexPayload,
  ChecklistItem,
  ConnectionDraft,
  EngineeringNodeBase,
  EngineeringNodeData,
  FileNodePayload,
  LegacyNodeCategory,
  MobileSheetType,
  NodeArchetype,
  NodeConnection,
  NodeMetaPatch,
  NodePayloadPatch,
  NoteTextBlock,
  PortPosition,
  SketchNoteEngineeringNode,
  SketchNotePayload,
  SpawnNodeInput,
  ThemeMode,
} from "@/types/workspace";

// ============================================================================
// 1. CONTRATO DEL STORE
// ============================================================================

interface WorkspaceState {
  // Tema Dual-Engine
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;

  // Datos de Nodos y Conexiones (Compartidos entre PC y Móvil)
  nodes: EngineeringNodeData[];
  connections: NodeConnection[];
  selectedNodeId: string | null;

  // Conexión interactiva entre nodos
  connectingFrom: ConnectionDraft | null;
  selectedConnectionId: string | null;

  // Estado de Interacción Desktop (Spatial Canvas)
  activeTool: ActiveTool;
  canvasTransform: { x: number; y: number; scale: number };
  isOracleModalOpen: boolean;

  // Estado de Interacción Mobile (Tactile Deck & Bottom Sheets)
  mobileCategoryFilter: "all" | NodeArchetype;
  isMiniMapVisible: boolean;
  activeMobileSheet: MobileSheetType;

  // Acciones de Nodos
  selectNode: (id: string | null) => void;
  updateNodePosition: (id: string, x: number, y: number) => void;
  spawnNode: (partial?: SpawnNodeInput) => void;
  removeNode: (id: string) => void;
  runNodeSimulation: (id: string) => void;
  updateNodePayload: (id: string, patch: NodePayloadPatch) => void;
  updateNodeMeta: (id: string, patch: NodeMetaPatch) => void;

  /** Reemplaza el lienzo completo (lo usa la nube al cargar el workspace guardado). */
  hydrateWorkspace: (nodes: EngineeringNodeData[], connections: NodeConnection[]) => void;

  // Acciones de Conexión
  startConnecting: (nodeId: string, port?: PortPosition) => void;
  cancelConnecting: () => void;
  completeConnection: (
    toNodeId: string,
    toPort?: PortPosition,
    label?: string
  ) => void;
  removeConnection: (id: string) => void;
  updateConnectionLabel: (id: string, label: string) => void;
  selectConnection: (id: string | null) => void;

  // --------------------------------------------------------------------------
  // Acciones controladas por el Oráculo IA (ETAPA · PRIORIDAD 2)
  // --------------------------------------------------------------------------

  /** Crea un nodo nuevo en un hueco libre del lienzo, sin encimarlo sobre otros. */
  aiCreateNode: (partial?: SpawnNodeInput) => string;
  /** Conecta dos nodos existentes (sin pasar por el modo "arrastrar cable"). */
  aiConnectNodes: (fromNodeId: string, toNodeId: string, label?: string) => void;
  /** Reordena todos los nodos del lienzo en una cuadrícula limpia y alineada. */
  aiAutoLayout: () => void;
  /** Analiza el nodo seleccionado y crea a su lado una guía técnica de impresión 3D. */
  aiAnnotateSelected: () => void;
  /**
   * Crea un bloque de texto limpio (cuaderno en modo texto) con el contenido
   * redactado por la IA y, si se indica, lo cablea con etiqueta al archivo o
   * nodo al que hace referencia. Devuelve el id del bloque creado.
   */
  aiCreateTextBlock: (input: AiTextBlockInput) => string;
  /** Añade o reemplaza el texto de un nodo existente (cuaderno, cálculo o archivo). */
  aiUpdateNodeNote: (nodeId: string, content: string, mode?: "append" | "replace") => boolean;
  /**
   * Ordena el lienzo por flujo de trabajo humano en zonas/columnas:
   * 1) archivos fuente y modelos 3D, 2) textos y análisis a la derecha de su
   * archivo, 3) enlaces, fuentes y cálculos. Devuelve cuántos nodos quedaron en cada zona.
   */
  aiApplyHumanLayout: (
    assignments?: { nodeId: string; zone: HumanLayoutZone }[]
  ) => HumanLayoutResult;

  // Acciones de Herramientas y Navegación
  setActiveTool: (tool: ActiveTool) => void;
  setCanvasTransform: (transform: { x: number; y: number; scale: number }) => void;
  resetCanvasView: () => void;
  /**
   * Cambia el zoom (20 %–300 %) manteniendo fijo el punto `anchor` de la
   * pantalla (coordenadas relativas al lienzo). Sin `anchor`: centro de la vista.
   */
  zoomCanvasAt: (scale: number, anchor?: { x: number; y: number }) => void;
  /** Contador que el lienzo escucha para ejecutar "Zoom Extents". */
  zoomExtentsRequest: number;
  /** Pide al lienzo que encuadre todos los nodos y trazos (Zoom Extents). */
  requestZoomExtents: () => void;

  // --------------------------------------------------------------------------
  // Tinta libre sobre el lienzo (Lápiz D)
  // --------------------------------------------------------------------------
  /** Trazos libres del lienzo (se guardan en Supabase con el workspace). */
  canvasStrokes: CanvasStroke[];
  inkColor: CanvasInkColor;
  inkTip: CanvasInkTip;
  inkMode: CanvasInkMode;
  /** Historial local para "Deshacer" (no se guarda en la nube). */
  inkHistory: InkHistoryEntry[];
  setInkColor: (color: CanvasInkColor) => void;
  setInkTip: (tip: CanvasInkTip) => void;
  setInkMode: (mode: CanvasInkMode) => void;
  addCanvasStroke: (stroke: CanvasStroke) => void;
  eraseCanvasStrokes: (ids: string[]) => void;
  /** Deshace el último trazo dibujado (o restaura lo último borrado). */
  undoCanvasInk: () => void;
  /** Reemplaza todos los trazos (lo usa la nube al cargar el workspace). */
  hydrateCanvasStrokes: (strokes: CanvasStroke[]) => void;
  setOracleModalOpen: (isOpen: boolean) => void;

  // Acciones Exclusivas de Ergonomía Móvil
  setMobileCategoryFilter: (filter: "all" | NodeArchetype) => void;
  toggleMiniMap: () => void;
  setActiveMobileSheet: (sheet: MobileSheetType) => void;
}

/** Paso del historial de tinta: un trazo añadido o un grupo de trazos borrados. */
export type InkHistoryEntry =
  | { kind: "add"; strokeId: string }
  | { kind: "erase"; strokes: { stroke: CanvasStroke; index: number }[] };

/** Límites de zoom del lienzo (20 % a 300 %). */
export const MIN_CANVAS_SCALE = 0.2;
export const MAX_CANVAS_SCALE = 3;

export function clampCanvasScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

/** Grosor base de cada punta del lápiz (px a 100 % de zoom). */
export const INK_TIP_WIDTHS: Record<CanvasInkTip, number> = {
  fine: 2,
  medium: 4,
  highlighter: 10,
};

/** Máximo de pasos que recuerda "Deshacer". */
const INK_HISTORY_LIMIT = 100;

/** Zonas del ordenamiento humano del lienzo. */
export type HumanLayoutZone = 1 | 2 | 3;

export interface HumanLayoutResult {
  zone1: number;
  zone2: number;
  zone3: number;
}

export interface AiTextBlockInput {
  title: string;
  /** Texto con marcas ligeras: "# título", "- viñeta", "- [ ] tarea", párrafos. */
  content: string;
  /** Archivo o nodo al que hace referencia el bloque (se conecta con un cable). */
  linkedNodeId?: string;
  /** Etiqueta del cable que une el archivo con el bloque. */
  connectionLabel?: string;
  /** Etiqueta corta del bloque (por defecto "AI-TEXT"). */
  codeTag?: string;
}

// ============================================================================
// 2. UTILIDADES PURAS (exportadas para reutilizarlas en los componentes)
// ============================================================================

/**
 * Ids únicos aunque la IA cree varios nodos en el mismo milisegundo
 * (`Date.now()` solo se repetiría y pisaría nodos).
 */
let aiIdCounter = 0;
function nextUniqueId(prefix: string): string {
  aiIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${aiIdCounter}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Traduce las categorías de prueba de la Fase 0 a los 3 nodos definitivos. */
const LEGACY_TYPE_MAP: Record<LegacyNodeCategory, NodeArchetype> = {
  calculation: "calc-latex-node",
  oracle: "sketch-note-node",
  cad: "file-node",
  reference: "sketch-note-node",
};

export function resolveNodeArchetype(
  type: NodeArchetype | LegacyNodeCategory | undefined
): NodeArchetype {
  if (!type) return "file-node";
  if (
    type === "file-node" ||
    type === "sketch-note-node" ||
    type === "calc-latex-node"
  ) {
    return type;
  }
  return LEGACY_TYPE_MAP[type];
}

export const NODE_ARCHETYPE_LABELS: Record<NodeArchetype, string> = {
  "file-node": "Archivo",
  "sketch-note-node": "Cuaderno",
  "calc-latex-node": "Cálculo",
};

const DEFAULT_TITLES: Record<NodeArchetype, string> = {
  "file-node": "Nuevo Archivo de Ingeniería",
  "sketch-note-node": "Nuevo Cuaderno Técnico",
  "calc-latex-node": "Nueva Hoja de Cálculo",
};

const DEFAULT_TAGS: Record<NodeArchetype, string> = {
  "file-node": "FILE",
  "sketch-note-node": "NOTE-v1",
  "calc-latex-node": "CALC-v1",
};

/** Título que recibe un nodo de archivo recién creado (aún sin archivo). */
export const DEFAULT_FILE_NODE_TITLE = DEFAULT_TITLES["file-node"];

/** Límite actual de peso por archivo (el mismo que admite el bucket `print-files`). */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = "50 MB";

export function createEmptyFilePayload(): FileNodePayload {
  return {
    fileName: "",
    extension: "",
    fileSizeBytes: 0,
    mimeType: "",
    downloadUrl: "",
    status: "empty",
    uploadProgress: 0,
  };
}

export function createEmptySketchNotePayload(initialText?: string): SketchNotePayload {
  const text = initialText?.trim() ?? "";
  return {
    richTextHtml: text ? `<p>${escapeHtml(text)}</p>` : "",
    textBlocks: text ? [{ id: "blk-1", type: "paragraph", text }] : [],
    checklistItems: [],
    strokes: [],
    canvasMode: "split",
    canvasSize: { width: 288, height: 160 },
  };
}

export function createEmptyCalcLatexPayload(): CalcLatexPayload {
  return {
    justificationText: "",
    latexEquations: [],
    gridCells: {},
    gridSize: { rows: 6, columns: 3 },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Elige los puertos más naturales para unir dos nodos según dónde está el
 * destino respecto al origen (derecha→izquierda, abajo→arriba, etc.).
 */
export function resolveAutoPorts(
  from: { position: { x: number; y: number } },
  to: { position: { x: number; y: number } }
): { fromPort: PortPosition; toPort: PortPosition } {
  const dx = to.position.x - from.position.x;
  const dy = to.position.y - from.position.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { fromPort: "right", toPort: "left" }
      : { fromPort: "left", toPort: "right" };
  }
  return dy >= 0
    ? { fromPort: "bottom", toPort: "top" }
    : { fromPort: "top", toPort: "bottom" };
}

/**
 * Huella asumida de un nodo para calcular huecos libres y cuadrículas de
 * auto-layout. El store no conoce el tamaño real renderizado (eso vive en
 * `SpatialCanvas`), así que se usa una huella conservadora que cubre a los
 * 3 arquetipos sin que se encimen visualmente.
 */
const AI_NODE_FOOTPRINT = { width: 340, height: 220 };
const AI_NODE_MARGIN = 48;

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

/**
 * Busca, en una cuadrícula invisible a partir de `near` (o del origen del
 * lienzo), el primer hueco que no se encime con ningún nodo existente.
 */
function findFreeCanvasPosition(
  existingNodes: EngineeringNodeData[],
  near?: { x: number; y: number }
): { x: number; y: number } {
  const origin = near ?? { x: 80, y: 120 };
  const columns = 6;
  const step = {
    x: AI_NODE_FOOTPRINT.width + AI_NODE_MARGIN,
    y: AI_NODE_FOOTPRINT.height + AI_NODE_MARGIN,
  };

  for (let ring = 0; ring < 60; ring += 1) {
    for (let col = 0; col < columns; col += 1) {
      const candidate = {
        x: origin.x + col * step.x,
        y: origin.y + ring * step.y,
        w: AI_NODE_FOOTPRINT.width,
        h: AI_NODE_FOOTPRINT.height,
      };
      const collides = existingNodes.some((node) =>
        rectsOverlap(candidate, {
          x: node.position.x,
          y: node.position.y,
          w: AI_NODE_FOOTPRINT.width,
          h: AI_NODE_FOOTPRINT.height,
        })
      );
      if (!collides) return { x: candidate.x, y: candidate.y };
    }
  }
  // Huecos agotados tras 60 anillos: se apila igual, por si acaso.
  return { x: origin.x, y: origin.y + existingNodes.length * step.y };
}

/** Construye el nodo concreto (con su payload por defecto) a partir de un `SpawnNodeInput`. */
function buildNodeFromInput(
  partial: SpawnNodeInput | undefined,
  id: string,
  position: { x: number; y: number }
): EngineeringNodeData {
  const archetype = resolveNodeArchetype(partial?.type);

  const base: EngineeringNodeBase = {
    id,
    title: partial?.title || DEFAULT_TITLES[archetype],
    codeTag: partial?.codeTag || DEFAULT_TAGS[archetype],
    summary: partial?.summary,
    metrics: partial?.metrics,
    actionLabel: partial?.actionLabel,
    position,
    updatedAt: "Ahora mismo",
  };

  if (archetype === "file-node") {
    return {
      ...base,
      type: "file-node",
      fileData: { ...createEmptyFilePayload(), ...partial?.fileData },
    };
  }
  if (archetype === "sketch-note-node") {
    return {
      ...base,
      type: "sketch-note-node",
      // El texto del resumen pasa a ser el primer párrafo del cuaderno.
      summary: undefined,
      sketchNoteData: {
        ...createEmptySketchNotePayload(partial?.summary),
        ...partial?.sketchNoteData,
      },
    };
  }
  return {
    ...base,
    type: "calc-latex-node",
    calcLatexData: {
      ...createEmptyCalcLatexPayload(),
      ...(partial?.summary ? { justificationText: partial.summary } : {}),
      ...partial?.calcLatexData,
    },
    summary: undefined,
  };
}

/** Extensiones de pieza 3D que el Oráculo sabe analizar para imprimir. */
const PRINTABLE_3D_EXTENSIONS = new Set(["stl", "obj", "3mf"]);

/** Redacta la nota técnica de impresión 3D que acompaña al nodo analizado. */
function build3DPrintAdvice(node: EngineeringNodeData): SketchNotePayload {
  const isFileNode = node.type === "file-node";
  const extension = isFileNode ? node.fileData.extension.toLowerCase() : "";
  const fileName = isFileNode && node.fileData.fileName ? node.fileData.fileName : node.title;
  const isPrintable = isFileNode && PRINTABLE_3D_EXTENSIONS.has(extension);

  const material = isPrintable
    ? extension === "3mf"
      ? "PLA o PETG (el .3mf puede traer ya color y soportes definidos; revísalos antes de laminar)"
      : "PLA para prototipos rápidos; PETG o ABS si la pieza llevará carga mecánica, calor o intemperie"
    : "No se detectó un archivo 3D imprimible (.stl, .obj o .3mf) en este nodo";

  const infill = isPrintable
    ? "15–20% para uso general; sube a 35–50% si la pieza es estructural o va a recibir carga"
    : "—";

  const supports = isPrintable
    ? "Activa soportes si hay voladizos mayores a 45° o puentes largos; prefiere soportes de árbol para no marcar superficies visibles"
    : "—";

  const review = isPrintable
    ? "Revisa escala real, orientación de impresión y tolerancias críticas antes de laminar"
    : "Conecta primero el archivo de la pieza (.stl, .obj o .3mf) a este nodo para recibir recomendaciones precisas";

  const paragraph = isPrintable
    ? `Recomendaciones automáticas de impresión 3D para "${fileName}" (.${extension}). Ajusta los valores según la impresora y el material disponibles en el taller.`
    : `"${fileName}" todavía no es un archivo 3D reconocido. Adjunta un .stl, .obj o .3mf a este nodo para recibir recomendaciones de impresión precisas.`;

  const checklistItems: ChecklistItem[] = [
    { id: "chk-1", text: `Material sugerido: ${material}`, checked: false },
    { id: "chk-2", text: `Relleno (infill) sugerido: ${infill}`, checked: false },
    { id: "chk-3", text: `Soportes de impresión: ${supports}`, checked: false },
    { id: "chk-4", text: review, checked: false },
  ];

  return {
    ...createEmptySketchNotePayload(),
    richTextHtml: `<h2>Guía de impresión 3D</h2><p>${escapeHtml(paragraph)}</p>`,
    textBlocks: [
      { id: "blk-1", type: "heading", text: "Guía de impresión 3D" },
      { id: "blk-2", type: "paragraph", text: paragraph },
    ],
    checklistItems,
  };
}

// ----------------------------------------------------------------------------
// Bloques de texto redactados por la IA
// ----------------------------------------------------------------------------

const MAX_AI_BLOCKS = 80;
const MAX_AI_BLOCK_CHARS = 1500;

/** Quita marcas de Markdown que el cuaderno no interpreta (**negrita**, `código`). */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim()
    .slice(0, MAX_AI_BLOCK_CHARS);
}

/**
 * Convierte el texto de la IA en bloques del cuaderno, una idea por línea:
 * "# Título" → título · "- [ ] tarea" → checklist · "- viñeta" / "1. paso" → viñeta
 * · cualquier otra línea → párrafo.
 */
export function parseAiTextContent(content: string): {
  textBlocks: NoteTextBlock[];
  checklistItems: ChecklistItem[];
} {
  const textBlocks: NoteTextBlock[] = [];
  const checklistItems: ChecklistItem[] = [];

  for (const rawLine of content.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || /^[-*_]{3,}$/.test(line)) continue;
    if (textBlocks.length + checklistItems.length >= MAX_AI_BLOCKS) break;

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const task = line.match(/^(?:[-*•]|\d+[.)])\s*\[( |x|X)\]\s*(.+)$/);
    const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
    const bullet = line.match(/^[-*•]\s+(.+)$/);

    if (heading) {
      textBlocks.push({ id: nextUniqueId("blk"), type: "heading", text: stripInlineMarkdown(heading[1]) });
    } else if (task) {
      checklistItems.push({
        id: nextUniqueId("chk"),
        text: stripInlineMarkdown(task[2]),
        checked: task[1].toLowerCase() === "x",
      });
    } else if (numbered) {
      textBlocks.push({
        id: nextUniqueId("blk"),
        type: "bullet",
        text: `${numbered[1]}. ${stripInlineMarkdown(numbered[2])}`,
      });
    } else if (bullet) {
      textBlocks.push({ id: nextUniqueId("blk"), type: "bullet", text: stripInlineMarkdown(bullet[1]) });
    } else {
      textBlocks.push({ id: nextUniqueId("blk"), type: "paragraph", text: stripInlineMarkdown(line) });
    }
  }

  return { textBlocks, checklistItems };
}

/** Versión HTML de los bloques (para exportar o renderizar con formato rico). */
function textBlocksToHtml(blocks: NoteTextBlock[]): string {
  let html = "";
  let inList = false;
  for (const block of blocks) {
    if (block.type === "bullet") {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(block.text)}</li>`;
      continue;
    }
    if (inList) {
      html += "</ul>";
      inList = false;
    }
    html +=
      block.type === "heading"
        ? `<h2>${escapeHtml(block.text)}</h2>`
        : `<p>${escapeHtml(block.text)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

// ----------------------------------------------------------------------------
// Ordenamiento humano por zonas
// ----------------------------------------------------------------------------

/** Alto máximo (px) del área de texto de un cuaderno en el lienzo. */
export const SKETCH_TEXT_MAX_HEIGHT = 320;

/** Ancho real de un nodo en el lienzo (`w-80` en `EngineeringNode`). */
const CANVAS_NODE_WIDTH = 320;
/** Separación entre columnas/zonas: deja aire para leer los cables. */
const ZONE_GUTTER = 150;
/** Separación vertical entre nodos de una misma columna. */
const STACK_GAP = 40;
/** Separación extra entre "bandas" (un archivo y sus textos derivados). */
const BAND_GAP = 90;
const LAYOUT_ORIGIN = { x: 80, y: 120 };

const MODEL_3D_EXTENSIONS = new Set(["stl", "obj", "3mf", "step", "stp", "iges", "igs"]);

const REFERENCE_PATTERN =
  /(https?:\/\/|www\.|doi\.org|\bdoi\b|referencia|bibliograf|fuente|enlace|link|paper|articulo|artículo|norma\b|datasheet|hoja de datos)/i;

function noteFullText(node: EngineeringNodeData): string {
  if (node.type === "sketch-note-node") {
    return [
      ...node.sketchNoteData.textBlocks.map((b) => b.text),
      ...node.sketchNoteData.checklistItems.map((c) => c.text),
    ].join("\n");
  }
  if (node.type === "calc-latex-node") return node.calcLatexData.justificationText;
  return node.summary ?? "";
}

/** Zona por defecto según el tipo de nodo y su contenido. */
function defaultHumanZone(node: EngineeringNodeData): HumanLayoutZone {
  if (node.type === "file-node") return 1;
  if (node.type === "calc-latex-node") return 3;
  const header = `${node.title} ${node.codeTag}`;
  if (REFERENCE_PATTERN.test(header)) return 3;
  const text = noteFullText(node);
  // Un cuaderno que es básicamente una lista de enlaces va a la zona 3.
  const urlCount = (text.match(/https?:\/\/|www\./g) ?? []).length;
  if (urlCount > 0 && urlCount >= Math.max(1, Math.floor(node.sketchNoteData.textBlocks.length / 2))) {
    return 3;
  }
  return 2;
}

/**
 * Altura estimada de un nodo ya renderizado. El store no ve el DOM, así que
 * se aproxima según el contenido para que el ordenamiento no encime tarjetas.
 */
function estimateNodeHeight(node: EngineeringNodeData): number {
  const CHARS_PER_LINE = 46;
  const LINE = 18;
  let height = 32 + 46 + 38; // padding + cabecera + pie
  if (node.summary) height += 12 + Math.ceil(node.summary.length / CHARS_PER_LINE) * LINE;

  if (node.type === "file-node") {
    const file = node.fileData;
    if (file.status === "empty") height += 150;
    else if (MODEL_3D_EXTENSIONS.has(file.extension.toLowerCase())) height += 430;
    else height += 220;
  } else if (node.type === "sketch-note-node") {
    const data = node.sketchNoteData;
    let text = 0;
    for (const block of data.textBlocks) {
      text +=
        block.type === "heading"
          ? 26
          : Math.max(1, Math.ceil(block.text.length / CHARS_PER_LINE)) * LINE + 6;
    }
    for (const item of data.checklistItems) {
      text += Math.max(1, Math.ceil(item.text.length / (CHARS_PER_LINE - 4))) * LINE + 6;
    }
    // El área de texto del nodo tiene un alto máximo con scroll.
    height += 24 + Math.min(text, SKETCH_TEXT_MAX_HEIGHT);
    if (data.strokes.length > 0) {
      height += 12 + (288 * data.canvasSize.height) / Math.max(1, data.canvasSize.width);
    }
    height += data.checklistItems.length > 0 ? 48 : 26;
  } else {
    const data = node.calcLatexData;
    const cells = Object.keys(data.gridCells).length;
    if (cells === 0 && data.latexEquations.length === 0) {
      height += 24 + Math.ceil((data.justificationText.length || 40) / CHARS_PER_LINE) * LINE;
    } else {
      height += 24;
      if (cells > 0) height += Math.min(data.gridSize.rows, 6) * 23 + 4;
      height += Math.min(data.latexEquations.length, 2) * 46;
    }
  }
  return Math.round(height);
}

/**
 * Calcula las posiciones del ordenamiento humano. Función pura: recibe los
 * nodos y conexiones actuales y devuelve la nueva posición de cada nodo.
 */
function computeHumanLayout(
  nodes: EngineeringNodeData[],
  connections: NodeConnection[],
  assignments: { nodeId: string; zone: HumanLayoutZone }[] = []
): { positions: Map<string, { x: number; y: number }>; result: HumanLayoutResult } {
  const assigned = new Map<string, HumanLayoutZone>();
  for (const a of assignments) {
    if (a.zone === 1 || a.zone === 2 || a.zone === 3) assigned.set(a.nodeId, a.zone);
  }
  const zoneOf = new Map<string, HumanLayoutZone>();
  for (const node of nodes) zoneOf.set(node.id, assigned.get(node.id) ?? defaultHumanZone(node));

  const neighbors = new Map<string, string[]>();
  for (const c of connections) {
    neighbors.set(c.fromNodeId, [...(neighbors.get(c.fromNodeId) ?? []), c.toNodeId]);
    neighbors.set(c.toNodeId, [...(neighbors.get(c.toNodeId) ?? []), c.fromNodeId]);
  }

  // Orden de lectura actual (arriba→abajo, izquierda→derecha) como desempate estable.
  const readingOrder = (a: EngineeringNodeData, b: EngineeringNodeData) =>
    a.position.y - b.position.y || a.position.x - b.position.x;

  const zone1 = nodes.filter((n) => zoneOf.get(n.id) === 1);
  const zone2 = nodes.filter((n) => zoneOf.get(n.id) === 2);
  const zone3 = nodes.filter((n) => zoneOf.get(n.id) === 3);

  // Zona 1: primero los modelos 3D, luego el resto de archivos fuente.
  const is3D = (n: EngineeringNodeData) =>
    n.type === "file-node" && MODEL_3D_EXTENSIONS.has(n.fileData.extension.toLowerCase());
  zone1.sort((a, b) => Number(is3D(b)) - Number(is3D(a)) || readingOrder(a, b));
  zone2.sort(readingOrder);

  // Columnas solo para las zonas que tienen nodos (sin huecos vacíos).
  const columnX: Record<HumanLayoutZone, number> = { 1: 0, 2: 0, 3: 0 };
  let x = LAYOUT_ORIGIN.x;
  for (const [zone, list] of [
    [1, zone1],
    [2, zone2],
    [3, zone3],
  ] as const) {
    columnX[zone] = x;
    if (list.length > 0) x += CANVAS_NODE_WIDTH + ZONE_GUTTER;
  }

  const positions = new Map<string, { x: number; y: number }>();
  const heightOf = new Map(nodes.map((n) => [n.id, estimateNodeHeight(n)]));
  const placedZone2 = new Set<string>();
  let cursorY = LAYOUT_ORIGIN.y;

  // Bandas: cada archivo de la zona 1 con sus textos derivados a la derecha.
  for (const file of zone1) {
    const bandTop = cursorY;
    positions.set(file.id, { x: columnX[1], y: bandTop });

    let childY = bandTop;
    for (const neighborId of neighbors.get(file.id) ?? []) {
      if (zoneOf.get(neighborId) !== 2 || placedZone2.has(neighborId)) continue;
      placedZone2.add(neighborId);
      positions.set(neighborId, { x: columnX[2], y: childY });
      childY += (heightOf.get(neighborId) ?? 220) + STACK_GAP;
    }

    const bandHeight = Math.max(
      heightOf.get(file.id) ?? 220,
      childY - bandTop - (childY > bandTop ? STACK_GAP : 0)
    );
    cursorY = bandTop + bandHeight + BAND_GAP;
  }

  // Textos sin archivo propio: al final de la zona 2, en orden de lectura.
  let zone2Y = zone1.length > 0 ? cursorY : LAYOUT_ORIGIN.y;
  for (const note of zone2) {
    if (placedZone2.has(note.id)) continue;
    positions.set(note.id, { x: columnX[2], y: zone2Y });
    zone2Y += (heightOf.get(note.id) ?? 220) + STACK_GAP;
  }

  // Zona 3: cada fuente/cálculo a la altura del nodo con el que se conecta.
  const anchorOf = (node: EngineeringNodeData) => {
    const ys = (neighbors.get(node.id) ?? [])
      .map((id) => positions.get(id)?.y)
      .filter((y): y is number => typeof y === "number");
    return ys.length > 0 ? Math.min(...ys) : Number.POSITIVE_INFINITY;
  };
  const zone3Anchored = zone3
    .map((node) => ({ node, anchor: anchorOf(node) }))
    .sort((a, b) => a.anchor - b.anchor || readingOrder(a.node, b.node));
  let zone3Y = LAYOUT_ORIGIN.y;
  for (const { node, anchor } of zone3Anchored) {
    const y = Number.isFinite(anchor) ? Math.max(anchor, zone3Y) : zone3Y;
    positions.set(node.id, { x: columnX[3], y });
    zone3Y = y + (heightOf.get(node.id) ?? 220) + STACK_GAP;
  }

  return {
    positions,
    result: { zone1: zone1.length, zone2: zone2.length, zone3: zone3.length },
  };
}

/**
 * Hueco libre para un bloque nuevo justo a la derecha del nodo de referencia,
 * bajando en esa misma columna si ya hay otros textos ahí.
 */
function findSlotRightOf(
  nodes: EngineeringNodeData[],
  anchor: EngineeringNodeData,
  newHeight: number
): { x: number; y: number } {
  const x = anchor.position.x + CANVAS_NODE_WIDTH + ZONE_GUTTER;
  let y = anchor.position.y;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const candidate = { x, y, w: CANVAS_NODE_WIDTH, h: newHeight };
    const blocker = nodes.find((node) =>
      rectsOverlap(candidate, {
        x: node.position.x,
        y: node.position.y,
        w: CANVAS_NODE_WIDTH,
        h: estimateNodeHeight(node),
      })
    );
    if (!blocker) return { x, y };
    y = blocker.position.y + estimateNodeHeight(blocker) + STACK_GAP;
  }
  return { x, y };
}

/** Libera la memoria de un archivo local cuando ya no se usa. */
export function revokeLocalFileUrl(url: string | undefined): void {
  if (!url || !url.startsWith("blob:")) return;
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(url);
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ============================================================================
// 3. DATOS INICIALES DE DEMOSTRACIÓN (uno de cada tipo, caso real de ingeniería)
//    Caso: nudo reticular tipo K con perfiles HSS 101.6 × 101.6 × 6.4 mm
//    de acero ASTM A500 Grado C (Fy = 345 MPa, A = 2170 mm²).
// ============================================================================

/**
 * Archivo real incrustado para que la descarga funcione desde el primer
 * segundo: curva esfuerzo–deformación de un ensayo de tracción.
 */
const DEMO_TENSILE_TEST_CSV = [
  "deformacion_mm_mm,esfuerzo_MPa,carga_kN",
  "0.0000,0.0,0.0",
  "0.0002,40.0,86.8",
  "0.0004,80.0,173.6",
  "0.0006,120.0,260.4",
  "0.0008,160.0,347.2",
  "0.0010,200.0,434.0",
  "0.0012,240.0,520.8",
  "0.0014,280.0,607.6",
  "0.0016,320.0,694.4",
  "0.0017,340.0,737.8",
  "0.0020,345.0,748.7",
  "0.0030,345.2,749.1",
  "0.0050,345.5,749.8",
  "0.0100,346.4,751.6",
  "0.0200,348.0,755.2",
  "0.0400,370.7,804.5",
  "0.0600,389.3,844.8",
  "0.0800,403.9,876.5",
  "0.1000,414.8,900.0",
  "0.1300,424.3,920.8",
  "0.1600,427.0,926.6",
  "0.1900,410.7,891.2",
  "0.2100,386.1,837.8",
  "0.2300,352.0,763.8",
  "",
].join("\r\n");

export const INITIAL_NODES: EngineeringNodeData[] = [
  // --- NODO TIPO 1: Archivo descargable -----------------------------------
  {
    id: "node-1",
    type: "file-node",
    title: "Ensayo de Tracción • Probeta 03",
    codeTag: "CSV",
    position: { x: 48, y: 160 },
    updatedAt: "Hace 2 min",
    fileData: {
      fileName: "ensayo_traccion_ASTM-A500-GrC_probeta-03.csv",
      extension: "csv",
      fileSizeBytes: utf8ByteLength(DEMO_TENSILE_TEST_CSV),
      mimeType: "text/csv",
      downloadUrl: `data:text/csv;charset=utf-8,${encodeURIComponent(
        DEMO_TENSILE_TEST_CSV
      )}`,
      status: "ready",
      uploadProgress: 100,
    },
  },

  // --- NODO TIPO 2: Cuaderno de notas + boceto ----------------------------
  {
    id: "node-2",
    type: "sketch-note-node",
    title: "Bitácora de Diseño • Nudo K",
    codeTag: "NOTE-v1",
    position: { x: 888, y: 136 },
    updatedAt: "Hace 8 min",
    sketchNoteData: {
      richTextHtml:
        "<h2>Nudo reticular tipo K</h2>" +
        "<p>Cuerda y diagonales en HSS 101.6 × 101.6 × 6.4 mm, acero ASTM A500 Gr. C. Separación entre diagonales g = 25 mm para permitir la soldadura de filete perimetral.</p>" +
        "<ul><li>Ángulo de diagonales: 45° respecto a la cuerda.</li></ul>",
      textBlocks: [
        { id: "blk-1", type: "heading", text: "Nudo reticular tipo K" },
        {
          id: "blk-2",
          type: "paragraph",
          text: "Cuerda y diagonales en HSS 101.6 × 101.6 × 6.4 mm, acero ASTM A500 Gr. C. Separación entre diagonales g = 25 mm para permitir la soldadura de filete perimetral.",
        },
        {
          id: "blk-3",
          type: "bullet",
          text: "Ángulo de diagonales: 45° respecto a la cuerda.",
        },
      ],
      checklistItems: [
        { id: "chk-1", text: "Verificar plastificación de la cara de la cuerda", checked: true },
        { id: "chk-2", text: "Revisar soldadura de filete E70XX de 6 mm", checked: true },
        { id: "chk-3", text: "Confirmar excentricidad del nudo e ≤ 0.25·H", checked: false },
        { id: "chk-4", text: "Enviar plano de taller a fabricación", checked: false },
      ],
      strokes: [
        {
          // Cuerda inferior
          id: "stk-1",
          tool: "pen",
          color: "var(--text-primary)",
          width: 2.5,
          points: [
            { x: 16, y: 122 },
            { x: 80, y: 121 },
            { x: 144, y: 122 },
            { x: 208, y: 121 },
            { x: 272, y: 122 },
          ],
        },
        {
          // Diagonal izquierda
          id: "stk-2",
          tool: "pen",
          color: "var(--text-primary)",
          width: 2.5,
          points: [
            { x: 132, y: 120 },
            { x: 108, y: 92 },
            { x: 82, y: 62 },
            { x: 58, y: 34 },
          ],
        },
        {
          // Diagonal derecha
          id: "stk-3",
          tool: "pen",
          color: "var(--text-primary)",
          width: 2.5,
          points: [
            { x: 156, y: 120 },
            { x: 180, y: 92 },
            { x: 206, y: 62 },
            { x: 230, y: 34 },
          ],
        },
        {
          // Resaltado de la zona de soldadura
          id: "stk-4",
          tool: "highlighter",
          color: "var(--accent-primary)",
          width: 10,
          points: [
            { x: 118, y: 116 },
            { x: 144, y: 114 },
            { x: 170, y: 116 },
          ],
        },
      ],
      canvasMode: "split",
      canvasSize: { width: 288, height: 140 },
    },
  },

  // --- NODO TIPO 3: Hoja de cálculo + justificación LaTeX ------------------
  {
    id: "node-3",
    type: "calc-latex-node",
    title: "Verificación Axial • Diagonal",
    codeTag: "CALC-v1",
    position: { x: 468, y: 112 },
    updatedAt: "Hace 5 min",
    calcLatexData: {
      justificationText:
        "La diagonal más cargada trabaja a tracción pura. Se compara el esfuerzo normal con el límite de fluencia del acero ASTM A500 Gr. C obtenido en el ensayo de la probeta 03.",
      latexEquations: [
        {
          id: "eq-1",
          label: "Esfuerzo normal",
          latex:
            "\\sigma = \\frac{P}{A} = \\frac{420\\,000\\ \\text{N}}{2170\\ \\text{mm}^2} = 193.55\\ \\text{MPa}",
          linkedCell: "B4",
        },
        {
          id: "eq-2",
          label: "Factor de seguridad",
          latex: "FS = \\frac{F_y}{\\sigma} = \\frac{345}{193.55} = 1.78",
          linkedCell: "B6",
        },
      ],
      gridCells: {
        A1: { raw: "Magnitud", computed: "Magnitud" },
        B1: { raw: "Valor", computed: "Valor" },
        C1: { raw: "Unidad", computed: "Unidad" },
        A2: { raw: "Carga axial P", computed: "Carga axial P" },
        B2: { raw: "420", computed: "420" },
        C2: { raw: "kN", computed: "kN" },
        A3: { raw: "Área A", computed: "Área A" },
        B3: { raw: "2170", computed: "2170" },
        C3: { raw: "mm²", computed: "mm²" },
        A4: { raw: "Esfuerzo σ", computed: "Esfuerzo σ" },
        B4: { raw: "=B2*1000/B3", computed: "193.55" },
        C4: { raw: "MPa", computed: "MPa" },
        A5: { raw: "Fluencia Fy", computed: "Fluencia Fy" },
        B5: { raw: "345", computed: "345" },
        C5: { raw: "MPa", computed: "MPa" },
        A6: { raw: "Factor seg. FS", computed: "Factor seg. FS" },
        B6: { raw: "=B5/B4", computed: "1.78" },
        C6: { raw: "—", computed: "—" },
      },
      gridSize: { rows: 6, columns: 3 },
    },
  },
];

export const INITIAL_CONNECTIONS: NodeConnection[] = [
  {
    id: "conn-1",
    fromNodeId: "node-1",
    toNodeId: "node-3",
    fromPort: "right",
    toPort: "left",
    label: "Aporta Fy a",
  },
  {
    id: "conn-2",
    fromNodeId: "node-3",
    toNodeId: "node-2",
    fromPort: "right",
    toPort: "left",
    label: "Justifica diseño",
  },
];

// ============================================================================
// 4. STORE
// ============================================================================

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  theme: "dark",

  toggleTheme: () =>
    set((state) => {
      const nextTheme: ThemeMode = state.theme === "dark" ? "light" : "dark";
      if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("dark", nextTheme === "dark");
      }
      return { theme: nextTheme };
    }),

  setTheme: (theme) =>
    set(() => {
      if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("dark", theme === "dark");
      }
      return { theme };
    }),

  nodes: INITIAL_NODES,
  connections: INITIAL_CONNECTIONS,
  selectedNodeId: null,

  connectingFrom: null,
  selectedConnectionId: null,

  activeTool: "pointer",
  canvasTransform: { x: 0, y: 0, scale: 1 },
  zoomExtentsRequest: 0,
  isOracleModalOpen: false,

  canvasStrokes: [],
  inkColor: "adaptive",
  inkTip: "medium",
  inkMode: "pen",
  inkHistory: [],

  mobileCategoryFilter: "all",
  isMiniMapVisible: false,
  activeMobileSheet: "none",

  // --------------------------------------------------------------------------
  // Acciones de Nodos
  // --------------------------------------------------------------------------

  selectNode: (id) => set({ selectedNodeId: id }),

  updateNodePosition: (id, x, y) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, position: { x, y } } : node
      ),
    })),

  spawnNode: (partial) =>
    set((state) => {
      const id = `node-${Date.now()}`;
      const offsetCount = state.nodes.length;
      const position = partial?.position || {
        x: 280 + ((offsetCount * 45) % 260),
        y: 180 + ((offsetCount * 45) % 220),
      };
      const newNode = buildNodeFromInput(partial, id, position);

      return {
        nodes: [newNode, ...state.nodes],
        selectedNodeId: id,
        activeMobileSheet: "none",
        connectingFrom: null,
      };
    }),

  removeNode: (id) =>
    set((state) => {
      const target = state.nodes.find((node) => node.id === id);
      if (target?.type === "file-node") {
        revokeLocalFileUrl(target.fileData.downloadUrl);
      }

      const remainingConnections = state.connections.filter(
        (c) => c.fromNodeId !== id && c.toNodeId !== id
      );
      const selectedStillExists = remainingConnections.some(
        (c) => c.id === state.selectedConnectionId
      );

      return {
        nodes: state.nodes.filter((node) => node.id !== id),
        connections: remainingConnections,
        selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
        selectedConnectionId: selectedStillExists ? state.selectedConnectionId : null,
        connectingFrom:
          state.connectingFrom?.nodeId === id ? null : state.connectingFrom,
      };
    }),

  runNodeSimulation: (id) =>
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== id || !node.metrics) return node;
        const randomStress = (220 + Math.random() * 45).toFixed(1);
        const randomSafety = (1.65 + Math.random() * 0.45).toFixed(2);
        return {
          ...node,
          updatedAt: "Simulado ahora",
          metrics: [
            { id: "m1", label: "Tensión máx", value: `${randomStress} MPa`, status: "normal" },
            {
              id: "m2",
              label: "Factor Seg",
              value: `${randomSafety} (Óptimo)`,
              status: "optimal",
            },
          ],
        };
      }),
    })),

  updateNodePayload: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((node): EngineeringNodeData => {
        if (node.id !== id) return node;

        switch (node.type) {
          case "file-node":
            return {
              ...node,
              updatedAt: "Ahora mismo",
              fileData: { ...node.fileData, ...(patch as Partial<FileNodePayload>) },
            };
          case "sketch-note-node":
            return {
              ...node,
              updatedAt: "Ahora mismo",
              sketchNoteData: {
                ...node.sketchNoteData,
                ...(patch as Partial<SketchNotePayload>),
              },
            };
          case "calc-latex-node":
            return {
              ...node,
              updatedAt: "Ahora mismo",
              calcLatexData: {
                ...node.calcLatexData,
                ...(patch as Partial<CalcLatexPayload>),
              },
            };
        }
      }),
    })),

  updateNodeMeta: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, ...patch, updatedAt: "Ahora mismo" } : node
      ),
    })),

  hydrateWorkspace: (nodes, connections) =>
    set((state) => {
      // Libera los archivos locales del lienzo anterior que ya no se usan.
      const nextUrls = new Set(
        nodes.flatMap((n) => (n.type === "file-node" ? [n.fileData.downloadUrl] : []))
      );
      for (const node of state.nodes) {
        if (node.type === "file-node" && !nextUrls.has(node.fileData.downloadUrl)) {
          revokeLocalFileUrl(node.fileData.downloadUrl);
        }
      }
      return {
        nodes,
        connections,
        selectedNodeId: null,
        selectedConnectionId: null,
        connectingFrom: null,
      };
    }),

  // --------------------------------------------------------------------------
  // Acciones de Conexión
  // --------------------------------------------------------------------------

  startConnecting: (nodeId, port) =>
    set((state) => {
      if (!state.nodes.some((node) => node.id === nodeId)) return {};
      return {
        connectingFrom: {
          nodeId,
          port: port ?? "right",
          autoPort: port === undefined,
        },
        selectedConnectionId: null,
      };
    }),

  cancelConnecting: () => set({ connectingFrom: null }),

  completeConnection: (toNodeId, toPort, label) =>
    set((state) => {
      const draft = state.connectingFrom;
      if (!draft) return {};

      // Un nodo no puede conectarse consigo mismo.
      if (draft.nodeId === toNodeId) return { connectingFrom: null };

      const fromNode = state.nodes.find((node) => node.id === draft.nodeId);
      const toNode = state.nodes.find((node) => node.id === toNodeId);
      if (!fromNode || !toNode) return { connectingFrom: null };

      // Si ese par de nodos ya está unido, no se duplica: se selecciona el cable.
      const existing = state.connections.find(
        (c) =>
          (c.fromNodeId === draft.nodeId && c.toNodeId === toNodeId) ||
          (c.fromNodeId === toNodeId && c.toNodeId === draft.nodeId)
      );
      if (existing) {
        return { connectingFrom: null, selectedConnectionId: existing.id };
      }

      const auto = resolveAutoPorts(fromNode, toNode);
      const cleanLabel = label?.trim();

      const newConnection: NodeConnection = {
        id: `conn-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        fromNodeId: draft.nodeId,
        toNodeId,
        fromPort: draft.autoPort ? auto.fromPort : draft.port,
        toPort: toPort ?? auto.toPort,
        ...(cleanLabel ? { label: cleanLabel } : {}),
      };

      return {
        connections: [...state.connections, newConnection],
        connectingFrom: null,
        // Queda seleccionada para poder escribirle una etiqueta de inmediato.
        selectedConnectionId: newConnection.id,
      };
    }),

  removeConnection: (id) =>
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      selectedConnectionId:
        state.selectedConnectionId === id ? null : state.selectedConnectionId,
    })),

  updateConnectionLabel: (id, label) =>
    set((state) => ({
      connections: state.connections.map((c) => {
        if (c.id !== id) return c;
        const cleanLabel = label.trim();
        return { ...c, label: cleanLabel || undefined };
      }),
    })),

  selectConnection: (id) => set({ selectedConnectionId: id }),

  // --------------------------------------------------------------------------
  // Acciones controladas por el Oráculo IA
  // --------------------------------------------------------------------------

  aiCreateNode: (partial) => {
    const id = nextUniqueId("node");
    set((state) => {
      const position = partial?.position || findFreeCanvasPosition(state.nodes);
      const newNode = buildNodeFromInput(partial, id, position);
      return {
        nodes: [newNode, ...state.nodes],
        selectedNodeId: id,
      };
    });
    return id;
  },

  aiConnectNodes: (fromNodeId, toNodeId, label) =>
    set((state) => {
      if (fromNodeId === toNodeId) return {};
      const fromNode = state.nodes.find((node) => node.id === fromNodeId);
      const toNode = state.nodes.find((node) => node.id === toNodeId);
      if (!fromNode || !toNode) return {};

      const cleanLabel = label?.trim();
      const existing = state.connections.find(
        (c) =>
          (c.fromNodeId === fromNodeId && c.toNodeId === toNodeId) ||
          (c.fromNodeId === toNodeId && c.toNodeId === fromNodeId)
      );
      if (existing) {
        if (!cleanLabel) return { selectedConnectionId: existing.id };
        return {
          connections: state.connections.map((c) =>
            c.id === existing.id ? { ...c, label: cleanLabel } : c
          ),
          selectedConnectionId: existing.id,
        };
      }

      const auto = resolveAutoPorts(fromNode, toNode);
      const newConnection: NodeConnection = {
        id: `conn-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        fromNodeId,
        toNodeId,
        fromPort: auto.fromPort,
        toPort: auto.toPort,
        ...(cleanLabel ? { label: cleanLabel } : {}),
      };

      return {
        connections: [...state.connections, newConnection],
        selectedConnectionId: newConnection.id,
      };
    }),

  aiAutoLayout: () =>
    set((state) => {
      if (state.nodes.length === 0) return {};
      const columns = Math.max(1, Math.ceil(Math.sqrt(state.nodes.length)));
      const step = {
        x: AI_NODE_FOOTPRINT.width + AI_NODE_MARGIN,
        y: AI_NODE_FOOTPRINT.height + AI_NODE_MARGIN,
      };
      const origin = { x: 80, y: 120 };

      // El más viejo primero, para que la cuadrícula se lea en orden natural.
      const ordered = [...state.nodes].reverse();
      const positionById = new Map<string, { x: number; y: number }>();
      ordered.forEach((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        positionById.set(node.id, {
          x: origin.x + col * step.x,
          y: origin.y + row * step.y,
        });
      });

      return {
        nodes: state.nodes.map((node) => ({
          ...node,
          position: positionById.get(node.id) ?? node.position,
        })),
      };
    }),

  aiAnnotateSelected: () =>
    set((state) => {
      const selected = state.nodes.find((node) => node.id === state.selectedNodeId);
      if (!selected) return {};

      const id = nextUniqueId("node");
      const position = findFreeCanvasPosition(state.nodes, {
        x: selected.position.x + AI_NODE_FOOTPRINT.width + AI_NODE_MARGIN,
        y: selected.position.y,
      });
      const newNode: EngineeringNodeData = {
        id,
        type: "sketch-note-node",
        title: `Guía de Impresión 3D • ${selected.title}`,
        codeTag: "AI-PRINT",
        position,
        updatedAt: "Ahora mismo",
        sketchNoteData: build3DPrintAdvice(selected),
      };

      const auto = resolveAutoPorts(selected, newNode);
      const newConnection: NodeConnection = {
        id: `conn-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        fromNodeId: selected.id,
        toNodeId: id,
        fromPort: auto.fromPort,
        toPort: auto.toPort,
        label: "Guía de impresión 3D",
      };

      return {
        nodes: [newNode, ...state.nodes],
        connections: [...state.connections, newConnection],
        selectedNodeId: id,
      };
    }),

  aiCreateTextBlock: (input) => {
    const id = nextUniqueId("node");
    const { textBlocks, checklistItems } = parseAiTextContent(input.content);
    // Nunca queda un bloque vacío: si la IA no mandó texto útil se avisa dentro.
    const blocks: NoteTextBlock[] =
      textBlocks.length > 0 || checklistItems.length > 0
        ? textBlocks
        : [{ id: nextUniqueId("blk"), type: "paragraph", text: "Sin contenido generado." }];

    set((state) => {
      const anchor = input.linkedNodeId
        ? state.nodes.find((n) => n.id === input.linkedNodeId)
        : undefined;

      const draft: SketchNoteEngineeringNode = {
        id,
        type: "sketch-note-node",
        title: input.title.trim().slice(0, 120) || "Bloque de texto IA",
        codeTag: input.codeTag || "AI-TEXT",
        position: { x: 0, y: 0 },
        updatedAt: "Ahora mismo",
        sketchNoteData: {
          ...createEmptySketchNotePayload(),
          canvasMode: "text",
          textBlocks: blocks,
          checklistItems,
          richTextHtml: textBlocksToHtml(blocks),
        },
      };
      const height = estimateNodeHeight(draft);
      const newNode: EngineeringNodeData = {
        ...draft,
        position: anchor
          ? findSlotRightOf(state.nodes, anchor, height)
          : findFreeCanvasPosition(state.nodes),
      };

      if (!anchor) return { nodes: [newNode, ...state.nodes] };

      const auto = resolveAutoPorts(anchor, newNode);
      const label = input.connectionLabel?.trim() || "Referencia de";
      const newConnection: NodeConnection = {
        id: nextUniqueId("conn"),
        fromNodeId: anchor.id,
        toNodeId: id,
        fromPort: auto.fromPort,
        toPort: auto.toPort,
        label: label.slice(0, 60),
      };
      return {
        nodes: [newNode, ...state.nodes],
        connections: [...state.connections, newConnection],
      };
    });
    return id;
  },

  aiUpdateNodeNote: (nodeId, content, mode = "append") => {
    const target = get().nodes.find((n) => n.id === nodeId);
    const clean = content.trim();
    if (!target || !clean) return false;

    set((state) => ({
      nodes: state.nodes.map((node): EngineeringNodeData => {
        if (node.id !== nodeId) return node;

        if (node.type === "sketch-note-node") {
          const parsed = parseAiTextContent(clean);
          const data = node.sketchNoteData;
          const textBlocks =
            mode === "replace" ? parsed.textBlocks : [...data.textBlocks, ...parsed.textBlocks];
          const checklistItems =
            mode === "replace"
              ? parsed.checklistItems
              : [...data.checklistItems, ...parsed.checklistItems];
          return {
            ...node,
            updatedAt: "Ahora mismo",
            sketchNoteData: {
              ...data,
              textBlocks,
              checklistItems,
              richTextHtml: textBlocksToHtml(textBlocks),
            },
          };
        }

        if (node.type === "calc-latex-node") {
          const prev = node.calcLatexData.justificationText.trim();
          return {
            ...node,
            updatedAt: "Ahora mismo",
            calcLatexData: {
              ...node.calcLatexData,
              justificationText:
                mode === "replace" || !prev ? clean : `${prev}\n\n${clean}`,
            },
          };
        }

        // Archivo: el texto vive en la descripción visible del nodo.
        const prev = node.summary?.trim() ?? "";
        return {
          ...node,
          updatedAt: "Ahora mismo",
          summary: (mode === "replace" || !prev ? clean : `${prev}\n${clean}`).slice(0, 1200),
        };
      }),
    }));
    return true;
  },

  aiApplyHumanLayout: (assignments) => {
    const { nodes, connections } = get();
    const { positions, result } = computeHumanLayout(nodes, connections, assignments);
    if (nodes.length === 0) return result;

    set((state) => ({
      nodes: state.nodes.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      }),
      // Se lleva la vista al inicio del lienzo para ver las zonas completas.
      canvasTransform: { x: 0, y: 0, scale: state.canvasTransform.scale },
    }));
    return result;
  },

  // --------------------------------------------------------------------------
  // Acciones de Herramientas y Navegación
  // --------------------------------------------------------------------------

  setActiveTool: (tool) =>
    set(() => {
      if (tool === "oracle") {
        return {
          activeTool: tool,
          isOracleModalOpen: true,
          activeMobileSheet: "oracle",
          connectingFrom: null,
        };
      }
      if (tool === "draw") {
        // El Lápiz no selecciona nodos ni cables: se limpia la selección.
        return {
          activeTool: tool,
          connectingFrom: null,
          selectedNodeId: null,
          selectedConnectionId: null,
        };
      }
      // Al cambiar de herramienta se descarta cualquier cable a medio trazar.
      return { activeTool: tool, connectingFrom: null };
    }),

  setCanvasTransform: (transform) => set({ canvasTransform: transform }),

  resetCanvasView: () => set({ canvasTransform: { x: 0, y: 0, scale: 1 } }),

  zoomCanvasAt: (scale, anchor) =>
    set((state) => {
      const current = state.canvasTransform;
      const nextScale = clampCanvasScale(scale);
      if (nextScale === current.scale) return {};
      const point =
        anchor ??
        (typeof window !== "undefined"
          ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
          : { x: 0, y: 0 });
      const ratio = nextScale / current.scale;
      return {
        canvasTransform: {
          x: point.x - (point.x - current.x) * ratio,
          y: point.y - (point.y - current.y) * ratio,
          scale: nextScale,
        },
      };
    }),

  requestZoomExtents: () =>
    set((state) => ({ zoomExtentsRequest: state.zoomExtentsRequest + 1 })),

  // --------------------------------------------------------------------------
  // Tinta libre sobre el lienzo (Lápiz D)
  // --------------------------------------------------------------------------

  // Elegir color o punta vuelve a la punta de dibujo (sale del Borrador).
  setInkColor: (color) => set({ inkColor: color, inkMode: "pen" }),

  setInkTip: (tip) => set({ inkTip: tip, inkMode: "pen" }),

  setInkMode: (mode) => set({ inkMode: mode }),

  addCanvasStroke: (stroke) =>
    set((state) => {
      if (stroke.points.length === 0) return {};
      const entry: InkHistoryEntry = { kind: "add", strokeId: stroke.id };
      return {
        canvasStrokes: [...state.canvasStrokes, stroke],
        inkHistory: [...state.inkHistory, entry].slice(-INK_HISTORY_LIMIT),
      };
    }),

  eraseCanvasStrokes: (ids) =>
    set((state) => {
      const remove = new Set(ids);
      const erased: { stroke: CanvasStroke; index: number }[] = [];
      state.canvasStrokes.forEach((stroke, index) => {
        if (remove.has(stroke.id)) erased.push({ stroke, index });
      });
      if (erased.length === 0) return {};
      const entry: InkHistoryEntry = { kind: "erase", strokes: erased };
      return {
        canvasStrokes: state.canvasStrokes.filter((s) => !remove.has(s.id)),
        inkHistory: [...state.inkHistory, entry].slice(-INK_HISTORY_LIMIT),
      };
    }),

  undoCanvasInk: () =>
    set((state) => {
      const history = [...state.inkHistory];
      // Salta pasos que ya no aplican (ej. trazos reemplazados al cargar la nube).
      while (history.length > 0) {
        const last = history.pop()!;
        if (last.kind === "add") {
          if (!state.canvasStrokes.some((s) => s.id === last.strokeId)) continue;
          return {
            canvasStrokes: state.canvasStrokes.filter((s) => s.id !== last.strokeId),
            inkHistory: history,
          };
        }
        const restored = [...state.canvasStrokes];
        const sorted = [...last.strokes].sort((a, b) => a.index - b.index);
        for (const { stroke, index } of sorted) {
          if (restored.some((s) => s.id === stroke.id)) continue;
          restored.splice(Math.min(index, restored.length), 0, stroke);
        }
        return { canvasStrokes: restored, inkHistory: history };
      }
      // Sin historial: deshace el último trazo de la lista (ej. tras recargar).
      if (state.canvasStrokes.length === 0) return { inkHistory: [] };
      return { canvasStrokes: state.canvasStrokes.slice(0, -1), inkHistory: [] };
    }),

  hydrateCanvasStrokes: (strokes) => set({ canvasStrokes: strokes, inkHistory: [] }),

  setOracleModalOpen: (isOpen) =>
    set({
      isOracleModalOpen: isOpen,
      activeMobileSheet: isOpen ? "oracle" : "none",
    }),

  // --------------------------------------------------------------------------
  // Acciones Exclusivas de Ergonomía Móvil
  // --------------------------------------------------------------------------

  setMobileCategoryFilter: (filter) => set({ mobileCategoryFilter: filter }),

  toggleMiniMap: () =>
    set((state) => ({ isMiniMapVisible: !state.isMiniMapVisible })),

  setActiveMobileSheet: (sheet) =>
    set((state) => ({
      activeMobileSheet: sheet,
      isOracleModalOpen: sheet === "oracle",
      // Cerrar el menú táctil de conexión cancela la conexión en curso.
      connectingFrom: sheet === "connect" ? state.connectingFrom : null,
    })),
}));
