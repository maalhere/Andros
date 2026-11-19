// ============================================================================
// ANDROS — DATOS PÚBLICOS DEL SITIO (SEO, páginas legales, contacto)
// Un solo lugar para cambiar el dominio y el correo de contacto.
// ============================================================================

/** Dominio público. En Vercel se toma del dominio de producción automáticamente. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://andros.app")
).replace(/\/$/, "");

export const SITE_NAME = "Andros";

export const SITE_TAGLINE = "Lienzo de ingeniería para piezas 3D, cálculos e investigación";

export const SITE_DESCRIPTION =
  "Andros es un lienzo infinito para ingeniería: visualiza piezas STL/3MF, dibuja a mano alzada, enlaza cálculos y fuentes citables, y redacta documentos con IA.";

/**
 * TODO(fundador): correo provisional. Cámbialo aquí por el buzón real antes del
 * lanzamiento; se usa en todas las páginas legales y en el formulario de contacto.
 */
export const CONTACT_EMAIL = "contacto.androshn@gmail.com";

/** Fecha de la última revisión de los textos legales (se muestra en cada página). */
export const LEGAL_LAST_UPDATED = "19 de noviembre de 2026";

export const LEGAL_LINKS = [
  { href: "/privacidad", label: "Privacidad" },
  { href: "/terminos", label: "Términos" },
  { href: "/cookies", label: "Cookies" },
  { href: "/reembolsos", label: "Reembolsos y contacto" },
] as const;
