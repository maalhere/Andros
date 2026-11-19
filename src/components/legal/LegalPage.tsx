import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { LEGAL_LAST_UPDATED } from "@/lib/site";
import { SiteFooter } from "./SiteFooter";

// ============================================================================
// ANDROS — PLANTILLA DE PÁGINA LEGAL (servidor, sin JavaScript de cliente)
// Columna de lectura de ~68 caracteres, índice opcional y pie con enlaces.
// ============================================================================

interface LegalPageProps {
  title: string;
  summary: string;
  children: React.ReactNode;
}

export const LegalPage: React.FC<LegalPageProps> = ({ title, summary, children }) => (
  <div className="min-h-screen flex flex-col bg-andros-canvas text-andros-primary">
    <header className="sticky top-0 z-10 border-b border-andros-border bg-andros-canvas/90 backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 md:px-6 h-14 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 min-h-[44px] text-sm font-semibold" aria-label="Andros: volver al inicio">
          <AndrosMark className="w-6 h-6" />
          Andros
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-xs font-medium text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Volver al lienzo
        </Link>
      </div>
    </header>

    <main id="contenido" className="flex-1 mx-auto w-full max-w-3xl px-4 md:px-6 py-10 md:py-14">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-andros-muted">{summary}</p>
      <p className="mt-2 text-xs text-andros-muted">
        Última actualización: <time className="tabular-nums">{LEGAL_LAST_UPDATED}</time>
      </p>
      <div className="legal-prose mt-10">{children}</div>
    </main>

    <SiteFooter />
  </div>
);
