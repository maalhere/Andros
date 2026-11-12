"use client";

import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Cable,
  Check,
  FileBox,
  NotebookPen,
  Sigma,
  X,
} from "lucide-react";
import { NODE_ARCHETYPE_LABELS, useWorkspaceStore } from "@/store/useWorkspaceStore";
import { EngineeringNodeData, NodeArchetype } from "@/types/workspace";
import { OracleModal } from "@/components/shared/OracleModal";

// ============================================================================
// Piezas compartidas
// ============================================================================

const renderArchetypeIcon = (type: NodeArchetype, className: string) => {
  switch (type) {
    case "file-node":
      return <FileBox className={className} />;
    case "sketch-note-node":
      return <NotebookPen className={className} />;
    case "calc-latex-node":
      return <Sigma className={className} />;
  }
};

const SheetHeader: React.FC<{ title: string; onClose: () => void }> = ({
  title,
  onClose,
}) => (
  <div className="flex items-center justify-between gap-2">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-andros-primary">
      {title}
    </h3>
    <button
      type="button"
      onClick={onClose}
      aria-label="Cerrar"
      className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-andros-muted active:scale-95 spring-micro"
    >
      <X className="w-4 h-4" />
    </button>
  </div>
);

/** Fila táctil (>= 56px de alto) que representa un nodo dentro de una lista. */
const NodeRow: React.FC<{
  node: EngineeringNodeData;
  onPress?: () => void;
  trailing?: React.ReactNode;
  caption?: string;
  highlighted?: boolean;
}> = ({ node, onPress, trailing, caption, highlighted = false }) => {
  const content = (
    <>
      {renderArchetypeIcon(node.type, "w-5 h-5 text-andros-accent shrink-0")}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-andros-primary truncate">
          {node.title}
        </div>
        <div className="text-[11px] text-andros-muted font-mono truncate">
          {caption ?? `${NODE_ARCHETYPE_LABELS[node.type]} · ${node.codeTag}`}
        </div>
      </div>
      {trailing}
    </>
  );

  const baseClasses = `w-full min-h-[56px] px-3.5 py-2.5 rounded-xl border flex items-center gap-3 text-left ${
    highlighted
      ? "bg-andros-accent/10 border-andros-accent"
      : "bg-andros-canvas border-andros-border"
  }`;

  if (!onPress) {
    return <div className={baseClasses}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onPress}
      className={`${baseClasses} active:scale-98 spring-micro`}
    >
      {content}
    </button>
  );
};

// ============================================================================
// Menú táctil para conectar nodos
// ============================================================================

const QUICK_LABELS = [
  "Sustenta diseño de",
  "Aporta datos a",
  "Justifica cálculo de",
  "Referencia de",
];

const ConnectSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);
  const connectingFrom = useWorkspaceStore((s) => s.connectingFrom);
  const startConnecting = useWorkspaceStore((s) => s.startConnecting);
  const cancelConnecting = useWorkspaceStore((s) => s.cancelConnecting);
  const completeConnection = useWorkspaceStore((s) => s.completeConnection);
  const removeConnection = useWorkspaceStore((s) => s.removeConnection);
  const selectConnection = useWorkspaceStore((s) => s.selectConnection);

  const [label, setLabel] = useState("");

  const originNode = connectingFrom
    ? nodes.find((n) => n.id === connectingFrom.nodeId) ?? null
    : null;

  // --------------------------------------------------------------------------
  // PASO 1 — Elegir el nodo de origen
  // --------------------------------------------------------------------------
  if (!originNode) {
    return (
      <div className="space-y-3">
        <SheetHeader title="Conectar Nodos · Paso 1 de 2" onClose={onClose} />
        <p className="text-[11px] leading-relaxed text-andros-muted">
          Toca el nodo desde el que <strong className="text-andros-primary">sale</strong> la
          conexión.
        </p>

        {nodes.length < 2 ? (
          <p className="p-4 rounded-xl bg-andros-canvas border border-andros-border text-xs text-andros-muted text-center">
            Necesitas al menos dos nodos para crear una conexión.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {nodes.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                onPress={() => startConnecting(node.id)}
                trailing={<ArrowRight className="w-4 h-4 text-andros-muted shrink-0" />}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // PASO 2 — Elegir el nodo de destino
  // --------------------------------------------------------------------------
  const otherNodes = nodes.filter((n) => n.id !== originNode.id);

  const findLink = (otherId: string) =>
    connections.find(
      (c) =>
        (c.fromNodeId === originNode.id && c.toNodeId === otherId) ||
        (c.fromNodeId === otherId && c.toNodeId === originNode.id)
    );

  const handleConnect = (targetId: string) => {
    completeConnection(targetId, undefined, label);
    // En el teléfono no hay cable que editar: se limpia la selección.
    selectConnection(null);
    onClose();
  };

  return (
    <div className="space-y-3">
      <SheetHeader title="Conectar Nodos · Paso 2 de 2" onClose={onClose} />

      {/* Origen elegido */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-andros-muted">
          Desde
        </span>
        <NodeRow
          node={originNode}
          highlighted
          trailing={
            <button
              type="button"
              onClick={cancelConnecting}
              className="shrink-0 min-h-[44px] px-3 -mr-2 rounded-xl text-[11px] font-medium text-andros-accent flex items-center gap-1 active:scale-95 spring-micro"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Cambiar
            </button>
          }
        />
      </div>

      {/* Etiqueta opcional */}
      <div className="space-y-2">
        <label
          htmlFor="andros-connection-label"
          className="text-[10px] font-mono uppercase tracking-wider text-andros-muted"
        >
          Etiqueta (opcional)
        </label>
        <input
          id="andros-connection-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="ej. Sustenta diseño de"
          className="w-full min-h-[44px] bg-andros-canvas border border-andros-border focus:border-andros-accent rounded-xl px-3.5 text-base text-andros-primary placeholder:text-andros-muted outline-none spring-micro"
        />
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {QUICK_LABELS.map((quick) => {
            const active = label === quick;
            return (
              <button
                key={quick}
                type="button"
                onClick={() => setLabel(active ? "" : quick)}
                className={`shrink-0 min-h-[36px] px-3 rounded-xl text-[11px] font-medium whitespace-nowrap border spring-micro active:scale-95 ${
                  active
                    ? "bg-andros-primary text-andros-canvas border-andros-primary"
                    : "bg-andros-surface text-andros-muted border-andros-border"
                }`}
              >
                {quick}
              </button>
            );
          })}
        </div>
      </div>

      {/* Destinos posibles */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-andros-muted">
          Hacia · toca el nodo de destino
        </span>

        {otherNodes.length === 0 ? (
          <p className="p-4 rounded-xl bg-andros-canvas border border-andros-border text-xs text-andros-muted text-center">
            No hay otros nodos todavía. Crea uno nuevo para poder conectarlo.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {otherNodes.map((node) => {
              const link = findLink(node.id);

              if (link) {
                return (
                  <NodeRow
                    key={node.id}
                    node={node}
                    caption={`Ya conectado${link.label ? ` · ${link.label}` : ""}`}
                    trailing={
                      <button
                        type="button"
                        onClick={() => removeConnection(link.id)}
                        className="shrink-0 min-h-[44px] px-3 -mr-2 rounded-xl text-[11px] font-medium text-red-500 flex items-center gap-1 active:scale-95 spring-micro"
                      >
                        <X className="w-3.5 h-3.5" />
                        Desconectar
                      </button>
                    }
                  />
                );
              }

              return (
                <NodeRow
                  key={node.id}
                  node={node}
                  onPress={() => handleConnect(node.id)}
                  trailing={
                    <span className="shrink-0 w-8 h-8 rounded-full bg-andros-accent/10 text-andros-accent flex items-center justify-center">
                      <Check className="w-4 h-4" />
                    </span>
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Cajón inferior deslizable (Teléfono < 768px)
// ============================================================================

const NEW_NODE_OPTIONS: {
  type: NodeArchetype;
  name: string;
  description: string;
}[] = [
  {
    type: "file-node",
    name: "Archivo Descargable",
    description: "CAD, STL, PDF, ZIP o datasets · cualquier peso",
  },
  {
    type: "sketch-note-node",
    name: "Cuaderno de Notas y Boceto",
    description: "Texto, listas de verificación y dibujo a mano",
  },
  {
    type: "calc-latex-node",
    name: "Hoja de Cálculo + LaTeX",
    description: "Celdas con fórmulas y ecuaciones justificadas",
  },
];

export const MobileBottomSheet: React.FC = () => {
  const activeMobileSheet = useWorkspaceStore((s) => s.activeMobileSheet);
  const setActiveMobileSheet = useWorkspaceStore((s) => s.setActiveMobileSheet);
  const spawnNode = useWorkspaceStore((s) => s.spawnNode);
  const nodesCount = useWorkspaceStore((s) => s.nodes.length);

  if (activeMobileSheet === "none" || activeMobileSheet === "node-detail") {
    return null;
  }

  const closeSheet = () => setActiveMobileSheet("none");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex flex-col justify-end"
      onClick={closeSheet}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-andros-card border-t border-andros-border shadow-sheet-light dark:shadow-sheet-dark p-5 pb-8 space-y-4 spring-micro"
      >
        {/* Píldora de arrastre */}
        <div className="w-10 h-1 rounded-full bg-andros-border-active mx-auto" />

        {activeMobileSheet === "oracle" && <OracleModal embeddedInSheet />}

        {activeMobileSheet === "connect" && <ConnectSheet onClose={closeSheet} />}

        {activeMobileSheet === "new-node" && (
          <div className="space-y-3">
            <SheetHeader title="Crear Nuevo Nodo" onClose={closeSheet} />

            <div className="grid grid-cols-1 gap-2.5">
              {NEW_NODE_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => spawnNode({ type: option.type })}
                  className="min-h-[56px] p-3.5 rounded-xl bg-andros-canvas border border-andros-border flex items-center gap-3 text-left active:scale-98 spring-micro"
                >
                  {renderArchetypeIcon(
                    option.type,
                    "w-5 h-5 text-andros-accent shrink-0"
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-andros-primary">
                      {option.name}
                    </div>
                    <div className="text-[11px] text-andros-muted font-mono">
                      {option.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Acceso directo al menú táctil de conexión */}
            <button
              type="button"
              onClick={() => setActiveMobileSheet("connect")}
              disabled={nodesCount < 2}
              className="w-full min-h-[48px] px-3.5 rounded-xl border border-dashed border-andros-border-active flex items-center justify-center gap-2 text-xs font-medium text-andros-primary active:scale-98 spring-micro disabled:opacity-50"
            >
              <Cable className="w-4 h-4 text-andros-accent" />
              <span>Conectar nodos existentes</span>
            </button>
          </div>
        )}

        {activeMobileSheet === "library" && (
          <div className="space-y-3">
            <SheetHeader title="Biblioteca Técnica Rápida" onClose={closeSheet} />

            <button
              type="button"
              onClick={() =>
                spawnNode({
                  type: "sketch-note-node",
                  title: "ASTM A500 Structural Tubing",
                  codeTag: "STD-ASTM",
                  summary:
                    "Especificación estándar para tubería estructural de acero al carbono formada en frío.",
                })
              }
              className="w-full min-h-[56px] p-3.5 rounded-xl bg-andros-canvas border border-andros-border flex items-center gap-3 text-left active:scale-98 spring-micro"
            >
              <BookOpen className="w-5 h-5 text-andros-accent shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-andros-primary">
                  Insertar Norma ASTM A500
                </div>
                <div className="text-[11px] font-mono text-andros-muted">
                  Se agrega como cuaderno a la pila de trabajo
                </div>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
