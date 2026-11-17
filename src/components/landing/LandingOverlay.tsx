"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, useAnimate, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { MutantAndrosLogo } from "./MutantAndrosLogo";
import { BlackHoleCanvas } from "./BlackHoleCanvas";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { GoogleGlyph } from "@/components/auth/GoogleAuthButton";
import { signInWithGoogle } from "@/hooks/useCloudSync";
import { useCloudStore } from "@/store/useCloudStore";
import { useLandingStore } from "@/store/useLandingStore";

// ============================================================================
// ANDROS — LANDING EDITORIAL (Swiss / aeroespacial)
//   Agujero negro procedural de fondo + logo mutante como punto focal.
//
//   Entrada:
//   · Botón principal "Continuar con Google" → login OAuth de Supabase.
//     Al volver con sesión, la portada se cierra sola y abre su lienzo.
//   · "Explorar primero sin cuenta" (discreto) → las letras se alinean y
//     vuelan hasta el "Andros" de la barra superior y la portada se
//     desvanece revelando el lienzo en modo local.
//   · Sin claves de Supabase (modo local) el botón principal entra directo.
// ============================================================================

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const EASE = [0.16, 1, 0.3, 1] as const;

/** Posición de la singularidad (fracciones de pantalla) según el dispositivo. */
const HOLE_DESKTOP = { x: 0.73, y: 0.47, r: 0.058 };
const HOLE_MOBILE = { x: 0.5, y: 0.25, r: 0.075 };

const INDEX_ITEMS = [
  { id: "01", label: "STL/3MF Viewer & Guided Print" },
  { id: "02", label: "Freehand Ink & CAD Camera" },
  { id: "03", label: "Semantic Oracle + CodeLab" },
];

// ---------------------------------------------------------------------------
// Botón principal con resorte táctil
// ---------------------------------------------------------------------------

interface SpringButtonProps {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}

const SpringButton: React.FC<SpringButtonProps> = ({ onClick, disabled, children }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const springCfg = { stiffness: 260, damping: 16, mass: 0.4 };
  const x = useSpring(0, springCfg);
  const y = useSpring(0, springCfg);
  const innerX = useTransform(x, (v) => v * 0.4);
  const innerY = useTransform(y, (v) => v * 0.4);

  const handleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "mouse") return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set((e.clientX - (rect.left + rect.width / 2)) * 0.22);
    y.set((e.clientY - (rect.top + rect.height / 2)) * 0.35);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      style={{ x, y }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 420, damping: 18 }}
      className="group h-12 pl-3.5 pr-5 rounded-lg bg-andros-primary text-andros-canvas text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-andros-accent/60 disabled:cursor-default"
    >
      <motion.span style={{ x: innerX, y: innerY }} className="flex items-center gap-3">
        {children}
      </motion.span>
    </motion.button>
  );
};

// ---------------------------------------------------------------------------
// Overlay principal
// ---------------------------------------------------------------------------

interface LandingOverlayProps {
  isMobile: boolean;
}

