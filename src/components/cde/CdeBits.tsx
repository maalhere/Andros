"use client";

import React from "react";
import { Bot } from "lucide-react";
import { areaColorIndex, areaKey } from "@/lib/cde/areas";
import { parseMentions, type MentionDirectory } from "@/lib/cde/mentions";
import { RESOLUTION_STATUS_COLOR, RESOLUTION_STATUS_LABEL } from "@/lib/cde/resolution";
import type { ResolutionStatus } from "@/types/workspace";

// ============================================================================
// ANDROS — PIEZAS VISUALES DEL CDE (Sprint 18)
//   · AreaBadge: chip de @Área con un punto de color estable (decorativo; el
//     texto siempre es `text-andros-primary`, AA en ambos motores).
//   · MentionText: texto con las menciones reconocidas resaltadas.
//   · StatusLight: semáforo Rojo «Pendiente» / Verde «Completado» (tinte + tinta
//     AA, nunca relleno sólido con texto blanco: el rojo oscuro no llegaría).
// ============================================================================

/** Puntos decorativos (no llevan texto encima). */
const AREA_DOTS = [
  "bg-andros-accent",
  "bg-andros-success",
  "bg-andros-warning",
  "bg-andros-danger",
  "bg-andros-primary",
  "bg-andros-muted",
] as const;

export const AreaBadge: React.FC<{ area: string; count?: number; className?: string }> = ({ area, count, className = "" }) => (
  <span
    className={`inline-flex max-w-full items-center gap-1 px-1.5 py-0.5 rounded-md border border-andros-border bg-andros-canvas text-[11px] font-medium text-andros-primary ${className}`}
  >
    <span aria-hidden="true" className={`w-1.5 h-1.5 shrink-0 rounded-full ${AREA_DOTS[areaColorIndex(area)]}`} />
    <span className="truncate">@{area}</span>
    {count !== undefined && <span className="font-mono tabular-nums text-andros-muted">{count}</span>}
  </span>
);

/** Texto con @Área, @usuario y @IA resaltados (solo las que existen en el espacio). */
export const MentionText: React.FC<{ text: string; dir: MentionDirectory; myUserId?: string; myArea?: string | null }> = ({
  text,
  dir,
  myUserId,
  myArea,
}) => {
  const { segments } = parseMentions(text, dir);
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === "text") return <React.Fragment key={i}>{s.text}</React.Fragment>;
        const m = s.mention;
        const isMe =
          (m.kind === "user" && m.id === myUserId) ||
          (m.kind === "area" && Boolean(myArea) && areaKey(m.value) === areaKey(myArea ?? ""));
        return (
          <mark
            key={i}
            className={`rounded px-0.5 font-medium text-andros-accent-ink ${
              isMe ? "bg-andros-accent/20 ring-1 ring-andros-accent/40" : "bg-andros-accent/10"
            }`}
          >
            {m.kind === "ai" && <Bot className="inline w-3 h-3 mr-0.5 -mt-0.5" aria-hidden="true" />}
            {s.text}
          </mark>
        );
      })}
    </>
  );
};

/** Semáforo de una Ficha de Resolución. `size="lg"` en la propia tarjeta. */
export const StatusLight: React.FC<{ status: ResolutionStatus; size?: "sm" | "lg" }> = ({ status, size = "sm" }) => {
  const done = status === "done";
  const label = `${RESOLUTION_STATUS_COLOR[status]} · ${RESOLUTION_STATUS_LABEL[status]}`;
  return (
    <span
      role="status"
      aria-label={`Estado: ${label}`}
      className={`inline-flex items-center gap-1.5 rounded-lg border font-semibold ${
        done
          ? "border-andros-success/50 bg-andros-success/10 text-andros-success"
          : "border-andros-danger/50 bg-andros-danger/10 text-andros-danger"
      } ${size === "lg" ? "px-2.5 py-1.5 text-sm" : "px-1.5 py-0.5 text-[11px]"}`}
    >
      <span
        aria-hidden="true"
        className={`rounded-full ${done ? "bg-andros-success" : "bg-andros-danger"} ${size === "lg" ? "w-3 h-3" : "w-2 h-2"}`}
      />
      {label}
    </span>
  );
};
