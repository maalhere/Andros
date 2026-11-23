"use client";

import React from "react";
import { Gauge, Sparkle } from "lucide-react";
import { useSettingsStore } from "@/store/useSettingsStore";

// ============================================================================
// ANDROS — CONMUTADOR «SIMPLE | EXPERTO» (barra superior, escritorio)
//   Simple  → notas, cables, lápiz, Oráculo, voz y compartir (eventos y equipos).
//   Experto → además 3D, CodeLab y Biblioteca Científica (ingeniería y ciencia).
// Nada se borra al cambiar: solo se muestran u ocultan las herramientas.
// ============================================================================

const OPTION =
  "relative flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium active:scale-[0.96] spring-micro";

export const ExperienceModeToggle: React.FC = () => {
  const mode = useSettingsStore((s) => s.experienceMode);
  const setMode = useSettingsStore((s) => s.setExperienceMode);

  // Radio exterior 12px (rounded-xl) − 4px de margen (p-1) → interior 8px (rounded-lg).
  return (
    <div
      role="group"
      aria-label="Modo de la interfaz"
      className="hidden md:flex items-center p-1 h-9 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm"
    >
      <button
        type="button"
        onClick={() => setMode("simple")}
        aria-pressed={mode === "simple"}
        title="Modo Simple: notas, cables, lápiz, Oráculo, voz y compartir"
        className={`${OPTION} ${
          mode === "simple" ? "bg-andros-border/70 text-andros-primary" : "text-andros-muted hover:text-andros-primary"
        }`}
      >
        <Sparkle className="w-3.5 h-3.5" aria-hidden="true" />
        Simple
      </button>
      <button
        type="button"
        onClick={() => setMode("expert")}
        aria-pressed={mode === "expert"}
        title="Modo Experto: añade visor 3D, CodeLab y Biblioteca Científica"
        className={`${OPTION} ${
          mode === "expert" ? "bg-andros-border/70 text-andros-primary" : "text-andros-muted hover:text-andros-primary"
        }`}
      >
        <Gauge className="w-3.5 h-3.5" aria-hidden="true" />
        Experto
      </button>
    </div>
  );
};
