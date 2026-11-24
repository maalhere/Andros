// ============================================================================
// ANDROS — COMPRESIÓN DE FOTOS EN EL NAVEGADOR (solo cliente)
//
// Las fotos de las fichas (PC, cámara del celular o portapapeles) se
// redimensionan a máx. 1280 px por lado y se codifican en WebP (o JPEG si el
// navegador no sabe escribir WebP). La calidad baja por pasos hasta que la
// imagen pesa ≤ ~150 KB, para no saturar la memoria, la cuota de Supabase ni
// la sala en vivo. También se genera una miniatura de 320 px (~10–20 KB).
// Nada sale del dispositivo en este paso.
// ============================================================================

import type { FormPhoto } from "@/types/workspace";
import { newFormId } from "./formSchema";

export const PHOTO_MAX_SIDE = 1280;
export const THUMB_MAX_SIDE = 320;
/** Tope del `data:` de la imagen completa (caracteres ≈ bytes). */
const TARGET_DATA_URL_CHARS = 200_000;
const THUMB_TARGET_CHARS = 28_000;
/** Archivos de origen más grandes que esto se rechazan antes de decodificar. */
export const PHOTO_MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export class PhotoError extends Error {}

let webpSupport: boolean | null = null;
function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpSupport = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

type Drawable = { source: CanvasImageSource; width: number; height: number; close?: () => void };

async function decode(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image`: respeta la orientación EXIF de las fotos del celular.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // HEIC u otro formato que el navegador no decodifica: se intenta con <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    throw new PhotoError("Este formato de imagen no se puede abrir en tu navegador. Prueba con JPG, PNG o WebP.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function render(image: Drawable, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("Tu navegador no permitió procesar la imagen.");
  // Fondo blanco: las PNG con transparencia no quedan negras al pasar a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Codifica bajando la calidad (y, si hace falta, el tamaño) hasta caber en `target`. */
function encode(canvas: HTMLCanvasElement, target: number): string {
  const type = supportsWebp() ? "image/webp" : "image/jpeg";
  let current = canvas;
  for (let shrink = 0; shrink < 4; shrink += 1) {
    for (const quality of [0.82, 0.72, 0.62, 0.5, 0.4]) {
      const url = current.toDataURL(type, quality);
      if (url.length <= target) return url;
    }
    // Aún pesa demasiado (foto con mucho detalle): se reduce un 20 % y se reintenta.
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(current.width * 0.8));
    next.height = Math.max(1, Math.round(current.height * 0.8));
    next.getContext("2d")?.drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  return current.toDataURL(type, 0.4);
}

/** Comprime una imagen (archivo, foto de cámara o pegada) y devuelve la foto lista para la ficha. */
export async function compressPhoto(file: Blob, name?: string): Promise<FormPhoto> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new PhotoError("Solo se pueden adjuntar imágenes (JPG, PNG, WebP…).");
  }
  if (file.size > PHOTO_MAX_SOURCE_BYTES) {
    throw new PhotoError("La imagen supera 25 MB. Elige una más ligera.");
  }
  const image = await decode(file);
  try {
    const full = render(image, PHOTO_MAX_SIDE);
    const src = encode(full, TARGET_DATA_URL_CHARS);
    const thumb = encode(render(image, THUMB_MAX_SIDE), THUMB_TARGET_CHARS);
    const fileName = name ?? (file instanceof File ? file.name : "");
    return {
      id: newFormId("img"),
      src,
      thumb,
      name: (fileName || "Imagen pegada").slice(0, 120),
      width: full.width,
      height: full.height,
      // base64 → bytes reales ≈ 3/4 del texto.
      bytes: Math.round((src.length - src.indexOf(",") - 1) * 0.75),
    };
  } finally {
    image.close?.();
  }
}

/** Primeras imágenes del portapapeles (evento `paste`). */
export function imagesFromClipboard(event: { clipboardData: DataTransfer | null }): File[] {
  const items = Array.from(event.clipboardData?.items ?? []);
  return items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((f): f is File => f !== null);
}

export function formatPhotoBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
