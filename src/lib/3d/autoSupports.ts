// ============================================================================
// ANDROS — SOPORTES AUTOMÁTICOS (45°)
//
// Módulo geométrico puro: trabaja con "sopas de triángulos" (Float32Array con
// 9 números por triángulo, en mm, eje Z hacia arriba como en la impresora) y
// devuelve pilares desprendibles listos para el visor (Three.js), el laminador
// .gx y la exportación .stl.
//
//   1. La pieza ya escalada se apoya en Z = 0 (`scaleAndGroundSoup`).
//   2. Voladizos: caras cuya normal apunta hacia abajo con la superficie a más
//      de 45° de la vertical (nz < −sin 45°). Se ignoran los contactos que ya
//      tocan la cama (Z < 0.8 mm).
//   3. Puntos de apoyo en una cuadrícula adaptativa (6–8 mm). Si salen más de
//      ~120 pilares, la cuadrícula se abre hasta respetar el tope (60 FPS).
//   4. Desde cada punto se lanza un rayo hacia −Z: termina en la cama o en la
//      superficie de la propia pieza que haya debajo.
//   5. Cada pilar: cilindro con punta cónica fina arriba (fácil de desprender)
//      y base plana ensanchada sobre la cama (o punta cónica si apoya en la pieza).
//
// Todo el cálculo cede el hilo al navegador cada pocos milisegundos para no
// congelar la interfaz, y puede cancelarse con un AbortSignal.
// ============================================================================

import type { ModelScale } from "@/lib/3d/modelScale";

export const SUPPORT_OVERHANG_DEG = 45;
/** Contactos por debajo de esta altura ya se apoyan en la cama. */
export const BED_CONTACT_MM = 0.8;
export const MAX_SUPPORT_PILLARS = 120;

const PILLAR_RADIUS = 1.0;
const TIP_RADIUS = 0.35;
const TIP_LENGTH = 2.4;
const FOOT_RADIUS = 1.7;
const FOOT_HEIGHT = 0.6;
const SEGMENTS = 10;
/** Hueco mínimo entre el voladizo y lo que hay debajo para que quepa un pilar. */
const MIN_GAP_MM = 1.2;
/** Contactos a menos de esta distancia en Z se consideran la misma superficie. */
const SAME_SURFACE_MM = 1.0;

export interface SupportPillar {
  x: number;
  y: number;
  /** Altura del contacto con el voladizo (mm). */
  top: number;
  /** Altura de la base: 0 en la cama o la superficie de la pieza. */
  bottom: number;
  onBed: boolean;
}

export interface AutoSupportResult {
  pillars: SupportPillar[];
  /** Geometría de todos los pilares (sopa de triángulos, mismo sistema que la pieza). */
  soup: Float32Array;
  spacingMm: number;
  overhangFaces: number;
  /** Se alcanzó el tope de pilares y se descartaron algunos puntos. */
  capped: boolean;
}

export interface AutoSupportOptions {
  maxPillars?: number;
  overhangDeg?: number;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function soupBounds(soup: Float32Array) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, y0, z0, x1, y1, z1 };
}

/**
 * Aplica la escala por eje, centra la pieza en X/Y y la apoya en Z = 0.
 * Es el mismo sistema de coordenadas que usan el visor, el .gx y el .stl.
 */
export function scaleAndGroundSoup(soup: Float32Array, scale: ModelScale): Float32Array {
  const b = soupBounds(soup);
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const [sx, sy, sz] = scale;
  const out = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    out[i] = (soup[i] - cx) * sx;
    out[i + 1] = (soup[i + 1] - cy) * sy;
    out[i + 2] = (soup[i + 2] - b.z0) * sz;
  }
  return out;
}

function abortError(): DOMException {
  return new DOMException("Cálculo de soportes cancelado", "AbortError");
}

/** Cede el hilo al navegador si llevamos más de ~8 ms seguidos calculando. */
function createYielder(signal?: AbortSignal) {
  let last = performance.now();
  return async () => {
    if (signal?.aborted) throw abortError();
    if (performance.now() - last < 8) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) throw abortError();
    last = performance.now();
  };
}

/**
 * Altura del triángulo `t` en el punto (x, y) de su proyección sobre el plano
 * XY, o NaN si el punto cae fuera.
 */
