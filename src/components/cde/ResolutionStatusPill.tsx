"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { listResolutions, RESOLUTION_STATUS_COLOR, RESOLUTION_STATUS_LABEL } from "@/lib/cde/resolution";
import type { ResolutionStatus } from "@/types/workspace";
import { AreaBadge, StatusLight } from "./CdeBits";

// ============================================================================
// ANDROS — FILTRO RÁPIDO ROJO / VERDE DE LAS FICHAS DE RESOLUCIÓN (Sprint 18)
// Dos contadores de un vistazo (Rojo = Pendientes, Verde = Completadas). Al
// pulsar uno se despliega la lista filtrada; cada ficha lleva a su tarjeta.
// Solo aparece si el lienzo tiene alguna Ficha de Resolución.
// ============================================================================

export const ResolutionStatusPill: React.FC<{ variant?: "bar" | "stack" }> = ({ variant = "bar" }) => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const all = useMemo(() => listResolutions(nodes), [nodes]);
  const [filter, setFilter] = useState<ResolutionStatus | null>(null);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filter) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setFilter(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setFilter(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [filter]);

  if (all.length === 0) return null;
  const pending = all.filter((r) => r.meta.status === "pending");
  const done = all.filter((r) => r.meta.status === "done");
  const shown = filter === "done" ? done : filter === "pending" ? pending : [];

  const segment = (status: ResolutionStatus, count: number) => {
    const red = status === "pending";
    const active = filter === status;
    return (
      <button
        type="button"
        aria-expanded={active}
        aria-controls={active ? listId : undefined}
        aria-label={`${RESOLUTION_STATUS_COLOR[status]}: ${count} ${red ? "fichas pendientes" : "fichas completadas"}`}
        onClick={() => setFilter(active ? null : status)}
        className={`min-h-11 md:min-h-0 h-full px-2.5 flex items-center gap-1.5 text-xs font-medium active:scale-[0.96] spring-micro ${
          active ? (red ? "bg-andros-danger/10" : "bg-andros-success/10") : "hover:bg-andros-border/40"
        } ${red ? "text-andros-danger rounded-l-lg" : "text-andros-success rounded-r-lg"}`}
      >
        <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${red ? "bg-andros-danger" : "bg-andros-success"}`} />
        <span className="font-mono tabular-nums">{count}</span>
        <span className={variant === "bar" ? "hidden lg:inline" : ""}>{red ? "Pendientes" : "Completadas"}</span>
      </button>
    );
  };

  return (
    <div ref={rootRef} className={`relative ${variant === "stack" ? "w-full" : ""}`}>
      <div
        role="group"
        aria-label="Fichas de Resolución: Rojo y Verde"
        className={`flex items-stretch ${variant === "bar" ? "h-11 md:h-9" : "min-h-11"} p-0.5 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm ${
          variant === "stack" ? "w-full [&>button]:flex-1" : ""
        }`}
      >
        {segment("pending", pending.length)}
        <span aria-hidden="true" className="w-px my-1.5 bg-andros-border" />
        {segment("done", done.length)}
      </div>
      {filter && (
        <div
          id={listId}
          className={`absolute z-50 mt-2 ${variant === "bar" ? "right-0 w-80" : "left-0 right-0"} max-h-[60vh] overflow-y-auto p-2 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark`}
        >
          <p className="px-1 pb-1.5 text-[11px] font-medium text-andros-muted">
            {RESOLUTION_STATUS_COLOR[filter]} · {RESOLUTION_STATUS_LABEL[filter]}
          </p>
          {shown.length === 0 ? (
            <p className="px-1 pb-1 text-xs text-andros-muted">
              {filter === "pending" ? "No hay fichas pendientes." : "Todavía no hay fichas completadas."}
            </p>
          ) : (
            <ul className="space-y-1">
              {shown.map((r) => (
                <li key={r.nodeId}>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter(null);
                      focusNodeOnScreen(r.nodeId);
                    }}
                    className="w-full min-h-11 md:min-h-0 text-left p-2 rounded-xl border border-andros-border bg-andros-canvas hover:border-andros-border-active active:scale-[0.98] spring-micro"
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono tabular-nums text-[11px] font-semibold text-andros-primary">{r.meta.code}</span>
                      <StatusLight status={r.meta.status} />
                      {r.meta.area && <AreaBadge area={r.meta.area} className="ml-auto" />}
                    </span>
                    <span className="mt-1 block text-xs leading-snug text-andros-primary line-clamp-2">{r.meta.description}</span>
                    {r.meta.status === "done" && r.meta.completedBy && (
                      <span className="mt-0.5 block text-[11px] text-andros-muted">Completada por {r.meta.completedBy}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
