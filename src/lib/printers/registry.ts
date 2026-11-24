// ============================================================================
// ANDROS — REGISTRO MODULAR DE IMPRESORAS 3D
//
// Catálogo tipado de las impresoras más usadas (Creality K2 SE y FlashForge
// Adventurer 3 destacadas al inicio). Cada máquina declara:
//   · Volumen real de cama X × Y × Z (mm), boquilla estándar y extrusor.
//   · Ecosistema de envío → adaptador en src/lib/printers/adapters/.
//   · Laminador recomendado y perfiles precalibrados Rápido / Estándar /
//     Fuerte para PLA, PETG y ABS (ajustados a sus límites de temperatura).
//
// Módulo puro (sin React, sin Node): lo usan Print3DModal (carga diferida,
// solo en Modo Experto), la ruta /api/printer/klipper y scripts/verify-printers.ts.
// ============================================================================

export type ExtruderType = "direct" | "bowden";

export type PrinterEcosystem =
  | "klipper-moonraker"
  | "flashforge-tcp"
  | "bambu-slicer-handoff"
  | "generic-slicer-download";

export type SlicerId = "creality-print" | "orcaslicer" | "bambu-studio" | "prusaslicer" | "flashprint";

export type MaterialId = "pla" | "petg" | "abs";

export type ProfileId = "fast" | "standard" | "strong";

export interface BedVolume {
  x: number;
  y: number;
  z: number;
}

export interface PrintProfile {
  profile: ProfileId;
  material: MaterialId;
  layerHeight: number;
  wallCount: number;
  topBottomLayers: number;
  /** 0..100 */
  infillPercent: number;
  infillPattern: "grid" | "gyroid";
  /** Velocidad de paredes interiores / relleno (mm/s). */
  speed: number;
  nozzleTemp: number;
  bedTemp: number;
  /** 0..100 */
  fanPercent: number;
  /** Aviso honesto (p. ej. ABS en impresora abierta). */
  warning: string | null;
}

export type ProfileTable = Record<MaterialId, Record<ProfileId, PrintProfile>>;

export interface PrinterModel {
  id: string;
  brand: string;
  model: string;
  /** Destacada al inicio del selector. */
  featured: boolean;
  bed: BedVolume;
  nozzleMm: number;
  extruder: ExtruderType;
  enclosed: boolean;
  ecosystem: PrinterEcosystem;
  slicer: SlicerId;
  altSlicers: readonly SlicerId[];
  maxNozzleC: number;
  maxBedC: number;
  /** Velocidad práctica de impresión (mm/s) del perfil Rápido con PLA. */
  practicalSpeed: number;
  /** Puertos HTTP de Moonraker/Fluidd que se prueban (solo Klipper). */
  networkPorts: readonly number[];
  profiles: ProfileTable;
}

export interface SlicerInfo {
  id: SlicerId;
  name: string;
  /** Protocolo para abrir un enlace https en el programa (null si no tiene). */
  openScheme: string | null;
  downloadUrl: string;
}

export const SLICERS: Record<SlicerId, SlicerInfo> = {
  "creality-print": {
    id: "creality-print",
    name: "Creality Print",
    openScheme: null,
    downloadUrl: "https://www.creality.com/pages/download-software",
  },
  orcaslicer: {
    id: "orcaslicer",
    name: "OrcaSlicer",
    openScheme: "orcaslicer://open?file=",
    downloadUrl: "https://github.com/SoftFever/OrcaSlicer/releases/latest",
  },
  "bambu-studio": {
    id: "bambu-studio",
    name: "Bambu Studio",
    openScheme: "bambustudio://open?file=",
    downloadUrl: "https://bambulab.com/en/download/studio",
  },
  prusaslicer: {
    id: "prusaslicer",
    name: "PrusaSlicer",
    openScheme: "prusaslicer://open?file=",
    downloadUrl: "https://www.prusa3d.com/page/prusaslicer_424/",
  },
  flashprint: {
    id: "flashprint",
    name: "FlashPrint",
    openScheme: null,
    downloadUrl: "https://www.flashforge.com/download-center/63",
  },
};

export const MATERIALS: { id: MaterialId; label: string; hint: string }[] = [
  { id: "pla", label: "PLA", hint: "Fácil y económico" },
  { id: "petg", label: "PETG", hint: "Resistente y flexible" },
  { id: "abs", label: "ABS", hint: "Aguanta calor · mejor con cerramiento" },
];

