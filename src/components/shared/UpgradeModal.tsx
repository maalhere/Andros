"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Crown, X } from "lucide-react";
import { useMarketStore } from "@/store/useMarketStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { PLANS, startProCheckout, type PlanId } from "@/lib/plans";
import { CONTACT_EMAIL } from "@/lib/site";

// ============================================================================
// ANDROS — PLANES (Gratis $0 vs. Andros Pro $9/mes)
// Los datos viven en `src/lib/plans.ts` (los mismos que muestra la portada).
// «Pasar a Pro» llama a `startProCheckout`: hoy abre la lista de espera; cuando
// se conecte Lemon Squeezy / Paddle redirigirá al cobro sin tocar este archivo.
// ============================================================================

export const UpgradeModal: React.FC = () => {
  const open = useMarketStore((s) => s.upgradeOpen);
  const setOpen = useMarketStore((s) => s.setUpgradeOpen);
  const animations = useSettingsStore((s) => s.animations);
  const guard = useSubmitGuard();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const choose = (plan: PlanId) =>
    guard.run(async () => {
      if (plan === "free") {
        setOpen(false);
        return;
      }
      const result = await startProCheckout();
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return;
      }
      setOpen(false);
      useMarketStore.getState().setWaitlistOpen(true);
    });

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-end md:items-center justify-center p-3 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: animations === "reduced" ? 0 : 0.18 }}
          onPointerDown={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="andros-plans-title"
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={animations === "reduced" ? { duration: 0 } : { type: "spring", stiffness: 450, damping: 32, mass: 0.8 }}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-andros-primary">
                <Crown className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />
                <h2 id="andros-plans-title" className="text-sm font-semibold">
                  Planes de Andros
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar planes"
                className="w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {PLANS.map((plan) => {
                const pro = plan.id === "pro";
                return (
                  <div
                    key={plan.id}
                    className={`rounded-xl border p-4 flex flex-col gap-3 ${
                      pro ? "border-andros-accent bg-andros-accent/5" : "border-andros-border bg-andros-canvas"
                    }`}
                  >
                    <div>
                      <h3 className="text-sm font-semibold text-andros-primary">{plan.name}</h3>
                      <p className="text-[11px] text-andros-muted mt-0.5">{plan.tagline}</p>
                    </div>
                    <p className="text-andros-primary">
                      <span className="text-2xl font-semibold">{plan.price}</span>{" "}
                      <span className="text-[11px] text-andros-muted">{plan.period}</span>
                    </p>
                    <ul className="space-y-1.5 flex-1">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-xs text-andros-primary">
                          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-andros-success" aria-hidden="true" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled={guard.pending}
                      onClick={() => void choose(plan.id)}
                      className={`min-h-[44px] md:min-h-[40px] rounded-lg text-xs font-semibold active:scale-[0.96] spring-micro disabled:opacity-50 ${
                        pro
                          ? "bg-andros-accent-fill text-white hover:opacity-90"
                          : "border border-andros-border-active text-andros-primary hover:border-andros-accent"
                      }`}
                    >
                      {pro ? "Acceso anticipado a Pro" : "Seguir con Gratis"}
                    </button>
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] leading-relaxed text-andros-muted text-center">
              Pro todavía no se cobra: al unirte a la lista de espera te avisamos cuando abra. ¿Una
              organización o un equipo grande? Escríbenos a{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2 text-andros-accent-ink">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