function heightAt(soup: Float32Array, t: number, x: number, y: number): number {
  const o = t * 9;
  const ax = soup[o], ay = soup[o + 1], az = soup[o + 2];
  const bx = soup[o + 3], by = soup[o + 4], bz = soup[o + 5];
  const cx = soup[o + 6], cy = soup[o + 7], cz = soup[o + 8];
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-12) return NaN;
  const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
  const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
  const l3 = 1 - l1 - l2;
  const eps = -1e-6;
  if (l1 < eps || l2 < eps || l3 < eps) return NaN;
  return l1 * az + l2 * bz + l3 * cz;
}

// ---------------------------------------------------------------------------
// Índice espacial en XY (para lanzar rayos verticales rápido)
// ---------------------------------------------------------------------------

interface XYIndex {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  start: Uint32Array;
  items: Uint32Array;
}

async function buildXYIndex(
  soup: Float32Array,
  bounds: ReturnType<typeof soupBounds>,
  tick: () => Promise<void>
): Promise<XYIndex> {
  const w = Math.max(bounds.x1 - bounds.x0, 1e-3);
  const h = Math.max(bounds.y1 - bounds.y0, 1e-3);
  const cell = Math.max(0.5, Math.max(w, h) / 96);
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const triCount = soup.length / 9;
  const counts = new Uint32Array(cols * rows + 1);

  const cellRange = (t: number) => {
    const o = t * 9;
    const minX = Math.min(soup[o], soup[o + 3], soup[o + 6]);
    const maxX = Math.max(soup[o], soup[o + 3], soup[o + 6]);
    const minY = Math.min(soup[o + 1], soup[o + 4], soup[o + 7]);
    const maxY = Math.max(soup[o + 1], soup[o + 4], soup[o + 7]);
    return [
      Math.max(0, Math.floor((minX - bounds.x0) / cell)),
      Math.min(cols - 1, Math.floor((maxX - bounds.x0) / cell)),
      Math.max(0, Math.floor((minY - bounds.y0) / cell)),
      Math.min(rows - 1, Math.floor((maxY - bounds.y0) / cell)),
    ];
  };

  for (let t = 0; t < triCount; t += 1) {
    if ((t & 4095) === 0) await tick();
    const [i0, i1, j0, j1] = cellRange(t);
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) counts[j * cols + i + 1] += 1;
  }
  for (let k = 1; k < counts.length; k += 1) counts[k] += counts[k - 1];
  const start = counts.slice();
  const fill = counts.slice(0, cols * rows);
  const items = new Uint32Array(start[cols * rows]);
  for (let t = 0; t < triCount; t += 1) {
    if ((t & 4095) === 0) await tick();
    const [i0, i1, j0, j1] = cellRange(t);
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) items[fill[j * cols + i]++] = t;
  }
  return { x0: bounds.x0, y0: bounds.y0, cell, cols, rows, start, items };
}

/** Componente Z (sin normalizar) de la normal del triángulo `t`, ya orientada. */
function normalZ(soup: Float32Array, t: number, flip: number): number {
  const o = t * 9;
  const ux = soup[o + 3] - soup[o], uy = soup[o + 4] - soup[o + 1];
  const vx = soup[o + 6] - soup[o], vy = soup[o + 7] - soup[o + 1];
  return (ux * vy - uy * vx) * flip;
}

/**
 * Rayo hacia −Z desde (x, y, fromZ).
 *   - `null`: el primer impacto es una cara que mira hacia abajo → el punto
 *     está dentro del sólido (caras internas de uniones sin fusionar): no hay pilar.
 *   - número: altura de la superficie donde apoya el pilar (0 = cama).
 */
function castDown(
  soup: Float32Array,
  index: XYIndex,
  flip: number,
  x: number,
  y: number,
  fromZ: number
): number | null {
  const i = Math.floor((x - index.x0) / index.cell);
  const j = Math.floor((y - index.y0) / index.cell);
  if (i < 0 || j < 0 || i >= index.cols || j >= index.rows) return 0;
  const k = j * index.cols + i;
  let best = -Infinity;
  let inside = false;
  for (let p = index.start[k]; p < index.start[k + 1]; p += 1) {
    const t = index.items[p];
    const z = heightAt(soup, t, x, y);
    if (!(z < fromZ - 1e-3) || z < best - 1e-3) continue;
    const facingDown = normalZ(soup, t, flip) < 0;
    // Empates (caras coincidentes): gana la interpretación prudente, "dentro".
    inside = z > best + 1e-3 ? facingDown : inside || facingDown;
    best = Math.max(best, z);
  }
  if (best === -Infinity) return 0;
  return inside ? null : Math.max(0, best);
}

