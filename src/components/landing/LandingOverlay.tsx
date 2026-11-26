"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useAnimate, useReducedMotion, useSpring, useTransform } from "framer-motion";
import {
  ArrowRight,
  BookOpenCheck,
  Briefcase,
  Check,
  Cpu,
  Loader2,
  Mic,
  Minus,
  Monitor,
  MousePointer2,
  Shuffle,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { MutantAndrosLogo } from "./MutantAndrosLogo";
import { BlackHoleCanvas } from "./BlackHoleCanvas";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { GoogleGlyph } from "@/components/auth/GoogleAuthButton";
import { signInWithGoogle } from "@/hooks/useCloudSync";
import { useCloudStore } from "@/store/useCloudStore";
import { useLandingStore } from "@/store/useLandingStore";
import { useMarketStore } from "@/store/useMarketStore";
import { SiteFooter } from "@/components/legal/SiteFooter";
import { FREE_PLAN, PLAN_COMPARISON, PRO_PLAN } from "@/lib/plans";
import { startProCheckout } from "@/lib/billing/subscriptionClient";

// ============================================================================
// ANDROS — LANDING EDITORIAL (Swiss / manual técnico)
//   Agujero negro procedural de fondo + logo mutante como punto focal.
//
//   Recorrido:
//   · Hero: qué problema resuelve y dos acciones («Empezar gratis» / «Ver planes»).
//   · 01 Poderes: Oráculo IA, coordinación en vivo con voz y Motor Anti-Malentendidos.
//   · 02 Propósito: contribución sobria a los ODS 4, 8 y 9.
//   · 03 Planes: Plan Básico $0 vs. Andros Pro $5.99/mes ($49.99/año), fila a fila.
//
//   Entrada:
//   · «Empezar gratis» → login OAuth de Supabase con Google. Al volver con
//     sesión, la portada se cierra sola y abre su lienzo.
//   · «Explorar primero sin cuenta» (discreto) → las letras se alinean y
//     vuelan hasta el "Andros" de la barra superior y la portada se
//     desvanece revelando el lienzo en modo local.
//   · Sin claves de Supabase (modo local) el botón principal entra directo.
// ============================================================================

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const EASE = [0.16, 1, 0.3, 1] as const;

/** Posición de la singularidad (fracciones de pantalla) según el dispositivo. */
const HOLE_DESKTOP = { x: 0.73, y: 0.47, r: 0.058 };
const HOLE_MOBILE = { x: 0.5, y: 0.25, r: 0.075 };

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

const SECONDARY_BUTTON =
  "w-full md:w-auto h-12 px-5 rounded-xl border border-andros-border-active bg-andros-canvas/70 backdrop-blur-md text-sm font-semibold text-andros-primary hover:border-andros-primary active:scale-[0.96] spring-micro flex items-center justify-center gap-2";

// ---------------------------------------------------------------------------
// Piezas editoriales (retícula suiza: índice · regla · titular)
// ---------------------------------------------------------------------------

const SectionHeading: React.FC<{ index: string; kicker: string; title: string; id: string; lead?: string }> = ({
  index,
  kicker,
  title,
  id,
  lead,
}) => (
  <header className="grid gap-3 md:grid-cols-[10rem_1fr] md:gap-10 pb-8 md:pb-10">
    <p className="flex items-baseline gap-3 text-xs text-andros-muted">
      <span className="font-mono tabular-nums text-andros-accent-ink" aria-hidden="true">
        {index}
      </span>
      <span className="uppercase tracking-[0.14em]">{kicker}</span>
    </p>
    <div>
      <h2 id={id} className="max-w-[24ch] text-2xl md:text-[2.125rem] font-semibold leading-tight tracking-tight text-andros-primary">
        {title}
      </h2>
      {lead && <p className="mt-3 max-w-2xl text-sm md:text-base leading-relaxed text-andros-muted">{lead}</p>}
    </div>
  </header>
);

/** Etiqueta discreta para los diagramas con datos de muestra. */
const ExampleTag: React.FC = () => (
  <span className="text-[10px] uppercase tracking-[0.14em] text-andros-muted">ejemplo</span>
);

/** Poder 1 — una frase se convierte en 5 tarjetas conectadas. */
const OracleDiagram: React.FC = () => (
  <figure aria-hidden="true" className="space-y-3">
    <div className="flex items-center justify-between">
      <ExampleTag />
    </div>
    <p className="px-3 py-2.5 rounded-lg border border-andros-border bg-andros-card text-[13px] text-andros-primary">
      «Feria de ciencias para 120 estudiantes el 14 de marzo»
    </p>
    <div className="flex justify-center text-andros-muted">
      <ArrowRight className="w-4 h-4 rotate-90" />
    </div>
    <div className="grid grid-cols-3 gap-1.5">
      {["Resumen", "Cronograma", "Presupuesto", "Logística", "Roles"].map((label, i) => (
        <span
          key={label}
          className={`px-2 py-1.5 rounded-md border text-[11px] text-center truncate ${
            i === 0 ? "border-andros-accent text-andros-accent-ink" : "border-andros-border text-andros-primary"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  </figure>
);

/** Poder 2 — PC y teléfono sobre el mismo tablero, con voz. */
const LiveDiagram: React.FC = () => (
  <figure aria-hidden="true" className="space-y-3">
    <ExampleTag />
    <div className="flex items-center gap-3">
      <div className="flex-1 h-24 rounded-lg border border-andros-border bg-andros-card relative">
        <Monitor className="absolute left-2.5 top-2.5 w-4 h-4 text-andros-muted" />
        <span className="absolute left-8 top-9 w-16 h-6 rounded border border-andros-border" />
        <MousePointer2 className="absolute left-[4.75rem] top-[3.25rem] w-4 h-4 text-andros-accent-ink" />
      </div>
      <div className="flex flex-col items-center gap-1 text-andros-muted">
        <Mic className="w-4 h-4 text-andros-success" />
        <span className="w-8 h-px bg-andros-border-active" />
      </div>
      <div className="w-14 h-24 rounded-lg border border-andros-border bg-andros-card relative">
        <Smartphone className="absolute left-1/2 -translate-x-1/2 top-2.5 w-4 h-4 text-andros-muted" />
        <span className="absolute left-2 right-2 top-9 h-3 rounded-sm border border-andros-border" />
        <span className="absolute left-2 right-2 top-14 h-3 rounded-sm border border-andros-accent" />
      </div>
    </div>
  </figure>
);

/** Poder 3 — un dato cambia y la tarjeta conectada queda marcada. */
const ImpactDiagram: React.FC = () => (
  <figure aria-hidden="true" className="space-y-3">
    <ExampleTag />
    <div className="px-3 py-2.5 rounded-lg border border-andros-border bg-andros-card text-[13px] text-andros-primary">
      Asistentes: <span className="line-through text-andros-muted">120</span> → 150
    </div>
    <div className="flex justify-center text-andros-muted">
      <ArrowRight className="w-4 h-4 rotate-90" />
    </div>
    <div className="px-3 py-2.5 rounded-lg border border-andros-warning/50 bg-andros-card text-[12px] leading-snug text-andros-primary flex gap-2">
      <TriangleAlert className="w-4 h-4 shrink-0 text-andros-warning" />
      <span>El presupuesto de comida sigue calculado para 120 personas. Avisar a: Finanzas.</span>
    </div>
  </figure>
);

const POWERS = [
  {
    id: "01",
    title: "De 1 frase a un plan completo",
    body: "Escribe qué quieres organizar y el Oráculo IA arma el tablero: resumen, cronograma, presupuesto con totales, logística y roles, ya conectados entre sí.",
    diagram: <OracleDiagram />,
  },
  {
    id: "02",
    title: "Coordinación en tiempo real, con voz",
    body: "Todo el equipo ve y edita el mismo tablero al instante, desde la computadora o el celular, con canal de voz, cámara y pantalla compartida. Sin instalar nada.",
    diagram: <LiveDiagram />,
  },
  {
    id: "03",
    title: "Motor Anti-Malentendidos",
    body: "Cuando alguien cambia una cifra, una fecha o un acuerdo, Andros revisa las tarjetas conectadas y avisa qué se descuadró y a quién conviene avisar.",
    diagram: <ImpactDiagram />,
  },
];

const GOALS = [
  {
    number: "4",
    name: "Educación de calidad",
    icon: <BookOpenCheck className="w-4 h-4" aria-hidden="true" />,
    body: "Acerca conocimiento científico abierto (bases de datos académicas de acceso libre) con citas listas para usar, y un Oráculo que guía paso a paso a quien no tiene formación técnica.",
  },
  {
    number: "8",
    name: "Trabajo decente y crecimiento económico",
    icon: <Briefcase className="w-4 h-4" aria-hidden="true" />,
    body: "Reduce el estrés, los malentendidos y las horas perdidas en asociaciones, emprendimientos y equipos pequeños que se coordinan a fuerza de mensajes.",
  },
  {
    number: "9",
    name: "Industria, innovación e infraestructura",
    icon: <Cpu className="w-4 h-4" aria-hidden="true" />,
    body: "Lleva organización visual, hojas de cálculo, CodeLab y prototipado 3D a cualquier navegador o teléfono, sin licencias costosas ni equipos especiales.",
  },
];

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
    // Si se pulsa desde más abajo (planes), el logo vuelve a la vista antes de volar.
    rootRef.current?.scrollTo({ top: 0 });
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

  /** «Empezar gratis»: con sesión o sin nube entra directo; si no, login con Google. */
  const startFree = () => {
    if (user || cloudDisabled) {
      void handleStart();
      return;
    }
    clearCloudError();
    void signInWithGoogle();
  };

  const showPlans = () => {
    document
      .getElementById("andros-planes")
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  // (Sprint 21) «Pasar a Pro»: sin sesión primero se entra con Google; con la
  // pasarela sin configurar (503) se explica y se ofrece el aviso por correo.
  const [proNotice, setProNotice] = useState<string | null>(null);
  const [proBusy, setProBusy] = useState(false);
  const requestPro = async () => {
    if (proBusy) return;
    setProNotice(null);
    if (!user && !cloudDisabled) {
      clearCloudError();
      void signInWithGoogle();
      return;
    }
    setProBusy(true);
    try {
      const result = await startProCheckout("monthly");
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return;
      }
      setProNotice(result.message);
      if (result.status === "unavailable") useMarketStore.getState().setWaitlistOpen(true);
    } finally {
      setProBusy(false);
    }
  };

  const fadeOut = {
    opacity: igniting ? 0 : 1,
    transition: { duration: 0.3, ease: EASE },
  };

  const primaryLabel = user ? "Ir a mi espacio" : checkingSession ? "Conectando…" : "Empezar gratis";

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

      <div className="relative min-h-[100svh] flex flex-col px-4 md:px-10">
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

        {/* ---- Hero ---- */}
        <main className="flex-1 flex flex-col justify-end md:justify-center pt-[30vh] md:pt-0 pb-6 md:pb-12">
          <div className="max-w-[46rem]">
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
                Organiza tu evento o tu equipo en un solo tablero en vivo.
              </h1>
              <p className="mt-3 max-w-lg text-sm md:text-base leading-relaxed text-andros-muted">
                Cambia los chats infinitos y las hojas de cálculo incómodas en el celular por un
                tablero en vivo: tarjetas, cables y un Oráculo IA que arma el plan mientras tu
                equipo lo ve al instante. Sin instalar nada.
              </p>

              {/* CTA: en el teléfono se queda pegado abajo mientras se desplaza el hero */}
              <div className="mt-7 flex flex-col items-stretch md:items-start gap-3 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:px-4 max-md:pt-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:bg-andros-canvas/90 max-md:backdrop-blur-md">
                <div className="flex flex-col md:flex-row gap-2.5">
                  <SpringButton onClick={startFree} disabled={igniting || checkingSession}>
                    {user || cloudDisabled ? (
                      <AndrosMark className="w-5 h-5" tone="inverse" />
                    ) : checkingSession ? (
                      <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center">
                        <GoogleGlyph className="w-4 h-4" />
                      </span>
                    )}
                    <span>{primaryLabel}</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </SpringButton>

                  <button type="button" onClick={showPlans} disabled={igniting} className={SECONDARY_BUTTON}>
                    Ver planes
                  </button>
                </div>

                {!user && !cloudDisabled && (
                  <p className="text-[11px] leading-relaxed text-andros-muted">
                    {/* brand-ok: método de acceso real del botón (OAuth con la cuenta propia) */}
                    Con tu cuenta de Google, sin tarjeta.{" "}
                    <button
                      type="button"
                      onClick={() => void handleStart()}
                      disabled={igniting}
                      className="min-h-[44px] md:min-h-0 text-andros-muted hover:text-andros-primary underline decoration-andros-border-active underline-offset-4 hover:decoration-andros-primary transition-colors"
                    >
                      Explorar primero sin cuenta
                    </button>
                  </p>
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
      </div>

      {/* ---- Narrativa editorial (fondo sólido para leer sobre el agujero negro) ---- */}
      <motion.div animate={fadeOut} className="relative bg-andros-canvas border-t border-andros-border">
        <div className="mx-auto max-w-6xl px-4 md:px-10">
          {/* 01 · Poderes */}
          <section aria-labelledby="andros-poderes" className="py-14 md:py-20">
            <SectionHeading
              index="01"
              kicker="Poderes"
              id="andros-poderes"
              title="Tres cosas que un chat y una hoja de cálculo no hacen."
            />
            <ol className="grid md:grid-cols-3 border-t border-andros-border md:divide-x divide-andros-border">
              {POWERS.map((power) => (
                <li key={power.id} className="py-6 md:py-8 md:px-6 first:md:pl-0 last:md:pr-0 max-md:border-b max-md:border-andros-border flex flex-col gap-5">
                  <div>
                    <p className="font-mono tabular-nums text-xs text-andros-accent-ink" aria-hidden="true">
                      {power.id}
                    </p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-andros-primary">{power.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-andros-muted">{power.body}</p>
                  </div>
                  <div className="mt-auto">{power.diagram}</div>
                </li>
              ))}
            </ol>
          </section>

          {/* 02 · Propósito (ODS 4, 8 y 9) */}
          <section aria-labelledby="andros-ods" className="py-14 md:py-20 border-t border-andros-border">
            <SectionHeading
              index="02"
              kicker="Propósito"
              id="andros-ods"
              title="Diseñado para mejorar cómo colabora la humanidad."
              lead="Andros nace para que cualquier persona, con o sin formación técnica, pueda organizarse con claridad. Usamos tres Objetivos de Desarrollo Sostenible como brújula para decidir qué construir."
            />
            <ul className="border-t border-andros-border divide-y divide-andros-border">
              {GOALS.map((goal) => (
                <li key={goal.number} className="py-6 md:py-7 grid gap-3 md:grid-cols-[10rem_16rem_1fr] md:gap-10 items-baseline">
                  <p className="flex items-baseline gap-2 text-andros-primary">
                    <span className="text-xs uppercase tracking-[0.14em] text-andros-muted">ODS</span>
                    <span className="text-4xl md:text-5xl font-semibold leading-none tracking-tight">{goal.number}</span>
                  </p>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-andros-primary">
                    <span className="text-andros-accent-ink">{goal.icon}</span>
                    {goal.name}
                  </h3>
                  <p className="max-w-xl text-sm leading-relaxed text-andros-muted">{goal.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-2xl text-[11px] leading-relaxed text-andros-muted">
              Los Objetivos de Desarrollo Sostenible son una agenda de las Naciones Unidas. Andros no
              está afiliado ni respaldado por la ONU: los usamos como marco de referencia.
            </p>
          </section>

          {/* 03 · Planes */}
          <section id="andros-planes" aria-labelledby="andros-planes-title" className="py-14 md:py-20 border-t border-andros-border scroll-mt-4">
            <SectionHeading
              index="03"
              kicker="Planes"
              id="andros-planes-title"
              title="Precios claros. Empieza gratis, sin tarjeta."
              lead="El Plan Básico es gratis para siempre. Andros Pro se paga al mes o al año, con impuestos calculados por nuestro proveedor de pagos, y se cancela cuando quieras: conservas Pro hasta el final del periodo pagado."
            />

            <div className="border-t border-andros-border">
              {/* Cabecera de columnas */}
              <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 md:gap-x-10 py-6">
                <span className="hidden md:block" />
                {[FREE_PLAN, PRO_PLAN].map((plan) => {
                  const pro = plan.id === "pro";
                  return (
                    <div key={plan.id} className={`flex flex-col gap-3 ${pro ? "md:pl-6 md:border-l md:border-andros-accent" : ""}`}>
                      <div>
                        <h3 className="text-sm font-semibold text-andros-primary">{plan.name}</h3>
                        <p className="mt-1 text-andros-primary">
                          <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>{" "}
                          <span className="text-xs text-andros-muted">{plan.period}</span>
                        </p>
                        {plan.altPrice && <p className="text-xs text-andros-muted">{plan.altPrice}</p>}
                        <p className="mt-1 text-xs text-andros-muted">{plan.tagline}</p>
                      </div>
                      {pro ? (
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => void requestPro()}
                            disabled={igniting || proBusy}
                            className="h-11 px-4 rounded-xl bg-andros-accent-fill text-white text-sm font-semibold hover:opacity-90 active:scale-[0.96] spring-micro disabled:opacity-50"
                          >
                            {proBusy ? "Abriendo el pago…" : "Pasar a Pro"}
                          </button>
                          {proNotice && (
                            <p role="status" className="text-xs leading-relaxed text-andros-primary">
                              {proNotice}
                            </p>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={startFree}
                          disabled={igniting || checkingSession}
                          className="h-11 px-4 rounded-xl border border-andros-border-active text-sm font-semibold text-andros-primary hover:border-andros-primary active:scale-[0.96] spring-micro"
                        >
                          {user ? "Ir a mi espacio" : "Empezar gratis"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Comparación fila a fila */}
              <dl className="border-t border-andros-border divide-y divide-andros-border">
                {PLAN_COMPARISON.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 md:gap-x-10 gap-y-1.5 py-3.5 text-sm"
                  >
                    <dt className="col-span-2 md:col-span-1 text-xs md:text-sm font-medium text-andros-muted md:text-andros-primary">
                      {row.label}
                    </dt>
                    <dd className="text-andros-primary">
                      <span className="sr-only">{FREE_PLAN.name}: </span>
                      {row.free ?? (
                        <span className="inline-flex items-center gap-1.5 text-andros-muted">
                          <Minus className="w-4 h-4" aria-hidden="true" />
                          No incluido
                        </span>
                      )}
                    </dd>
                    <dd className="text-andros-primary md:pl-6 flex items-start gap-1.5">
                      <span className="sr-only">{PRO_PLAN.name}: </span>
                      <Check className="w-4 h-4 mt-0.5 shrink-0 text-andros-success" aria-hidden="true" />
                      <span>{row.pro}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        </div>

        {/* ---- Enlaces legales ---- */}
        <div className="border-t border-andros-border px-4 md:px-10 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-6xl flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
            <p className="flex items-center gap-2 text-xs text-andros-muted">
              <AndrosMark className="w-4 h-4" />
              Andros
            </p>
            <SiteFooter compact />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
