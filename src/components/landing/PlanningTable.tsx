"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, CircleDot, RotateCcw } from "lucide-react";
import { springOrInstant } from "@/lib/motion";
import { useSettingsStore } from "@/store/useSettingsStore";

// ============================================================================
// ANDROS — «MESA DE ESTUDIO» DE LA PORTADA (Sprint 23)
//
// Pieza visual principal: una lámina de plano sobre papel con tarjetas reales
// de planificación (Revisión de planos @Diseño, Ficha de Resolución @Obra,
// Compra @Finanzas), trazos finos de conexión y un hilo corto de chat.
//
//   · Secuencia breve al cargar: llega un mensaje, la ficha pasa de Rojo a
//     Verde y la compra queda desbloqueada. Con movimiento reducido (sistema o
//     ajuste de Andros) se muestra directamente el estado final.
//   · Interactiva: el estado de la ficha se puede cambiar a mano y el ejemplo
//     se puede repetir.
//   · Solo DOM + un SVG: sin canvas, sin bucles infinitos. Los trazos se
//     recalculan con ResizeObserver para que siempre unan las tarjetas.
//
// Todos los datos son de EJEMPLO y se rotulan así.
// ============================================================================

type AreaTone = "clay" | "sage" | "ochre";

const AREA_DOT: Record<AreaTone, string> = {
  clay: "bg-[var(--accent-primary)]",
  sage: "bg-[var(--accent-success)]",
  ochre: "bg-[var(--landing-ochre)]",
};

