// ============================================================================
// ADAPTADOR generic-slicer-download — Prusa, Anycubic, Elegoo Centauri Carbon,
// Ender-3 V3 SE, FlashForge Adventurer 5M…
// Descarga limpia del archivo preparado + guía de 3 pasos con los parámetros
// del perfil elegido (Rápido / Estándar / Fuerte). En la app de Windows se
// abre directamente en el laminador si está instalado.
// ============================================================================

import { SLICERS, printerName } from "../registry";
import { handoffToSlicer, profileSummary } from "./handoff";
import type { PrinterAdapter } from "./types";

export const genericSlicerDownloadAdapter: PrinterAdapter = {
  ecosystem: "generic-slicer-download",
  title: "Descarga + laminador",
  directNetwork: false,
  directFormats: [],
  canUseNetwork: () => false,
  handoff: (_printer, file, options) => handoffToSlicer(file, options),
  guide(printer, profile, fileName, slicer) {
    return [
      `Abre ${fileName} en ${SLICERS[slicer].name} (doble clic o Archivo → Importar).`,
      `Elige la impresora «${printerName(printer)}» y aplica: ${profileSummary(profile)}.`,
      "Lamina y envía el archivo a la impresora (Wi-Fi, USB o tarjeta).",
    ];
  },
};