export const PROFILES: { id: ProfileId; label: string; hint: string }[] = [
  { id: "fast", label: "Rápido", hint: "Pruebas y prototipos" },
  { id: "standard", label: "Estándar", hint: "Equilibrio calidad / tiempo" },
  { id: "strong", label: "Fuerte", hint: "Piezas que soportan carga" },
];

export const PROFILE_LABEL: Record<ProfileId, string> = { fast: "Rápido", standard: "Estándar", strong: "Fuerte" };
export const MATERIAL_LABEL: Record<MaterialId, string> = { pla: "PLA", petg: "PETG", abs: "ABS" };

export const ECOSYSTEM_LABEL: Record<PrinterEcosystem, string> = {
  "klipper-moonraker": "Klipper · Moonraker (Wi-Fi local)",
  "flashforge-tcp": "FlashForge · Wi-Fi directo",
  "bambu-slicer-handoff": "Bambu Lab · vía Bambu Studio / OrcaSlicer",
  "generic-slicer-download": "Descarga + laminador",
};

// ---------------------------------------------------------------------------
// Perfiles precalibrados
// ---------------------------------------------------------------------------

const MATERIAL_BASE: Record<MaterialId, { nozzle: number; bed: number; fan: number; speedFactor: number }> = {
  pla: { nozzle: 210, bed: 60, fan: 100, speedFactor: 1 },
  petg: { nozzle: 240, bed: 75, fan: 40, speedFactor: 0.6 },
  abs: { nozzle: 250, bed: 100, fan: 10, speedFactor: 0.8 },
};

const PROFILE_BASE: Record<
  ProfileId,
  { layer: number; walls: number; topBottom: number; infill: number; pattern: "grid" | "gyroid"; speedFactor: number }
> = {
  fast: { layer: 0.28, walls: 2, topBottom: 3, infill: 10, pattern: "grid", speedFactor: 1 },
  standard: { layer: 0.2, walls: 3, topBottom: 4, infill: 15, pattern: "grid", speedFactor: 0.7 },
  strong: { layer: 0.2, walls: 5, topBottom: 6, infill: 40, pattern: "gyroid", speedFactor: 0.5 },
};

interface ProfileInput {
  practicalSpeed: number;
  enclosed: boolean;
  maxNozzleC: number;
  maxBedC: number;
  nozzleMm: number;
}

