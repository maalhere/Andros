// ============================================================================
// ANDROS — LAMINADOR LIGERO + GENERADOR .GX PARA FLASHFORGE ADVENTURER 3
//
// Convierte los triángulos de una pieza (.stl / .obj / .3mf) en un archivo
// .gx listo para imprimir, sin programas externos:
//   1. Centra la pieza en el origen (0, 0) de la cama (150 × 150 × 150 mm) y la
//      apoya sobre Z = 0 (escala uniforme opcional para que quepa).
//   2. Corta capa por capa (primera capa 0.20 mm) y une los segmentos en
//      contornos cerrados (contornos exteriores CCW, agujeros CW).
//   3. Perímetros por desplazamiento de contornos + relleno reticular a ±45°
//      con capas sólidas automáticas arriba y abajo.
//   4. Flujo calculado para PLA 1.75 mm y boquilla 0.4 mm, retracción
//      5 mm a 40 mm/s.
//   5. Empaqueta el G-code en formato "xgcode 1.0" (.gx) con miniatura BMP
//      80 × 60, que la Adventurer 3 muestra en su pantalla.
//
// Es un laminador deliberadamente sencillo (sin soportes ni puentes): pensado
// para piezas "normales" que se apoyan bien sobre la cama.
// ============================================================================

import { triangleBounds } from "@/lib/slicer/meshLoader";

export const ADV3_BED_MM = 150;
const BED_LIMIT_MM = ADV3_BED_MM + 0.05;

export type QualityId = "draft" | "standard" | "high";

export interface SliceSettings {
  layerHeight: number;
  firstLayerHeight: number;
  lineWidth: number;
  nozzleDiameter: number;
  filamentDiameter: number;
  wallCount: number;
  /** Capas sólidas arriba y abajo. */
  solidLayers: number;
  /** 0..1 */
  infillDensity: number;
  printSpeed: number;
  outerWallSpeed: number;
  firstLayerSpeed: number;
  travelSpeed: number;
  nozzleTemp: number;
  bedTemp: number;
  retractLength: number;
  retractSpeed: number;
  minTravelForRetract: number;
  fanSpeed: number;
}

const COMMON: Omit<
  SliceSettings,
  "layerHeight" | "wallCount" | "solidLayers" | "infillDensity" | "printSpeed" | "outerWallSpeed"
> = {
  firstLayerHeight: 0.2,
  lineWidth: 0.4,
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
  firstLayerSpeed: 20,
  travelSpeed: 100,
  nozzleTemp: 210,
  bedTemp: 50,
  retractLength: 5,
  retractSpeed: 40,
  minTravelForRetract: 1.5,
  fanSpeed: 255,
};

export interface QualityPreset {
  id: QualityId;
  title: string;
  everyday: string;
  settings: SliceSettings;
}

export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
  draft: {
    id: "draft",
    title: "Borrador Rápido",
    everyday: "Pruebas y prototipos. Lo más veloz.",
    settings: {
      ...COMMON,
      layerHeight: 0.28,
      wallCount: 2,
      solidLayers: 3,
      infillDensity: 0.1,
      printSpeed: 60,
      outerWallSpeed: 45,
    },
  },
  standard: {
    id: "standard",
    title: "Estándar",
    everyday: "El mejor equilibrio entre calidad y tiempo.",
    settings: {
      ...COMMON,
      layerHeight: 0.2,
      wallCount: 2,
      solidLayers: 4,
      infillDensity: 0.15,
      printSpeed: 50,
      outerWallSpeed: 35,
    },
  },
  high: {
    id: "high",
    title: "Alta Calidad",
    everyday: "Detalle fino y superficies lisas. Tarda más.",
    settings: {
      ...COMMON,
      layerHeight: 0.12,
      wallCount: 3,
      solidLayers: 7,
      infillDensity: 0.2,
      printSpeed: 40,
      outerWallSpeed: 25,
    },
  },
};

/** Valores técnicos legibles (para el desplegable "Ver detalles técnicos"). */
export function describeSettings(s: SliceSettings): { label: string; value: string }[] {
  return [
    { label: "Altura de capa", value: `${s.layerHeight.toFixed(2)} mm (1.ª capa ${s.firstLayerHeight.toFixed(2)} mm)` },
    { label: "Paredes", value: `${s.wallCount} × ${s.lineWidth.toFixed(2)} mm` },
    { label: "Capas sólidas arriba / abajo", value: `${s.solidLayers}` },
    { label: "Relleno", value: `${Math.round(s.infillDensity * 100)} % reticular (±45°)` },
    { label: "Velocidad", value: `${s.printSpeed} mm/s (pared exterior ${s.outerWallSpeed} mm/s)` },
    { label: "Temperatura PLA / cama", value: `${s.nozzleTemp} °C / ${s.bedTemp} °C` },
    { label: "Retracción", value: `${s.retractLength} mm a ${s.retractSpeed} mm/s` },
    { label: "Filamento / boquilla", value: `${s.filamentDiameter} mm / ${s.nozzleDiameter} mm` },
  ];
}

// ---------------------------------------------------------------------------
// 1. PREPARAR LA MALLA (centrar, apoyar en Z = 0, soldar vértices)
// ---------------------------------------------------------------------------

export interface PreparedMesh {
  vertices: Float64Array;
  triangles: Uint32Array;
  size: { x: number; y: number; z: number };
}

