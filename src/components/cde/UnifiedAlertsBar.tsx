"use client";

import React, { useEffect, useId } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bot, ChevronDown, ClipboardCopy, ClipboardPlus, Info, TriangleAlert, X } from "lucide-react";
import { useImpactStore } from "@/store/useImpactStore";
import { useCdeStore } from "@/store/useCdeStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useTabsBarVisible } from "@/store/useTabsStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { useAutoImpactAlerts, useSettingsStore } from "@/store/useSettingsStore";
import { toast } from "@/store/useToastStore";
import { springOrInstant } from "@/lib/motion";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { useUnifiedAlerts } from "@/lib/cde/hooks";
import { createResolutionFromAlert } from "@/lib/cde/resolutionActions";
import type { UnifiedAlert } from "@/lib/cde/alerts";
import { AreaBadge } from "./CdeBits";

// ============================================================================
// ANDROS — BARRA DE ALERTA UNIFICADA DE IA (Sprint 18)
// Una sola pastilla y un solo panel para TODO lo que la IA detecta o le
// reportan: descuadres entre tarjetas conectadas y reportes del chat a @IA,
// sin duplicados (ver `unifyAlerts`). Cada alerta ofrece en 1 clic una Ficha
// de Resolución (Rojo → Verde), ir a las tarjetas afectadas, copiar el aviso
// o descartarla (con «Deshacer»).
//   · `floating`: escritorio, fija bajo la barra superior.
//   · `stack`: dentro de la pila de tarjetas del teléfono.
// ============================================================================

interface Props {
  variant: "floating" | "stack";
}

const SMALL_BUTTON =
  "min-h-11 md:min-h-8 px-2.5 rounded-lg border border-andros-border bg-andros-card text-[11px] font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro";

function shareText(alert: UnifiedAlert, titleOf: (id: string) => string): string {
  const parts = [`Aviso de Andros: ${alert.headline.replace(/\.$/, "")}.`];
  if (alert.affectedNodeIds.length > 0) parts.push(`Tarjetas afectadas: ${alert.affectedNodeIds.map((id) => `«${titleOf(id)}»`).join(", ")}.`);
  if (alert.affectedAreas.length > 0) parts.push(`Avisar a: ${alert.affectedAreas.map((a) => `@${a}`).join(" ")}.`);
  if (alert.suggestedAction) parts.push(`Sugerencia: ${alert.suggestedAction.replace(/\.$/, "")}.`);
  return parts.join(" ");
}

/** Descarta todas las fuentes de la alerta (descuadres: para todos; reportes: en este dispositivo). */
function dismissWithUndo(alert: UnifiedAlert): void {
  const impact = useImpactStore.getState();
  const removed = impact.alerts.filter((a) => alert.sourceIds.includes(a.id));
  for (const a of removed) impact.resolveAlert(a.id);
  const reportIds = alert.sourceIds.filter((id) => !removed.some((a) => a.id === id));
  if (reportIds.length > 0) useCdeStore.getState().dismissAlerts(reportIds, true);
  toast({
    message: "Alerta descartada.",
    action: {
      label: "Deshacer",
      onAction: () => {
        for (const a of removed) useImpactStore.getState().upsertAlert(a);
        if (reportIds.length > 0) useCdeStore.getState().dismissAlerts(reportIds, false);
      },
    },
  });
}

