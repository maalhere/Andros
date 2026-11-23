"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Box, Compass, Hand, Network, Plus, Printer, Sparkles } from "lucide-react";
import { useShortcutsGuideStore } from "@/store/useShortcutsGuideStore";
import { Kbd } from "@/components/shared/Kbd";
import { AiConnectionDiagram } from "@/components/onboarding/AiConnectionGuide";
import {
  hasSeenOnboarding,
  ONBOARDING_STEP_COUNT,
  useOnboardingStore,
} from "@/store/useOnboardingStore";
import { useLandingStore } from "@/store/useLandingStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useIsExpert } from "@/store/useSettingsStore";

// ============================================================================
// ANDROS — TUTORIAL INTERACTIVO DE 5 PASOS (Spotlight)
//   1. Lienzo y cámara          → tarjeta centrada con resumen de gestos
//   2. Herramientas y modos     → botón "Agregar" de la barra inferior
//   3. Oráculo, comandos, etc.  → botón "Oráculo IA"
//   4. Conectar modelos de IA   → tarjeta centrada con mini-diagrama
//   5. Piezas 3D, CodeLab       → tarjeta centrada
// Siempre se puede saltar (Esc o «Saltar tutorial»).
// Se lanza solo la primera vez que alguien entra a su lienzo vacío, y en
// cualquier momento desde "⋯ → Ver tutorial".
// ============================================================================

interface TourStep {
  /** Valor de `data-tour` del elemento a iluminar (null = tarjeta centrada). */
  target: "add" | "draw" | "oracle" | null;
  /** Ilustración bajo el texto (solo en pasos de tarjeta centrada). */
  visual?: "camera" | "ai" | "print";
  icon: React.ReactNode;
  title: string;
  body: { desktop: string; mobile: string };
}

const STEPS: TourStep[] = [
  {
    target: null,
    visual: "camera",
    icon: <Compass className="w-4 h-4" />,
    title: "Lienzo espacial y cámara",
    body: {
      desktop:
        "Mueve el lienzo con el botón central del ratón (o arrastrando el fondo) y usa la rueda para acercarte: el zoom va hacia donde apuntas. Doble clic con el botón central encuadra todo. Las pestañas de arriba te dejan trabajar en varios proyectos a la vez.",
      mobile:
        "Desliza para recorrer tus piezas y cambia de espacio con las pestañas de arriba. Con el botón de mapa ves todo de un vistazo.",
    },
  },
  {
    target: "add",
    icon: <Plus className="w-4 h-4" />,
    title: "Herramientas y modos de trabajo",
    body: {
      desktop:
        "Crea nodos con + Agregar (o N): pieza 3D, nota, enlace, cálculo o Nodo IA. Dibuja a mano alzada con D, borra con E y deshaz el último trazo con Ctrl+Z mientras dibujas. C conecta nodos con cables.",
      mobile:
        "Con + Agregar subes una pieza 3D, escribes una nota, pegas un enlace, creas un cálculo o añades un Nodo IA. Con “Dibujar” abres una hoja para bocetar a mano alzada.",
    },
  },
  {
    target: "oracle",
    icon: <Sparkles className="w-4 h-4" />,
    title: "Oráculo, comandos y biblioteca",
    body: {
      desktop:
        "El Oráculo IA (O) organiza tu lienzo y analiza tus archivos. Ctrl+K / ⌘K abre la Paleta de Comandos, B la Biblioteca científica y, desde la barra superior, entras a Andros Arena. Pulsa ? para ver todos los atajos.",
      mobile:
        "El Oráculo IA organiza tu espacio y analiza tus archivos. En ⋯ encuentras la Biblioteca científica, Andros Arena y esta ayuda.",
    },
  },
  {
    target: null,
    visual: "ai",
    icon: <Network className="w-4 h-4" />,
    title: "Conectar modelos de IA con nodos",
    body: {
      desktop:
        "Crea un Nodo IA (Claude, ChatGPT o Gemini) o importa un chat, y cablea hacia él tus notas, piezas, CodeLab o fuentes. Un Nodo IA también puede alimentar a otro: analiza un paper con Claude y pasa el resumen a ChatGPT o Gemini.",
      mobile:
        "Crea un Nodo IA (Claude, ChatGPT o Gemini) o importa un chat, y conecta hacia él tus notas, piezas o fuentes. Un Nodo IA también puede alimentar a otro.",
    },
  },
  {
    target: null,
    visual: "print",
    icon: <Box className="w-4 h-4" />,
    title: "Piezas 3D, CodeLab y exportar",
    body: {
      desktop:
        "Conecta una pieza 3D a un CodeLab y lee model_x, model_y y model_z (mm) sin medir a mano. Imprime desde la pieza con “Imprimir ahora”, y guarda o comparte tu espacio desde ⋯ → Descargar / Importar .zip.",
      mobile:
        "Conecta una pieza 3D a un CodeLab y lee model_x, model_y y model_z (mm). Imprime con “Imprimir ahora” y guarda o comparte tu espacio desde ⋯ → Descargar / Importar .zip.",
    },
  },
];

