// ============================================================================
// ANDROS — ENTREGA AL LAMINADOR (compartida por los adaptadores)
//   1. App de Windows: el puente nativo guarda el archivo en una carpeta
//      temporal y lo abre en el laminador instalado (1 clic).
//   2. Web con el archivo original en la nube: protocolo del laminador
//      (orcaslicer://, bambustudio://, prusaslicer://).
//   3. Respaldo: descarga con permiso previo.
// ============================================================================

import { requestFileDownload } from "@/lib/downloadWithPermission";
import { getDesktopBridge } from "@/lib/printer/printerClient";
import { MATERIAL_LABEL, PROFILE_LABEL, SLICERS, printerName, type PrintProfile, type PrinterModel, type SlicerId } from "../registry";
import type { HandoffFile, HandoffOptions, HandoffResult } from "./types";

export async function handoffToSlicer(file: HandoffFile, options: HandoffOptions): Promise<HandoffResult> {
  const slicer = SLICERS[options.slicer];
  let notInstalled = false;

  const bridge = getDesktopBridge();
  if (bridge?.slicers) {
    try {
      const opened = await bridge.slicers.open(slicer.id, file.fileName, file.bytes);
      if (opened.ok) return { outcome: "native", slicer: slicer.id };
      notInstalled = Boolean(opened.notInstalled);
    } catch {
      // Puente no disponible: se sigue con el respaldo.
    }
  }

  if (!bridge && options.fileIsOriginal && options.originalCloudLink && slicer.openScheme) {
    const url = new URL(`${slicer.openScheme}${encodeURIComponent(options.originalCloudLink)}`);
    window.location.assign(url.href);
    return { outcome: "protocol", slicer: slicer.id };
  }

  const ok = await requestFileDownload({
    filename: file.fileName,
    blobOrUrl: file.bytes,
    mimeType: file.mimeType,
    description: file.description,
  });
  return { outcome: ok ? "download" : "none", slicer: slicer.id, notInstalled };
}

/** Resumen corto del perfil para la guía de pasos. */
export function profileSummary(profile: PrintProfile): string {
  return `capa ${profile.layerHeight.toFixed(2)} mm, ${profile.wallCount} paredes, relleno ${profile.infillPercent} %, ${profile.nozzleTemp} °C / cama ${profile.bedTemp} °C`;
}

/** Hoja de parámetros en texto plano (para copiar al laminador). */
export function profileSheetText(printerModel: PrinterModel, profile: PrintProfile, slicer: SlicerId): string {
  return [
    `Andros · ${printerName(printerModel)} · ${PROFILE_LABEL[profile.profile]} · ${MATERIAL_LABEL[profile.material]}`,
    `Laminador: ${SLICERS[slicer].name}`,
    `Altura de capa: ${profile.layerHeight.toFixed(2)} mm`,
    `Paredes: ${profile.wallCount}`,
    `Capas sólidas arriba/abajo: ${profile.topBottomLayers}`,
    `Relleno: ${profile.infillPercent} % ${profile.infillPattern === "gyroid" ? "giroide" : "reticular"}`,
    `Velocidad: ${profile.speed} mm/s`,
    `Boquilla / cama: ${profile.nozzleTemp} °C / ${profile.bedTemp} °C`,
    `Ventilador: ${profile.fanPercent} %`,
    profile.warning ? `Aviso: ${profile.warning}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
