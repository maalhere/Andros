"use client";

import React, { useId, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { CONTACT_EMAIL } from "@/lib/site";
import { ConsentCheckbox } from "./ConsentCheckbox";

// ============================================================================
// ANDROS — FORMULARIO DE CONTACTO (sin backend, sin guardar datos)
// Valida en línea y abre el correo de la persona con el mensaje listo para
// enviar a CONTACT_EMAIL. Andros no almacena nada de lo que se escribe aquí.
// ============================================================================

const TOPICS = ["Soporte", "Reembolso", "Privacidad o mis datos", "Otro"] as const;

type Field = "email" | "message" | "consent";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const ContactForm: React.FC = () => {
  const id = useId();
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<(typeof TOPICS)[number]>("Soporte");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [sent, setSent] = useState(false);

  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    if (!EMAIL_RE.test(email.trim())) next.email = "Escribe un correo válido para poder responderte.";
    if (message.trim().length < 10) next.message = "Cuéntanos un poco más (mínimo 10 caracteres).";
    if (!consent) next.consent = "Necesitamos tu aceptación para tratar tu mensaje.";
    return next;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      const first = (Object.keys(next) as Field[])[0];
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    const subject = encodeURIComponent(`[Andros] ${topic}`);
    const body = encodeURIComponent(`${message.trim()}\n\n— Responder a: ${email.trim()}`);
    window.location.assign(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`);
    setSent(true);
  };

  if (sent) {
    return (
      <div role="status" className="rounded-2xl border border-andros-success/40 bg-andros-success/10 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-andros-primary">
          <CheckCircle2 className="w-4 h-4 text-andros-success" aria-hidden="true" />
          ¡Gracias! Tu mensaje está listo en tu app de correo.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-andros-muted">
          Pulsa «Enviar» allí y te responderemos en un máximo de 3 días hábiles. Si no se abrió
          ninguna app, escríbenos directamente a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline text-andros-accent-ink">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-3 min-h-[44px] md:min-h-[36px] px-3 rounded-xl border border-andros-border text-xs text-andros-primary hover:bg-andros-border/40 active:scale-[0.96] spring-micro"
        >
          Escribir otro mensaje
        </button>
      </div>
    );
  }

  const input =
    "w-full rounded-xl border bg-andros-card px-3 py-2.5 text-sm text-andros-primary placeholder:text-andros-muted focus:outline-none focus:border-andros-accent";
  const border = (f: Field) => (errors[f] ? "border-andros-danger" : "border-andros-border");

  return (
    <form noValidate onSubmit={onSubmit} className="not-prose space-y-4 rounded-2xl border border-andros-border bg-andros-card/60 p-5">
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
          className={`${input} ${border("email")}`}
        />
        {errors.email && (
          <p id={`${id}-email-error`} className="mt-1 text-[11px] text-andros-danger">
            {errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={`${id}-topic`} className="block text-xs font-medium text-andros-primary mb-1.5">
          Tema
        </label>
        <select
          id={`${id}-topic`}
          value={topic}
          onChange={(e) => setTopic(e.target.value as (typeof TOPICS)[number])}
          className={`${input} border-andros-border min-h-[44px]`}
        >
          {TOPICS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${id}-message`} className="block text-xs font-medium text-andros-primary mb-1.5">
          Mensaje
        </label>
        <textarea
          id={`${id}-message`}
          value={message}
          maxLength={2000}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? `${id}-message-error` : undefined}
          className={`${input} ${border("message")} min-h-[120px] resize-y`}
        />
        {errors.message && (
          <p id={`${id}-message-error`} className="mt-1 text-[11px] text-andros-danger">
            {errors.message}
          </p>
        )}
      </div>

      <ConsentCheckbox checked={consent} onChange={setConsent} error={errors.consent} />

      <button
        type="submit"
        className="w-full md:w-auto min-h-[44px] px-5 rounded-xl bg-andros-primary text-andros-canvas text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.96] spring-micro"
      >
        <Send className="w-4 h-4" aria-hidden="true" />
        Preparar mensaje
      </button>
      <p className="text-[11px] text-andros-muted">
        No guardamos lo que escribes aquí: se abre tu app de correo con el mensaje listo.
      </p>
    </form>
  );
};
