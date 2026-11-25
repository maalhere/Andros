"use client";

import React, { useMemo } from "react";
import { CalendarDays, MessageSquare } from "lucide-react";
import { useCloudStore } from "@/store/useCloudStore";
import { useCommentsStore, useNodeOpenCommentCount } from "@/store/useCommentsStore";
import { useCalendarStore } from "@/store/useCalendarStore";
import { useWorkspaceRole } from "@/lib/access/workspaceRole";
import { canCreateComment } from "@/lib/access/permissions";
import { nodeHasCalendarEvents } from "@/lib/calendar/extractEvents";
import type { EngineeringNodeData } from "@/types/workspace";

// ============================================================================
// ANDROS — BOTONES DE LA CABECERA DE CADA TARJETA (Sprint 16)
//   · Comentarios: contador de hilos abiertos. Con rol Comentarista se ve
//     siempre; con Dueño/Editor aparece al pasar el ratón (o si ya hay
//     comentarios). Funciona también en solo lectura (`pointer-events-auto`
//     sobre una capa bloqueada).
//   · Calendario: solo en tarjetas con fechas reconocibles; abre el panel de
//     Google Calendar enfocado en esa tarjeta.
// ============================================================================

const BASE =
  "pointer-events-auto hit-slop shrink-0 h-7 max-md:h-9 min-w-7 max-md:min-w-9 px-1 rounded-lg flex items-center justify-center gap-1 text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro focus-visible:opacity-100";

export const NodeCommentButton: React.FC<{ node: EngineeringNodeData; variant: "canvas" | "stack" }> = ({
  node,
  variant,
}) => {
  const signedIn = useCloudStore((s) => Boolean(s.user && s.workspaceId));
  const status = useCommentsStore((s) => s.status);
  const count = useNodeOpenCommentCount(node.id);
  const role = useWorkspaceRole();
  if (!signedIn || status === "idle" || status === "setup-missing") return null;

  const commenter = role === "commenter";
  const canWrite = canCreateComment(role);
  // Sin comentarios: Comentarista siempre; Dueño/Editor solo al pasar el ratón en el lienzo.
  if (count === 0 && !commenter && (!canWrite || variant !== "canvas")) return null;
  const reveal = count === 0 && !commenter ? "opacity-0 group-hover/node:opacity-100" : "";

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        useCommentsStore.getState().openDrawer(node.id);
      }}
      aria-label={
        count > 0
          ? `Comentarios de «${node.title}» (${count} ${count === 1 ? "abierto" : "abiertos"})`
          : `Comentar «${node.title}»`
      }
      title={count > 0 ? "Ver comentarios" : "Comentar esta tarjeta"}
      className={`${BASE} ${reveal} ${count > 0 ? "text-andros-accent-ink" : ""}`}
    >
      <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
      {count > 0 && <span className="font-mono tabular-nums text-[10px] leading-none">{count}</span>}
    </button>
  );
};

export const NodeCalendarButton: React.FC<{ node: EngineeringNodeData }> = ({ node }) => {
  const hasEvents = useMemo(() => nodeHasCalendarEvents(node), [node]);
  if (!hasEvents) return null;
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        useCalendarStore.getState().openModal(node.id);
      }}
      aria-label={`Llevar las fechas de «${node.title}» a Google Calendar`}
      title="Llevar a Google Calendar"
      className={BASE}
    >
      <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
};
