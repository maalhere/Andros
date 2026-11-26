// ============================================================================
// ANDROS — IPv4 PRIVADA RFC 1918 (módulo puro, SIN dependencias)
// Validador común de destinos de impresora (Klipper y FlashForge, ruta web,
// navegador y app de Windows). Separado de `network.ts` para que importarlo
// no arrastre el registro de impresoras al JS inicial de la página.
//   · Solo IPv4 literales decimales de 10/8, 172.16/12 y 192.168/16.
//   · Rechaza loopback (127/8), enlace local (169.254/16, metadatos de la
//     nube), 0.0.0.0, CGNAT (100.64/10), IPs públicas, nombres de host, IPv6,
//     octales/hex y las direcciones de red/difusión .0 y .255.
// ============================================================================

const OCTET = /^(0|[1-9]\d{0,2})$/;

/** `true` solo para IPv4 literales dentro de RFC 1918 (sin red ni difusión). */
export function isRfc1918IPv4(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 15) return false;
  const parts = raw.split(".");
  if (parts.length !== 4 || !parts.every((p) => OCTET.test(p))) return false;
  const [a, b, c, d] = parts.map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (d === 0 || d === 255) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
