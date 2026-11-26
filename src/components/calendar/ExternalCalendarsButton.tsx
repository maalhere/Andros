"use client";

import React from "react";
import { CalendarDays } from "lucide-react";
import { useCalendarStore } from "@/store/useCalendarStore";

// ============================================================================
// ANDROS — BOTÓN «CALENDARIOS» DE LA BARRA SUPERIOR (Modo Simple, Sprint 19)
// Abre el centro de Calendarios externos (Google / Microsoft 365). Un punto de
// éxito indica que hay un calendario conectado en esta pestaña.
// ============================================================================

export const ExternalCalendarsButton: React.FC = () => {
  const connected = useCalendarStore((s) => s.connected || s.msConnected);
  return (
    <button
      type="button"
      onClick={() => useCalendarStore.getState().openModal(null)}
      aria-label={connected ? "Calendarios externos (conectado)" : "Calendarios externos: Google y Microsoft"}
      title="Calendarios (Google / Microsoft)"
      className="relative w-11 h-11 md:w-9 md:h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro flex items-center justify-center"
    >
      <CalendarDays className="w-4 h-4" aria-hidden="true" />
      {connected && (
        <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-andros-success" />
      )}
    </button>
  );
};
