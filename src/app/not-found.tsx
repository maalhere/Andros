import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AndrosMark } from "@/components/brand/AndrosMark";
import { SiteFooter } from "@/components/legal/SiteFooter";

export const metadata: Metadata = {
  title: "Página no encontrada",
  robots: { index: false },
  // Sin canonical heredado: una 404 no debe apuntar a la portada.
  alternates: null,
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-andros-canvas text-andros-primary canvas-grid">
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <AndrosMark className="w-10 h-10 mx-auto" />
          <p className="mt-6 font-mono text-xs tabular-nums tracking-wider text-andros-muted">ERROR 404</p>
          <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight">
            Esta página no existe en el lienzo
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-andros-muted">
            Puede que el enlace esté mal escrito o que la página se haya movido. Tu trabajo sigue
            donde lo dejaste.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-andros-primary text-andros-canvas text-sm font-semibold hover:opacity-90 active:scale-[0.96] spring-micro"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Volver al lienzo
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
