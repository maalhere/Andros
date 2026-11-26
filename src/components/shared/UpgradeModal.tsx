"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Crown, Info, X } from "lucide-react";
import { useMarketStore } from "@/store/useMarketStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import { signInWithGoogle } from "@/hooks/useCloudSync";
import { ANNUAL_MONTHLY_LABEL, ANNUAL_SAVINGS_LABEL, ANNUAL_SAVINGS_USD_LABEL, PLANS } from "@/lib/plans";
import { PRO_PRICING, TWELVE_MONTHLY_TOTAL, formatUsd, type BillingCycle } from "@/lib/billing/planLimits";
import { openBillingPortal, startProCheckout, type CheckoutResult } from "@/lib/billing/subscriptionClient";
import { CONTACT_EMAIL } from "@/lib/site";

// ============================================================================
// ANDROS — PLANES (Plan Básico $0 vs. Andros Pro $5.99/mes o $65.99/año)
// Los datos viven en `src/lib/plans.ts` (los mismos que muestra la portada).
// «Pasar a Pro» pide al servidor el enlace de cobro (`/api/billing/checkout`).
// Si la pasarela aún no está configurada, el servidor responde 503 y aquí se
// muestra «Los pagos se activarán muy pronto» sin romper nada.
// ============================================================================

type Notice = { tone: "info" | "error"; text: string; action?: "signin" | "waitlist" } | null;

const noticeFor = (result: Exclude<CheckoutResult, { status: "redirect" }>): Notice => {
  if (result.status === "signin") return { tone: "info", text: result.message, action: "signin" };
  if (result.status === "unavailable") return { tone: "info", text: result.message, action: "waitlist" };
  return { tone: "error", text: result.message };
};

