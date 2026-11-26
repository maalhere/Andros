"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlarmClockPlus, Pencil } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { usePendingStore, type PendingPanelMode } from "@/store/usePendingStore";
import { useNowMinute } from "@/hooks/useNow";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { listResolutions, RESOLUTION_STATUS_COLOR, RESOLUTION_STATUS_LABEL } from "@/lib/cde/resolution";
import { dueState } from "@/lib/cde/pending";
import type { ResolutionStatus } from "@/types/workspace";
import { AreaBadge, StatusLight } from "./CdeBits";
import { DueLabel, PendingEditor, QuickAlarmBar } from "./PendingControls";

// ============================================================================
// ANDROS — ALERTA DE PENDIENTES: SEMÁFORO ROJO / VERDE EDITABLE (Sprint 18 → 24)
// Dos contadores de un vistazo (Rojo = Pendientes, Verde = Completadas) y un
// botón «+ Alarma rápida». Al pulsar un contador se despliega la lista: cada
// pendiente lleva a su tarjeta y se edita en el sitio (lápiz) sin borrarlo.
// Quien solo puede leer ve la lista pero no edita ni crea alarmas.
// ============================================================================

export const ResolutionStatusPill: React.FC<{ variant?: "bar" | "stack" }> = ({ variant = "bar" }) => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const all = useMemo(() => listResolutions(nodes), [nodes]);
  const readOnly = useCanvasReadOnly();
  const mode = usePendingStore((s) => s.mode);
  const setMode = usePendingStore((s) => s.setMode);
  const [editing, setEditing] = useState<string | null>(null);
  const now = useNowMinute();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // Sin permiso de edición la barra rápida no existe.
  const filter: PendingPanelMode | null = mode === "new" && readOnly ? null : mode;

  useEffect(() => {
    if (!filter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setMode(null);
      setEditing(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setMode(null);
        setEditing(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [filter, setMode]);

  if (all.length === 0 && readOnly) return null;
  const pending = all.filter((r) => r.meta.status === "pending");
  const done = all.filter((r) => r.meta.status === "done");
  const overdue = pending.filter((r) => dueState(r.meta.dueAt, now) === "overdue").length;
  const shown = filter === "done" ? done : filter === "pending" ? pending : [];
  // Rojo: lo que vence antes primero; sin fecha al final.
  const sorted =
    filter === "pending"
      ? [...shown].sort((a, b) => (Date.parse(a.meta.dueAt ?? "") || Infinity) - (Date.parse(b.meta.dueAt ?? "") || Infinity))
      : shown;

  const toggle = (next: PendingPanelMode) => {
    setEditing(null);
    setMode(filter === next ? null : next);
  };

  const segment = (status: ResolutionStatus, count: number) => {
    const red = status === "pending";
    const active = filter === status;
    return (
      <button
        type="button"
        aria-expanded={active}
        aria-controls={active ? listId : undefined}
        aria-label={`${RESOLUTION_STATUS_COLOR[status]}: ${count} ${red ? "pendientes" : "completados"}${red && overdue > 0 ? `, ${overdue} vencidos` : ""}`}
        onClick={() => toggle(status)}
        className={`relative min-h-11 md:min-h-0 h-full px-2.5 flex items-center gap-1.5 text-xs font-medium active:scale-[0.96] spring-micro ${
          active ? (red ? "bg-andros-danger/10" : "bg-andros-success/10") : "hover:bg-andros-border/40"
        } ${red ? "text-andros-danger rounded-l-lg" : `text-andros-success ${readOnly ? "rounded-r-lg" : ""}`} ${variant === "stack" ? "flex-1 justify-center" : ""}`}
      >
        <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${red ? "bg-andros-danger" : "bg-andros-success"}`} />
        <span className="font-mono tabular-nums">{count}</span>
        <span className={variant === "bar" ? "hidden lg:inline" : ""}>{red ? "Pendientes" : "Completadas"}</span>
        {red && overdue > 0 && <span aria-hidden="true" className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-andros-warning" />}
      </button>
    );
  };

  return (
    <div ref={rootRef} data-tour="pending" className={`relative ${variant === "stack" ? "w-full" : ""}`}>
      <div
        role="group"
        aria-label="Alerta de pendientes: Rojo y Verde"
        className={`flex items-stretch ${variant === "bar" ? "h-11 md:h-9" : "min-h-11"} p-0.5 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm ${
          variant === "stack" ? "w-full" : ""
        }`}
      >
        {segment("pending", pending.length)}
        <span aria-hidden="true" className="w-px my-1.5 bg-andros-border" />
        {segment("done", done.length)}
        {!readOnly && (
          <>
            <span aria-hidden="true" className="w-px my-1.5 bg-andros-border" />
            <button
              type="button"
              aria-expanded={filter === "new"}
              aria-controls={filter === "new" ? listId : undefined}
              aria-label="Alarma rápida: crear un pendiente"
              title="+ Alarma rápida"
              onClick={() => toggle("new")}
              className={`min-h-11 min-w-11 md:min-h-0 md:min-w-0 h-full px-2 rounded-r-lg flex items-center justify-center text-andros-accent-ink active:scale-[0.96] spring-micro ${
                filter === "new" ? "bg-andros-accent/10" : "hover:bg-andros-border/40"
              }`}
            >
              <AlarmClockPlus className="w-4 h-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {filter && (
        <div
          id={listId}
          className={`absolute z-50 mt-2 ${variant === "bar" ? "right-0 w-[22rem]" : "left-0 right-0"} max-h-[70vh] overflow-y-auto p-2 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark`}
        >
          {filter === "new" ? (
            <>
              <p className="px-1 pb-1.5 text-[11px] font-medium text-andros-muted">+ Alarma rápida · nace en Rojo (Pendiente)</p>
              <QuickAlarmBar onClose={() => setMode(null)} onCreated={() => setMode("pending")} />
            </>
          ) : (
            <>
              <p className="px-1 pb-1.5 text-[11px] font-medium text-andros-muted">
                {RESOLUTION_STATUS_COLOR[filter]} · {RESOLUTION_STATUS_LABEL[filter]}
                {!readOnly && " · toca el lápiz para editar"}
              </p>
              {sorted.length === 0 ? (
                <div className="px-1 pb-1 space-y-2">
                  <p className="text-xs text-andros-muted">
                    {filter === "pending" ? "No hay pendientes." : "Todavía no hay pendientes completados."}
                  </p>
                  {!readOnly && filter === "pending" && (
                    <button type="button" onClick={() => toggle("new")} className="text-xs font-medium text-andros-accent-ink hover:underline underline-offset-2">
                      Crear una alarma rápida
                    </button>
                  )}
                </div>
              ) : (
                <ul className="space-y-1">
                  {sorted.map((r) =>
                    editing === r.nodeId && !readOnly ? (
                      <li key={r.nodeId}>
                        <PendingEditor nodeId={r.nodeId} meta={r.meta} onDone={() => setEditing(null)} />
                      </li>
                    ) : (
                      <li key={r.nodeId} className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setMode(null);
                            focusNodeOnScreen(r.meta.affectedNodeIds.find((id) => nodes.some((n) => n.id === id)) ?? r.nodeId);
                          }}
                          className="w-full min-h-11 md:min-h-0 text-left p-2 pr-12 rounded-xl border border-andros-border bg-andros-canvas hover:border-andros-border-active active:scale-[0.98] spring-micro"
                        >
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono tabular-nums text-[11px] font-semibold text-andros-primary">{r.meta.code}</span>
                            <StatusLight status={r.meta.status} />
                            {r.meta.area && <AreaBadge area={r.meta.area} />}
                          </span>
                          <span className="mt-1 block text-xs leading-snug text-andros-primary line-clamp-2">{r.meta.description}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-andros-muted">
                            <DueLabel dueAt={r.meta.dueAt} done={r.meta.status === "done"} />
                            {r.meta.assigneeName && <span>{r.meta.assigneeName}</span>}
                            {r.meta.status === "done" && r.meta.completedBy && <span>Completada por {r.meta.completedBy}</span>}
                          </span>
                        </button>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setEditing(r.nodeId)}
                            aria-label={`Editar ${r.meta.code}`}
                            title="Editar"
                            className="absolute top-1.5 right-1.5 w-11 h-11 md:w-8 md:h-8 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center justify-center active:scale-[0.96] spring-micro"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    )
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
