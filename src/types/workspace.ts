// ============================================================================
// ANDROS — CONTRATOS TYPESCRIPT DEL ESPACIO DE TRABAJO (ETAPA 1 · PARTE A)
// Fuente única de verdad para Nodos, Payloads, Puertos y Conexiones.
// ============================================================================

import type { ResourceCitationData } from "./library";

// ----------------------------------------------------------------------------
// 1. Entorno y herramientas
// ----------------------------------------------------------------------------

export type ThemeMode = "light" | "dark";

export type ViewportMode = "desktop" | "mobile";

export type ActiveTool =
  | "pointer"
  | "add-node"
  | "connect"
  | "library"
  | "oracle"
  | "draw";

// ----------------------------------------------------------------------------
// 1b. Tinta libre sobre el lienzo (Lápiz D · estilo Samsung Notes)
// ----------------------------------------------------------------------------

/**
 * Color de la tinta. "adaptive" es Grafito en modo claro y Blanco en modo
 * oscuro (se pinta con `var(--text-primary)`); el resto son hexadecimales.
 */
export type CanvasInkColor = "adaptive" | "#C95A3B" | "#3B82F6" | "#10B981";

/** Punta del lápiz: fino 2px, medio 4px o resaltador 10px semitransparente. */
export type CanvasInkTip = "fine" | "medium" | "highlighter";

/** Sub-herramienta activa mientras el Lápiz está encendido. */
export type CanvasInkMode = "pen" | "eraser";

/** Punto de un trazo libre en coordenadas del lienzo (no de la pantalla). */
export interface CanvasStrokePoint {
  x: number;
  y: number;
  /** Presión 0–1. Solo existe si el dispositivo la informa (S-Pen, Apple Pencil). */
  p?: number;
}

/** Trazo libre dibujado directamente sobre el fondo infinito del lienzo. */
export interface CanvasStroke {
  id: string;
  color: CanvasInkColor;
  tip: CanvasInkTip;
  /** Grosor base en unidades del lienzo (a 100 % de zoom equivale a píxeles). */
  width: number;
  /** `true` si el trazo se hizo con un stylus que informa presión. */
  pressure: boolean;
  points: CanvasStrokePoint[];
}

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

/** Los arquetipos oficiales de nodo. */
export type NodeArchetype =
  | "file-node"
  | "sketch-note-node"
  | "calc-latex-node"
  | "resource-link-node"
  | "code-lab-node"
  | "ai-chat-node"
  | "form-sheet-node"
  | "formula-sheet-node";

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
  /**
   * Ruta del archivo en el bucket `print-files` de Supabase Storage. La llena
   * `useCloudSync` al terminar la subida; vacía en modo local.
   */
  storagePath?: string;
  /**
   * Dimensiones reales del modelo 3D (caja envolvente) en milímetros. Las mide
   * el visor 3D al cargar la pieza y se guardan para que el Oráculo IA pueda
   * razonar sobre el tamaño real sin volver a abrir el archivo.
   */
  modelDimensionsMm?: { widthMm: number; depthMm: number; heightMm: number };
  /**
   * Escala de la pieza 3D por eje [X, Y, Z] (1 = 100 %, de 0.1 a 5). Cuando
   * existe, `modelDimensionsMm` ya guarda las medidas escaladas, que son las
   * que reciben los CodeLab (model_x/y/z) y el chat IA conectados.
   */
  scale?: [number, number, number];
  /** Soportes automáticos (45°) activados para imprimir y exportar el .stl. */
  autoSupports?: boolean;
  /**
   * Versión del contenido geométrico de la pieza. Sube cada vez que cambian la
   * escala o las medidas: los CodeLab y chats IA conectados la usan para saber
   * que deben releer `model_x/y/z` y el contexto, aunque el redondeo coincida.
   */
  contentVersion?: number;
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
// 6b. NODO TIPO 4 — Enlace / Fuente Externa (`resource-link-node`)
//     YouTube, GitHub, papers (arXiv/DOI/OpenAlex) y perfiles (LinkedIn, etc.)
// ----------------------------------------------------------------------------

