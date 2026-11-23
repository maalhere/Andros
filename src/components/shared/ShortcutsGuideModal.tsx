"use client";

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { GraduationCap, X } from "lucide-react";
import { useShortcutsGuideStore, type ShortcutsGuideTab } from "@/store/useShortcutsGuideStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useIsExpert, useSettingsStore } from "@/store/useSettingsStore";
import { SPRING_SNAPPY } from "@/lib/motion";
import { useModKey } from "@/components/shared/Kbd";
import {
  AI_CONNECTION_STEPS,
  AiConnectionDiagram,
} from "@/components/onboarding/AiConnectionGuide";

// ============================================================================
// ANDROS — GUÍA DE REFERENCIA RÁPIDA (tecla «?» o botón de ayuda)
// Solo lista atajos que existen en el código:
//   useGlobalShortcuts → ⌘/Ctrl+K, V, N, C, D, B, L, M, O, Alt+1…9, Alt+W, ?
//   SpatialCanvas      → rueda (zoom al cursor), botón central (mover y
//                        doble clic = encuadrar), Esc, Supr; con el lápiz
//                        activo: E (borrador) y ⌘/Ctrl+Z (deshacer trazo).
// ============================================================================

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-md border border-andros-border bg-andros-canvas font-mono text-[11px] leading-none tabular-nums text-andros-primary">
    {children}
  </kbd>
);

interface Row {
  keys: string[];
  label: string;
  note?: string;
  /** Solo se lista en Modo Experto (3D, CodeLab, Biblioteca). */
  expertOnly?: boolean;
}

const useGroups = (): { title: string; rows: Row[] }[] => {
  const mod = useModKey();
  const expert = useIsExpert();
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Navegación y pestañas",
      rows: [
        { keys: ["Alt", "1…9"], label: "Saltar a la pestaña N" },
        { keys: ["Alt", "W"], label: "Cerrar la pestaña activa" },
        { keys: ["Botón central"], label: "Arrastrar para mover el lienzo" },
        { keys: ["Rueda"], label: "Zoom hacia el cursor" },
        { keys: ["Botón central ×2"], label: "Encuadrar todo (Zoom Extents)" },
        { keys: ["Esc"], label: "Cancelar o cerrar lo que esté abierto" },
        { keys: ["?"], label: "Abrir esta guía" },
      ],
    },
    {
      title: "Herramientas y dibujo",
      rows: [
        { keys: ["V"], label: "Puntero" },
        { keys: ["N"], label: "Nuevo nodo" },
        { keys: ["C"], label: "Conectar con cables" },
        { keys: ["L"], label: "Nuevo enlace web o YouTube" },
        { keys: ["M"], label: "Nuevo CodeLab", expertOnly: true },
        { keys: ["D"], label: "Dibujo a mano alzada" },
        { keys: ["E"], label: "Borrador o lápiz", note: "con el lápiz activo" },
        { keys: [mod, "Z"], label: "Deshacer el último trazo", note: "con el lápiz activo" },
        { keys: ["Supr"], label: "Borrar el cable seleccionado" },
      ],
    },
    {
      title: "IA, biblioteca y comandos",
      rows: [
        { keys: [mod, "K"], label: "Paleta de comandos" },
        { keys: ["O"], label: "Oráculo IA" },
        { keys: ["B"], label: "Biblioteca científica", expertOnly: true },
      ],
    },
  ];
  return groups.map((g) => ({ ...g, rows: g.rows.filter((r) => expert || !r.expertOnly) }));
};

const TABS: { id: ShortcutsGuideTab; label: string }[] = [
  { id: "shortcuts", label: "Atajos" },
  { id: "ai", label: "Cómo conectar modelos de IA" },
];

