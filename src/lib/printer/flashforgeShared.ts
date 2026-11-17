// ============================================================================
// ANDROS — TIPOS Y UTILIDADES PURAS DE LA IMPRESORA FLASHFORGE
// Sin dependencias de Node: lo importan tanto el navegador (Print3DModal)
// como el núcleo de red (flashforgeNet.ts) y la app de escritorio.
// ============================================================================

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

export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** La Adventurer 3 se anuncia como "FlashForge Adventurer III" en ~M115. */
export function isAdventurer3Name(text: string | null | undefined): boolean {
  return /adventurer[\s_-]*(3|iii)(?![a-z0-9])/i.test(text ?? "");
}
