// ============================================================================
// ANDROS — GEOMETRÍA DE LA TINTA LIBRE DEL LIENZO (Lápiz D)
//
// - Convierte los puntos capturados con PointerEvent en curvas SVG suaves.
// - Si el stylus informa presión, el trazo se dibuja como un contorno relleno
//   de ancho variable (efecto pluma real); si no, como una línea uniforme.
// - Incluye la detección de "toque sobre un trazo" para el Borrador y el
//   cálculo de límites para Zoom Extents.
// ============================================================================

import type { CanvasInkColor, CanvasStroke, CanvasStrokePoint } from "@/types/workspace";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Color CSS real de cada tinta. "adaptive" sigue al tema (Grafito / Blanco). */
export function inkColorToCss(color: CanvasInkColor): string {
  return color === "adaptive" ? "var(--text-primary)" : color;
}

/** Redondea a 1 decimal: los trazos pesan menos en la nube sin perder calidad. */
export function roundInkValue(value: number): number {
  return Math.round(value * 10) / 10;
}

const fmt = (value: number) => roundInkValue(value).toString();

// ----------------------------------------------------------------------------
// 1. Trazo uniforme (mouse, dedo, resaltador)
// ----------------------------------------------------------------------------

/**
 * Curva suave que pasa por los puntos medios de cada par de puntos, usando
 * los puntos capturados como controles cuadráticos (técnica "midpoint").
 */
export function buildSmoothPath(points: CanvasStrokePoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    // Un toque sin movimiento: segmento mínimo para que se vea un punto redondo.
    return `M ${fmt(p.x)} ${fmt(p.y)} L ${fmt(p.x + 0.01)} ${fmt(p.y)}`;
  }
  if (points.length === 2) {
    const [a, b] = points;
    return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(b.x)} ${fmt(b.y)}`;
  }

  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    d += ` Q ${fmt(current.x)} ${fmt(current.y)} ${fmt(midX)} ${fmt(midY)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

// ----------------------------------------------------------------------------
// 2. Trazo con presión (S-Pen, Apple Pencil): contorno relleno de ancho variable
// ----------------------------------------------------------------------------

/** Radio del trazo en un punto según su presión (0.35× a 1.3× del grosor base). */
function radiusAt(point: CanvasStrokePoint, width: number): number {
  const pressure = point.p ?? 0.5;
  return (width / 2) * Math.min(1.3, 0.35 + pressure * 1.5);
}

/** Suaviza la presión para que el ancho no "tiemble" entre puntos vecinos. */
function smoothPressure(points: CanvasStrokePoint[]): CanvasStrokePoint[] {
  return points.map((point, i) => {
    const prev = points[i - 1] ?? point;
    const next = points[i + 1] ?? point;
    const p = ((prev.p ?? 0.5) + 2 * (point.p ?? 0.5) + (next.p ?? 0.5)) / 4;
    return { ...point, p };
  });
}

function smoothSide(side: { x: number; y: number }[]): string {
  let d = "";
  for (let i = 1; i < side.length - 1; i += 1) {
    const current = side[i];
    const next = side[i + 1];
    d += ` Q ${fmt(current.x)} ${fmt(current.y)} ${fmt((current.x + next.x) / 2)} ${fmt(
      (current.y + next.y) / 2
    )}`;
  }
  const last = side[side.length - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

export function buildPressureOutline(points: CanvasStrokePoint[], width: number): string {
  if (points.length < 3) return "";
  const pts = smoothPressure(points);
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];

  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const r = radiusAt(pts[i], width);
    // Normal perpendicular a la dirección del trazo.
    left.push({ x: pts[i].x - dy * r, y: pts[i].y + dx * r });
    right.push({ x: pts[i].x + dy * r, y: pts[i].y - dx * r });
  }

  const endRadius = radiusAt(pts[pts.length - 1], width);
  const startRadius = radiusAt(pts[0], width);
  const rightReversed = [...right].reverse();

  return [
    `M ${fmt(left[0].x)} ${fmt(left[0].y)}`,
    smoothSide(left),
    // Tapa redonda al final del trazo.
    `A ${fmt(endRadius)} ${fmt(endRadius)} 0 0 1 ${fmt(rightReversed[0].x)} ${fmt(
      rightReversed[0].y
    )}`,
    smoothSide(rightReversed),
    // Tapa redonda al inicio del trazo.
    `A ${fmt(startRadius)} ${fmt(startRadius)} 0 0 1 ${fmt(left[0].x)} ${fmt(left[0].y)}`,
    "Z",
  ].join(" ");
}

// ----------------------------------------------------------------------------
// 3. Borrador: ¿el toque cae sobre un trazo?
// ----------------------------------------------------------------------------

function distanceToSegment(
  p: { x: number; y: number },
  a: CanvasStrokePoint,
  b: CanvasStrokePoint
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** `true` si el punto está a menos de `tolerance` (unidades del lienzo) del trazo. */
export function isPointNearStroke(
  point: { x: number; y: number },
  stroke: CanvasStroke,
  tolerance: number
): boolean {
  const reach = stroke.width / 2 + tolerance;
  const box = getStrokeBounds(stroke);
  if (
    point.x < box.minX - reach ||
    point.x > box.maxX + reach ||
    point.y < box.minY - reach ||
    point.y > box.maxY + reach
  ) {
    return false;
  }
  const pts = stroke.points;
  if (pts.length === 1) return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= reach;
  for (let i = 1; i < pts.length; i += 1) {
    if (distanceToSegment(point, pts[i - 1], pts[i]) <= reach) return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// 4. Límites (para Zoom Extents)
// ----------------------------------------------------------------------------

export function getStrokeBounds(stroke: CanvasStroke): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of stroke.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const half = stroke.width / 2;
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}

export function mergeBounds(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return b;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

// ----------------------------------------------------------------------------
// 5. Validación de datos que vienen de la nube
// ----------------------------------------------------------------------------

const VALID_COLORS: readonly CanvasInkColor[] = ["adaptive", "#C95A3B", "#3B82F6", "#10B981"];

/** Limpia trazos leídos de Supabase: descarta lo que no tenga forma válida. */
export function sanitizeCanvasStrokes(value: unknown): CanvasStroke[] {
  if (!Array.isArray(value)) return [];
  const result: CanvasStroke[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Partial<CanvasStroke>;
    if (typeof s.id !== "string" || !Array.isArray(s.points)) continue;
    const points = s.points
      .filter(
        (p): p is CanvasStrokePoint =>
          !!p && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)
      )
      .map((p) => (typeof p.p === "number" ? { x: p.x, y: p.y, p: p.p } : { x: p.x, y: p.y }));
    if (points.length === 0) continue;
    result.push({
      id: s.id,
      color: VALID_COLORS.includes(s.color as CanvasInkColor) ? (s.color as CanvasInkColor) : "adaptive",
      tip: s.tip === "fine" || s.tip === "highlighter" ? s.tip : "medium",
      width: typeof s.width === "number" && s.width > 0 ? s.width : 4,
      pressure: s.pressure === true,
      points,
    });
  }
  return result;
}