/**
 * Modo Simple: mismos 5 pasos, pero sin mencionar 3D, CodeLab ni Biblioteca.
 * (El Modo Experto conserva el texto completo; se cambia desde la barra superior.)
 */
const SIMPLE_OVERRIDES: Record<number, Partial<TourStep>> = {
  1: {
    body: {
      desktop:
        "Crea tarjetas con + Agregar (o N): notas, enlaces, cálculos o un Nodo IA. Dibuja a mano alzada con D y conecta tarjetas con cables con C.",
      mobile:
        "Con + Agregar escribes una nota, pegas un enlace, creas un cálculo o añades un Nodo IA. Con “Dibujar” abres una hoja para bocetar a mano alzada.",
    },
  },
  2: {
    title: "Oráculo y comandos",
    body: {
      desktop:
        "El Oráculo IA (O) ordena tu lienzo y redacta documentos por ti. Ctrl+K / ⌘K abre la Paleta de Comandos y, desde la barra superior, entras a Andros Arena. Pulsa ? para ver todos los atajos.",
      mobile: "El Oráculo IA ordena tu espacio y redacta por ti. En ⋯ encuentras Andros Arena y esta ayuda.",
    },
  },
  4: {
    visual: undefined,
    icon: <Network className="w-4 h-4" />,
    title: "Trabaja en equipo y comparte",
    body: {
      desktop:
        "Únete a la sala de voz de la barra superior, comparte el espacio con un enlace o con tus amigos y editen a la vez. ¿Necesitas piezas 3D, CodeLab o la Biblioteca científica? Activa el Modo Experto en la barra superior.",
      mobile:
        "Entra a la sala de voz, comparte el espacio con un enlace y editen a la vez. Para piezas 3D, CodeLab y Biblioteca activa el Modo Experto en ⋯.",
    },
  },
};

const SPOT_PADDING = 8;
const CARD_GAP = 14;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Sigue la posición del elemento iluminado (resize, scroll, animaciones del dock). */
function useTargetRect(target: TourStep["target"], active: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!active || !target) return;
    let frame = 0;
    let last = "";
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      const r = el && el.getClientRects().length > 0 ? el.getBoundingClientRect() : null;
      const key = r ? `${r.top}|${r.left}|${r.width}|${r.height}` : "none";
      if (key !== last) {
        last = key;
        setRect(r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [target, active]);

  return active && target ? rect : null;
}