export function prepareMesh(soup: Float32Array, scale = 1): PreparedMesh {
  const b = triangleBounds(soup);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const z0 = b.min[2];
  const size = {
    x: (b.max[0] - b.min[0]) * scale,
    y: (b.max[1] - b.min[1]) * scale,
    z: (b.max[2] - b.min[2]) * scale,
  };

  // Rejilla de soldadura: 2^17 celdas por eje sobre la pieza → claves < 2^51.
  const span = Math.max(size.x, size.y, size.z) + 2;
  const cells = 131072 / span;
  const ox = size.x / 2 + 1;
  const oy = size.y / 2 + 1;

  const triCount = soup.length / 9;
  const lookup = new Map<number, number>();
  const verts: number[] = [];
  const tris = new Uint32Array(triCount * 3);
  let t = 0;
  const idx = [0, 0, 0];

  for (let i = 0; i < triCount; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      const o = i * 9 + k * 3;
      const x = (soup[o] - cx) * scale;
      const y = (soup[o + 1] - cy) * scale;
      const z = (soup[o + 2] - z0) * scale;
      const key =
        Math.round((x + ox) * cells) +
        Math.round((y + oy) * cells) * 131072 +
        Math.round((z + 1) * cells) * 17179869184;
      let id = lookup.get(key);
      if (id === undefined) {
        id = verts.length / 3;
        verts.push(x, y, z);
        lookup.set(key, id);
      }
      idx[k] = id;
    }
    if (idx[0] === idx[1] || idx[1] === idx[2] || idx[0] === idx[2]) continue;
    tris[t++] = idx[0];
    tris[t++] = idx[1];
    tris[t++] = idx[2];
  }

  return { vertices: Float64Array.from(verts), triangles: tris.slice(0, t), size };
}

// ---------------------------------------------------------------------------
// 2. GEOMETRÍA 2D (contornos como arreglos planos x0,y0,x1,y1,…)
// ---------------------------------------------------------------------------

type Loop = Float64Array;

function signedArea(loop: Loop): number {
  let a = 0;
  const n = loop.length / 2;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    a += loop[i * 2] * loop[j * 2 + 1] - loop[j * 2] * loop[i * 2 + 1];
  }
  return a / 2;
}

function reverseLoop(loop: Loop): Loop {
  const n = loop.length / 2;
  const out = new Float64Array(loop.length);
  for (let i = 0; i < n; i += 1) {
    out[i * 2] = loop[(n - 1 - i) * 2];
    out[i * 2 + 1] = loop[(n - 1 - i) * 2 + 1];
  }
  return out;
}

function pointInLoop(x: number, y: number, loop: Loop): boolean {
  let inside = false;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[i * 2];
    const yi = loop[i * 2 + 1];
    const xj = loop[j * 2];
    const yj = loop[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Quita puntos duplicados y casi colineales (reduce mucho el tamaño del G-code). */
function simplifyLoop(points: number[]): Loop | null {
  const dedup: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const n = dedup.length;
    if (n >= 2 && Math.hypot(points[i] - dedup[n - 2], points[i + 1] - dedup[n - 1]) < 0.02) continue;
    dedup.push(points[i], points[i + 1]);
  }
  if (dedup.length >= 4) {
    const n = dedup.length;
    if (Math.hypot(dedup[0] - dedup[n - 2], dedup[1] - dedup[n - 1]) < 0.02) dedup.length = n - 2;
  }
  if (dedup.length < 6) return null;

  const out: number[] = [];
  const count = dedup.length / 2;
  for (let i = 0; i < count; i += 1) {
    const px = out.length ? out[out.length - 2] : dedup[(count - 1) * 2];
    const py = out.length ? out[out.length - 1] : dedup[(count - 1) * 2 + 1];
    const bx = dedup[i * 2];
    const by = dedup[i * 2 + 1];
    const nx = dedup[((i + 1) % count) * 2];
    const ny = dedup[((i + 1) % count) * 2 + 1];
    const len = Math.hypot(nx - px, ny - py);
    if (len > 1e-9) {
      const dist = Math.abs((nx - px) * (py - by) - (px - bx) * (ny - py)) / len;
      const within = (bx - px) * (nx - px) + (by - py) * (ny - py) >= 0 && (bx - nx) * (px - nx) + (by - ny) * (py - ny) >= 0;
      if (dist < 0.01 && within) continue;
    }
    out.push(bx, by);
  }
  if (out.length < 6) return null;
  const loop = Float64Array.from(out);
  return Math.abs(signedArea(loop)) < 0.02 ? null : loop;
}

/** Exteriores en sentido antihorario y agujeros en sentido horario (regla par/impar). */
function normalizeOrientation(loops: Loop[]): Loop[] {
  const boxes = loops.map((l) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < l.length; i += 2) {
      if (l[i] < x0) x0 = l[i];
      if (l[i] > x1) x1 = l[i];
      if (l[i + 1] < y0) y0 = l[i + 1];
      if (l[i + 1] > y1) y1 = l[i + 1];
    }
    return [x0, y0, x1, y1];
  });
  return loops.map((loop, i) => {
    const x = loop[0];
    const y = loop[1];
    let depth = 0;
    for (let j = 0; j < loops.length; j += 1) {
      if (j === i) continue;
      const bb = boxes[j];
      if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
      if (pointInLoop(x, y, loops[j])) depth += 1;
    }
    const wantCCW = depth % 2 === 0;
    return signedArea(loop) > 0 === wantCCW ? loop : reverseLoop(loop);
  });
}

/**
 * Desplaza el contorno `d` mm hacia el material (lado izquierdo del recorrido,
 * válido tanto para exteriores CCW como para agujeros CW).
 */
