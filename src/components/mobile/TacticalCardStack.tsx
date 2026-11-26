"use client";

import React from "react";
import { ClipboardPaste, Layers } from "lucide-react";
import { pasteClipboard } from "@/lib/canvas/clipboardActions";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useTabsBarVisible } from "@/store/useTabsStore";
import { useIsExpert } from "@/store/useSettingsStore";
import { NodeArchetype } from "@/types/workspace";
import { EngineeringNode } from "@/components/shared/EngineeringNode";
import { EmptyWorkspaceStarter, useStarterVisible } from "@/components/shared/EmptyWorkspaceStarter";
import { useStarterStore } from "@/store/useStarterStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { UnifiedAlertsBar } from "@/components/cde/UnifiedAlertsBar";
import { ResolutionStatusPill } from "@/components/cde/ResolutionStatusPill";

const FILTER_TABS: { id: "all" | NodeArchetype; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "file-node", label: "Archivos" },
  { id: "sketch-note-node", label: "Cuadernos" },
  { id: "calc-latex-node", label: "Cálculos" },
  { id: "resource-link-node", label: "Enlaces" },
  { id: "code-lab-node", label: "Código" },
  { id: "ai-chat-node", label: "IA" },
  { id: "form-sheet-node", label: "Fichas" },
  { id: "formula-sheet-node", label: "Fórmulas" },
];

/** Pestañas de herramientas técnicas (cálculo LaTeX, CodeLab, fórmulas): del Modo Experto. */
const EXPERT_TABS = new Set<string>(["calc-latex-node", "code-lab-node", "formula-sheet-node"]);

export const TacticalCardStack: React.FC = () => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const expert = useIsExpert();
  const mobileCategoryFilter = useWorkspaceStore((s) => s.mobileCategoryFilter);
  const setMobileCategoryFilter = useWorkspaceStore(
    (s) => s.setMobileCategoryFilter
  );
  const isMiniMapVisible = useWorkspaceStore((s) => s.isMiniMapVisible);
  const toggleMiniMap = useWorkspaceStore((s) => s.toggleMiniMap);
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);
  const selectNode = useWorkspaceStore((s) => s.selectNode);
  const hasTabs = useTabsBarVisible();
  const starterVisible = useStarterVisible();
  const reopenStarter = useStarterStore((s) => s.reopen);
  const starterDismissed = useStarterStore((s) => s.dismissed);
  // Sala completa (7.º) o rol Comentarista / Solo lectura: tarjetas de solo lectura (el desplazamiento sigue).
  const readOnly = useCanvasReadOnly();
  const hasClipboard = useWorkspaceStore((s) => s.clipboard !== null);

  const filteredNodes =
    mobileCategoryFilter === "all"
      ? nodes
      : nodes.filter((n) => n.type === mobileCategoryFilter);
  // Modo Simple: las pestañas técnicas solo aparecen si ya hay tarjetas de ese tipo.
  const filterTabs = FILTER_TABS.filter(
    (tab) =>
      expert ||
      !EXPERT_TABS.has(tab.id) ||
      mobileCategoryFilter === tab.id ||
      nodes.some((n) => n.type === tab.id)
  );

  return (
    <main
      className={`min-h-screen w-full canvas-grid ${
        hasTabs ? "pt-[6.75rem]" : "pt-16"
      } pb-28 px-3.5 flex flex-col gap-3.5 overflow-y-auto`}
    >
      {/* Barra de Filtros Táctiles + Conmutador de Mapa 2D */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {filterTabs.map((tab) => {
            const active = mobileCategoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMobileCategoryFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap spring-micro ${
                  active
                    ? "bg-andros-primary text-andros-canvas shadow-sm"
                    : "bg-andros-surface text-andros-muted border border-andros-border"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={toggleMiniMap}
          className={`shrink-0 px-2.5 py-1.5 rounded-xl border text-xs font-mono flex items-center gap-1.5 spring-micro ${
            isMiniMapVisible
              ? "bg-andros-accent/15 border-andros-accent text-andros-accent-ink"
              : "bg-andros-surface border-andros-border text-andros-muted"
          }`}
        >
          <span>2D</span>
        </button>
      </div>

      {/* Mapa Miniatura 2D Opcional */}
      {isMiniMapVisible && (
        <div className="w-full h-36 rounded-2xl canvas-grid-mini border border-andros-border relative overflow-hidden p-2 shadow-inner">
          <span className="text-[10px] font-mono text-andros-muted uppercase tracking-wider">
            Radar Espacial 2D ({nodes.length} nodos)
          </span>
          {nodes.map((node) => {
            const normX = Math.min(Math.max(node.position.x / 8, 12), 260);
            const normY = Math.min(Math.max(node.position.y / 6, 24), 110);
            const isSel = selectedNodeId === node.id;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => selectNode(node.id)}
                style={{ left: `${normX}px`, top: `${normY}px` }}
                className={`absolute px-2 py-0.5 rounded text-[9px] font-mono truncate max-w-[90px] border spring-micro ${
                  isSel
                    ? "bg-andros-accent-fill text-white border-andros-accent scale-110 z-10"
                    : "bg-andros-card text-andros-primary border-andros-border"
                }`}
              >
                {node.codeTag}
              </button>
            );
          })}
        </div>
      )}

      {/* Alerta unificada de IA y semáforo Rojo / Verde de las Fichas de Resolución */}
      <UnifiedAlertsBar variant="stack" />
      <ResolutionStatusPill variant="stack" />

      {hasClipboard && !readOnly && (
        <button
          type="button"
          onClick={() => pasteClipboard()}
          className="self-start min-h-11 px-3.5 rounded-xl border border-andros-border bg-andros-surface text-xs font-medium text-andros-primary flex items-center gap-1.5 active:scale-[0.96] spring-micro"
        >
          <ClipboardPaste className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
          Pegar ficha
        </button>
      )}

      {/* Pila de Tarjetas de Ingeniería */}
      <div className={`flex flex-col gap-3 ${readOnly ? "pointer-events-none" : ""}`}>
        {nodes.length === 0 && starterVisible ? (
          <EmptyWorkspaceStarter variant="stack" />
        ) : filteredNodes.length === 0 ? (
          <div className="rounded-2xl bg-andros-card border border-andros-border p-8 text-center space-y-2">
            <Layers className="w-6 h-6 text-andros-muted mx-auto" />
            <p className="text-xs text-andros-muted">
              {nodes.length === 0
                ? expert
                  ? "Tu espacio está vacío. Pulsa “Agregar” abajo para subir tu primera pieza 3D, una nota o un enlace."
                  : "Tu espacio está vacío. Pulsa “Agregar” abajo y crea tu primera tarjeta para organizar tu evento o equipo."
                : "No hay nada en esta categoría todavía."}
            </p>
            {nodes.length === 0 && starterDismissed && (
              <button
                type="button"
                onClick={reopenStarter}
                className="min-h-11 px-3 text-xs font-medium text-andros-accent-ink underline underline-offset-2 active:scale-[0.96] spring-micro"
              >
                Ver plantillas y generador de tablero
              </button>
            )}
          </div>
        ) : (
          filteredNodes.map((node) => (
            <EngineeringNode key={node.id} node={node} variant="stack" />
          ))
        )}
      </div>
    </main>
  );
};