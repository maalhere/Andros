"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bot,
  CalendarDays,
  ClipboardList,
  ClipboardPaste,
  Copy,
  Scissors,
  MessageSquare,
  Cable,
  Code2,
  Gauge,
  Headphones,
  Share2,
  StickyNote,
  Users,
  Crown,
  FileBox,
  FileText,
  CircleHelp,
  KeyRound,
  Library,
  Link2,
  Maximize,
  Moon,
  MousePointer2,
  NotebookPen,
  PenLine,
  Plus,
  Search,
  Settings,
  Sigma,
  Sparkles,
  SquareFunction,
  Sun,
  Swords,
  Terminal,
} from "lucide-react";
import { useFormulaCreatorStore } from "@/store/useFormulaCreatorStore";
import { useCommandPaletteStore } from "@/store/useCommandPaletteStore";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { NODE_ARCHETYPE_LABELS, useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useMarketStore } from "@/store/useMarketStore";
import { chooseExperienceMode } from "@/lib/billing/entitlements";
import { useIsExpert, useSettingsStore } from "@/store/useSettingsStore";
import { useCanvasReadOnly, useCollabStore } from "@/store/useCollabStore";
import { useSocialStore } from "@/store/useSocialStore";
import { useCommentsStore } from "@/store/useCommentsStore";
import { useCalendarStore } from "@/store/useCalendarStore";
import { joinCollabRoom } from "@/lib/collab/useCollabRoom";
import { quickAdd } from "@/lib/canvas/quickAdd";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { useShortcutsGuideStore } from "@/store/useShortcutsGuideStore";
import { usePlanExportStore } from "@/store/usePlanExportStore";
import { useFormsLibraryStore } from "@/store/useFormsLibraryStore";
import { SHORTCUT_KEYS } from "@/hooks/useGlobalShortcuts";
import { Kbd, useModKey } from "./Kbd";
import { copyCards, cutCards, pasteClipboard } from "@/lib/canvas/clipboardActions";
import { springOrInstant } from "@/lib/motion";
import type { NodeArchetype } from "@/types/workspace";

// ============================================================================
// ANDROS — PALETA DE COMANDOS (⌘K / Ctrl+K)
// Buscar y saltar a nodos, abrir Oráculo, Biblioteca, Arena, cambiar el tema
// o crear un nodo. ↑↓ para moverse, Enter para ejecutar, Esc para cerrar.
// Reflejos locales: TODAS las acciones de esta paleta (crear tarjeta, cambiar de
// modo, abrir sala, compartir…) se ejecutan en el navegador al instante, sin
// llamar a ningún modelo de IA ni gastar consultas.
// ============================================================================

interface Command {
  id: string;
  group: "Acciones" | "Nodos";
  label: string;
  hint?: string;
  keywords?: string;
  shortcut?: string;
  icon: React.ReactNode;
  run: () => void;
}

const NODE_ICONS: Record<NodeArchetype, React.ReactNode> = {
  "file-node": <FileBox className="w-4 h-4" />,
  "sketch-note-node": <NotebookPen className="w-4 h-4" />,
  "calc-latex-node": <Sigma className="w-4 h-4" />,
  "resource-link-node": <Link2 className="w-4 h-4" />,
  "code-lab-node": <Terminal className="w-4 h-4" />,
  "ai-chat-node": <Bot className="w-4 h-4" />,
  "form-sheet-node": <ClipboardList className="w-4 h-4" />,
  "formula-sheet-node": <SquareFunction className="w-4 h-4" />,
};

/** Minúsculas y sin tildes: «calculo» encuentra «Cálculo». */
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Acciones que crean o modifican piezas: se ocultan en modo solo lectura. */
const WRITE_COMMAND_IDS = new Set([
  "new-node",
  "new-card",
  "oracle",
  "library",
  "draw",
  "connect",
  "link",
  "codelab",
  "forms-library",
  "forms-autofill",
  "new-formula",
  "cut-card",
  "paste-card",
]);

/** Herramientas técnicas que no se muestran en Modo Simple (Sprint 19). */
const EXPERT_ONLY_COMMAND_IDS = new Set(["library", "codelab", "new-formula"]);

/** Centra la cámara del lienzo en el nodo (escritorio) o lo muestra (teléfono). */
const jumpToNode = focusNodeOnScreen;

export const CommandPalette: React.FC = () => {
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const animations = useSettingsStore((s) => s.animations);
  const prefersReduced = useReducedMotion() ?? false;
  const reduced = prefersReduced || animations === "reduced";

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && <PaletteDialog reduced={reduced} onClose={() => setOpen(false)} />}
    </AnimatePresence>,
    document.body
  );
};