/** Mini ilustración del paso 3: tarjeta de pieza con el botón "Imprimir ahora". */
const CameraIllustration: React.FC = () => (
  <ul className="mt-3 space-y-1.5 rounded-2xl border border-andros-border bg-andros-canvas p-3 text-[12px] text-andros-primary">
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5">
        <Hand className="w-3.5 h-3.5 text-andros-muted" aria-hidden="true" /> Mover el lienzo
      </span>
      <span className="font-mono tabular-nums text-[11px] text-andros-muted">Botón central + arrastrar</span>
    </li>
    <li className="flex items-center justify-between gap-2">
      <span>Zoom al cursor</span>
      <span className="font-mono tabular-nums text-[11px] text-andros-muted">Rueda</span>
    </li>
    <li className="flex items-center justify-between gap-2">
      <span>Encuadrar todo</span>
      <span className="font-mono tabular-nums text-[11px] text-andros-muted">Botón central ×2</span>
    </li>
    <li className="flex items-center justify-between gap-2">
      <span>Cambiar de pestaña / cerrar</span>
      <span className="flex gap-1">
        <Kbd>Alt 1…9</Kbd>
        <Kbd>Alt W</Kbd>
      </span>
    </li>
  </ul>
);

const PrintIllustration: React.FC = () => (
  <div className="mt-3 rounded-2xl border border-andros-border bg-andros-canvas p-3">
    <div className="flex items-center gap-2.5">
      <div className="w-10 h-10 rounded-xl bg-andros-accent/10 text-andros-accent-ink flex items-center justify-center">
        <Box className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-andros-primary truncate">soporte_motor.stl</p>
        <p className="text-[10px] font-mono text-andros-muted">42 × 30 × 18 mm · listo</p>
      </div>
    </div>
    <motion.div
      animate={{ scale: [1, 1.04, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      className="mt-2.5 h-9 rounded-xl bg-andros-accent-fill text-white text-[12px] font-semibold flex items-center justify-center gap-1.5"
    >
      <Printer className="w-3.5 h-3.5" />
      Imprimir ahora
    </motion.div>
  </div>
);

export const OnboardingTour: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const open = useOnboardingStore((s) => s.open);
  const step = useOnboardingStore((s) => s.step);
  const start = useOnboardingStore((s) => s.start);
  const next = useOnboardingStore((s) => s.next);
  const back = useOnboardingStore((s) => s.back);
  const finish = useOnboardingStore((s) => s.finish);

  const phase = useLandingStore((s) => s.phase);
  const cloudStatus = useCloudStore((s) => s.status);
  const hasUser = useCloudStore((s) => s.user !== null);
  const nodeCount = useWorkspaceStore((s) => s.nodes.length);

  // ---- Lanzamiento automático: primera vez en un lienzo vacío -------------
  // Con sesión se espera a que el lienzo de la nube termine de cargar.
  const canvasSettled =
    cloudStatus === "disabled" ||
    cloudStatus === "signed-out" ||
    cloudStatus === "error" ||
    (hasUser && (cloudStatus === "saved" || cloudStatus === "saving")) ||
    (!hasUser && cloudStatus === "connecting" && phase === "workspace");

  useEffect(() => {
    if (phase !== "workspace" || !canvasSettled || nodeCount > 0 || open) return;
    const timer = window.setTimeout(() => {
      if (hasSeenOnboarding()) return;
      if (useWorkspaceStore.getState().nodes.length > 0) return;
      if (useLandingStore.getState().phase !== "workspace") return;
      start();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [phase, canvasSettled, nodeCount, open, start]);

  // ---- Teclado: ← → Enter / Esc, sin disparar los atajos del lienzo --------
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") return;
      e.stopPropagation();
      if (e.key === "Escape") finish("skipped");
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, next, back, finish]);

  const expert = useIsExpert();
  const index = Math.min(step, STEPS.length - 1);
  const current: TourStep = expert ? STEPS[index] : { ...STEPS[index], ...SIMPLE_OVERRIDES[index] };
  const rect = useTargetRect(current.target, open);

  if (typeof document === "undefined") return null;

  // ---- Posición del foco y de la tarjeta -----------------------------------
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardWidth = Math.min(current.target === null ? 400 : 340, vw - 24);

  const spot = rect
    ? {
        top: rect.top - SPOT_PADDING,
        left: rect.left - SPOT_PADDING,
        width: rect.width + SPOT_PADDING * 2,
        height: rect.height + SPOT_PADDING * 2,
      }
    : null;

  let cardStyle: React.CSSProperties;
  if (spot) {
    const centerX = spot.left + spot.width / 2;
    const left = Math.min(Math.max(12, centerX - cardWidth / 2), vw - cardWidth - 12);
    const targetInLowerHalf = spot.top + spot.height / 2 > vh / 2;
    cardStyle = targetInLowerHalf
      ? { left, bottom: vh - spot.top + CARD_GAP, width: cardWidth }
      : { left, top: spot.top + spot.height + CARD_GAP, width: cardWidth };
  } else {
    cardStyle = {
      left: (vw - cardWidth) / 2,
      top: Math.max(16, vh / 2 - 250),
      width: cardWidth,
      maxHeight: vh - 32,
      overflowY: "auto",
    };
  }

  const isLast = step === ONBOARDING_STEP_COUNT - 1;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="onboarding-tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[65]"
          role="dialog"
          aria-modal="true"
          aria-label={`Tutorial de Andros, paso ${step + 1} de ${ONBOARDING_STEP_COUNT}`}
        >
          {/* Fondo oscurecido: el foco recorta un hueco con una sombra gigante */}
          {spot ? (
            <motion.div
              aria-hidden="true"
              className="absolute rounded-2xl pointer-events-none ring-2 ring-andros-accent"
              initial={false}
              animate={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              style={{ boxShadow: "0 0 0 9999px rgba(5, 6, 8, 0.62)" }}
            />
          ) : (
            <div aria-hidden="true" className="absolute inset-0 bg-[rgba(5,6,8,0.62)]" />
          )}
          {/* Capa que bloquea clics al lienzo mientras dura el tutorial */}
          <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

          {/* Tarjeta del paso */}
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="absolute rounded-2xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark p-4"
            style={cardStyle}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-andros-muted">
                <span className="w-6 h-6 rounded-lg bg-andros-accent/10 text-andros-accent-ink flex items-center justify-center">
                  {current.icon}
                </span>
                Paso {step + 1} de {ONBOARDING_STEP_COUNT}
              </span>
              <button
                type="button"
                onClick={() => finish("skipped")}
                className="text-[11px] text-andros-muted hover:text-andros-primary px-2 py-1 rounded-lg hover:bg-andros-border/40 spring-micro"
              >
                Saltar tutorial
              </button>
            </div>

            <h2 className="mt-3 text-base font-semibold text-andros-primary">{current.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-andros-muted">
              {isMobile ? current.body.mobile : current.body.desktop}
            </p>

            {current.visual === "camera" && !isMobile && <CameraIllustration />}
            {current.visual === "ai" && (
              <div className="mt-3">
                <AiConnectionDiagram />
              </div>
            )}
            {current.visual === "print" && <PrintIllustration />}
            {!isMobile && current.target === "oracle" && (
              <button
                type="button"
                onClick={() => {
                  finish("skipped");
                  useShortcutsGuideStore.getState().openGuide();
                }}
                className="mt-2 text-[12px] font-medium text-andros-accent-ink hover:underline underline-offset-2"
              >
                Ver todos los atajos
              </button>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              {/* Progreso */}
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full spring-micro ${
                      i === step ? "w-5 bg-andros-accent-fill" : "w-1.5 bg-andros-border-active"
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={back}
                    aria-label="Paso anterior"
                    className="h-9 w-9 rounded-xl border border-andros-border text-andros-muted hover:text-andros-primary flex items-center justify-center active:scale-95 spring-micro"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={next}
                  autoFocus
                  className="h-9 px-4 rounded-xl bg-andros-primary text-andros-canvas text-[13px] font-semibold flex items-center gap-1.5 hover:opacity-90 active:scale-95 spring-micro"
                >
                  {isLast ? "¡Empezar!" : "Siguiente"}
                  {!isLast && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
