"use client";

import React, { useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  MousePointer,
  PlusCircle,
  GitBranch,
  Library,
  Link2,
  Sparkles,
  PenLine,
  Eraser,
  Terminal,
  Undo2,
  Minus,
  Plus,
  Scan,
} from "lucide-react";
import {
  INK_TIP_WIDTHS,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  useWorkspaceStore,
} from "@/store/useWorkspaceStore";
import type { CanvasInkColor, CanvasInkTip } from "@/types/workspace";

// ============================================================================
// 1. HUD DE TELEMETRÍA DE CÁMARA (esquina inferior izquierda)
//    [-] 100% [+] | [ ] Zoom Extents | 1:1
// ============================================================================

/** Paso de los botones +/- (20 % relativo por clic). */
const ZOOM_STEP = 1.2;

const hudButtonClass =
  "flex items-center justify-center h-7 min-w-7 px-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-95 disabled:opacity-35 disabled:pointer-events-none spring-micro";

const CanvasTelemetryHud: React.FC = () => {
  const scale = useWorkspaceStore((s) => s.canvasTransform.scale);
  const zoomCanvasAt = useWorkspaceStore((s) => s.zoomCanvasAt);
  const requestZoomExtents = useWorkspaceStore((s) => s.requestZoomExtents);

  const percent = Math.round(scale * 100);

  return (
    <div
      role="toolbar"
      aria-label="Zoom del lienzo"
      className="fixed left-6 bottom-6 max-[960px]:bottom-[5.25rem] z-40 flex items-center gap-0.5 px-1.5 py-1.5 rounded-xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark font-mono text-[11px]"
    >
      <button
        type="button"
        onClick={() => zoomCanvasAt(scale / ZOOM_STEP)}
        disabled={scale <= MIN_CANVAS_SCALE + 0.001}
        title="Alejar (rueda abajo)"
        aria-label="Alejar"
        className={hudButtonClass}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <span
        aria-live="polite"
        title="Zoom actual"
        className="w-12 text-center tabular-nums text-andros-primary select-none"
      >
        {percent}%
      </span>

      <button
        type="button"
        onClick={() => zoomCanvasAt(scale * ZOOM_STEP)}
        disabled={scale >= MAX_CANVAS_SCALE - 0.001}
        title="Acercar (rueda arriba)"
        aria-label="Acercar"
        className={hudButtonClass}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-andros-border mx-1" />

      <button
        type="button"
        onClick={requestZoomExtents}
        title="Zoom Extents: encuadrar todo (doble clic en la rueda)"
        aria-label="Zoom Extents"
        className={hudButtonClass}
      >
        <Scan className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={() => zoomCanvasAt(1)}
        title="Escala real 1:1 (100 %)"
        aria-label="Escala 1:1"
        className={`${hudButtonClass} ${percent === 100 ? "text-andros-accent" : ""}`}
      >
        <span className="font-semibold tracking-tight">1:1</span>
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
            ? "text-andros-accent bg-andros-border/70"
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
// 3. DOCK PRINCIPAL (física elástica, atracción magnética y pastilla activa)
// ============================================================================

const DOCK_SPRING = { type: "spring", stiffness: 450, damping: 32, mass: 0.8 } as const;
const MAGNET_RANGE = 70; // px alrededor del botón donde empieza a atraer
const MAGNET_PULL = 0.18; // fracción de la distancia al cursor que se desplaza

interface DockButtonProps {
  onClick: () => void;
  title: string;
  active?: boolean;
  accent?: boolean;
  pressed?: boolean;
  full: boolean;
  children: React.ReactNode;
}

const DockButton: React.FC<DockButtonProps> = ({
  onClick,
  title,
  active = false,
  accent = false,
  pressed,
  full,
  children,
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
      onPointerMove={handleMove}
      onPointerLeave={resetMagnet}
      style={full ? { x, y } : undefined}
      whileHover={full ? { scale: 1.07 } : undefined}
      whileTap={full ? { scale: 0.92 } : { scale: 0.97 }}
      transition={full ? DOCK_SPRING : { duration: 0 }}
      className={`relative flex items-center gap-1.5 p-2.5 rounded-xl ${
        active
          ? accent
            ? "text-andros-accent"
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
      <span className="relative z-10 flex items-center gap-1.5">{children}</span>
    </motion.button>
  );
};

export const FloatingHudDock: React.FC = () => {
  const activeTool = useWorkspaceStore((s) => s.activeTool);
  const setActiveTool = useWorkspaceStore((s) => s.setActiveTool);
  const spawnNode = useWorkspaceStore((s) => s.spawnNode);
  const setOracleModalOpen = useWorkspaceStore((s) => s.setOracleModalOpen);
  const full = useSettingsStore((s) => s.animations) === "full";

  return (
    <>
    <CanvasTelemetryHud />
    {activeTool === "draw" && <InkToolbar />}

    <nav
      aria-label="Herramientas del Lienzo"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 px-3 py-2 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark"
    >
      <DockButton full={full} title="Puntero (V)" active={activeTool === "pointer"} onClick={() => setActiveTool("pointer")}>
        <MousePointer className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">V</kbd>
      </DockButton>

      <DockButton full={full} title="Nuevo Nodo (N)" onClick={() => spawnNode()}>
        <PlusCircle className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">N</kbd>
      </DockButton>

      <DockButton full={full} title="Conexión (C)" active={activeTool === "connect"} onClick={() => setActiveTool("connect")}>
        <GitBranch className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">C</kbd>
      </DockButton>

      <DockButton
        full={full}
        title="Lápiz / Tinta Libre (D)"
        active={activeTool === "draw"}
        accent
        pressed={activeTool === "draw"}
        onClick={() => setActiveTool(activeTool === "draw" ? "pointer" : "draw")}
      >
        <PenLine className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">D</kbd>
      </DockButton>

      <div className="w-px h-5 bg-andros-border mx-1" />

      <DockButton full={full} title="Enlace / Fuente (L)" onClick={() => spawnNode({ type: "resource-link-node" })}>
        <Link2 className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">L</kbd>
      </DockButton>

      <DockButton full={full} title="Código / Cálculo (M)" onClick={() => spawnNode({ type: "code-lab-node" })}>
        <Terminal className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">M</kbd>
      </DockButton>

      <div className="w-px h-5 bg-andros-border mx-1" />

      <DockButton
        full={full}
        title="Insertar desde Biblioteca Técnica (B)"
        onClick={() =>
          spawnNode({
            type: "reference",
            title: "Paper • Eurocode 3 Joints",
            codeTag: "DOI-10.1016",
            summary:
              "Diseño de uniones tubulares soldadas sometidas a fatiga multiaxial.",
          })
        }
      >
        <Library className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">B</kbd>
      </DockButton>

      <motion.button
        type="button"
        onClick={() => setOracleModalOpen(true)}
        title="Oráculo IA (⌘K)"
        whileHover={full ? { scale: 1.06 } : undefined}
        whileTap={{ scale: full ? 0.92 : 0.97 }}
        transition={full ? DOCK_SPRING : { duration: 0 }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-andros-primary text-andros-canvas hover:opacity-90 ml-1 shadow-sm"
      >
        <Sparkles className="w-3.5 h-3.5 text-andros-accent" />
        <span className="text-xs font-semibold tracking-wide">Oráculo</span>
        <kbd className="text-[10px] font-mono opacity-70 bg-andros-canvas/20 px-1 py-0.5 rounded">
          ⌘K
        </kbd>
      </motion.button>
    </nav>
    </>
  );
};
