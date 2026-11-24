// ============================================================================
// ANDROS — CLIENTE DEL ESTUDIO DE EXPORTACIÓN (solo navegador)
//
//   requestExportOutline   «Sintetizar con IA» (1 consulta de la cuota diaria,
//                          o sin tope con la clave propia BYOK) con respaldo
//                          instantáneo local si no hay cuota, red o clave.
//   prepareEmbeddedImages  fotos de las fichas → JPEG/PNG listos para Word y
//                          PowerPoint (WebP no se abre en todos). Todo ocurre
//                          en el dispositivo: las imágenes nunca se envían.
// ============================================================================

import { getUserAiKey } from "@/store/useAiProvidersStore";
import { checkFreeQuota, recordFreeQuery } from "@/store/useAiQuotaStore";
import { buildLocalExportOutline } from "./buildLocalExportOutline";
import type {
  EmbeddedImage,
  EmbeddedImages,
  ExportCard,
  ExportMode,
  ExportOutline,
  ExportOutlineResponse,
  ExportPhotoAsset,
} from "./exportOutline";

const REQUEST_TIMEOUT_MS = 65_000;

export interface OutlineResult {
  outline: ExportOutline;
  /** `true` si lo redactó la IA. */
  usedAi: boolean;
  /** Aviso para la persona cuando se pidió IA y se usó el respaldo local. */
  notice: string | null;
  model: string | null;
}

export async function requestExportOutline(params: {
  mode: ExportMode;
  title: string;
  cards: ExportCard[];
  instruction: string;
  useAi: boolean;
  generatedAt: Date;
}): Promise<OutlineResult> {
  const { mode, title, cards, instruction, useAi, generatedAt } = params;
  const local = (notice: string | null): OutlineResult => ({
    outline: buildLocalExportOutline(mode, title, cards, generatedAt),
    usedAi: false,
    notice,
    model: null,
  });
  if (!useAi || cards.length === 0) return local(null);

  const quota = checkFreeQuota();
  if (!quota.ok) return local(`${quota.message} Se exportó el contenido directo del tablero.`);

  const apiKey = getUserAiKey("gemini");
  let data: ExportOutlineResponse | null = null;
  try {
    const res = await fetch("/api/oracle/export-outline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, title, instruction, cards, ...(apiKey ? { apiKey } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    data = (await res.json().catch(() => null)) as ExportOutlineResponse | null;
  } catch {
    data = null;
  }

  if (!data) return local("Sin conexión con la IA de Andros: se exportó el contenido directo del tablero.");
  if (!data.ok) return local(`${data.issue.message} Se exportó el contenido directo del tablero.`);

  // Solo cuenta si de verdad se usó la clave gratuita del servidor.
  recordFreeQuery();
  if (data.model === "local") {
    return { outline: data.outline, usedAi: false, notice: "La IA no devolvió una estructura válida: se usó el contenido directo del tablero.", model: null };
  }
  return { outline: data.outline, usedAi: true, notice: null, model: data.model };
}

/** `photoId` que cita la estructura (en orden, sin repetir). */
export function outlinePhotoIds(outline: ExportOutline): string[] {
  const ids = outline.mode === "document" ? outline.sections.flatMap((s) => s.photoIds) : outline.slides.map((s) => s.photoId);
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** Lado mayor de las fotos incrustadas (calidad de impresión sin inflar el archivo). */
const EMBED_MAX_SIDE = 1600;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("imagen ilegible"));
    img.src = src;
  });
}

async function toEmbeddable(asset: ExportPhotoAsset): Promise<EmbeddedImage> {
  const img = await loadImage(asset.src);
  const width = img.naturalWidth || asset.width;
  const height = img.naturalHeight || asset.height;
  const direct = /^data:image\/(png|jpe?g);base64,/i.exec(asset.src);
  if (direct) {
    return { dataUrl: asset.src, type: direct[1].toLowerCase() === "png" ? "png" : "jpg", width, height, alt: asset.alt };
  }
  // WebP u otro formato → JPEG con fondo blanco (Word y Slides no siempre abren WebP).
  const scale = Math.min(1, EMBED_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), type: "jpg", width: canvas.width, height: canvas.height, alt: asset.alt };
}

/** Convierte solo las fotos citadas; una foto ilegible se omite sin romper la exportación. */
export async function prepareEmbeddedImages(photoIds: string[], assets: Map<string, ExportPhotoAsset>): Promise<EmbeddedImages> {
  const out: EmbeddedImages = new Map();
  for (const id of photoIds) {
    const asset = assets.get(id);
    if (!asset) continue;
    try {
      out.set(id, await toEmbeddable(asset));
    } catch {
      // Foto dañada o bloqueada: el resto del documento sigue.
    }
  }
  return out;
}
