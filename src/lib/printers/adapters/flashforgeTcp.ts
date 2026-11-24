// ============================================================================
// ADAPTADOR flashforge-tcp — FlashForge Adventurer 3
// Envoltorio fino sobre la integración existente (sin cambios de protocolo):
// laminado .gx en el navegador, puerto 8899, autodescubrimiento UDP/TCP,
// puente de la app de Windows y ruta /api/printer/flashforge.
// ============================================================================

import type { DiscoveryResult, PrintResult, PrinterStatus } from "@/lib/printer/flashforgeShared";
import {
  canReachLocalNetwork,
  discoverPrinters,
  fetchPrinterStatus,
  sendPrintJob,
} from "@/lib/printer/printerClient";
import type { LocalTarget } from "../network";
import { SLICERS, printerName } from "../registry";
import { handoffToSlicer, profileSummary } from "./handoff";
import type { PrinterAdapter } from "./types";

export interface FlashForgeAdapter extends PrinterAdapter {
  discover(): Promise<DiscoveryResult>;
}

export const flashforgeTcpAdapter: FlashForgeAdapter = {
  ecosystem: "flashforge-tcp",
  title: "FlashForge · Wi-Fi directo",
  directNetwork: true,
  directFormats: ["gx", "g", "gcode"],

  canUseNetwork: () => canReachLocalNetwork(),

  discover: () => discoverPrinters(),

  status: (target: LocalTarget): Promise<PrinterStatus> => fetchPrinterStatus(target.ip, target.port),

  send: (target: LocalTarget, fileName: string, bytes: Uint8Array<ArrayBuffer>): Promise<PrintResult> =>
    sendPrintJob(target.ip, target.port, fileName, bytes),

  handoff: (_printer, file, options) => handoffToSlicer(file, options),

  guide(printer, profile, fileName, slicer) {
    return [
      `Abre ${fileName} en ${SLICERS[slicer].name} 5 (doble clic).`,
      `Elige tu ${printerName(printer)} y aplica: ${profileSummary(profile)}.`,
      "Pulsa Imprimir: por Wi-Fi o copia el archivo a una memoria USB.",
    ];
  },
};
