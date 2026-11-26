import React from "react";
import Link from "next/link";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { CookiePreferencesLink } from "@/components/legal/CookiePreferencesLink";
import { COMPANY_CONTACT, LEGAL_LINKS, TRADEMARK_NOTICE, isPlaceholderLink } from "@/lib/site";

// ============================================================================
// ANDROS — PIE DE PÁGINA CORPORATIVO DE LA PORTADA (Sprint 22)
//   Col. 1 · Marca, descripción breve y ubicación.
//   Col. 2 · Contacto y redes (placeholders de `COMPANY_CONTACT` en site.ts).
//   Col. 3 · Legal y plataforma.
//   Línea inferior · © + cláusula de independencia (sin nombrar marcas).
//
// Los placeholders se muestran como texto, sin enlace: ningún 404 ni salida
// a un sitio externo que todavía no existe.
// ============================================================================

const COLUMN_TITLE = "text-xs font-semibold uppercase tracking-[0.14em] text-andros-primary";
const LINK = "min-h-[44px] md:min-h-[32px] inline-flex items-center hover:text-andros-primary underline-offset-4 hover:underline";

/** Enlace corporativo: si aún es un placeholder («#…»), se muestra como texto. */
const ContactItem: React.FC<{ label: string; detail?: string; url: string }> = ({ label, detail, url }) => {
  const content = (
    <>
      <span className="text-andros-primary">{label}</span>
      {detail && <span className="text-andros-muted">{detail}</span>}
    </>
  );
  if (isPlaceholderLink(url)) {
    return (
      <span id={url.slice(1)} className="min-h-[32px] flex flex-col justify-center">
        {content}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={`${LINK} flex-col items-start justify-center`}>
      {content}
    </a>
  );
};

export const LandingFooter: React.FC = () => (
  <footer aria-labelledby="andros-footer-title" className="border-t border-andros-border bg-andros-card">
    <h2 id="andros-footer-title" className="sr-only">
      Información de Andros
    </h2>
    <div className="mx-auto max-w-6xl px-4 md:px-10 py-12 md:py-14 grid gap-10 md:grid-cols-[1.3fr_1fr_1fr]">
      {/* Columna 1 · Marca */}
      <div className="flex flex-col gap-3 max-w-sm">
        <p className="flex items-center gap-2 text-base font-semibold tracking-tight text-andros-primary">
          <AndrosMark className="w-5 h-5" />
          Andros
        </p>
        <p className="text-sm leading-relaxed text-andros-muted">
          Una mesa de trabajo compartida para que los equipos planifiquen, diseñen y entreguen sin perder el hilo.
        </p>
        <p className="text-sm text-andros-muted">{COMPANY_CONTACT.location}</p>
      </div>

      {/* Columna 2 · Contacto y redes */}
      <section id="contacto" aria-labelledby="andros-footer-contacto" className="flex flex-col gap-3">
        <h3 id="andros-footer-contacto" className={COLUMN_TITLE}>
          Contacto y redes
        </h3>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li>
            {COMPANY_CONTACT.emailIsPlaceholder ? (
              <span className="min-h-[32px] inline-flex items-center text-andros-primary">{COMPANY_CONTACT.email}</span>
            ) : (
              <a href={`mailto:${COMPANY_CONTACT.email}`} className={`${LINK} text-andros-primary`}>
                {COMPANY_CONTACT.email}
              </a>
            )}
          </li>
          <li>
            <ContactItem
              label={COMPANY_CONTACT.instagramLabel}
              detail={COMPANY_CONTACT.instagramHandle}
              url={COMPANY_CONTACT.instagramUrl}
            />
          </li>
          <li>
            <ContactItem label={COMPANY_CONTACT.linkedinLabel} url={COMPANY_CONTACT.linkedinUrl} />
          </li>
          <li className="pt-1 text-andros-muted">{COMPANY_CONTACT.supportChannel}</li>
          <li className="text-andros-muted">{COMPANY_CONTACT.businessHours}</li>
        </ul>
      </section>

      {/* Columna 3 · Legal y plataforma */}
      <nav aria-labelledby="andros-footer-legal" className="flex flex-col gap-3">
        <h3 id="andros-footer-legal" className={COLUMN_TITLE}>
          Legal y plataforma
        </h3>
        <ul className="flex flex-col text-sm text-andros-muted">
          {LEGAL_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={LINK}>
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <CookiePreferencesLink className={LINK} />
          </li>
        </ul>
      </nav>
    </div>

    {/* Línea inferior · copyright y cláusula de independencia */}
    <div className="border-t border-andros-border">
      <div className="mx-auto max-w-6xl px-4 md:px-10 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col md:flex-row md:items-start gap-2 md:gap-10 text-[11px] leading-relaxed text-andros-muted">
        <p className="shrink-0">
          © {COMPANY_CONTACT.copyrightYear} {COMPANY_CONTACT.legalEntity}
        </p>
        <p className="max-w-3xl">{TRADEMARK_NOTICE}</p>
      </div>
    </div>
  </footer>
);
