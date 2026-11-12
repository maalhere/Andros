// ============================================================================
// ANDROS — CONTRATOS TYPESCRIPT DEL ESPACIO DE TRABAJO (ETAPA 1 · PARTE A)
// Fuente única de verdad para Nodos, Payloads, Puertos y Conexiones.
// ============================================================================

// ----------------------------------------------------------------------------
// 1. Entorno y herramientas
// ----------------------------------------------------------------------------

export type ThemeMode = "light" | "dark";

export type ViewportMode = "desktop" | "mobile";

export type ActiveTool = "pointer" | "add-node" | "connect" | "library" | "oracle";

export type MobileSheetType =
  | "none"
  | "oracle"
  | "new-node"
  | "library"
  | "node-detail"
  | "connect";

// ----------------------------------------------------------------------------
// 2. Los 3 Nodos Definitivos de Andros
// ----------------------------------------------------------------------------

/** Los 3 arquetipos oficiales de nodo. */
export type NodeArchetype = "file-node" | "sketch-note-node" | "calc-latex-node";

/**
 * Alias de compatibilidad: los archivos de la Fase 0 importaban `NodeCategory`.
 * Ahora equivale exactamente a los 3 arquetipos oficiales.
 */
export type NodeCategory = NodeArchetype;

/**
 * Categorías de prueba de la Fase 0. Ya no existen como tipo de nodo, pero
 * `spawnNode` todavía las acepta y las traduce al arquetipo equivalente para
 * que `FloatingHudDock.tsx` y `OracleModal.tsx` sigan funcionando sin cambios.
 */
export type LegacyNodeCategory = "calculation" | "oracle" | "cad" | "reference";

export interface TelemetryMetric {
  id: string;
  label: string;
  value: string;
  status?: "normal" | "optimal" | "warning";
}

// ----------------------------------------------------------------------------
// 3. Puertos magnéticos y conexiones
// ----------------------------------------------------------------------------

/** Lado del nodo donde vive un puerto de conexión. */
export type PortPosition = "top" | "right" | "bottom" | "left";

/** Alias usado en el documento maestro de arquitectura. */
export type PortSide = PortPosition;

/** Orden estable para dibujar los 4 puertos de un nodo. */
export const PORT_POSITIONS: readonly PortPosition[] = [
  "top",
  "right",
  "bottom",
  "left",
];

/** Conexión dirigida entre dos nodos, anclada a un puerto de cada uno. */
export interface NodeConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromPort: PortPosition;
  toPort: PortPosition;
  label?: string;
}

/**
 * Conexión en curso (el usuario ya eligió el origen y aún no el destino).
 * - PC: se crea al presionar un puerto; el cable SVG sigue al cursor.
 * - Móvil: se crea al tocar "Conectar" en una tarjeta.
 */
export interface ConnectionDraft {
  nodeId: string;
  port: PortPosition;
  /**
   * `true` cuando el origen se eligió sin puerto explícito (menú táctil o
   * herramienta Conectar). Al completar, ambos puertos se calculan solos
   * según la posición relativa de los dos nodos.
   */
  autoPort: boolean;
}

// ----------------------------------------------------------------------------
// 4. NODO TIPO 1 — Archivo Descargable Universal (`file-node`)
// ----------------------------------------------------------------------------

export type FileTransferStatus = "empty" | "uploading" | "ready" | "error";

export interface FileNodePayload {
  /** Nombre completo con extensión, ej. "Nudo_K_v2.4.step". Vacío si no hay archivo. */
  fileName: string;
  /** Extensión en minúsculas y sin punto, ej. "step". Vacío si no tiene. */
  extension: string;
  /** Peso exacto en bytes. */
  fileSizeBytes: number;
  /** Tipo MIME informado por el sistema, ej. "application/pdf". */
  mimeType: string;
  /**
   * URL de descarga directa. En local es una URL `blob:` creada con
   * `URL.createObjectURL` (o `data:` en la demo). En la Etapa 4 será una URL
   * firmada de Supabase Storage.
   */
  downloadUrl: string;
  /** Estado de la barra de estado del nodo. */
  status: FileTransferStatus;
  /** Progreso de lectura/subida por fragmentos, de 0 a 100. */
  uploadProgress: number;
  /** Suma de verificación del contenido, ej. "crc32:9f3a11c2". */
  checksum?: string;
  /** Fecha de última modificación del archivo original (ms desde época Unix). */
  lastModifiedMs?: number;
  /** Mensaje legible cuando `status` es "error". */
  errorMessage?: string;
  /** Ruta en el bucket `workspace-files` (se llenará en la Etapa 4). */
  storagePath?: string;
}

// ----------------------------------------------------------------------------
// 5. NODO TIPO 2 — Cuaderno Híbrido Word + Samsung Notes (`sketch-note-node`)
// ----------------------------------------------------------------------------

export type NoteTextBlockType = "heading" | "paragraph" | "bullet";

/** Bloque de texto estructurado (la mitad "Microsoft Word" del nodo). */
export interface NoteTextBlock {
  id: string;
  type: NoteTextBlockType;
  text: string;
}

/** Ítem de lista de verificación. */
export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export type SketchTool = "pen" | "highlighter" | "eraser";

