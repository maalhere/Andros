// ============================================================================
// ANDROS — TIPOS DE ARCHIVO 3D (módulo ligero, sin Three.js)
// Lo importan las tarjetas de archivo al cargar la página; el visor 3D y el
// diálogo de impresión se descargan aparte, solo cuando hacen falta.
// ============================================================================

/** Dimensiones envolventes reales de la pieza, en milímetros. */
export interface ModelDimensions {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

const PREVIEWABLE_EXTENSIONS = ["stl", "obj", "3mf"];
const PRINTABLE_EXTENSIONS = ["stl", "obj", "3mf", "step", "stp", "gcode"];

/** El visor 3D de la tarjeta sabe dibujar esta extensión. */
export function isPreviewable3D(extension: string): boolean {
  return PREVIEWABLE_EXTENSIONS.includes(extension.toLowerCase());
}

/** El diálogo «Imprimir en 3D» acepta esta extensión. */
export function isPrintable3D(extension: string): boolean {
  return PRINTABLE_EXTENSIONS.includes(extension.toLowerCase());
}

/** 120 → "120.0" · 35.2 → "35.20" (más decimales en piezas pequeñas). */
export function formatMm(value: number): string {
  return value >= 100 ? value.toFixed(1) : value.toFixed(2);
}
