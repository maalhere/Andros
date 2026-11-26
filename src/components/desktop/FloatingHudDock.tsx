"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring } from "framer-motion";
import { useIsExpert, useSettingsStore } from "@/store/useSettingsStore";
import {
  Bot,
  Box,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  MessagesSquare,
  Library,
  Link2,
  MousePointer2,
  Plus,
  Sparkles,
  PenLine,
  Eraser,
  Eye,
  MessageSquare,
  SquareFunction,
  StickyNote,
  Undo2,
  Minus,
} from "lucide-react";
import { quickAdd, quickAddOptionsFor, type QuickAddKind } from "@/lib/canvas/quickAdd";
import {
  INK_TIP_WIDTHS,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import type { CanvasInkColor, CanvasInkTip } from "@/types/workspace";
import { useLibraryStore } from "@/store/useLibraryStore";
import { SPRING_SNAPPY } from "@/lib/motion";
import { READ_ONLY_LABELS, useReadOnlyReason } from "@/store/useCollabStore";
import { useCommentsStore } from "@/store/useCommentsStore";

// ============================================================================
// 1. INDICADOR DE ZOOM DISCRETO (esquina inferior izquierda)  − 100% +
//    Clic en el porcentaje → vuelve al 100 %.
// ============================================================================

/** Paso de los botones +/- (20 % relativo por clic). */
const ZOOM_STEP = 1.2;

const hudButtonClass =
  "hit-slop flex items-center justify-center h-7 min-w-7 px-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] disabled:opacity-35 disabled:pointer-events-none spring-micro";

const CanvasZoomIndicator: React.FC = () => {
  const scale = useWorkspaceStore((s) => s.canvasTransform.scale);
  const zoomCanvasAt = useWorkspaceStore((s) => s.zoomCanvasAt);

  const percent = Math.round(scale * 100);

  return (
    <div
      role="toolbar"
      aria-label="Zoom del lienzo"
      className="fixed left-6 bottom-6 max-[1000px]:bottom-[5.75rem] z-40 flex items-center gap-0.5 p-1 rounded-xl bg-andros-surface/80 backdrop-blur-xl border border-andros-border font-mono text-[11px] opacity-80 hover:opacity-100 spring-micro"
    >
      <button
        type="button"
        onClick={() => zoomCanvasAt(scale / ZOOM_STEP)}
        disabled={scale <= MIN_CANVAS_SCALE + 0.001}
        title="Alejar (rueda del ratón)"
        aria-label="Alejar"
        className={hudButtonClass}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={() => zoomCanvasAt(1)}
        aria-live="polite"
        title="Volver al 100 %"
        aria-label={`Zoom ${percent} %. Volver al 100 %`}
        className="w-11 h-7 text-center font-mono tabular-nums text-andros-primary rounded-lg hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
      >
        {percent}%
      </button>

      <button
        type="button"
        onClick={() => zoomCanvasAt(scale * ZOOM_STEP)}
        disabled={scale >= MAX_CANVAS_SCALE - 0.001}
        title="Acercar (rueda del ratón)"
        aria-label="Acercar"
        className={hudButtonClass}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ============================================================================
// 2. MINI-BARRA DEL LÁPIZ (solo visible con la herramienta Lápiz activa)
// ============================================================================

const INK_COLORS: { value: CanvasInkColor; label: string; swatch: string }[] = [
  { value: "adaptive", label: "Grafito / Blanco", swatch: "var(--text-primary)" },
  { value: "#C95A3B", label: "Terracota", swatch: "#C95A3B" },
  { value: "#3B82F6", label: "Azul Cobalto", swatch: "#3B82F6" },
  { value: "#10B981", label: "Verde Esmeralda", swatch: "#10B981" },
];

const INK_TIPS: { value: CanvasInkTip; label: string }[] = [
  { value: "fine", label: "Fino 2px" },
  { value: "medium", label: "Medio 4px" },
  { value: "highlighter", label: "Resaltador 10px" },
];

const InkToolbar: React.FC = () => {
  const inkColor = useWorkspaceStore((s) => s.inkColor);
  const inkTip = useWorkspaceStore((s) => s.inkTip);
  const inkMode = useWorkspaceStore((s) => s.inkMode);
  const hasStrokes = useWorkspaceStore((s) => s.canvasStrokes.length > 0);
  const setInkColor = useWorkspaceStore((s) => s.setInkColor);
  const setInkTip = useWorkspaceStore((s) => s.setInkTip);
  const setInkMode = useWorkspaceStore((s) => s.setInkMode);
  const undoCanvasInk = useWorkspaceStore((s) => s.undoCanvasInk);

  const isEraser = inkMode === "eraser";
  const activeSwatch = INK_COLORS.find((c) => c.value === inkColor)?.swatch ?? "var(--text-primary)";

  return (
    <div
      role="toolbar"
      aria-label="Opciones del lápiz"
      aria-orientation="vertical"
      className="fixed left-6 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 p-1.5 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark spring-micro"
    >
      {/* Colores */}
      {INK_COLORS.map((color) => {
        const selected = !isEraser && inkColor === color.value;
        return (
          <button
            key={color.value}
            type="button"
            onClick={() => setInkColor(color.value)}
            title={color.label}
            aria-label={`Color ${color.label}`}
            aria-pressed={selected}
            className={`flex items-center justify-center w-8 h-8 rounded-xl hover:bg-andros-border/40 active:scale-95 spring-micro ${
              selected ? "bg-andros-border/70" : ""
            }`}
          >
            <span
              className={`block w-4 h-4 rounded-full spring-micro ${
                selected ? "ring-2 ring-offset-2 ring-offset-andros-card ring-andros-border-active scale-110" : ""
              }`}
              style={{ backgroundColor: color.swatch }}
            />
          </button>
        );
      })}

      <div className="w-5 h-px bg-andros-border my-1" />

      {/* Grosores de punta */}
      {INK_TIPS.map((tip) => {
        const selected = !isEraser && inkTip === tip.value;
        const size = Math.max(3, INK_TIP_WIDTHS[tip.value] + (tip.value === "fine" ? 1 : 0));
        return (
          <button
            key={tip.value}
            type="button"
            onClick={() => setInkTip(tip.value)}
            title={tip.label}
            aria-label={`Punta ${tip.label}`}
            aria-pressed={selected}
            className={`flex items-center justify-center w-8 h-8 rounded-xl hover:bg-andros-border/40 active:scale-95 spring-micro ${
              selected ? "bg-andros-border/70" : ""
            }`}
          >
            <span
              className="block w-5 rounded-full"
              style={{
                height: `${size}px`,
                backgroundColor: activeSwatch,
                opacity: tip.value === "highlighter" ? 0.4 : 1,
              }}
            />
          </button>
        );
      })}

      <div className="w-5 h-px bg-andros-border my-1" />

      {/* Borrador */}
      <button
        type="button"
        onClick={() => setInkMode(isEraser ? "pen" : "eraser")}
        title="Borrador: toca un trazo para eliminarlo (E)"
        aria-label="Borrador"
        aria-pressed={isEraser}
        className={`flex items-center justify-center w-8 h-8 rounded-xl active:scale-95 spring-micro ${
          isEraser
            ? "text-andros-accent-ink bg-andros-border/70"
            : "text-andros-muted hover:text-andros-primary hover:bg-andros-border/40"
        }`}
      >
        <Eraser className="w-4 h-4" />
      </button>

      {/* Deshacer último trazo */}
      <button
        type="button"
        onClick={undoCanvasInk}
        disabled={!hasStrokes}
        title="Deshacer último trazo (Ctrl+Z)"
        aria-label="Deshacer último trazo"
        className="flex items-center justify-center w-8 h-8 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-95 disabled:opacity-35 disabled:pointer-events-none spring-micro"
      >
        <Undo2 className="w-4 h-4" />
      </button>
    </div>
  );
};

// ============================================================================
// 3. DOCK PRINCIPAL — 4 botones claros con icono + etiqueta
//    Seleccionar · + Agregar · Dibujar · Oráculo IA
// ============================================================================

const DOCK_SPRING = { type: "spring", stiffness: 450, damping: 32, mass: 0.8 } as const;
const MAGNET_RANGE = 70; // px alrededor del botón donde empieza a atraer
const MAGNET_PULL = 0.12; // fracción de la distancia al cursor que se desplaza

interface DockButtonProps {
  onClick: () => void;
  title: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  accent?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  tourId?: string;
  full: boolean;
}

const DockButton: React.FC<DockButtonProps> = ({
  onClick,
  title,
  label,
  icon,
  active = false,
  accent = false,
  pressed,
  expanded,
  tourId,
  full,
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, DOCK_SPRING);
  const y = useSpring(my, DOCK_SPRING);

  const handleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!full || e.pointerType === "touch" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) > MAGNET_RANGE) return;
    mx.set(dx * MAGNET_PULL);
    my.set(dy * MAGNET_PULL);
  };
  const resetMagnet = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={pressed}
      aria-expanded={expanded}
      data-tour={tourId}
      onPointerMove={handleMove}
      onPointerLeave={resetMagnet}
      style={full ? { x, y } : undefined}
      whileHover={full ? { scale: 1.04 } : undefined}
      whileTap={full ? { scale: 0.94 } : { scale: 0.97 }}
      transition={full ? DOCK_SPRING : { duration: 0 }}
      className={`relative flex items-center gap-2 h-10 px-3.5 rounded-xl ${
        active
          ? accent
            ? "text-andros-accent-ink"
            : "text-andros-primary"
          : "text-andros-muted hover:text-andros-primary hover:bg-andros-border/30"
      }`}
    >
      {active && (
        <motion.span
          layoutId="activeToolPill"
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-andros-border/70"
          transition={full ? DOCK_SPRING : { duration: 0 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-2">
        {icon}
        <span className="text-[13px] font-medium">{label}</span>
      </span>
    </motion.button>
  );
};

const QUICK_ADD_ICONS: Record<QuickAddKind, React.ReactNode> = {
  file3d: <Box className="w-4 h-4" />,
  note: <StickyNote className="w-4 h-4" />,
  link: <Link2 className="w-4 h-4" />,
  calc: <Calculator className="w-4 h-4" />,
  forms: <ClipboardList className="w-4 h-4" />,
  resolution: <ClipboardCheck className="w-4 h-4" />,
  formula: <SquareFunction className="w-4 h-4" />,
  ai: <Bot className="w-4 h-4" />,
  "ai-import": <MessagesSquare className="w-4 h-4" />,
};

/** Menú emergente de "+ Agregar" con las 4 opciones. */
const AddMenu: React.FC<{ onClose: () => void; onPickFile: () => void }> = ({
  onClose,
  onPickFile,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const expert = useIsExpert();

  useEffect(() => {
    const handlePointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest("[data-add-trigger]")) return;
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label="Agregar al lienzo"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={SPRING_SNAPPY}
      className="absolute bottom-[calc(100%+12px)] left-1/2 -ml-36 w-72 p-1.5 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark"
    >
      {quickAddOptionsFor(expert).map((option) => (
        <button
          key={option.kind}
          type="button"
          role="menuitem"
          onClick={() => {
            if (option.kind === "file3d") {
              onPickFile();
            } else {
              quickAdd(option.kind);
            }
            onClose();
          }}
          className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left hover:bg-andros-border/40 active:scale-[0.98] spring-micro"
        >
          {/* Radio interior = 12px (rounded-xl) − 4px de margen → 8px (rounded-lg) */}
          <span className="w-8 h-8 shrink-0 rounded-lg bg-andros-accent/10 text-andros-accent-ink flex items-center justify-center">
            {QUICK_ADD_ICONS[option.kind]}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-andros-primary">{option.label}</span>
            <span className="block text-[11px] text-andros-muted truncate">{option.description}</span>
          </span>
        </button>
      ))}
    </motion.div>
  );
};

export const FloatingHudDock: React.FC = () => {
  const activeTool = useWorkspaceStore((s) => s.activeTool);
  const setActiveTool = useWorkspaceStore((s) => s.setActiveTool);
  const setOracleModalOpen = useWorkspaceStore((s) => s.setOracleModalOpen);
  const full = useSettingsStore((s) => s.animations) === "full";
  const expert = useIsExpert();
  // Sala llena (7.º) o rol Comentarista / Solo lectura: el dock solo deja navegar (y comentar).
  const readOnlyReason = useReadOnlyReason();
  const readOnly = readOnlyReason !== null;

  const [addOpen, setAddOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeAdd = useCallback(() => setAddOpen(false), []);

  // Al pasar a solo lectura se sueltan el lápiz y el cable (el menú «Agregar» ya no se pinta).
  useEffect(() => {
    if (!readOnly) return;
    const ws = useWorkspaceStore.getState();
    if (ws.activeTool !== "pointer") ws.setActiveTool("pointer");
  }, [readOnly]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) quickAdd("file3d", file);
  };

  const isDrawing = activeTool === "draw" && !readOnly;

  if (readOnly) {
    return (
      <>
        <CanvasZoomIndicator />
        <nav
          aria-label="Herramientas del Lienzo (solo lectura)"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 p-1.5 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark"
        >
          <DockButton
            full={full}
            title="Seleccionar y mover la vista (V)"
            label="Seleccionar"
            icon={<MousePointer2 className="w-4 h-4" />}
            active
            onClick={() => setActiveTool("pointer")}
          />
          {readOnlyReason !== "capacity" && (
            <DockButton
              full={full}
              title={readOnlyReason === "commenter" ? "Ver y escribir comentarios" : "Leer los comentarios"}
              label="Comentarios"
              icon={<MessageSquare className="w-4 h-4" />}
              onClick={() => useCommentsStore.getState().openDrawer(null)}
            />
          )}
          <p
            role="status"
            title={READ_ONLY_LABELS[readOnlyReason ?? "capacity"].long}
            className="flex items-center gap-2 h-10 px-3.5 rounded-xl text-[13px] font-medium text-andros-muted"
          >
            <Eye className="w-4 h-4" aria-hidden="true" />
            {readOnlyReason === "commenter" ? "Comentarista" : "Solo lectura"}
          </p>
        </nav>
      </>
    );
  }

  return (
    <>
      <CanvasZoomIndicator />
      {isDrawing && <InkToolbar />}

      {/* Selector nativo de "Archivo 3D" (sin `accept`: iOS bloquea .stl/.3mf si se filtra) */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFile}
        aria-label="Subir archivo 3D"
      />

      <nav
        aria-label="Herramientas del Lienzo"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 p-1.5 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark"
      >
        <DockButton
          full={full}
          title="Seleccionar y mover piezas (V)"
          label="Seleccionar"
          icon={<MousePointer2 className="w-4 h-4" />}
          active={!isDrawing && !addOpen}
          onClick={() => setActiveTool("pointer")}
        />

        <div className="relative" data-add-trigger>
          <DockButton
            full={full}
            title={expert ? "Agregar archivo 3D, nota, enlace o cálculo" : "Agregar nota, enlace, cálculo o Nodo IA"}
            label="Agregar"
            icon={<Plus className="w-4 h-4" />}
            active={addOpen}
            expanded={addOpen}
            tourId="add"
            onClick={() => setAddOpen((open) => !open)}
          />
          <AnimatePresence>
            {addOpen && (
              <AddMenu onClose={closeAdd} onPickFile={() => fileInputRef.current?.click()} />
            )}
          </AnimatePresence>
        </div>

        <DockButton
          full={full}
          title="Dibujar a mano alzada (D)"
          label="Dibujar"
          icon={<PenLine className="w-4 h-4" />}
          active={isDrawing}
          accent
          pressed={isDrawing}
          tourId="draw"
          onClick={() => setActiveTool(isDrawing ? "pointer" : "draw")}
        />

        {expert && (
          <DockButton
            full={full}
            title="Biblioteca científica: papers, normas, videos y publicaciones profesionales (B)"
            label="Biblioteca"
            icon={<Library className="w-4 h-4" />}
            onClick={() => useLibraryStore.getState().openLibrary({ origin: "canvas" })}
          />
        )}

        <motion.button
          type="button"
          onClick={() => setOracleModalOpen(true)}
          title="Oráculo IA (O)"
          aria-keyshortcuts="O"
          data-tour="oracle"
          whileHover={full ? { scale: 1.04 } : undefined}
          whileTap={{ scale: full ? 0.94 : 0.97 }}
          transition={full ? DOCK_SPRING : { duration: 0 }}
          className="flex items-center gap-2 h-10 px-3.5 ml-0.5 rounded-xl bg-andros-primary text-andros-canvas hover:opacity-90 shadow-sm"
        >
          <Sparkles className="w-4 h-4 text-andros-accent-ink" />
          <span className="text-[13px] font-semibold">Oráculo IA</span>
        </motion.button>
      </nav>
    </>
  );
};