const AreaTag: React.FC<{ name: string; tone: AreaTone }> = ({ name, tone }) => (
  <span className="inline-flex items-center gap-1 rounded-md border border-andros-border bg-andros-canvas px-1.5 py-0.5 text-[11px] font-medium text-andros-primary">
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${AREA_DOT[tone]}`} />@{name}
  </span>
);

const CARD = "relative rounded-xl border border-andros-border-active bg-andros-card p-3.5 shadow-[0_10px_30px_-18px_rgba(60,48,36,0.45)]";

interface Message {
  who: string;
  initials: string;
  area?: { name: string; tone: AreaTone };
  text: React.ReactNode;
  assistant?: boolean;
}

const MESSAGES: Message[] = [
  {
    who: "Ana",
    initials: "AN",
    area: { name: "Diseño", tone: "clay" },
    text: "Subí la Rev. B con el vano corregido. ¿Alguien puede medir en sitio?",
  },
  {
    who: "Luis",
    initials: "LU",
    area: { name: "Obra", tone: "sage" },
    text: "Medido: 1.20 m, coincide con el plano. Lo paso a Verde.",
  },
  {
    who: "Asistente",
    initials: "IA",
    assistant: true,
    text: "RES-004 quedó en Verde. @Finanzas ya puede aprobar la compra de ventanas.",
  },
];

/** Pasos de la secuencia: 0 · Ana escribe → 1 · Luis responde → 2 · Verde → 3 · aviso. */
const TIMELINE_MS = [1300, 2500, 3300];
/** Paso a partir del cual se ve cada mensaje (el aviso del asistente, tras el Verde). */
const MESSAGE_AT_STEP = [0, 1, 3];

interface Edge {
  from: string;
  to: string;
  d: string;
}

export const PlanningTable: React.FC = () => {
  const prefersReduced = useReducedMotion() ?? false;
  const reducedSetting = useSettingsStore((s) => s.animations === "reduced");
  const reduced = prefersReduced || reducedSetting;
  const spring = springOrInstant(reduced);

  const [step, setStep] = useState(0);
  /** Cambio manual del estado (botón); `null` = lo decide la secuencia. */
  const [manual, setManual] = useState<boolean | null>(null);
  const [run, setRun] = useState(0);

  // Con movimiento reducido se muestra directamente el estado final.
  const shownStep = reduced ? 3 : step;
  const done = manual ?? shownStep >= 2;

  // Secuencia breve, una sola vez por «run» (los setState van en los temporizadores).
  useEffect(() => {
    if (reduced) return;
    const timers = TIMELINE_MS.map((ms, i) => window.setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reduced, run]);

  const replay = () => {
    setManual(null);
    setStep(0);
    setRun((n) => n + 1);
  };

  // ---- Trazos de conexión entre tarjetas (medidos, no adivinados) ----
  const boardRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);

  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const base = board.getBoundingClientRect();
    const rect = (id: string) => board.querySelector<HTMLElement>(`[data-table-card="${id}"]`)?.getBoundingClientRect();
    const plan = rect("plan");
    const res = rect("res");
    const buy = rect("buy");
    const chat = rect("chat");
    if (!plan || !res || !buy || !chat || base.width === 0) return;
    const x = (v: number) => v - base.left;
    const y = (v: number) => v - base.top;
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const dy = Math.max(28, Math.abs(y2 - y1) * 0.55);
      return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
    };
    setEdges([
      { from: "plan", to: "res", d: curve(x(plan.left + plan.width * 0.72), y(plan.bottom), x(res.left + res.width * 0.22), y(res.top)) },
      { from: "res", to: "chat", d: curve(x(res.left + res.width * 0.2), y(res.bottom), x(chat.left + chat.width * 0.78), y(chat.top)) },
      { from: "res", to: "buy", d: curve(x(res.left + res.width * 0.78), y(res.bottom), x(buy.left + buy.width * 0.5), y(buy.top)) },
    ]);
  }, []);

  // ResizeObserver avisa al empezar a observar y en cada cambio de tamaño.
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(board);
    board.querySelectorAll("[data-table-card]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [measure]);

  return (
    <figure className="relative">
      <div
        ref={boardRef}
        className="landing-grid relative rounded-2xl border border-andros-border-active bg-andros-card/70 p-4 md:p-6"
      >
        {/* Marcas de registro de la lámina */}
        <span aria-hidden="true" className="absolute left-2 top-2 h-3 w-3 border-l border-t border-[var(--landing-trace)]" />
        <span aria-hidden="true" className="absolute right-2 top-2 h-3 w-3 border-r border-t border-[var(--landing-trace)]" />
        <span aria-hidden="true" className="absolute bottom-2 left-2 h-3 w-3 border-b border-l border-[var(--landing-trace)]" />
        <span aria-hidden="true" className="absolute bottom-2 right-2 h-3 w-3 border-b border-r border-[var(--landing-trace)]" />

        {/* Trazos finos de conexión (solo con las tarjetas en mosaico) */}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 hidden h-full w-full md:block">
          {edges.map((e) => {
            // La compra sigue punteada (en espera) hasta que la ficha pasa a Verde.
            const waiting = e.to === "buy" && !done;
            return (
              <path
                key={`${e.from}-${e.to}-${run}-${waiting ? "w" : "ok"}`}
                d={e.d}
                pathLength={waiting ? undefined : 1}
                fill="none"
                stroke="var(--landing-trace)"
                strokeWidth={1.25}
                strokeDasharray={waiting ? "4 5" : undefined}
                strokeLinecap="round"
                className={waiting ? undefined : "landing-draw"}
              />
            );
          })}
        </svg>

        <div className="relative grid gap-4 md:grid-cols-12 md:gap-x-4 md:gap-y-7">
          {/* Cajetín de la lámina */}
          <div className="flex items-start justify-between gap-3 md:col-span-12">
            <p className="text-[11px] leading-snug text-andros-muted">
              <span className="block font-semibold uppercase tracking-[0.14em] text-andros-primary">Lámina 01 · Plan compartido</span>
              Casa Rivera · remodelación de cocina
            </p>
            <span className="shrink-0 rounded-md border border-dashed border-andros-border-active px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-andros-muted">
              Ejemplo
            </span>
          </div>

          {/* Tarjeta 1 · Revisión de planos (@Diseño) */}
          <div data-table-card="plan" className={`${CARD} md:col-span-7 md:-rotate-[0.8deg]`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-andros-muted">Ficha · Revisión de planos</p>
              <AreaTag name="Diseño" tone="clay" />
            </div>
            <p className="mt-1.5 text-sm font-semibold text-andros-primary">Lámina A-101 · Rev. B</p>
            <div className="mt-2.5 flex items-end gap-3">
              <MiniPlan />
              <ul className="min-w-0 flex-1 space-y-1 text-[11px] leading-snug text-andros-muted">
                <li className="flex items-start gap-1.5">
                  <Check className="mt-px h-3.5 w-3.5 shrink-0 text-andros-success" aria-hidden="true" />
                  Eje B corregido
                </li>
                <li className="flex items-start gap-1.5">
                  <CircleDot className="mt-px h-3.5 w-3.5 shrink-0 text-andros-accent-ink" aria-hidden="true" />
                  Vano de ventana por confirmar
                </li>
              </ul>
            </div>
          </div>

          {/* Tarjeta 2 · Ficha de Resolución (@Obra): Rojo → Verde */}
          <div data-table-card="res" className={`${CARD} md:col-span-8 md:col-start-5 md:rotate-[0.6deg]`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-andros-muted">
                Ficha de Resolución · <span className="font-mono tabular-nums">RES-004</span>
              </p>
              <AreaTag name="Obra" tone="sage" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-andros-primary">Confirmar medida del vano</p>
              <button
                type="button"
                onClick={() => setManual(!done)}
                aria-pressed={done}
                aria-label={done ? "Ejemplo: volver a poner la ficha en Rojo" : "Ejemplo: marcar la ficha en Verde"}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold active:scale-[0.96] spring-micro md:min-h-8 ${
                  done
                    ? "border-[var(--accent-success)] bg-[var(--landing-sage-tint)] text-andros-success"
                    : "border-[var(--danger-ink)] bg-[var(--landing-red-tint)] text-andros-danger"
                }`}
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${done ? "bg-[var(--accent-success)]" : "bg-[var(--danger-ink)]"}`} />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={done ? "verde" : "rojo"}
                    initial={reduced ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, y: -4 }}
                    transition={spring}
                  >
                    {done ? "Verde · Resuelta" : "Rojo · Pendiente"}
                  </motion.span>
                </AnimatePresence>
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-andros-muted">
              Responsable: Luis · {done ? "cerrada hace un momento" : "abierta ayer por Ana"}
            </p>
          </div>

          {/* Hilo breve del chat del espacio */}
          <div data-table-card="chat" className={`${CARD} md:col-span-7 md:-rotate-[0.4deg]`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-andros-muted">Chat del espacio</p>
            <ol className="mt-2 space-y-2.5" aria-label="Conversación de ejemplo">
              {MESSAGES.map((m, i) =>
                shownStep >= MESSAGE_AT_STEP[i] && (i < 2 || done) ? (
                  <motion.li
                    key={`${m.who}-${run}`}
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={spring}
                    className="flex items-start gap-2"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${
                        m.assistant ? "bg-andros-accent-fill text-white" : "border border-andros-border-active bg-andros-canvas text-andros-primary"
                      }`}
                    >
                      {m.initials}
                    </span>
                    <p className="min-w-0 text-xs leading-relaxed text-andros-primary">
                      <span className="font-semibold">{m.who}</span>
                      {m.area && <span className="text-andros-muted"> · @{m.area.name}</span>}
                      <span className="block text-andros-muted">{m.text}</span>
                    </p>
                  </motion.li>
                ) : null,
              )}
            </ol>
          </div>

          {/* Tarjeta 3 · Compra (@Finanzas): se desbloquea con el Verde */}
          <div data-table-card="buy" className={`${CARD} md:col-span-5 md:rotate-[1deg] md:self-end`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-andros-muted">Compra</p>
              <AreaTag name="Finanzas" tone="ochre" />
            </div>
            <p className="mt-1.5 text-sm font-semibold text-andros-primary">Ventanas de cocina</p>
            <p className="mt-1 text-[11px] text-andros-muted">
              Presupuesto <span className="font-mono tabular-nums">USD 3 200</span>
            </p>
            <p className={`mt-2 text-[11px] font-semibold ${done ? "text-andros-success" : "text-andros-muted"}`}>
              {done ? "Lista para aprobar" : "En espera de RES-004"}
            </p>
          </div>
        </div>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-andros-muted">
        <span>Ejemplo: un pendiente que pasa de Rojo a Verde y avisa a quien sigue.</span>
        <button
          type="button"
          onClick={replay}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-andros-muted hover:text-andros-primary active:scale-[0.96] spring-micro md:min-h-8"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Repetir ejemplo
        </button>
      </figcaption>
    </figure>
  );
};

