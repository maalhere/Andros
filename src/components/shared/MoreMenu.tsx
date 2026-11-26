"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  Crown,
  Eraser,
  MessageSquare,
  MessagesSquare,
  FileText,
  Gauge,
  Sparkle,
  FolderArchive,
  Headphones,
  LayoutTemplate,
  MonitorDown,
  Moon,
  Search,
  Sun,
  CircleHelp,
  GraduationCap,
  KeyRound,
  Library,
  MoreHorizontal,
  Settings,
  Share2,
  Swords,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useMarketStore } from "@/store/useMarketStore";
import { chooseExperienceMode } from "@/lib/billing/entitlements";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useIsExpert, useSettingsStore } from "@/store/useSettingsStore";
import { openWorkspaceChat } from "@/components/cde/WorkspaceChatPanel";
import { useUnreadChatCount } from "@/lib/cde/hooks";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useShortcutsGuideStore } from "@/store/useShortcutsGuideStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";
import { selectIncomingCount, useSocialStore } from "@/store/useSocialStore";
import { clearInkWithUndo, resetWorkspaceWithUndo } from "@/lib/canvas/undoable";
import { LEGAL_LINKS } from "@/lib/site";
import { openCookiePreferences } from "@/lib/consent";
import { saveWorkspaceAsTemplate } from "@/lib/templates/applyBlueprint";
import { usePlanExportStore } from "@/store/usePlanExportStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { useCommentsStore, useOpenCommentTotal } from "@/store/useCommentsStore";
import { useCalendarStore } from "@/store/useCalendarStore";
import { useCollabStore } from "@/store/useCollabStore";
import { joinCollabRoom } from "@/lib/collab/useCollabRoom";
import { useCommandPaletteStore } from "@/store/useCommandPaletteStore";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { InstallAppModal } from "@/components/pwa/InstallAppModal";

// ============================================================================
// ANDROS — MENÚ "⋯ MÁS OPCIONES" (barra superior)
// Agrupa todo lo secundario en una lista limpia para que la pantalla
// principal se entienda al instante.
// (Sprint 19) En Modo Simple se ordena en 3 grupos (Equipo · Herramientas ·
// Configuración) y no repite lo que ya está en la barra (Chat, Compartir,
// Calendarios). Recibe lo que salió de la barra: buscar, voz, comentarios,
// tema, instalar app, cambio de modo y ayuda.
// ============================================================================

type MenuSection = "team" | "tools" | "config";

const SECTION_LABELS: Record<MenuSection, string> = {
  team: "Equipo",
  tools: "Herramientas",
  config: "Configuración",
};

/** Orden de los grupos en Modo Simple (sin grupo = al final, p. ej. «Limpiar»). */
const SECTION_ORDER: (MenuSection | undefined)[] = ["team", "tools", "config", undefined];

/** Opciones que en Modo Simple ya están en la barra superior. */
const SIMPLE_BAR_IDS = new Set(["share", "chat", "calendar"]);

interface MenuItem {
  id: string;
  /** Grupo en Modo Simple (en Experto la lista sigue plana). */
  section?: MenuSection;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Conteo pendiente (p. ej. solicitudes de amistad). */
  badge?: number;
}

/** Opciones que modifican el lienzo: se ocultan en modo solo lectura (sala llena). */
const READ_ONLY_HIDDEN = new Set(["zip", "save-template", "clear"]);