function offsetLoop(loop: Loop, d: number): Loop | null {
  const n = loop.length / 2;
  if (n < 3) return null;
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const dx = loop[j * 2] - loop[i * 2];
    const dy = loop[j * 2 + 1] - loop[i * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    nx[i] = -dy / len;
    ny[i] = dx / len;
  }
  const moved = new Float64Array(n * 2);
  const limit = 2 * Math.abs(d);
  for (let i = 0; i < n; i += 1) {
    const p = (i - 1 + n) % n;
    let mx = nx[p] + nx[i];
    let my = ny[p] + ny[i];
    const mlen = Math.hypot(mx, my);
    if (mlen < 1e-6) {
      mx = nx[i] * d;
      my = ny[i] * d;
    } else {
      const dot = nx[p] * nx[i] + ny[p] * ny[i];
      let f = d / (1 + dot);
      if (Math.abs(f * mlen) > limit) f = (Math.sign(d) * limit) / mlen;
      mx *= f;
      my *= f;
    }
    moved[i * 2] = loop[i * 2] + mx;
    moved[i * 2 + 1] = loop[i * 2 + 1] + my;
  }

  // Aristas que se dieron la vuelta = zona colapsada: se eliminan sus vértices.
  const reversed = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const ox = loop[j * 2] - loop[i * 2];
    const oy = loop[j * 2 + 1] - loop[i * 2 + 1];
    const qx = moved[j * 2] - moved[i * 2];
    const qy = moved[j * 2 + 1] - moved[i * 2 + 1];
    if (ox * qx + oy * qy < 0) reversed[i] = 1;
  }
  const kept: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (reversed[i] || reversed[(i - 1 + n) % n]) continue;
    kept.push(moved[i * 2], moved[i * 2 + 1]);
  }
  if (kept.length < 6) return null;
  const out = Float64Array.from(kept);
  const before = signedArea(loop);
  const after = signedArea(out);
  if (Math.sign(before) !== Math.sign(after) || Math.abs(after) < 0.05) return null;
  // Un exterior que "crece" al encogerlo es un contorno degenerado.
  if (d > 0 && before > 0 && after > before) return null;
  return out;
}

function offsetAll(loops: Loop[], d: number): Loop[] {
  const out: Loop[] = [];
  for (const loop of loops) {
    const o = offsetLoop(loop, d);
    if (o) out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. CORTE POR CAPAS
// ---------------------------------------------------------------------------

function sliceAt(z: number, mesh: PreparedMesh, active: number[]): Loop[] {
  const v = mesh.vertices;
  const tris = mesh.triangles;
  const nv = v.length / 3;
  const pointIndex = new Map<number, number>();
  const px: number[] = [];
  const py: number[] = [];
  const adj: number[][] = [];
  const segA: number[] = [];
  const segB: number[] = [];

  const point = (u: number, w: number): number => {
    const a = u < w ? u : w;
    const b = u < w ? w : u;
    const key = a * nv + b;
    let id = pointIndex.get(key);
    if (id === undefined) {
      const za = v[a * 3 + 2];
      const zb = v[b * 3 + 2];
      const t = (z - za) / (zb - za);
      px.push(v[a * 3] + (v[b * 3] - v[a * 3]) * t);
      py.push(v[a * 3 + 1] + (v[b * 3 + 1] - v[a * 3 + 1]) * t);
      id = px.length - 1;
      adj.push([]);
      pointIndex.set(key, id);
    }
    return id;
  };

  const ends: number[] = [];
  for (const tri of active) {
    const i0 = tris[tri * 3];
    const i1 = tris[tri * 3 + 1];
    const i2 = tris[tri * 3 + 2];
    const s0 = v[i0 * 3 + 2] >= z;
    const s1 = v[i1 * 3 + 2] >= z;
    const s2 = v[i2 * 3 + 2] >= z;
    if (s0 === s1 && s1 === s2) continue;
    ends.length = 0;
    if (s0 !== s1) ends.push(point(i0, i1));
    if (s1 !== s2) ends.push(point(i1, i2));
    if (s2 !== s0) ends.push(point(i2, i0));
    if (ends.length !== 2 || ends[0] === ends[1]) continue;
    const id = segA.length;
    segA.push(ends[0]);
    segB.push(ends[1]);
    adj[ends[0]].push(id);
    adj[ends[1]].push(id);
  }

  const used = new Uint8Array(segA.length);
  const loops: Loop[] = [];
  for (let s = 0; s < segA.length; s += 1) {
    if (used[s]) continue;
    used[s] = 1;
    const start = segA[s];
    let cur = segB[s];
    const chain = [start];
    let guard = 0;
    while (cur !== start && guard++ < segA.length) {
      chain.push(cur);
      let next = -1;
      for (const c of adj[cur]) {
        if (!used[c]) {
          next = c;
          break;
        }
      }
      if (next < 0) break;
      used[next] = 1;
      cur = segA[next] === cur ? segB[next] : segA[next];
    }
    if (cur !== start) {
      // Malla no cerrada: solo se acepta si el hueco es pequeño.
      const a = chain[0];
      const b = chain[chain.length - 1];
      if (Math.hypot(px[a] - px[b], py[a] - py[b]) > 2) continue;
    }
    if (chain.length < 3) continue;
    const pts: number[] = [];
    for (const p of chain) pts.push(px[p], py[p]);
    const loop = simplifyLoop(pts);
    if (loop) loops.push(loop);
  }
  return normalizeOrientation(loops);
}

// ---------------------------------------------------------------------------
// 4. RELLENO POR LÍNEAS DE BARRIDO (intervalos 1D)
// ---------------------------------------------------------------------------

type Lines = Map<number, number[]>;

/** Intervalos [u0,u1,…] dentro de la región para cada línea j (v = (j + ½)·s). */
function scanRegion(loops: Loop[], cos: number, sin: number, s: number): Lines {
  const buckets = new Map<number, number[]>();
  for (const loop of loops) {
    const n = loop.length / 2;
    for (let i = 0; i < n; i += 1) {
      const k = (i + 1) % n;
      const x1 = loop[i * 2], y1 = loop[i * 2 + 1];
      const x2 = loop[k * 2], y2 = loop[k * 2 + 1];
      const u1 = x1 * cos + y1 * sin;
      const v1 = -x1 * sin + y1 * cos;
      const u2 = x2 * cos + y2 * sin;
      const v2 = -x2 * sin + y2 * cos;
      if (v1 === v2) continue;
      const vmin = Math.min(v1, v2);
      const vmax = Math.max(v1, v2);
      const jStart = Math.ceil(vmin / s - 0.5);
      const jEnd = Math.ceil(vmax / s - 0.5) - 1;
      for (let j = jStart; j <= jEnd; j += 1) {
        const vv = (j + 0.5) * s;
        const u = u1 + ((vv - v1) * (u2 - u1)) / (v2 - v1);
        let list = buckets.get(j);
        if (!list) {
          list = [];
          buckets.set(j, list);
        }
        list.push(u);
      }
    }
  }
  const lines: Lines = new Map();
  for (const [j, list] of buckets) {
    list.sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 0; i + 1 < list.length; i += 2) {
      if (list[i + 1] - list[i] > 1e-6) intervals.push(list[i], list[i + 1]);
    }
    if (intervals.length) lines.set(j, intervals);
  }
  return lines;
}

function intersectIntervals(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i], b[j]);
    const hi = Math.min(a[i + 1], b[j + 1]);
    if (lo < hi) out.push(lo, hi);
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return out;
}

