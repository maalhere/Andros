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

export const SITE_TAGLINE = "Organiza eventos y equipos en tiempo real, con IA";

export const SITE_DESCRIPTION =
  "Andros es un lienzo infinito para organizar eventos y equipos en tiempo real con IA: tarjetas, cables y un plan compartido que se actualiza al instante en el celular y en la computadora. Con Modo Experto para piezas 3D, cálculos y fuentes citables.";

/**
 * TODO(fundador): correo provisional. Cámbialo aquí por el buzón real antes del
 * lanzamiento; se usa en todas las páginas legales y en el formulario de contacto.
 */
export const CONTACT_EMAIL = "contacto.androshn@gmail.com";

/**
 * Cláusula de independencia y marcas (Sprint 20). Se muestra completa en
 * /terminos; el pie de página usa la versión corta. `verify:brand` comprueba
 * que ambas sigan publicadas.
 */
export const INTEGRATIONS_NOTICE =
  "Las integraciones opcionales con servicios externos funcionan mediante sus interfaces públicas y están sujetas a sus propios términos.";

export const TRADEMARK_NOTICE =
  "Todas las marcas mencionadas por motivos de compatibilidad técnica pertenecen a sus respectivos propietarios; Andros no está afiliado, patrocinado ni respaldado por ellos.";

/** Fecha de la última revisión de los textos legales (se muestra en cada página). */
export const LEGAL_LAST_UPDATED = "26 de noviembre de 2026";

export const LEGAL_LINKS = [
  { href: "/privacidad", label: "Privacidad" },
  { href: "/terminos", label: "Términos" },
  { href: "/cookies", label: "Cookies" },
  { href: "/reembolsos", label: "Reembolsos y contacto" },
] as const;
