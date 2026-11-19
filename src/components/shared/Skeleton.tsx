import React from "react";

// ============================================================================
// ANDROS — ESQUELETOS DE CARGA
// Reservan la forma del contenido real para que nada salte al llegar los datos.
// `motion-safe:` desactiva el pulso con «reducir movimiento».
// ============================================================================

export const SkeletonLine: React.FC<{ className?: string }> = ({ className = "" }) => (
  <span aria-hidden="true" className={`block rounded-md bg-andros-border/70 motion-safe:animate-pulse ${className}`} />
);

/** Tarjeta genérica: chips + título + 2 líneas + botones. */
export const SkeletonCard: React.FC<{ className?: string; withActions?: boolean }> = ({
  className = "",
  withActions = true,
}) => (
  <div
    aria-hidden="true"
    className={`rounded-xl border border-andros-border bg-andros-canvas p-3.5 flex flex-col gap-2.5 ${className}`}
  >
    <div className="flex gap-1.5">
      <SkeletonLine className="h-4 w-16" />
      <SkeletonLine className="h-4 w-10" />
    </div>
    <SkeletonLine className="h-3.5 w-4/5" />
    <SkeletonLine className="h-3 w-2/5" />
    <SkeletonLine className="h-3 w-full" />
    <SkeletonLine className="h-3 w-3/4" />
    {withActions && (
      <div className="flex gap-1.5 pt-1">
        <SkeletonLine className="h-8 w-24 rounded-lg" />
        <SkeletonLine className="h-8 w-28 rounded-lg" />
      </div>
    )}
  </div>
);

/** Lista de N tarjetas con estado accesible «cargando». */
export const SkeletonList: React.FC<{
  count?: number;
  label: string;
  className?: string;
  withActions?: boolean;
}> = ({ count = 3, label, className = "space-y-2.5", withActions }) => (
  <div role="status" aria-busy="true" aria-label={label} className={className}>
    {Array.from({ length: count }, (_, i) => (
      <SkeletonCard key={i} withActions={withActions} />
    ))}
    <span className="sr-only">{label}</span>
  </div>
);