function subtractIntervals(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < a.length; i += 2) {
    const hi = a[i + 1];
    let cur = a[i];
    while (j < b.length && b[j + 1] <= cur) j += 2;
    let k = j;
    while (k < b.length && b[k] < hi) {
      if (b[k] > cur) out.push(cur, b[k]);
      cur = Math.max(cur, b[k + 1]);
      if (cur >= hi) break;
      k += 2;
    }
    if (cur < hi) out.push(cur, hi);
  }
  return out;
}

interface InfillLine {
  j: number;
  u0: number;
  u1: number;
}

/** Agrupa líneas vecinas en cadenas en zigzag (menos viajes y retracciones). */
function chainLines(lines: Lines, step: number, gap: number): InfillLine[][] {
  const js = [...lines.keys()].sort((a, b) => a - b);
  const used = new Map<number, Uint8Array>();
  for (const j of js) used.set(j, new Uint8Array((lines.get(j) as number[]).length / 2));
  const chains: InfillLine[][] = [];

  for (const j0 of js) {
    const arr0 = lines.get(j0) as number[];
    for (let s = 0; s < arr0.length; s += 2) {
      if ((used.get(j0) as Uint8Array)[s / 2]) continue;
      const chain: InfillLine[] = [];
      let j = j0;
      let idx = s;
      let forward = true;
      for (;;) {
        const arr = lines.get(j) as number[];
        (used.get(j) as Uint8Array)[idx / 2] = 1;
        const a = arr[idx];
        const b = arr[idx + 1];
        chain.push(forward ? { j, u0: a, u1: b } : { j, u0: b, u1: a });
        const endU = forward ? b : a;
        const nj = j + step;
        const next = lines.get(nj);
        if (!next) break;
        const flags = used.get(nj) as Uint8Array;
        let best = -1;
        let bestD = Infinity;
        for (let t = 0; t < next.length; t += 2) {
          if (flags[t / 2]) continue;
          if (next[t] > b + gap || next[t + 1] < a - gap) continue;
          const dd = Math.abs((forward ? next[t + 1] : next[t]) - endU);
          if (dd < bestD) {
            bestD = dd;
            best = t;
          }
        }
        if (best < 0) break;
        j = nj;
        idx = best;
        forward = !forward;
      }
      chains.push(chain);
    }
  }
  return chains;
}

// ---------------------------------------------------------------------------
// 5. ESCRITOR DE G-CODE
// ---------------------------------------------------------------------------

const f3 = (n: number) => n.toFixed(3);

class GcodeWriter {
  lines: string[] = [];
  x = 0;
  y = 0;
  z = 0;
  e = 0;
  filamentMm = 0;
  timeSec = 0;
  private retracted = false;
  private lastF = 0;
  private readonly filamentArea: number;
  private readonly s: SliceSettings;

  constructor(settings: SliceSettings) {
    this.s = settings;
    this.filamentArea = Math.PI * (settings.filamentDiameter / 2) ** 2;
  }

  raw(line: string) {
    this.lines.push(line);
  }

  private feed(mmPerSec: number): string {
    const f = Math.round(mmPerSec * 60);
    if (f === this.lastF) return "";
    this.lastF = f;
    return ` F${f}`;
  }

  retract() {
    if (this.retracted) return;
    this.e -= this.s.retractLength;
    this.lines.push(`G1 E${this.e.toFixed(5)}${this.feed(this.s.retractSpeed)}`);
    this.timeSec += this.s.retractLength / this.s.retractSpeed;
    this.retracted = true;
  }

  private unretract() {
    if (!this.retracted) return;
    this.e += this.s.retractLength;
    this.lines.push(`G1 E${this.e.toFixed(5)}${this.feed(this.s.retractSpeed)}`);
    this.timeSec += this.s.retractLength / this.s.retractSpeed;
    this.retracted = false;
  }

