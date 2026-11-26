// ============================================================================
// ANDROS — ¿ES UNA DIRECCIÓN PÚBLICA DE INTERNET? (anti-SSRF, módulo puro)
//
// Lo usa /api/link-preview antes de cada conexión (y en cada redirección)
// para que el servidor nunca sirva de trampolín hacia redes internas:
//   · IPv4 bloqueadas: 0/8, 10/8, 100.64/10 (CGNAT), 127/8 (loopback),
//     169.254/16 (enlace local y metadatos de la nube), 172.16/12,
//     192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24,
//     203.0.113/24, 224/4 (multidifusión) y 240/4 (reservado + difusión).
//   · IPv6 bloqueadas: ::, ::1, fe80::/10, fec0::/10, fc00::/7 (ULA),
//     ff00::/8, 100::/64, 2001::/32 (Teredo), 2001:db8::/32 y cualquier IPv4
//     incrustada (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::/96, 2002::/16) que
//     caiga en un rango bloqueado.
//   · URL: solo http/https, puertos 80/443, sin usuario ni contraseña.
// Sin dependencias de Node: lo comparte scripts/verify-printers.ts.
// ============================================================================

const DEC_OCTET = /^(0|[1-9]\d{0,2})$/;

/** IPv4 en notación decimal estricta → 4 octetos, o `null`. */
export function parseIPv4(raw: string): [number, number, number, number] | null {
  const parts = raw.split(".");
  if (parts.length !== 4 || !parts.every((p) => DEC_OCTET.test(p))) return null;
  const octets = parts.map(Number);
  if (octets.some((n) => n > 255)) return null;
  return octets as [number, number, number, number];
}

/** IPv6 (con `::`, IPv4 incrustada y zona opcional) → 8 grupos de 16 bits, o `null`. */
export function parseIPv6(raw: string): number[] | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const left = toGroups(halves[0]);
  const right = halves.length === 2 ? toGroups(halves[1]) : [];
  if (halves.length === 2 && left.length + right.length > 7) return null;
  const groups =
    halves.length === 2
      ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (groups.length !== 8) return null;
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** `true` si la IPv4 es enrutable en Internet (no privada, local ni reservada). */
export function isPublicIPv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return false; // enlace local + metadatos de la nube
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // multidifusión, reservado y difusión
  return true;
}

function embeddedIPv4(g: readonly number[]): number[] {
  return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
}

/** `true` si la IPv6 es enrutable en Internet. */
export function isPublicIPv6(g: readonly number[]): boolean {
  const zeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUntil(8)) return false; // ::
  if (zeroUntil(7) && g[7] === 1) return false; // ::1
  if (zeroUntil(5) && g[5] === 0xffff) return isPublicIPv4(embeddedIPv4(g)); // ::ffff:a.b.c.d
  if (zeroUntil(6)) return isPublicIPv4(embeddedIPv4(g)); // ::a.b.c.d (obsoleta)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicIPv4(embeddedIPv4(g)); // NAT64
  }
  if (g[0] === 0x2002) return isPublicIPv4([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]); // 6to4
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 enlace local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 sitio local (obsoleta)
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multidifusión
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false; // 100::/64 descarte
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentación
  return true;
}

/** `true` solo para una IP literal (v4 o v6) pública. Un nombre de host → `false`. */
export function isPublicIpAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(address);
  return v6 ? isPublicIPv6(v6) : false;
}

/** `true` si `host` es una IP literal (con o sin corchetes). */
export function isIpLiteral(host: string): boolean {
  return parseIPv4(host) !== null || parseIPv6(host) !== null;
}

/** Puertos permitidos para la vista previa (vacío = el del esquema). */
export const PREVIEW_ALLOWED_PORTS: readonly string[] = ["", "80", "443"];

const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan"];

export type PreviewUrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/**
 * Primera barrera (sin red): esquema, puerto, credenciales y hosts locales
 * evidentes. La resolución DNS y la IP real se validan después, al conectar.
 */
export function checkPreviewUrl(raw: string): PreviewUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "URL inválida" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Solo se aceptan enlaces http:// o https://" };
  }
  if (url.username || url.password) return { ok: false, error: "El enlace no puede llevar usuario ni contraseña" };
  if (!PREVIEW_ALLOWED_PORTS.includes(url.port)) {
    return { ok: false, error: "Solo se aceptan los puertos estándar 80 y 443" };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, error: "No se permiten direcciones de redes locales" };
  }
  if (isIpLiteral(host) && !isPublicIpAddress(host)) {
    return { ok: false, error: "No se permiten direcciones de redes privadas o locales" };
  }
  return { ok: true, url };
}
