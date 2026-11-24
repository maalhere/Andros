// ============================================================================
// ANDROS — ADAPTADORES DE IMPRESORA (uno por ecosistema del registro)
// ============================================================================

import type { PrinterEcosystem } from "../registry";
import { bambuSlicerHandoffAdapter } from "./bambuSlicerHandoff";
import { flashforgeTcpAdapter } from "./flashforgeTcp";
import { genericSlicerDownloadAdapter } from "./genericSlicerDownload";
import { klipperMoonrakerAdapter } from "./klipperMoonraker";
import type { PrinterAdapter } from "./types";

export const ADAPTERS: Record<PrinterEcosystem, PrinterAdapter> = {
  "klipper-moonraker": klipperMoonrakerAdapter,
  "flashforge-tcp": flashforgeTcpAdapter,
  "bambu-slicer-handoff": bambuSlicerHandoffAdapter,
  "generic-slicer-download": genericSlicerDownloadAdapter,
};

export function getAdapter(ecosystem: PrinterEcosystem): PrinterAdapter {
  return ADAPTERS[ecosystem];
}

export { flashforgeTcpAdapter, klipperMoonrakerAdapter, bambuSlicerHandoffAdapter, genericSlicerDownloadAdapter };
export type { HandoffFile, HandoffOptions, HandoffResult, PrinterAdapter } from "./types";
