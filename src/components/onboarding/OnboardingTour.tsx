"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlarmClock, ArrowLeft, ArrowRight, LayoutTemplate, MessagesSquare, Network, Wand2 } from "lucide-react";
import { hasSeenOnboarding, ONBOARDING_STEP_COUNT, useOnboardingStore } from "@/store/useOnboardingStore";
import { shouldAutoStartTutorial } from "@/lib/onboarding/tutorialState";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLandingStore } from "@/store/useLandingStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useSocialStore } from "@/store/useSocialStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useIsExpert, useSettingsStore } from "@/store/useSettingsStore";
import { springOrInstant } from "@/lib/motion";

// ============================================================================
// ANDROS — TUTORIAL DE INICIO DE 5 PASOS (Spotlight) — Sprint 24
//   1. Tu espacio de trabajo         → tarjeta centrada (Coordinación → @Área → Ficha)
//   2. Plantillas listas para usar   → botón «+ Agregar» (Librería de fichas)
//   3. Llenado rápido desde nodos/IA → botón «Oráculo IA»
//   4. Alertas y pendientes          → semáforo Rojo / Verde editable
//   5. Chat por @Área y colaboración → botón del chat
// Si el elemento no se ve (Modo Simple, Experto o teléfono), la tarjeta se
// centra: el recorrido nunca queda vacío. Siempre se puede omitir (Esc o
// «Omitir tutorial») y repetir desde ⋯, la ayuda o ⌘K («Ver tutorial de inicio»).
// Lanzamiento automático: toda cuenta con sesión que no lo completó ni omitió
// (estado por cuenta, ver `tutorialState.ts`). Sin sesión, como antes: solo
// en Modo Experto la primera vez en un lienzo vacío.
// ============================================================================

interface TourStep {
  /** Valor de `data-tour` del elemento a iluminar (null = tarjeta centrada). */
  target: "add" | "oracle" | "pending" | "chat" | null;
  icon: React.ReactNode;
  title: string;
  body: { desktop: string; mobile: string };
}

const STEPS: TourStep[] = [
  {
    target: null,
    icon: <Network className="w-4 h-4" aria-hidden="true" />,
    title: "Tu espacio de trabajo",
    body: {
      desktop:
        "La Coordinación reúne al equipo, cada @Área agrupa a sus personas y de cada área cuelgan sus Fichas con cables: así todo el proyecto se lee de un vistazo.",
      mobile:
        "La Coordinación reúne al equipo, cada @Área agrupa a sus personas y de cada área cuelgan sus Fichas: todo el proyecto, de un vistazo.",
    },
  },
  {
    target: "add",
    icon: <LayoutTemplate className="w-4 h-4" aria-hidden="true" />,
    title: "Plantillas listas para usar",
    body: {
      desktop:
        "En + Agregar → Librería de fichas tienes 24 plantillas listas para usar. Con «Llenar con IA» pegas una lista o tus notas y se crean varias fichas a la vez.",
      mobile:
        "En + Agregar → Librería de fichas tienes 24 plantillas listas. Con «Llenar con IA» pegas una lista y se crean varias fichas a la vez.",
    },
  },
  {
    target: "oracle",
    icon: <Wand2 className="w-4 h-4" aria-hidden="true" />,
    title: "Llenado rápido desde nodos e IA",
    body: {
      desktop:
        "Conecta una ficha a la Coordinación, a un @Área u otra ficha y pulsa «Llenar desde nodos»: copia área, responsable y fechas sin gastar IA. Para el resto, «Llenar con IA» o el Oráculo (O).",
      mobile:
        "Conecta una ficha a un @Área u otra ficha y pulsa «Llenar desde nodos»: copia área, responsable y fechas sin gastar IA. Para el resto, «Llenar con IA» o el Oráculo.",
    },
  },
  {
    target: "pending",
    icon: <AlarmClock className="w-4 h-4" aria-hidden="true" />,
    title: "Alertas y pendientes (Rojo → Verde)",
    body: {
      desktop:
        "Con el reloj creas una alarma en un paso: Hoy, Mañana o En 3 días, con su @Área. Edita cualquier pendiente con el lápiz y pásalo a Verde al cerrarlo: el historial guarda quién y cuándo.",
      mobile:
        "Crea una alarma en un paso (Hoy, Mañana, En 3 días) y edita cualquier pendiente con el lápiz. Al cerrarlo pasa a Verde y queda el historial.",
    },
  },
  {
    target: "chat",
    icon: <MessagesSquare className="w-4 h-4" aria-hidden="true" />,
    title: "Chat por @Área y colaboración",
    body: {
      desktop:
        "En el chat escribe @Logística (o cualquier área) para avisar a todo su equipo, o @IA para reportar un cambio y que lo evalúe. Invita a tu equipo desde Compartir.",
      mobile: "En el chat menciona @Área para avisar a su equipo o @IA para reportar un cambio. Invita a tu equipo desde Compartir.",
    },
  },
];

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
      // Fuera de pantalla o sin tamaño → tarjeta centrada.
      const visible = r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
      const key = visible ? `${r.top}|${r.left}|${r.width}|${r.height}` : "none";
      if (key !== last) {
        last = key;
        setRect(visible ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [target, active]);

  return active && target ? rect : null;
}