/** Plantita de cocina a línea fina con la cota del vano (1.20 m). */
const MiniPlan: React.FC = () => (
  <svg viewBox="0 0 120 78" className="h-[78px] w-[120px] shrink-0" aria-hidden="true">
    <g fill="none" stroke="var(--text-primary)" strokeLinecap="square">
      {/* Muros (con hueco de ventana arriba y puerta a la izquierda) */}
      <path d="M8 10 H44 M80 10 H112 V70 H8 V48 M8 30 V10" strokeWidth={2.2} />
      {/* Ventana */}
      <path d="M44 10 H80" strokeWidth={0.8} />
      <path d="M44 13 H80" strokeWidth={0.8} />
      {/* Barra de cocina */}
      <rect x="20" y="40" width="44" height="12" strokeWidth={0.8} />
      {/* Barrido de puerta */}
      <path d="M8 48 A18 18 0 0 0 8 30" strokeWidth={0.6} strokeDasharray="2 2" />
    </g>
    {/* Cota del vano */}
    <g stroke="var(--accent-primary)" strokeWidth={0.8}>
      <path d="M44 3 H80" />
      <path d="M44 0.5 V6 M80 0.5 V6" />
    </g>
    <text x="62" y="27" textAnchor="middle" fontSize="8" fill="var(--accent-ink)" fontFamily="var(--font-mono), monospace">
      1.20 m
    </text>
  </svg>
);