  moveZ(z: number, speed = 7) {
    this.lines.push(`G1 Z${f3(z)}${this.feed(speed)}`);
    this.timeSec += Math.abs(z - this.z) / speed;
    this.z = z;
  }

  /** Viaje sin extruir; retrae si es más largo que `retractOver` mm. */
  travel(x: number, y: number, retractOver = this.s.minTravelForRetract) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 1e-3) return;
    if (d > retractOver) this.retract();
    this.lines.push(`G1 X${f3(x)} Y${f3(y)}${this.feed(this.s.travelSpeed)}`);
    this.timeSec += d / this.s.travelSpeed;
    this.x = x;
    this.y = y;
  }

  extrude(x: number, y: number, width: number, height: number, speed: number) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d < 1e-3) return;
    this.unretract();
    // Sección de un cordón: rectángulo con extremos redondeados.
    const section = (width - height) * height + Math.PI * (height / 2) ** 2;
    const de = (d * section) / this.filamentArea;
    this.e += de;
    this.filamentMm += de;
    this.lines.push(`G1 X${f3(x)} Y${f3(y)} E${this.e.toFixed(5)}${this.feed(speed)}`);
    this.timeSec += d / speed;
    this.x = x;
    this.y = y;
  }

  /** Reinicia el contador de E (el estado de retracción se conserva). */
  resetExtruder() {
    this.lines.push("G92 E0");
    this.e = 0;
  }
}

// ---------------------------------------------------------------------------
// 6. LAMINAR → G-CODE
// ---------------------------------------------------------------------------

export interface SliceStats {
  layers: number;
  printTimeSec: number;
  filamentMm: number;
  filamentGrams: number;
  size: { x: number; y: number; z: number };
}

interface LayerData {
  zTop: number;
  height: number;
  walls: Loop[][];
  fill: Loop[];
}

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
}

