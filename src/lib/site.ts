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

/** Buzón oficial: se usa en las páginas legales y en el formulario de contacto. */
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

/**
 * (Sprint 22) DATOS CORPORATIVOS DE LA PORTADA.
 *
 * Un solo lugar para el pie de página corporativo de la landing
 * (`src/components/landing/LandingFooter.tsx`). Todos los valores marcados
 * como PLACEHOLDER son provisionales: cámbialos aquí antes del lanzamiento.
 *
 *   · Mientras un enlace empiece por «#», el pie lo muestra como texto (sin
 *     enlace): así no hay redirecciones falsas ni páginas 404.
 *   · Mientras `emailIsPlaceholder` sea `true`, el correo se muestra como
 *     texto y no se abre un `mailto:` hacia un dominio que no es nuestro.
 *   · El buzón operativo de las páginas legales y del formulario de contacto
 *     sigue siendo `CONTACT_EMAIL` (arriba).
 *
 * Los nombres de las redes son los perfiles PROPIOS de Andros (canales de
 * contacto), no integraciones ni comparaciones. `verify:brand` solo admite dos
 * excepciones aquí: `instagramLabel` / `linkedinLabel` y el dominio del buzón
 * oficial en `email`.
 */
export const COMPANY_CONTACT = {
  /** Correo público de contacto. */
  email: "contacto.androshn@gmail.com",
  /** Ponlo en `false` cuando `email` sea un buzón real (activa el enlace `mailto:`). */
  emailIsPlaceholder: false,
  /** brand-ok: perfil propio de Andros en esa red (canal de contacto corporativo) */
  instagramLabel: "Instagram",
  /** Usuario de la cuenta corporativa. */
  instagramHandle: "@andros.hn",
  /** URL del perfil oficial. */
  instagramUrl: "https://www.instagram.com/andros.hn/",
  /** brand-ok: perfil propio de Andros en esa red (canal de contacto corporativo) */
  linkedinLabel: "LinkedIn (próximamente)",
  /** PLACEHOLDER — sustituir por la URL real de la página de empresa (https://…). */
  linkedinUrl: "#contacto-linkedin",
  /** PLACEHOLDER — canal de soporte y ventas. */
  supportChannel: "Soporte y consultas comerciales (próximamente)",
  location: "Tegucigalpa, Honduras",
  businessHours: "Lunes a viernes · 8:00 a. m. – 5:00 p. m. (CST)",
  /** Titular legal que aparece en el copyright. */
  legalEntity: "Andros",
  copyrightYear: 2026,
} as const;

/** `true` si el enlace aún es un placeholder interno («#…») y no debe navegar. */
export function isPlaceholderLink(url: string): boolean {
  return url.startsWith("#");
}

/** Fecha de la última revisión de los textos legales (se muestra en cada página). */
export const LEGAL_LAST_UPDATED = "26 de noviembre de 2026";

export const LEGAL_LINKS = [
  { href: "/privacidad", label: "Privacidad" },
  { href: "/terminos", label: "Términos" },
  { href: "/cookies", label: "Cookies" },
  { href: "/reembolsos", label: "Reembolsos y contacto" },
] as const;
