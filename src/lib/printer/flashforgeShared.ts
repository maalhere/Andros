// ============================================================================
// ANDROS — TIPOS Y UTILIDADES PURAS DE LA IMPRESORA FLASHFORGE
// Sin dependencias de Node: lo importan tanto el navegador (Print3DModal)
// como el núcleo de red (flashforgeNet.ts) y la app de escritorio.
//
// (Sprint 17B) Un solo validador de destino para la ruta web, la app de
// Windows y el navegador: IPv4 RFC 1918 estricta (`isRfc1918IPv4`, sin
// 169.254/16, loopback ni red/difusión) y SOLO el puerto 8899.
// ============================================================================

import { isRfc1918IPv4 } from "./rfc1918";

export const FLASHFORGE_DEFAULT_PORT = 8899;

export interface PrinterMachineInfo {
  type: string | null;
  name: string | null;
  firmware: string | null;
  sn?: string | null;
}

export interface PrinterTemperatures {
  extruder: { current: number; target: number } | null;
  bed: { current: number; target: number } | null;
}

export interface PrinterProgress {
  printing: boolean;
  percent: number;
  layer: string | null;
}

export interface PrinterStatusData {
  machine: PrinterMachineInfo;
  temperatures: PrinterTemperatures;
  progress: PrinterProgress;
}

/** Respuesta de "estado" (ruta GET o puente de escritorio). */
export interface PrinterStatus extends Partial<PrinterStatusData> {
  ok: boolean;
  error?: string;
  /** true si no se consultó porque se está enviando un archivo (un solo socket). */
  busy?: boolean;
}

export interface DiscoveredPrinter {
  ip: string;
  port: number;
  name: string | null;
  type: string | null;
  firmware: string | null;
  serial: string | null;
  isAdventurer3: boolean;
  /** true si respondió a ~M115 por TCP (no solo al anuncio UDP). */
  verified: boolean;
  via: "udp" | "tcp";
}

export interface DiscoveryResult {
  ok: boolean;
  printers: DiscoveredPrinter[];
  /** Subredes barridas, p. ej. "192.168.1.0/24". */
  subnets: string[];
  error?: string;
  /** true cuando el servidor no está en la red del usuario (Vercel). */
  remote?: boolean;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
  fileName?: string;
  bytes?: number;
}

/**
 * IPv4 de tu red privada (RFC 1918). Alias del validador común
 * `isRfc1918IPv4`: ya NO acepta 169.254/16 (enlace local / metadatos).
 */
export function isPrivateIPv4(ip: string): boolean {
  return isRfc1918IPv4(ip);
}

/** IP + puerto validados para la FlashForge, o el mensaje de error para mostrar. */
export function parseFlashforgeTarget(ipRaw: unknown, portRaw: unknown): { ip: string; port: number } | string {
  const ip = String(ipRaw ?? "").trim();
  const port =
    portRaw === undefined || portRaw === null || portRaw === "" ? FLASHFORGE_DEFAULT_PORT : Number(portRaw);
  if (!isRfc1918IPv4(ip)) {
    return "Escribe la IP local de la impresora (ej. 192.168.1.45). Solo se aceptan direcciones de tu red privada.";
  }
  if (port !== FLASHFORGE_DEFAULT_PORT) {
    return `Puerto no permitido. La FlashForge usa el ${FLASHFORGE_DEFAULT_PORT}.`;
  }
  return { ip, port };
}

/** La Adventurer 3 se anuncia como "FlashForge Adventurer III" en ~M115. */
export function isAdventurer3Name(text: string | null | undefined): boolean {
  return /adventurer[\s_-]*(3|iii)(?![a-z0-9])/i.test(text ?? "");
}
