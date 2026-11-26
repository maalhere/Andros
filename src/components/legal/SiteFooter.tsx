import React from "react";
import Link from "next/link";
import { CONTACT_EMAIL, LEGAL_LINKS, TRADEMARK_NOTICE } from "@/lib/site";
import { CookiePreferencesLink } from "./CookiePreferencesLink";

// ============================================================================
// ANDROS — PIE DE PÁGINA LEGAL (páginas públicas y portada)
// ============================================================================

export const SiteFooter: React.FC<{ compact?: boolean; className?: string }> = ({
  compact = false,
  className = "",
}) => (
  <footer className={`${compact ? "" : "border-t border-andros-border"} ${className}`}>
    <nav
      aria-label="Información legal"
      className={`mx-auto max-w-3xl ${compact ? "" : "px-4 md:px-6 py-6"} flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-andros-muted`}
    >
      {LEGAL_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className="min-h-[32px] inline-flex items-center hover:text-andros-primary underline-offset-4 hover:underline">
          {link.label}
        </Link>
      ))}
      <CookiePreferencesLink className="min-h-[32px] inline-flex items-center hover:text-andros-primary underline-offset-4 hover:underline" />
      {!compact && (
        <a href={`mailto:${CONTACT_EMAIL}`} className="min-h-[32px] inline-flex items-center hover:text-andros-primary md:ml-auto">
          {CONTACT_EMAIL}
        </a>
      )}
    </nav>
    {/* Aviso de marcas e independencia (versión completa en /terminos). */}
    <p className={`mx-auto max-w-3xl ${compact ? "mt-1" : "px-4 md:px-6 pb-6 -mt-3"} text-[11px] leading-relaxed text-andros-muted`}>
      {TRADEMARK_NOTICE}
    </p>
  </footer>
);
