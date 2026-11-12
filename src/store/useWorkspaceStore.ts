import { create } from "zustand";
import {
  ActiveTool,
  CalcLatexPayload,
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
  PortPosition,
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

  // Acciones de Herramientas y Navegación
  setActiveTool: (tool: ActiveTool) => void;
  setCanvasTransform: (transform: { x: number; y: number; scale: number }) => void;
  resetCanvasView: () => void;
  setOracleModalOpen: (isOpen: boolean) => void;

  // Acciones Exclusivas de Ergonomía Móvil
  setMobileCategoryFilter: (filter: "all" | NodeArchetype) => void;
  toggleMiniMap: () => void;
  setActiveMobileSheet: (sheet: MobileSheetType) => void;
}

// ============================================================================
// 2. UTILIDADES PURAS (exportadas para reutilizarlas en los componentes)
// ============================================================================

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

const INITIAL_NODES: EngineeringNodeData[] = [
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

const INITIAL_CONNECTIONS: NodeConnection[] = [
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

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
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
  isOracleModalOpen: false,

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
      const archetype = resolveNodeArchetype(partial?.type);

      const base: EngineeringNodeBase = {
        id,
        title: partial?.title || DEFAULT_TITLES[archetype],
        codeTag: partial?.codeTag || DEFAULT_TAGS[archetype],
        summary: partial?.summary,
        metrics: partial?.metrics,
        actionLabel: partial?.actionLabel,
        position: partial?.position || {
          x: 280 + ((offsetCount * 45) % 260),
          y: 180 + ((offsetCount * 45) % 220),
        },
        updatedAt: "Ahora mismo",
      };

      let newNode: EngineeringNodeData;

      if (archetype === "file-node") {
        newNode = {
          ...base,
          type: "file-node",
          fileData: { ...createEmptyFilePayload(), ...partial?.fileData },
        };
      } else if (archetype === "sketch-note-node") {
        newNode = {
          ...base,
          type: "sketch-note-node",
          // El texto del resumen pasa a ser el primer párrafo del cuaderno.
          summary: undefined,
          sketchNoteData: {
            ...createEmptySketchNotePayload(partial?.summary),
            ...partial?.sketchNoteData,
          },
        };
      } else {
        newNode = {
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
      // Al cambiar de herramienta se descarta cualquier cable a medio trazar.
      return { activeTool: tool, connectingFrom: null };
    }),

  setCanvasTransform: (transform) => set({ canvasTransform: transform }),

  resetCanvasView: () => set({ canvasTransform: { x: 0, y: 0, scale: 1 } }),

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
