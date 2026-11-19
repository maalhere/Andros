"use client";

import React from "react";
import { motion } from "framer-motion";
import { useSettingsStore } from "@/store/useSettingsStore";
import { celebrate } from "@/lib/effects/celebrate";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Cable,
  CheckSquare,
  FileBox,
  Link2,
  NotebookPen,
  Sigma,
  Square,
  Terminal,
  X,
} from "lucide-react";
import {
  CalcLatexEngineeringNode,
  EngineeringNodeData,
  PORT_POSITIONS,
  PortPosition,
  SketchNoteEngineeringNode,
} from "@/types/workspace";
import { SKETCH_TEXT_MAX_HEIGHT, useWorkspaceStore } from "@/store/useWorkspaceStore";
import { FileNodeView } from "@/components/nodes/FileNodeView";
import { ResourceLinkNodeView } from "@/components/nodes/ResourceLinkNode";
import { CodeLabNodeView } from "@/components/nodes/CodeLabNode";
import { AiChatNodeView } from "@/components/nodes/AiChatNode";

interface EngineeringNodeProps {
  node: EngineeringNodeData;
  variant: "canvas" | "stack";
  /** PC: el nodo se está arrastrando ahora mismo (elevación + borde iluminado). */
  isDragging?: boolean;
  /** PC: se llama al presionar el cuerpo del nodo (arrastrar o conectar). */
  onPointerDownCanvas?: (
    e: React.PointerEvent<HTMLDivElement>,
    node: EngineeringNodeData
  ) => void;
  /** PC: se llama al presionar uno de los 4 puertos magnéticos. */
  onPortPointerDown?: (
    e: React.PointerEvent<HTMLButtonElement>,
    node: EngineeringNodeData,
    port: PortPosition
  ) => void;
  /** PC: mantiene los puertos visibles (mientras se traza un cable). */
  showPorts?: boolean;
  /** PC: puerto que está atrayendo el cable en este momento. */
  highlightedPort?: PortPosition | null;
  /** PC: puerto desde el que nace el cable en curso. */
  originPort?: PortPosition | null;
}

const PORT_ANCHOR_CLASSES: Record<PortPosition, string> = {
  top: "left-1/2 top-0",
  right: "left-full top-1/2",
  bottom: "left-1/2 top-full",
  left: "left-0 top-1/2",
};

const PORT_LABELS: Record<PortPosition, string> = {
  top: "superior",
  right: "derecho",
  bottom: "inferior",
  left: "izquierdo",
};

/** Elementos que deben recibir el clic sin iniciar el arrastre del nodo. */
const INTERACTIVE_SELECTOR =
  "button, a, input, textarea, select, label, [data-no-drag]";

// ----------------------------------------------------------------------------
// Vista previa del Nodo Tipo 2 (Cuaderno + Boceto)
// ----------------------------------------------------------------------------