/** Ilustración del paso 1: cómo se conectan Coordinación, @Áreas y Fichas. */
const WorkspaceIllustration: React.FC = () => (
  <div className="mt-3 rounded-2xl border border-andros-border bg-andros-canvas p-3" aria-hidden="true">
    <div className="flex items-center justify-between gap-1.5 text-[11px] font-medium text-andros-primary">
      <span className="px-2 py-1 rounded-lg border border-andros-border bg-andros-card">Coordinación</span>
      <ArrowRight className="w-3.5 h-3.5 shrink-0 text-andros-muted" />
      <span className="px-2 py-1 rounded-lg border border-andros-border bg-andros-card">@Logística</span>
      <ArrowRight className="w-3.5 h-3.5 shrink-0 text-andros-muted" />
      <span className="px-2 py-1 rounded-lg border border-andros-accent/60 bg-andros-accent/10">Ficha</span>
    </div>
  </div>
);

/** ¿Está abierto el diálogo para elegir @usuario? (el tutorial espera a que se cierre). */
function useUsernamePromptOpen(): boolean {
  const user = useCloudStore((s) => s.user);
  const username = useSocialStore((s) => s.username);
  const setupMissing = useSocialStore((s) => s.setupMissing);
  const dismissed = useSocialStore((s) => s.usernamePromptDismissed);
  return Boolean(user) && username === null && !setupMissing && !dismissed;
}