/** Plataforma detectada automáticamente al pegar la URL. */
export type ResourceLinkPlatform =
  | "youtube"
  | "github"
  | "paper"
  | "linkedin"
  | "generic";

export type ResourceLinkStatus = "idle" | "loading" | "ready" | "error";

/** Metadatos de un video embebido de YouTube. */
export interface ResourceYouTubeData {
  videoId: string;
}

/** Metadatos consultados en la API pública de GitHub. */
export interface ResourceGitHubData {
  owner: string;
  repo: string;
  description: string;
  stars: number;
  language: string;
  htmlUrl: string;
}

/** Metadatos de un paper científico extraídos de `/api/link-preview`. */
export interface ResourcePaperData {
  title: string;
  authors: string;
  source: string;
  summary: string;
}

export interface ResourceLinkPayload {
  /** URL exactamente como la pegó el usuario. */
  url: string;
  platform: ResourceLinkPlatform;
  status: ResourceLinkStatus;
  /** Título legible (de YouTube, GitHub, el paper o el og:title genérico). */
  title?: string;
  /** Resumen/descripción corta para que el Oráculo IA la pueda leer. */
  description?: string;
  siteName?: string;
  imageUrl?: string;
  errorMessage?: string;
  youtube?: ResourceYouTubeData;
  github?: ResourceGitHubData;
  paper?: ResourcePaperData;
  /**
   * Metadatos de cita (DOI, autores, año, APA/IEEE). Solo existe si el nodo se
   * creó desde la Biblioteca de fuentes; viaja al contexto de los Nodos IA.
   */
  citation?: ResourceCitationData;
}

// ----------------------------------------------------------------------------
// 6c. NODO TIPO 5 — Laboratorio de Código / Cálculo Rápido (`code-lab-node`)
//     Ejecutor ligero tipo MATLAB, 100% en el navegador (sin servidor externo).
// ----------------------------------------------------------------------------

/** Una variable numérica o vector resultante de ejecutar el código. */
export type CodeLabValue = number | number[];

export interface CodeLabPlotData {
  x: number[];
  y: number[];
  xLabel?: string;
  yLabel?: string;
}

export interface CodeLabRunResult {
  /** Variables definidas al terminar la ejecución (nombre → valor). */
  variables: Record<string, CodeLabValue>;
  /** Líneas de salida, en orden (resultado de cada expresión suelta). */
  logs: string[];
  /** Última gráfica dibujada con `plot(x, y)`, si el código la generó. */
  plot?: CodeLabPlotData;
  /** Mensaje de error si la última ejecución falló (sintaxis o cálculo). */
  errorMessage?: string;
}

export interface CodeLabPayload {
  /** Código fuente tal como lo escribió el usuario. */
  code: string;
  /** Resultado de la última ejecución (o `undefined` si nunca se ejecutó). */
  result?: CodeLabRunResult;
  /** Marca de tiempo legible de la última ejecución. */
  lastRunAt?: string;
}

// ----------------------------------------------------------------------------
// 6d. NODO TIPO 6 — Conversación IA (`ai-chat-node`)
//     Chat con Gemini / Claude / ChatGPT que lee el contenido vivo de los nodos
//     conectados aguas arriba; puede venir importado de un chat externo.
// ----------------------------------------------------------------------------

export type AiProvider = "gemini" | "openai" | "anthropic";

/** Plataforma de la que se importó una conversación. */
export type AiChatSourcePlatform = "chatgpt" | "claude" | "gemini" | "other";

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Marca de tiempo (ms). */
  at: number;
  /** Mensaje traído de una conversación externa (no generado aquí). */
  imported?: boolean;
  /** Turno automático de "Resincronizar" tras un cambio de contexto. */
  resync?: boolean;
  /** Modelo que respondió (solo respuestas generadas en Andros). */
  model?: string;
}

export interface AiChatSource {
  platform: AiChatSourcePlatform;
  /** Enlace público compartido, si se importó desde una URL. */
  url?: string;
  title?: string;
  /** Fecha legible de la última importación / actualización. */
  importedAt: string;
  importedCount: number;
}

