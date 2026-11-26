"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useAnimate, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  BellRing,
  BookOpen,
  Box,
  CalendarDays,
  Check,
  ClipboardList,
  FileOutput,
  Layers,
  Loader2,
  MessagesSquare,
  Sparkles,
  Users,
} from "lucide-react";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { signInWithGoogle } from "@/hooks/useCloudSync";
import { useCloudStore } from "@/store/useCloudStore";
import { useLandingStore } from "@/store/useLandingStore";
import { useMarketStore } from "@/store/useMarketStore";
import { FREE_PLAN, PRO_PLAN } from "@/lib/plans";
import { startProCheckout } from "@/lib/billing/subscriptionClient";
import { CATALOG_CATEGORIES, TEMPLATE_CATALOG, findCatalogTemplate } from "@/lib/forms/templateCatalog";
import { LandingFooter } from "./LandingFooter";
import { PlanningTable } from "./PlanningTable";

// ============================================================================
// ANDROS — PORTADA PÚBLICA (Sprint 22 → rediseño «mesa de estudio», Sprint 23)
//
//   Un solo estilo visual fijo (`.andros-landing`): papel crema, tinta grafito
//   cálida, terracota, salvia y un rojo semáforo sobrio. Sin botón de tema y
//   sin controles de tipografía: el titular es texto editorial estático.
//
//   Pieza principal: `PlanningTable`, una lámina de plano con tarjetas reales
//   (@Diseño, @Obra, @Finanzas), trazos de conexión, un hilo de chat y una
//   ficha que pasa de Rojo a Verde. Solo DOM + SVG, respeta el movimiento
//   reducido. Todo dato de muestra se rotula «Ejemplo».
//
//   Recorrido con scroll vertical (cada bloque es un array de datos para
//   ampliarlo sin rehacer el diseño):
//     Hero → 01 Cómo funciona → 02 Equipos (ejemplos) → 03 Capacidades
//     → 04 Planes → 05 Más información → Pie corporativo (`LandingFooter`,
//     datos en `COMPANY_CONTACT`).
//
//   Regla de marcas: en la portada no se nombra NINGUNA app, plataforma ni
//   proveedor de terceros (tampoco el de inicio de sesión). `verify:brand`
//   lo comprueba sin excepciones sobre src/components/landing/.
//
//   Entrada:
//   · «Comenzar gratis» → flujo de inicio de sesión de Andros. Al volver con
//     sesión, la portada se cierra sola y abre su lienzo.
//   · «Explorar primero sin cuenta» → la marca y el nombre vuelan a la barra
//     superior del lienzo y la portada se desvanece (modo local).
//   · Sin nube configurada (modo local), el botón principal entra directo.
// ============================================================================

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const EASE = [0.16, 1, 0.3, 1] as const;

const PRIMARY_BUTTON =
  "group h-12 px-5 rounded-xl bg-andros-accent-fill text-white text-sm font-semibold shadow-[0_8px_20px_-12px_rgba(163,72,42,0.8)] hover:opacity-90 active:scale-[0.96] spring-micro disabled:opacity-60 disabled:cursor-default flex items-center justify-center gap-2.5";

const SECONDARY_BUTTON =
  "h-12 px-5 rounded-xl border border-andros-border-active bg-andros-card text-sm font-semibold text-andros-primary hover:border-andros-primary active:scale-[0.96] spring-micro flex items-center justify-center gap-2";

const TEMPLATE_COUNT = TEMPLATE_CATALOG.length;

// ---------------------------------------------------------------------------
// Contenido (datos puros: añadir un elemento basta para ampliar la sección)
// ---------------------------------------------------------------------------

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: "Arma tu equipo por áreas",
    body: "Crea un espacio, invita a cada persona por su @usuario y dile de qué área es: Diseño, Obra, Finanzas o las que use tu equipo. Así cada quien ve primero lo que le toca.",
  },
  {
    title: "Planifica sobre la misma mesa",
    body: `Tarjetas, fichas, archivos y conversación en un mismo tablero. Empieza con una de las ${TEMPLATE_COUNT} plantillas listas o con una hoja en blanco, como prefieras.`,
  },
  {
    title: "Cierra pendientes, no hilos eternos",
    body: "Cada pendiente es una ficha en Rojo con alguien a cargo. Cuando se resuelve pasa a Verde y queda anotado quién y cuándo. Si un cambio descuadra otra parte del plan, el asistente te avisa.",
  },
];