export const OnboardingTour: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const open = useOnboardingStore((s) => s.open);
  const step = useOnboardingStore((s) => s.step);
  const start = useOnboardingStore((s) => s.start);
  const next = useOnboardingStore((s) => s.next);
  const back = useOnboardingStore((s) => s.back);
  const finish = useOnboardingStore((s) => s.finish);
  const tutorialUser = useOnboardingStore((s) => s.userId);
  const localStatus = useOnboardingStore((s) => s.status);
  const remoteStatus = useOnboardingStore((s) => s.remoteStatus);

  const phase = useLandingStore((s) => s.phase);
  const cloudStatus = useCloudStore((s) => s.status);
  const userId = useCloudStore((s) => s.user?.id ?? null);
  const hasUser = userId !== null;
  const nodeCount = useWorkspaceStore((s) => s.nodes.length);
  const usernamePrompt = useUsernamePromptOpen();
  const expertMode = useIsExpert();
  const systemReduced = useReducedMotion() ?? false;
  const reducedSetting = useSettingsStore((s) => s.animations) === "reduced";
  const reduced = systemReduced || reducedSetting;

  // Con sesión se espera a que el lienzo de la nube termine de cargar.
  const canvasSettled =
    cloudStatus === "disabled" ||
    cloudStatus === "signed-out" ||
    cloudStatus === "error" ||
    (hasUser && (cloudStatus === "saved" || cloudStatus === "saving")) ||
    (!hasUser && cloudStatus === "connecting" && phase === "workspace");

  // ---- Lanzamiento automático: cuenta nueva (o que aún no lo hizo) --------
  const autoForAccount =
    hasUser &&
    tutorialUser === userId &&
    shouldAutoStartTutorial({ userId, local: localStatus, remote: remoteStatus, cloud: Boolean(getSupabaseBrowserClient()) });

  useEffect(() => {
    if (phase !== "workspace" || !canvasSettled || open || usernamePrompt) return;
    if (hasUser) {
      if (!autoForAccount) return;
      const timer = window.setTimeout(() => {
        const t = useOnboardingStore.getState();
        if (t.open || t.status || useLandingStore.getState().phase !== "workspace") return;
        start();
      }, 900);
      return () => window.clearTimeout(timer);
    }
    // Sin sesión: Modo Simple deja mandar a la tarjeta de arranque; en Experto, 1.ª vez con el lienzo vacío.
    if (!expertMode || nodeCount > 0) return;
    const timer = window.setTimeout(() => {
      if (hasSeenOnboarding()) return;
      if (useSettingsStore.getState().experienceMode !== "expert") return;
      if (useWorkspaceStore.getState().nodes.length > 0) return;
      if (useLandingStore.getState().phase !== "workspace") return;
      start();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [phase, canvasSettled, open, usernamePrompt, hasUser, autoForAccount, expertMode, nodeCount, start]);

  // ---- Teclado: ← → / Esc, sin disparar los atajos del lienzo --------------
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

  const index = Math.min(step, STEPS.length - 1);
  const current = STEPS[index];
  const rect = useTargetRect(current.target, open);

  if (typeof document === "undefined") return null;

  // ---- Posición del foco y de la tarjeta -----------------------------------
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardWidth = Math.min(rect ? 340 : 400, vw - 24);

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
      top: Math.max(16, vh / 2 - 200),
      width: cardWidth,
      maxHeight: vh - 32,
      overflowY: "auto",
    };
  }

  const isLast = step === ONBOARDING_STEP_COUNT - 1;
  const titleId = "andros-tour-title";

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="onboarding-tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          className="fixed inset-0 z-[65]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby="andros-tour-body"
        >
          {/* Fondo suave: el foco recorta un hueco con una sombra gigante */}
          {spot ? (
            <motion.div
              aria-hidden="true"
              className="absolute rounded-2xl pointer-events-none ring-2 ring-andros-accent"
              initial={false}
              animate={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
              transition={springOrInstant(reduced)}
              style={{ boxShadow: "0 0 0 9999px rgba(5, 6, 8, 0.5)" }}
            />
          ) : (
            <div aria-hidden="true" className="absolute inset-0 bg-[rgba(5,6,8,0.5)]" />
          )}
          {/* Capa que evita clics accidentales al lienzo mientras dura el recorrido */}
          <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

          {/* Tarjeta del paso */}
          <motion.div
            key={step}
            initial={{ opacity: 0, y: reduced ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springOrInstant(reduced)}
            className="absolute rounded-2xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark p-4"
            style={cardStyle}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-andros-muted">
                <span className="w-6 h-6 rounded-lg bg-andros-accent/10 text-andros-accent-ink flex items-center justify-center">
                  {current.icon}
                </span>
                <span className="font-mono tabular-nums" aria-label={`Paso ${step + 1} de ${ONBOARDING_STEP_COUNT}`}>
                  {step + 1}/{ONBOARDING_STEP_COUNT}
                </span>
              </span>
              <button
                type="button"
                onClick={() => finish("skipped")}
                className="min-h-11 md:min-h-0 text-[11px] text-andros-muted hover:text-andros-primary px-2 py-1 rounded-lg hover:bg-andros-border/40 spring-micro"
              >
                Omitir tutorial
              </button>
            </div>

            <h2 id={titleId} className="mt-3 text-base font-semibold text-andros-primary">
              {current.title}
            </h2>
            <p id="andros-tour-body" className="mt-1 text-[13px] leading-relaxed text-andros-muted">
              {isMobile ? current.body.mobile : current.body.desktop}
            </p>
            {index === 0 && <WorkspaceIllustration />}

            <div className="mt-4 flex items-center justify-between gap-2">
              {/* Progreso */}
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full spring-micro ${i === step ? "w-5 bg-andros-accent-fill" : "w-1.5 bg-andros-border-active"}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={back}
                    className="min-h-11 md:min-h-9 px-3 rounded-xl border border-andros-border text-[13px] font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
                  >
                    <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                    Anterior
                  </button>
                )}
                <button
                  type="button"
                  onClick={next}
                  autoFocus
                  className="min-h-11 md:min-h-9 px-4 rounded-xl bg-andros-primary text-andros-canvas text-[13px] font-semibold flex items-center gap-1.5 hover:opacity-90 active:scale-[0.96] spring-micro"
                >
                  {isLast ? "Empezar" : "Siguiente"}
                  {!isLast && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
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
