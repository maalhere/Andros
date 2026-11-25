"use client";

import { SNAP_GRID_SIZE, useSettingsStore, type CableStyle } from "@/store/useSettingsStore";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import {
  clampCanvasScale,
  INK_TIP_WIDTHS,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import {
  CanvasStroke,
  CanvasStrokePoint,
  EngineeringNodeData,
  NodeConnection,
  PORT_POSITIONS,
  PortPosition,
} from "@/types/workspace";
import { EngineeringNode } from "@/components/shared/EngineeringNode";
import { ScreenShareLayer } from "@/components/nodes/ScreenShareNode";
import { CollabCursorsLayer } from "@/components/collab/CollabCursorsLayer";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { collectUpstreamContext } from "@/lib/canvas/contextGraph";
import {
  Bounds,
  buildPressureOutline,
  buildSmoothPath,
  getStrokeBounds,
  inkColorToCss,
  isPointNearStroke,
  mergeBounds,
  roundInkValue,
} from "@/lib/canvas/inkGeometry";

// ============================================================================
// GEOMETRÍA DE PUERTOS Y CABLES
// ============================================================================

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface PortTarget {
  nodeId: string;
  port: PortPosition;
}

/** Tamaño de respaldo mientras el navegador todavía no midió el nodo. */
const FALLBACK_NODE_SIZE: Size = { width: 320, height: 200 };

/** Radio (px) dentro del cual un puerto "atrae" el cable como un imán. */
const MAGNET_RADIUS = 36;

/** Movimiento mínimo (px) para considerar que el usuario está arrastrando. */
const DRAG_THRESHOLD = 5;

const PORT_VECTORS: Record<PortPosition, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

function getPortPoint(node: EngineeringNodeData, size: Size, port: PortPosition): Point {
  const { x, y } = node.position;
  switch (port) {
    case "top":
      return { x: x + size.width / 2, y };
    case "right":
      return { x: x + size.width, y: y + size.height / 2 };
    case "bottom":
      return { x: x + size.width / 2, y: y + size.height };
    case "left":
      return { x, y: y + size.height / 2 };
  }
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Puerto del nodo que queda más cerca de un punto del lienzo. */
function getClosestPort(node: EngineeringNodeData, size: Size, point: Point): PortPosition {
  let best: PortPosition = "right";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const port of PORT_POSITIONS) {
    const distance = distanceBetween(getPortPoint(node, size, port), point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = port;
    }
  }
  return best;
}

function isPointInsideNode(node: EngineeringNodeData, size: Size, point: Point): boolean {
  return (
    point.x >= node.position.x &&
    point.x <= node.position.x + size.width &&
    point.y >= node.position.y &&
    point.y <= node.position.y + size.height
  );
}

/**
 * Curva Bézier que sale perpendicular al puerto de origen y entra
 * perpendicular al puerto de destino. Devuelve también su punto medio.
 */
function buildCable(
  start: Point,
  startPort: PortPosition,
  end: Point,
  endPort: PortPosition | null,
  style: CableStyle = "bezier"
): { d: string; mid: Point } {
  if (style === "straight") {
    return {
      d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    };
  }
  if (style === "orthogonal") {
    const stub = 24;
    const sv = PORT_VECTORS[startPort];
    const s1: Point = { x: start.x + sv.x * stub, y: start.y + sv.y * stub };
    const ev = endPort ? PORT_VECTORS[endPort] : null;
    const e1: Point = ev ? { x: end.x + ev.x * stub, y: end.y + ev.y * stub } : end;
    const horizontal = sv.x !== 0;
    const c1: Point = horizontal
      ? { x: (s1.x + e1.x) / 2, y: s1.y }
      : { x: s1.x, y: (s1.y + e1.y) / 2 };
    const c2: Point = horizontal
      ? { x: (s1.x + e1.x) / 2, y: e1.y }
      : { x: e1.x, y: (s1.y + e1.y) / 2 };
    const pts = [start, s1, c1, c2, e1, end];
    return {
      d: pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x} ${q.y}`).join(" "),
      mid: { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 },
    };
  }
  const reach = Math.min(Math.max(distanceBetween(start, end) * 0.4, 36), 160);
  const startVector = PORT_VECTORS[startPort];
  const c1: Point = {
    x: start.x + startVector.x * reach,
    y: start.y + startVector.y * reach,
  };
  const c2: Point = endPort
    ? {
        x: end.x + PORT_VECTORS[endPort].x * reach,
        y: end.y + PORT_VECTORS[endPort].y * reach,
      }
    : end;

  return {
    d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
    mid: {
      x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
      y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
    },
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

// ============================================================================
// CÁMARA ESTILO AUTOCAD (zoom con rueda, paneo con botón central, extents)
// ============================================================================

/** Tamaño de la retícula de puntos a 100 % de zoom (igual que `.canvas-grid`). */
const GRID_SIZE = 28;

/** Ventana (ms) para considerar dos clics de rueda como "doble clic". */
const MIDDLE_DOUBLE_CLICK_MS = 450;

/** Zoom máximo al encuadrar con Zoom Extents (evita acercar en exceso un solo nodo). */
const EXTENTS_MAX_SCALE = 1.5;

/** Márgenes de pantalla que Zoom Extents respeta (barra superior y dock). */
const EXTENTS_PADDING = { side: 80, top: 96, bottom: 132 };

/**
 * `true` si la rueda debe desplazar un contenido interno del nodo (ej. un
 * cuaderno largo) en vez de hacer zoom. Con Ctrl presionado siempre es zoom.
 */
function canScrollInside(target: EventTarget | null, boundary: HTMLElement, deltaY: number): boolean {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== boundary) {
    const style = window.getComputedStyle(element);
    const scrollable =
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 1;
    if (scrollable) {
      const canGoUp = element.scrollTop > 0;
      const canGoDown = element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      if ((deltaY < 0 && canGoUp) || (deltaY > 0 && canGoDown)) return true;
    }
    element = element.parentElement;
  }
  return false;
}

// ============================================================================
// TINTA LIBRE (Lápiz D)
// ============================================================================

/** Opacidad del resaltador (tinta semitransparente). */
const HIGHLIGHTER_OPACITY = 0.35;

interface LiveInkStyle {
  color: string;
  width: number;
  pressure: boolean;
  highlighter: boolean;
}

function newStrokeId(): string {
  return `ink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Dibujo SVG de un trazo guardado (uniforme o con presión). */
function renderStrokeShape(stroke: CanvasStroke): React.ReactElement {
  const color = inkColorToCss(stroke.color);
  const isHighlighter = stroke.tip === "highlighter";
  const outline =
    stroke.pressure && !isHighlighter ? buildPressureOutline(stroke.points, stroke.width) : "";

  if (outline) {
    return <path d={outline} fill={color} stroke="none" />;
  }
  return (
    <path
      d={buildSmoothPath(stroke.points)}
      fill="none"
      stroke={color}
      strokeWidth={stroke.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={isHighlighter ? HIGHLIGHTER_OPACITY : undefined}
    />
  );
}

/** Trazo memorizado: solo se vuelve a calcular si ESE trazo cambia. */
const InkStroke = React.memo(function InkStroke({ stroke }: { stroke: CanvasStroke }) {
  return renderStrokeShape(stroke);
});

// ============================================================================
// PANEL FLOTANTE DE UN CABLE (cambiar etiqueta o borrar)
// ============================================================================

interface ConnectionPopoverProps {
  connection: NodeConnection;
  fromTitle: string;
  toTitle: string;
  onSave: (label: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

const ConnectionPopover: React.FC<ConnectionPopoverProps> = ({
  connection,
  fromTitle,
  toTitle,
  onSave,
  onDelete,
  onClose,
}) => {
  const [draftLabel, setDraftLabel] = useState(connection.label ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draftLabel);
      }}
      className="w-72 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-3 space-y-2.5 cursor-default"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] font-mono text-andros-muted truncate">
          <span className="text-andros-primary">{fromTitle}</span>
          {" → "}
          <span className="text-andros-primary">{toTitle}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          title="Cerrar (Esc)"
          aria-label="Cerrar panel del cable"
          className="shrink-0 p-1 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <input
        type="text"
        value={draftLabel}
        onChange={(e) => setDraftLabel(e.target.value)}
        placeholder="Etiqueta del cable, ej. Sustenta diseño de"
        aria-label="Etiqueta del cable"
        maxLength={60}
        autoFocus
        className="w-full bg-andros-canvas border border-andros-border focus:border-andros-accent rounded-xl px-3 py-2 text-xs text-andros-primary placeholder:text-andros-muted outline-none spring-micro"
      />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="flex-1 px-3 py-2 rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 active:scale-95 spring-micro"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Guardar etiqueta</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Borrar cable (Supr)"
          className="px-3 py-2 rounded-xl bg-andros-border/50 hover:bg-andros-border text-xs font-medium text-andros-danger flex items-center justify-center gap-1.5 active:scale-95 spring-micro"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Borrar</span>
        </button>
      </div>
    </form>
  );
};

// ============================================================================
// LIENZO ESPACIAL INFINITO (PC >= 768px)
// ============================================================================

export const SpatialCanvas: React.FC = () => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);
  const updateNodePosition = useWorkspaceStore((s) => s.updateNodePosition);
  const selectNode = useWorkspaceStore((s) => s.selectNode);
  const canvasTransform = useWorkspaceStore((s) => s.canvasTransform);
  const setCanvasTransform = useWorkspaceStore((s) => s.setCanvasTransform);
  const activeTool = useWorkspaceStore((s) => s.activeTool);
  const cableStyle = useSettingsStore((s) => s.cableStyle);
  const snapToGrid = useSettingsStore((s) => s.snapToGrid);
  const canvasBackground = useSettingsStore((s) => s.canvasBackground);
  const animations = useSettingsStore((s) => s.animations);

  const connectingFrom = useWorkspaceStore((s) => s.connectingFrom);
  const selectedConnectionId = useWorkspaceStore((s) => s.selectedConnectionId);
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);

  // Nodo IA seleccionado → se resaltan los cables que alimentan su contexto.
  const feedingEdgeIds = useMemo(() => {
    const selected = nodes.find((n) => n.id === selectedNodeId);
    if (!selected || selected.type !== "ai-chat-node") return null;
    return new Set(collectUpstreamContext(nodes, connections, selected.id).edgeIds);
  }, [nodes, connections, selectedNodeId]);
  const startConnecting = useWorkspaceStore((s) => s.startConnecting);
  const cancelConnecting = useWorkspaceStore((s) => s.cancelConnecting);
  const completeConnection = useWorkspaceStore((s) => s.completeConnection);
  const removeConnection = useWorkspaceStore((s) => s.removeConnection);
  const updateConnectionLabel = useWorkspaceStore((s) => s.updateConnectionLabel);
  const selectConnection = useWorkspaceStore((s) => s.selectConnection);
  const setActiveTool = useWorkspaceStore((s) => s.setActiveTool);
  const zoomExtentsRequest = useWorkspaceStore((s) => s.zoomExtentsRequest);

  // Tinta libre
  const canvasStrokes = useWorkspaceStore((s) => s.canvasStrokes);
  const inkColor = useWorkspaceStore((s) => s.inkColor);
  const inkTip = useWorkspaceStore((s) => s.inkTip);
  const inkMode = useWorkspaceStore((s) => s.inkMode);
  const setInkMode = useWorkspaceStore((s) => s.setInkMode);
  const addCanvasStroke = useWorkspaceStore((s) => s.addCanvasStroke);
  const eraseCanvasStrokes = useWorkspaceStore((s) => s.eraseCanvasStrokes);
  const undoCanvasInk = useWorkspaceStore((s) => s.undoCanvasInk);

  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  /** Paneo con el botón central (rueda): muestra la mano cerrada. */
  const [isMiddlePanning, setIsMiddlePanning] = useState(false);
  /** Animación suave de cámara (Zoom Extents). */
  const [isViewAnimating, setIsViewAnimating] = useState(false);
  /** Estilo del trazo que se está dibujando ahora mismo (null = no se dibuja). */
  const [liveInk, setLiveInk] = useState<LiveInkStyle | null>(null);
  const [isPanningCanvas, setIsPanningCanvas] = useState(false);
  const [nodeSizes, setNodeSizes] = useState<Record<string, Size>>({});
  const [pointer, setPointer] = useState<Point | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);

  const mainRef = useRef<HTMLElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<Point>({ x: 0, y: 0 });
  const panStart = useRef<Point>({ x: 0, y: 0 });
  /** Gesto de conexión en curso: dónde se presionó y si ya se arrastró. */
  const connectPress = useRef<{ x: number; y: number; moved: boolean; active: boolean }>({
    x: 0,
    y: 0,
    moved: false,
    active: false,
  });

  /** Paneo con rueda: si se movió, el clic de rueda no cuenta para Zoom Extents. */
  const middlePan = useRef<{ moved: boolean; x: number; y: number; lastClickAt: number }>({
    moved: false,
    x: 0,
    y: 0,
    lastClickAt: 0,
  });
  /** Trazo en curso: puntero que dibuja y puntos capturados. */
  const inkDraft = useRef<{ pointerId: number; points: CanvasStrokePoint[]; style: LiveInkStyle } | null>(
    null
  );
  /** Puntero que está borrando (Borrador) y trazos ya borrados en ese gesto. */
  const eraserPointer = useRef<number | null>(null);
  /** Ya se usó un stylus: a partir de ahí el dedo panea en vez de dibujar (rechazo de palma). */
  const penSeen = useRef(false);
  const livePathRef = useRef<SVGPathElement>(null);
  const nodeSizesRef = useRef<Record<string, Size>>({});
  const viewAnimationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sala completa (7.º) o rol Comentarista / Solo lectura: lienzo en modo lectura (paneo y zoom sí).
  const readOnly = useCanvasReadOnly();
  const isConnectTool = activeTool === "connect" && !readOnly;
  const isDrawTool = activeTool === "draw" && !readOnly;
  const nodeIdsKey = nodes.map((n) => n.id).join("|");

  useEffect(() => {
    nodeSizesRef.current = nodeSizes;
  }, [nodeSizes]);

  // --------------------------------------------------------------------------
  // Medición real de cada nodo (para anclar los cables a sus puertos)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof ResizeObserver === "undefined") return;

    const elements = Array.from(
      layer.querySelectorAll<HTMLElement>("[data-node-id]")
    );

    const observer = new ResizeObserver(() => {
      setNodeSizes((previous) => {
        const next: Record<string, Size> = {};
        let changed = Object.keys(previous).length !== elements.length;

        for (const element of elements) {
          const id = element.dataset.nodeId;
          if (!id) continue;
          const size: Size = {
            width: element.offsetWidth,
            height: element.offsetHeight,
          };
          next[id] = size;
          const old = previous[id];
          if (!old || old.width !== size.width || old.height !== size.height) {
            changed = true;
          }
        }

        return changed ? next : previous;
      });
    });

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [nodeIdsKey]);

  // --------------------------------------------------------------------------
  // Teclado: Esc cancela / cierra, Supr borra el cable seleccionado
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Lápiz activo: Ctrl+Z deshace, E alterna el Borrador, Esc vuelve al Puntero.
      if (isDrawTool && !isTypingTarget(e.target)) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          undoCanvasInk();
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "e") {
          setInkMode(inkMode === "eraser" ? "pen" : "eraser");
          return;
        }
        if (e.key === "Escape") {
          setActiveTool("pointer");
          return;
        }
      }

      if (e.key === "Escape") {
        if (connectingFrom) cancelConnecting();
        if (selectedConnectionId) selectConnection(null);
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedConnectionId &&
        !readOnly &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        removeConnection(selectedConnectionId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    connectingFrom,
    selectedConnectionId,
    cancelConnecting,
    selectConnection,
    removeConnection,
    readOnly,
    isDrawTool,
    inkMode,
    setInkMode,
    undoCanvasInk,
    setActiveTool,
  ]);

  // --------------------------------------------------------------------------
  // Cámara estilo AutoCAD: rueda = zoom al cursor, botón central = paneo,
  // doble clic de rueda = Zoom Extents. Se usan eventos nativos porque React
  // registra la rueda como "pasiva" y no permitiría bloquear el scroll.
  // --------------------------------------------------------------------------
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const handleWheel = (e: WheelEvent) => {
      const { activeTool: tool } = useWorkspaceStore.getState();
      if (!e.ctrlKey && tool !== "draw" && canScrollInside(e.target, main, e.deltaY)) {
        return; // Deja desplazar el contenido interno de un nodo.
      }
      e.preventDefault();

      const rect = main.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      const delta = Math.max(-120, Math.min(120, e.deltaY * unit));
      // Pellizco del touchpad llega con Ctrl y deltas pequeños: más sensibilidad.
      const intensity = e.ctrlKey ? 0.01 : 0.0015;
      const { canvasTransform: current, zoomCanvasAt } = useWorkspaceStore.getState();
      zoomCanvasAt(current.scale * Math.exp(-delta * intensity), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };

    // Bloquea el auto-scroll nativo del navegador al presionar la rueda.
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    // Doble clic con la rueda → Zoom Extents.
    const handleAuxClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const state = middlePan.current;
      if (state.moved) {
        state.lastClickAt = 0;
        return;
      }
      const now = performance.now();
      if (e.detail >= 2 || now - state.lastClickAt < MIDDLE_DOUBLE_CLICK_MS) {
        state.lastClickAt = 0;
        useWorkspaceStore.getState().requestZoomExtents();
      } else {
        state.lastClickAt = now;
      }
    };

    main.addEventListener("wheel", handleWheel, { passive: false });
    main.addEventListener("mousedown", handleMouseDown);
    main.addEventListener("auxclick", handleAuxClick);
    return () => {
      main.removeEventListener("wheel", handleWheel);
      main.removeEventListener("mousedown", handleMouseDown);
      main.removeEventListener("auxclick", handleAuxClick);
    };
  }, []);

  // --------------------------------------------------------------------------
  // Zoom Extents: encuadra todos los nodos y trazos visibles
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (zoomExtentsRequest === 0) return;
    const main = mainRef.current;
    if (!main) return;

    const state = useWorkspaceStore.getState();
    let bounds: Bounds | null = null;
    for (const node of state.nodes) {
      const size = nodeSizesRef.current[node.id] ?? FALLBACK_NODE_SIZE;
      bounds = mergeBounds(bounds, {
        minX: node.position.x,
        minY: node.position.y,
        maxX: node.position.x + size.width,
        maxY: node.position.y + size.height,
      });
    }
    for (const stroke of state.canvasStrokes) {
      bounds = mergeBounds(bounds, getStrokeBounds(stroke));
    }

    let next = { x: 0, y: 0, scale: 1 };
    if (bounds) {
      const availableWidth = Math.max(120, main.clientWidth - EXTENTS_PADDING.side * 2);
      const availableHeight = Math.max(
        120,
        main.clientHeight - EXTENTS_PADDING.top - EXTENTS_PADDING.bottom
      );
      const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
      const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
      const scale = Math.min(
        EXTENTS_MAX_SCALE,
        clampCanvasScale(Math.min(availableWidth / contentWidth, availableHeight / contentHeight))
      );
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      next = {
        x: EXTENTS_PADDING.side + availableWidth / 2 - centerX * scale,
        y: EXTENTS_PADDING.top + availableHeight / 2 - centerY * scale,
        scale,
      };
    }

    setIsViewAnimating(true);
    state.setCanvasTransform(next);
    if (viewAnimationTimer.current) clearTimeout(viewAnimationTimer.current);
    viewAnimationTimer.current = setTimeout(() => setIsViewAnimating(false), 420);
  }, [zoomExtentsRequest]);

  useEffect(
    () => () => {
      if (viewAnimationTimer.current) clearTimeout(viewAnimationTimer.current);
    },
    []
  );

  // --------------------------------------------------------------------------
  // Utilidades dependientes del estado
  // --------------------------------------------------------------------------
  const getSize = (nodeId: string): Size => nodeSizes[nodeId] ?? FALLBACK_NODE_SIZE;

  /** Convierte coordenadas de pantalla a coordenadas del lienzo. */
  const toCanvasPoint = (clientX: number, clientY: number): Point => {
    const rect = mainRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: (clientX - left - canvasTransform.x) / canvasTransform.scale,
      y: (clientY - top - canvasTransform.y) / canvasTransform.scale,
    };
  };

  /**
   * Busca dónde caería el cable si se soltara en `point`:
   * 1) el puerto más cercano dentro del radio magnético, o
   * 2) el nodo que está bajo el cursor (con su puerto más conveniente).
   */
  const findDropTarget = (point: Point, originPoint: Point | null): PortTarget | null => {
    if (!connectingFrom) return null;

    let best: PortTarget | null = null;
    let bestDistance = MAGNET_RADIUS;

    for (const node of nodes) {
      if (node.id === connectingFrom.nodeId) continue;
      const size = getSize(node.id);
      for (const port of PORT_POSITIONS) {
        const distance = distanceBetween(getPortPoint(node, size, port), point);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { nodeId: node.id, port };
        }
      }
    }
    if (best) return best;

    for (const node of nodes) {
      if (node.id === connectingFrom.nodeId) continue;
      const size = getSize(node.id);
      if (isPointInsideNode(node, size, point)) {
        return {
          nodeId: node.id,
          port: getClosestPort(node, size, originPoint ?? point),
        };
      }
    }
    return null;
  };

  // --------------------------------------------------------------------------
  // Cable en vivo (mientras el usuario elige el destino)
  // --------------------------------------------------------------------------
  const originNode = connectingFrom
    ? nodes.find((n) => n.id === connectingFrom.nodeId) ?? null
    : null;

  let liveOriginPort: PortPosition | null = null;
  let liveOriginPoint: Point | null = null;
  let liveTarget: PortTarget | null = null;
  let liveCable: { d: string; mid: Point } | null = null;
  let liveTargetPoint: Point | null = null;

  if (connectingFrom && originNode && pointer) {
    const originSize = getSize(originNode.id);
    liveOriginPort = connectingFrom.autoPort
      ? getClosestPort(originNode, originSize, pointer)
      : connectingFrom.port;
    liveOriginPoint = getPortPoint(originNode, originSize, liveOriginPort);
    liveTarget = findDropTarget(pointer, liveOriginPoint);

    if (liveTarget) {
      const targetNode = nodes.find((n) => n.id === liveTarget?.nodeId);
      if (targetNode) {
        const targetPoint = getPortPoint(
          targetNode,
          getSize(targetNode.id),
          liveTarget.port
        );
        liveTargetPoint = targetPoint;
        liveCable = buildCable(liveOriginPoint, liveOriginPort, targetPoint, liveTarget.port, cableStyle);
      }
    }
    if (!liveCable) {
      liveCable = buildCable(liveOriginPoint, liveOriginPort, pointer, null, cableStyle);
    }
  }

  // --------------------------------------------------------------------------
  // Eventos de puntero
  // --------------------------------------------------------------------------
  const beginConnectPress = (e: React.PointerEvent<HTMLElement>) => {
    connectPress.current = { x: e.clientX, y: e.clientY, moved: false, active: true };
    setPointer(toCanvasPoint(e.clientX, e.clientY));
    try {
      // Captura el puntero para no perder el gesto si sale de la ventana.
      mainRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Algunos navegadores no permiten capturar punteros sintéticos.
    }
  };

  /** Completa el cable sobre un nodo eligiendo el puerto más conveniente. */
  const completeOnNode = (node: EngineeringNodeData, port?: PortPosition) => {
    if (!connectingFrom) return;
    if (port) {
      completeConnection(node.id, port);
      return;
    }
    if (connectingFrom.autoPort || !originNode) {
      completeConnection(node.id);
      return;
    }
    const originPoint = getPortPoint(
      originNode,
      getSize(originNode.id),
      connectingFrom.port
    );
    completeConnection(node.id, getClosestPort(node, getSize(node.id), originPoint));
  };

  const handlePortPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    node: EngineeringNodeData,
    port: PortPosition
  ) => {
    e.preventDefault();

    // Segundo clic sobre el puerto de OTRO nodo: se cierra la conexión.
    if (connectingFrom && connectingFrom.nodeId !== node.id) {
      connectPress.current.active = false;
      completeOnNode(node, port);
      return;
    }

    selectNode(node.id);
    startConnecting(node.id, port);
    beginConnectPress(e);
  };

  const handleNodePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    node: EngineeringNodeData
  ) => {
    e.stopPropagation();
    if (selectedConnectionId) selectConnection(null);

    // Hay un cable esperando destino: este nodo es el destino.
    if (connectingFrom) {
      connectPress.current.active = false;
      if (connectingFrom.nodeId === node.id) {
        cancelConnecting();
      } else {
        completeOnNode(node);
      }
      return;
    }

    // Herramienta Conectar (C): el nodo presionado es el origen.
    if (isConnectTool) {
      startConnecting(node.id);
      beginConnectPress(e);
      return;
    }

    // Herramienta Puntero (V): arrastrar el nodo.
    const point = toCanvasPoint(e.clientX, e.clientY);
    setDraggingNodeId(node.id);
    dragOffset.current = {
      x: point.x - node.position.x,
      y: point.y - node.position.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // Manejadores ESTABLES para las tarjetas memorizadas (React.memo): la
  // referencia nunca cambia y siempre llaman a la versión más reciente.
  const nodeHandlers = useRef({ node: handleNodePointerDown, port: handlePortPointerDown });
  useLayoutEffect(() => {
    nodeHandlers.current = { node: handleNodePointerDown, port: handlePortPointerDown };
  });
  const onNodePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, node: EngineeringNodeData) => nodeHandlers.current.node(e, node),
    []
  );
  const onPortPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, node: EngineeringNodeData, port: PortPosition) =>
      nodeHandlers.current.port(e, node, port),
    []
  );

  // --------------------------------------------------------------------------
  // Paneo (botón central o dedo con el Lápiz) y tinta libre
  // --------------------------------------------------------------------------
  const startPan = (e: React.PointerEvent<HTMLElement>) => {
    setIsPanningCanvas(true);
    panStart.current = {
      x: e.clientX - canvasTransform.x,
      y: e.clientY - canvasTransform.y,
    };
    try {
      mainRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Puntero sintético: se sigue sin captura.
    }
  };

  /** Convierte un evento (y sus eventos agrupados) en puntos de tinta. */
  const collectInkPoints = (e: React.PointerEvent<HTMLElement>, withPressure: boolean) => {
    const native = e.nativeEvent;
    const events =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const source = events.length > 0 ? events : [native];
    return source.map((ev) => {
      const point = toCanvasPoint(ev.clientX, ev.clientY);
      return withPressure
        ? { x: point.x, y: point.y, p: Math.max(0.05, Math.min(1, ev.pressure || 0.5)) }
        : point;
    });
  };

  const updateLivePath = () => {
    const draft = inkDraft.current;
    const path = livePathRef.current;
    if (!draft || !path) return;
    const usesOutline = draft.style.pressure && !draft.style.highlighter && draft.points.length >= 3;
    path.setAttribute(
      "d",
      usesOutline
        ? buildPressureOutline(draft.points, draft.style.width)
        : buildSmoothPath(draft.points)
    );
    path.setAttribute("fill", usesOutline ? draft.style.color : "none");
    path.setAttribute("stroke", usesOutline ? "none" : draft.style.color);
  };

  const appendInkPoints = (points: CanvasStrokePoint[]) => {
    const draft = inkDraft.current;
    if (!draft) return;
    // Filtra puntos casi repetidos (~0.75 px en pantalla) para aligerar el trazo.
    const minGap = 0.75 / canvasTransform.scale;
    for (const point of points) {
      const last = draft.points[draft.points.length - 1];
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < minGap) continue;
      draft.points.push(point);
    }
    updateLivePath();
  };

  const finishInkStroke = () => {
    const draft = inkDraft.current;
    inkDraft.current = null;
    setLiveInk(null);
    if (!draft || draft.points.length === 0) return;

    const stroke: CanvasStroke = {
      id: newStrokeId(),
      color: inkColor,
      tip: inkTip,
      width: INK_TIP_WIDTHS[inkTip],
      pressure: draft.style.pressure,
      points: draft.points.map((p) =>
        p.p !== undefined
          ? { x: roundInkValue(p.x), y: roundInkValue(p.y), p: Math.round(p.p * 100) / 100 }
          : { x: roundInkValue(p.x), y: roundInkValue(p.y) }
      ),
    };
    addCanvasStroke(stroke);
  };

  /** Borra los trazos que toca el Borrador en este punto de la pantalla. */
  const eraseAt = (clientX: number, clientY: number, pointerType: string) => {
    const point = toCanvasPoint(clientX, clientY);
    const tolerance = (pointerType === "touch" ? 12 : 6) / canvasTransform.scale;
    const hits = canvasStrokes
      .filter((stroke) => isPointNearStroke(point, stroke, tolerance))
      .map((stroke) => stroke.id);
    if (hits.length > 0) eraseCanvasStrokes(hits);
  };

  /**
   * Fase de captura: se ejecuta ANTES que los nodos. Así el botón central
   * panea incluso encima de un nodo y el Lápiz dibuja sobre todo el lienzo.
   */
  const handleCanvasPointerDownCapture = (e: React.PointerEvent<HTMLElement>) => {
    // 1. Botón central (rueda) sostenido: paneo libre en cualquier lugar.
    if (e.pointerType === "mouse" && e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      middlePan.current.moved = false;
      middlePan.current.x = e.clientX;
      middlePan.current.y = e.clientY;
      setIsMiddlePanning(true);
      startPan(e);
      return;
    }

    if (!isDrawTool) return;
    // Clic derecho u otros botones no dibujan.
    if (e.button !== 0 && e.button !== 5) return;

    e.stopPropagation();
    e.preventDefault();

    if (e.pointerType === "pen") penSeen.current = true;

    // Ya hay un trazo en curso (ej. segundo dedo): se ignora.
    if (inkDraft.current || eraserPointer.current !== null) return;

    // Rechazo de palma: si ya se usó un stylus, el dedo mueve el lienzo.
    if (e.pointerType === "touch" && penSeen.current) {
      startPan(e);
      return;
    }

    try {
      mainRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el gesto sigue funcionando dentro del lienzo.
    }

    // Borrador: herramienta activa o botón borrador del stylus (button 5).
    if (inkMode === "eraser" || e.button === 5) {
      eraserPointer.current = e.pointerId;
      eraseAt(e.clientX, e.clientY, e.pointerType);
      return;
    }

    const isHighlighter = inkTip === "highlighter";
    const style: LiveInkStyle = {
      color: inkColorToCss(inkColor),
      width: INK_TIP_WIDTHS[inkTip],
      pressure: e.pointerType === "pen" && !isHighlighter,
      highlighter: isHighlighter,
    };
    inkDraft.current = { pointerId: e.pointerId, points: [], style };
    setLiveInk(style);
    appendInkPoints(collectInkPoints(e, style.pressure));
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button === 1 || isDrawTool) return;
    if (e.target !== e.currentTarget) return;
    selectNode(null);
    if (selectedConnectionId) selectConnection(null);

    // Clic en el vacío con un cable a medio trazar: se cancela.
    if (connectingFrom) {
      connectPress.current.active = false;
      cancelConnecting();
      return;
    }

    setIsPanningCanvas(true);
    panStart.current = {
      x: e.clientX - canvasTransform.x,
      y: e.clientY - canvasTransform.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    // Tinta: añadir puntos al trazo en curso.
    if (inkDraft.current && inkDraft.current.pointerId === e.pointerId) {
      appendInkPoints(collectInkPoints(e, inkDraft.current.style.pressure));
      return;
    }

    // Borrador arrastrado: borra todo lo que toque en el camino.
    if (eraserPointer.current === e.pointerId) {
      eraseAt(e.clientX, e.clientY, e.pointerType);
      return;
    }

    // Paneo (fondo, botón central o dedo con el Lápiz).
    if (isPanningCanvas) {
      if (
        isMiddlePanning &&
        !middlePan.current.moved &&
        Math.hypot(e.clientX - middlePan.current.x, e.clientY - middlePan.current.y) >
          DRAG_THRESHOLD
      ) {
        middlePan.current.moved = true;
      }
      setCanvasTransform({
        ...canvasTransform,
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
      return;
    }

    if (connectingFrom) {
      const press = connectPress.current;
      if (
        press.active &&
        !press.moved &&
        Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD
      ) {
        press.moved = true;
      }
      setPointer(toCanvasPoint(e.clientX, e.clientY));
      return;
    }

    if (draggingNodeId) {
      const point = toCanvasPoint(e.clientX, e.clientY);
      let nx = point.x - dragOffset.current.x;
      let ny = point.y - dragOffset.current.y;
      if (snapToGrid) {
        nx = Math.round(nx / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
        ny = Math.round(ny / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
      }
      updateNodePosition(draggingNodeId, nx, ny);
    }
  };

  /** Cierra los gestos de tinta y paneo de un puntero. Devuelve `true` si había uno. */
  const endInkOrPan = (pointerId: number): boolean => {
    if (inkDraft.current && inkDraft.current.pointerId === pointerId) {
      finishInkStroke();
      return true;
    }
    if (eraserPointer.current === pointerId) {
      eraserPointer.current = null;
      return true;
    }
    if (isMiddlePanning) setIsMiddlePanning(false);
    return false;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (endInkOrPan(e.pointerId)) return;
    const press = connectPress.current;

    if (connectingFrom && press.active) {
      press.active = false;

      // Si el usuario ARRASTRÓ desde el puerto, soltar decide el resultado.
      // Si solo hizo clic, el cable queda "armado" esperando un segundo clic.
      if (press.moved) {
        const point = toCanvasPoint(e.clientX, e.clientY);
        const target = findDropTarget(point, liveOriginPoint);
        if (target) {
          completeConnection(
            target.nodeId,
            connectingFrom.autoPort ? undefined : target.port
          );
        } else {
          cancelConnecting();
        }
      }
    }

    setDraggingNodeId(null);
    setIsPanningCanvas(false);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    // Si el sistema cancela el gesto, se conserva lo ya dibujado.
    if (endInkOrPan(e.pointerId)) return;
    if (connectingFrom && connectPress.current.active) {
      connectPress.current.active = false;
      cancelConnecting();
    }
    setDraggingNodeId(null);
    setIsPanningCanvas(false);
  };

  // --------------------------------------------------------------------------
  // Cable seleccionado (panel flotante)
  // --------------------------------------------------------------------------
  const getSelectedPopover = (): {
    connection: NodeConnection;
    mid: Point;
    fromTitle: string;
    toTitle: string;
  } | null => {
    const connection = connections.find((c) => c.id === selectedConnectionId);
    if (!connection) return null;
    const from = nodes.find((n) => n.id === connection.fromNodeId);
    const to = nodes.find((n) => n.id === connection.toNodeId);
    if (!from || !to) return null;

    const cable = buildCable(
      getPortPoint(from, getSize(from.id), connection.fromPort),
      connection.fromPort,
      getPortPoint(to, getSize(to.id), connection.toPort),
      connection.toPort
    );
    return { connection, mid: cable.mid, fromTitle: from.title, toTitle: to.title };
  };

  const selectedPopover = isDrawTool ? null : getSelectedPopover();

  // Pinta el primer punto del trazo en cuanto aparece la ruta en vivo.
  useLayoutEffect(() => {
    if (liveInk) updateLivePath();
  }, [liveInk]);

  const hintText = connectingFrom
    ? "Suelta o haz clic sobre un puerto u otro nodo para conectar · Esc cancela"
    : isConnectTool
      ? "Modo Conectar: haz clic en el nodo de origen y luego en el de destino"
      : null;

  // Cámara suave: transición corta para la rueda y larga para Zoom Extents.
  // Se desactiva mientras se arrastra, panea o dibuja para que siga al dedo.
  const isDirectManipulation =
    isPanningCanvas || Boolean(draggingNodeId) || Boolean(liveInk) || Boolean(connectingFrom);
  const cameraTransition = isViewAnimating
    ? "380ms cubic-bezier(0.16, 1, 0.3, 1)"
    : isDirectManipulation
      ? null
      : "90ms ease-out";

  const cursorClass = isPanningCanvas
    ? "cursor-grabbing"
    : isDrawTool
      ? inkMode === "eraser"
        ? "cursor-cell"
        : "cursor-crosshair"
      : connectingFrom || isConnectTool
        ? "cursor-crosshair"
        : "cursor-default";

  const gridSize = GRID_SIZE * canvasTransform.scale;

  return (
    <main
      ref={mainRef}
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => {
        // Con el Lápiz, el botón lateral del stylus no debe abrir el menú.
        if (isDrawTool) e.preventDefault();
      }}
      className={`w-screen h-screen relative overflow-hidden canvas-grid ${
        canvasBackground === "grid" ? "canvas-bg-grid" : canvasBackground === "plain" ? "canvas-bg-plain" : ""
      } select-none touch-none ${cursorClass}`}
      style={{
        backgroundPosition: `${canvasTransform.x}px ${canvasTransform.y}px`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        transition: cameraTransition
          ? `background-position ${cameraTransition}, background-size ${cameraTransition}, background-color 300ms`
          : "background-color 300ms",
      }}
    >
      {/* Guía contextual de conexión */}
      {hintText && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-none px-3.5 py-2 rounded-xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark text-[11px] font-mono text-andros-primary whitespace-nowrap">
          <span className="text-andros-accent-ink">●</span> {hintText}
        </div>
      )}

      {/* Capa Espacial Transformable */}
      <div
        ref={layerRef}
        className="w-full h-full relative pointer-events-none"
        style={{
          transform: `translate3d(${canvasTransform.x}px, ${canvasTransform.y}px, 0) scale(${canvasTransform.scale})`,
          transformOrigin: "0 0",
          transition: cameraTransition ? `transform ${cameraTransition}` : undefined,
        }}
      >
        {/* Conexiones Vectoriales SVG entre Nodos */}
        <svg
          className="absolute left-0 top-0 pointer-events-none overflow-visible z-0"
          width="1"
          height="1"
        >
          <defs>
            <marker
              id="andros-arrow"
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--text-muted)" />
            </marker>
            <marker
              id="andros-arrow-active"
              viewBox="0 0 10 10"
              refX="8.5"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--accent-primary)" />
            </marker>
          </defs>

          {connections.map((conn) => {
            const from = nodes.find((n) => n.id === conn.fromNodeId);
            const to = nodes.find((n) => n.id === conn.toNodeId);
            if (!from || !to) return null;

            const cable = buildCable(
              getPortPoint(from, getSize(from.id), conn.fromPort),
              conn.fromPort,
              getPortPoint(to, getSize(to.id), conn.toPort),
              conn.toPort,
              cableStyle
            );
            const isSelected = conn.id === selectedConnectionId;
            const isActive = isSelected || conn.id === hoveredConnectionId;
            const isFeeding = Boolean(feedingEdgeIds?.has(conn.id));

            const handleSelect = (e: React.PointerEvent<SVGElement>) => {
              e.stopPropagation();
              if (connectingFrom) cancelConnecting();
              selectNode(null);
              selectConnection(conn.id);
            };

            return (
              <g key={conn.id}>
                {/* Halo suave: este cable alimenta el contexto del Nodo IA seleccionado */}
                {isFeeding && (
                  <path
                    d={cable.d}
                    fill="none"
                    stroke="var(--accent-primary)"
                    strokeWidth={7}
                    strokeLinecap="round"
                    opacity={0.16}
                    pointerEvents="none"
                  />
                )}
                {/* Trazo visible */}
                <path
                  d={cable.d}
                  fill="none"
                  stroke={isActive || isFeeding ? "var(--accent-primary)" : "var(--border-active)"}
                  strokeWidth={isActive ? 2.25 : isFeeding ? 2 : 1.75}
                  strokeDasharray={isSelected ? undefined : "5 5"}
                  strokeLinecap="round"
                  markerEnd={`url(#${isActive || isFeeding ? "andros-arrow-active" : "andros-arrow"})`}
                />
                {/* Zona de clic ancha e invisible */}
                <path
                  d={cable.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={18}
                  style={{ pointerEvents: isDrawTool ? "none" : "stroke", cursor: "pointer" }}
                  onPointerDown={handleSelect}
                  onPointerEnter={() => setHoveredConnectionId(conn.id)}
                  onPointerLeave={() =>
                    setHoveredConnectionId((current) =>
                      current === conn.id ? null : current
                    )
                  }
                >
                  <title>Clic para cambiar la etiqueta o borrar este cable</title>
                </path>
                {animations === "full" && (
                  <circle r={2.5} fill="var(--accent-primary)" opacity={0.85}>
                    <animateMotion dur="3.2s" repeatCount="indefinite" path={cable.d} />
                  </circle>
                )}
                {conn.label && (
                  <text
                    x={cable.mid.x}
                    y={cable.mid.y - 8}
                    textAnchor="middle"
                    stroke="var(--bg-canvas)"
                    strokeWidth={4}
                    strokeLinejoin="round"
                    style={{
                      paintOrder: "stroke",
                      pointerEvents: isDrawTool ? "none" : "auto",
                      cursor: "pointer",
                    }}
                    onPointerDown={handleSelect}
                    className={`text-[10px] font-mono ${
                      isActive ? "fill-andros-accent" : "fill-andros-muted"
                    }`}
                  >
                    {conn.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Cable en vivo que sigue al cursor */}
          {liveCable && liveOriginPoint && (
            <g>
              <path
                d={liveCable.d}
                fill="none"
                stroke="var(--accent-primary)"
                strokeWidth={2.25}
                strokeDasharray={liveTarget ? undefined : "6 6"}
                strokeLinecap="round"
                markerEnd="url(#andros-arrow-active)"
              />
              {liveCable && liveTarget && liveTargetPoint && (
                <circle
                  cx={liveTargetPoint.x}
                  cy={liveTargetPoint.y}
                  r={9}
                  fill="var(--accent-primary)"
                  fillOpacity={0.18}
                  stroke="var(--accent-primary)"
                  strokeWidth={1.5}
                >
                  {animations === "full" && (
                    <animate attributeName="r" values="7;12;7" dur="0.9s" repeatCount="indefinite" />
                  )}
                </circle>
              )}
              <circle
                cx={liveOriginPoint.x}
                cy={liveOriginPoint.y}
                r={4}
                fill="var(--accent-primary)"
              />
            </g>
          )}
        </svg>

        {/* Nodos Interactivos (con el Lápiz activo quedan bloqueados para dibujar encima) */}
        <div className={isDrawTool || readOnly ? "pointer-events-none" : "pointer-events-auto"}>
          {nodes.map((node) => (
            <EngineeringNode
              key={node.id}
              node={node}
              variant="canvas"
              isDragging={draggingNodeId === node.id}
              onPointerDownCanvas={onNodePointerDown}
              onPortPointerDown={onPortPointerDown}
              showPorts={Boolean(connectingFrom) || isConnectTool}
              highlightedPort={liveTarget?.nodeId === node.id ? liveTarget.port : null}
              originPort={
                connectingFrom?.nodeId === node.id ? liveOriginPort : null
              }
            />
          ))}
        </div>

        {/* Pantallas compartidas de la sala en vivo (nodos efímeros, no se guardan) */}
        <ScreenShareLayer scale={canvasTransform.scale} interactive={!isDrawTool} />

        {/* Tinta libre (Lápiz D): sobre los nodos, sin capturar clics */}
        <svg
          className="absolute left-0 top-0 pointer-events-none overflow-visible"
          style={{ zIndex: 35 }}
          width="1"
          height="1"
          aria-hidden="true"
        >
          {canvasStrokes.map((stroke) => (
            <InkStroke key={stroke.id} stroke={stroke} />
          ))}
          {liveInk && (
            <path
              ref={livePathRef}
              strokeWidth={liveInk.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={liveInk.highlighter ? HIGHLIGHTER_OPACITY : undefined}
            />
          )}
        </svg>

        {/* Cursores en vivo de los compañeros de la sala */}
        <CollabCursorsLayer scale={canvasTransform.scale} />

        {/* Panel flotante del cable seleccionado */}
        {selectedPopover && (
          <div
            className="absolute z-40 pointer-events-auto"
            style={{
              left: `${selectedPopover.mid.x}px`,
              top: `${selectedPopover.mid.y}px`,
              transform: "translate(-50%, 14px)",
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ConnectionPopover
              key={selectedPopover.connection.id}
              connection={selectedPopover.connection}
              fromTitle={selectedPopover.fromTitle}
              toTitle={selectedPopover.toTitle}
              onSave={(label) => {
                updateConnectionLabel(selectedPopover.connection.id, label);
                selectConnection(null);
              }}
              onDelete={() => removeConnection(selectedPopover.connection.id)}
              onClose={() => selectConnection(null)}
            />
          </div>
        )}
      </div>
    </main>
  );
};