/** Punto de un trazo, en coordenadas del lienzo de dibujo del nodo. */
export interface SketchPoint {
  x: number;
  y: number;
  /** Presión del stylus de 0 a 1 (opcional; mouse y dedo no la informan). */
  pressure?: number;
}

/** Trazo a mano alzada (la mitad "Samsung Notes" del nodo). */
export interface SketchStroke {
  id: string;
  tool: SketchTool;
  color: string;
  width: number;
  points: SketchPoint[];
}

export type SketchCanvasMode = "text" | "draw" | "split";

export interface SketchNotePayload {
  /** Versión HTML del texto, lista para exportar o renderizar con formato rico. */
  richTextHtml: string;
  /** Bloques de texto ordenados (títulos, párrafos y viñetas). */
  textBlocks: NoteTextBlock[];
  /** Lista de verificación del cuaderno. */
  checklistItems: ChecklistItem[];
  /** Trazos de dibujo libre sobre el lienzo. */
  strokes: SketchStroke[];
  /** Qué mitad del nodo está visible: texto, dibujo o ambas. */
  canvasMode: SketchCanvasMode;
  /** Tamaño lógico del lienzo de dibujo sobre el que se guardan los puntos. */
  canvasSize: { width: number; height: number };
}

// ----------------------------------------------------------------------------
// 6. NODO TIPO 3 — Hoja de Cálculo + LaTeX con IA (`calc-latex-node`)
// ----------------------------------------------------------------------------

/** Celda tipo Excel. La clave en `gridCells` es su dirección: "A1", "B2"... */
export interface SpreadsheetCell {
  /** Lo que el usuario escribió, ej. "=B2*1000/B3" o "245.8". */
  raw: string;
  /** Resultado ya calculado que se muestra en la celda, ej. "193.55". */
  computed: string;
  /** Mensaje si la fórmula falla, ej. "#REF!" o "#DIV/0!". */
  error?: string;
}

/** Ecuación LaTeX que justifica un dato de la hoja. */
export interface LatexEquation {
  id: string;
  label: string;
  latex: string;
  /** Dirección de la celda que esta ecuación justifica, ej. "B4". */
  linkedCell?: string;
  /** `true` si la redactó el asistente IA a partir de lenguaje natural. */
  aiGenerated?: boolean;
}

export interface CalcLatexPayload {
  /** Texto que explica el porqué del cálculo. */
  justificationText: string;
  /** Ecuaciones LaTeX asociadas a la hoja. */
  latexEquations: LatexEquation[];
  /** Celdas con contenido, indexadas por dirección ("A1", "B2"...). */
  gridCells: Record<string, SpreadsheetCell>;
  /** Tamaño visible de la cuadrícula. */
  gridSize: { rows: number; columns: number };
}

// ----------------------------------------------------------------------------
// 7. Nodo de ingeniería (unión estricta de los 3 tipos)
// ----------------------------------------------------------------------------

/** Campos comunes a cualquier nodo. */
export interface EngineeringNodeBase {
  id: string;
  title: string;
  codeTag: string; // ej. "STEP", "NOTE-v1", "CALC-v1"
  summary?: string;
  metrics?: TelemetryMetric[];
  actionLabel?: string;
  position: {
    x: number;
    y: number;
  };
  updatedAt: string;
}

export interface FileEngineeringNode extends EngineeringNodeBase {
  type: "file-node";
  fileData: FileNodePayload;
  sketchNoteData?: undefined;
  calcLatexData?: undefined;
}

export interface SketchNoteEngineeringNode extends EngineeringNodeBase {
  type: "sketch-note-node";
  sketchNoteData: SketchNotePayload;
  fileData?: undefined;
  calcLatexData?: undefined;
}

export interface CalcLatexEngineeringNode extends EngineeringNodeBase {
  type: "calc-latex-node";
  calcLatexData: CalcLatexPayload;
  fileData?: undefined;
  sketchNoteData?: undefined;
}

/**
 * Un nodo es exactamente uno de los 3 tipos. Al comprobar `node.type`,
 * TypeScript garantiza que su payload existe (sin `?` ni `undefined`).
 */
export type EngineeringNodeData =
  | FileEngineeringNode
  | SketchNoteEngineeringNode
  | CalcLatexEngineeringNode;

/** Cambios parciales aceptados por `updateNodePayload`. */
export type NodePayloadPatch =
  | Partial<FileNodePayload>
  | Partial<SketchNotePayload>
  | Partial<CalcLatexPayload>;

/** Campos de cabecera editables con `updateNodeMeta`. */
export type NodeMetaPatch = Partial<
  Pick<EngineeringNodeBase, "title" | "codeTag" | "summary" | "actionLabel">
>;

/**
 * Datos opcionales para crear un nodo con `spawnNode`. Acepta los 3 tipos
 * nuevos y también las 4 categorías antiguas de la Fase 0.
 */
export interface SpawnNodeInput {
  type?: NodeArchetype | LegacyNodeCategory;
  title?: string;
  codeTag?: string;
  summary?: string;
  metrics?: TelemetryMetric[];
  actionLabel?: string;
  position?: { x: number; y: number };
  fileData?: Partial<FileNodePayload>;
  sketchNoteData?: Partial<SketchNotePayload>;
  calcLatexData?: Partial<CalcLatexPayload>;
}
