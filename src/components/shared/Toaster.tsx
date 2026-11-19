"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Info, TriangleAlert, Undo2, X } from "lucide-react";
import { useToastStore, type Toast } from "@/store/useToastStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { SPRING_SNAPPY } from "@/lib/motion";

// ============================================================================
// ANDROS — PILA DE AVISOS (abajo al centro, por encima del dock / barra táctil)
// Se pausa el temporizador mientras el puntero está encima del aviso.
// ============================================================================

const ToastItem: React.FC<{ toast: Toast; reduced: boolean }> = ({ toast, reduced }) => {
  const dismiss = useToastStore((s) => s.dismiss);
  const [paused, setPaused] = React.useState(false);

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(t);
  }, [dismiss, paused, toast.durationMs, toast.id]);

  const Icon = toast.tone === "error" ? TriangleAlert : toast.tone === "success" ? Check : Info;
  const iconTone =
    toast.tone === "error"
      ? "text-red-400"
      : toast.tone === "success"
        ? "text-andros-success"
        : "text-andros-canvas/70";

  return (
    <motion.div
      layout={!reduced}
      role={toast.tone === "error" ? "alert" : "status"}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      transition={reduced ? { duration: 0 } : SPRING_SNAPPY}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto w-full max-w-sm flex items-center gap-2 pl-3.5 pr-1.5 py-1.5 min-h-[44px] rounded-2xl bg-andros-primary text-andros-canvas shadow-hud-light dark:shadow-hud-dark"
    >
      <Icon className={`w-4 h-4 shrink-0 ${iconTone}`} aria-hidden="true" />
      <p className="flex-1 min-w-0 text-xs leading-snug py-1.5">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onAction();
            dismiss(toast.id, true);
          }}
          className="shrink-0 h-8 max-md:h-10 px-3 rounded-xl text-xs font-semibold bg-andros-canvas/15 hover:bg-andros-canvas/25 active:scale-[0.96] spring-micro flex items-center gap-1.5"
        >
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Cerrar aviso"
        className="shrink-0 w-8 h-8 max-md:w-10 max-md:h-10 rounded-xl flex items-center justify-center text-andros-canvas/70 hover:text-andros-canvas hover:bg-andros-canvas/15 active:scale-[0.96] spring-micro"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
};

export const Toaster: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const animations = useSettingsStore((s) => s.animations);
  const prefersReduced = useReducedMotion() ?? false;
  const reduced = prefersReduced || animations === "reduced";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-live="polite"
      className="fixed inset-x-3 z-[95] flex flex-col items-center gap-2 pointer-events-none bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-24"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} reduced={reduced} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
};