export async function sliceToGcode(
  mesh: PreparedMesh,
  s: SliceSettings,
  options: { name: string; qualityTitle: string; onProgress?: (f: number) => void; signal?: AbortSignal }
): Promise<{ gcode: string; stats: SliceStats }> {
  const { size } = mesh;
  if (size.x > BED_LIMIT_MM || size.y > BED_LIMIT_MM || size.z > BED_LIMIT_MM) {
    throw new Error("La pieza no cabe en 150 × 150 × 150 mm. Usa el ajuste automático de tamaño.");
  }
  if (mesh.triangles.length === 0 || size.z < s.firstLayerHeight / 2) {
    throw new Error("La pieza no tiene volumen imprimible.");
  }

  const w = s.lineWidth;
  // --- Alturas de capa ------------------------------------------------------
  const zTops: number[] = [s.firstLayerHeight];
  while (zTops[zTops.length - 1] + s.layerHeight / 2 < size.z) {
    zTops.push(zTops[zTops.length - 1] + s.layerHeight);
  }
  const layerCount = zTops.length;
  const sampleZ = (i: number) => {
    const h = i === 0 ? s.firstLayerHeight : s.layerHeight;
    return Math.min(zTops[i] - h / 2, size.z - 1e-4);
  };

  // --- Barrido de triángulos (ordenados por Z mínima) -------------------------
  const v = mesh.vertices;
  const tris = mesh.triangles;
  const triCount = tris.length / 3;
  const zmin = new Float64Array(triCount);
  const zmax = new Float64Array(triCount);
  for (let t = 0; t < triCount; t += 1) {
    const a = v[tris[t * 3] * 3 + 2];
    const b = v[tris[t * 3 + 1] * 3 + 2];
    const c = v[tris[t * 3 + 2] * 3 + 2];
    zmin[t] = Math.min(a, b, c);
    zmax[t] = Math.max(a, b, c);
  }
  const order = Array.from({ length: triCount }, (_, i) => i).sort((a, b) => zmin[a] - zmin[b]);
  let cursor = 0;
  let active: number[] = [];
  let computedUpTo = -1;
  const layerCache = new Map<number, LayerData>();

  const fillInset = (s.wallCount + 0.35) * w;
  const ensureLayers = (upTo: number) => {
    for (let i = computedUpTo + 1; i <= upTo; i += 1) {
      const z = sampleZ(i);
      while (cursor < triCount && zmin[order[cursor]] <= z) active.push(order[cursor++]);
      active = active.filter((t) => zmax[t] >= z);
      const outline = sliceAt(z, mesh, active);
      const walls: Loop[][] = [];
      for (let k = 0; k < s.wallCount; k += 1) walls.push(offsetAll(outline, w / 2 + k * w));
      layerCache.set(i, {
        zTop: zTops[i],
        height: i === 0 ? s.firstLayerHeight : s.layerHeight,
        walls,
        fill: offsetAll(outline, fillInset),
      });
      computedUpTo = i;
    }
  };

  // Líneas de relleno por capa y ángulo (se reutilizan entre capas vecinas).
  const angles = [Math.PI / 4, (3 * Math.PI) / 4];
  const scanCache = new Map<string, Lines>();
  const scanFor = (layer: number, angleIdx: number): Lines => {
    const key = `${layer}|${angleIdx}`;
    let lines = scanCache.get(key);
    if (!lines) {
      const data = layerCache.get(layer) as LayerData;
      lines = scanRegion(data.fill, Math.cos(angles[angleIdx]), Math.sin(angles[angleIdx]), w);
      scanCache.set(key, lines);
    }
    return lines;
  };

  const writer = new GcodeWriter(s);
  const g = writer;
  const sparseStep = Math.max(1, Math.round(1 / Math.max(s.infillDensity, 0.01)));

  // --- Encabezado de la Adventurer 3 -----------------------------------------
  g.raw(";FLAVOR:FlashForge");
  g.raw(";generated by Andros (laminador integrado)");
  g.raw(";machine_type: Adventurer 3");
  g.raw(`;file: ${options.name}`);
  g.raw(`;quality: ${options.qualityTitle}`);
  g.raw(`;layer_height: ${s.layerHeight.toFixed(2)}`);
  g.raw(`;first_layer_height: ${s.firstLayerHeight.toFixed(2)}`);
  g.raw(`;perimeter_shells: ${s.wallCount}`);
  g.raw(`;fill_density: ${Math.round(s.infillDensity * 100)}%`);
  g.raw(`;print_speed: ${s.printSpeed}`);
  g.raw(`;right_extruder_temperature: ${s.nozzleTemp}`);
  g.raw(`;platform_temperature: ${s.bedTemp}`);
  g.raw(`;filament_diameter: ${s.filamentDiameter}`);
  g.raw(`;nozzle_diameter: ${s.nozzleDiameter}`);
  g.raw(`;layer_count: ${layerCount}`);
  g.raw(`;model_size: ${f3(size.x)} x ${f3(size.y)} x ${f3(size.z)} mm`);
  g.raw(";start gcode");
  g.raw("M118 X15.00 Y15.00 Z0.15 T0");
  g.raw(`M140 S${s.bedTemp} T0`);
  g.raw(`M104 S${s.nozzleTemp} T0`);
  g.raw("M104 S0 T1");
  g.raw("M107");
  g.raw("G90");
  g.raw("G28");
  g.raw("M132 X Y Z A B");
  g.raw("G1 Z50.000 F420");
  g.raw("G161 X Y F3300");
  g.raw("M7 T0 ; esperar cama");
  g.raw("M6 T0 ; esperar boquilla");
  g.raw("M651");
  g.raw("M108 T0");
  g.raw("M82 ; extrusión absoluta");
  g.raw("G92 E0");

  // Línea de purga frontal (si la pieza deja espacio delante).
  const purgeY = -ADV3_BED_MM / 2 + 3;
  const hasPurge = size.y / 2 < -purgeY - 3;
  if (hasPurge) g.travel(-60, purgeY, Infinity);
  g.moveZ(s.firstLayerHeight, 400 / 60); // → G1 Z0.200 F400
  if (hasPurge) {
    g.extrude(60, purgeY, 0.8, s.firstLayerHeight, 25);
    g.travel(60, purgeY + 0.8, Infinity);
    g.extrude(0, purgeY + 0.8, 0.8, s.firstLayerHeight, 25);
  }
  g.retract();
  g.resetExtruder();

  // --- Capas -----------------------------------------------------------------
  for (let i = 0; i < layerCount; i += 1) {
    checkAbort(options.signal);
    ensureLayers(Math.min(i + s.solidLayers, layerCount - 1));
    const layer = layerCache.get(i) as LayerData;
    const first = i === 0;
    const h = layer.height;

    g.raw(`;LAYER:${i}`);
    g.raw(`;Z:${f3(layer.zTop)}`);
    if (i > 0) {
      g.retract();
      g.moveZ(layer.zTop);
    }
    if (i === 1) g.raw(`M106 S${s.fanSpeed}`);

    // Paredes: de dentro hacia fuera, cada contorno empezando en el punto más cercano.
    for (let k = s.wallCount - 1; k >= 0; k -= 1) {
      const pending = [...layer.walls[k]];
      const speed = first ? s.firstLayerSpeed : k === 0 ? s.outerWallSpeed : s.printSpeed;
      while (pending.length) {
        let bestLoop = 0;
        let bestPt = 0;
        let bestD = Infinity;
        for (let li = 0; li < pending.length; li += 1) {
          const loop = pending[li];
          for (let p = 0; p < loop.length; p += 2) {
            const d = (loop[p] - g.x) ** 2 + (loop[p + 1] - g.y) ** 2;
            if (d < bestD) {
              bestD = d;
              bestLoop = li;
              bestPt = p / 2;
            }
          }
        }
        const loop = pending.splice(bestLoop, 1)[0];
        const n = loop.length / 2;
        g.travel(loop[bestPt * 2], loop[bestPt * 2 + 1]);
        for (let step = 1; step <= n; step += 1) {
          const p = (bestPt + step) % n;
          g.extrude(loop[p * 2], loop[p * 2 + 1], w, h, speed);
        }
      }
    }

    // Relleno: sólido donde falta pieza arriba/abajo, reticular en el interior.
    const angleIdx = i % 2;
    const cos = Math.cos(angles[angleIdx]);
    const sin = Math.sin(angles[angleIdx]);
    const own = scanFor(i, angleIdx);
    const neighbours: Lines[] = [];
    let coreless = false;
    for (let n = i - s.solidLayers; n <= i + s.solidLayers; n += 1) {
      if (n === i) continue;
      if (n < 0 || n >= layerCount) {
        coreless = true;
        break;
      }
      neighbours.push(scanFor(n, angleIdx));
    }

    const solid: Lines = new Map();
    const sparse: Lines = new Map();
    for (const [j, intervals] of own) {
      let core: number[] = [];
      if (!coreless) {
        core = intervals;
        for (const nb of neighbours) {
          const other = nb.get(j);
          if (!other) {
            core = [];
            break;
          }
          core = intersectIntervals(core, other);
          if (!core.length) break;
        }
      }
      const solidPart = subtractIntervals(intervals, core);
      const solidClean: number[] = [];
      for (let t = 0; t < solidPart.length; t += 2) {
        if (solidPart[t + 1] - solidPart[t] >= 0.3) solidClean.push(solidPart[t], solidPart[t + 1]);
      }
      if (solidClean.length) solid.set(j, solidClean);
      if (core.length && (((j % sparseStep) + sparseStep) % sparseStep) === 0) {
        const sparseClean: number[] = [];
        for (let t = 0; t < core.length; t += 2) {
          if (core[t + 1] - core[t] >= 1) sparseClean.push(core[t], core[t + 1]);
        }
        if (sparseClean.length) sparse.set(j, sparseClean);
      }
    }

    const emitInfill = (lines: Lines, step: number) => {
      const chains = chainLines(lines, step, w);
      const toXY = (j: number, u: number): [number, number] => {
        const vv = (j + 0.5) * w;
        return [u * cos - vv * sin, u * sin + vv * cos];
      };
      const speed = first ? s.firstLayerSpeed : s.printSpeed;
      const linkMax = step * w * 1.5 + 1;
      while (chains.length) {
        // Siguiente cadena: la que empieza o termina más cerca.
        let best = 0;
        let flip = false;
        let bestD = Infinity;
        for (let c = 0; c < chains.length; c += 1) {
          const ch = chains[c];
          const [sx, sy] = toXY(ch[0].j, ch[0].u0);
          const last = ch[ch.length - 1];
          const [ex, ey] = toXY(last.j, last.u1);
          const ds = (sx - g.x) ** 2 + (sy - g.y) ** 2;
          const de = (ex - g.x) ** 2 + (ey - g.y) ** 2;
          if (ds < bestD) {
            bestD = ds;
            best = c;
            flip = false;
          }
          if (de < bestD) {
            bestD = de;
            best = c;
            flip = true;
          }
        }
        let chain = chains.splice(best, 1)[0];
        if (flip) chain = chain.reverse().map((l) => ({ j: l.j, u0: l.u1, u1: l.u0 }));
        chain.forEach((line, idx) => {
          const [ax, ay] = toXY(line.j, line.u0);
          const [bx, by] = toXY(line.j, line.u1);
          g.travel(ax, ay, idx === 0 ? s.minTravelForRetract : linkMax);
          g.extrude(bx, by, w, h, speed);
        });
      }
    };
    emitInfill(solid, 1);
    emitInfill(sparse, sparseStep);

    // Liberar memoria de capas que ya no se usan como vecinas.
    const old = i - s.solidLayers;
    if (old >= 0) {
      layerCache.delete(old);
      scanCache.delete(`${old}|0`);
      scanCache.delete(`${old}|1`);
    }
    if (i % 2 === 1) g.resetExtruder();

    if (i % 4 === 3) {
      options.onProgress?.((i + 1) / layerCount);
      await yieldToBrowser();
    }
  }

  // --- Cierre seguro ---------------------------------------------------------
  g.retract();
  g.raw(";end gcode");
  g.raw("M107");
  g.raw("M104 S0 T0");
  g.raw("M140 S0 T0");
  g.raw("G91");
  g.raw("G1 Z10 F600");
  g.raw("G90");
  g.raw("G28 X Y");
  g.raw("M132 X Y A B");
  g.raw("M652");
  g.raw("M18");
  options.onProgress?.(1);

  const filamentGrams = ((writer.filamentMm * Math.PI * (s.filamentDiameter / 2) ** 2) / 1000) * 1.24;
  return {
    gcode: writer.lines.join("\n") + "\n",
    stats: {
      layers: layerCount,
      // +10 % por aceleraciones y ~3 min de calentamiento.
      printTimeSec: Math.round(writer.timeSec * 1.1 + 180),
      filamentMm: writer.filamentMm,
      filamentGrams,
      size,
    },
  };
}

