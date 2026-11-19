"use client";

import React, { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Box,
  Cable,
  Calculator,
  Check,
  FileBox,
  Library,
  Link2,
  MessagesSquare,
  NotebookPen,
  Sigma,
  StickyNote,
  Terminal,
  X,
} from "lucide-react";
import { QUICK_ADD_OPTIONS, quickAdd, type QuickAddKind } from "@/lib/canvas/quickAdd";
import { NODE_ARCHETYPE_LABELS, useWorkspaceStore } from "@/store/useWorkspaceStore";
import { EngineeringNodeData, NodeArchetype } from "@/types/workspace";
import { useLibraryStore } from "@/store/useLibraryStore";

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
    case "resource-link-node":
      return <Link2 className={className} />;
    case "code-lab-node":
      return <Terminal className={className} />;
    case "ai-chat-node":
      return <Bot className={className} />;
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

const QUICK_ADD_ICONS: Record<QuickAddKind, React.ReactNode> = {
  file3d: <Box className="w-5 h-5" />,
  note: <StickyNote className="w-5 h-5" />,
  link: <Link2 className="w-5 h-5" />,
  calc: <Calculator className="w-5 h-5" />,
  ai: <Bot className="w-5 h-5" />,
  "ai-import": <MessagesSquare className="w-5 h-5" />,
};

/** Las 4 opciones de "+ Agregar" (las mismas que el dock de escritorio). */
const AddSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const nodesCount = useWorkspaceStore((s) => s.nodes.length);
  const setActiveMobileSheet = useWorkspaceStore((s) => s.setActiveMobileSheet);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) quickAdd("file3d", file);
  };

  return (
    <div className="space-y-3">
      <SheetHeader title="Agregar" onClose={onClose} />

      {/* Sin `accept`: iOS deshabilita .stl / .3mf si se filtra por extensión */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFile}
        aria-label="Subir archivo 3D"
      />

      <div className="grid grid-cols-2 gap-2.5">
        {QUICK_ADD_OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() =>
              option.kind === "file3d" ? fileInputRef.current?.click() : quickAdd(option.kind)
            }
            className="min-h-[96px] p-3.5 rounded-2xl bg-andros-canvas border border-andros-border flex flex-col items-start gap-2 text-left active:scale-98 spring-micro"
          >
            <span className="w-9 h-9 rounded-xl bg-andros-accent/10 text-andros-accent flex items-center justify-center">
              {QUICK_ADD_ICONS[option.kind]}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-andros-primary">{option.label}</span>
              <span className="block text-[11px] leading-snug text-andros-muted">{option.description}</span>
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          onClose();
          useLibraryStore.getState().openLibrary({ origin: "canvas" });
        }}
        className="w-full min-h-[56px] px-3.5 rounded-2xl bg-andros-canvas border border-andros-border flex items-center gap-3 text-left active:scale-98 spring-micro"
      >
        <span className="w-9 h-9 shrink-0 rounded-xl bg-andros-accent/10 text-andros-accent flex items-center justify-center">
          <Library className="w-4 h-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-andros-primary">Biblioteca de fuentes</span>
          <span className="block text-[11px] leading-snug text-andros-muted">Papers, normas, YouTube y LinkedIn citables</span>
        </span>
      </button>

      {nodesCount >= 2 && (
        <button
          type="button"
          onClick={() => setActiveMobileSheet("connect")}
          className="w-full min-h-[44px] flex items-center justify-center gap-2 text-xs text-andros-muted active:scale-98 spring-micro"
        >
          <Cable className="w-3.5 h-3.5" />
          <span>Conectar piezas entre sí</span>
        </button>
      )}
    </div>
  );
};

export const MobileBottomSheet: React.FC = () => {
  const activeMobileSheet = useWorkspaceStore((s) => s.activeMobileSheet);
  const setActiveMobileSheet = useWorkspaceStore((s) => s.setActiveMobileSheet);

  if (
    activeMobileSheet === "none" ||
    activeMobileSheet === "node-detail" ||
    activeMobileSheet === "library" ||
    // El Oráculo abre su propio Estudio a pantalla completa (OracleModal).
    activeMobileSheet === "oracle"
  ) {
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

        {activeMobileSheet === "connect" && <ConnectSheet onClose={closeSheet} />}

        {activeMobileSheet === "new-node" && <AddSheet onClose={closeSheet} />}
      </div>
    </div>
  );
};

