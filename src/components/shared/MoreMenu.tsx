"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Crown,
  Eraser,
  FolderArchive,
  GraduationCap,
  KeyRound,
  MoreHorizontal,
  Settings,
  Swords,
  Trash2,
  X,
} from "lucide-react";
import { useMarketStore } from "@/store/useMarketStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useWorkspaceManagerStore } from "@/store/useWorkspaceManagerStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { useAiProvidersStore } from "@/store/useAiProvidersStore";

// ============================================================================
// ANDROS — MENÚ "⋯ MÁS OPCIONES" (barra superior)
// Agrupa todo lo secundario en una lista limpia para que la pantalla
// principal se entienda al instante.
// ============================================================================

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

/** Confirmación antes de borrar el contenido del espacio actual. */
const ClearWorkspaceDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const nodeCount = useWorkspaceStore((s) => s.nodes.length);
  const strokeCount = useWorkspaceStore((s) => s.canvasStrokes.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const clearInk = () => {
    useWorkspaceStore.getState().clearInkStrokes();
    onClose();
  };
  const clearAll = () => {
    useWorkspaceStore.getState().resetWorkspace();
    onClose();
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs flex items-end md:items-center justify-center p-3 md:p-6"
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="clear-title" className="text-base font-semibold text-andros-primary">
            Limpiar espacio de trabajo
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="min-w-[36px] min-h-[36px] -mr-2 -mt-1 rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-andros-muted">
          Este espacio tiene {nodeCount} pieza(s) y {strokeCount} dibujo(s). Borrar no se puede
          deshacer.
        </p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={clearInk}
            disabled={strokeCount === 0}
            className="w-full h-11 rounded-xl border border-andros-border text-sm font-medium text-andros-primary hover:bg-andros-border/40 flex items-center justify-center gap-2 active:scale-[0.98] spring-micro disabled:opacity-40"
          >
            <Eraser className="w-4 h-4" />
            Borrar solo los dibujos
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={nodeCount === 0 && strokeCount === 0}
            className="w-full h-11 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 flex items-center justify-center gap-2 active:scale-[0.98] spring-micro disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
            Borrar todo y empezar de cero
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full h-10 rounded-xl text-sm text-andros-muted hover:text-andros-primary spring-micro"
          >
            Cancelar
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};

export const MoreMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: MenuItem[] = [
    {
      id: "arena",
      label: "Arena & Empleos",
      icon: <Swords className="w-4 h-4" />,
      onSelect: () => useMarketStore.getState().setArenaOpen(true),
    },
    {
      id: "pro",
      label: "Planes Pro",
      icon: <Crown className="w-4 h-4" />,
      onSelect: () => useMarketStore.getState().setUpgradeOpen(true),
    },
    {
      id: "settings",
      label: "Ajustes",
      icon: <Settings className="w-4 h-4" />,
      onSelect: () => useSettingsStore.getState().setModalOpen(true),
    },
    {
      id: "ai-keys",
      label: "Claves IA (Gemini, Claude, ChatGPT)",
      icon: <KeyRound className="w-4 h-4" />,
      onSelect: () => useAiProvidersStore.getState().setKeysModalOpen(true),
    },
    {
      id: "zip",
      label: "Descargar / Importar .zip",
      icon: <FolderArchive className="w-4 h-4" />,
      onSelect: () => useWorkspaceManagerStore.getState().setDrawerOpen(true),
    },
    {
      id: "tutorial",
      label: "Ver tutorial",
      icon: <GraduationCap className="w-4 h-4" />,
      onSelect: () => useOnboardingStore.getState().start(),
    },
    {
      id: "clear",
      label: "Limpiar espacio de trabajo",
      icon: <Trash2 className="w-4 h-4" />,
      onSelect: () => setConfirmClear(true),
      danger: true,
    },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más opciones"
        title="Más opciones"
        className="w-9 h-9 md:w-8 md:h-8 rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border shadow-sm text-andros-muted hover:text-andros-primary hover:border-andros-border-active active:scale-95 spring-micro flex items-center justify-center"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-11 md:top-10 w-60 p-1.5 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark origin-top-right"
          >
            {items.map((item, index) => (
              <React.Fragment key={item.id}>
                {item.danger && index > 0 && <div className="h-px bg-andros-border my-1" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 min-h-[40px] rounded-xl text-[13px] text-left spring-micro ${
                    item.danger
                      ? "text-red-500 hover:bg-red-500/10"
                      : "text-andros-primary hover:bg-andros-border/40"
                  }`}
                >
                  <span className={item.danger ? "text-red-500" : "text-andros-muted"}>{item.icon}</span>
                  {item.label}
                </button>
              </React.Fragment>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmClear && <ClearWorkspaceDialog onClose={() => setConfirmClear(false)} />}
      </AnimatePresence>
    </div>
  );
};
