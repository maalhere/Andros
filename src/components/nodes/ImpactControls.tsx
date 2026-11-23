"use client";

import React from "react";
import { Loader2, ScanSearch, TriangleAlert } from "lucide-react";
import { useImpactStore } from "@/store/useImpactStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { runImpactCheck } from "@/lib/canvas/impactClient";

// ============================================================================
// ANDROS — CONTROLES DEL DETECTOR EN CADA TARJETA
//   · `NodeImpactBadge`: aviso discreto «Revisar cambio» en la tarjeta
//     afectada; al tocarlo abre el panel de descuadres en esa alerta.
//   · `ReviewImpactButton`: «Revisar impacto» explícito en tarjetas conectadas
//     (la persona decide cuándo gasta una consulta). Se resalta si hay un
//     cambio importante aún sin revisar.
// ============================================================================

/** Número de alertas activas sobre esta tarjeta (selector primitivo: sin renders extra). */
export const useNodeAlertCount = (nodeId: string): number =>
  useImpactStore((s) => s.alerts.reduce((n, a) => (a.targetNodeId === nodeId ? n + 1 : n), 0));

export const NodeImpactBadge: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const count = useNodeAlertCount(nodeId);
  const firstId = useImpactStore((s) => s.alerts.find((a) => a.targetNodeId === nodeId)?.id ?? null);
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        useImpactStore.getState().setPanelOpen(true, firstId);
      }}
      aria-label={`Revisar cambio: ${count} ${count === 1 ? "aviso" : "avisos"} sobre esta tarjeta`}
      className="mt-2.5 inline-flex items-center gap-1.5 min-h-11 md:min-h-7 px-2.5 rounded-lg border border-andros-warning/50 bg-andros-warning/10 text-[11px] font-semibold text-andros-primary hover:bg-andros-warning/15 active:scale-[0.96] spring-micro"
    >
      {/* Texto principal sobre el tinte (AA en Paper y Obsidian); el icono lleva el color de aviso. */}
      <TriangleAlert className="w-3.5 h-3.5 shrink-0 text-andros-warning" aria-hidden="true" />
      Revisar cambio
      {count > 1 && <span className="font-mono tabular-nums">· {count}</span>}
    </button>
  );
};

export const ReviewImpactButton: React.FC<{ nodeId: string; variant: "canvas" | "stack" }> = ({ nodeId, variant }) => {
  const hasPending = useImpactStore((s) => Boolean(s.pending[nodeId]));
  const checking = useImpactStore((s) => Boolean(s.checking[nodeId]));
  const { pending, run } = useSubmitGuard();
  const busy = checking || pending;

  const size = variant === "stack" ? "min-h-[44px] px-3 text-xs" : "hit-slop min-h-7 px-2 text-[11px]";
  const tone = hasPending
    ? "bg-andros-accent-fill text-white"
    : "border border-andros-border text-andros-primary hover:bg-andros-border/40";

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        void run(() => runImpactCheck(nodeId));
      }}
      title={
        hasPending
          ? "Hay un cambio importante sin revisar: comprueba si otra tarjeta conectada quedó descuadrada (usa 1 consulta de IA)"
          : "Comprueba con IA si las tarjetas conectadas siguen cuadrando (usa 1 consulta)"
      }
      aria-label={hasPending ? "Revisar impacto del cambio sin revisar" : "Revisar impacto en tarjetas conectadas"}
      className={`${size} ${tone} shrink-0 rounded-lg font-medium flex items-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-60`}
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
      ) : (
        <ScanSearch className={`w-3.5 h-3.5 shrink-0 ${hasPending ? "" : "text-andros-accent-ink"}`} aria-hidden="true" />
      )}
      <span>{busy ? "Revisando…" : "Revisar impacto"}</span>
    </button>
  );
};
