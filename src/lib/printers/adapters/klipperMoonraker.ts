// ============================================================================
// ADAPTADOR klipper-moonraker — Creality K2 SE / K1 / K1 Max / Ender-3 V3 KE,
// Elegoo Neptune 4 Pro, QIDI Q1 Pro / Plus4
//
//   · Envío directo de .gcode ya laminado por la API HTTP local de Moonraker:
//     app de Windows (puente nativo) o /api/printer/klipper con npm run dev.
//   · Piezas .stl/.obj/.3mf o web en la nube: 1 clic hacia Creality Print /
//     OrcaSlicer, que laminan con el perfil oficial de la máquina.
// ============================================================================

import type { PrintResult, PrinterStatus } from "@/lib/printer/flashforgeShared";
import { canReachLocalNetwork, getDesktopBridge } from "@/lib/printer/printerClient";
import type { LocalTarget } from "../network";
import { PRINTER_BRIDGE_HEADERS } from "@/lib/printer/bridgeGuard";
import { SLICERS, printerName } from "../registry";
import { handoffToSlicer, profileSummary } from "./handoff";
import type { PrinterAdapter } from "./types";

const ROUTE = "/api/printer/klipper";

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return { ok: false, error: fallback } as T;
  }
}

export const klipperMoonrakerAdapter: PrinterAdapter = {
  ecosystem: "klipper-moonraker",
  title: "Klipper · Moonraker",
  directNetwork: true,
  directFormats: ["gcode"],

  canUseNetwork() {
    const bridge = getDesktopBridge();
    // Versiones anteriores de la app de Windows no traen el puente Klipper.
    if (bridge) return Boolean(bridge.klipper);
    return canReachLocalNetwork();
  },

  async status(target: LocalTarget): Promise<PrinterStatus> {
    const bridge = getDesktopBridge();
    if (bridge?.klipper) return bridge.klipper.status(target.ip, target.port);
    const query = new URLSearchParams({ ip: target.ip, port: String(target.port) });
    const res = await fetch(`${ROUTE}?${query.toString()}`, { cache: "no-store", headers: PRINTER_BRIDGE_HEADERS });
    return readJson<PrinterStatus>(res, "No se pudo leer el estado de la impresora.");
  },

  async send(target: LocalTarget, fileName: string, bytes: Uint8Array<ArrayBuffer>): Promise<PrintResult> {
    const bridge = getDesktopBridge();
    if (bridge?.klipper) return bridge.klipper.print(target.ip, target.port, fileName, bytes);
    const query = new URLSearchParams({ action: "print", ip: target.ip, port: String(target.port), name: fileName });
    const res = await fetch(`${ROUTE}?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", ...PRINTER_BRIDGE_HEADERS },
      body: new Blob([bytes]),
    });
    return readJson<PrintResult>(res, "La impresora no confirmó el trabajo.");
  },

  handoff: (_printer, file, options) => handoffToSlicer(file, options),

  guide(printer, profile, fileName, slicer) {
    const name = printerName(printer);
    return [
      `Abre ${fileName} en ${SLICERS[slicer].name} y elige tu ${name}.`,
      `Aplica el perfil: ${profileSummary(profile)}.`,
      `Lamina y pulsa Enviar: tu ${name} lo recibe por Wi-Fi. También puedes subir el .gcode a una tarjeta de Andros y enviarlo desde aquí.`,
    ];
  },
};
