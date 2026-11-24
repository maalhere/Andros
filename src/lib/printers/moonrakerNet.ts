// ============================================================================
// ANDROS — NÚCLEO HTTP DE MOONRAKER (Klipper: Creality K2 SE / K1 / KE,
// Elegoo Neptune 4, QIDI Q1 Pro / Plus4…)
//
// Un único código para la ruta /api/printer/klipper (npm run dev en la misma
// red) y para la app de Windows (electron/generated/klipper.cjs). Solo usa
// `fetch`, `FormData` y `Blob` globales (Node ≥ 20, Electron, navegador).
//
//   · Estado: GET /printer/info + GET /printer/objects/query (temperaturas,
//     estado del trabajo y progreso).
//   · Imprimir: POST /server/files/upload (multipart, root=gcodes, print=true):
//     Moonraker guarda el .gcode y empieza a imprimir.
//
// Defensa en profundidad anti-SSRF: cada llamada vuelve a validar el destino
// (RFC 1918 + puertos 7125/4408/80) y no sigue redirecciones.
// ============================================================================

import { parseKlipperTarget, type LocalTarget } from "./network";
import type { PrintResult, PrinterStatus } from "@/lib/printer/flashforgeShared";

export const KLIPPER_MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 4000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export interface KlipperStatus extends PrinterStatus {
  /** Estado de Klipper: ready | startup | shutdown | error. */
  klippyState?: string;
  /** Estado del trabajo: standby | printing | paused | complete | cancelled | error. */
  jobState?: string;
  jobFile?: string | null;
}

export class MoonrakerError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "MoonrakerError";
  }
}

function assertTarget(target: LocalTarget): LocalTarget {
  const parsed = parseKlipperTarget(target?.ip, target?.port);
  if (typeof parsed === "string") throw new MoonrakerError(parsed, 400);
  return parsed;
}

function baseUrl(target: LocalTarget): string {
  return target.port === 80 ? `http://${target.ip}` : `http://${target.ip}:${target.port}`;
}

async function request(target: LocalTarget, path: string, init: RequestInit & { timeoutMs: number }): Promise<unknown> {
  const safe = assertTarget(target);
  const { timeoutMs, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${baseUrl(safe)}${path}`, {
      ...rest,
      // Nunca seguir redirecciones: una impresora no redirige a otro host.
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new MoonrakerError("La impresora no respondió a tiempo");
    }
    throw new MoonrakerError("No hay respuesta en esa IP y puerto");
  }
  if (res.status === 401 || res.status === 403) {
    throw new MoonrakerError(
      "Moonraker pidió autorización: añade tu red a «trusted_clients» en moonraker.conf o usa el puerto de Fluidd",
      res.status
    );
  }
  if (res.status === 404) throw new MoonrakerError("Ese puerto no es la API de Moonraker (prueba 7125 o 4408)", 404);
  if (!res.ok) throw new MoonrakerError(`Moonraker respondió con el error ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new MoonrakerError("La respuesta no es de Moonraker");
  }
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function heater(obj: unknown): { current: number; target: number } | null {
  const o = (obj ?? {}) as { temperature?: unknown; target?: unknown };
  const current = num(o.temperature);
  const target = num(o.target);
  return current === null ? null : { current, target: target ?? 0 };
}

/** Estado de la impresora (temperaturas, trabajo y progreso). */
export async function readKlipperStatus(target: LocalTarget): Promise<KlipperStatus> {
  const info = (await request(target, "/printer/info", { method: "GET", timeoutMs: STATUS_TIMEOUT_MS })) as {
    result?: { state?: string; hostname?: string; software_version?: string };
  };
  if (!info?.result) throw new MoonrakerError("La respuesta no es de Moonraker");
  const query =
    "/printer/objects/query?extruder=temperature,target&heater_bed=temperature,target&print_stats=state,filename&virtual_sdcard=progress";
  const objects = (await request(target, query, { method: "GET", timeoutMs: STATUS_TIMEOUT_MS })) as {
    result?: { status?: Record<string, Record<string, unknown>> };
  };
  const status = objects?.result?.status ?? {};
  const jobState = typeof status.print_stats?.state === "string" ? (status.print_stats.state as string) : undefined;
  const progress = typeof status.virtual_sdcard?.progress === "number" ? (status.virtual_sdcard.progress as number) : 0;
  return {
    ok: true,
    klippyState: info.result.state,
    jobState,
    jobFile: typeof status.print_stats?.filename === "string" ? (status.print_stats.filename as string) || null : null,
    machine: {
      type: "Klipper",
      name: info.result.hostname ?? null,
      firmware: info.result.software_version ?? null,
    },
    temperatures: { extruder: heater(status.extruder), bed: heater(status.heater_bed) },
    progress: {
      printing: jobState === "printing",
      percent: Math.max(0, Math.min(100, Math.round(progress * 100))),
      layer: null,
    },
  };
}

/** Nombre seguro para la carpeta gcodes de Moonraker: ANDROS_pieza.gcode. */
export function safeGcodeFileName(raw: string): string {
  const base = String(raw ?? "")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${base || "ANDROS_pieza"}.gcode`;
}

/** Sube el .gcode y le pide a Moonraker que empiece a imprimir. */
export async function uploadAndPrintKlipper(
  target: LocalTarget,
  fileName: string,
  data: Uint8Array<ArrayBuffer>
): Promise<PrintResult> {
  if (data.byteLength === 0) throw new MoonrakerError("El archivo de impresión está vacío.", 400);
  if (data.byteLength > KLIPPER_MAX_UPLOAD_BYTES) throw new MoonrakerError("El archivo supera 128 MB.", 400);
  const name = safeGcodeFileName(fileName);
  const form = new FormData();
  form.append("root", "gcodes");
  form.append("print", "true");
  form.append("file", new Blob([data], { type: "application/octet-stream" }), name);
  const res = (await request(target, "/server/files/upload", {
    method: "POST",
    body: form,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })) as { result?: { item?: { path?: string }; print_started?: boolean } | string };
  const result = res?.result;
  const path = typeof result === "string" ? result : result?.item?.path;
  if (!path) throw new MoonrakerError("Moonraker no confirmó la subida");
  if (typeof result === "object" && result.print_started === false) {
    throw new MoonrakerError("El archivo se subió, pero la impresora no empezó (¿está ocupada imprimiendo?)");
  }
  return { ok: true, fileName: path, bytes: data.byteLength };
}

export function describeMoonrakerError(e: unknown): string {
  return e instanceof Error ? e.message : "Error desconocido";
}