type Tone = "clay" | "sage" | "ochre";
type RowState = "rojo" | "verde" | "curso";

interface TeamExample {
  id: string;
  who: string;
  title: string;
  body: string;
  areas: { name: string; tone: Tone }[];
  rows: { label: string; state: RowState }[];
  /** Ids del catálogo de la Librería de fichas (se muestran sus títulos reales). */
  templates: string[];
}

const TEAM_EXAMPLES: TeamExample[] = [
  {
    id: "estudio",
    who: "Un estudio de diseño de interiores",
    title: "El cliente pide un cambio y no se pierde en un mensaje.",
    body: "El brief, las revisiones con el cliente y las compras de materiales están en el mismo espacio. Cada cambio pedido queda como una ficha en Rojo con responsable, y el cliente puede verla sin editar nada.",
    areas: [
      { name: "Diseño", tone: "clay" },
      { name: "Compras", tone: "ochre" },
    ],
    rows: [
      { label: "Brief de cliente aprobado", state: "verde" },
      { label: "Cambio de acabados en sala", state: "rojo" },
      { label: "Revisión de render v3", state: "curso" },
    ],
    templates: ["cat-brief-creativo", "cat-revision-diseno"],
  },
  {
    id: "obra",
    who: "Un equipo de obra",
    title: "La oficina y el sitio miran el mismo plano.",
    body: "Residente, compras y oficina técnica comparten las observaciones de planos y las solicitudes de información. Las fotos de la inspección se adjuntan desde el celular, ahí mismo en la obra.",
    areas: [
      { name: "Obra", tone: "sage" },
      { name: "Finanzas", tone: "ochre" },
    ],
    rows: [
      { label: "RFI-012 · Detalle de losa", state: "rojo" },
      { label: "Inspección de encofrado", state: "verde" },
      { label: "Pedido de acero", state: "curso" },
    ],
    templates: ["cat-rfi", "cat-inspeccion-campo"],
  },
  {
    id: "universidad",
    who: "Un grupo universitario",
    title: "Cinco personas, una tesis y nadie preguntando «¿quién tenía eso?».",
    body: "Cada capítulo tiene responsable y fecha, las fuentes quedan citadas en fichas que todo el grupo puede revisar y las correcciones del asesor no se quedan en el correo de una sola persona.",
    areas: [
      { name: "Investigación", tone: "clay" },
      { name: "Redacción", tone: "sage" },
    ],
    rows: [
      { label: "Capítulo 2 · Marco teórico", state: "curso" },
      { label: "Fuentes verificadas", state: "verde" },
      { label: "Correcciones del asesor", state: "rojo" },
    ],
    templates: ["cat-tesis-equipo", "cat-investigacion-academica"],
  },
];

interface Capability {
  icon: React.ReactNode;
  title: string;
  body: string;
  /** Aclaración corta (p. ej. el plan que la incluye). */
  note?: string;
}

const ICON = "w-5 h-5";

const CAPABILITIES: Capability[] = [
  {
    icon: <Layers className={ICON} aria-hidden="true" />,
    title: "Un tablero, todos a la vez",
    body: "Todo el equipo ve y edita el mismo tablero al instante, desde la computadora o el celular, con cursores en vivo, canal de voz y pantalla compartida.",
  },
  {
    icon: <MessagesSquare className={ICON} aria-hidden="true" />,
    title: "Chat por @Área y Bandeja",
    body: "Escribe @Obra y le llega a toda el área. La Bandeja junta lo que te menciona a ti o a tu área, para que nada se quede arriba en la conversación.",
  },
  {
    icon: <ClipboardList className={ICON} aria-hidden="true" />,
    title: `${TEMPLATE_COUNT} plantillas para empezar`,
    body: `Actas, entregables, planos, RFI, propuestas, eventos, tesis y más, en ${CATALOG_CATEGORIES.length} categorías. Cada una trae su estructura de seguimiento y se ajusta a tu manera.`,
  },
  {
    icon: <Sparkles className={ICON} aria-hidden="true" />,
    title: "Asistente de IA integrado",
    body: "Arma un plan a partir de una frase, llena fichas con tus notas y avisa cuando un cambio descuadra otras tarjetas. Incluye consultas diarias, o úsalo sin límite con tu propia clave de API.",
  },
  {
    icon: <CalendarDays className={ICON} aria-hidden="true" />,
    title: "Fechas en tu calendario",
    body: "Lleva las fechas del tablero a tu calendario o descárgalas en un archivo de calendario estándar.",
  },
  {
    icon: <FileOutput className={ICON} aria-hidden="true" />,
    title: "Documentos para entregar",
    body: "Documentos, presentaciones y resúmenes generados a partir de lo que ya está en el tablero, listos para compartir con tu equipo o tu cliente.",
  },
  {
    icon: <Box className={ICON} aria-hidden="true" />,
    title: "Modo Experto",
    body: "Para equipos técnicos: visor 3D, fórmulas, CodeLab e impresión 3D en red dentro del mismo espacio.",
    note: `Incluido en ${PRO_PLAN.name}`,
  },
];