export interface AiChatPayload {
  provider: AiProvider;
  /** Modelo elegido ("auto" = cadena de respaldo del servidor en Gemini). */
  model: string;
  messages: AiChatMessage[];
  /** Resumen corto de la conversación que se muestra en el lienzo. */
  summary?: string;
  status: "idle" | "thinking" | "error";
  errorMessage?: string;
  /**
   * Huella del contexto aguas arriba con el que se respondió por última vez.
   * Si el contexto actual tiene otra huella, el nodo muestra "Contexto
   * actualizado · Resincronizar" (nunca se llama a la IA sin permiso).
   */
  contextFingerprint?: string;
  source?: AiChatSource;
}

// ----------------------------------------------------------------------------
// 6e. NODO TIPO 7 — Ficha estructurada con fotos (`form-sheet-node`)
//     Formatos replicables (historial clínico, receta, medición, logística…)
//     con campos tipados. Cada campo tiene un `fieldKey` limpio en snake_case
//     para poder usarlo más adelante como variable de fórmulas LaTeX reactivas.
// ----------------------------------------------------------------------------

export type FormFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "photo";

/**
 * Imagen adjunta, ya comprimida en el navegador (máx. 1280 px, WebP o JPEG).
 * Se guarda como `data:` dentro de la ficha: viaja con el espacio a la nube,
 * a la Vista Invitado y a la exportación sin depender de otro servicio.
 */
export interface FormPhoto {
  id: string;
  /** Imagen completa (`data:image/webp;base64,…`), lado mayor ≤ 1280 px. */
  src: string;
  /** Miniatura ligera (lado mayor ≤ 320 px) para la tarjeta y la sala en vivo. */
  thumb: string;
  /** Nombre original del archivo (o «Imagen pegada»). */
  name: string;
  width: number;
  height: number;
  /** Peso aproximado de `src` en bytes. */
  bytes: number;
}

/** Valor de un campo: texto/fecha/lista → string, número → number, casilla → boolean. */
export type FormFieldValue = string | number | boolean | null;

export interface FormField {
  id: string;
  /** Identificador limpio en snake_case, p. ej. `peso_kg`, `dosis_mg`, `asistentes`. */
  fieldKey: string;
  label: string;
  type: FormFieldType;
  value: FormFieldValue;
  /** Unidad opcional, p. ej. `kg`, `mmHg`, `USD`. */
  unit?: string;
  /** Opciones de la lista desplegable (solo `select`). */
  options?: string[];
  /** Fotos del campo (solo `photo`). */
  photos?: FormPhoto[];
  /** Dato incompleto o dudoso tras el auto-llenado: el usuario debe revisarlo. */
  needsReview?: boolean;
}

export interface FormSheetPayload {
  /** Formato de la librería del que salió la ficha (o "custom"). */
  templateId: string;
  /** Categoría libre: «Salud», «Técnico», «Logística»… */
  category: string;
  fields: FormField[];
  /** Adjuntos visuales generales de la ficha (además de los campos «foto»). */
  attachments: FormPhoto[];
  /** Expediente o lote al que pertenece (fichas llenadas juntas por la IA). */
  batchLabel?: string;
  /** `true` si la llenó el auto-llenado IA (se muestra «Llenada con IA»). */
  aiFilled?: boolean;
  /** (Sprint 18) Área de trabajo nominal responsable de la ficha («Logística»…). */
  area?: string;
  /** (Sprint 18) Presente solo en las Fichas de Resolución (semáforo Rojo / Verde). */
  resolution?: ResolutionMeta;
}

// ----------------------------------------------------------------------------
// 6e-bis. (Sprint 18) FICHA DE RESOLUCIÓN — trazabilidad estilo CDE
//     Una `form-sheet-node` con `resolution`: código correlativo (RES-001),
//     estado Rojo «Pendiente» / Verde «Completado», área y persona responsable,
//     tarjetas afectadas e historial de quién y cuándo la pasó a Verde.
// ----------------------------------------------------------------------------

