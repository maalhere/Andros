import React from "react";

// ============================================================================
// ANDROS — MARCA OFICIAL DE DOBLE CHEVRÓN
//   · Chevrón exterior grueso: grafito #1A1A18 (claro) / #EDEDEF (oscuro).
//   · Chevrón interior compacto: terracota técnica #C95A3B (siempre).
//   tone="inverse" invierte el chevrón exterior para fondos sólidos de texto
//   (por ejemplo, dentro del botón principal).
// ============================================================================

export const ANDROS_TERRACOTTA = "#C95A3B";

interface AndrosMarkProps {
  className?: string;
  tone?: "auto" | "inverse";
  /** Si se indica, la marca se anuncia a lectores de pantalla con este nombre. */
  title?: string;
}

export const AndrosMark: React.FC<AndrosMarkProps> = ({
  className = "w-6 h-6",
  tone = "auto",
  title,
}) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    className={className}
    shapeRendering="geometricPrecision"
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
  >
    {title && <title>{title}</title>}
    <polyline
      points="4.5,20.8 16,9.3 27.5,20.8"
      stroke={tone === "inverse" ? "var(--bg-canvas)" : "var(--text-primary)"}
      strokeWidth={5.5}
      strokeLinejoin="miter"
      strokeMiterlimit={4}
      strokeLinecap="butt"
    />
    <polyline
      points="10.5,25.3 16,19.8 21.5,25.3"
      stroke={ANDROS_TERRACOTTA}
      strokeWidth={3.6}
      strokeLinejoin="miter"
      strokeMiterlimit={4}
      strokeLinecap="butt"
    />
  </svg>
);