export const UpgradeModal: React.FC = () => {
  const open = useMarketStore((s) => s.upgradeOpen);
  const reason = useMarketStore((s) => s.upgradeReason);
  const setOpen = useMarketStore((s) => s.setUpgradeOpen);
  const animations = useSettingsStore((s) => s.animations);
  const plan = useSubscriptionStore((s) => s.plan);
  const status = useSubscriptionStore((s) => s.status);
  const periodEnd = useSubscriptionStore((s) => s.periodEnd);
  const guard = useSubmitGuard();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const close = () => {
    setOpen(false);
    setNotice(null);
  };

  const upgrade = () =>
    guard.run(async () => {
      setNotice(null);
      const result = await startProCheckout(cycle);
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return;
      }
      setNotice(noticeFor(result));
    });

  const manage = () =>
    guard.run(async () => {
      setNotice(null);
      const result = await openBillingPortal();
      if (!result.ok) setNotice({ tone: "error", text: result.message ?? "No pudimos abrir la gestión de tu suscripción." });
    });

  if (typeof document === "undefined") return null;

  const isPro = plan === "pro";
  const price = PRO_PRICING[cycle];
  const endLabel = periodEnd ? new Date(periodEnd).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }) : null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-end md:items-center justify-center p-3 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: animations === "reduced" ? 0 : 0.18 }}
          onPointerDown={close}
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
                onClick={close}
                aria-label="Cerrar planes"
                className="w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {reason && !isPro && (
              <p role="status" className="flex items-start gap-2 rounded-xl border border-andros-border bg-andros-canvas p-3 text-xs leading-relaxed text-andros-primary">
                <Info className="w-4 h-4 mt-px shrink-0 text-andros-warning" aria-hidden="true" />
                <span>{reason}</span>
              </p>
            )}

            {/* Ciclo de pago: radio exterior 12px − p-1 (4px) → botones rounded-lg (8px). */}
            <div role="radiogroup" aria-label="Ciclo de pago de Andros Pro" className="flex w-fit items-center gap-1 p-1 rounded-xl bg-andros-canvas border border-andros-border">
              {(["monthly", "annual"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cycle === c}
                  onClick={() => setCycle(c)}
                  className={`min-h-[44px] md:min-h-[32px] px-3 rounded-lg text-xs font-medium active:scale-[0.96] spring-micro ${
                    cycle === c ? "bg-andros-card text-andros-primary shadow-sm" : "text-andros-muted hover:text-andros-primary"
                  }`}
                >
                  {c === "monthly" ? "Mensual" : `Anual · ${ANNUAL_SAVINGS_LABEL}`}
                </button>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {PLANS.map((p) => {
                const pro = p.id === "pro";
                const current = p.id === plan;
                return (
                  <div
                    key={p.id}
                    className={`rounded-xl border p-4 flex flex-col gap-3 ${
                      pro ? "border-andros-accent bg-andros-accent/5" : "border-andros-border bg-andros-canvas"
                    }`}
                  >
                    <div>
                      <h3 className="text-sm font-semibold text-andros-primary">
                        {p.name}
                        {current && <span className="ml-2 text-[11px] font-medium text-andros-success">Tu plan actual</span>}
                      </h3>
                      <p className="text-[11px] text-andros-muted mt-0.5">{p.tagline}</p>
                    </div>
                    <p className="text-andros-primary">
                      <span className="text-2xl font-semibold">{pro ? price.label : p.price}</span>{" "}
                      <span className="text-[11px] text-andros-muted">{pro ? price.period : p.period}</span>
                      {pro && cycle === "annual" && (
                        <span className="block text-[11px] text-andros-muted">
                          Equivale a {ANNUAL_MONTHLY_LABEL}: {PRO_PRICING.annual.label} al año en vez de {formatUsd(TWELVE_MONTHLY_TOTAL)} ({ANNUAL_SAVINGS_USD_LABEL}).
                        </span>
                      )}
                    </p>
                    <ul className="space-y-1.5 flex-1">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-xs text-andros-primary">
                          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-andros-success" aria-hidden="true" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    {pro ? (
                      <button
                        type="button"
                        disabled={guard.pending}
                        onClick={() => void (isPro ? manage() : upgrade())}
                        className="min-h-[44px] md:min-h-[40px] rounded-lg text-xs font-semibold bg-andros-accent-fill text-white hover:opacity-90 active:scale-[0.96] spring-micro disabled:opacity-50"
                      >
                        {isPro ? "Gestionar suscripción" : guard.pending ? "Abriendo el pago…" : `Pasar a Pro · ${price.label} ${price.period}`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={close}
                        className="min-h-[44px] md:min-h-[40px] rounded-lg text-xs font-semibold border border-andros-border-active text-andros-primary hover:border-andros-accent active:scale-[0.96] spring-micro"
                      >
                        {isPro ? "Cerrar" : "Seguir con el Plan Básico"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {notice && (
              <div
                role={notice.tone === "error" ? "alert" : "status"}
                className="rounded-xl border border-andros-border bg-andros-canvas p-3 text-xs leading-relaxed space-y-2"
              >
                <p className={notice.tone === "error" ? "text-andros-danger" : "text-andros-primary"}>{notice.text}</p>
                {notice.action === "signin" && (
                  <button
                    type="button"
                    onClick={() => void signInWithGoogle()}
                    className="min-h-[44px] md:min-h-[36px] px-3 rounded-lg bg-andros-accent-fill text-white font-semibold active:scale-[0.96] spring-micro"
                  >
                    Iniciar sesión
                  </button>
                )}
                {notice.action === "waitlist" && (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      useMarketStore.getState().setWaitlistOpen(true);
                    }}
                    className="min-h-[44px] md:min-h-[36px] px-3 rounded-lg border border-andros-border-active text-andros-primary font-semibold hover:border-andros-accent active:scale-[0.96] spring-micro"
                  >
                    Avisarme cuando abran los pagos
                  </button>
                )}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-andros-muted text-center">
              {isPro && status === "cancelled" && endLabel
                ? `Cancelaste la renovación: conservas Andros Pro hasta el ${endLabel}. `
                : ""}
              El pago lo procesa nuestro proveedor de pagos (vendedor registrado que calcula los impuestos
              de tu país); Andros nunca ve ni guarda los datos de tu tarjeta. Cancela cuando quieras:
              conservas Pro hasta el final del periodo pagado. ¿Una organización o un equipo grande?
              Escríbenos a{" "}
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
