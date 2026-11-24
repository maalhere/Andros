"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { useSettingsStore } from "@/store/useSettingsStore";
import { springOrInstant } from "@/lib/motion";
import { colorForPeer } from "@/store/useCollabStore";
import type { BasicProfile } from "@/types/social";

// ============================================================================
// ANDROS — PIEZAS COMUNES DE LOS MODALES SOCIALES (Dual-Engine)
//   · SocialDialog: diálogo modal accesible (Escape, aria-modal, resorte).
//   · ProfileAvatar: iniciales con color estable (sin imágenes externas).
// ============================================================================

interface SocialDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Id único para `aria-labelledby`. */
  titleId: string;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Diálogo ancho (librería de fichas): `max-w-2xl` en vez de `max-w-md`. */
  wide?: boolean;
  /** `top`: por encima del Estudio del Oráculo (z-90). */
  layer?: "default" | "top";
}

export const SocialDialog: React.FC<SocialDialogProps> = ({
  open,
  onClose,
  title,
  titleId,
  icon,
  description,
  children,
  wide = false,
  layer = "default",
}) => {
  const systemReduced = useReducedMotion();
  const reduced = useSettingsStore((s) => s.animations) === "reduced" || Boolean(systemReduced);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="social-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.15 }}
          onPointerDown={onClose}
          className={`fixed inset-0 ${layer === "top" ? "z-[92]" : "z-[85]"} bg-black/50 backdrop-blur-xs flex items-end md:items-center justify-center p-3 md:p-6`}
        >
          <motion.div
            // Clarity: el contenido de estos diálogos (fichas, fórmulas, IA, correos) nunca se graba.
            data-clarity-mask="true"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={springOrInstant(reduced)}
            onPointerDown={(e) => e.stopPropagation()}
            className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[85vh] overflow-y-auto rounded-3xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark p-5`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2">
                {icon}
                <h2 id={titleId} className="text-base font-semibold text-andros-primary">
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="w-11 h-11 md:w-9 md:h-9 -mr-2 -mt-1.5 shrink-0 rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {description && <div className="mt-1 text-xs leading-relaxed text-andros-muted">{description}</div>}
            <div className="mt-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export const ProfileAvatar: React.FC<{ profile: BasicProfile; size?: "sm" | "md" }> = ({ profile, size = "md" }) => {
  const parts = profile.fullName.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center shrink-0 rounded-full font-semibold text-white ${
        size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-[11px]"
      }`}
      style={{ backgroundColor: colorForPeer(profile.id) }}
    >
      {initials.toUpperCase()}
    </span>
  );
};

/** Fila de persona: avatar + nombre + @usuario + acciones a la derecha. */
export const ProfileRow: React.FC<{ profile: BasicProfile; detail?: string; children?: React.ReactNode }> = ({
  profile,
  detail,
  children,
}) => (
  <li className="flex items-center gap-2.5 py-2">
    <ProfileAvatar profile={profile} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-andros-primary">{profile.fullName}</p>
      <p className="truncate text-xs text-andros-muted">
        {profile.username ? `@${profile.username}` : "Sin @usuario"}
        {detail ? ` · ${detail}` : ""}
      </p>
    </div>
    {children && <div className="shrink-0 flex items-center gap-1.5">{children}</div>}
  </li>
);

/** Aviso cuando faltan las tablas nuevas en Supabase (el lienzo sigue igual). */
export const SetupNotice: React.FC<{ text: string }> = ({ text }) => (
  <p role="status" className="px-3 py-2.5 rounded-xl border border-andros-border bg-andros-surface text-xs text-andros-warning">
    {text}
  </p>
);

export const BUTTON_PRIMARY =
  "h-11 md:h-9 px-3 rounded-lg bg-andros-accent-fill text-white text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50 disabled:pointer-events-none";
export const BUTTON_SECONDARY =
  "h-11 md:h-9 px-3 rounded-lg border border-andros-border bg-andros-surface text-andros-primary text-xs font-medium flex items-center justify-center gap-1.5 hover:border-andros-border-active active:scale-[0.96] spring-micro disabled:opacity-50 disabled:pointer-events-none";
export const BUTTON_DANGER =
  "h-11 md:h-9 px-3 rounded-lg border border-andros-danger/40 bg-andros-danger/10 text-andros-danger text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro disabled:opacity-50 disabled:pointer-events-none";
export const INPUT =
  "w-full h-11 md:h-10 px-3 rounded-lg bg-andros-canvas border border-andros-border text-sm text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-border-active";
