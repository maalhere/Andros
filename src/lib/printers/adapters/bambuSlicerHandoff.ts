// ============================================================================
// ADAPTADOR bambu-slicer-handoff — Bambu Lab A1 Mini / A1 / P1S / X1 Carbon
// Bambu Lab solo acepta trabajos firmados desde Bambu Studio / Bambu Connect:
// Andros exporta el .stl preparado (escala + soportes) y lo abre en Bambu
// Studio u OrcaSlicer, con la hoja de parámetros recomendada a la vista.
// ============================================================================

import { SLICERS, printerName, MATERIAL_LABEL } from "../registry";
import { handoffToSlicer, profileSummary } from "./handoff";
import type { PrinterAdapter } from "./types";

export const bambuSlicerHandoffAdapter: PrinterAdapter = {
  ecosystem: "bambu-slicer-handoff",
  title: "Bambu Lab · Bambu Studio",
  directNetwork: false,
  directFormats: [],
  canUseNetwork: () => false,
  handoff: (_printer, file, options) => handoffToSlicer(file, options),
  guide(printer, profile, fileName, slicer) {
    return [
      `Abre ${fileName} en ${SLICERS[slicer].name}.`,
      `Elige «${printerName(printer)}» y filamento ${MATERIAL_LABEL[profile.material]} genérico; aplica: ${profileSummary(profile)}.`,
      "Pulsa Laminar → Imprimir: se envía por Wi-Fi/LAN o a la tarjeta microSD.",
    ];
  },
};
