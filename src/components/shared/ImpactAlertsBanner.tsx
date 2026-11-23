"use client";

import React, { useEffect, useId, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, ClipboardCopy, Info, TriangleAlert } from "lucide-react";
import { useImpactStore } from "@/store/useImpactStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useTabsBarVisible } from "@/store/useTabsStore";
import { useAutoImpactAlerts, useSettingsStore } from "@/store/useSettingsStore";
import { springOrInstant } from "@/lib/motion";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { copyAlertNotice, resolveAlertWithUndo } from "@/lib/canvas/impactClient";
import type { ImpactAlertEntry } from "@/lib/canvas/impact";

// ============================================================================
// ANDROS — PASTILLA Y PANEL DE DESCUADRES (detector anti-malentendidos)
//
// Solo aparece si hay alertas activas. La pastilla muestra el conteo; el panel
// lista cada alerta con «Ir a la tarjeta», «Copiar aviso» (WhatsApp / sala de
// voz) y «Marcar resuelto» (con «Deshacer»). Las altas y bajas viajan a la sala
// en vivo por `canvasSync` (alert:upsert / alert:resolve).
//   · `floating`: escritorio, fija bajo la barra superior.
//   · `stack`: dentro de la pila de tarjetas del teléfono.
// ============================================================================

interface Props {
  variant: "floating" | "stack";
}

const AlertItem: React.FC<{ alert: ImpactAlertEntry; highlighted: boolean; onFocus: () => void }> = ({
  alert,
  highlighted,
  onFocus,
}) => {
  const warning = alert.severity === "warning";
  const Icon = warning ? TriangleAlert : Info;
  return (
    <li
      className={`rounded-xl border p-2.5 ${
        // Resaltado solo con borde y anillo: el texto gris mantiene AA sobre el fondo neutro.
        highlighted
          ? "border-andros-warning ring-1 ring-andros-warning/40 bg-andros-canvas"
          : "border-andros-border bg-andros-canvas"
      }`}
    >
      <button
        type="button"
        onClick={onFocus}
        aria-label={`Ir a la tarjeta «${alert.targetTitle}»`}
        className="w-full min-h-11 md:min-h-0 flex items-start gap-2 text-left rounded-lg active:scale-[0.98] spring-micro"
      >
        <Icon
          className={`w-4 h-4 mt-0.5 shrink-0 ${warning ? "text-andros-warning" : "text-andros-accent-ink"}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-andros-primary truncate">{alert.targetTitle}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-andros-primary">{alert.summary}</span>
        </span>
      </button>

      <dl className="mt-1.5 pl-6 space-y-0.5 text-[11px] leading-relaxed text-andros-muted">
        {alert.suggestedAction && (
          <div>
            <dt className="inline font-medium text-andros-primary">Sugerencia: </dt>
            <dd className="inline">{alert.suggestedAction}</dd>
          </div>
        )}
        {alert.notifyWho && (
          <div>
            <dt className="inline font-medium text-andros-primary">Avisar a: </dt>
            <dd className="inline">{alert.notifyWho}</dd>
          </div>
        )}
        <div>
          <dt className="sr-only">Origen: </dt>
          <dd>
            Tras cambiar «{alert.sourceTitle}»{alert.authorName ? ` (${alert.authorName})` : ""}
          </dd>
        </div>
      </dl>

      <div className="mt-2 pl-6 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void copyAlertNotice(alert)}
          className="min-h-11 md:min-h-8 px-2.5 rounded-lg border border-andros-border bg-andros-card text-[11px] font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
        >
          <ClipboardCopy className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
          Copiar aviso
        </button>
        <button
          type="button"
          onClick={() => resolveAlertWithUndo(alert)}
          className="min-h-11 md:min-h-8 px-2.5 rounded-lg border border-andros-border bg-andros-card text-[11px] font-medium text-andros-primary hover:bg-andros-border/40 flex items-center gap-1.5 active:scale-[0.96] spring-micro"
        >
          <Check className="w-3.5 h-3.5 text-andros-success" aria-hidden="true" />
          Marcar resuelto
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
        Alertas automáticas al guardar un cambio
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={labelId}
        onClick={() => useSettingsStore.getState().applyPreferences({ autoImpactAlerts: !enabled })}
        className="hit-slop relative w-11 h-6 rounded-full shrink-0 spring-micro"
      >
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full ${enabled ? "bg-andros-accent-fill" : "bg-andros-border-active"}`}
        />
        <span
          aria-hidden="true"
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow"
          style={{ transform: enabled ? "translateX(20px)" : "translateX(0)", transition: "transform 180ms var(--ease-out-micro)" }}
        />
      </button>
    </div>
  );
};

export const ImpactAlertsBanner: React.FC<Props> = ({ variant }) => {
  const alerts = useImpactStore((s) => s.alerts);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const panelOpen = useImpactStore((s) => s.panelOpen);
  const highlightedId = useImpactStore((s) => s.highlightedAlertId);
  const setPanelOpen = useImpactStore((s) => s.setPanelOpen);
  const hasTabs = useTabsBarVisible();
  const prefersReduced = useReducedMotion() ?? false;
  const animations = useSettingsStore((s) => s.animations);
  const reduced = prefersReduced || animations === "reduced";
  const panelId = useId();

  // Solo cuentan las alertas cuya tarjeta sigue en este espacio.
  const visible = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return alerts.filter((a) => ids.has(a.targetNodeId));
  }, [alerts, nodes]);
  const count = visible.length;
  const warnings = visible.filter((a) => a.severity === "warning").length;

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

  if (count === 0) return null;

  const open = panelOpen;
  const placement =
    variant === "floating"
      ? `fixed z-40 left-24 ${hasTabs ? "top-24" : "top-[3.75rem]"} w-[min(26rem,calc(100vw-8rem))]`
      : "w-full";

  return (
    <section aria-label="Descuadres entre tarjetas" className={placement}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setPanelOpen(!open)}
        className={`min-h-11 md:min-h-9 pl-2.5 pr-2 rounded-xl border border-andros-warning/50 bg-andros-card shadow-hud-light dark:shadow-hud-dark flex items-center gap-2 text-xs font-medium text-andros-primary hover:bg-andros-warning/10 active:scale-[0.96] spring-micro ${
          variant === "stack" ? "w-full" : ""
        }`}
      >
        <TriangleAlert
          className={`w-4 h-4 shrink-0 ${warnings > 0 ? "text-andros-warning" : "text-andros-accent-ink"}`}
          aria-hidden="true"
        />
        <span className="flex-1 text-left">
          <span className="font-mono tabular-nums font-semibold">{count}</span>{" "}
          {count === 1 ? "tarjeta por revisar tras un cambio" : "tarjetas por revisar tras cambios"}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-andros-muted spring-micro ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
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
              {visible.map((alert) => (
                <AlertItem
                  key={alert.id}
                  alert={alert}
                  highlighted={alert.id === highlightedId}
                  onFocus={() => {
                    useImpactStore.setState({ highlightedAlertId: alert.id });
                    focusNodeOnScreen(alert.targetNodeId);
                  }}
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
