"use client";

import React, { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, Link2Off, Loader2 } from "lucide-react";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { SiteFooter } from "@/components/legal/SiteFooter";
import { PlanBoardView } from "@/components/plan/PlanBoardView";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchPublicBoard, type PublicBoardResult } from "@/lib/share/publicShare";
import { buildPlanDocument, formatPlanDate } from "@/lib/plan/planDocument";

// ============================================================================
// ANDROS — VISTA INVITADO (`/ver/<token>`)
//   · Sin login: lee el tablero con `get_public_workspace` (solo lectura).
//   · Sin Realtime ni WebRTC: es una foto del tablero al abrir (o al pulsar
//     «Actualizar»), pensada para leerse perfecto en el celular.
//   · Tarjetas en orden de prioridad: Resumen, Cronograma, Presupuesto,
//     Logística y Roles; luego el resto.
// ============================================================================

type LoadState = { phase: "loading" } | { phase: "done"; result: PublicBoardResult };

export const PublicBoardSkeleton: React.FC = () => (
  <div className="min-h-screen bg-andros-canvas flex items-center justify-center">
    <p role="status" className="flex items-center gap-2 text-sm text-andros-muted">
      <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Cargando tablero…
    </p>
  </div>
);

export const PublicBoardClient: React.FC<{ params: Promise<{ token: string }> }> = ({ params }) => {
  const { token } = use(params);
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [reloadSignal, setReloadSignal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();
    const request: Promise<PublicBoardResult> = supabase
      ? fetchPublicBoard(supabase, decodeURIComponent(token))
      : Promise.resolve({ status: "error", message: "Este sitio no tiene la nube configurada." });
    request
      .catch((error: unknown): PublicBoardResult => ({
        status: "error",
        message: error instanceof Error ? error.message : "Error de red",
      }))
      .then((result) => {
        if (!cancelled) setState({ phase: "done", result });
      });
    return () => {
      cancelled = true;
    };
  }, [token, reloadSignal]);

  const board = state.phase === "done" && state.result.status === "ok" ? state.result.board : null;
  const doc = useMemo(() => (board ? buildPlanDocument(board.name, board.nodes, undefined, board.connections) : null), [board]);

  return (
    <div className="min-h-screen flex flex-col bg-andros-canvas text-andros-primary">
      <header className="sticky top-0 z-10 border-b border-andros-border bg-andros-canvas/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 md:px-6 h-14 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 min-h-[44px] text-sm font-semibold" aria-label="Andros: ir al inicio">
            <AndrosMark className="w-6 h-6" />
            Andros
          </Link>
          <div className="flex items-center gap-2">
            <p className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-andros-border text-xs text-andros-muted">
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              Solo lectura
            </p>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Clarity: el tablero compartido nunca se graba. */}
      <main id="contenido" data-clarity-mask="true" className="flex-1 mx-auto w-full max-w-5xl px-4 md:px-6 py-6 md:py-10">
        {state.phase === "loading" && (
          <p role="status" className="flex items-center gap-2 text-sm text-andros-muted">
            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Cargando tablero…
          </p>
        )}

        {state.phase === "done" && state.result.status !== "ok" && (
          <div className="max-w-md space-y-3">
            <Link2Off className="w-6 h-6 text-andros-muted" aria-hidden="true" />
            <h1 className="text-xl font-semibold">
              {state.result.status === "not-found" ? "Este enlace no está disponible" : "No se pudo abrir el tablero"}
            </h1>
            <p className="text-sm leading-relaxed text-andros-muted">
              {state.result.status === "not-found"
                ? "El enlace no existe o su dueño lo desactivó. Pídele uno nuevo a quien te lo compartió."
                : state.result.status === "setup"
                  ? "La Vista Invitado todavía no está activada en este sitio."
                  : `Revisa tu conexión e inténtalo de nuevo. (${state.result.message})`}
            </p>
            {state.result.status === "error" && (
              <button
                type="button"
                onClick={() => {
                  setState({ phase: "loading" });
                  setReloadSignal((n) => n + 1);
                }}
                className="min-h-[44px] px-4 rounded-xl border border-andros-border-active text-sm font-medium hover:border-andros-primary active:scale-[0.96] spring-micro"
              >
                Reintentar
              </button>
            )}
          </div>
        )}

        {board && doc && (
          <>
            <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.14em] text-andros-muted">Tablero compartido</p>
                <h1 className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight break-words">{board.name}</h1>
                {board.updatedAt && (
                  <p className="mt-1 text-xs text-andros-muted">
                    Última actualización: {formatPlanDate(new Date(board.updatedAt))}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4">
                {doc.budgetTotal && (
                  <p className="text-xs text-andros-muted">
                    Presupuesto total
                    <span className="block text-lg font-semibold text-andros-primary tabular-nums">{doc.budgetTotal}</span>
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setState({ phase: "loading" });
                    setReloadSignal((n) => n + 1);
                  }}
                  className="min-h-[44px] md:min-h-9 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-muted hover:text-andros-primary hover:border-andros-border-active active:scale-[0.96] spring-micro"
                >
                  Actualizar
                </button>
              </div>
            </div>
            <PlanBoardView doc={doc} />
          </>
        )}
      </main>

      {/* Pie discreto */}
      <div className="border-t border-andros-border">
        <div className="mx-auto max-w-5xl px-4 md:px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 min-h-[44px] text-sm text-andros-muted hover:text-andros-primary"
          >
            <AndrosMark className="w-4 h-4" />
            <span>
              Organizado en Andros — <span className="text-andros-accent-ink underline underline-offset-4">Crea tu propio tablero gratis</span>
            </span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <SiteFooter compact />
        </div>
      </div>
    </div>
  );
};