export type ResolutionStatus = "pending" | "done";

export interface ResolutionEvent {
  /** ISO 8601. */
  at: string;
  /** Nombre visible de quien hizo el cambio. */
  by: string;
  action: "created" | "completed" | "reopened" | "edited";
  /** (Sprint 24) Qué cambió en una edición («Fecha límite, Área»). */
  detail?: string;
}

export interface ResolutionMeta {
  /** Código correlativo del espacio: «RES-001». */
  code: string;
  status: ResolutionStatus;
  /** Área nominal responsable («Logística») o cadena vacía. */
  area: string;
  assigneeName: string;
  assigneeId: string | null;
  description: string;
  /** Tarjetas a las que afecta (también unidas con cables «Afecta a»). */
  affectedNodeIds: string[];
  /** Alertas unificadas que esta ficha pasó a seguir (dejan de mostrarse como alerta). */
  sourceAlertIds: string[];
  createdAt: string;
  createdBy: string;
  completedAt: string | null;
  completedBy: string | null;
  /** (Sprint 24) Alarma: fecha y hora límite (ISO 8601) o `null` sin fecha. */
  dueAt?: string | null;
  history: ResolutionEvent[];
}

// ----------------------------------------------------------------------------
// 6f. NODO TIPO 8 — Ficha de Fórmula LaTeX reactiva (`formula-sheet-node`)
//     Una fórmula simbólica (KaTeX) + una expresión segura evaluable. Sus
//     variables toman el dato de las fichas conectadas (enlace explícito o
//     auto-emparejado por alias) o el valor escrito a mano. El resultado NO se
//     guarda: se deriva en vivo (0 ms, $0 API) del lienzo en cada cliente.
// ----------------------------------------------------------------------------

/** Campo numérico concreto de otra tarjeta del que una variable toma su valor. */
export interface FormulaSourceBinding {
  nodeId: string;
  /** `fieldKey` de una ficha, dirección de celda («B4») o «resultado» de otra fórmula. */
  fieldKey: string;
}

export interface FormulaVariable {
  /** Identificador seguro usado en `expression` (p. ej. `m`, `h`, `presupuesto`). */
  key: string;
  /** Símbolo LaTeX que se muestra (p. ej. `m`, `\sigma`). */
  symbolLatex: string;
  /** Nombre legible: «Peso corporal». */
  label: string;
  /** Unidad esperada: `kg`, `m`, `USD`… */
  unit?: string;
  /** Claves en snake_case para auto-emparejar con campos de fichas (`peso`, `peso_kg`…). */
  aliases: string[];
  /** Valor escrito a mano (respaldo si ninguna ficha conectada lo aporta). */
  manualValue?: number | null;
  /** Enlace explícito a un campo de una tarjeta conectada. */
  sourceBinding?: FormulaSourceBinding | null;
  /** `true`: usar SIEMPRE el valor manual (sin auto-emparejar). */
  lockManual?: boolean;
}

export interface FormulaSheetPayload {
  /** Expresión simbólica en LaTeX (KaTeX), p. ej. `\text{IMC} = \frac{m}{h^2}`. */
  latex: string;
  /** Expresión evaluable con las `key` de las variables, p. ej. `m / (h ^ 2)`. */
  expression: string;
  resultLabel: string;
  resultUnit: string;
  /** Decimales del resultado (0–6). Por defecto 2. */
  resultDecimals?: number;
  variables: FormulaVariable[];
  /** Explicación corta de para qué sirve (la escribe la IA o la persona). */
  description?: string;
  /** `true` si la generó la IA a partir de lenguaje natural. */
  aiGenerated?: boolean;
}

// ----------------------------------------------------------------------------
// 7. Nodo de ingeniería (unión estricta de los 8 tipos)
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
  resourceLinkData?: undefined;
  codeLabData?: undefined;
  aiChatData?: undefined;
  formSheetData?: undefined;
  formulaSheetData?: undefined;
}