const RESOLUTION_SAMPLE: { code: string; title: string; area: string; state: RowState }[] = [
  { code: "RES-001", title: "Aprobar paleta de materiales", area: "Diseño", state: "verde" },
  { code: "RES-002", title: "Reubicar toma eléctrica de la barra", area: "Obra", state: "rojo" },
  { code: "RES-003", title: "Cotizar segunda opción de grifería", area: "Finanzas", state: "verde" },
];

interface InfoModule {
  id: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  /** Cuando exista la página, se añade aquí y la tarjeta pasa a ser un enlace. */
  href?: string;
}

const MORE_INFO: InfoModule[] = [
  {
    id: "casos-de-uso",
    icon: <Users className={ICON} aria-hidden="true" />,
    title: "Casos de uso",
    body: "Ejemplos paso a paso para estudios de diseño, equipos de obra, eventos, PyMEs y trabajos académicos.",
  },
  {
    id: "guia-rapida",
    icon: <BookOpen className={ICON} aria-hidden="true" />,
    title: "Guía rápida",
    body: "Una guía corta para sacarle provecho desde el primer día. Mientras tanto, dentro de Andros tienes un tutorial guiado de 5 pasos.",
  },
  {
    id: "novedades",
    icon: <BellRing className={ICON} aria-hidden="true" />,
    title: "Novedades",
    body: "Lo nuevo de cada versión de Andros, contado en lenguaje claro y sin letra pequeña.",
  },
];

// ---------------------------------------------------------------------------
// Piezas editoriales
// ---------------------------------------------------------------------------

const TONE_DOT: Record<Tone, string> = {
  clay: "bg-[var(--accent-primary)]",
  sage: "bg-[var(--accent-success)]",
  ochre: "bg-[var(--landing-ochre)]",
};

const AreaChip: React.FC<{ name: string; tone: Tone }> = ({ name, tone }) => (
  <span className="inline-flex items-center gap-1 rounded-md border border-andros-border bg-andros-canvas px-1.5 py-0.5 text-[11px] font-medium text-andros-primary">
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />@{name}
  </span>
);

const ROW_STATE: Record<RowState, { label: string; dot: string; text: string }> = {
  rojo: { label: "Rojo", dot: "bg-[var(--danger-ink)]", text: "text-andros-danger" },
  verde: { label: "Verde", dot: "bg-[var(--accent-success)]", text: "text-andros-success" },
  curso: { label: "En curso", dot: "bg-[var(--landing-ochre)]", text: "text-andros-muted" },
};

