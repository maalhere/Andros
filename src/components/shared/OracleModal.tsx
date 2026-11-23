"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  FilePlus2,
  FileText,
  LayoutGrid,
  Library,
  Link2,
  ListTodo,
  Loader2,
  MessageSquare,
  Network,
  PencilLine,
  Plus,
  Quote,
  RotateCcw,
  Send,
  Sigma,
  Sparkles,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import { NODE_ARCHETYPE_LABELS, useWorkspaceStore } from "@/store/useWorkspaceStore";
import {
  STUDIO_LINK_AUTO,
  STUDIO_LINK_NONE,
  useOracleStudioStore,
  type StudioMessage,
} from "@/store/useOracleStudioStore";
import { buildOracleCanvasContext } from "@/lib/oracle/buildCanvasContext";
import { OracleClientError, queryOracle } from "@/lib/oracle/oracleClient";
import { localReflex } from "@/lib/oracle/localInterpreter";
import { getUserAiKey } from "@/store/useAiProvidersStore";
import { checkFreeQuota, recordFreeQuery } from "@/store/useAiQuotaStore";
import { countWords, markdownToNoteText } from "@/lib/oracle/markdownDocument";
import { MarkdownPreview } from "@/components/oracle/MarkdownPreview";
import { useLibraryStore } from "@/store/useLibraryStore";
import { referencesMarkdown, toOracleReference } from "@/lib/library/actions";
import { Kbd } from "./Kbd";
import type {
  OracleAction,
  OracleEngine,
  OracleHistoryTurn,
  OracleMode,
} from "@/types/oracle";

// ============================================================================
// ANDROS — ESTUDIO DEL ORÁCULO IA (pantalla completa, estilo "lienzo de Gemini")
//
//   · Izquierda (≈40 %): conversación con el Oráculo, sugerencias y entrada.
//   · Derecha  (≈60 %): documento vivo y editable (título, Editar | Vista
//     previa con tablas y LaTeX, palabras, copiar, deshacer cambio de la IA).
//   · "Añadir al lienzo" convierte el documento en un bloque de texto en el
//     centro de la vista. Cerrar conserva el borrador en memoria.
//   · Móvil (< 768px): un panel a la vez con el selector Chat | Documento.
//   · Modo "Lienzo": el Oráculo de siempre, que actúa directo sobre el lienzo.
// ============================================================================

const ENGINE_LABELS: Record<OracleEngine, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  local: "Modo local",
};

const DOCUMENT_PROMPTS = [
  {
    id: "datasheet",
    label: "Ficha técnica",
    icon: FileText,
    prompt:
      "Redacta una ficha técnica del archivo de referencia con sus datos reales (formato, peso, dimensiones) en una tabla, proceso de fabricación recomendado y controles de calidad.",
  },
  {
    id: "test-plan",
    label: "Plan de pruebas",
    icon: ClipboardCheck,
    prompt:
      "Escribe un plan de pruebas técnico con pruebas numeradas, una tabla de criterios de aceptación con valores concretos y un checklist final.",
  },
  {
    id: "calc",
    label: "Memoria de cálculo",
    icon: Sigma,
    prompt:
      "Escribe una memoria de cálculo con las ecuaciones en LaTeX, una tabla de variables con unidades y la conclusión numérica.",
  },
  {
    id: "print",
    label: "Qué falta para imprimir",
    icon: ListTodo,
    prompt:
      "Resume qué falta para poder imprimir la pieza como checklist de tareas pendientes, con una tabla de parámetros de impresión concretos.",
  },
  {
    id: "summary",
    label: "Resumen del lienzo",
    icon: LayoutGrid,
    prompt: "Resume todo el lienzo en un informe: objetivo, piezas y archivos, relaciones entre nodos y próximos pasos.",
  },
  {
    id: "polish",
    label: "Mejorar redacción",
    icon: Wand2,
    prompt: "Mejora la redacción y la estructura del documento actual sin perder ningún dato técnico.",
  },
] as const;

const CANVAS_PROMPTS = [
  {
    id: "test-plan",
    label: "Bloque: plan de pruebas",
    icon: ClipboardCheck,
    prompt:
      "Crea un plan de pruebas técnico para este archivo, con pruebas numeradas, valores de aceptación concretos y checklist final.",
  },
  {
    id: "print-readiness",
    label: "Bloque: qué falta para imprimir",
    icon: ListTodo,
    prompt:
      "Resume qué falta para poder imprimir esta pieza como checklist de tareas pendientes, con parámetros de impresión concretos.",
  },
] as const;