/** Perfiles Rápido / Estándar / Fuerte × PLA / PETG / ABS para una máquina. */
export function buildProfiles(input: ProfileInput): ProfileTable {
  const table = {} as ProfileTable;
  for (const material of ["pla", "petg", "abs"] as const) {
    const m = MATERIAL_BASE[material];
    table[material] = {} as Record<ProfileId, PrintProfile>;
    for (const profile of ["fast", "standard", "strong"] as const) {
      const p = PROFILE_BASE[profile];
      const nozzleTemp = Math.min(m.nozzle, input.maxNozzleC);
      const bedTemp = Math.min(m.bed, input.maxBedC);
      const warnings: string[] = [];
      if (material === "abs" && !input.enclosed) {
        warnings.push("ABS en impresora abierta: tiende a deformarse. Usa una caja/cerramiento o elige PETG.");
      }
      if (nozzleTemp < m.nozzle || bedTemp < m.bed) {
        warnings.push(`Temperaturas limitadas al máximo de esta impresora (${nozzleTemp} °C / ${bedTemp} °C).`);
      }
      // Altura de capa ≤ 75 % de la boquilla (regla estándar de los laminadores).
      const layerHeight = Math.min(p.layer, Math.round(input.nozzleMm * 0.75 * 100) / 100);
      table[material][profile] = {
        profile,
        material,
        layerHeight,
        wallCount: p.walls,
        topBottomLayers: p.topBottom,
        infillPercent: p.infill,
        infillPattern: p.pattern,
        speed: Math.max(20, Math.round((input.practicalSpeed * p.speedFactor * m.speedFactor) / 5) * 5),
        nozzleTemp,
        bedTemp,
        fanPercent: m.fan,
        warning: warnings.length ? warnings.join(" ") : null,
      };
    }
  }
  return table;
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

type PrinterSeed = Omit<PrinterModel, "profiles" | "networkPorts" | "nozzleMm" | "featured"> & {
  featured?: boolean;
  nozzleMm?: number;
  networkPorts?: readonly number[];
};

/** Puertos estándar de Moonraker / Fluidd en las Klipper de fábrica. */
export const KLIPPER_PORTS = [7125, 4408, 80] as const;

function printer(seed: PrinterSeed): PrinterModel {
  const nozzleMm = seed.nozzleMm ?? 0.4;
  return {
    ...seed,
    featured: seed.featured ?? false,
    nozzleMm,
    networkPorts: seed.networkPorts ?? (seed.ecosystem === "klipper-moonraker" ? KLIPPER_PORTS : []),
    profiles: buildProfiles({ ...seed, nozzleMm }),
  };
}

export const PRINTERS: readonly PrinterModel[] = [
  // --- Destacadas ------------------------------------------------------------
  printer({
    id: "creality-k2-se",
    brand: "Creality",
    model: "K2 SE",
    featured: true,
    bed: { x: 220, y: 215, z: 245 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "klipper-moonraker",
    slicer: "creality-print",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 300,
    maxBedC: 100,
    practicalSpeed: 300,
  }),
  printer({
    id: "flashforge-adventurer-3",
    brand: "FlashForge",
    model: "Adventurer 3",
    featured: true,
    bed: { x: 150, y: 150, z: 150 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "flashforge-tcp",
    slicer: "flashprint",
    altSlicers: [],
    maxNozzleC: 240,
    maxBedC: 100,
    practicalSpeed: 60,
  }),
  // --- Creality ---------------------------------------------------------------
  printer({
    id: "creality-k1",
    brand: "Creality",
    model: "K1",
    bed: { x: 220, y: 220, z: 250 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "klipper-moonraker",
    slicer: "creality-print",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 300,
    maxBedC: 100,
    practicalSpeed: 300,
  }),
  printer({
    id: "creality-k1-max",
    brand: "Creality",
    model: "K1 Max",
    bed: { x: 300, y: 300, z: 300 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "klipper-moonraker",
    slicer: "creality-print",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 300,
    maxBedC: 100,
    practicalSpeed: 300,
  }),
  printer({
    id: "creality-ender-3-v3-se",
    brand: "Creality",
    model: "Ender-3 V3 SE",
    bed: { x: 220, y: 220, z: 250 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "generic-slicer-download",
    slicer: "creality-print",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 260,
    maxBedC: 100,
    practicalSpeed: 150,
  }),
  printer({
    id: "creality-ender-3-v3-ke",
    brand: "Creality",
    model: "Ender-3 V3 KE",
    bed: { x: 220, y: 220, z: 240 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "klipper-moonraker",
    slicer: "creality-print",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 300,
    maxBedC: 100,
    practicalSpeed: 250,
  }),
  // --- Bambu Lab --------------------------------------------------------------
  printer({
    id: "bambu-a1-mini",
    brand: "Bambu Lab",
    model: "A1 Mini",
    bed: { x: 180, y: 180, z: 180 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "bambu-slicer-handoff",
    slicer: "bambu-studio",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 300,
    maxBedC: 80,
    practicalSpeed: 250,
  }),
  printer({
    id: "bambu-a1",
    brand: "Bambu Lab",
    model: "A1",
    bed: { x: 256, y: 256, z: 256 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "bambu-slicer-handoff",
    slicer: "bambu-studio",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 300,
    maxBedC: 100,
    practicalSpeed: 250,
  }),
  printer({
    id: "bambu-p1s",
    brand: "Bambu Lab",
    model: "P1S",
    bed: { x: 256, y: 256, z: 256 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "bambu-slicer-handoff",
    slicer: "bambu-studio",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 300,
    maxBedC: 100,
    practicalSpeed: 300,
  }),
  printer({
    id: "bambu-x1c",
    brand: "Bambu Lab",
    model: "X1 Carbon",
    bed: { x: 256, y: 256, z: 256 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "bambu-slicer-handoff",
    slicer: "bambu-studio",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 300,
    maxBedC: 110,
    practicalSpeed: 300,
  }),
  // --- FlashForge -------------------------------------------------------------
  printer({
    id: "flashforge-adventurer-5m",
    brand: "FlashForge",
    model: "Adventurer 5M",
    bed: { x: 220, y: 220, z: 220 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "generic-slicer-download",
    slicer: "flashprint",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 280,
    maxBedC: 110,
    practicalSpeed: 300,
  }),
  printer({
    id: "flashforge-adventurer-5m-pro",
    brand: "FlashForge",
    model: "Adventurer 5M Pro",
    bed: { x: 220, y: 220, z: 220 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "generic-slicer-download",
    slicer: "flashprint",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 280,
    maxBedC: 110,
    practicalSpeed: 300,
  }),
  // --- Prusa ------------------------------------------------------------------
  printer({
    id: "prusa-mk4s",
    brand: "Prusa",
    model: "MK4S",
    bed: { x: 250, y: 210, z: 220 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "generic-slicer-download",
    slicer: "prusaslicer",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 290,
    maxBedC: 120,
    practicalSpeed: 200,
  }),
  printer({
    id: "prusa-core-one",
    brand: "Prusa",
    model: "Core One",
    bed: { x: 250, y: 220, z: 270 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "generic-slicer-download",
    slicer: "prusaslicer",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 290,
    maxBedC: 120,
    practicalSpeed: 250,
  }),
  printer({
    id: "prusa-mini-plus",
    brand: "Prusa",
    model: "MINI+",
    bed: { x: 180, y: 180, z: 180 },
    extruder: "bowden",
    enclosed: false,
    ecosystem: "generic-slicer-download",
    slicer: "prusaslicer",
    altSlicers: ["orcaslicer"],
    maxNozzleC: 280,
    maxBedC: 100,
    practicalSpeed: 100,
  }),
  // --- Anycubic ---------------------------------------------------------------
  printer({
    id: "anycubic-kobra-3",
    brand: "Anycubic",
    model: "Kobra 3",
    bed: { x: 250, y: 250, z: 260 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "generic-slicer-download",
    slicer: "orcaslicer",
    altSlicers: [],
    maxNozzleC: 300,
    maxBedC: 110,
    practicalSpeed: 250,
  }),
  printer({
    id: "anycubic-kobra-s1",
    brand: "Anycubic",
    model: "Kobra S1",
    bed: { x: 250, y: 250, z: 250 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "generic-slicer-download",
    slicer: "orcaslicer",
    altSlicers: [],
    maxNozzleC: 320,
    maxBedC: 120,
    practicalSpeed: 300,
  }),
  // --- Elegoo -----------------------------------------------------------------
  printer({
    id: "elegoo-neptune-4-pro",
    brand: "Elegoo",
    model: "Neptune 4 Pro",
    bed: { x: 225, y: 225, z: 265 },
    extruder: "direct",
    enclosed: false,
    ecosystem: "klipper-moonraker",
    slicer: "orcaslicer",
    altSlicers: [],
    maxNozzleC: 300,
    maxBedC: 110,
    practicalSpeed: 250,
  }),
  printer({
    id: "elegoo-centauri-carbon",
    brand: "Elegoo",
    model: "Centauri Carbon",
    bed: { x: 256, y: 256, z: 256 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "generic-slicer-download",
    slicer: "orcaslicer",
    altSlicers: [],
    maxNozzleC: 320,
    maxBedC: 110,
    practicalSpeed: 300,
  }),
  // --- QIDI -------------------------------------------------------------------
  printer({
    id: "qidi-q1-pro",
    brand: "QIDI",
    model: "Q1 Pro",
    bed: { x: 245, y: 245, z: 240 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "klipper-moonraker",
    slicer: "orcaslicer",
    altSlicers: [],
    maxNozzleC: 350,
    maxBedC: 120,
    practicalSpeed: 300,
  }),
  printer({
    id: "qidi-plus4",
    brand: "QIDI",
    model: "Plus4",
    bed: { x: 305, y: 305, z: 280 },
    extruder: "direct",
    enclosed: true,
    ecosystem: "klipper-moonraker",
    slicer: "orcaslicer",
    altSlicers: [],
    maxNozzleC: 370,
    maxBedC: 120,
    practicalSpeed: 300,
  }),
];

export const DEFAULT_PRINTER_ID = "flashforge-adventurer-3";
export const K2_SE_ID = "creality-k2-se";

const BY_ID = new Map(PRINTERS.map((p) => [p.id, p]));

export function getPrinter(id: string | null | undefined): PrinterModel | null {
  return (id && BY_ID.get(id)) || null;
}

export function printerName(p: PrinterModel): string {
  return `${p.brand} ${p.model}`;
}

export function formatBed(bed: BedVolume): string {
  return `${bed.x} × ${bed.y} × ${bed.z} mm`;
}

/** Grupos del selector: destacadas primero, luego por marca (orden del catálogo). */
export function printerGroups(): { label: string; printers: PrinterModel[] }[] {
  const groups: { label: string; printers: PrinterModel[] }[] = [
    { label: "Destacadas", printers: PRINTERS.filter((p) => p.featured) },
  ];
  for (const p of PRINTERS) {
    if (p.featured) continue;
    let group = groups.find((g) => g.label === p.brand);
    if (!group) {
      group = { label: p.brand, printers: [] };
      groups.push(group);
    }
    group.printers.push(p);
  }
  return groups;
}

/** Valores legibles de un perfil (hoja de parámetros y guía de 3 pasos). */
export function describeProfile(p: PrintProfile, printerModel?: PrinterModel): { label: string; value: string }[] {
  const rows = [
    { label: "Altura de capa", value: `${p.layerHeight.toFixed(2)} mm` },
    { label: "Paredes", value: `${p.wallCount}` },
    { label: "Capas sólidas arriba / abajo", value: `${p.topBottomLayers}` },
    { label: "Relleno", value: `${p.infillPercent} % ${p.infillPattern === "gyroid" ? "giroide" : "reticular"}` },
    { label: "Velocidad", value: `${p.speed} mm/s` },
    { label: `Temperatura ${MATERIAL_LABEL[p.material]} / cama`, value: `${p.nozzleTemp} °C / ${p.bedTemp} °C` },
    { label: "Ventilador de capa", value: `${p.fanPercent} %` },
  ];
  if (printerModel) {
    rows.push({ label: "Boquilla", value: `${printerModel.nozzleMm.toFixed(1)} mm · extrusor ${printerModel.extruder === "direct" ? "directo" : "Bowden"}` });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Verificación de volumen de cama
// ---------------------------------------------------------------------------

export interface BedFit {
  fits: boolean;
  /** Cabe girándola 90° sobre la cama (intercambiando X e Y). */
  fitsRotated: boolean;
  /** Escala uniforme máxima (en %, 1 decimal, hacia abajo) para que quepa sin girar. 100 si ya cabe. */
  scalePercent: number;
  /** Eje que más se pasa (o null si cabe). */
  limitingAxis: "x" | "y" | "z" | null;
  /** Lado más largo de la pieza (mm). */
  biggestMm: number;
}

const FIT_TOLERANCE_MM = 0.05;

export function checkBedFit(size: BedVolume, bed: BedVolume): BedFit {
  const within = (a: number, b: number) => a <= b + FIT_TOLERANCE_MM;
  const fits = within(size.x, bed.x) && within(size.y, bed.y) && within(size.z, bed.z);
  const fitsRotated = !fits && within(size.y, bed.x) && within(size.x, bed.y) && within(size.z, bed.z);
  const ratios = (["x", "y", "z"] as const).map((axis) => ({
    axis,
    ratio: size[axis] > 0 ? bed[axis] / size[axis] : Infinity,
  }));
  const tightest = ratios.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const scalePercent = fits ? 100 : Math.floor(Math.min(1, tightest.ratio) * 1000) / 10;
  return {
    fits,
    fitsRotated,
    scalePercent,
    limitingAxis: fits ? null : tightest.axis,
    biggestMm: Math.max(size.x, size.y, size.z),
  };
}

// ---------------------------------------------------------------------------
// Impresora preferida (localStorage)
// ---------------------------------------------------------------------------

export const PREFERRED_PRINTER_KEY = "andros-printer-model";
/** Claves de versiones anteriores (destino del diálogo de impresión). */
const LEGACY_DESTINATION_KEY = "andros-print-printer";
const LEGACY_MAP: Record<string, string> = {
  adv3: "flashforge-adventurer-3",
  bambu: "bambu-a1",
  prusa: "prusa-mk4s",
};

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readPreferredPrinterId(): string {
  if (typeof window === "undefined") return DEFAULT_PRINTER_ID;
  const saved = safeRead(PREFERRED_PRINTER_KEY);
  if (getPrinter(saved)) return saved as string;
  const legacy = safeRead(LEGACY_DESTINATION_KEY);
  return (legacy && LEGACY_MAP[legacy]) || DEFAULT_PRINTER_ID;
}

export function savePreferredPrinterId(id: string): void {
  if (!getPrinter(id)) return;
  try {
    window.localStorage.setItem(PREFERRED_PRINTER_KEY, id);
  } catch {
    // Sin acceso a localStorage: la elección vale solo esta sesión.
  }
}