const AlertItem: React.FC<{ alert: UnifiedAlert; highlighted: boolean; canCreate: boolean }> = ({ alert, highlighted, canCreate }) => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? "Tarjeta";
  const warning = alert.severity === "warning";
  const Icon = warning ? TriangleAlert : Info;
  const fromReport = alert.reasons.some((r) => r.source === "report");
  const fromImpact = alert.reasons.some((r) => r.source === "impact");

  const copy = async () => {
    const text = shareText(alert, titleOf);
    try {
      await navigator.clipboard.writeText(text);
      toast({ message: "Aviso copiado: pégalo en tu mensajería externa o léelo en la sala de voz.", tone: "success" });
    } catch {
      toast({ message: text, durationMs: 12_000 });
    }
  };

  return (
    <li
      className={`rounded-xl border p-2.5 ${
        highlighted ? "border-andros-warning ring-1 ring-andros-warning/40 bg-andros-canvas" : "border-andros-border bg-andros-canvas"
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${warning ? "text-andros-warning" : "text-andros-accent-ink"}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed font-medium text-andros-primary">{alert.headline}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-andros-muted">
            {fromImpact && <span>Descuadre detectado</span>}
            {fromImpact && fromReport && <span aria-hidden="true">·</span>}
            {fromReport && (
              <span className="inline-flex items-center gap-1">
                <Bot className="w-3 h-3" aria-hidden="true" />
                Reporte a @IA
              </span>
            )}
            {alert.occurrences > 1 && (
              <span title="Veces que se detectó o reportó (se juntaron en esta alerta)">
                · <span className="font-mono tabular-nums">{alert.occurrences}</span> avisos unificados
              </span>
            )}
          </p>
        </div>
      </div>

      {(alert.affectedNodeIds.length > 0 || alert.affectedAreas.length > 0) && (
        <div className="mt-1.5 pl-6 flex flex-wrap gap-1">
          {alert.affectedNodeIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                useImpactStore.setState({ highlightedAlertId: alert.id });
                focusNodeOnScreen(id);
              }}
              className="max-w-full min-h-11 md:min-h-0 px-1.5 py-0.5 rounded-md border border-andros-border bg-andros-card text-[11px] text-andros-accent-ink hover:underline underline-offset-2 truncate"
            >
              «{titleOf(id)}»
            </button>
          ))}
          {alert.affectedAreas.map((a) => (
            <AreaBadge key={a} area={a} />
          ))}
        </div>
      )}

      {(alert.suggestedAction || alert.reasons.length > 1) && (
        <dl className="mt-1.5 pl-6 space-y-0.5 text-[11px] leading-relaxed text-andros-muted">
          {alert.suggestedAction && (
            <div>
              <dt className="inline font-medium text-andros-primary">Sugerencia: </dt>
              <dd className="inline">{alert.suggestedAction}</dd>
            </div>
          )}
          {alert.reasons.length > 1 && (
            <div>
              <dt className="font-medium text-andros-primary">También:</dt>
              {alert.reasons
                .filter((r) => r.summary !== alert.headline)
                .map((r) => (
                  <dd key={r.sourceId} className="pl-2">
                    – {r.summary}
                    {r.by ? ` (${r.by})` : ""}
                  </dd>
                ))}
            </div>
          )}
        </dl>
      )}

      <div className="mt-2 pl-6 flex flex-wrap gap-1.5">
        {canCreate && (
          <button type="button" onClick={() => createResolutionFromAlert(alert)} className={SMALL_BUTTON}>
            <ClipboardPlus className="w-3.5 h-3.5 text-andros-danger" aria-hidden="true" />
            Crear Ficha de Resolución
          </button>
        )}
        <button type="button" onClick={() => void copy()} className={SMALL_BUTTON}>
          <ClipboardCopy className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
          Copiar aviso
        </button>
        <button type="button" onClick={() => dismissWithUndo(alert)} className={SMALL_BUTTON}>
          <X className="w-3.5 h-3.5 text-andros-muted" aria-hidden="true" />
          Descartar
        </button>
      </div>
    </li>
  );
};

const AutoAlertsSwitch: React.FC = () => {
  const enabled = useAutoImpactAlerts();
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-2">
      <span id={labelId} className="text-[11px] text-andros-muted">
        Detectar descuadres automáticamente al guardar un cambio
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        onClick={() => useSettingsStore.getState().applyPreferences({ autoImpactAlerts: !enabled })}
        className="hit-slop relative w-11 h-6 rounded-full shrink-0 spring-micro"
      >
        <span aria-hidden="true" className={`absolute inset-0 rounded-full ${enabled ? "bg-andros-accent-fill" : "bg-andros-border-active"}`} />
        <span
          aria-hidden="true"
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow"
          style={{ transform: enabled ? "translateX(20px)" : "translateX(0)", transition: "transform 180ms var(--ease-out-micro)" }}
        />
      </button>
    </div>
  );
};

export const UnifiedAlertsBar: React.FC<Props> = ({ variant }) => {
  const alerts = useUnifiedAlerts();
  const panelOpen = useImpactStore((s) => s.panelOpen);
  const highlightedId = useImpactStore((s) => s.highlightedAlertId);
  const setPanelOpen = useImpactStore((s) => s.setPanelOpen);
  const evaluating = useCdeStore((s) => s.evaluating);
  const readOnly = useCanvasReadOnly();
  const hasTabs = useTabsBarVisible();
  const prefersReduced = useReducedMotion() ?? false;
  const animations = useSettingsStore((s) => s.animations);
  const reduced = prefersReduced || animations === "reduced";
  const panelId = useId();

  // Escape cierra el panel (sin disparar los atajos del lienzo).
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelOpen, setPanelOpen]);

  const count = alerts.length;
  if (count === 0 && !evaluating) return null;
  const warnings = alerts.filter((a) => a.severity === "warning").length;
  const placement =
    variant === "floating" ? `fixed z-40 left-24 ${hasTabs ? "top-24" : "top-[3.75rem]"} w-[min(28rem,calc(100vw-8rem))]` : "w-full";

  return (
    <section aria-label="Alerta unificada de IA" className={placement}>
      <button
        type="button"
        aria-expanded={panelOpen}
        aria-controls={panelId}
        onClick={() => setPanelOpen(!panelOpen)}
        className={`min-h-11 md:min-h-9 pl-2.5 pr-2 rounded-xl border border-andros-warning/50 bg-andros-card shadow-hud-light dark:shadow-hud-dark flex items-center gap-2 text-xs font-medium text-andros-primary hover:bg-andros-warning/10 active:scale-[0.96] spring-micro ${
          variant === "stack" ? "w-full" : ""
        }`}
      >
        <TriangleAlert className={`w-4 h-4 shrink-0 ${warnings > 0 ? "text-andros-warning" : "text-andros-accent-ink"}`} aria-hidden="true" />
        <span className="flex-1 text-left">
          {count === 0 ? (
            "La IA está evaluando un reporte…"
          ) : (
            <>
              Alerta unificada: <span className="font-mono tabular-nums font-semibold">{count}</span>{" "}
              {count === 1 ? "asunto por revisar" : "asuntos por revisar"}
            </>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-andros-muted spring-micro ${panelOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      <AnimatePresence initial={false}>
        {panelOpen && count > 0 && (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={springOrInstant(reduced)}
            className={`mt-2 p-2 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark ${
              variant === "floating" ? "max-h-[calc(100vh-12rem)] overflow-y-auto" : ""
            }`}
          >
            <ul className="space-y-1.5">
              {alerts.map((alert) => (
                <AlertItem
                  key={alert.id}
                  alert={alert}
                  canCreate={!readOnly}
                  highlighted={Boolean(highlightedId) && (alert.id === highlightedId || alert.sourceIds.includes(highlightedId as string))}
                />
              ))}
            </ul>
            <AutoAlertsSwitch />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