export const LandingOverlay: React.FC<LandingOverlayProps> = ({ isMobile }) => {
  const phase = useLandingStore((s) => s.phase);
  const manual = useLandingStore((s) => s.manual);
  const startIgnition = useLandingStore((s) => s.startIgnition);
  const finishIgnition = useLandingStore((s) => s.finishIgnition);
  const skipToWorkspace = useLandingStore((s) => s.skipToWorkspace);
  const cloudStatus = useCloudStore((s) => s.status);
  const user = useCloudStore((s) => s.user);
  const cloudError = useCloudStore((s) => s.errorMessage);
  const clearCloudError = useCloudStore((s) => s.clearError);
  const reduceMotion = useReducedMotion() ?? false;

  // Con sesión de Google ya activa (o al volver del login) se entra directo al lienzo.
  useEffect(() => {
    if (user && !manual && useLandingStore.getState().phase === "landing") skipToWorkspace();
  }, [user, manual, skipToWorkspace]);

  const cloudDisabled = cloudStatus === "disabled";
  const checkingSession = cloudStatus === "connecting" && !user;

  const [shuffleSignal, setShuffleSignal] = useState(0);
  const [logoScope, animateLogo] = useAnimate<HTMLDivElement>();
  const markRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const igniting = phase === "igniting";
  const hole = isMobile ? HOLE_MOBILE : HOLE_DESKTOP;

  // Telemetría real: FPS medidos por el shader (sin re-renderizar React).
  const handleFps = useCallback((fps: number) => {
    if (fpsRef.current) fpsRef.current.textContent = String(Math.min(fps, 999));
  }, []);

  // Mientras la portada está abierta, los atajos del lienzo (L, M, B…) no se disparan.
  useEffect(() => {
    const guard = (e: KeyboardEvent) => {
      const insideOverlay = rootRef.current?.contains(e.target as Node) ?? false;
      const navigationKey = e.key === "Tab" || e.key === "Enter" || e.key === " ";
      if (insideOverlay && navigationKey) return; // lo frena onKeyDown de abajo
      e.stopPropagation();
    };
    window.addEventListener("keydown", guard, true);
    return () => window.removeEventListener("keydown", guard, true);
  }, []);

  // ---- Transición de ignición -------------------------------------------
  const handleStart = useCallback(async () => {
    if (useLandingStore.getState().phase !== "landing") return;
    startIgnition();

    // 1) Las letras se alinean en el logo limpio.
    await wait(reduceMotion ? 80 : 520);

    const flight = reduceMotion
      ? { duration: 0.2 }
      : { type: "spring" as const, stiffness: 85, damping: 15, mass: 0.9, restDelta: 0.001 };
    const flights: Promise<unknown>[] = [];

    // 2a) Las letras viajan hasta el "Andros" de la barra superior.
    const logo = logoScope.current;
    const wordmark = document.querySelector<HTMLElement>("[data-andros-wordmark]");
    // En pantallas estrechas el "Andros" de la barra está oculto: solo se desvanece.
    if (logo && wordmark && wordmark.getClientRects().length > 0) {
      const s = logo.getBoundingClientRect();
      const t = wordmark.getBoundingClientRect();
      const sourceSize = parseFloat(getComputedStyle(logo).fontSize) || 1;
      const targetSize = parseFloat(getComputedStyle(wordmark).fontSize) || 12;
      flights.push(
        animateLogo(
          logo,
          {
            x: t.left - s.left,
            y: t.top + t.height / 2 - (s.top + s.height / 2),
            scale: targetSize / sourceSize,
          },
          flight,
        ).finished,
      );
    }

    // 2b) La marca de doble chevrón se acopla a la de la barra superior.
    const mark = markRef.current;
    const markTarget = document.querySelector<HTMLElement>("[data-andros-mark]");
    if (mark && markTarget) {
      const s = mark.getBoundingClientRect();
      const t = markTarget.getBoundingClientRect();
      flights.push(
        animateLogo(
          mark,
          { x: t.left - s.left, y: t.top - s.top, scale: t.width / Math.max(s.width, 1) },
          flight,
        ).finished,
      );
    }

    await Promise.all(flights);
    finishIgnition();
  }, [animateLogo, finishIgnition, logoScope, reduceMotion, startIgnition]);

  const fadeOut = {
    opacity: igniting ? 0 : 1,
    transition: { duration: 0.3, ease: EASE },
  };

  return (
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Andros"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`fixed inset-0 z-[60] overflow-x-hidden ${
        igniting ? "pointer-events-none overflow-y-hidden" : "overflow-y-auto"
      }`}
    >
      {/* ---- Fondo: agujero negro procedural (se desvanece al final) ---- */}
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-andros-canvas"
        animate={{ opacity: igniting ? 0 : 1 }}
        transition={{ duration: 0.8, delay: igniting ? 0.3 : 0, ease: "easeInOut" }}
      >
        <BlackHoleCanvas centerX={hole.x} centerY={hole.y} radius={hole.r} onFps={handleFps} />

        {/* Pie de figura técnico junto a la singularidad (solo escritorio) */}
        {!isMobile && (
          <div
            className="absolute whitespace-nowrap font-mono text-[10px] leading-relaxed tracking-wider text-andros-muted"
            style={{
              left: `min(calc(${hole.x * 100}% + 0.26 * min(100vw, 100vh)), calc(100% - 20rem))`,
              top: `calc(${hole.y * 100}% + 0.3 * min(100vw, 100vh))`,
            }}
          >
            <p className="text-andros-primary">FIG. 01 — SCHWARZSCHILD SINGULARITY</p>
            <p>LENSED ACCRETION DISK · i = 82.5°</p>
            <p>PHOTON SPHERE r = 1.5 r_s</p>
          </div>
        )}
      </motion.div>

      <div className="relative min-h-full flex flex-col px-4 md:px-10">
        {/* ---- Barra superior ---- */}
        <header className="flex items-center justify-between gap-4 pt-3 md:pt-5">
          <div className="flex items-center gap-3 md:gap-4 min-w-0">
            {/* Esta marca vuela a la barra superior del lienzo al entrar */}
            <span ref={markRef} className="block w-7 h-7 shrink-0" style={{ transformOrigin: "0 0" }}>
              <AndrosMark className="w-7 h-7" title="Andros" />
            </span>
            <motion.span
              animate={fadeOut}
              className="font-mono text-[10px] md:text-[11px] tracking-[0.14em] text-andros-muted whitespace-nowrap"
            >
              EVENT.HORIZON // <span ref={fpsRef}>60</span>FPS
            </motion.span>
          </div>
          <motion.div animate={fadeOut} className="flex items-center gap-2">
            <ThemeToggle />
          </motion.div>
        </header>

        {/* ---- Punto focal ---- */}
        <main className="flex-1 flex flex-col justify-end md:justify-center pt-[40vh] md:pt-0 pb-8 md:pb-10">
          <div className="max-w-[44rem]">
            <motion.div
              animate={fadeOut}
              className="flex items-center gap-3 font-mono text-[10px] md:text-[11px] tracking-[0.18em] text-andros-muted"
            >
              <span className="text-andros-accent">§ 00</span>
              <span className="h-px w-10 bg-andros-border-active" />
              <span>SPATIAL WORKSPACE · REV 3.0</span>
            </motion.div>

            <div className="mt-4 md:mt-6 -ml-1">
              <MutantAndrosLogo
                ref={logoScope}
                shuffleSignal={shuffleSignal}
                clean={igniting}
                fontSize="clamp(3.5rem, 9.5vw, 8.25rem)"
              />
            </div>

            <motion.div animate={fadeOut}>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] md:text-[11px] tracking-[0.12em] text-andros-muted">
                <span>{isMobile ? "TAP A LETTER TO LOCK IT" : "HOVER TO MUTATE · CLICK TO LOCK"}</span>
                <button
                  type="button"
                  onClick={() => setShuffleSignal((n) => n + 1)}
                  className="uppercase text-andros-primary/80 hover:text-andros-accent underline decoration-andros-border-active underline-offset-4 hover:decoration-andros-accent transition-colors"
                >
                  Shuffle Typographic DNA
                </button>
              </div>

              <p className="mt-8 md:mt-10 max-w-md text-base md:text-lg leading-snug text-andros-primary">
                Tu lienzo infinito para piezas 3D, cálculos e investigación con IA. Sube una
                pieza, dibuja tu idea e imprímela en 1 clic.
              </p>

              <div className="mt-7 flex flex-col items-start gap-3">
                {user || cloudDisabled ? (
                  /* Ya hay sesión (portada abierta desde el logo) o modo local sin nube */
                  <SpringButton onClick={() => void handleStart()} disabled={igniting}>
                    <AndrosMark className="w-5 h-5" tone="inverse" />
                    <span>{user ? "Ir a mi espacio" : "Entrar al espacio de trabajo"}</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </SpringButton>
                ) : (
                  <SpringButton
                    onClick={() => {
                      clearCloudError();
                      void signInWithGoogle();
                    }}
                    disabled={igniting || checkingSession}
                  >
                    {checkingSession ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center">
                        <GoogleGlyph className="w-4 h-4" />
                      </span>
                    )}
                    <span>{checkingSession ? "Conectando…" : "Continuar con Google"}</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </SpringButton>
                )}

                {!user && !cloudDisabled && (
                  <button
                    type="button"
                    onClick={() => void handleStart()}
                    disabled={igniting}
                    className="text-xs text-andros-muted hover:text-andros-primary underline decoration-andros-border-active underline-offset-4 hover:decoration-andros-primary transition-colors"
                  >
                    Explorar primero sin cuenta
                  </button>
                )}

                {cloudError && !user && (
                  <p role="alert" className="max-w-sm text-xs leading-relaxed text-andros-accent">
                    {cloudError}
                  </p>
                )}
              </div>
            </motion.div>
          </div>
        </main>

        {/* ---- Franja de telemetría inferior ---- */}
        <motion.footer
          animate={fadeOut}
          className="pb-4 md:pb-6 grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3"
        >
          {INDEX_ITEMS.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-3 py-2.5 border border-andros-border bg-andros-canvas/85 font-mono text-[10px] md:text-[11px] tracking-[0.08em] text-andros-muted"
            >
              <span className="text-andros-accent">[{item.id}]</span>
              <span className="text-andros-primary">{item.label}</span>
            </div>
          ))}
        </motion.footer>
      </div>
    </motion.div>
  );
};
