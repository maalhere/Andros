"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck, Cable, StickyNote, X } from "lucide-react";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useLandingStore } from "@/store/useLandingStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { quickAdd } from "@/lib/canvas/quickAdd";
import { springOrInstant } from "@/lib/motion";

// ============================================================================
// ANDROS — GUÍA CONTEXTUAL DEL MODO SIMPLE (divulgación progresiva)
// Una tarjeta discreta sobre el tablero vacío, pensada para organizar un
// evento o un equipo. Desaparece sola en cuanto la persona crea o edita su
// primer bloque (o dibuja), y se puede cerrar con la X. Solo escritorio: en el
// teléfono el mensaje de «espacio vacío» ya cumple esta función.
// ============================================================================

const DISMISS_KEY = "andros:simple-guide-dismissed:v1";

export const SimpleStartGuide: React.FC = () => {
  const mode = useSettingsStore((s) => s.experienceMode);
  const reduced = useSettingsStore((s) => s.animations) === "reduced";
  const isEmpty = useWorkspaceStore((s) => s.nodes.length === 0 && s.canvasStrokes.length === 0);
  const landingDone = useLandingStore((s) => s.phase === "workspace");
  const tourOpen = useOnboardingStore((s) => s.open);
  // Se monta solo en el cliente (page.tsx espera a `isMounted`), así que se puede leer ya.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const close = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Sin storage: solo se oculta durante esta visita.
    }
  };

  const visible = mode === "simple" && isEmpty && landingDone && !tourOpen && !dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          aria-label="Guía para empezar"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={springOrInstant(reduced)}
          className="fixed z-30 left-1/2 top-[38%] -translate-x-1/2 w-[min(26rem,calc(100vw-2rem))] p-4 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar la guía"
            className="hit-slop absolute top-2.5 right-2.5 w-8 h-8 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <span className="w-9 h-9 shrink-0 rounded-lg bg-andros-accent/10 text-andros-accent-ink flex items-center justify-center">
              <CalendarCheck className="w-4 h-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-andros-primary">Organiza tu evento o equipo aquí</h2>
              <p className="mt-1 text-xs leading-relaxed text-andros-muted">
                Crea una tarjeta por tema (fechas, tareas, responsables, presupuesto), únelas con cables y pídele
                al Oráculo IA que las ordene. Todos ven lo mismo en tiempo real, sin perderse en el chat.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => quickAdd("note")}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-andros-accent-fill text-white text-xs font-semibold active:scale-[0.96] spring-micro"
            >
              <StickyNote className="w-3.5 h-3.5" aria-hidden="true" />
              Crear mi primera tarjeta
            </button>
            <button
              type="button"
              onClick={() => useWorkspaceStore.getState().setActiveTool("connect")}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-andros-border text-xs font-medium text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
            >
              <Cable className="w-3.5 h-3.5" aria-hidden="true" />
              Conectar tarjetas
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