const SketchNotePreview: React.FC<{ node: SketchNoteEngineeringNode }> = ({
  node,
}) => {
  const updateNodePayload = useWorkspaceStore((s) => s.updateNodePayload);
  const data = node.sketchNoteData;
  const doneCount = data.checklistItems.filter((item) => item.checked).length;
  const isEmpty =
    data.textBlocks.length === 0 &&
    data.checklistItems.length === 0 &&
    data.strokes.length === 0;

  if (isEmpty) {
    return (
      <p className="py-3 text-xs leading-relaxed text-andros-muted">
        Cuaderno vacío: todavía no tiene texto, lista de verificación ni trazos.
      </p>
    );
  }

  const toggleChecklistItem = (itemId: string) => {
    const next = data.checklistItems.map((item) =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );
    updateNodePayload(node.id, { checklistItems: next });
    if (next.length > 0 && next.every((item) => item.checked) && !data.checklistItems.every((item) => item.checked)) {
      void celebrate();
    }
  };

  return (
    <div className="py-3 space-y-3">
      {(data.textBlocks.length > 0 || data.checklistItems.length > 0) && (
        // Texto completo con scroll propio (los bloques de la IA pueden ser largos).
        <div
          className="space-y-1.5 overflow-y-auto pr-1"
          style={{ maxHeight: SKETCH_TEXT_MAX_HEIGHT }}
        >
          {data.textBlocks.map((block, index) =>
            block.type === "heading" ? (
              <p
                key={block.id}
                className={`text-xs font-semibold text-andros-primary ${index > 0 ? "pt-1.5" : ""}`}
              >
                {block.text}
              </p>
            ) : (
              <p key={block.id} className="text-xs leading-relaxed text-andros-muted">
                {block.type === "bullet" ? `• ${block.text}` : block.text}
              </p>
            )
          )}

          {data.checklistItems.length > 0 && (
            <ul className="pt-1 space-y-1">
              {data.checklistItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleChecklistItem(item.id);
                    }}
                    className="w-full flex items-start gap-1.5 text-left text-xs leading-relaxed spring-micro"
                  >
                    {item.checked ? (
                      <CheckSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-andros-success" />
                    ) : (
                      <Square className="w-3.5 h-3.5 mt-0.5 shrink-0 text-andros-muted" />
                    )}
                    <span
                      className={
                        item.checked ? "text-andros-muted line-through" : "text-andros-primary"
                      }
                    >
                      {item.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data.strokes.length > 0 && (
        <svg
          viewBox={`0 0 ${data.canvasSize.width} ${data.canvasSize.height}`}
          className="w-full rounded-xl bg-andros-canvas border border-andros-border"
          role="img"
          aria-label={`Boceto a mano alzada con ${data.strokes.length} trazos`}
        >
          {data.strokes
            .filter((stroke) => stroke.tool !== "eraser")
            .map((stroke) => (
              <polyline
                key={stroke.id}
                points={stroke.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeOpacity={stroke.tool === "highlighter" ? 0.35 : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
        </svg>
      )}

      <div className="space-y-1.5 text-xs font-mono tabular-telemetry tabular-nums">
        {data.checklistItems.length > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-andros-muted">Verificaciones:</span>
            <span
              className={
                doneCount === data.checklistItems.length
                  ? "text-andros-success font-semibold"
                  : "text-andros-primary font-semibold"
              }
            >
              {doneCount} / {data.checklistItems.length}
            </span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-andros-muted">Trazos:</span>
          <span className="text-andros-primary font-semibold">
            {data.strokes.length}
          </span>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Vista previa del Nodo Tipo 3 (Hoja de cálculo + LaTeX)
// ----------------------------------------------------------------------------

const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const CalcLatexPreview: React.FC<{ node: CalcLatexEngineeringNode }> = ({
  node,
}) => {
  const data = node.calcLatexData;
  const cellCount = Object.keys(data.gridCells).length;

  if (cellCount === 0 && data.latexEquations.length === 0) {
    return (
      <p className="py-3 text-xs leading-relaxed text-andros-muted">
        {data.justificationText ||
          "Hoja vacía: todavía no tiene celdas ni ecuaciones."}
      </p>
    );
  }

  const rows = Array.from(
    { length: Math.min(data.gridSize.rows, 6) },
    (_, index) => index + 1
  );
  const columns = COLUMN_LETTERS.slice(0, Math.min(data.gridSize.columns, 3)).split("");

  return (
    <div className="py-3 space-y-3">
      {cellCount > 0 && (
        <div className="rounded-xl border border-andros-border overflow-hidden">
          <table className="w-full text-[11px] font-mono tabular-telemetry tabular-nums border-collapse">
            <tbody>
              {rows.map((row) => (
                <tr key={row} className="border-b border-andros-border last:border-b-0">
                  {columns.map((column, columnIndex) => {
                    const cell = data.gridCells[`${column}${row}`];
                    const isFormula = cell?.raw.startsWith("=") ?? false;
                    return (
                      <td
                        key={column}
                        title={isFormula ? cell?.raw : undefined}
                        className={`px-2 py-1 truncate max-w-[120px] ${
                          columnIndex === 0 ? "text-left" : "text-right"
                        } ${
                          row === 1
                            ? "bg-andros-canvas text-andros-muted"
                            : isFormula
                              ? "text-andros-accent font-semibold"
                              : columnIndex === 0
                                ? "text-andros-muted"
                                : "text-andros-primary"
                        }`}
                      >
                        {cell?.computed ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.latexEquations.length > 0 && (
        <div className="space-y-1.5">
          {data.latexEquations.slice(0, 2).map((equation) => (
            <div key={equation.id} className="space-y-0.5">
              <span className="text-[10px] uppercase tracking-wider text-andros-muted">
                {equation.label}
              </span>
              <code className="block text-[10px] font-mono text-andros-primary bg-andros-canvas border border-andros-border rounded-lg px-2 py-1 truncate">
                {equation.latex}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Lista de enlaces del nodo (solo en la pila táctil del teléfono)
// ----------------------------------------------------------------------------

const NodeConnectionList: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);
  const removeConnection = useWorkspaceStore((s) => s.removeConnection);

  const related = connections.filter(
    (c) => c.fromNodeId === nodeId || c.toNodeId === nodeId
  );
  if (related.length === 0) return null;

  return (
    <ul className="pt-2.5 mt-2.5 border-t border-andros-border space-y-1.5">
      {related.map((connection) => {
        const isOutgoing = connection.fromNodeId === nodeId;
        const otherId = isOutgoing ? connection.toNodeId : connection.fromNodeId;
        const other = nodes.find((n) => n.id === otherId);
        if (!other) return null;

        return (
          <li
            key={connection.id}
            className="flex items-center gap-2 pl-2.5 rounded-xl bg-andros-canvas border border-andros-border"
          >
            {isOutgoing ? (
              <ArrowRight className="w-3.5 h-3.5 text-andros-accent shrink-0" />
            ) : (
              <ArrowLeft className="w-3.5 h-3.5 text-andros-muted shrink-0" />
            )}
            <div className="min-w-0 flex-1 py-1.5">
              <p className="text-[11px] font-medium text-andros-primary truncate">
                {other.title}
              </p>
              <p className="text-[10px] font-mono text-andros-muted truncate">
                {connection.label || (isOutgoing ? "Enlace saliente" : "Enlace entrante")}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeConnection(connection.id);
              }}
              aria-label={`Quitar enlace con ${other.title}`}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-andros-muted active:text-red-500 active:scale-95 spring-micro"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

// ----------------------------------------------------------------------------
// Contenedor polimórfico del nodo
// ----------------------------------------------------------------------------

export const EngineeringNode: React.FC<EngineeringNodeProps> = ({
  node,
  variant,
  isDragging = false,
  onPointerDownCanvas,
  onPortPointerDown,
  showPorts = false,
  highlightedPort = null,
  originPort = null,
}) => {
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);
  const selectNode = useWorkspaceStore((s) => s.selectNode);
  const removeNode = useWorkspaceStore((s) => s.removeNode);
  const startConnecting = useWorkspaceStore((s) => s.startConnecting);
  const setActiveMobileSheet = useWorkspaceStore((s) => s.setActiveMobileSheet);
  const connectionCount = useWorkspaceStore(
    (s) =>
      s.connections.filter(
        (c) => c.fromNodeId === node.id || c.toNodeId === node.id
      ).length
  );

  const isSelected = selectedNodeId === node.id;
  const animations = useSettingsStore((s) => s.animations);
  const full = animations === "full";

  const renderTypeIcon = () => {
    switch (node.type) {
      case "file-node":
        return <FileBox className="w-4 h-4 text-andros-accent shrink-0" />;
      case "sketch-note-node":
        return <NotebookPen className="w-4 h-4 text-andros-accent shrink-0" />;
      case "calc-latex-node":
        return <Sigma className="w-4 h-4 text-andros-accent shrink-0" />;
      case "resource-link-node":
        return <Link2 className="w-4 h-4 text-andros-accent shrink-0" />;
      case "code-lab-node":
        return <Terminal className="w-4 h-4 text-andros-accent shrink-0" />;
      case "ai-chat-node":
        return <Bot className="w-4 h-4 text-andros-accent shrink-0" />;
    }
  };

  const renderBody = () => {
    switch (node.type) {
      case "file-node":
        return <FileNodeView node={node} variant={variant} />;
      case "sketch-note-node":
        return <SketchNotePreview node={node} />;
      case "calc-latex-node":
        return <CalcLatexPreview node={node} />;
      case "resource-link-node":
        return <ResourceLinkNodeView node={node} variant={variant} />;
      case "code-lab-node":
        return <CodeLabNodeView node={node} variant={variant} />;
      case "ai-chat-node":
        return <AiChatNodeView node={node} variant={variant} />;
    }
  };

  const handleMobileConnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectNode(node.id);
    // El orden importa: primero se abre la hoja y luego se fija el origen.
    setActiveMobileSheet("connect");
    startConnecting(node.id);
  };

  const containerClasses =
    variant === "canvas"
      ? `group/node absolute w-80 rounded-2xl bg-andros-card border shadow-card-light dark:shadow-card-dark p-4 cursor-grab active:cursor-grabbing spring-micro select-none ${
          isDragging ? "shadow-2xl border-andros-accent ring-2 ring-andros-accent/60 z-40" : ""
        } ${
          isSelected
            ? "border-andros-accent ring-2 ring-andros-accent/40 z-30"
            : "border-andros-border z-10 hover:border-andros-border-active"
        }`
      : `w-full rounded-2xl bg-andros-card border shadow-card-light dark:shadow-card-dark p-4 spring-micro ${
          isSelected
            ? "border-andros-accent ring-1 ring-andros-accent/40"
            : "border-andros-border"
        }`;

  return (
    <motion.div
      data-node-id={node.id}
      initial={variant === "canvas" && full ? { scale: 0.85, opacity: 0 } : false}
      animate={{ scale: isDragging && full ? 1.025 : 1, opacity: 1 }}
      transition={
        full ? { type: "spring", stiffness: 450, damping: 32, mass: 0.8 } : { duration: 0 }
      }
      onPointerMove={(e) => {
        if (variant !== "canvas" || !full) return;
        const r = e.currentTarget.getBoundingClientRect();
        const k = r.width ? 320 / r.width : 1;
        e.currentTarget.style.setProperty("--sx", `${(e.clientX - r.left) * k}px`);
        e.currentTarget.style.setProperty("--sy", `${(e.clientY - r.top) * k}px`);
      }}
      style={
        variant === "canvas"
          ? {
              left: `${node.position.x}px`,
              top: `${node.position.y}px`,
              // El arrastre debe seguir al cursor sin retardo de animación.
              transitionProperty: "border-color, box-shadow",
            }
          : undefined
      }
      onPointerDown={(e) => {
        selectNode(node.id);
        if (variant !== "canvas" || !onPointerDownCanvas) return;
        const target = e.target as HTMLElement;
        if (target.closest(INTERACTIVE_SELECTOR)) {
          // Clic sobre un botón, enlace o campo: no se arrastra el nodo.
          e.stopPropagation();
          return;
        }
        onPointerDownCanvas(e, node);
      }}
      className={containerClasses}
    >
      {variant === "canvas" && full && <span aria-hidden="true" className="node-spotlight" />}
      {/* Cabecera Técnica del Nodo */}
      <div className="flex items-center justify-between pb-3 border-b border-andros-border gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {renderTypeIcon()}
          <span className="text-xs font-semibold uppercase tracking-wider text-andros-primary truncate">
            {node.title}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono bg-andros-accent/10 text-andros-accent px-1.5 py-0.5 rounded">
            {node.codeTag}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeNode(node.id);
            }}
            className="p-1 rounded-lg text-andros-muted hover:text-red-500 hover:bg-andros-border/40 spring-micro"
            title="Eliminar nodo"
            aria-label="Eliminar nodo"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Descripción opcional */}
      {node.summary && (
        <p className="pt-3 text-xs leading-relaxed text-andros-muted">
          {node.summary}
        </p>
      )}

      {/* Cuerpo según el tipo de nodo */}
      {renderBody()}

      {/* Telemetría Tabular opcional */}
      {node.metrics && node.metrics.length > 0 && (
        <div className="pb-3 space-y-2">
          {node.metrics.map((metric) => (
            <div
              key={metric.id}
              className="flex justify-between items-center text-xs font-mono tabular-telemetry tabular-nums"
            >
              <span className="text-andros-muted">{metric.label}:</span>
              <span
                className={
                  metric.status === "optimal"
                    ? "text-andros-success font-semibold"
                    : "text-andros-primary font-semibold"
                }
              >
                {metric.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Pie: Timestamp y Enlaces */}
      <div className="pt-2.5 border-t border-andros-border flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-andros-muted">
          {node.updatedAt}
        </span>

        {variant === "stack" ? (
          <button
            type="button"
            onClick={handleMobileConnect}
            className="min-h-[44px] px-3.5 rounded-xl bg-andros-border/50 text-xs font-medium text-andros-primary flex items-center gap-1.5 spring-micro active:scale-95"
          >
            <Cable className="w-3.5 h-3.5 text-andros-accent" />
            <span>Conectar</span>
          </button>
        ) : (
          <span className="text-[10px] font-mono tabular-nums text-andros-muted flex items-center gap-1.5">
            <Cable className="w-3 h-3" />
            {connectionCount} {connectionCount === 1 ? "enlace" : "enlaces"}
          </span>
        )}
      </div>

      {variant === "stack" && <NodeConnectionList nodeId={node.id} />}

      {/* Puertos magnéticos (solo en el lienzo de PC) */}
      {variant === "canvas" &&
        onPortPointerDown &&
        PORT_POSITIONS.map((port) => {
          const isHighlighted = highlightedPort === port;
          const isOrigin = originPort === port;
          const alwaysVisible = showPorts || isSelected || isHighlighted || isOrigin;

          return (
            <button
              key={port}
              type="button"
              data-port={port}
              title="Arrastra desde aquí para conectar con otro nodo"
              aria-label={`Puerto ${PORT_LABELS[port]} de ${node.title}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPortPointerDown(e, node, port);
              }}
              className={`absolute ${PORT_ANCHOR_CLASSES[port]} -translate-x-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full cursor-crosshair touch-none spring-micro ${
                alwaysVisible
                  ? "opacity-100"
                  : "opacity-0 group-hover/node:opacity-100"
              }`}
            >
              <span
                className={`block rounded-full border-2 border-andros-accent spring-micro ${
                  isHighlighted
                    ? "w-4 h-4 bg-andros-accent ring-4 ring-andros-accent/30"
                    : isOrigin
                      ? "w-3.5 h-3.5 bg-andros-accent"
                      : "w-3 h-3 bg-andros-card hover:bg-andros-accent"
                }`}
              />
            </button>
          );
        })}
    </motion.div>
  );
};
