// ============================================================================
// ANDROS — CLIENTE DE IMPRESORA (navegador)
//
// Elige el camino a la FlashForge según dónde corre Andros:
//   · App de Windows (Electron): puente nativo `window.androsDesktop`
//     (electron/preload.cjs) → sockets directos desde el equipo del usuario.
//   · `npm run dev` en la misma red: la ruta /api/printer/flashforge.
//   · Web pública (Vercel): sin acceso al Wi-Fi local → se ofrece la app de
//     Windows y la descarga del .gx.
// ============================================================================

import {
  FLASHFORGE_DEFAULT_PORT,
  isPrivateIPv4,
  type DiscoveryResult,
  type PrintResult,
  type PrinterStatus,
} from "./flashforgeShared";
import { PRINTER_BRIDGE_HEADERS } from "@/lib/printer/bridgeGuard";

export interface AndrosDesktopBridge {
  isDesktop: true;
  platform: string;
  printer: {
    discover: () => Promise<DiscoveryResult>;
    status: (ip: string, port: number) => Promise<PrinterStatus>;
    print: (ip: string, port: number, fileName: string, data: Uint8Array) => Promise<PrintResult>;
  };
  /** Impresoras Klipper (Moonraker) por HTTP local (app ≥ Sprint 15). */
  klipper?: {
    status: (ip: string, port: number) => Promise<PrinterStatus>;
    print: (ip: string, port: number, fileName: string, data: Uint8Array) => Promise<PrintResult>;
  };
  /** Laminadores instalados en Windows (app ≥ Sprint 15). Nunca expone rutas del disco. */
  slicers?: {
    detect: () => Promise<{ id: string; installed: boolean }[]>;
    open: (
      slicerId: string,
      fileName: string,
      data: Uint8Array
    ) => Promise<{ ok: boolean; error?: string; notInstalled?: boolean }>;
  };
  /** Login con Google en el navegador del sistema (app ≥ esta versión). */
  auth?: {
    begin: () => Promise<{ port: number; state: string }>;
    openInBrowser: (url: string) => Promise<boolean>;
    cancel: () => Promise<boolean>;
    onResult: (callback: (result: { code?: string; error?: string }) => void) => () => void;
  };
}

declare global {
  interface Window {
    androsDesktop?: AndrosDesktopBridge;
  }
}

/** Instalador de la app de Windows (configurable con NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL). */
export const DESKTOP_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL ||
  "https://github.com/maalhere/Andros/releases/latest/download/Andros-Setup.exe";

export function getDesktopBridge(): AndrosDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.androsDesktop;
  return bridge?.isDesktop ? bridge : null;
}

/** true si Andros puede hablar con dispositivos del Wi-Fi del usuario. */
export function canReachLocalNetwork(): boolean {
  if (getDesktopBridge()) return true;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.endsWith(".local") || /^127\./.test(host) || isPrivateIPv4(host);
}

function toPort(port: string | number): number {
  return Number(port) || FLASHFORGE_DEFAULT_PORT;
}

export async function discoverPrinters(): Promise<DiscoveryResult> {
  const bridge = getDesktopBridge();
  if (bridge) return bridge.printer.discover();
  const res = await fetch("/api/printer/flashforge", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...PRINTER_BRIDGE_HEADERS },
    body: JSON.stringify({ action: "discover" }),
    cache: "no-store",
  });
  return (await res.json()) as DiscoveryResult;
}

export async function fetchPrinterStatus(ip: string, port: string | number): Promise<PrinterStatus> {
  const bridge = getDesktopBridge();
  if (bridge) return bridge.printer.status(ip.trim(), toPort(port));
  const query = new URLSearchParams({ ip: ip.trim(), port: String(toPort(port)) });
  const res = await fetch(`/api/printer/flashforge?${query.toString()}`, {
    cache: "no-store",
    headers: PRINTER_BRIDGE_HEADERS,
  });
  return (await res.json()) as PrinterStatus;
}

export async function sendPrintJob(
  ip: string,
  port: string | number,
  fileName: string,
  bytes: Uint8Array<ArrayBuffer>
): Promise<PrintResult> {
  const bridge = getDesktopBridge();
  if (bridge) return bridge.printer.print(ip.trim(), toPort(port), fileName, bytes);
  const query = new URLSearchParams({ action: "print", ip: ip.trim(), port: String(toPort(port)), name: fileName });
  const res = await fetch(`/api/printer/flashforge?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...PRINTER_BRIDGE_HEADERS },
    body: new Blob([bytes]),
  });
  return (await res.json()) as PrintResult;
}