/** Margen para centrar el bloque (ancho real de un nodo ≈ 320 px). */
const NODE_HALF_WIDTH = 160;
const NODE_HALF_HEIGHT = 140;

interface Toast {
  message: string;
  canJump: boolean;
}

export const OracleModal: React.FC = () => {
  const isOpen = useWorkspaceStore((s) => s.isOracleModalOpen);
  if (!isOpen) return null;
  return <OracleStudio />;
};

const OracleStudio: React.FC = () => {
  const setOracleModalOpen = useWorkspaceStore((s) => s.setOracleModalOpen);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const connections = useWorkspaceStore((s) => s.connections);
  const selectedNodeId = useWorkspaceStore((s) => s.selectedNodeId);

  const studio = useOracleStudioStore();
  const { messages, document: doc, chatMode, editorView, mobilePane, linkChoice, isThinking, references, streamingText } = studio;

  const [prompt, setPrompt] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [copied, setCopied] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const explicitLinkId =
    linkChoice !== STUDIO_LINK_AUTO && linkChoice !== STUDIO_LINK_NONE && nodes.some((n) => n.id === linkChoice)
      ? linkChoice
      : null;
  /** Nodo de referencia: el elegido, o el seleccionado en modo automático. */
  const linkedNodeId =
    linkChoice === STUDIO_LINK_AUTO ? (selectedNodeId ?? null) : linkChoice === STUDIO_LINK_NONE ? null : explicitLinkId;
  const linkedNode = nodes.find((n) => n.id === linkedNodeId);

  const linkOptions = useMemo(
    () =>
      [...nodes].sort(
        (a, b) =>
          Number(b.type === "file-node") - Number(a.type === "file-node") || a.title.localeCompare(b.title)
      ),
    [nodes]
  );

  const words = useMemo(() => countWords(doc.markdown), [doc.markdown]);

  // Desplaza el chat al último mensaje.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isThinking, streamingText.length]);

  // Foco en la entrada al abrir (escritorio).
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const close = () => setOracleModalOpen(false);

  // --------------------------------------------------------------------------
  // Modo lienzo: acciones en vivo (igual que el Oráculo clásico)
  // --------------------------------------------------------------------------
  const titleOf = (id: string) => useWorkspaceStore.getState().nodes.find((n) => n.id === id)?.title ?? "nodo";
  const describeLayout = (r: { zone1: number; zone2: number; zone3: number }) =>
    `Lienzo ordenado: ${r.zone1} archivo(s) en Zona 1, ${r.zone2} texto(s) en Zona 2, ${r.zone3} fuente(s)/cálculo(s) en Zona 3`;

  const applyActions = (actions: OracleAction[]): string[] => {
    const ws = useWorkspaceStore.getState();
    const log: string[] = [];
    for (const action of actions) {
      switch (action.type) {
        case "create_text_block":
          ws.aiCreateTextBlock({
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
        case "connect_nodes":
          ws.aiConnectNodes(action.fromNodeId, action.toNodeId, action.label);
          log.push(
            `Cable "${titleOf(action.fromNodeId)}" → "${titleOf(action.toNodeId)}"${action.label ? ` (${action.label})` : ""}`
          );
          break;
        case "update_node_note":
          if (ws.aiUpdateNodeNote(action.nodeId, action.content, action.mode)) {
            log.push(`${action.mode === "replace" ? "Texto reemplazado" : "Texto añadido"} en "${titleOf(action.nodeId)}"`);
          }
          break;
        case "apply_human_layout":
          log.push(describeLayout(ws.aiApplyHumanLayout(action.assignments)));
          break;
        case "auto_layout":
          log.push(describeLayout(ws.aiApplyHumanLayout()));
          break;
        case "create_node": {
          const id = ws.aiCreateNode({ type: action.nodeType, title: action.title, summary: action.summary });
          log.push(`Nodo "${titleOf(id)}" creado`);
          break;
        }
        case "annotate_selected":
          ws.aiAnnotateSelected();
          log.push("Guía de impresión 3D creada junto al nodo seleccionado");
          break;
      }
    }
    return log;
  };

  // --------------------------------------------------------------------------
  // Envío al Oráculo
  // --------------------------------------------------------------------------
  const runPrompt = async (text: string, mode: OracleMode = chatMode) => {
    const clean = text.trim();
    if (!clean || useOracleStudioStore.getState().isThinking) return;
    const st = useOracleStudioStore.getState();
    const history: OracleHistoryTurn[] = st.messages
      .filter((m) => !m.issue)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    setPrompt("");
    st.addMessage({ role: "user", text: clean, mode });
    const ws = useWorkspaceStore.getState();
    const context = buildOracleCanvasContext(ws.nodes, ws.connections, ws.selectedNodeId, linkedNodeId);

    // Reflejo local: órdenes simples («ordena el lienzo») se ejecutan al instante, sin gastar IA.
    if (mode === "canvas") {
      const reflex = localReflex(clean, context);
      if (reflex) {
        const log = applyActions(reflex.actions);
        useOracleStudioStore.getState().addMessage({
          role: "oracle",
          text: reflex.reply,
          mode,
          engine: "local",
          log: log.length > 0 ? log : undefined,
        });
        return;
      }
    }

    // Límite diario gratis (15/día con la clave del servidor; sin tope con clave propia).
    const quota = checkFreeQuota();
    if (!quota.ok) {
      useOracleStudioStore.getState().addMessage({
        role: "oracle",
        text: quota.message,
        mode,
        engine: "local",
        issue: "daily_limit",
      });
      return;
    }

    st.setThinking(true);
    st.setStreamingText("");
    try {
      const data = await queryOracle(
        {
          prompt: clean,
          mode,
          context,
          history,
          references: useOracleStudioStore.getState().references.map(toOracleReference),
          ...(getUserAiKey("gemini") ? { apiKey: getUserAiKey("gemini") } : {}),
          ...(mode === "document" ? { document: useOracleStudioStore.getState().document } : {}),
        },
        {
          onDelta: (text) => useOracleStudioStore.getState().appendStreamingText(text),
          onReset: () => useOracleStudioStore.getState().setStreamingText(""),
        }
      );
      if (data.engine === "gemini" && !data.issue) recordFreeQuery();
      const studioNow = useOracleStudioStore.getState();

      if (mode === "document" && data.document) {
        studioNow.applyAiDocument(data.document);
        studioNow.setMobilePane("document");
      }
      const log = mode === "canvas" ? applyActions(data.actions ?? []) : undefined;
      studioNow.addMessage({
        role: "oracle",
        text: data.reply || "Listo.",
        mode,
        engine: data.engine,
        model: data.model,
        issue: data.issue?.code,
        log: log && log.length > 0 ? log : undefined,
        updatedDocument: mode === "document" && Boolean(data.document),
      });
    } catch (error) {
      useOracleStudioStore.getState().addMessage({
        role: "oracle",
        text:
          error instanceof OracleClientError
            ? error.message
            : "No pude contactar al Oráculo. Revisa tu conexión e inténtalo de nuevo.",
        mode,
        issue: error instanceof OracleClientError ? error.code : "unavailable",
      });
    } finally {
      const done = useOracleStudioStore.getState();
      done.setStreamingText("");
      done.setThinking(false);
    }
  };

  // Acciones rápidas locales del modo lienzo (sin IA).
  const quickLayout = () => {
    const result = useWorkspaceStore.getState().aiApplyHumanLayout();
    studio.addMessage({
      role: "oracle",
      mode: "canvas",
      engine: "local",
      text: "Ordené el lienzo por flujo de trabajo: Zona 1 archivos fuente, Zona 2 textos y análisis, Zona 3 fuentes, enlaces y cálculos.",
      log: [describeLayout(result)],
    });
  };
  const quickPrintGuide = () => {
    if (!selectedNode) {
      studio.addMessage({
        role: "oracle",
        mode: "canvas",
        engine: "local",
        text: "Selecciona primero un nodo en el lienzo (idealmente un .stl, .obj o .3mf) para generar su guía de impresión.",
      });
      return;
    }
    useWorkspaceStore.getState().aiAnnotateSelected();
    studio.addMessage({
      role: "oracle",
      mode: "canvas",
      engine: "local",
      text: `Generé una guía técnica de impresión 3D junto a "${selectedNode.title}".`,
    });
  };
  const quickConnectLoose = () => {
    const connected = new Set(connections.flatMap((c) => [c.fromNodeId, c.toNodeId]));
    const loose = nodes.filter((n) => !connected.has(n.id));
    if (loose.length < 2) {
      studio.addMessage({ role: "oracle", mode: "canvas", engine: "local", text: "No encontré nodos sueltos por conectar." });
      return;
    }
    let pairs = 0;
    for (let i = 0; i + 1 < loose.length; i += 2) {
      useWorkspaceStore.getState().aiConnectNodes(loose[i].id, loose[i + 1].id, "Conexión sugerida");
      pairs += 1;
    }
    studio.addMessage({
      role: "oracle",
      mode: "canvas",
      engine: "local",
      text: `Conecté ${pairs} par(es) de nodos sueltos del lienzo.`,
    });
  };

  // --------------------------------------------------------------------------
  // Documento → lienzo
  // --------------------------------------------------------------------------
  const addToCanvas = () => {
    const markdown = doc.markdown.trim();
    if (!markdown) {
      setToast({ message: "El documento está vacío: pide un borrador al Oráculo o escribe en «Editar».", canJump: false });
      return;
    }
    const ws = useWorkspaceStore.getState();
    const t = ws.canvasTransform;
    const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const position = {
      x: (center.x - t.x) / t.scale - NODE_HALF_WIDTH,
      y: (center.y - t.y) / t.scale - NODE_HALF_HEIGHT,
    };
    const title = doc.title.trim() || "Documento del Oráculo";
    ws.aiCreateTextBlock({
      title,
      content: markdownToNoteText(markdown),
      codeTag: "AI-DOC",
      position,
      ...(explicitLinkId ? { linkedNodeId: explicitLinkId, connectionLabel: "Documento" } : {}),
    });
    setToast({
      message: explicitLinkId
        ? `«${title}» se añadió al centro del lienzo, conectado a «${titleOf(explicitLinkId)}».`
        : `«${title}» se añadió al centro del lienzo.`,
      canJump: true,
    });
  };

  /** Añade (o actualiza) la sección "## Referencias" al final del documento. */
  const insertReferences = () => {
    const refs = useOracleStudioStore.getState().references;
    if (refs.length === 0) return;
    const block = referencesMarkdown(refs);
    const current = doc.markdown.replace(/\n*## Referencias[\s\S]*$/u, "").trimEnd();
    studio.setMarkdown(current ? `${current}\n\n${block}\n` : `${block}\n`);
    studio.setMobilePane("document");
    setToast({ message: `Sección «Referencias» con ${refs.length} fuente(s) en formato IEEE añadida al documento.`, canJump: false });
  };

  const copyDocument = async () => {
    try {
      await navigator.clipboard.writeText(doc.title.trim() ? `# ${doc.title.trim()}\n\n${doc.markdown}` : doc.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setToast({ message: "No se pudo copiar al portapapeles.", canJump: false });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runPrompt(prompt);
  };

  const segBtn = (active: boolean) =>
    `flex items-center gap-1.5 h-9 md:h-7 px-2.5 rounded-lg text-[11px] font-medium active:scale-[0.96] spring-micro ${
      active ? "bg-andros-card text-andros-primary shadow-sm border border-andros-border" : "text-andros-muted hover:text-andros-primary border border-transparent"
    }`;
  const chipClass =
    "px-2.5 py-1.5 rounded-lg bg-andros-canvas border border-andros-border hover:border-andros-accent/50 text-[11px] font-medium text-andros-primary flex items-center gap-1.5 max-md:min-h-[40px] spring-micro active:scale-[0.96] disabled:opacity-50 disabled:pointer-events-none";

  // ==========================================================================
  // Panel izquierdo — Chat
  // ==========================================================================
  const chatPane = (
    <section
      className={`${mobilePane === "chat" ? "flex" : "hidden"} md:flex flex-col min-h-0 min-w-0 w-full md:w-[40%] md:border-r border-andros-border bg-andros-card`}
      aria-label="Conversación con el Oráculo"
    >
      {/* Cabecera del chat */}
      <div className="hidden md:flex items-center justify-between gap-3 px-5 h-14 border-b border-andros-border shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-andros-accent/15 text-andros-accent-ink">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-andros-primary leading-tight">Oráculo IA</h2>
            <p className="text-[10px] font-mono tabular-nums text-andros-muted truncate">
              {`${nodes.length} nodos · ${connections.length} cables en contexto`}
            </p>
          </div>
        </div>
        <ModeToggle mode={chatMode} onChange={studio.setChatMode} segBtn={segBtn} />
      </div>

      {/* Referencia + modo (móvil) */}
      <div className="px-4 md:px-5 py-2.5 border-b border-andros-border flex items-center gap-2 shrink-0">
        <div className="md:hidden">
          <ModeToggle mode={chatMode} onChange={studio.setChatMode} segBtn={segBtn} compact />
        </div>
        <label className="flex items-center gap-2 min-w-0 flex-1 text-[11px] text-andros-muted">
          <Link2 className="w-3.5 h-3.5 text-andros-accent-ink shrink-0" />
          <span className="hidden sm:inline shrink-0">Referencia</span>
          <select
            value={linkChoice}
            onChange={(e) => studio.setLinkChoice(e.target.value)}
            disabled={isThinking}
            className="min-w-0 flex-1 bg-andros-canvas border border-andros-border focus:border-andros-accent rounded-lg px-2 py-1.5 text-[11px] text-andros-primary outline-none spring-micro"
          >
            <option value={STUDIO_LINK_AUTO}>
              {selectedNode ? `Seleccionado: ${selectedNode.title}` : "Automático (nodo seleccionado)"}
            </option>
            <option value={STUDIO_LINK_NONE}>Sin referencia (todo el lienzo)</option>
            {linkOptions.map((node) => (
              <option key={node.id} value={node.id}>
                {`${NODE_ARCHETYPE_LABELS[node.type]} · ${node.title}${
                  node.type === "file-node" && node.fileData.extension ? ` (.${node.fileData.extension})` : ""
                }`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Fuentes citables adjuntas desde la Biblioteca */}
      <div className="px-4 md:px-5 py-2 border-b border-andros-border flex items-center gap-1.5 shrink-0 overflow-x-auto no-scrollbar">
        <span className="flex items-center gap-1 text-[11px] text-andros-muted shrink-0">
          <Quote className="w-3.5 h-3.5 text-andros-accent-ink" />
          Fuentes
        </span>
        {references.length === 0 && (
          <span className="text-[10px] text-andros-muted/80 shrink-0">ninguna adjunta</span>
        )}
        {references.map((r, i) => (
          <span
            key={r.id}
            title={r.title}
            className="shrink-0 max-w-[180px] flex items-center gap-1 pl-2 pr-1 h-6 rounded-md bg-andros-canvas border border-andros-border text-[10px] text-andros-primary"
          >
            <span className="font-mono text-andros-accent-ink">[{i + 1}]</span>
            <span className="truncate">{r.title}</span>
            <button
              type="button"
              onClick={() => studio.removeReference(r.id)}
              aria-label={`Quitar fuente ${i + 1}`}
              className="p-0.5 rounded text-andros-muted hover:text-andros-primary"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => useLibraryStore.getState().openLibrary({ origin: "oracle" })}
          className="shrink-0 h-6 px-2 rounded-md border border-dashed border-andros-border-active text-[10px] font-medium text-andros-primary hover:border-andros-accent flex items-center gap-1 spring-micro"
        >
          <Library className="w-3 h-3 text-andros-accent-ink" />
          Biblioteca
        </button>
        {references.length > 0 && (
          <button
            type="button"
            onClick={insertReferences}
            title="Añadir la sección Referencias (IEEE) al final del documento"
            className="shrink-0 h-6 px-2 rounded-md text-[10px] font-medium text-andros-muted hover:text-andros-primary flex items-center gap-1 spring-micro"
          >
            <Plus className="w-3 h-3" />
            Insertar referencias
          </button>
        )}
      </div>

      {/* Conversación */}
      <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-5 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="py-4">
            <p className="text-sm font-semibold text-andros-primary">
              {chatMode === "document" ? "¿Qué documento escribimos?" : "¿Qué hacemos en el lienzo?"}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-andros-muted">
              {chatMode === "document"
                ? "El Oráculo redacta en el panel del documento con títulos, tablas y ecuaciones LaTeX. Edítalo a tu gusto y, cuando esté listo, pulsa «Añadir al lienzo»."
                : "El Oráculo lee todo el lienzo y actúa en vivo: crea bloques conectados a tus archivos, conecta nodos y ordena el espacio de trabajo."}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
        {isThinking && streamingText && (
          <div className="flex flex-col items-start gap-1">
            <p className="max-w-[92%] px-3.5 py-2.5 rounded-2xl rounded-bl-md border border-andros-border bg-andros-canvas text-[13px] leading-relaxed whitespace-pre-wrap break-words text-andros-primary">
              {streamingText}
            </p>
          </div>
        )}
        {isThinking && (
          <div className="flex items-center gap-2 text-xs text-andros-muted" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-andros-accent-ink" />
            <span>
              {chatMode === "document"
                ? streamingText
                  ? "Terminando el documento…"
                  : "Redactando el documento…"
                : streamingText
                  ? "Aplicando cambios al lienzo…"
                  : "Analizando el lienzo…"}
            </span>
          </div>
        )}
      </div>

      {/* Sugerencias */}
      <div className="px-4 md:px-5 pt-2.5 flex flex-wrap gap-1.5 shrink-0">
        {chatMode === "document" && references.length > 0 && (
          <button
            type="button"
            disabled={isThinking}
            onClick={() =>
              void runPrompt(
                "Redacta un resumen técnico del estado del arte usando las fuentes adjuntas: explica qué aporta cada una, compáralas en una tabla y cítalas en el texto como [n]. Termina con la sección Referencias en formato IEEE."
              )
            }
            className={chipClass}
          >
            <Quote className="w-3.5 h-3.5 text-andros-accent-ink" />
            Estado del arte con mis fuentes
          </button>
        )}
        {chatMode === "document" ? (
          DOCUMENT_PROMPTS.filter((p) => p.id !== "polish" || doc.markdown.trim()).map((p) => {
            const Icon = p.icon;
            return (
              <button key={p.id} type="button" disabled={isThinking} onClick={() => void runPrompt(p.prompt)} className={chipClass}>
                <Icon className="w-3.5 h-3.5 text-andros-accent-ink" />
                {p.label}
              </button>
            );
          })
        ) : (
          <>
            <button type="button" onClick={quickLayout} disabled={isThinking} className={chipClass}>
              <LayoutGrid className="w-3.5 h-3.5 text-andros-accent-ink" />
              Ordenar lienzo
            </button>
            <button type="button" onClick={quickPrintGuide} disabled={isThinking} className={chipClass}>
              <Boxes className="w-3.5 h-3.5 text-andros-accent-ink" />
              Guía de impresión
            </button>
            <button type="button" onClick={quickConnectLoose} disabled={isThinking} className={chipClass}>
              <Network className="w-3.5 h-3.5 text-andros-accent-ink" />
              Conectar sueltos
            </button>
            {CANVAS_PROMPTS.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={isThinking || !linkedNode}
                  title={linkedNode ? `Conectado a ${linkedNode.title}` : "Elige primero una referencia"}
                  onClick={() => void runPrompt(p.prompt)}
                  className={chipClass}
                >
                  <Icon className="w-3.5 h-3.5 text-andros-accent-ink" />
                  {p.label}
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* Entrada */}
      <form onSubmit={handleSubmit} className="p-4 md:p-5 pt-3 shrink-0">
        <div className="flex items-end gap-2 p-1.5 pl-3.5 rounded-2xl bg-andros-canvas border border-andros-border focus-within:border-andros-accent spring-micro">
          <textarea
            ref={inputRef}
            value={prompt}
            rows={2}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void runPrompt(prompt);
              }
            }}
            placeholder={
              chatMode === "document"
                ? doc.markdown.trim()
                  ? "Pide un cambio: «añade una tabla de tolerancias», «hazlo más breve»…"
                  : "Describe el documento que necesitas…"
                : linkedNode
                  ? `Ej: redacta qué falta para imprimir "${linkedNode.title}"…`
                  : "Ej: ordena el lienzo, conecta A con B…"
            }
            disabled={isThinking}
            className="flex-1 min-w-0 resize-none bg-transparent py-2 text-[13px] leading-relaxed text-andros-primary placeholder:text-andros-muted outline-none max-h-40 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isThinking || !prompt.trim()}
            aria-label="Enviar"
            className="h-9 w-9 shrink-0 rounded-xl bg-andros-primary text-andros-canvas flex items-center justify-center hover:opacity-90 active:scale-95 spring-micro disabled:opacity-40"
          >
            {isThinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-andros-muted">
          <span className="hidden md:flex items-center gap-1">
            <Kbd>Enter</Kbd> envía · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> salto de línea
          </span>
          {messages.length > 0 && (
            <button type="button" onClick={studio.clearConversation} className="ml-auto min-h-[32px] px-1 hover:text-andros-primary">
              Limpiar chat
            </button>
          )}
        </div>
      </form>
    </section>
  );

  // ==========================================================================
  // Panel derecho — Documento vivo
  // ==========================================================================
  const docPane = (
    <section
      className={`${mobilePane === "document" ? "flex" : "hidden"} md:flex flex-col min-h-0 min-w-0 w-full md:w-[60%] bg-andros-canvas relative`}
      aria-label="Documento"
    >
      {/* Barra de acciones */}
      <div className="flex items-center gap-2 px-4 md:px-6 h-14 border-b border-andros-border shrink-0">
        <input
          value={doc.title}
          onChange={(e) => studio.setTitle(e.target.value)}
          placeholder="Título del documento"
          aria-label="Título del documento"
          className="flex-1 min-w-0 bg-transparent text-[15px] font-semibold text-andros-primary placeholder:text-andros-muted outline-none rounded-md px-1 -mx-1 focus:bg-andros-card"
        />
        <button
          type="button"
          onClick={addToCanvas}
          disabled={!doc.markdown.trim()}
          className="h-9 px-3.5 rounded-xl bg-andros-accent-fill text-white text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 active:scale-95 spring-micro disabled:opacity-40 shrink-0"
          title="Convertir el documento en un bloque de texto en el centro del lienzo"
        >
          <Plus className="w-4 h-4" />
          <span>Añadir al lienzo</span>
        </button>
        <button
          type="button"
          onClick={close}
          className="hidden md:flex h-9 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary items-center gap-1.5 hover:border-andros-border-active hover:bg-andros-card spring-micro shrink-0"
          title="Cerrar el Estudio (el borrador se conserva)"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Volver al lienzo</span>
        </button>
      </div>

      {/* Herramientas */}
      <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-andros-border shrink-0">
        <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-andros-border/40">
          <button type="button" className={segBtn(editorView === "edit")} onClick={() => studio.setEditorView("edit")}>
            <PencilLine className="w-3.5 h-3.5" />
            Editar
          </button>
          <button type="button" className={segBtn(editorView === "preview")} onClick={() => studio.setEditorView("preview")}>
            <Eye className="w-3.5 h-3.5" />
            Vista previa
          </button>
        </div>
        <div className="flex-1" />
        {studio.previousDocument && (
          <button
            type="button"
            onClick={studio.undoAiDocument}
            className="h-7 px-2 rounded-lg text-[11px] text-andros-muted hover:text-andros-primary hover:bg-andros-card flex items-center gap-1.5 spring-micro"
            title="Volver a la versión anterior a la última edición de la IA"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Deshacer IA</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => void copyDocument()}
          disabled={!doc.markdown.trim()}
          className="h-7 px-2 rounded-lg text-[11px] text-andros-muted hover:text-andros-primary hover:bg-andros-card flex items-center gap-1.5 spring-micro disabled:opacity-40"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-andros-success" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{copied ? "Copiado" : "Copiar"}</span>
        </button>
        <button
          type="button"
          onClick={studio.newDocument}
          disabled={!doc.markdown.trim()}
          className="h-7 px-2 rounded-lg text-[11px] text-andros-muted hover:text-andros-primary hover:bg-andros-card flex items-center gap-1.5 spring-micro disabled:opacity-40"
          title="Empezar un documento nuevo"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Nuevo</span>
        </button>
      </div>

      {/* Contenido */}
      <div className="flex-1 min-h-0 relative">
        {editorView === "edit" ? (
          <textarea
            value={doc.markdown}
            onChange={(e) => studio.setMarkdown(e.target.value)}
            spellCheck
            placeholder={"# Título\n\nEscribe en Markdown: **negritas**, listas, tablas | A | B |, y ecuaciones $E = mc^2$.\n\nO pide un borrador al Oráculo en el chat."}
            className="absolute inset-0 w-full h-full resize-none bg-transparent px-5 md:px-10 py-6 font-mono text-[13px] leading-6 text-andros-primary placeholder:text-andros-muted outline-none"
          />
        ) : (
          <div className="absolute inset-0 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-5 md:px-10 py-6 md:py-8">
              {doc.markdown.trim() ? (
                <MarkdownPreview markdown={doc.markdown} />
              ) : (
                <div className="mt-16 text-center">
                  <FileText className="w-8 h-8 mx-auto text-andros-muted" />
                  <p className="mt-3 text-sm font-medium text-andros-primary">El documento aparecerá aquí</p>
                  <p className="mt-1 text-xs text-andros-muted">
                    Pide un borrador al Oráculo o escríbelo tú en «Editar».
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        {isThinking && chatMode === "document" && (
          <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-andros-accent/15">
            <div className="h-full w-1/3 bg-andros-accent-fill animate-[andros-progress_1.2s_ease-in-out_infinite]" />
          </div>
        )}
      </div>

      {/* Pie */}
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 h-9 border-t border-andros-border text-[10px] font-mono text-andros-muted shrink-0">
        <span className="tabular-nums">
          {words} {words === 1 ? "palabra" : "palabras"} · {doc.markdown.length} caracteres
        </span>
        <span className="truncate">Markdown + LaTeX · borrador sin guardar</span>
      </div>
    </section>
  );

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <style>{`@keyframes andros-progress{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Estudio del Oráculo IA"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full h-full md:w-[96vw] md:h-[94vh] md:rounded-2xl overflow-hidden flex flex-col bg-andros-card md:border border-andros-border shadow-hud-light dark:shadow-hud-dark"
      >
        {/* Barra móvil: Chat | Documento */}
        <div className="md:hidden flex items-center gap-2 px-3 h-14 border-b border-andros-border shrink-0">
          <button
            type="button"
            onClick={close}
            aria-label="Volver al lienzo"
            className="h-9 w-9 rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-andros-border/40">
              <button type="button" className={segBtn(mobilePane === "chat")} onClick={() => studio.setMobilePane("chat")}>
                <MessageSquare className="w-3.5 h-3.5" />
                Chat
              </button>
              <button type="button" className={segBtn(mobilePane === "document")} onClick={() => studio.setMobilePane("document")}>
                <FileText className="w-3.5 h-3.5" />
                Documento
              </button>
            </div>
          </div>
          {/* Espaciador simétrico al botón de cerrar */}
          <div className="w-9" aria-hidden="true" />
        </div>

        <div className="flex-1 min-h-0 flex">
          {chatPane}
          {docPane}
        </div>

        {/* Confirmación */}
        {toast && (
          <div
            role="status"
            className="absolute left-1/2 -translate-x-1/2 bottom-5 z-10 w-[min(92%,30rem)] flex items-center gap-3 px-4 py-3 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark"
          >
            {toast.canJump ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-andros-success" />
            ) : (
              <TriangleAlert className="w-4 h-4 shrink-0 text-andros-accent-ink" />
            )}
            <p className="flex-1 min-w-0 text-xs leading-snug text-andros-primary">{toast.message}</p>
            {toast.canJump && (
              <button
                type="button"
                onClick={close}
                className="shrink-0 h-8 px-3 rounded-lg bg-andros-primary text-andros-canvas text-[11px] font-semibold hover:opacity-90 spring-micro"
              >
                Ir al lienzo
              </button>
            )}
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Seguir editando"
              title="Seguir editando"
              className="shrink-0 p-1 rounded-md text-andros-muted hover:text-andros-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Piezas
// ----------------------------------------------------------------------------

const ModeToggle: React.FC<{
  mode: OracleMode;
  onChange: (mode: OracleMode) => void;
  segBtn: (active: boolean) => string;
  compact?: boolean;
}> = ({ mode, onChange, segBtn, compact }) => (
  <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-andros-border/40 shrink-0" role="tablist" aria-label="Modo del Oráculo">
    <button
      type="button"
      role="tab"
      aria-selected={mode === "document"}
      className={segBtn(mode === "document")}
      onClick={() => onChange("document")}
      title="El Oráculo escribe en el documento del Estudio"
    >
      <FileText className="w-3.5 h-3.5" />
      {!compact && "Documento"}
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === "canvas"}
      className={segBtn(mode === "canvas")}
      onClick={() => onChange("canvas")}
      title="El Oráculo actúa directamente sobre el lienzo"
    >
      <LayoutGrid className="w-3.5 h-3.5" />
      {!compact && "Lienzo"}
    </button>
  </div>
);

const ChatBubble: React.FC<{ message: StudioMessage }> = ({ message: m }) => {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-md bg-andros-primary text-andros-canvas text-[13px] leading-relaxed whitespace-pre-wrap break-words">
          {m.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <div
        className={`max-w-[92%] px-3.5 py-2.5 rounded-2xl rounded-bl-md border text-[13px] leading-relaxed whitespace-pre-wrap break-words text-andros-primary ${
          m.issue ? "bg-andros-accent/10 border-andros-accent/40" : "bg-andros-canvas border-andros-border"
        }`}
      >
        {m.issue && <TriangleAlert className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5 text-andros-accent-ink" />}
        {m.text}
        {m.log && (
          <ul className="mt-2 pt-2 border-t border-andros-border space-y-1">
            {m.log.map((entry, i) => (
              <li key={`${i}-${entry}`} className="flex items-start gap-1.5 text-[11px] text-andros-muted">
                <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0 text-andros-success" />
                <span>{entry}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="pl-1 text-[10px] font-mono text-andros-muted">
        {m.engine ? (m.model ? `${ENGINE_LABELS[m.engine]} · ${m.model}` : ENGINE_LABELS[m.engine]) : "Oráculo"}
        {m.updatedDocument ? " · documento actualizado" : ""}
      </span>
    </div>
  );
};
