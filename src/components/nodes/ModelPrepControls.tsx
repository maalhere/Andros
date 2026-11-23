"use client";

import React, { useState } from "react";
import { Download, LoaderCircle, Lock, LockOpen, Maximize2, RotateCcw } from "lucide-react";
import {
  MAX_SCALE,
  MIN_SCALE,
  clampScaleFactor,
  fitToBedScale,
  isIdentityScale,
  isUniformScale,
  multiplyScale,
  type ModelScale,
  type ScaleDimensions,
} from "@/lib/3d/modelScale";

// ============================================================================
// CONTROLES DE PREPARACIÓN 3D (compartidos por el visor del nodo y el modal
// de impresión): escala en % y mm con candado de proporción, interruptor de
// soportes automáticos y botón de descarga del .stl preparado.
// ============================================================================

type Variant = "canvas" | "stack";

function formatMmInput(value: number): string {
  return value >= 100 ? value.toFixed(1) : value.toFixed(2);
}

/** Campo numérico que solo aplica el valor al confirmar (Enter o al salir). */
function NumberField({
  value,
  format,
  onCommit,
  ariaLabel,
  suffix,
  disabled,
  touch,
}: {
  value: number;
  format: (n: number) => string;
  onCommit: (n: number) => void;
  ariaLabel: string;
  suffix: string;
  disabled?: boolean;
  touch: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number.parseFloat(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(parsed) && parsed > 0) onCommit(parsed);
  };

  return (
    <label
      className={`${touch} w-full min-w-0 px-2 rounded-lg border border-andros-border-active bg-andros-card flex items-center gap-1 focus-within:border-andros-accent ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <input
        value={draft ?? format(value)}
        onFocus={() => setDraft(format(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        inputMode="decimal"
        disabled={disabled}
        aria-label={ariaLabel}
        className="w-full min-w-0 bg-transparent text-xs font-mono tabular-nums font-semibold text-andros-primary text-right focus:outline-none"
      />
      <span className="shrink-0 text-[10px] text-andros-muted">{suffix}</span>
    </label>
  );
}

// ----------------------------------------------------------------------------
// Escala
// ----------------------------------------------------------------------------

export function ModelScalePanel({
  baseDims,
  scale,
  onChange,
  variant,
}: {
  /** Medidas originales del archivo (al 100 %). */
  baseDims: ScaleDimensions;
  scale: ModelScale;
  onChange: (next: ModelScale) => void;
  variant: Variant;
}) {
  const [locked, setLocked] = useState(true);
  const touch = variant === "stack" ? "min-h-[44px]" : "min-h-[32px]";
  const uniform = isUniformScale(scale);
  const percent = Math.round(scale[0] * 1000) / 10;

  const axes = [
    { label: "Ancho", axis: "X", base: baseDims.widthMm },
    { label: "Profundidad", axis: "Y", base: baseDims.depthMm },
    { label: "Alto", axis: "Z", base: baseDims.heightMm },
  ];

  /** Escala general: se aplica proporcionalmente (respeta escalas por eje). */
  const setPercent = (pct: number) => onChange(multiplyScale(scale, pct / 100 / scale[0]));

  const setAxisMm = (index: number, mm: number) => {
    const base = axes[index].base;
    if (!(base > 0)) return;
    if (locked) {
      onChange(multiplyScale(scale, mm / (base * scale[index])));
    } else {
      const next: ModelScale = [...scale];
      next[index] = clampScaleFactor(mm / base);
      onChange(next);
    }
  };

  return (
    <div data-no-drag className="rounded-xl bg-andros-canvas border border-andros-border p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-andros-primary">Escala de la pieza</span>
        <button
          type="button"
          onClick={() => setLocked((v) => !v)}
          aria-pressed={locked}
          title={locked ? "Proporción bloqueada: los tres ejes cambian juntos" : "Ejes libres: cada medida cambia por separado"}
          className={`${touch} px-2 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 active:scale-[0.96] spring-micro ${
            locked
              ? "border-andros-accent bg-andros-accent/10 text-andros-accent-ink"
              : "border-andros-border-active text-andros-muted hover:text-andros-primary"
          }`}
        >
          {locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
          <span>{locked ? "Proporcional" : "Ejes libres"}</span>
        </button>
      </div>

      {/* Escala porcentual */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={MIN_SCALE * 100}
          max={MAX_SCALE * 100}
          step={1}
          value={Math.round(scale[0] * 100)}
          onChange={(e) => setPercent(Number(e.target.value))}
          aria-label={uniform ? "Escala en porcentaje" : "Escala general en porcentaje (eje X de referencia)"}
          className={`${touch} flex-1 min-w-0 accent-andros-accent cursor-pointer`}
        />
        <div className="w-[84px] shrink-0">
          <NumberField
            value={percent}
            format={(n) => String(Math.round(n * 10) / 10)}
            onCommit={setPercent}
            ariaLabel="Escala en porcentaje"
            suffix="%"
            touch={touch}
          />
        </div>
      </div>

      {/* Medidas exactas en mm */}
      <div className="grid grid-cols-3 gap-2">
        {axes.map((item, index) => (
          <div key={item.axis} className="min-w-0 space-y-1">
            <NumberField
              value={item.base * scale[index]}
              format={formatMmInput}
              onCommit={(mm) => setAxisMm(index, mm)}
              ariaLabel={`${item.label} (${item.axis}) en milímetros`}
              suffix="mm"
              disabled={!(item.base > 0)}
              touch={touch}
            />
            <p className="text-[10px] text-andros-muted text-center">
              {item.label} {item.axis}
              {!uniform && (
                <span className="font-mono tabular-nums"> · {Math.round(scale[index] * 1000) / 10} %</span>
              )}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange(fitToBedScale(baseDims, scale))}
          className={`${touch} px-2 rounded-lg border border-andros-border-active bg-andros-card text-[11px] font-medium text-andros-primary flex items-center justify-center gap-1.5 hover:border-andros-accent active:scale-[0.96] spring-micro`}
        >
          <Maximize2 className="w-3.5 h-3.5 shrink-0 text-andros-accent-ink" />
          <span>
            Ajustar a cama (<span className="font-mono tabular-nums">150 mm</span>)
          </span>
        </button>
        <button
          type="button"
          onClick={() => onChange([1, 1, 1])}
          disabled={isIdentityScale(scale)}
          className={`${touch} px-2 rounded-lg border border-andros-border-active bg-andros-card text-[11px] font-medium text-andros-primary flex items-center justify-center gap-1.5 hover:border-andros-accent active:scale-[0.96] spring-micro disabled:opacity-50 disabled:pointer-events-none`}
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0 text-andros-accent-ink" />
          <span>
            Restablecer <span className="font-mono tabular-nums">100%</span>
          </span>
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Soportes automáticos
// ----------------------------------------------------------------------------

export type SupportStatus =
  | { phase: "off" }
  | { phase: "computing" }
  | { phase: "ready"; count: number; capped: boolean }
  | { phase: "error" };

export function AutoSupportsToggle({
  enabled,
  onChange,
  status,
  variant,
  disabled,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  status: SupportStatus;
  variant: Variant;
  disabled?: boolean;
}) {
  const touch = variant === "stack" ? "min-h-[44px]" : "min-h-[36px]";
  return (
    <div data-no-drag className="space-y-1">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`${touch} w-full px-3 rounded-xl border border-andros-border bg-andros-canvas flex items-center gap-2.5 text-left hover:border-andros-accent active:scale-[0.98] spring-micro disabled:opacity-50 disabled:pointer-events-none`}
      >
        <span
          aria-hidden
          className={`relative shrink-0 w-9 h-5 rounded-full transition-colors motion-reduce:transition-none ${
            enabled ? "bg-andros-success" : "bg-andros-border-active"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
              enabled ? "translate-x-4" : ""
            }`}
          />
        </span>
        <span className="flex-1 min-w-0 text-xs font-medium text-andros-primary">
          Soportes automáticos (<span className="font-mono tabular-nums">45°</span>)
        </span>
        {status.phase === "computing" && (
          <span role="status" className="shrink-0 flex items-center gap-1 text-[11px] text-andros-muted">
            <LoaderCircle className="w-3.5 h-3.5 animate-spin text-andros-accent-ink" /> Calculando…
          </span>
        )}
        {status.phase === "ready" &&
          (status.count === 0 ? (
            <span role="status" className="shrink-0 text-[11px] text-andros-muted">
              Sin voladizos detectados
            </span>
          ) : (
            <span role="status" className="shrink-0 text-[11px] font-semibold text-andros-success">
              <span className="font-mono tabular-nums">{status.count}</span> pilares
            </span>
          ))}
        {status.phase === "error" && (
          <span role="alert" className="shrink-0 text-[11px] text-andros-danger">
            No se pudieron calcular
          </span>
        )}
      </button>
      {status.phase === "ready" && status.capped && (
        <p className="text-[10px] leading-relaxed text-andros-muted">
          Se alcanzó el máximo de <span className="font-mono tabular-nums">120</span> pilares: revisa los voladizos en tu laminador.
        </p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Descarga del .stl preparado
// ----------------------------------------------------------------------------

export function PreparedStlButton({
  onClick,
  pending,
  disabled,
  className,
}: {
  onClick: () => void;
  pending: boolean;
  disabled?: boolean;
  className: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={pending || disabled} className={className}>
      {pending ? (
        <LoaderCircle className="w-3.5 h-3.5 shrink-0 animate-spin" />
      ) : (
        <Download className="w-3.5 h-3.5 shrink-0 text-andros-accent-ink" />
      )}
      <span>{pending ? "Preparando .STL…" : "Descargar .STL preparado"}</span>
    </button>
  );
}