const ShortcutsPanel: React.FC = () => {
  const groups = useGroups();
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="text-[11px] uppercase tracking-wider text-andros-muted font-semibold">
            {group.title}
          </h3>
          <ul className="mt-1.5 divide-y divide-andros-border">
            {group.rows.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 text-[13px] text-andros-primary">
                  {row.label}
                  {row.note && <span className="ml-1.5 text-[11px] text-andros-muted">({row.note})</span>}
                </span>
                <span className="shrink-0 flex items-center gap-1">
                  {row.keys.map((k, i) => (
                    <React.Fragment key={`${k}-${i}`}>
                      {i > 0 && <span className="text-andros-muted text-[11px]">+</span>}
                      <Key>{k}</Key>
                    </React.Fragment>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-[11px] leading-relaxed text-andros-muted">
        Las teclas de letra funcionan en el escritorio y no mientras escribes en un cuadro de texto. Alt + número y
        Alt + W evitan a propósito Ctrl+W y Ctrl+T del navegador.
      </p>
    </div>
  );
};

const AiPanel: React.FC = () => (
  <div className="space-y-4">
    <AiConnectionDiagram />
    <ol className="space-y-3">
      {AI_CONNECTION_STEPS.map((step, i) => (
        <li key={step.title} className="flex gap-3">
          <span className="mt-0.5 w-6 h-6 shrink-0 rounded-lg bg-andros-accent/10 text-andros-accent-ink font-mono text-xs tabular-nums flex items-center justify-center">
            {i + 1}
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-andros-primary">{step.title}</h3>
            <p className="mt-0.5 text-[13px] leading-relaxed text-andros-muted">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  </div>
);

export const ShortcutsGuideModal: React.FC = () => {
  const open = useShortcutsGuideStore((s) => s.open);
  const tab = useShortcutsGuideStore((s) => s.tab);
  const setTab = useShortcutsGuideStore((s) => s.setTab);
  const closeGuide = useShortcutsGuideStore((s) => s.closeGuide);
  const reduced = useSettingsStore((s) => s.animations === "reduced");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "?" && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        e.stopPropagation();
        closeGuide();
      }
    };
    window.addEventListener("keydown", onKey, true);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, closeGuide]);

  if (typeof document === "undefined") return null;

  const repeatTour = () => {
    closeGuide();
    useOnboardingStore.getState().start();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="shortcuts-guide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={closeGuide}
          className="fixed inset-0 z-[62] bg-black/50 backdrop-blur-xs flex items-end md:items-center justify-center p-3 md:p-6"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-guide-title"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={reduced ? { duration: 0 } : SPRING_SNAPPY}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-3xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark"
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-5">
              <h2 id="shortcuts-guide-title" className="text-base font-semibold text-andros-primary">
                Guía rápida
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={closeGuide}
                aria-label="Cerrar la guía rápida"
                className="min-w-[44px] min-h-[44px] -mr-3 -mt-2.5 rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div role="tablist" aria-label="Secciones de la guía" className="mt-2 mx-5 p-1 flex gap-1 rounded-xl bg-andros-canvas border border-andros-border">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`guide-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls="guide-panel"
                  onClick={() => setTab(t.id)}
                  className={`flex-1 min-h-[40px] md:min-h-[32px] px-2 rounded-lg text-xs font-medium active:scale-[0.98] spring-micro ${
                    tab === t.id
                      ? "bg-andros-card text-andros-primary shadow-sm"
                      : "text-andros-muted hover:text-andros-primary"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div
              id="guide-panel"
              role="tabpanel"
              aria-labelledby={`guide-tab-${tab}`}
              className="flex-1 min-h-0 overflow-y-auto px-5 py-4"
            >
              {tab === "shortcuts" ? <ShortcutsPanel /> : <AiPanel />}
            </div>

            <div className="px-5 pb-5 pt-1">
              <button
                type="button"
                onClick={repeatTour}
                className="w-full min-h-[44px] md:min-h-[40px] rounded-xl border border-andros-border text-[13px] font-medium text-andros-primary hover:bg-andros-border/40 flex items-center justify-center gap-2 active:scale-[0.98] spring-micro"
              >
                <GraduationCap className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />
                Repetir tutorial guiado
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