const PaletteDialog: React.FC<{ reduced: boolean; onClose: () => void }> = ({ reduced, onClose }) => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const theme = useWorkspaceStore((s) => s.theme);
  const expert = useIsExpert();
  const hasSelection = useWorkspaceStore((s) => s.nodes.some((n) => n.id === s.selectedNodeId));
  const hasClipboard = useWorkspaceStore((s) => s.clipboard !== null);
  const mod = useModKey();
  // Sala llena (7.º) o vista invitado: sin acciones que modifiquen el lienzo.
  const readOnly = useCanvasReadOnly();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  // Devuelve el foco a donde estaba al cerrar.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const commands = useMemo<Command[]>(() => {
    const ws = () => useWorkspaceStore.getState();
    const actions: Command[] = [
      {
        id: "new-node",
        group: "Acciones",
        label: "Nuevo nodo",
        keywords: "crear agregar nota pieza",
        shortcut: SHORTCUT_KEYS.newNode,
        icon: <Plus className="w-4 h-4" />,
        run: () => ws().spawnNode(),
      },
      {
        id: "new-card",
        group: "Acciones",
        label: "Nueva tarjeta",
        hint: "Una nota en el centro de tu vista",
        keywords: "crear nota bloque tarjeta apunte",
        icon: <StickyNote className="w-4 h-4" />,
        run: () => quickAdd("note"),
      },
      ...(hasSelection
        ? ([
            {
              id: "copy-card",
              group: "Acciones",
              label: "Copiar ficha seleccionada",
              keywords: "copiar duplicar portapapeles tarjeta nodo",
              shortcut: `${mod} C`,
              icon: <Copy className="w-4 h-4" />,
              run: () => void copyCards(),
            },
            {
              id: "cut-card",
              group: "Acciones",
              label: "Cortar ficha seleccionada",
              keywords: "cortar mover portapapeles tarjeta nodo",
              shortcut: `${mod} X`,
              icon: <Scissors className="w-4 h-4" />,
              run: () => void cutCards(),
            },
          ] satisfies Command[])
        : []),
      ...(hasClipboard
        ? ([
            {
              id: "paste-card",
              group: "Acciones",
              label: "Pegar ficha",
              keywords: "pegar portapapeles tarjeta nodo duplicar",
              shortcut: `${mod} V`,
              icon: <ClipboardPaste className="w-4 h-4" />,
              run: () => void pasteClipboard(),
            },
          ] satisfies Command[])
        : []),
      {
        id: "mode",
        group: "Acciones",
        label: expert ? "Cambiar a Modo Simple" : "Cambiar a Modo Experto",
        hint: expert ? "Oculta 3D, CodeLab, fórmulas y Biblioteca" : "Muestra 3D, CodeLab, fórmulas y Biblioteca",
        keywords: "modo simple experto avanzado herramientas ingenieria",
        icon: <Gauge className="w-4 h-4" />,
        run: () => void chooseExperienceMode(expert ? "simple" : "expert"),
      },
      {
        id: "voice-room",
        group: "Acciones",
        label: "Abrir sala de voz",
        keywords: "voz llamada sala hablar microfono equipo",
        icon: <Headphones className="w-4 h-4" />,
        run: () => {
          const collab = useCollabStore.getState();
          if (collab.inCall) collab.setPanelOpen(true);
          else void joinCollabRoom();
        },
      },
      {
        id: "share",
        group: "Acciones",
        label: "Compartir espacio",
        keywords: "invitar enlace colaborar equipo",
        icon: <Share2 className="w-4 h-4" />,
        run: () => useSocialStore.getState().setShareOpen(true),
      },
      {
        id: "forms-library",
        group: "Acciones",
        label: "Librería de fichas",
        hint: "24 plantillas listas para usar y tus propios formatos",
        keywords: "ficha fichas formato formulario plantilla plantillas catalogo kickoff reunion acta entregables riesgos brief roadmap planos rfi inspeccion presupuesto propuesta proveedores onboarding evento editorial tesis estudio semanal historial clinico receta medicion registro logistica",
        icon: <ClipboardList className="w-4 h-4" />,
        run: () => useFormsLibraryStore.getState().openLibrary("catalog"),
      },
      {
        id: "forms-autofill",
        group: "Acciones",
        label: "Llenar fichas con IA",
        hint: "Pega tus notas y la IA llena las fichas",
        keywords: "autollenado auto llenar rellenar ficha formulario ia notas dictado",
        icon: <Sparkles className="w-4 h-4" />,
        run: () => useFormsLibraryStore.getState().openLibrary("autofill"),
      },
      {
        id: "new-formula",
        group: "Acciones",
        label: "Nueva fórmula",
        hint: "LaTeX que se calcula sola con tus fichas",
        keywords: "formula latex ecuacion calcular imc dosis costo margen variable katex",
        icon: <SquareFunction className="w-4 h-4" />,
        run: () => useFormulaCreatorStore.getState().setOpen(true),
      },
      {
        id: "export-plan",
        group: "Acciones",
        label: "Estudio de exportación",
        hint: "PDF, documento .docx, presentación .pptx y resumen para mensajería",
        keywords: "pdf imprimir mensajeria chat grupo resumen exportar documento plan del dia docx texto pptx presentacion diapositivas informe",
        icon: <FileText className="w-4 h-4" />,
        run: () => usePlanExportStore.getState().setOpen(true),
      },
      {
        id: "friends",
        group: "Acciones",
        label: "Amigos",
        keywords: "contactos usuarios solicitudes",
        icon: <Users className="w-4 h-4" />,
        run: () => useSocialStore.getState().setFriendsOpen(true),
      },
      {
        id: "comments",
        group: "Acciones",
        label: "Comentarios del tablero",
        keywords: "comentar notas revision feedback hilo resolver",
        icon: <MessageSquare className="w-4 h-4" />,
        run: () => useCommentsStore.getState().openDrawer(null),
      },
      {
        id: "google-calendar",
        group: "Acciones",
        label: "Calendarios externos",
        // brand-ok: interoperabilidad (la persona conecta su propia cuenta de calendario)
        hint: "Fechas del tablero a Google Calendar u Outlook, .ics e importar agenda",
        keywords: "calendario agenda fechas cita evento ics outlook microsoft 365 office apple google cronograma recordatorio",
        icon: <CalendarDays className="w-4 h-4" />,
        run: () => useCalendarStore.getState().openModal(null),
      },
      {
        id: "oracle",
        group: "Acciones",
        label: "Abrir Oráculo IA",
        hint: "Estudio de documentos con IA",
        keywords: "ia ai chat documento redactar",
        shortcut: SHORTCUT_KEYS.oracle,
        icon: <Sparkles className="w-4 h-4" />,
        run: () => ws().setOracleModalOpen(true),
      },
      {
        id: "library",
        group: "Acciones",
        label: "Abrir Biblioteca de fuentes",
        keywords: "papers normas youtube citar fuentes",
        shortcut: SHORTCUT_KEYS.library,
        icon: <Library className="w-4 h-4" />,
        run: () => useLibraryStore.getState().openLibrary({ origin: "canvas" }),
      },
      {
        id: "arena",
        group: "Acciones",
        label: "Abrir Andros Arena",
        keywords: "retos empleos practicas actividades",
        icon: <Swords className="w-4 h-4" />,
        run: () => useMarketStore.getState().setArenaOpen(true),
      },
      {
        id: "theme",
        group: "Acciones",
        label: theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
        keywords: "tema dia noche paper obsidian",
        icon: theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />,
        run: () => ws().toggleTheme(),
      },
      {
        id: "pointer",
        group: "Acciones",
        label: "Herramienta Seleccionar",
        shortcut: SHORTCUT_KEYS.pointer,
        icon: <MousePointer2 className="w-4 h-4" />,
        run: () => ws().setActiveTool("pointer"),
      },
      {
        id: "draw",
        group: "Acciones",
        label: "Herramienta Dibujar",
        keywords: "lapiz tinta mano alzada",
        shortcut: SHORTCUT_KEYS.draw,
        icon: <PenLine className="w-4 h-4" />,
        run: () => ws().setActiveTool("draw"),
      },
      {
        id: "connect",
        group: "Acciones",
        label: "Herramienta Conectar",
        keywords: "cable unir enlazar",
        shortcut: SHORTCUT_KEYS.connect,
        icon: <Cable className="w-4 h-4" />,
        run: () => ws().setActiveTool("connect"),
      },
      {
        id: "link",
        group: "Acciones",
        label: "Nuevo enlace o fuente",
        keywords: "url web",
        shortcut: SHORTCUT_KEYS.link,
        icon: <Link2 className="w-4 h-4" />,
        run: () => ws().spawnNode({ type: "resource-link-node" }),
      },
      {
        id: "codelab",
        group: "Acciones",
        label: "Nuevo CodeLab",
        keywords: "codigo calculo script",
        shortcut: SHORTCUT_KEYS.codeLab,
        icon: <Code2 className="w-4 h-4" />,
        run: () => ws().spawnNode({ type: "code-lab-node" }),
      },
      {
        id: "fit",
        group: "Acciones",
        label: "Encuadrar todo el lienzo",
        keywords: "zoom extents ver todo",
        icon: <Maximize className="w-4 h-4" />,
        run: () => ws().requestZoomExtents(),
      },
      {
        id: "settings",
        group: "Acciones",
        label: "Ajustes",
        keywords: "preferencias configuracion",
        icon: <Settings className="w-4 h-4" />,
        run: () => useSettingsStore.getState().setModalOpen(true),
      },
      {
        id: "keys",
        group: "Acciones",
        label: "Claves IA",
        keywords: "gemini claude openai anthropic api key clave propia",
        icon: <KeyRound className="w-4 h-4" />,
        run: () => useAiProvidersStore.getState().setKeysModalOpen(true),
      },
      {
        id: "shortcuts-guide",
        group: "Acciones",
        label: "Atajos y guía de conexión de IA",
        keywords: "ayuda atajos teclado ayuda guia conectar modelos",
        icon: <CircleHelp className="w-4 h-4" />,
        shortcut: "?",
        run: () => useShortcutsGuideStore.getState().openGuide(),
      },
      {
        id: "plans",
        group: "Acciones",
        label: "Planes",
        keywords: "pro precio suscripcion",
        icon: <Crown className="w-4 h-4" />,
        run: () => useMarketStore.getState().setUpgradeOpen(true),
      },
    ];
    const nodeCommands: Command[] = nodes.map((n) => ({
      id: `node-${n.id}`,
      group: "Nodos",
      label: n.title || "Sin título",
      hint: `${NODE_ARCHETYPE_LABELS[n.type]} · ${n.codeTag}`,
      keywords: `${NODE_ARCHETYPE_LABELS[n.type]} ${n.codeTag}`,
      icon: NODE_ICONS[n.type],
      run: () => jumpToNode(n.id),
    }));
    // Biblioteca Científica, CodeLab y fórmulas LaTeX son del Modo Experto.
    const byMode = expert ? actions : actions.filter((c) => !EXPERT_ONLY_COMMAND_IDS.has(c.id));
    const visible = readOnly ? byMode.filter((c) => !WRITE_COMMAND_IDS.has(c.id)) : byMode;
    return [...visible, ...nodeCommands];
  }, [nodes, theme, expert, readOnly, hasSelection, hasClipboard, mod]);

  const results = useMemo(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return commands;
    return commands.filter((c) => {
      const hay = normalize(`${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`);
      return tokens.every((t) => hay.includes(t));
    });
  }, [commands, query]);

  const safeActive = Math.min(active, Math.max(results.length - 1, 0));

  // Mantiene visible la opción activa al moverse con el teclado.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${safeActive}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [safeActive]);

  const execute = (cmd: Command | undefined) => {
    if (!cmd) return;
    onClose();
    // Tras cerrar, para que el foco y los modales nuevos no choquen.
    requestAnimationFrame(cmd.run);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((safeActive + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((safeActive - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(results[safeActive]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // El foco se queda en el buscador (trampa de foco).
    }
  };

  let lastGroup: Command["group"] | null = null;

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-start justify-center px-3 pt-[12vh] md:pt-[16vh] bg-black/40 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.12 }}
      onPointerDown={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
        transition={springOrInstant(reduced)}
        className="w-full max-w-xl rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-andros-border">
          <Search className="w-4 h-4 text-andros-muted shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Busca un nodo o una acción…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[safeActive] ? `${listId}-${results[safeActive].id}` : undefined}
            aria-label="Buscar comandos y nodos"
            className="flex-1 min-w-0 bg-transparent text-sm text-andros-primary placeholder:text-andros-muted outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <ul id={listId} ref={listRef} role="listbox" aria-label="Resultados" className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-xs text-andros-muted">
              Nada coincide con «{query.trim()}».
            </li>
          )}
          {results.map((cmd, index) => {
            const header = cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            const selected = index === safeActive;
            return (
              <React.Fragment key={cmd.id}>
                {header && (
                  <li role="presentation" className="px-2.5 pt-2.5 pb-1 text-[10px] font-mono uppercase tracking-wider text-andros-muted">
                    {header}
                    {header === "Nodos" && <span className="ml-1.5 tabular-nums">{nodes.length}</span>}
                  </li>
                )}
                <li
                  id={`${listId}-${cmd.id}`}
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  onPointerMove={() => !selected && setActive(index)}
                  onClick={() => execute(cmd)}
                  className={`flex items-center gap-3 px-2.5 min-h-[44px] rounded-xl cursor-pointer ${
                    selected ? "bg-andros-border/60" : ""
                  }`}
                >
                  <span className={`shrink-0 ${selected ? "text-andros-accent-ink" : "text-andros-muted"}`}>{cmd.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-andros-primary truncate">{cmd.label}</span>
                    {cmd.hint && <span className="block text-[11px] text-andros-muted truncate">{cmd.hint}</span>}
                  </span>
                  {cmd.shortcut && <Kbd>{cmd.shortcut}</Kbd>}
                </li>
              </React.Fragment>
            );
          })}
        </ul>

        <div className="hidden md:flex items-center gap-3 px-4 h-9 border-t border-andros-border text-[11px] text-andros-muted">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> moverse
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> ejecutar
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
};
