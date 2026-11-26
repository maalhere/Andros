"use client";

import React, { useId, useMemo, useState } from "react";
import { AlarmClock, Check, Link2, Plus, X } from "lucide-react";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useCdeStore } from "@/store/useCdeStore";
import { useNowMinute } from "@/hooks/useNow";
import {
  DUE_SHORTCUTS,
  canvasAreas,
  dueFromShortcut,
  dueState,
  formatDue,
  fromLocalInputValue,
  parseQuickAlarm,
  toLocalInputValue,
  type DueState,
} from "@/lib/cde/pending";
import { areaKey } from "@/lib/cde/areas";
import { createQuickAlarm, updateResolutionCard } from "@/lib/cde/resolutionActions";
import type { ResolutionMeta, ResolutionStatus } from "@/types/workspace";

// ============================================================================
// ANDROS — EDICIÓN DIRECTA DE PENDIENTES Y «+ ALARMA RÁPIDA» (Sprint 24)
//   · PendingEditor: cambia descripción, @Área, persona, fecha límite, estado
//     (Rojo ⇄ Verde) y tarjetas vinculadas de un pendiente ya creado.
//   · QuickAlarmBar: crea un pendiente en un paso, escrito de corrido
//     («Confirmar el audio mañana a las 10 @Logística») o con atajos de 1 clic.
// Ambos se guardan al instante en el store (→ nube y sala en vivo). Quien
// solo puede leer no ve estos controles.
// ============================================================================

const INPUT =
  "w-full min-w-0 h-11 md:h-8 px-2.5 rounded-lg bg-andros-canvas border border-andros-border outline-none text-[12px] text-andros-primary placeholder:text-andros-muted focus:border-andros-accent";
const CHIP_BASE =
  "min-h-11 md:min-h-7 px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1 active:scale-[0.96] spring-micro";
const chipClass = (active: boolean) =>
  `${CHIP_BASE} ${
    active
      ? "border-andros-accent bg-andros-accent/10 text-andros-primary"
      : "border-andros-border text-andros-muted hover:text-andros-primary hover:border-andros-border-active"
  }`;

export const DUE_TONE: Record<DueState, string> = {
  overdue: "text-andros-danger",
  today: "text-andros-warning",
  soon: "text-andros-primary",
  later: "text-andros-muted",
};