/** Confirmación antes de borrar el contenido del espacio actual. */
const ClearWorkspaceDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const nodeCount = useWorkspaceStore((s) => s.nodes.length);
  const strokeCount = useWorkspaceStore((s) => s.canvasStrokes.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const clearInk = () => {
    clearInkWithUndo();
    onClose();
  };
  const clearAll = () => {
    resetWorkspaceWithUndo();
    onClose();
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs flex items-end md:items-center justify-center p-3 md:p-6"
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="clear-title" className="text-base font-semibold text-andros-primary">
            Limpiar espacio de trabajo
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="min-w-[44px] min-h-[44px] -mr-2.5 -mt-2 rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-andros-muted">
          Este espacio tiene <span className="tabular-nums">{nodeCount}</span> pieza(s) y{" "}
          <span className="tabular-nums">{strokeCount}</span> dibujo(s). Podrás deshacerlo durante
          unos segundos.
        </p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={clearInk}
            disabled={strokeCount === 0}
            className="w-full h-11 rounded-xl border border-andros-border text-sm font-medium text-andros-primary hover:bg-andros-border/40 flex items-center justify-center gap-2 active:scale-[0.98] spring-micro disabled:opacity-40"
          >
            <Eraser className="w-4 h-4" />
            Borrar solo los dibujos
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={nodeCount === 0 && strokeCount === 0}
            className="w-full h-11 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 flex items-center justify-center gap-2 active:scale-[0.98] spring-micro disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
            Borrar todo y empezar de cero
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full h-10 rounded-xl text-sm text-andros-muted hover:text-andros-primary spring-micro"
          >
            Cancelar
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};

/** Pide el nombre y guarda las tarjetas de nota y cálculo del espacio como plantilla local. */
const SaveTemplateDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState("Mi plantilla");
  const cardCount = useWorkspaceStore(
    (s) => s.nodes.filter((n) => n.type === "sketch-note-node" || n.type === "calc-latex-node").length
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = () => {
    if (!name.trim()) return;
    void saveWorkspaceAsTemplate(name.trim()).then((close) => {
      if (close) onClose();
    });
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs flex items-end md:items-center justify-center p-3 md:p-6"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="save-template-title" className="text-base font-semibold text-andros-primary">
            Guardar como plantilla
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="min-w-[44px] min-h-[44px] -mr-2.5 -mt-2 rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-andros-muted">
          Se guardan las <span className="tabular-nums">{cardCount}</span> tarjeta(s) de nota y cálculo con sus cables, en este
          navegador. La próxima vez las aplicas en 1 clic desde un espacio vacío, sin gastar IA. Las tareas vuelven sin marcar.
        </p>
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label htmlFor="save-template-name" className="block text-xs font-medium text-andros-primary">
            Nombre de la plantilla
          </label>
          <input
            id="save-template-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="off"
            className="w-full h-11 px-3 rounded-xl bg-andros-canvas border border-andros-border focus:border-andros-accent outline-none text-sm text-andros-primary"
          />
          <button
            type="submit"
            disabled={!name.trim() || cardCount === 0}
            className="w-full h-11 rounded-xl bg-andros-accent-fill text-white text-sm font-semibold active:scale-[0.98] spring-micro disabled:opacity-40"
          >
            Guardar plantilla
          </button>
          <button type="button" onClick={onClose} className="w-full h-10 rounded-xl text-sm text-andros-muted hover:text-andros-primary spring-micro">
            Cancelar
          </button>
        </form>
      </motion.div>
    </motion.div>,
    document.body,
  );
};

export const MoreMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const incomingRequests = useSocialStore(selectIncomingCount);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const expert = useIsExpert();
  // Sala llena (7.º) o rol Comentarista / Solo lectura: nada que importe, limpie o cree plantillas.
  const readOnly = useCanvasReadOnly();
  const openComments = useOpenCommentTotal();
  const unreadChat = useUnreadChatCount();
  const theme = useWorkspaceStore((s) => s.theme);
  const { canPrompt, isInstalled, platform, promptInstall } = useInstallPrompt();
  const [installGuideOpen, setInstallGuideOpen] = useState(false);

  const install = async () => {
    if (canPrompt) {
      const outcome = await promptInstall();
      if (outcome !== "unavailable") return;
    }
    setInstallGuideOpen(true);
  };

  /** Lo que en Modo Simple sale de la barra superior (en Experto está a la vista). */
  const simpleOnlyItems: MenuItem[] = expert
    ? []
    : [
        {
          id: "search",
          section: "tools",
          label: "Buscar nodos y acciones",
          icon: <Search className="w-4 h-4" />,
          onSelect: () => useCommandPaletteStore.getState().setOpen(true),
        },
        {
          id: "voice",
          section: "team",
          label: "Sala de voz del espacio",
          icon: <Headphones className="w-4 h-4" />,
          onSelect: () => {
            const collab = useCollabStore.getState();
            if (collab.inCall) collab.setPanelOpen(true);
            else void joinCollabRoom();
          },
        },
        {
          id: "theme",
          section: "config",
          label: theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
          icon: theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />,
          onSelect: () => useWorkspaceStore.getState().toggleTheme(),
        },
        ...(isInstalled
          ? []
          : [
              {
                id: "install",
                section: "config" as const,
                label: "Instalar App",
                icon: <MonitorDown className="w-4 h-4" />,
                onSelect: () => void install(),
              },
            ]),
      ];

  const allItems: MenuItem[] = [
    ...simpleOnlyItems,
    {
      id: "mode",
      section: "config",
      label: expert ? "Cambiar a Modo Simple" : "Cambiar a Modo Experto (Pro: 3D, CodeLab)",
      icon: expert ? <Sparkle className="w-4 h-4" /> : <Gauge className="w-4 h-4" />,
      onSelect: () => void chooseExperienceMode(expert ? "simple" : "expert"),
    },
    {
      id: "friends",
      section: "team",
      label: "Amigos",
      icon: <Users className="w-4 h-4" />,
      onSelect: () => useSocialStore.getState().setFriendsOpen(true),
      badge: incomingRequests,
    },
    {
      id: "share",
      label: "Compartir espacio",
      icon: <Share2 className="w-4 h-4" />,
      onSelect: () => useSocialStore.getState().setShareOpen(true),
    },
    {
      id: "chat",
      label: "Chat del lienzo",
      icon: <MessagesSquare className="w-4 h-4" />,
      onSelect: () => openWorkspaceChat(),
      badge: unreadChat,
    },
    {
      id: "comments",
      section: "team",
      label: "Comentarios",
      icon: <MessageSquare className="w-4 h-4" />,
      onSelect: () => useCommentsStore.getState().openDrawer(null),
      badge: openComments,
    },
    {
      id: "calendar",
      label: "Calendarios externos",
      icon: <CalendarDays className="w-4 h-4" />,
      onSelect: () => useCalendarStore.getState().openModal(null),
    },
    {
      id: "export-plan",
      section: "tools",
      label: "Exportar: PDF, .docx, .pptx",
      icon: <FileText className="w-4 h-4" />,
      onSelect: () => usePlanExportStore.getState().setOpen(true),
    },
    {
      id: "arena",
      section: "tools",
      label: "Arena & Empleos",
      icon: <Swords className="w-4 h-4" />,
      onSelect: () => useMarketStore.getState().setArenaOpen(true),
    },
    ...(expert
      ? [
          {
            id: "library",
            label: "Biblioteca científica",
            icon: <Library className="w-4 h-4" />,
            onSelect: () => useLibraryStore.getState().openLibrary({ origin: "canvas" }),
          },
        ]
      : []),
    {
      id: "pro",
      section: "config",
      label: "Planes (Básico / Pro)",
      icon: <Crown className="w-4 h-4" />,
      onSelect: () => useMarketStore.getState().setUpgradeOpen(true),
    },
    {
      id: "settings",
      section: "config",
      label: "Ajustes",
      icon: <Settings className="w-4 h-4" />,
      onSelect: () => useSettingsStore.getState().setModalOpen(true),
    },
    {
      id: "ai-keys",
      section: "config",
      label: "Claves IA propias",
      icon: <KeyRound className="w-4 h-4" />,
      onSelect: () => useAiProvidersStore.getState().setKeysModalOpen(true),
    },
    {
      id: "zip",
      section: "tools",
      label: "Descargar / Importar .zip",
      icon: <FolderArchive className="w-4 h-4" />,
      onSelect: () => useWorkspaceManagerStore.getState().setDrawerOpen(true),
    },
    {
      id: "shortcuts",
      section: "config",
      label: "Atajos y guía de IA",
      icon: <CircleHelp className="w-4 h-4" />,
      onSelect: () => useShortcutsGuideStore.getState().openGuide(),
    },
    {
      id: "tutorial",
      section: "config",
      label: "Ver tutorial",
      icon: <GraduationCap className="w-4 h-4" />,
      onSelect: () => useOnboardingStore.getState().start(),
    },
    {
      id: "save-template",
      section: "tools",
      label: "Guardar como plantilla",
      icon: <LayoutTemplate className="w-4 h-4" />,
      onSelect: () => setSaveTemplateOpen(true),
    },
    {
      id: "clear",
      label: "Limpiar espacio de trabajo",
      icon: <Trash2 className="w-4 h-4" />,
      onSelect: () => setConfirmClear(true),
      danger: true,
    },
  ];
  // Modo Simple: sin repetir la barra y ordenado por grupos (Equipo → Herramientas → Configuración).
  const byMode = expert
    ? allItems
    : allItems
        .filter((item) => !SIMPLE_BAR_IDS.has(item.id))
        .sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
  const items = readOnly ? byMode.filter((item) => !READ_ONLY_HIDDEN.has(item.id)) : byMode;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          incomingRequests > 0
            ? `Más opciones (${incomingRequests} solicitudes de amistad)`
            : "Más opciones"
        }
        title="Más opciones"
        className="relative w-11 h-11 md:w-9 md:h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm text-andros-muted hover:text-andros-primary hover:border-andros-border-active active:scale-[0.96] spring-micro flex items-center justify-center"
      >
        <MoreHorizontal className="w-4 h-4" />
        {incomingRequests > 0 && (
          <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-andros-accent" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            aria-label="Más opciones"
            className="absolute right-0 top-[3.25rem] md:top-11 w-64 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain p-1.5 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark origin-top-right"
          >
            {items.map((item, index) => (
              <React.Fragment key={item.id}>
                {item.danger && index > 0 && <div className="h-px bg-andros-border my-1" />}
                {!expert && item.section && item.section !== items[index - 1]?.section && (
                  <p
                    role="presentation"
                    className={`px-2.5 pb-1 text-[11px] font-medium text-andros-muted ${
                      index > 0 ? "pt-2 mt-1 border-t border-andros-border" : "pt-1"
                    }`}
                  >
                    {SECTION_LABELS[item.section]}
                  </p>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[44px] md:min-h-[38px] rounded-xl text-[13px] text-left active:scale-[0.98] spring-micro ${
                    item.danger
                      ? "text-andros-danger hover:bg-red-500/10"
                      : "text-andros-primary hover:bg-andros-border/40"
                  }`}
                >
                  <span className={item.danger ? "text-andros-danger" : "text-andros-muted"}>{item.icon}</span>
                  {item.label}
                  {item.badge ? (
                    <span className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full bg-andros-accent-fill text-white text-[11px] font-mono tabular-nums flex items-center justify-center">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              </React.Fragment>
            ))}
            {/* Información legal: enlaces discretos al pie del menú */}
            <div className="h-px bg-andros-border my-1" />
            <div className="px-2.5 py-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-andros-muted">
              {LEGAL_LINKS.map((link) => (
                <a key={link.href} href={link.href} className="min-h-[28px] inline-flex items-center hover:text-andros-primary hover:underline underline-offset-2">
                  {link.label}
                </a>
              ))}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openCookiePreferences();
                }}
                className="min-h-[28px] inline-flex items-center hover:text-andros-primary hover:underline underline-offset-2"
              >
                Cookies: preferencias
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmClear && <ClearWorkspaceDialog key="clear" onClose={() => setConfirmClear(false)} />}
        {saveTemplateOpen && <SaveTemplateDialog key="save-template" onClose={() => setSaveTemplateOpen(false)} />}
      </AnimatePresence>
      <InstallAppModal open={installGuideOpen} platform={platform} onClose={() => setInstallGuideOpen(false)} />
    </div>
  );
};
