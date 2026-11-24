"use client";

import React, { useId, useState } from "react";
import { CheckCircle2, Crown, Send } from "lucide-react";
import { useMarketStore } from "@/store/useMarketStore";
import { useCloudStore } from "@/store/useCloudStore";
import { ConsentCheckbox } from "@/components/legal/ConsentCheckbox";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, SocialDialog } from "@/components/social/SocialDialog";
import { CONTACT_EMAIL } from "@/lib/site";
import { PRO_PLAN } from "@/lib/plans";

// ============================================================================
// ANDROS — LISTA DE ESPERA / ACCESO ANTICIPADO PRO
//   · Sin backend ni base de datos: prepara un correo a CONTACT_EMAIL con la
//     solicitud (igual que el formulario de contacto). Andros no guarda nada.
//   · Solo pide lo imprescindible (correo) + consentimiento SIN marcar.
//   · Cuando exista la pasarela (Lemon Squeezy / Paddle), `startProCheckout`
//     de `src/lib/plans.ts` redirigirá al cobro y este modal dejará de abrirse.
// ============================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Field = "email" | "consent";

export const ProWaitlistModal: React.FC = () => {
  const open = useMarketStore((s) => s.waitlistOpen);
  const setOpen = useMarketStore((s) => s.setWaitlistOpen);
  const accountEmail = useCloudStore((s) => s.user?.email ?? "");
  const close = () => setOpen(false);

  return (
    <SocialDialog
      open={open}
      onClose={close}
      title="Acceso anticipado a Andros Pro"
      titleId="andros-pro-waitlist-title"
      icon={<Crown className="w-4 h-4 text-andros-accent-ink" aria-hidden="true" />}
      description={`Andros Pro costará ${PRO_PLAN.price} ${PRO_PLAN.period}. Aún no cobramos: deja tu correo y te avisaremos en cuanto abra, sin compromiso.`}
    >
      {/* Se monta de nuevo en cada apertura: el formulario empieza limpio. */}
      {open && <WaitlistForm defaultEmail={accountEmail} onClose={close} />}
    </SocialDialog>
  );
};

const WaitlistForm: React.FC<{ defaultEmail: string; onClose: () => void }> = ({ defaultEmail, onClose }) => {
  const id = useId();
  const [email, setEmail] = useState(defaultEmail);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [sent, setSent] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<Field, string>> = {};
    if (!EMAIL_RE.test(email.trim())) next.email = "Escribe un correo válido para poder avisarte.";
    if (!consent) next.consent = "Necesitamos tu aceptación para guardar tu interés.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      document.getElementById(next.email ? `${id}-email` : `${id}-consent`)?.focus();
      return;
    }
    const subject = encodeURIComponent("[Andros] Lista de espera Pro");
    const body = encodeURIComponent(
      `Hola, quiero acceso anticipado a Andros Pro (${PRO_PLAN.price} ${PRO_PLAN.period}).\n\n— Avisar a: ${email.trim()}`
    );
    window.location.assign(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`);
    setSent(true);
  };

  if (sent) {
    return (
      <div role="status" className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-andros-primary">
          <CheckCircle2 className="w-4 h-4 text-andros-success" aria-hidden="true" />
          Tu solicitud está lista en tu app de correo.
        </p>
        <p className="text-xs leading-relaxed text-andros-muted">
          Pulsa «Enviar» allí y quedarás en la lista. Si no se abrió ninguna app, escríbenos a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2 text-andros-accent-ink">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <button type="button" onClick={onClose} className={`${BUTTON_SECONDARY} w-full`}>
          Listo
        </button>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor={`${id}-email`} className="block text-xs font-medium text-andros-primary mb-1.5">
          Tu correo
        </label>
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? `${id}-email-error` : undefined}
          className={`${INPUT} ${errors.email ? "border-andros-danger" : ""}`}
        />
        {errors.email && (
          <p id={`${id}-email-error`} className="mt-1 text-[11px] text-andros-danger">
            {errors.email}
          </p>
        )}
      </div>

      <ConsentCheckbox id={`${id}-consent`} checked={consent} onChange={setConsent} error={errors.consent} />

      <button type="submit" className={`${BUTTON_PRIMARY} w-full`}>
        <Send className="w-4 h-4" aria-hidden="true" />
        Unirme a la lista de espera
      </button>
      <p className="text-[11px] leading-relaxed text-andros-muted">
        No guardamos nada en este formulario: se abre tu app de correo con la solicitud lista para
        enviar. Puedes seguir usando el plan Gratis sin límites de tiempo.
      </p>
    </form>
  );
};