const StatePill: React.FC<{ state: RowState }> = ({ state }) => {
  const s = ROW_STATE[state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold ${s.text}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
};

const ExampleTag: React.FC = () => (
  <span className="rounded-md border border-dashed border-andros-border-active px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-andros-muted">
    Ejemplo
  </span>
);

const SectionHeading: React.FC<{ index: string; kicker: string; title: string; id: string; lead?: string }> = ({
  index,
  kicker,
  title,
  id,
  lead,
}) => (
  <header className="grid gap-3 md:grid-cols-[11rem_1fr] md:gap-10 pb-10 md:pb-12">
    <p className="flex items-center gap-3 text-xs text-andros-muted md:pt-2">
      <span className="font-mono tabular-nums text-andros-accent-ink" aria-hidden="true">
        {index}
      </span>
      <span aria-hidden="true" className="h-px w-8 bg-[var(--landing-trace)]" />
      <span className="uppercase tracking-[0.14em]">{kicker}</span>
    </p>
    <div>
      <h2 id={id} className="landing-serif max-w-[24ch] text-[1.75rem] md:text-[2.5rem] leading-[1.12] text-andros-primary">
        {title}
      </h2>
      {lead && <p className="mt-4 max-w-2xl text-sm md:text-base leading-relaxed text-andros-muted">{lead}</p>}
    </div>
  </header>
);

const NAV_LINKS = [
  { id: "como-funciona", label: "Cómo funciona" },
  { id: "equipos", label: "Equipos" },
  { id: "capacidades", label: "Capacidades" },
  { id: "planes", label: "Planes" },
  { id: "mas-informacion", label: "Más información" },
] as const;

// ---------------------------------------------------------------------------
// Portada
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

  // Con sesión ya activa (o al volver del inicio de sesión) se entra directo al lienzo.
  useEffect(() => {
    if (user && !manual && useLandingStore.getState().phase === "landing") skipToWorkspace();
  }, [user, manual, skipToWorkspace]);

  const cloudDisabled = cloudStatus === "disabled";
  const checkingSession = cloudStatus === "connecting" && !user;

  const [scope, animate] = useAnimate<HTMLDivElement>();
  const wordmarkRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const igniting = phase === "igniting";

  // Mientras la portada está abierta, los atajos del lienzo (L, M, B…) no se disparan.
  useEffect(() => {
    const guard = (e: KeyboardEvent) => {
      const insideOverlay = scope.current?.contains(e.target as Node) ?? false;
      const navigationKey = e.key === "Tab" || e.key === "Enter" || e.key === " ";
      if (insideOverlay && navigationKey) return; // lo frena onKeyDown de abajo
      e.stopPropagation();
    };
    window.addEventListener("keydown", guard, true);
    return () => window.removeEventListener("keydown", guard, true);
  }, [scope]);

  // ---- Entrada al lienzo: la marca y el nombre vuelan a la barra superior ----
  const handleStart = useCallback(async () => {
    if (useLandingStore.getState().phase !== "landing") return;
    // Si se pulsa desde más abajo, la marca vuelve a la vista antes de volar.
    scope.current?.scrollTo({ top: 0 });
    startIgnition();
    await wait(reduceMotion ? 0 : 60);

    const flight = reduceMotion
      ? { duration: 0.2 }
      : { type: "spring" as const, stiffness: 85, damping: 15, mass: 0.9, restDelta: 0.001 };
    const flights: Promise<unknown>[] = [];

    // El nombre viaja hasta el «Andros» de la barra superior (oculto en pantallas estrechas).
    const name = wordmarkRef.current;
    const wordmark = document.querySelector<HTMLElement>("[data-andros-wordmark]");
    if (name && wordmark && wordmark.getClientRects().length > 0) {
      const s = name.getBoundingClientRect();
      const t = wordmark.getBoundingClientRect();
      const sourceSize = parseFloat(getComputedStyle(name).fontSize) || 1;
      const targetSize = parseFloat(getComputedStyle(wordmark).fontSize) || 12;
      flights.push(
        animate(
          name,
          { x: t.left - s.left, y: t.top + t.height / 2 - (s.top + s.height / 2), scale: targetSize / sourceSize },
          flight,
        ).finished,
      );
    }

    // La marca de doble chevrón se acopla a la de la barra superior.
    const mark = markRef.current;
    const markTarget = document.querySelector<HTMLElement>("[data-andros-mark]");
    if (mark && markTarget) {
      const s = mark.getBoundingClientRect();
      const t = markTarget.getBoundingClientRect();
      flights.push(
        animate(mark, { x: t.left - s.left, y: t.top - s.top, scale: t.width / Math.max(s.width, 1) }, flight).finished,
      );
    }

    await Promise.all(flights);
    finishIgnition();
  }, [animate, finishIgnition, reduceMotion, scope, startIgnition]);

  /** «Comenzar gratis»: con sesión o sin nube entra directo; si no, abre el inicio de sesión. */
  const startFree = () => {
    if (user || cloudDisabled) {
      void handleStart();
      return;
    }
    clearCloudError();
    void signInWithGoogle();
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  // (Sprint 21) «Pasar a Pro»: sin sesión primero se inicia sesión; con la
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

  const fadeOut = { opacity: igniting ? 0 : 1, transition: { duration: 0.25, ease: EASE } };

  const primaryLabel = user ? "Entrar a Andros" : checkingSession ? "Conectando…" : "Comenzar gratis";

  return (
    <motion.div
      ref={scope}
      role="dialog"
      aria-modal="true"
      aria-labelledby="andros-landing-title"
      initial={false}
      animate={{ opacity: 1 }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`andros-landing fixed inset-0 z-[60] overflow-x-hidden overflow-y-auto overscroll-contain ${
        igniting ? "pointer-events-none" : ""
      }`}
    >
      {/* Fondo de papel que se desvanece al entrar al lienzo */}
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 bg-andros-canvas"
        animate={{ opacity: igniting ? 0 : 1 }}
        transition={{ duration: 0.35, delay: igniting ? 0.25 : 0, ease: "easeInOut" }}
      />

      {/* ---- Barra superior fija ---- */}
      <header
        className={`sticky top-0 z-20 border-b transition-colors duration-200 ${
          igniting ? "border-transparent bg-transparent" : "border-andros-border bg-andros-canvas/90 backdrop-blur-md"
        }`}
      >
        <div className="mx-auto max-w-6xl h-16 px-4 md:px-10 flex items-center justify-between gap-4">
          <p className="flex items-center gap-2.5 min-w-0">
            {/* Esta marca vuela a la barra superior del lienzo al entrar */}
            <span ref={markRef} className="block w-7 h-7 shrink-0" style={{ transformOrigin: "0 0" }}>
              <AndrosMark className="w-7 h-7" title="Andros" />
            </span>
            <motion.span animate={fadeOut} className="text-base font-semibold tracking-tight text-andros-primary" aria-hidden="true">
              Andros
            </motion.span>
          </p>
          <motion.nav animate={fadeOut} aria-label="Secciones de la portada" className="flex items-center gap-1">
            {!isMobile &&
              NAV_LINKS.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => scrollToSection(link.id)}
                  className="hidden lg:inline-flex h-9 px-3 items-center rounded-lg text-sm text-andros-muted hover:text-andros-primary hover:bg-andros-card spring-micro"
                >
                  {link.label}
                </button>
              ))}
            <button
              type="button"
              onClick={startFree}
              disabled={igniting || checkingSession}
              className="ml-2 h-11 md:h-9 px-4 rounded-xl border border-andros-border-active bg-andros-card text-sm font-semibold text-andros-primary hover:border-andros-primary active:scale-[0.96] spring-micro"
            >
              Entrar a Andros
            </button>
          </motion.nav>
        </div>
      </header>

      {/* ---- Hero: texto + mesa de estudio ---- */}
      <section aria-labelledby="andros-landing-title" className="relative min-h-[calc(100svh-4rem)] flex flex-col px-4 md:px-10">
        {/* Retícula de papel milimetrado que se funde hacia abajo */}
        <motion.div
          aria-hidden="true"
          animate={fadeOut}
          className="landing-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
        />

        <div className="relative mx-auto w-full max-w-6xl flex-1 grid items-center gap-12 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] py-12 md:py-16">
          <div>
            <motion.p animate={fadeOut} className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-andros-muted">
              <span aria-hidden="true" className="h-px w-8 bg-[var(--accent-primary)]" />
              Planificación compartida para equipos
            </motion.p>
            {/* Nombre editorial estático: vuela al «Andros» de la barra del lienzo al entrar */}
            <span
              ref={wordmarkRef}
              aria-hidden="true"
              className="mt-5 block w-fit font-semibold leading-[0.95] tracking-[-0.04em] text-andros-primary"
              style={{ fontSize: "clamp(3.25rem, 7.5vw, 6.25rem)", transformOrigin: "0 50%" }}
            >
              Andros
            </span>

            <motion.div animate={fadeOut}>
              <h1
                id="andros-landing-title"
                className="landing-serif mt-6 max-w-[20ch] text-[1.9rem] md:text-[2.6rem] leading-[1.1] text-andros-primary"
              >
                Todo tu equipo, sus acuerdos y sus entregas{" "}
                <span className="relative whitespace-nowrap">
                  en un solo lugar
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 200 12"
                    preserveAspectRatio="none"
                    className="absolute -bottom-2 left-0 h-3 w-full"
                  >
                    <path
                      className="landing-draw"
                      pathLength={1}
                      d="M3 8 C 48 3, 118 2, 197 6"
                      fill="none"
                      stroke="var(--accent-primary)"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </span>
                .
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-andros-muted">
                Sin perder mensajes ni archivos. Cada área ve lo que le toca, cada pendiente tiene a alguien a cargo y,
                cuando algo se resuelve, todos lo ven pasar de Rojo a Verde.
              </p>

              <div className="mt-8 flex flex-col items-stretch md:items-start gap-3">
                <div className="flex flex-col md:flex-row gap-2.5">
                  <button type="button" onClick={startFree} disabled={igniting || checkingSession} className={PRIMARY_BUTTON}>
                    {checkingSession && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    <span>{primaryLabel}</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => scrollToSection("planes")} disabled={igniting} className={SECONDARY_BUTTON}>
                    Ver planes
                  </button>
                </div>

                {!user && !cloudDisabled && (
                  <p className="text-xs leading-relaxed text-andros-muted">
                    Sin tarjeta.{" "}
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

          {/* Mesa de estudio: lámina con tarjetas, áreas, Rojo → Verde y chat */}
          <motion.div animate={fadeOut} className="w-full max-w-xl mx-auto lg:max-w-none">
            <PlanningTable />
          </motion.div>
        </div>

        {/* Indicador discreto de scroll */}
        <motion.div animate={fadeOut} className="relative mx-auto w-full max-w-6xl pb-6">
          <button
            type="button"
            onClick={() => scrollToSection("como-funciona")}
            className="min-h-[44px] inline-flex items-center gap-1.5 text-sm text-andros-muted hover:text-andros-primary"
          >
            Conoce más
            <ArrowDown className="w-4 h-4" aria-hidden="true" />
          </button>
        </motion.div>
      </section>

      {/* ---- Secciones informativas ---- */}
      <motion.div animate={fadeOut} className="relative">
        <div className="border-t border-andros-border bg-andros-canvas">
          <div className="mx-auto max-w-6xl px-4 md:px-10">
            {/* 01 · Cómo funciona */}
            <section id="como-funciona" aria-labelledby="andros-como-funciona" className="py-16 md:py-24 scroll-mt-16">
              <SectionHeading
                index="01"
                kicker="Cómo funciona"
                id="andros-como-funciona"
                title="De un equipo disperso a un plan que todos entienden."
              />
              <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
                {/* Línea de trazo que une los pasos */}
                <span aria-hidden="true" className="absolute left-0 right-0 top-5 hidden border-t border-dashed border-[var(--landing-trace)] md:block" />
                {STEPS.map((step, i) => (
                  <li key={step.title} className="relative">
                    <span
                      aria-hidden="true"
                      className="landing-serif relative flex h-10 w-10 items-center justify-center rounded-full border border-andros-border-active bg-andros-canvas text-lg text-andros-accent-ink"
                    >
                      {i + 1}
                    </span>
                    <p className="sr-only">Paso {i + 1}</p>
                    <h3 className="mt-5 text-lg font-semibold tracking-tight text-andros-primary">{step.title}</h3>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-andros-muted">{step.body}</p>
                  </li>
                ))}
              </ol>
            </section>

            {/* 02 · Equipos (ejemplos concretos) */}
            <section
              id="equipos"
              aria-labelledby="andros-equipos"
              className="py-16 md:py-24 border-t border-andros-border scroll-mt-16"
            >
              <SectionHeading
                index="02"
                kicker="Equipos"
                id="andros-equipos"
                title="Pensado para equipos que planifican, diseñan y entregan."
                lead="Tres ejemplos de cómo se organiza un espacio en Andros. Las plantillas que aparecen son las mismas que encuentras en la Librería de fichas."
              />
              <ul className="grid gap-5 lg:grid-cols-12">
                {TEAM_EXAMPLES.map((team, i) => {
                  const featured = i === 0;
                  return (
                    <li
                      key={team.id}
                      className={`rounded-2xl border border-andros-border bg-andros-card p-5 md:p-7 flex flex-col gap-5 ${
                        featured ? "lg:col-span-7 lg:row-span-2" : "lg:col-span-5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-andros-muted">{team.who}</p>
                        <ExampleTag />
                      </div>
                      <div>
                        <h3
                          className={`landing-serif leading-snug text-andros-primary ${featured ? "text-2xl md:text-[1.75rem]" : "text-xl"}`}
                        >
                          {team.title}
                        </h3>
                        <p className="mt-3 text-sm leading-relaxed text-andros-muted">{team.body}</p>
                      </div>

                      {/* Mini tablero del ejemplo */}
                      <div className="rounded-xl border border-andros-border bg-andros-canvas p-3">
                        <div className="flex flex-wrap gap-1.5 pb-2.5">
                          {team.areas.map((a) => (
                            <AreaChip key={a.name} name={a.name} tone={a.tone} />
                          ))}
                        </div>
                        <ul className="divide-y divide-andros-border border-t border-andros-border">
                          {team.rows.map((row) => (
                            <li key={row.label} className="flex items-center justify-between gap-3 py-2 text-xs text-andros-primary">
                              <span className="min-w-0">{row.label}</span>
                              <StatePill state={row.state} />
                            </li>
                          ))}
                        </ul>
                      </div>

                      <p className="mt-auto text-xs leading-relaxed text-andros-muted">
                        <span className="font-medium text-andros-primary">Plantillas que usarían: </span>
                        {team.templates
                          .map((id) => findCatalogTemplate(id)?.title)
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* 03 · Capacidades */}
            <section
              id="capacidades"
              aria-labelledby="andros-capacidades"
              className="py-16 md:py-24 border-t border-andros-border scroll-mt-16"
            >
              <SectionHeading
                index="03"
                kicker="Capacidades"
                id="andros-capacidades"
                title="Lo que tu equipo necesita para no perder el hilo."
                lead="Funciones disponibles hoy en Andros, en el navegador del celular o de la computadora."
              />
              <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
                {/* Pieza destacada: semáforo Rojo / Verde */}
                <article className="lg:col-span-5 rounded-2xl border border-andros-border-active bg-andros-card p-5 md:p-7 flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-andros-accent-ink">Fichas de Resolución</p>
                    <ExampleTag />
                  </div>
                  <h3 className="landing-serif text-2xl leading-snug text-andros-primary">
                    Cada pendiente con dueño y semáforo.
                  </h3>
                  <p className="text-sm leading-relaxed text-andros-muted">
                    Rojo mientras falta resolverlo, Verde cuando queda cerrado. Queda registrado quién lo cerró y cuándo,
                    y todo el equipo lo ve sin preguntar.
                  </p>
                  <ul className="rounded-xl border border-andros-border bg-andros-canvas divide-y divide-andros-border">
                    {RESOLUTION_SAMPLE.map((r) => (
                      <li key={r.code} className="flex items-center gap-3 px-3 py-2.5">
                        <span className="font-mono tabular-nums text-[11px] text-andros-muted">{r.code}</span>
                        <span className="min-w-0 flex-1 text-xs text-andros-primary">
                          {r.title}
                          <span className="text-andros-muted"> · @{r.area}</span>
                        </span>
                        <StatePill state={r.state} />
                      </li>
                    ))}
                  </ul>
                </article>

                <ul className="lg:col-span-7 grid gap-x-10 sm:grid-cols-2">
                  {CAPABILITIES.map((cap) => (
                    <li key={cap.title} className="border-t border-andros-border py-6 flex flex-col gap-2.5">
                      <span className="text-andros-accent-ink">{cap.icon}</span>
                      <h3 className="text-base font-semibold tracking-tight text-andros-primary">{cap.title}</h3>
                      <p className="text-sm leading-relaxed text-andros-muted">{cap.body}</p>
                      {cap.note && <p className="text-xs font-medium text-andros-accent-ink">{cap.note}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* 04 · Planes (precios y límites de planLimits.ts vía plans.ts) */}
            <section
              id="planes"
              aria-labelledby="andros-planes-title"
              className="py-16 md:py-24 border-t border-andros-border scroll-mt-16"
            >
              <SectionHeading
                index="04"
                kicker="Planes"
                id="andros-planes-title"
                title="Precios claros. Empieza gratis, sin tarjeta."
                lead="El Plan Básico es gratis para siempre. Andros Pro se paga al mes o al año, con impuestos calculados por nuestro proveedor de pagos, y se cancela cuando quieras: conservas Pro hasta el final del periodo pagado."
              />
              <ul className="grid gap-5 md:grid-cols-2">
                {[FREE_PLAN, PRO_PLAN].map((plan) => {
                  const pro = plan.id === "pro";
                  return (
                    <li
                      key={plan.id}
                      className={`rounded-2xl border bg-andros-card flex flex-col ${
                        pro ? "border-[var(--accent-primary)] shadow-[0_18px_40px_-28px_rgba(163,72,42,0.55)]" : "border-andros-border"
                      }`}
                    >
                      <div className="p-6 md:p-7">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-andros-primary">{plan.name}</h3>
                          {pro && <span className="text-xs font-medium text-andros-accent-ink">Para equipos que crecen</span>}
                        </div>
                        <p className="mt-3 text-andros-primary">
                          <span className="landing-serif text-[2.75rem] leading-none">{plan.price}</span>{" "}
                          <span className="text-xs text-andros-muted">{plan.period}</span>
                        </p>
                        {plan.altPrice && <p className="mt-1.5 text-xs text-andros-muted">{plan.altPrice}</p>}
                        <p className="mt-3 text-sm text-andros-muted">{plan.tagline}</p>
                      </div>
                      {/* Línea de corte, como un talón */}
                      <div aria-hidden="true" className="mx-6 md:mx-7 border-t border-dashed border-andros-border-active" />
                      <div className="p-6 md:p-7 flex flex-1 flex-col gap-6">
                        <ul className="flex flex-col gap-2.5 text-sm text-andros-primary">
                          {plan.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2">
                              <Check className="w-4 h-4 mt-0.5 shrink-0 text-andros-success" aria-hidden="true" />
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-auto flex flex-col gap-2">
                          {pro ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void requestPro()}
                                disabled={igniting || proBusy}
                                className="h-11 px-4 rounded-xl bg-andros-accent-fill text-white text-sm font-semibold hover:opacity-90 active:scale-[0.96] spring-micro disabled:opacity-60"
                              >
                                {proBusy ? "Abriendo el pago…" : "Pasar a Pro"}
                              </button>
                              {proNotice && (
                                <p role="status" className="text-xs leading-relaxed text-andros-primary">
                                  {proNotice}
                                </p>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={startFree}
                              disabled={igniting || checkingSession}
                              className="h-11 px-4 rounded-xl border border-andros-border-active text-sm font-semibold text-andros-primary hover:border-andros-primary active:scale-[0.96] spring-micro"
                            >
                              {user ? "Entrar a Andros" : "Comenzar gratis"}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* 05 · Más información / Próximamente (módulos ampliables) */}
            <section
              id="mas-informacion"
              aria-labelledby="andros-mas-informacion"
              className="py-16 md:py-24 border-t border-andros-border scroll-mt-16"
            >
              <SectionHeading
                index="05"
                kicker="Más información"
                id="andros-mas-informacion"
                title="Más recursos, muy pronto."
                lead="Estamos preparando material para ayudarte a sacarle más provecho a Andros."
              />
              <ul className="grid gap-3 md:grid-cols-3">
                {MORE_INFO.map((item) => {
                  const body = (
                    <>
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-andros-accent-ink">{item.icon}</span>
                        {!item.href && (
                          <span className="text-[10px] uppercase tracking-[0.14em] text-andros-muted">Próximamente</span>
                        )}
                      </span>
                      <h3 className="text-base font-semibold tracking-tight text-andros-primary">{item.title}</h3>
                      <p className="text-sm leading-relaxed text-andros-muted">{item.body}</p>
                    </>
                  );
                  const card = "h-full p-5 rounded-2xl border flex flex-col gap-3";
                  return (
                    <li key={item.id} id={item.id}>
                      {item.href ? (
                        <Link href={item.href} className={`${card} border-andros-border bg-andros-card hover:border-andros-border-active`}>
                          {body}
                        </Link>
                      ) : (
                        <div className={`${card} border-dashed border-andros-border-active`}>{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </div>

        <LandingFooter />
      </motion.div>
    </motion.div>
  );
};