/** Texto corto del vencimiento con su color («Vencida · ayer 18:00»). */
export const DueLabel: React.FC<{ dueAt: string | null | undefined; done?: boolean; className?: string }> = ({ dueAt, done, className = "" }) => {
  const now = useNowMinute();
  const state = dueState(dueAt, now);
  if (!state) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${done ? "text-andros-muted" : DUE_TONE[state]} ${className}`}>
      <AlarmClock className="w-3 h-3 shrink-0" aria-hidden="true" />
      {done ? formatDue(dueAt, now).replace(/^Vencida · /, "") : formatDue(dueAt, now)}
    </span>
  );
};

/** Hoy · Mañana · En 3 días · Próxima semana + fecha y hora exactas. */
const DuePicker: React.FC<{ value: string | null; onChange: (value: string | null) => void }> = ({ value, onChange }) => {
  const now = useNowMinute();
  const inputId = useId();
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Vencimiento rápido">
        {DUE_SHORTCUTS.map((s) => {
          const due = dueFromShortcut(s.id, now);
          const active = value === due;
          return (
            <button key={s.id} type="button" aria-pressed={active} onClick={() => onChange(active ? null : due)} className={chipClass(active)}>
              {s.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          Fecha y hora límite
        </label>
        <input
          id={inputId}
          type="datetime-local"
          value={toLocalInputValue(value)}
          onChange={(e) => onChange(fromLocalInputValue(e.target.value))}
          className={`${INPUT} font-mono tabular-nums`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Quitar la fecha límite"
            className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

function useAreaOptions(): string[] {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const spaceAreas = useCdeStore((s) => s.areas);
  return useMemo(() => canvasAreas(nodes, spaceAreas), [nodes, spaceAreas]);
}

const AreaChips: React.FC<{ areas: string[]; value: string; onChange: (area: string) => void }> = ({ areas, value, onChange }) =>
  areas.length === 0 ? (
    <p className="text-[11px] text-andros-muted">Sin áreas en este espacio todavía.</p>
  ) : (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Área responsable">
      {areas.map((a) => {
        const active = Boolean(value) && areaKey(a) === areaKey(value);
        return (
          <button key={a} type="button" aria-pressed={active} onClick={() => onChange(active ? "" : a)} className={chipClass(active)}>
            @{a}
          </button>
        );
      })}
    </div>
  );

/** Selector de ficha o nodo del lienzo al que lleva la alarma. */
const NodeLinkSelect: React.FC<{ excludeId?: string; exclude?: readonly string[]; value: string; onChange: (id: string) => void }> = ({
  excludeId,
  exclude = [],
  value,
  onChange,
}) => {
  const nodes = useWorkspaceStore((s) => s.nodes);
  const options = nodes.filter((n) => n.id !== excludeId && !exclude.includes(n.id) && !(n.type === "form-sheet-node" && n.formSheetData.resolution));
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Vincular a una ficha o nodo del lienzo"
      className={INPUT}
    >
      <option value="">Sin vincular a un nodo</option>
      {options.slice(0, 80).map((n) => (
        <option key={n.id} value={n.id}>
          {(n.title || "Sin título").slice(0, 60)}
        </option>
      ))}
    </select>
  );
};

const stopKeys = (onEscape: () => void) => (e: React.KeyboardEvent) => {
  e.stopPropagation();
  if (e.key === "Escape") {
    e.preventDefault();
    onEscape();
  }
};

// ----------------------------------------------------------------------------
// Edición directa
// ----------------------------------------------------------------------------

export const PendingEditor: React.FC<{ nodeId: string; meta: ResolutionMeta; onDone: () => void }> = ({ nodeId, meta, onDone }) => {
  const areas = useAreaOptions();
  const people = useCdeStore((s) => s.people);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const [description, setDescription] = useState(meta.description);
  const [area, setArea] = useState(meta.area);
  const [assigneeName, setAssigneeName] = useState(meta.assigneeName);
  const [assigneeId, setAssigneeId] = useState<string | null>(meta.assigneeId);
  const [dueAt, setDueAt] = useState<string | null>(meta.dueAt ?? null);
  const [status, setStatus] = useState<ResolutionStatus>(meta.status);
  const [linked, setLinked] = useState<string[]>(meta.affectedNodeIds);
  const ids = useId();

  const save = () => {
    updateResolutionCard(nodeId, { description, area, assigneeName, assigneeId, dueAt, status, affectedNodeIds: linked });
    onDone();
  };
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? "Tarjeta eliminada";

  return (
    <form
      data-no-drag
      aria-label={`Editar ${meta.code}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={stopKeys(onDone)}
      className="p-2 rounded-xl border border-andros-border bg-andros-card space-y-2 text-left"
    >
      <div className="space-y-1">
        <label htmlFor={`${ids}-desc`} className="block text-[11px] font-medium text-andros-muted">
          Qué hay que resolver
        </label>
        <textarea
          id={`${ids}-desc`}
          value={description}
          maxLength={600}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          className="w-full min-w-0 resize-y rounded-lg bg-andros-canvas border border-andros-border outline-none p-2 text-[12px] leading-relaxed text-andros-primary focus:border-andros-accent"
        />
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-andros-muted">Estado</p>
        <div className="flex gap-1" role="radiogroup" aria-label="Estado del pendiente">
          {(["pending", "done"] as const).map((s) => {
            const active = status === s;
            const red = s === "pending";
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setStatus(s)}
                className={`${CHIP_BASE} flex-1 justify-center ${
                  active
                    ? red
                      ? "border-andros-danger/60 bg-andros-danger/10 text-andros-danger"
                      : "border-andros-success/60 bg-andros-success/10 text-andros-success"
                    : "border-andros-border text-andros-muted hover:text-andros-primary"
                }`}
              >
                <span aria-hidden="true" className={`w-2 h-2 rounded-full ${red ? "bg-andros-danger" : "bg-andros-success"}`} />
                {red ? "Rojo · Pendiente" : "Verde · Resuelto"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-andros-muted">Fecha límite (alarma)</p>
        <DuePicker value={dueAt} onChange={setDueAt} />
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-andros-muted">Área responsable</p>
        <AreaChips areas={areas} value={area} onChange={setArea} />
      </div>

      <div className="space-y-1">
        <label htmlFor={`${ids}-who`} className="block text-[11px] font-medium text-andros-muted">
          Persona asignada
        </label>
        <input
          id={`${ids}-who`}
          list={`${ids}-people`}
          value={assigneeName}
          maxLength={120}
          placeholder="Nombre de quien lo resuelve"
          onChange={(e) => {
            const name = e.target.value;
            setAssigneeName(name);
            setAssigneeId(people.find((p) => p.name === name)?.userId ?? null);
          }}
          className={INPUT}
        />
        <datalist id={`${ids}-people`}>
          {people.map((p) => (
            <option key={p.userId} value={p.name}>
              {p.area ? `@${p.area}` : ""}
            </option>
          ))}
        </datalist>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-andros-muted">Fichas o nodos vinculados</p>
        {linked.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {linked.map((id) => (
              <li key={id} className="max-w-full">
                <span className="max-w-full inline-flex items-center gap-1 pl-1.5 rounded-md border border-andros-border bg-andros-canvas text-[11px] text-andros-primary">
                  <Link2 className="w-3 h-3 shrink-0 text-andros-accent-ink" aria-hidden="true" />
                  <span className="truncate">«{titleOf(id)}»</span>
                  <button
                    type="button"
                    onClick={() => setLinked((list) => list.filter((x) => x !== id))}
                    aria-label={`Desvincular «${titleOf(id)}»`}
                    className="hit-slop p-1 rounded text-andros-muted hover:text-andros-danger"
                  >
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <NodeLinkSelect excludeId={nodeId} exclude={linked} value="" onChange={(id) => id && setLinked((list) => [...list, id])} />
      </div>

      <div className="flex gap-1.5 pt-0.5">
        <button
          type="submit"
          className="flex-1 min-h-11 md:min-h-8 px-3 rounded-xl bg-andros-accent-fill text-white text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro"
        >
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          Guardar cambios
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 md:min-h-8 px-3 rounded-xl border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
};

// ----------------------------------------------------------------------------
// «+ Alarma rápida»
// ----------------------------------------------------------------------------

export const QuickAlarmBar: React.FC<{ onCreated?: (id: string) => void; onClose?: () => void }> = ({ onCreated, onClose }) => {
  const areas = useAreaOptions();
  const now = useNowMinute();
  const [text, setText] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState<string | null | undefined>(undefined);
  const [link, setLink] = useState("");
  const inputId = useId();

  const parsed = useMemo(() => parseQuickAlarm(text, areas, now), [text, areas, now]);
  const effectiveArea = area ?? parsed.area;
  const effectiveDue = dueAt === undefined ? parsed.dueAt : dueAt;

  const create = () => {
    const id = createQuickAlarm({ description: parsed.description, area: effectiveArea, dueAt: effectiveDue, linkNodeId: link || null });
    if (!id) return;
    setText("");
    setArea(null);
    setDueAt(undefined);
    setLink("");
    onCreated?.(id);
  };

  return (
    <form
      data-no-drag
      aria-label="Alarma rápida"
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
      onKeyDown={stopKeys(() => onClose?.())}
      className="space-y-2 text-left"
    >
      <div className="space-y-1">
        <label htmlFor={inputId} className="block text-[11px] font-medium text-andros-muted">
          Escribe la alarma de corrido
        </label>
        <input
          id={inputId}
          autoFocus
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ej.: Confirmar el proveedor de audio mañana a las 10 @Logística"
          className={INPUT}
        />
        {(parsed.area || parsed.dueAt) && (
          <p className="text-[11px] text-andros-muted" aria-live="polite">
            Entendido:{parsed.area && <span className="text-andros-primary"> @{parsed.area}</span>}
            {parsed.dueAt && <span className="text-andros-primary"> · {formatDue(parsed.dueAt, now)}</span>}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-andros-muted">Vence</p>
        <DuePicker value={effectiveDue ?? null} onChange={(v) => setDueAt(v)} />
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-andros-muted">Asignar a un área</p>
        <AreaChips areas={areas} value={effectiveArea} onChange={(a) => setArea(a)} />
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-andros-muted">Llevar a una ficha o nodo al hacer clic</p>
        <NodeLinkSelect value={link} onChange={setLink} />
      </div>

      <button
        type="submit"
        disabled={!parsed.description}
        className="w-full min-h-11 md:min-h-9 px-3 rounded-xl bg-andros-accent-fill text-white text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        Crear alarma en Rojo
      </button>
    </form>
  );
};
