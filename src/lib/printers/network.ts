// ============================================================================
// ANDROS — VALIDACIÓN DE DESTINOS EN LA RED LOCAL (anti-SSRF)
//
// Las impresoras Klipper se contactan por HTTP en el Wi-Fi del usuario. Para
// que ni la ruta /api/printer/klipper ni el puente de Electron sirvan de
// trampolín hacia Internet o hacia servicios internos, solo se aceptan:
//   · IPv4 literales de las redes privadas RFC 1918: 10/8, 172.16/12 y
//     192.168/16 (sin nombres de host, sin IPv6, sin octales ni hex).
//   · Puertos estándar de Moonraker / Fluidd (7125, 4408, 80).
// Se rechazan explícitamente loopback (127/8), enlace local (169.254/16, que
// incluye el servicio de metadatos de la nube 169.254.169.254), 0.0.0.0, CGNAT
// (100.64/10) y las direcciones de red/difusión .0 y .255.
// Módulo puro: lo usan el navegador, la ruta de Next.js, Electron y el
// script de verificación.
// ============================================================================

import { KLIPPER_PORTS } from "./registry";

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

export interface LocalTarget {
  ip: string;
  port: number;
}

export function isKlipperPort(port: number): boolean {
  return (KLIPPER_PORTS as readonly number[]).includes(port);
}

/** IP + puerto validados, o el mensaje de error para mostrar. */
export function parseKlipperTarget(ipRaw: unknown, portRaw: unknown): LocalTarget | string {
  const ip = String(ipRaw ?? "").trim();
  const port = portRaw === undefined || portRaw === null || portRaw === "" ? 7125 : Number(portRaw);
  if (!isRfc1918IPv4(ip)) {
    return "Escribe la IP local de la impresora (ej. 192.168.1.45). Solo se aceptan direcciones de tu red privada.";
  }
  if (!Number.isInteger(port) || !isKlipperPort(port)) {
    return `Puerto no permitido. Usa ${KLIPPER_PORTS.join(", ")} (Moonraker / Fluidd).`;
  }
  return { ip, port };
}
