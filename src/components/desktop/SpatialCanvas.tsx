"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import {
  EngineeringNodeData,
  NodeConnection,
  PORT_POSITIONS,
  PortPosition,
} from "@/types/workspace";
import { EngineeringNode } from "@/components/shared/EngineeringNode";

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
  endPort: PortPosition | null
): { d: string; mid: Point } {
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
          className="px-3 py-2 rounded-xl bg-andros-border/50 hover:bg-andros-border text-xs font-medium text-red-500 flex items-center justify-center gap-1.5 active:scale-95 spring-micro"
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

  const connectingFrom = useWorkspaceStore((s) => s.connectingFrom);
  const selectedConnectionId = useWorkspaceStore((s) => s.selectedConnectionId);
  const startConnecting = useWorkspaceStore((s) => s.startConnecting);
  const cancelConnecting = useWorkspaceStore((s) => s.cancelConnecting);
  const completeConnection = useWorkspaceStore((s) => s.completeConnection);
  const removeConnection = useWorkspaceStore((s) => s.removeConnection);
  const updateConnectionLabel = useWorkspaceStore((s) => s.updateConnectionLabel);
  const selectConnection = useWorkspaceStore((s) => s.selectConnection);

  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
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

  const isConnectTool = activeTool === "connect";
  const nodeIdsKey = nodes.map((n) => n.id).join("|");

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
      if (e.key === "Escape") {
        if (connectingFrom) cancelConnecting();
        if (selectedConnectionId) selectConnection(null);
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedConnectionId &&
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
  ]);

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
        liveCable = buildCable(liveOriginPoint, liveOriginPort, targetPoint, liveTarget.port);
      }
    }
    if (!liveCable) {
      liveCable = buildCable(liveOriginPoint, liveOriginPort, pointer, null);
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

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLElement>) => {
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
      updateNodePosition(
        draggingNodeId,
        point.x - dragOffset.current.x,
        point.y - dragOffset.current.y
      );
      return;
    }

    if (isPanningCanvas) {
      setCanvasTransform({
        ...canvasTransform,
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
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

  const handlePointerCancel = () => {
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

  const selectedPopover = getSelectedPopover();

  const hintText = connectingFrom
    ? "Suelta o haz clic sobre un puerto u otro nodo para conectar · Esc cancela"
    : isConnectTool
      ? "Modo Conectar: haz clic en el nodo de origen y luego en el de destino"
      : null;

  return (
    <main
      ref={mainRef}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className={`w-screen h-screen relative overflow-hidden canvas-grid select-none touch-none ${
        connectingFrom || isConnectTool ? "cursor-crosshair" : "cursor-default"
      }`}
      style={{
        backgroundPosition: `${canvasTransform.x}px ${canvasTransform.y}px`,
      }}
    >
      {/* Guía contextual de conexión */}
      {hintText && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-none px-3.5 py-2 rounded-xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark text-[11px] font-mono text-andros-primary whitespace-nowrap">
          <span className="text-andros-accent">●</span> {hintText}
        </div>
      )}

      {/* Capa Espacial Transformable */}
      <div
        ref={layerRef}
        className="w-full h-full relative pointer-events-none"
        style={{
          transform: `translate3d(${canvasTransform.x}px, ${canvasTransform.y}px, 0) scale(${canvasTransform.scale})`,
          transformOrigin: "0 0",
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
              conn.toPort
            );
            const isSelected = conn.id === selectedConnectionId;
            const isActive = isSelected || conn.id === hoveredConnectionId;

            const handleSelect = (e: React.PointerEvent<SVGElement>) => {
              e.stopPropagation();
              if (connectingFrom) cancelConnecting();
              selectNode(null);
              selectConnection(conn.id);
            };

            return (
              <g key={conn.id}>
                {/* Trazo visible */}
                <path
                  d={cable.d}
                  fill="none"
                  stroke={isActive ? "var(--accent-primary)" : "var(--border-active)"}
                  strokeWidth={isActive ? 2.25 : 1.75}
                  strokeDasharray={isSelected ? undefined : "5 5"}
                  strokeLinecap="round"
                  markerEnd={`url(#${isActive ? "andros-arrow-active" : "andros-arrow"})`}
                />
                {/* Zona de clic ancha e invisible */}
                <path
                  d={cable.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={18}
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
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
                      pointerEvents: "auto",
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
              <circle
                cx={liveOriginPoint.x}
                cy={liveOriginPoint.y}
                r={4}
                fill="var(--accent-primary)"
              />
            </g>
          )}
        </svg>

        {/* Nodos Interactivos */}
        <div className="pointer-events-auto">
          {nodes.map((node) => (
            <EngineeringNode
              key={node.id}
              node={node}
              variant="canvas"
              onPointerDownCanvas={handleNodePointerDown}
              onPortPointerDown={handlePortPointerDown}
              showPorts={Boolean(connectingFrom) || isConnectTool}
              highlightedPort={liveTarget?.nodeId === node.id ? liveTarget.port : null}
              originPort={
                connectingFrom?.nodeId === node.id ? liveOriginPort : null
              }
            />
          ))}
        </div>

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