// ---------------------------------------------------------------------------
// Detección de voladizos y muestreo
// ---------------------------------------------------------------------------

interface Candidate {
  x: number;
  y: number;
  z: number;
}

async function findOverhangs(
  soup: Float32Array,
  overhangDeg: number,
  tick: () => Promise<void>
): Promise<{ faces: Uint32Array; areas: Float32Array; flip: number }> {
  const triCount = soup.length / 9;

  // Orientación global: si la malla viene "del revés" (volumen negativo), se invierten las normales.
  let volume = 0;
  for (let t = 0; t < triCount; t += 1) {
    if ((t & 8191) === 0) await tick();
    const o = t * 9;
    volume +=
      soup[o] * (soup[o + 4] * soup[o + 8] - soup[o + 5] * soup[o + 7]) -
      soup[o + 1] * (soup[o + 3] * soup[o + 8] - soup[o + 5] * soup[o + 6]) +
      soup[o + 2] * (soup[o + 3] * soup[o + 7] - soup[o + 4] * soup[o + 6]);
  }
  const flip = volume < 0 ? -1 : 1;
  const threshold = -Math.sin((overhangDeg * Math.PI) / 180);

  const faces: number[] = [];
  const areas: number[] = [];
  for (let t = 0; t < triCount; t += 1) {
    if ((t & 8191) === 0) await tick();
    const o = t * 9;
    if (Math.max(soup[o + 2], soup[o + 5], soup[o + 8]) < BED_CONTACT_MM) continue;
    const ux = soup[o + 3] - soup[o], uy = soup[o + 4] - soup[o + 1], uz = soup[o + 5] - soup[o + 2];
    const vx = soup[o + 6] - soup[o], vy = soup[o + 7] - soup[o + 1], vz = soup[o + 8] - soup[o + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = (ux * vy - uy * vx) * flip;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;
    if (nz / len < threshold) {
      faces.push(t);
      // Área proyectada en XY (lo que "cuelga").
      areas.push(Math.abs(nz) / 2);
    }
  }
  return { faces: Uint32Array.from(faces), areas: Float32Array.from(areas), flip };
}

/** Puntos de contacto con una cuadrícula de paso `s`. */
async function sampleContacts(
  soup: Float32Array,
  faces: Uint32Array,
  areas: Float32Array,
  originX: number,
  originY: number,
  s: number,
  tick: () => Promise<void>
): Promise<Candidate[]> {
  const gridZ = new Map<number, number[]>();
  const fallback = new Map<number, { area: number; x: number; y: number; z: number }>();
  const key = (i: number, j: number) => j * 100003 + i;

  for (let f = 0; f < faces.length; f += 1) {
    if ((f & 2047) === 0) await tick();
    const t = faces[f];
    const o = t * 9;
    const minX = Math.min(soup[o], soup[o + 3], soup[o + 6]);
    const maxX = Math.max(soup[o], soup[o + 3], soup[o + 6]);
    const minY = Math.min(soup[o + 1], soup[o + 4], soup[o + 7]);
    const maxY = Math.max(soup[o + 1], soup[o + 4], soup[o + 7]);
    const i0 = Math.ceil((minX - originX) / s - 0.5);
    const i1 = Math.floor((maxX - originX) / s - 0.5);
    const j0 = Math.ceil((minY - originY) / s - 0.5);
    const j1 = Math.floor((maxY - originY) / s - 0.5);
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const x = originX + (i + 0.5) * s;
        const y = originY + (j + 0.5) * s;
        const z = heightAt(soup, t, x, y);
        if (!(z >= BED_CONTACT_MM)) continue;
        const k = key(i, j);
        const list = gridZ.get(k);
        if (list) list.push(z);
        else gridZ.set(k, [z]);
      }
    }

    // Respaldo: islas pequeñas que no contienen ningún punto de la cuadrícula.
    const cx = (soup[o] + soup[o + 3] + soup[o + 6]) / 3;
    const cy = (soup[o + 1] + soup[o + 4] + soup[o + 7]) / 3;
    const cz = (soup[o + 2] + soup[o + 5] + soup[o + 8]) / 3;
    if (cz < BED_CONTACT_MM) continue;
    const k = key(Math.floor((cx - originX) / s), Math.floor((cy - originY) / s));
    const prev = fallback.get(k);
    const area = (prev?.area ?? 0) + areas[f];
    if (!prev || areas[f] > prev.area / 2) fallback.set(k, { area, x: cx, y: cy, z: cz });
    else prev.area = area;
  }

  const candidates: Candidate[] = [];
  for (const [k, zs] of gridZ) {
    const i = k % 100003;
    const j = Math.round((k - i) / 100003);
    const x = originX + (i + 0.5) * s;
    const y = originY + (j + 0.5) * s;
    zs.sort((a, b) => a - b);
    let last = -Infinity;
    for (const z of zs) {
      if (z - last < SAME_SURFACE_MM) continue;
      candidates.push({ x, y, z });
      last = z;
    }
  }
  for (const [k, fb] of fallback) {
    if (gridZ.has(k) || fb.area < 0.5) continue;
    candidates.push({ x: fb.x, y: fb.y, z: fb.z });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Geometría de los pilares
// ---------------------------------------------------------------------------

interface Ring {
  z: number;
  r: number;
}

function pillarProfile(p: SupportPillar, footRadius: number): Ring[] {
  const h = p.top - p.bottom;
  const tip = Math.min(TIP_LENGTH, h * 0.35);
  const rings: Ring[] = [];
  if (p.onBed) {
    const foot = Math.min(FOOT_HEIGHT, h * 0.15);
    rings.push({ z: 0, r: footRadius }, { z: foot, r: PILLAR_RADIUS });
  } else {
    rings.push({ z: p.bottom, r: TIP_RADIUS }, { z: p.bottom + tip, r: PILLAR_RADIUS });
  }
  rings.push({ z: p.top - tip, r: PILLAR_RADIUS }, { z: p.top, r: TIP_RADIUS });
  // Solo alturas estrictamente crecientes.
  return rings.filter((ring, i) => i === 0 || ring.z > rings[i - 1].z + 1e-4);
}

function writePillar(out: Float32Array, offset: number, p: SupportPillar, rings: Ring[]): number {
  const cos: number[] = [];
  const sin: number[] = [];
  for (let s = 0; s <= SEGMENTS; s += 1) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    cos.push(Math.cos(a));
    sin.push(Math.sin(a));
  }
  let o = offset;
  const put = (x: number, y: number, z: number) => {
    out[o++] = x;
    out[o++] = y;
    out[o++] = z;
  };
  const px = (r: number, s: number) => p.x + r * cos[s];
  const py = (r: number, s: number) => p.y + r * sin[s];

  // Laterales (normales hacia fuera).
  for (let k = 0; k < rings.length - 1; k += 1) {
    const a = rings[k];
    const b = rings[k + 1];
    for (let s = 0; s < SEGMENTS; s += 1) {
      put(px(a.r, s), py(a.r, s), a.z);
      put(px(a.r, s + 1), py(a.r, s + 1), a.z);
      put(px(b.r, s + 1), py(b.r, s + 1), b.z);
      put(px(a.r, s), py(a.r, s), a.z);
      put(px(b.r, s + 1), py(b.r, s + 1), b.z);
      put(px(b.r, s), py(b.r, s), b.z);
    }
  }
  // Tapa inferior (normal −Z) y superior (normal +Z): pilar cerrado e imprimible.
  const bottom = rings[0];
  const top = rings[rings.length - 1];
  for (let s = 0; s < SEGMENTS; s += 1) {
    put(p.x, p.y, bottom.z);
    put(px(bottom.r, s + 1), py(bottom.r, s + 1), bottom.z);
    put(px(bottom.r, s), py(bottom.r, s), bottom.z);
    put(p.x, p.y, top.z);
    put(px(top.r, s), py(top.r, s), top.z);
    put(px(top.r, s + 1), py(top.r, s + 1), top.z);
  }
  return o;
}

