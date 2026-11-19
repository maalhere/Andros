"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Crown, Sparkles, X } from "lucide-react";
import { useMarketStore } from "@/store/useMarketStore";
import { useSettingsStore } from "@/store/useSettingsStore";

// ============================================================================
// ANDROS — PLANES Y SUSCRIPCIONES
// Lista para conectar una pasarela de pago: solo hay que implementar
// `startCheckout` (por ejemplo, redirigir a Stripe Checkout o Lemon Squeezy).
// ============================================================================

export type PlanId = "free" | "pro" | "team";

interface Plan {
  id: PlanId;
  name: string;
  price: string;
  period: string;
  tagline: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Gratis",
    price: "$0",
    period: "para siempre",
    tagline: "Para empezar a diseñar y calcular.",
    features: ["Espacios limitados", "Archivos de hasta 50 MB", "Exportar respaldo JSON", "Oráculo IA estándar"],
    cta: "Plan actual",
  },
  {
    id: "pro",
    name: "Andros Pro",
    price: "$12",
    period: "USD / mes",
    tagline: "Para ingenieros que trabajan en serio.",
    features: [
      "Espacios ilimitados",
      "Subida de archivos 3D pesados de hasta 500 MB",
      "Exportación .zip de espacios completos",
      "Oráculo IA prioritario",
    ],
    cta: "Pasar a Pro",
    highlight: true,
  },
  {
    id: "team",
    name: "Equipos / Empresas",
    price: "$29",
    period: "USD / usuario / mes",
    tagline: "Colabora y publica retos en la Arena.",
    features: [
      "Todo lo de Andros Pro",
      "Espacios compartidos del equipo",
      "Publicación destacada de retos y vacantes",
      "Facturación y soporte prioritario",
    ],
    cta: "Hablar con ventas",
  },
];

/**
 * PUNTO DE INTEGRACIÓN DE LA PASARELA DE PAGO.
 * Aquí se crearía la sesión de cobro (backend) y se redirigiría al usuario.
 */
async function startCheckout(plan: PlanId): Promise<{ ok: boolean; message: string }> {
  // Ejemplo futuro: const { url } = await (await fetch("/api/checkout", {...})).json(); window.location.href = url;
  void plan;
  return {
    ok: false,
    message: "La pasarela de pago aún no está conectada. ¡Gracias por tu interés! Te avisaremos al lanzar.",
  };
}

export const UpgradeModal: React.FC = () => {
  const open = useMarketStore((s) => s.upgradeOpen);
  const setOpen = useMarketStore((s) => s.setUpgradeOpen);
  const animations = useSettingsStore((s) => s.animations);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<PlanId | null>(null);
  // Al reabrir se limpia el aviso anterior (ajuste durante el render, sin efecto).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMessage(null);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const choose = async (plan: PlanId) => {
    if (plan === "free") {
      setOpen(false);
      return;
    }
    setBusy(plan);
    const result = await startCheckout(plan);
    setBusy(null);
    setMessage(result.message);
  };

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
            aria-label="Planes de Andros"
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={animations === "reduced" ? { duration: 0 } : { type: "spring", stiffness: 450, damping: 32, mass: 0.8 }}
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-andros-primary">
                <Crown className="w-4 h-4 text-andros-accent-ink" />
                <h2 className="text-sm font-semibold">Elige tu plan de Andros</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar planes" className="p-1.5 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-2xl border p-4 flex flex-col gap-3 ${
                    plan.highlight ? "border-andros-accent ring-1 ring-andros-accent/40 bg-andros-accent/5" : "border-andros-border bg-andros-canvas"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-semibold text-andros-primary">{plan.name}</h3>
                      {plan.highlight && <Sparkles className="w-3.5 h-3.5 text-andros-accent-ink" />}
                    </div>
                    <p className="text-[11px] text-andros-muted mt-0.5">{plan.tagline}</p>
                  </div>
                  <p className="text-andros-primary">
                    <span className="text-2xl font-semibold">{plan.price}</span>{" "}
                    <span className="text-[11px] text-andros-muted">{plan.period}</span>
                  </p>
                  <ul className="space-y-1.5 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-andros-primary">
                        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-andros-success" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={busy === plan.id}
                    onClick={() => choose(plan.id)}
                    className={`min-h-[40px] rounded-xl text-xs font-semibold active:scale-[0.98] spring-micro ${
                      plan.highlight ? "bg-andros-accent-fill text-white hover:opacity-90" : "border border-andros-border-active text-andros-primary hover:border-andros-accent"
                    }`}
                  >
                    {busy === plan.id ? "Procesando…" : plan.cta}
                  </button>
                </div>
              ))}
            </div>

            {message && (
              <p role="status" className="text-xs text-andros-muted text-center rounded-lg bg-andros-border/30 px-3 py-2">
                {message}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