// ---------------------------------------------------------------------------
// 7. MINIATURA (rasterizador con z-buffer, vista isométrica)
// ---------------------------------------------------------------------------

/** Dibuja la pieza en RGBA (fondo transparente). */
export function renderMeshImage(
  mesh: PreparedMesh,
  width: number,
  height: number,
  color: [number, number, number]
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const v = mesh.vertices;
  const nv = v.length / 3;
  if (nv === 0) return rgba;

  // Cámara: delante-derecha-arriba, como el visor 3D.
  const dl = Math.hypot(1, -1.25, 0.85);
  const d = [1 / dl, -1.25 / dl, 0.85 / dl];
  const f = [-d[0], -d[1], -d[2]];
  const rl = Math.hypot(f[1], -f[0]);
  const right = [f[1] / rl, -f[0] / rl, 0];
  const up = [
    right[1] * f[2] - right[2] * f[1],
    right[2] * f[0] - right[0] * f[2],
    right[0] * f[1] - right[1] * f[0],
  ];

  const sx = new Float64Array(nv);
  const sy = new Float64Array(nv);
  const depth = new Float64Array(nv);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const cz = mesh.size.z / 2;
  for (let i = 0; i < nv; i += 1) {
    const x = v[i * 3];
    const y = v[i * 3 + 1];
    const z = v[i * 3 + 2] - cz;
    sx[i] = x * right[0] + y * right[1] + z * right[2];
    sy[i] = x * up[0] + y * up[1] + z * up[2];
    depth[i] = x * d[0] + y * d[1] + z * d[2];
    if (sx[i] < minX) minX = sx[i];
    if (sx[i] > maxX) maxX = sx[i];
    if (sy[i] < minY) minY = sy[i];
    if (sy[i] > maxY) maxY = sy[i];
  }
  const scale = Math.min((width * 0.86) / (maxX - minX || 1), (height * 0.86) / (maxY - minY || 1));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  for (let i = 0; i < nv; i += 1) {
    sx[i] = width / 2 + (sx[i] - midX) * scale;
    sy[i] = height / 2 - (sy[i] - midY) * scale;
  }

  const ll = Math.hypot(0.5, -0.6, 1);
  const light = [0.5 / ll, -0.6 / ll, 1 / ll];
  const zbuf = new Float64Array(width * height).fill(-Infinity);
  const tris = mesh.triangles;

  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
    if (Math.abs(area) < 1e-12) continue;

    const ux = v[b * 3] - v[a * 3], uy = v[b * 3 + 1] - v[a * 3 + 1], uz = v[b * 3 + 2] - v[a * 3 + 2];
    const wx = v[c * 3] - v[a * 3], wy = v[c * 3 + 1] - v[a * 3 + 1], wz = v[c * 3 + 2] - v[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const shade = 0.35 + 0.65 * Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / nl);

    const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) {
        const qx = px + 0.5, qy = py + 0.5;
        const w0 = ((sx[b] - qx) * (sy[c] - qy) - (sx[c] - qx) * (sy[b] - qy)) / area;
        const w1 = ((sx[c] - qx) * (sy[a] - qy) - (sx[a] - qx) * (sy[c] - qy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const dz = w0 * depth[a] + w1 * depth[b] + w2 * depth[c];
        const o = py * width + px;
        if (dz <= zbuf[o]) continue;
        zbuf[o] = dz;
        rgba[o * 4] = color[0] * shade;
        rgba[o * 4 + 1] = color[1] * shade;
        rgba[o * 4 + 2] = color[2] * shade;
        rgba[o * 4 + 3] = 255;
      }
    }
  }
  return rgba;
}

