"use client";

import React, { useState } from "react";
import {
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  FileText,
  LayoutGrid,
  Link2,
  ListTodo,
  Loader2,
  Network,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { NODE_ARCHETYPE_LABELS, useWorkspaceStore } from "@/store/useWorkspaceStore";
import { buildOracleCanvasContext } from "@/lib/oracle/buildCanvasContext";
import type {
  OracleAction,
  OracleEngine,
  OracleHistoryTurn,
  OracleResponseBody,
} from "@/types/oracle";

interface OracleModalProps {
  embeddedInSheet?: boolean;
}

const DEFAULT_SYNTHESIS =
  'Puedo leer y analizar todo el lienzo, redactar bloques de texto vinculados a un archivo (plan de pruebas, ficha técnica, pendientes de impresión…), conectar nodos y ordenar el lienzo por flujo de trabajo. Elige un archivo en "Vincular a" y pídelo con tus palabras.';

/** Valores especiales del selector "Vincular a archivo / nodo". */
const LINK_AUTO = "__auto__";
const LINK_NONE = "__none__";

const ENGINE_LABELS: Record<OracleEngine, string> = {
  gemini: "GEMINI 2.5 FLASH",
  openai: "OPENAI",
  local: "MODO LOCAL",
};

/** Pedidos de 1 clic para redactar un bloque sobre el archivo vinculado. */
const TEXT_BLOCK_PRESETS = [
  {
    id: "test-plan",
    label: "Plan de pruebas",
    icon: ClipboardCheck,
    prompt:
      "Crea un plan de pruebas técnico para este archivo, con pruebas numeradas, valores de aceptación concretos y checklist final.",
  },
  {
    id: "datasheet",
    label: "Ficha técnica",
    icon: FileText,
    prompt:
      "Redacta una ficha técnica de este archivo con sus datos reales (formato, peso, dimensiones), proceso de fabricación recomendado y controles de calidad.",
  },
  {
    id: "print-readiness",
    label: "Qué falta para imprimir",
    icon: ListTodo,
    prompt:
      "Resume qué falta para poder imprimir esta pieza como checklist de tareas pendientes, con parámetros de impresión concretos.",
  },
] as const;

export const OracleModal: React.FC<OracleModalProps> = ({ embeddedInSheet = false }) => {
  const isOracleModalOpen = useWorkspaceStore((s) => s.isOracleModalOpen);
  const setOracleModalOpen = useWorkspaceStore((s) => s.setOracleModalOpen);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);

  const aiCreateNode = useWorkspaceStore((s) => s.aiCreateNode);
  const aiConnectNodes = useWorkspaceStore((s) => s.aiConnectNodes);
  const aiAnnotateSelected = useWorkspaceStore((s) => s.aiAnnotateSelected);
  const aiCreateTextBlock = useWorkspaceStore((s) => s.aiCreateTextBlock);
  const aiUpdateNodeNote = useWorkspaceStore((s) => s.aiUpdateNodeNote);
  const aiApplyHumanLayout = useWorkspaceStore((s) => s.aiApplyHumanLayout);

  const [prompt, setPrompt] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [lastSynthesis, setLastSynthesis] = useState<string>(DEFAULT_SYNTHESIS);
  const [lastEngine, setLastEngine] = useState<OracleEngine | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [history, setHistory] = useState<OracleHistoryTurn[]>([]);
  const [linkChoice, setLinkChoice] = useState<string>(LINK_AUTO);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  /** Archivo/nodo al que se refieren los bloques de texto que se pidan. */
  const linkedNodeId =
    linkChoice === LINK_AUTO
      ? (selectedNodeId ?? null)
      : linkChoice === LINK_NONE
        ? null
        : nodes.some((n) => n.id === linkChoice)
          ? linkChoice
          : null;
  const linkedNode = nodes.find((n) => n.id === linkedNodeId);

  if (!embeddedInSheet && !isOracleModalOpen) return null;

  // Archivos primero en el selector: son la referencia más habitual.
  const linkOptions = [...nodes].sort(
    (a, b) =>
      Number(b.type === "file-node") - Number(a.type === "file-node") ||
      a.title.localeCompare(b.title)
  );

  const titleOf = (id: string) =>
    useWorkspaceStore.getState().nodes.find((n) => n.id === id)?.title ?? "nodo";

  const describeLayout = (r: { zone1: number; zone2: number; zone3: number }) =>
    `Lienzo ordenado: ${r.zone1} archivo(s) en Zona 1, ${r.zone2} texto(s) en Zona 2, ${r.zone3} fuente(s)/cálculo(s) en Zona 3`;

  // --------------------------------------------------------------------------
  // Aplica en vivo las acciones que devuelve el motor (Gemini/OpenAI o local).
  // Cada acción modifica `nodes`/`connections` en el store, y `useCloudSync`
  // las guarda solo en Supabase (debounce de 1.2 s) sin pasos adicionales.
  // --------------------------------------------------------------------------
  const applyActions = (actions: OracleAction[]): string[] => {
    const log: string[] = [];
    for (const action of actions) {
      switch (action.type) {
        case "create_text_block": {
          aiCreateTextBlock({
            title: action.title,
            content: action.content,
            linkedNodeId: action.linkedNodeId,
            connectionLabel: action.connectionLabel,
          });
          log.push(
            action.linkedNodeId
              ? `Bloque "${action.title}" creado y conectado a "${titleOf(action.linkedNodeId)}"`
              : `Bloque "${action.title}" creado`
          );
          break;
        }
        case "connect_nodes":
          aiConnectNodes(action.fromNodeId, action.toNodeId, action.label);
          log.push(
            `Cable "${titleOf(action.fromNodeId)}" → "${titleOf(action.toNodeId)}"${
              action.label ? ` (${action.label})` : ""
            }`
          );
          break;
        case "update_node_note":
          if (aiUpdateNodeNote(action.nodeId, action.content, action.mode)) {
            log.push(
              `${action.mode === "replace" ? "Texto reemplazado" : "Texto añadido"} en "${titleOf(action.nodeId)}"`
            );
          }
          break;
        case "apply_human_layout":
          log.push(describeLayout(aiApplyHumanLayout(action.assignments)));
          break;
        case "auto_layout":
          log.push(describeLayout(aiApplyHumanLayout()));
          break;
        case "create_node": {
          const id = aiCreateNode({
            type: action.nodeType,
            title: action.title,
            summary: action.summary,
          });
          log.push(`Nodo "${titleOf(id)}" creado`);
          break;
        }
        case "annotate_selected":
          aiAnnotateSelected();
          log.push("Guía de impresión 3D creada junto al nodo seleccionado");
          break;
      }
    }
    return log;
  };

  const runPrompt = async (text: string) => {
    if (!text || isThinking) return;
    setPrompt("");
    setIsThinking(true);
    setActionLog([]);
    try {
      const state = useWorkspaceStore.getState();
      const res = await fetch("/api/oracle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          context: buildOracleCanvasContext(
            state.nodes,
            state.connections,
            state.selectedNodeId,
            linkedNodeId
          ),
          history: history.slice(-6),
        }),
      });
      const data: OracleResponseBody = await res.json();
      const reply = data.reply || DEFAULT_SYNTHESIS;
      setLastSynthesis(reply);
      setLastEngine(data.engine ?? null);
      setActionLog(applyActions(data.actions ?? []));
      setHistory((prev) =>
        [...prev, { role: "user" as const, text }, { role: "oracle" as const, text: reply }].slice(-6)
      );
    } catch {
      setLastSynthesis("No pude contactar al motor de síntesis. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setIsThinking(false);
    }
  };

  const handleSynthesize = (e: React.FormEvent) => {
    e.preventDefault();
    void runPrompt(prompt.trim());
  };

  // --------------------------------------------------------------------------
  // Botones de Acción Rápida de 1 clic
  // --------------------------------------------------------------------------
  const handleQuickLayout = () => {
    const result = aiApplyHumanLayout();
    setLastEngine(null);
    setActionLog([describeLayout(result)]);
    setLastSynthesis(
      "Ordené el lienzo por flujo de trabajo: Zona 1 (izquierda) archivos fuente y modelos 3D; Zona 2 (centro) textos y análisis a la derecha de su archivo; Zona 3 (derecha) fuentes, enlaces y cálculos."
    );
  };

  const handleQuickPrintGuide = () => {
    if (!selectedNode) {
      setLastSynthesis(
        "Selecciona primero un nodo (idealmente un archivo .stl, .obj o .3mf) para generar su guía de impresión."
      );
      return;
    }
    aiAnnotateSelected();
    setLastEngine(null);
    setActionLog([`Guía de impresión 3D creada junto a "${selectedNode.title}"`]);
    setLastSynthesis(`Generé una guía técnica de impresión 3D junto a "${selectedNode.title}".`);
  };

  const handleQuickConnectLoose = () => {
    const connectedIds = new Set(connections.flatMap((c) => [c.fromNodeId, c.toNodeId]));
    const looseNodes = nodes.filter((n) => !connectedIds.has(n.id));
    if (looseNodes.length < 2) {
      setLastSynthesis("No encontré nodos sueltos por conectar en este momento.");
      return;
    }
    let pairs = 0;
    for (let i = 0; i + 1 < looseNodes.length; i += 2) {
      aiConnectNodes(looseNodes[i].id, looseNodes[i + 1].id, "Conexión sugerida");
      pairs += 1;
    }
    setLastEngine(null);
    setActionLog([]);
    setLastSynthesis(`Conecté ${pairs} par(es) de nodos sueltos del lienzo.`);
  };

  const quickButtonClass =
    "px-2.5 py-1.5 rounded-lg bg-andros-canvas border border-andros-border hover:border-andros-accent/50 text-[11px] font-medium text-andros-primary flex items-center gap-1.5 spring-micro active:scale-95 disabled:opacity-50";

  const content = (
    <div className="w-full flex flex-col gap-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between pb-3 border-b border-andros-border">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-andros-accent/15 text-andros-accent">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-andros-primary">
              Oráculo IA • Asistente de Investigación
            </h3>
            <p className="text-[11px] font-mono text-andros-muted truncate">
              {`${nodes.length} nodos · ${connections.length} cables en contexto`}
              {selectedNode ? ` · Seleccionado: ${selectedNode.title}` : ""}
            </p>
          </div>
        </div>

        {!embeddedInSheet && (
          <button
            onClick={() => setOracleModalOpen(false)}
            className="p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
            aria-label="Cerrar Oráculo"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Acciones Rápidas de 1 Clic */}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={handleQuickLayout} className={quickButtonClass}>
          <LayoutGrid className="w-3.5 h-3.5 text-andros-accent" />
          Ordenar por flujo de trabajo
        </button>
        <button type="button" onClick={handleQuickPrintGuide} className={quickButtonClass}>
          <Boxes className="w-3.5 h-3.5 text-andros-accent" />
          Guía de impresión de la pieza
        </button>
        <button type="button" onClick={handleQuickConnectLoose} className={quickButtonClass}>
          <Network className="w-3.5 h-3.5 text-andros-accent" />
          Conectar nodos sueltos
        </button>
      </div>

      {/* Vincular a archivo / nodo + bloques de texto de 1 clic */}
      <div className="p-3 rounded-xl border border-andros-border space-y-2.5">
        <label className="flex items-center gap-2 text-[11px] font-medium text-andros-primary">
          <Link2 className="w-3.5 h-3.5 text-andros-accent shrink-0" />
          <span className="shrink-0">Vincular a archivo / nodo</span>
          <select
            value={linkChoice}
            onChange={(e) => setLinkChoice(e.target.value)}
            disabled={isThinking}
            className="min-w-0 flex-1 bg-andros-canvas border border-andros-border focus:border-andros-accent rounded-lg px-2 py-1.5 text-[11px] text-andros-primary outline-none spring-micro"
          >
            <option value={LINK_AUTO}>
              {selectedNode ? `Seleccionado: ${selectedNode.title}` : "Automático (nodo seleccionado)"}
            </option>
            <option value={LINK_NONE}>Sin vincular (detectar por nombre)</option>
            {linkOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {`${NODE_ARCHETYPE_LABELS[node.type]} · ${node.title}${
                  node.type === "file-node" && node.fileData.extension
                    ? ` (.${node.fileData.extension})`
                    : ""
                }`}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-1.5">
          {TEXT_BLOCK_PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={!linkedNode || isThinking}
                onClick={() => void runPrompt(preset.prompt)}
                title={
                  linkedNode
                    ? `Crear "${preset.label}" conectado a ${linkedNode.title}`
                    : "Elige primero un archivo o nodo para vincular"
                }
                className={quickButtonClass}
              >
                <Icon className="w-3.5 h-3.5 text-andros-accent" />
                {preset.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] font-mono text-andros-muted">
          {linkedNode
            ? `Los bloques de texto se conectarán a "${linkedNode.title}".`
            : "Sin vínculo: menciona el archivo por su nombre y el Oráculo lo detectará."}
        </p>
      </div>

      {/* Respuesta Sintetizada */}
      <div className="p-3.5 rounded-xl bg-andros-canvas border border-andros-border space-y-2.5">
        <div className="flex items-center justify-between text-[10px] font-mono text-andros-muted">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-andros-accent" />
            {lastEngine ? ENGINE_LABELS[lastEngine] : "MOTOR DE SÍNTESIS TÉCNICA"}
          </span>
          <span className={isThinking ? "text-andros-accent" : "text-andros-success"}>
            {isThinking ? "● ANALIZANDO EL LIENZO…" : "● LISTO"}
          </span>
        </div>
        <div className="max-h-48 overflow-y-auto pr-1">
          <p className="text-xs leading-relaxed text-andros-primary flex items-start gap-2 whitespace-pre-line">
            {isThinking && <Loader2 className="w-3.5 h-3.5 mt-0.5 shrink-0 animate-spin" />}
            <span>{lastSynthesis}</span>
          </p>
        </div>
        {actionLog.length > 0 && (
          <ul className="pt-2 border-t border-andros-border space-y-1">
            {actionLog.map((entry, index) => (
              <li
                key={`${index}-${entry}`}
                className="flex items-start gap-1.5 text-[11px] text-andros-muted"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0 text-andros-success" />
                <span>{entry}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Input de Comando */}
      <form onSubmit={handleSynthesize} className="flex items-end gap-2">
        <textarea
          value={prompt}
          rows={2}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter hace salto de línea.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void runPrompt(prompt.trim());
            }
          }}
          placeholder={
            linkedNode
              ? `Ej: redacta qué falta para imprimir "${linkedNode.title}"…`
              : "Ej: ordena el lienzo, analiza qué piezas faltan, conecta A con B…"
          }
          disabled={isThinking}
          className="flex-1 resize-none bg-andros-canvas border border-andros-border focus:border-andros-accent rounded-xl px-3.5 py-2.5 text-xs text-andros-primary placeholder:text-andros-muted outline-none spring-micro disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isThinking || !prompt.trim()}
          className="px-4 py-2.5 rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 active:scale-95 spring-micro disabled:opacity-50"
        >
          {isThinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          <span>Ejecutar</span>
        </button>
      </form>
    </div>
  );

  if (embeddedInSheet) return content;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/45 backdrop-blur-sm"
      onClick={() => setOracleModalOpen(false)}
    >
      <div
        className="w-full max-w-lg max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 spring-micro"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
};
