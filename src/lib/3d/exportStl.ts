// ============================================================================
// ANDROS — EXPORTACIÓN .STL BINARIA LISTA PARA IMPRIMIR
// Serializa la pieza con la escala actual aplicada (centrada y apoyada en
// Z = 0) y, si están activados, con los pilares de soporte fusionados. El
// archivo abre directo en FlashPrint 5, Cura, PrusaSlicer o Bambu Studio.
//
// Formato STL binario: cabecera de 80 bytes · uint32 nº de triángulos ·
// por triángulo 50 bytes (normal + 3 vértices en float32 LE + uint16 = 0).
// ============================================================================

import { requestFileDownload } from "@/lib/downloadWithPermission";
import { scaleAndGroundSoup } from "@/lib/3d/autoSupports";
import { scaleFileTag, type ModelScale } from "@/lib/3d/modelScale";

/** Une varias sopas de triángulos en una sola. */
export function mergeSoups(...soups: (Float32Array | null | undefined)[]): Float32Array {
  const parts = soups.filter((s): s is Float32Array => !!s && s.length > 0);
  if (parts.length === 1) return parts[0];
  const out = new Float32Array(parts.reduce((sum, s) => sum + s.length, 0));
  let offset = 0;
  for (const s of parts) {
    out.set(s, offset);
    offset += s.length;
  }
  return out;
}

/** Sopa de triángulos (mm) → bytes de un .stl binario válido. */
export function encodeBinaryStl(soup: Float32Array, header = "Andros - STL binario preparado"): Uint8Array<ArrayBuffer> {
  const triCount = Math.floor(soup.length / 9);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Cabecera ASCII (no debe empezar por "solid": algunos lectores lo tomarían por ASCII).
  const ascii = header.replace(/[^\x20-\x7e]/g, "").slice(0, 80);
  for (let i = 0; i < ascii.length; i += 1) bytes[i] = ascii.charCodeAt(i);
  view.setUint32(80, triCount, true);

  let o = 84;
  for (let t = 0; t < triCount; t += 1) {
    const p = t * 9;
    const ux = soup[p + 3] - soup[p], uy = soup[p + 4] - soup[p + 1], uz = soup[p + 5] - soup[p + 2];
    const vx = soup[p + 6] - soup[p], vy = soup[p + 7] - soup[p + 1], vz = soup[p + 8] - soup[p + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (let k = 0; k < 9; k += 1) {
      view.setFloat32(o, soup[p + k], true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return bytes;
}

/** "Soporte Lámpara" + 120 % + soportes → `soporte_lampara_120pct_soportes.stl`. */
export function preparedStlFileName(pieceName: string, scale: ModelScale, withSupports: boolean): string {
  const base =
    pieceName
      .replace(/\.(stl|obj|3mf)$/i, "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "pieza";
  return `${base}_${scaleFileTag(scale)}${withSupports ? "_soportes" : ""}.stl`;
}

/**
 * Pieza original (sopa sin escalar) → .stl binario con la escala aplicada,
 * apoyado en la cama y con los pilares fusionados (si se pasan).
 * `supportsSoup` debe estar calculado sobre la misma pieza escalada.
 */
export function buildPreparedStl(options: {
  soup: Float32Array;
  scale: ModelScale;
  supportsSoup?: Float32Array | null;
}): Uint8Array<ArrayBuffer> {
  const part = scaleAndGroundSoup(options.soup, options.scale);
  return encodeBinaryStl(mergeSoups(part, options.supportsSoup));
}

/** Prepara el .stl y lo descarga con el permiso previo del usuario. `true` si se inició. */
export function downloadPreparedStl(options: {
  soup: Float32Array;
  scale: ModelScale;
  supportsSoup?: Float32Array | null;
  pieceName: string;
}): Promise<boolean> {
  const withSupports = !!options.supportsSoup && options.supportsSoup.length > 0;
  const bytes = buildPreparedStl(options);
  return requestFileDownload({
    filename: preparedStlFileName(options.pieceName, options.scale, withSupports),
    blobOrUrl: bytes,
    mimeType: "model/stl",
    description: withSupports
      ? "Pieza escalada con soportes automáticos fusionados, lista para tu laminador."
      : "Pieza escalada y apoyada en la cama, lista para tu laminador.",
  });
}