export interface SketchNoteEngineeringNode extends EngineeringNodeBase {
  type: "sketch-note-node";
  sketchNoteData: SketchNotePayload;
  fileData?: undefined;
  calcLatexData?: undefined;
  resourceLinkData?: undefined;
  codeLabData?: undefined;
  aiChatData?: undefined;
  formSheetData?: undefined;
  formulaSheetData?: undefined;
}

export interface CalcLatexEngineeringNode extends EngineeringNodeBase {
  type: "calc-latex-node";
  calcLatexData: CalcLatexPayload;
  fileData?: undefined;
  sketchNoteData?: undefined;
  resourceLinkData?: undefined;
  codeLabData?: undefined;
  aiChatData?: undefined;
  formSheetData?: undefined;
  formulaSheetData?: undefined;
}

export interface ResourceLinkEngineeringNode extends EngineeringNodeBase {
  type: "resource-link-node";
  resourceLinkData: ResourceLinkPayload;
  fileData?: undefined;
  sketchNoteData?: undefined;
  calcLatexData?: undefined;
  codeLabData?: undefined;
  aiChatData?: undefined;
  formSheetData?: undefined;
  formulaSheetData?: undefined;
}

export interface CodeLabEngineeringNode extends EngineeringNodeBase {
  type: "code-lab-node";
  codeLabData: CodeLabPayload;
  fileData?: undefined;
  sketchNoteData?: undefined;
  calcLatexData?: undefined;
  resourceLinkData?: undefined;
  aiChatData?: undefined;
  formSheetData?: undefined;
  formulaSheetData?: undefined;
}

export interface AiChatEngineeringNode extends EngineeringNodeBase {
  type: "ai-chat-node";
  aiChatData: AiChatPayload;
  fileData?: undefined;
  sketchNoteData?: undefined;
  calcLatexData?: undefined;
  resourceLinkData?: undefined;
  codeLabData?: undefined;
  formSheetData?: undefined;
  formulaSheetData?: undefined;
}

export interface FormSheetEngineeringNode extends EngineeringNodeBase {
  type: "form-sheet-node";
  formSheetData: FormSheetPayload;
  fileData?: undefined;
  sketchNoteData?: undefined;
  calcLatexData?: undefined;
  resourceLinkData?: undefined;
  codeLabData?: undefined;
  aiChatData?: undefined;
  formulaSheetData?: undefined;
}

export interface FormulaSheetEngineeringNode extends EngineeringNodeBase {
  type: "formula-sheet-node";
  formulaSheetData: FormulaSheetPayload;
  fileData?: undefined;
  sketchNoteData?: undefined;
  calcLatexData?: undefined;
  resourceLinkData?: undefined;
  codeLabData?: undefined;
  aiChatData?: undefined;
  formSheetData?: undefined;
}

/**
 * Un nodo es exactamente uno de los 8 tipos. Al comprobar `node.type`,
 * TypeScript garantiza que su payload existe (sin `?` ni `undefined`).
 */
export type EngineeringNodeData =
  | FileEngineeringNode
  | SketchNoteEngineeringNode
  | CalcLatexEngineeringNode
  | ResourceLinkEngineeringNode
  | CodeLabEngineeringNode
  | AiChatEngineeringNode
  | FormSheetEngineeringNode
  | FormulaSheetEngineeringNode;

/** Cambios parciales aceptados por `updateNodePayload`. */
export type NodePayloadPatch =
  | Partial<FileNodePayload>
  | Partial<SketchNotePayload>
  | Partial<CalcLatexPayload>
  | Partial<ResourceLinkPayload>
  | Partial<CodeLabPayload>
  | Partial<AiChatPayload>
  | Partial<FormSheetPayload>
  | Partial<FormulaSheetPayload>;

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
  resourceLinkData?: Partial<ResourceLinkPayload>;
  codeLabData?: Partial<CodeLabPayload>;
  aiChatData?: Partial<AiChatPayload>;
  formSheetData?: Partial<FormSheetPayload>;
  formulaSheetData?: Partial<FormulaSheetPayload>;
}