/** BMP de 24 bits (filas de abajo arriba, BGR), fondo negro donde no hay pieza. */
function encodeBmp24(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const out = new Uint8Array(54 + pixelBytes);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; // B
  out[1] = 0x4d; // M
  dv.setUint32(2, out.length, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true);
  dv.setUint32(34, pixelBytes, true);
  dv.setInt32(38, 4724, true);
  dv.setInt32(42, 4724, true);
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * width * 4;
    const dst = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const a = rgba[src + x * 4 + 3] / 255;
      out[dst + x * 3] = rgba[src + x * 4 + 2] * a;
      out[dst + x * 3 + 1] = rgba[src + x * 4 + 1] * a;
      out[dst + x * 3 + 2] = rgba[src + x * 4] * a;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8. EMPAQUETADO .GX ("xgcode 1.0")
// ---------------------------------------------------------------------------

const GX_HEADER_BYTES = 58;

export function buildGx(
  gcode: string,
  thumbnailBmp: Uint8Array,
  s: SliceSettings,
  stats: SliceStats
): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(gcode);
  const gcodeOffset = GX_HEADER_BYTES + thumbnailBmp.length;
  const out = new Uint8Array(gcodeOffset + body.length);
  const dv = new DataView(out.buffer);
  const magic = "xgcode 1.0\n";
  for (let i = 0; i < magic.length; i += 1) out[i] = magic.charCodeAt(i);
  dv.setUint32(0x10, GX_HEADER_BYTES, true); // inicio de la miniatura
  dv.setUint32(0x14, gcodeOffset, true); // inicio del G-code
  dv.setUint32(0x18, gcodeOffset, true); // (copia)
  dv.setUint32(0x1c, Math.min(stats.printTimeSec, 0xffffffff), true);
  dv.setUint32(0x20, Math.round(stats.filamentMm), true); // extrusor derecho
  dv.setUint32(0x24, 0, true); // extrusor izquierdo
  dv.setUint16(0x28, 0x0b, true); // tipo multi-extrusor (FlashPrint)
  dv.setUint16(0x2a, Math.round(s.layerHeight * 1000), true); // micras
  dv.setUint16(0x2c, 0, true);
  dv.setUint16(0x2e, s.wallCount, true);
  dv.setUint16(0x30, s.printSpeed, true);
  dv.setUint16(0x32, s.bedTemp, true);
  dv.setUint16(0x34, s.nozzleTemp, true);
  dv.setUint16(0x36, 0, true);
  dv.setUint16(0x38, 0, true);
  out.set(thumbnailBmp, GX_HEADER_BYTES);
  out.set(body, gcodeOffset);
  return out;
}

// ---------------------------------------------------------------------------
// 9. API PRINCIPAL
// ---------------------------------------------------------------------------

export interface FlashForgeJob {
  bytes: Uint8Array<ArrayBuffer>;
  fileName: string;
  stats: SliceStats;
}

/** De triángulos a un .gx listo para la Adventurer 3. */
export async function generateFlashForgeGx(
  soup: Float32Array,
  options: {
    quality: QualityId;
    scale?: number;
    /** Nombre base sin extensión (solo letras, números, - y _). */
    baseName: string;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  }
): Promise<FlashForgeJob> {
  const preset = QUALITY_PRESETS[options.quality];
  options.onProgress?.(0.02);
  await yieldToBrowser();
  const mesh = prepareMesh(soup, options.scale ?? 1);
  checkAbort(options.signal);

  const fileName = `${options.baseName}.gx`;
  const { gcode, stats } = await sliceToGcode(mesh, preset.settings, {
    name: fileName,
    qualityTitle: preset.title,
    signal: options.signal,
    onProgress: (f) => options.onProgress?.(0.05 + f * 0.9),
  });

  const thumb = encodeBmp24(renderMeshImage(mesh, 80, 60, [235, 235, 235]), 80, 60);
  const bytes = buildGx(gcode, thumb, preset.settings, stats);
  options.onProgress?.(1);
  return { bytes, fileName, stats };
}
