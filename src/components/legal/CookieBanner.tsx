"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Cookie } from "lucide-react";
import {
  readConsent,
  saveConsent,
  subscribeConsent,
  subscribeOpenPreferences,
  type ConsentChoice,
} from "@/lib/consent";
import { springOrInstant } from "@/lib/motion";

// ============================================================================
// ANDROS — BANNER DE COOKIES (no intrusivo, sin bloquear la app)
// Dos opciones con el mismo peso visual: «Solo necesarias» / «Aceptar todas».
// La analítica opcional solo se carga tras «Aceptar todas» (AnalyticsGate).
// ============================================================================

/** Elección guardada como texto estable para useSyncExternalStore. */
const readChoice = (): ConsentChoice | "unset" => readConsent()?.choice ?? "unset";

export const CookieBanner: React.FC = () => {
  const choice = useSyncExternalStore(subscribeConsent, readChoice, () => "unset" as const);
  const [reopened, setReopened] = useState(false);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => subscribeOpenPreferences(() => setReopened(true)), []);

  const visible = mounted && (choice === "unset" || reopened);

  const decide = (next: ConsentChoice) => {
    saveConsent(next);
    setReopened(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.section
          role="region"
          aria-label="Aviso de cookies"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={springOrInstant(reduced)}
          className="fixed z-[96] inset-x-3 bottom-3 md:inset-x-auto md:left-6 md:bottom-6 md:max-w-sm pb-[env(safe-area-inset-bottom)]"
        >
          <div className="rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-4">
            <div className="flex items-start gap-3">
              <Cookie className="w-4 h-4 mt-0.5 shrink-0 text-andros-muted" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-andros-primary">
                Usamos cookies necesarias para tu sesión y preferencias. Con tu permiso, también
                analítica anónima para mejorar Andros.{" "}
                <Link href="/cookies" className="underline underline-offset-2 text-andros-accent-ink">
                  Más información
                </Link>
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => decide("necessary")}
                className="min-h-[44px] md:min-h-[36px] rounded-xl border border-andros-border-active text-xs font-semibold text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
              >
                Solo necesarias
              </button>
              <button
                type="button"
                onClick={() => decide("all")}
                className="min-h-[44px] md:min-h-[36px] rounded-xl bg-andros-primary text-andros-canvas text-xs font-semibold hover:opacity-90 active:scale-[0.96] spring-micro"
              >
                Aceptar todas
              </button>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};
