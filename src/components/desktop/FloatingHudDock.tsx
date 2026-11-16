"use client";

import React from "react";
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
// 3. DOCK PRINCIPAL
// ============================================================================

export const FloatingHudDock: React.FC = () => {
  const activeTool = useWorkspaceStore((s) => s.activeTool);
  const setActiveTool = useWorkspaceStore((s) => s.setActiveTool);
  const spawnNode = useWorkspaceStore((s) => s.spawnNode);
  const setOracleModalOpen = useWorkspaceStore((s) => s.setOracleModalOpen);

  return (
    <>
    <CanvasTelemetryHud />
    {activeTool === "draw" && <InkToolbar />}

    <nav
      aria-label="Herramientas del Lienzo"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 px-3 py-2 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark spring-micro"
    >
      {/* 1. Puntero (V) */}
      <button
        type="button"
        onClick={() => setActiveTool("pointer")}
        title="Puntero (V)"
        className={`flex items-center gap-1.5 p-2.5 rounded-xl hover:scale-105 active:scale-95 spring-micro ${
          activeTool === "pointer"
            ? "text-andros-primary bg-andros-border/70"
            : "text-andros-muted hover:text-andros-primary hover:bg-andros-border/30"
        }`}
      >
        <MousePointer className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">V</kbd>
      </button>

      {/* 2. Nuevo Nodo (N) */}
      <button
        type="button"
        onClick={() => spawnNode()}
        title="Nuevo Nodo (N)"
        className="flex items-center gap-1.5 p-2.5 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/30 hover:scale-105 active:scale-95 spring-micro"
      >
        <PlusCircle className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">N</kbd>
      </button>

      {/* 3. Conexión (C) */}
      <button
        type="button"
        onClick={() => setActiveTool("connect")}
        title="Conexión (C)"
        className={`flex items-center gap-1.5 p-2.5 rounded-xl hover:scale-105 active:scale-95 spring-micro ${
          activeTool === "connect"
            ? "text-andros-primary bg-andros-border/70"
            : "text-andros-muted hover:text-andros-primary hover:bg-andros-border/30"
        }`}
      >
        <GitBranch className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">C</kbd>
      </button>

      {/* 4. Lápiz / Tinta Libre (D) */}
      <button
        type="button"
        onClick={() => setActiveTool(activeTool === "draw" ? "pointer" : "draw")}
        title="Lápiz / Tinta Libre (D)"
        aria-pressed={activeTool === "draw"}
        className={`flex items-center gap-1.5 p-2.5 rounded-xl hover:scale-105 active:scale-95 spring-micro ${
          activeTool === "draw"
            ? "text-andros-accent bg-andros-border/70"
            : "text-andros-muted hover:text-andros-primary hover:bg-andros-border/30"
        }`}
      >
        <PenLine className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">D</kbd>
      </button>

      <div className="w-px h-5 bg-andros-border mx-1" />

      {/* 5. Enlace / Fuente (L) */}
      <button
        type="button"
        onClick={() => spawnNode({ type: "resource-link-node" })}
        title="Enlace / Fuente (L)"
        className="flex items-center gap-1.5 p-2.5 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/30 hover:scale-105 active:scale-95 spring-micro"
      >
        <Link2 className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">L</kbd>
      </button>

      {/* 6. Código / Cálculo (M) */}
      <button
        type="button"
        onClick={() => spawnNode({ type: "code-lab-node" })}
        title="Código / Cálculo (M)"
        className="flex items-center gap-1.5 p-2.5 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/30 hover:scale-105 active:scale-95 spring-micro"
      >
        <Terminal className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">M</kbd>
      </button>

      <div className="w-px h-5 bg-andros-border mx-1" />

      {/* 7. Biblioteca Técnica (B) */}
      <button
        type="button"
        onClick={() =>
          spawnNode({
            type: "reference",
            title: "Paper • Eurocode 3 Joints",
            codeTag: "DOI-10.1016",
            summary:
              "Diseño de uniones tubulares soldadas sometidas a fatiga multiaxial.",
          })
        }
        title="Insertar desde Biblioteca Técnica (B)"
        className="flex items-center gap-1.5 p-2.5 rounded-xl text-andros-muted hover:text-andros-primary hover:bg-andros-border/30 hover:scale-105 active:scale-95 spring-micro"
      >
        <Library className="w-4 h-4" />
        <kbd className="text-[10px] font-mono opacity-60">B</kbd>
      </button>

      {/* 8. Oráculo IA (⌘K) */}
      <button
        type="button"
        onClick={() => setOracleModalOpen(true)}
        title="Oráculo IA (⌘K)"
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-andros-primary text-andros-canvas hover:opacity-90 hover:scale-105 active:scale-95 spring-micro ml-1 shadow-sm"
      >
        <Sparkles className="w-3.5 h-3.5 text-andros-accent" />
        <span className="text-xs font-semibold tracking-wide">Oráculo</span>
        <kbd className="text-[10px] font-mono opacity-70 bg-andros-canvas/20 px-1 py-0.5 rounded">
          ⌘K
        </kbd>
      </button>
    </nav>
    </>
  );
};