function buildPillarSoup(pillars: SupportPillar[], footRadii: number[]): Float32Array {
  const profiles = pillars.map((p, i) => pillarProfile(p, footRadii[i]));
  const floats = profiles.reduce(
    (sum, rings) => sum + ((rings.length - 1) * SEGMENTS * 2 + SEGMENTS * 2) * 9,
    0
  );
  const out = new Float32Array(floats);
  let offset = 0;
  pillars.forEach((p, i) => {
    offset = writePillar(out, offset, p, profiles[i]);
  });
  return out;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** Malla Three.js translúcida para dibujar los pilares en el visor. */
export function createSupportMesh(
  THREE: typeof import("three"),
  soup: Float32Array,
  color: string
): import("three").Mesh<import("three").BufferGeometry, import("three").MeshStandardMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(soup, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.7,
    metalness: 0,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Genera soportes para una pieza YA escalada y apoyada en Z = 0
 * (usa `scaleAndGroundSoup` antes).
 */
export async function generateAutoSupports(
  groundedSoup: Float32Array,
  options: AutoSupportOptions = {}
): Promise<AutoSupportResult> {
  const maxPillars = options.maxPillars ?? MAX_SUPPORT_PILLARS;
  const tick = createYielder(options.signal);
  const empty = (spacingMm: number, overhangFaces: number): AutoSupportResult => ({
    pillars: [],
    soup: new Float32Array(0),
    spacingMm,
    overhangFaces,
    capped: false,
  });

  if (groundedSoup.length < 9) return empty(6, 0);
  const bounds = soupBounds(groundedSoup);
  const { faces, areas, flip } = await findOverhangs(groundedSoup, options.overhangDeg ?? SUPPORT_OVERHANG_DEG, tick);
  if (faces.length === 0) return empty(6, 0);

  // Cuadrícula adaptativa: 6 mm en piezas pequeñas, 8 mm en las grandes.
  const footprint = Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
  let spacing = Math.min(8, Math.max(6, footprint / 16));
  let candidates: Candidate[] = [];
  for (let attempt = 0; attempt < 14; attempt += 1) {
    candidates = await sampleContacts(groundedSoup, faces, areas, bounds.x0, bounds.y0, spacing, tick);
    if (candidates.length <= maxPillars) break;
    spacing *= 1.2;
  }

  const index = await buildXYIndex(groundedSoup, bounds, tick);
  const pillars: SupportPillar[] = [];
  for (let c = 0; c < candidates.length; c += 1) {
    if ((c & 15) === 0) await tick();
    const cand = candidates[c];
    // El pilar no debe salirse de la huella de la pieza (cabida en la cama).
    const x = Math.min(bounds.x1 - PILLAR_RADIUS, Math.max(bounds.x0 + PILLAR_RADIUS, cand.x));
    const y = Math.min(bounds.y1 - PILLAR_RADIUS, Math.max(bounds.y0 + PILLAR_RADIUS, cand.y));
    const bottom = castDown(groundedSoup, index, flip, cand.x, cand.y, cand.z - 0.05);
    if (bottom === null) continue;
    const onBed = bottom < 0.05;
    if (cand.z - (onBed ? 0 : bottom) < (onBed ? BED_CONTACT_MM : MIN_GAP_MM)) continue;
    pillars.push({ x, y, top: cand.z, bottom: onBed ? 0 : bottom, onBed });
  }

  // Sin pilares solapados (el laminador usa la regla par/impar).
  const minDistance = FOOT_RADIUS * 2 + 0.2;
  const kept: SupportPillar[] = [];
  for (const p of pillars) {
    const clash = kept.some(
      (q) => Math.hypot(p.x - q.x, p.y - q.y) < minDistance && p.bottom < q.top && q.bottom < p.top
    );
    if (!clash) kept.push(p);
  }

  let capped = false;
  let final = kept;
  if (final.length > maxPillars) {
    capped = true;
    const stride = final.length / maxPillars;
    final = Array.from({ length: maxPillars }, (_, i) => kept[Math.floor(i * stride)]);
  }

  // La base ensanchada tampoco se sale de la huella.
  const footRadii = final.map((p) =>
    Math.max(
      PILLAR_RADIUS,
      Math.min(FOOT_RADIUS, p.x - bounds.x0, bounds.x1 - p.x, p.y - bounds.y0, bounds.y1 - p.y)
    )
  );
  await tick();

  return {
    pillars: final,
    soup: buildPillarSoup(final, footRadii),
    spacingMm: spacing,
    overhangFaces: faces.length,
    capped,
  };
}
