"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useAnimate, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Loader2, Shuffle } from "lucide-react";
import { MutantAndrosLogo } from "./MutantAndrosLogo";
import { BlackHoleCanvas } from "./BlackHoleCanvas";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { GoogleGlyph } from "@/components/auth/GoogleAuthButton";
import { signInWithGoogle } from "@/hooks/useCloudSync";
import { useCloudStore } from "@/store/useCloudStore";
import { useLandingStore } from "@/store/useLandingStore";
import { SiteFooter } from "@/components/legal/SiteFooter";

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

/** Lo que hace Andros hoy (funciones reales, sin promesas). */
const FEATURES = [
  { id: "01", label: "Visor STL/3MF e impresión guiada" },
  { id: "02", label: "Tinta a mano alzada y cámara CAD" },
  { id: "03", label: "Oráculo IA, CodeLab y fuentes citables" },
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
  const springCfg = { stiffness: 450, damping: 32, mass: 0.8 };
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
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 450, damping: 32, mass: 0.8 }}
      className="group w-full md:w-auto h-12 pl-3.5 pr-5 rounded-xl bg-andros-primary text-andros-canvas text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-andros-accent/60 disabled:cursor-default"
    >
      <motion.span style={{ x: innerX, y: innerY }} className="flex items-center justify-center md:justify-start gap-3">
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
  const authNotice = useCloudStore((s) => s.authNotice);
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
  const rootRef = useRef<HTMLDivElement>(null);
  const igniting = phase === "igniting";
  const hole = isMobile ? HOLE_MOBILE : HOLE_DESKTOP;

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
      aria-labelledby="andros-landing-title"
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
        <BlackHoleCanvas centerX={hole.x} centerY={hole.y} radius={hole.r} />
      </motion.div>

      <div className="relative min-h-full flex flex-col px-4 md:px-10">
        {/* ---- Barra superior ---- */}
        <header className="flex items-center justify-between gap-4 pt-3 md:pt-5">
          <div className="flex items-center gap-3 md:gap-4 min-w-0">
            {/* Esta marca vuela a la barra superior del lienzo al entrar */}
            <span ref={markRef} className="block w-7 h-7 shrink-0" style={{ transformOrigin: "0 0" }}>
              <AndrosMark className="w-7 h-7" title="Andros" />
            </span>
          </div>
          <motion.div animate={fadeOut} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShuffleSignal((n) => n + 1)}
              aria-label="Mezclar las tipografías del logo"
              title="Mezclar tipografías"
              className="w-11 h-11 md:w-9 md:h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro flex items-center justify-center"
            >
              <Shuffle className="w-4 h-4" aria-hidden="true" />
            </button>
            <ThemeToggle />
          </motion.div>
        </header>

        {/* ---- Punto focal ---- */}
        <main className="flex-1 flex flex-col justify-end md:justify-center pt-[34vh] md:pt-0 pb-6 md:pb-10">
          <div className="max-w-[44rem]">
            <div className="-ml-1">
              <MutantAndrosLogo
                ref={logoScope}
                shuffleSignal={shuffleSignal}
                clean={igniting}
                fontSize="clamp(3.5rem, 9.5vw, 8.25rem)"
              />
            </div>

            <motion.div animate={fadeOut}>
              <h1
                id="andros-landing-title"
                className="mt-5 md:mt-6 max-w-[22ch] text-2xl md:text-[2rem] font-semibold leading-tight tracking-tight text-andros-primary"
              >
                Organiza tu evento o tu equipo en tiempo real, con IA.
              </h1>
              <p className="mt-3 max-w-md text-sm md:text-base leading-relaxed text-andros-muted">
                Sin el caos de WhatsApp ni hojas de cálculo imposibles en el celular: tarjetas,
                cables y un Oráculo IA que ordena todo mientras tu equipo lo ve al instante. Gratis,
                sin instalar nada.
              </p>

              {/* CTA: en el teléfono se queda pegado abajo mientras se desplaza la portada */}
              <div className="mt-7 flex flex-col items-stretch md:items-start gap-3 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:px-4 max-md:pt-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:bg-andros-canvas/90 max-md:backdrop-blur-md">
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
                    className="min-h-[44px] md:min-h-0 text-xs text-andros-muted hover:text-andros-primary underline decoration-andros-border-active underline-offset-4 hover:decoration-andros-primary transition-colors"
                  >
                    Explorar primero sin cuenta
                  </button>
                )}

                {!user && !cloudDisabled && (
                  <p className="max-w-sm text-[11px] leading-relaxed text-andros-muted">
                    Al continuar aceptas los{" "}
                    <Link href="/terminos" className="underline underline-offset-2 hover:text-andros-primary">
                      Términos
                    </Link>{" "}
                    y la{" "}
                    <Link href="/privacidad" className="underline underline-offset-2 hover:text-andros-primary">
                      Política de Privacidad
                    </Link>
                    .
                  </p>
                )}

                {cloudError && !user && (
                  <p role="alert" className="max-w-sm text-xs leading-relaxed text-andros-danger">
                    {cloudError}
                  </p>
                )}
                {authNotice && !cloudError && !user && (
                  <p role="status" className="max-w-sm text-xs leading-relaxed text-andros-muted">
                    {authNotice}
                  </p>
                )}
              </div>
            </motion.div>
          </div>
        </main>

        {/* ---- Qué incluye + enlaces legales ---- */}
        <motion.div animate={fadeOut} className="pb-4 md:pb-6 space-y-3">
          <ul aria-label="Qué incluye Andros" className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
            {FEATURES.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-andros-border bg-andros-canvas/85 text-xs text-andros-primary"
              >
                <span className="font-mono tabular-nums text-andros-accent-ink" aria-hidden="true">
                  {item.id}
                </span>
                {item.label}
              </li>
            ))}
          </ul>
          <SiteFooter compact />
        </motion.div>
      </div>
    </motion.div>
  );
};
