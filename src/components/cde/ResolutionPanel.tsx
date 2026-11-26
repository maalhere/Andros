"use client";

import React, { useState } from "react";
import { CheckCircle2, History, Link2, Pencil, RotateCcw } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCanvasReadOnly } from "@/store/useCollabStore";
import { focusNodeOnScreen } from "@/lib/canvas/focusNode";
import { formatResolutionDate } from "@/lib/cde/resolution";
import { setResolutionDone } from "@/lib/cde/resolutionActions";
import type { ResolutionMeta } from "@/types/workspace";
import { AreaBadge, StatusLight } from "./CdeBits";
import { DueLabel, PendingEditor } from "./PendingControls";

// ============================================================================
// ANDROS — BLOQUE DE TRAZABILIDAD DE UNA FICHA DE RESOLUCIÓN (Sprint 18)
// Se pinta dentro de la `form-sheet-node` cuando tiene `resolution`:
// semáforo prominente, código, área, persona asignada, tarjetas afectadas
// (enlaces directos), creación y quién/cuándo la pasó a Verde.
// ============================================================================

const ACTIONS: Record<ResolutionMeta["history"][number]["action"], string> = {
  created: "Creada (Rojo)",
  completed: "Pasada a Verde",
  reopened: "Reabierta (Rojo)",
  edited: "Editada",
};

export const ResolutionPanel: React.FC<{ nodeId: string; meta: ResolutionMeta }> = ({ nodeId, meta }) => {
  const readOnly = useCanvasReadOnly();
  const nodes = useWorkspaceStore((s) => s.nodes);
  const done = meta.status === "done";
  const [editing, setEditing] = useState(false);

  if (editing && !readOnly) {
    return <PendingEditor nodeId={nodeId} meta={meta} onDone={() => setEditing(false)} />;
  }

  return (
    <section aria-label={`Ficha de Resolución ${meta.code}`} className="space-y-2.5">
      <div
        className={`rounded-xl border-2 p-2.5 flex flex-wrap items-center gap-2 ${
          done ? "border-andros-success/60 bg-andros-success/5" : "border-andros-danger/60 bg-andros-danger/5"
        }`}
      >
        <StatusLight status={meta.status} size="lg" />
        <span className="font-mono tabular-nums text-sm font-semibold text-andros-primary">{meta.code}</span>
        {meta.area && <AreaBadge area={meta.area} className="ml-auto" />}
      </div>

      <p className="text-sm leading-relaxed text-andros-primary whitespace-pre-wrap break-words">{meta.description}</p>

      <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-1 text-[11px] leading-relaxed">
        <dt className="text-andros-muted">Asignado a</dt>
        <dd className="text-andros-primary">{meta.assigneeName || (meta.area ? `Equipo @${meta.area}` : "Sin asignar")}</dd>
        {meta.dueAt && (
          <>
            <dt className="text-andros-muted">Fecha límite</dt>
            <dd>
              <DueLabel dueAt={meta.dueAt} done={done} />
            </dd>
          </>
        )}
        <dt className="text-andros-muted">Creada</dt>
        <dd className="text-andros-primary">
          {formatResolutionDate(meta.createdAt)} · {meta.createdBy}
        </dd>
        {done && (
          <>
            <dt className="text-andros-muted">En Verde</dt>
            <dd className="text-andros-success font-medium">
              {formatResolutionDate(meta.completedAt)} · {meta.completedBy}
            </dd>
          </>
        )}
      </dl>

      {meta.affectedNodeIds.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-andros-muted">Tarjetas afectadas</p>
          <ul className="mt-1 flex flex-wrap gap-1" data-no-drag>
            {meta.affectedNodeIds.map((id) => {
              const title = nodes.find((n) => n.id === id)?.title ?? null;
              return (
                <li key={id} className="max-w-full">
                  <button
                    type="button"
                    disabled={!title}
                    onClick={() => focusNodeOnScreen(id)}
                    className="max-w-full min-h-11 md:min-h-0 px-1.5 py-0.5 rounded-md border border-andros-border bg-andros-canvas text-[11px] text-andros-accent-ink hover:underline underline-offset-2 disabled:text-andros-muted disabled:no-underline flex items-center gap-1"
                  >
                    <Link2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{title ? `«${title}»` : "Tarjeta eliminada"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <details className="text-[11px] text-andros-muted">
        <summary className="min-h-11 md:min-h-0 flex items-center gap-1 cursor-pointer select-none">
          <History className="w-3 h-3" aria-hidden="true" />
          Historial (<span className="font-mono tabular-nums">{meta.history.length}</span>)
        </summary>
        <ol className="mt-1 space-y-0.5 pl-4">
          {meta.history.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              {ACTIONS[e.action]}
              {e.detail ? ` (${e.detail})` : ""} · {e.by} · {formatResolutionDate(e.at)}
            </li>
          ))}
        </ol>
      </details>

      {!readOnly && (
        <div data-no-drag className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-11 md:min-h-9 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro"
          >
            <Pencil className="w-3.5 h-3.5 text-andros-accent-ink" aria-hidden="true" />
            Editar
          </button>
          <button
            type="button"
            onClick={() => setResolutionDone(nodeId, !done)}
            className={`flex-1 min-h-11 md:min-h-9 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro ${
              done
                ? "border-andros-border text-andros-primary hover:bg-andros-border/40"
                : "border-andros-success/60 bg-andros-success/10 text-andros-success hover:bg-andros-success/15"
            }`}
          >
            {done ? <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
            {done ? "Reabrir (volver a Rojo)" : "Marcar como completada (Verde)"}
          </button>
        </div>
      )}
    </section>
  );
};
