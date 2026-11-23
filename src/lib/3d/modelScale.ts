// ============================================================================
// ANDROS — ESCALA DE PIEZAS 3D
// La escala se guarda en el nodo como `[x, y, z]` (1 = 100 %). Ejes de
// impresora: X = ancho, Y = profundidad, Z = alto.
// ============================================================================

export type ModelScale = [number, number, number];

/** Medidas envolventes en mm (mismo formato que `modelDimensionsMm`). */
export interface ScaleDimensions {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export const IDENTITY_SCALE: ModelScale = [1, 1, 1];
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 5;
/** Cubo de holgura para "Ajustar a cama" (cama de 150 mm de la Adventurer 3). */
export const BED_FIT_MM = 145;

export function clampScaleFactor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  return Math.round(clamped * 10000) / 10000;
}

/** Acepta lo guardado en el nodo (o nada) y devuelve una escala válida. */
export function normalizeScale(scale: readonly number[] | null | undefined): ModelScale {
  if (!scale || scale.length !== 3) return [...IDENTITY_SCALE];
  return [clampScaleFactor(scale[0]), clampScaleFactor(scale[1]), clampScaleFactor(scale[2])];
}

export function isIdentityScale(scale: readonly number[]): boolean {
  return scale.every((v) => Math.abs(v - 1) < 1e-4);
}

export function isUniformScale(scale: readonly number[]): boolean {
  return Math.abs(scale[0] - scale[1]) < 1e-4 && Math.abs(scale[0] - scale[2]) < 1e-4;
}

export function scaleKey(scale: readonly number[]): string {
  return scale.map((v) => v.toFixed(4)).join(",");
}

/** Multiplica la escala manteniendo las proporciones (sin salir de 10–500 %). */
export function multiplyScale(scale: ModelScale, factor: number): ModelScale {
  if (!Number.isFinite(factor) || factor <= 0) return scale;
  const lo = Math.max(...scale.map((v) => MIN_SCALE / v));
  const hi = Math.min(...scale.map((v) => MAX_SCALE / v));
  const f = Math.min(hi, Math.max(lo, factor));
  return normalizeScale(scale.map((v) => v * f));
}

export function scaleDimensions(dims: ScaleDimensions, scale: readonly number[]): ScaleDimensions {
  return {
    widthMm: dims.widthMm * scale[0],
    depthMm: dims.depthMm * scale[1],
    heightMm: dims.heightMm * scale[2],
  };
}

/** Escala proporcional para que la pieza quepa holgada en un cubo de `bedMm`. */
export function fitToBedScale(
  baseDims: ScaleDimensions,
  current: ModelScale,
  bedMm = BED_FIT_MM
): ModelScale {
  const scaled = scaleDimensions(baseDims, current);
  const biggest = Math.max(scaled.widthMm, scaled.depthMm, scaled.heightMm);
  if (!(biggest > 0)) return current;
  return multiplyScale(current, bedMm / biggest);
}

/** "120 %" o "120 × 100 × 80 %". */
export function formatScale(scale: readonly number[]): string {
  const pct = (v: number) => `${Math.round(v * 1000) / 10}`;
  return isUniformScale(scale) ? `${pct(scale[0])} %` : `${scale.map(pct).join(" × ")} %`;
}

/** Etiqueta para nombres de archivo: "120pct" o "120x100x80pct". */
export function scaleFileTag(scale: readonly number[]): string {
  const pct = (v: number) => String(Math.round(v * 100));
  return isUniformScale(scale) ? `${pct(scale[0])}pct` : `${scale.map(pct).join("x")}pct`;
}
