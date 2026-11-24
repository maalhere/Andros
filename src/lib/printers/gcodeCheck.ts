// ============================================================================
// ANDROS — ¿ESTE G-CODE ES PARA ESTA IMPRESORA?
// Antes de enviar un .gcode por Wi-Fi se leen la cabecera y el bloque de
// configuración final (OrcaSlicer, Creality Print, PrusaSlicer y Bambu Studio
// escriben `printer_model = …`). Un G-code laminado para otra máquina puede
// chocar la boquilla o calentar de más: se bloquea o se pide confirmación.
// Módulo puro (navegador + verificación).
// ============================================================================

import { PRINTERS, SLICERS, printerName, type PrinterModel } from "./registry";

export type GcodeVerdict = "match" | "unknown" | "mismatch" | "blocked";

export interface GcodeCheck {
  verdict: GcodeVerdict;
  /** Modelo que declara el archivo (si lo declara). */
  detected: string | null;
  message: string | null;
}

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;

const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Impresora del catálogo que mejor encaja con el texto declarado. */
export function matchPrinterModel(declared: string): PrinterModel | null {
  const have = new Set(tokens(declared));
  let best: PrinterModel | null = null;
  let bestScore = 0;
  for (const p of PRINTERS) {
    const need = tokens(p.model);
    if (!need.every((t) => have.has(t))) continue;
    const score = need.length * 10 + (tokens(p.brand).every((t) => have.has(t)) ? 1 : 0);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** Texto de la cabecera + cola del archivo (sin decodificarlo entero). */
export function gcodeTextSample(bytes: Uint8Array): string {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  if (bytes.byteLength <= HEAD_BYTES + TAIL_BYTES) return decoder.decode(bytes);
  return `${decoder.decode(bytes.subarray(0, HEAD_BYTES))}\n${decoder.decode(bytes.subarray(bytes.byteLength - TAIL_BYTES))}`;
}

export function inspectGcode(sample: string, target: PrinterModel): GcodeCheck {
  const name = printerName(target);
  const flashforge = /;\s*FLAVOR:\s*FlashForge|;\s*machine_type:\s*Adventurer|^xgcode/im.test(sample);
  if (flashforge && target.ecosystem !== "flashforge-tcp") {
    return {
      verdict: "blocked",
      detected: "FlashForge",
      message: `Este archivo está laminado para una FlashForge, no para tu ${name}. Vuelve a laminar la pieza en ${SLICERS[target.slicer].name}.`,
    };
  }
  const declared =
    /^;\s*printer_model\s*=\s*(.+)$/im.exec(sample)?.[1] ??
    /^;\s*PRINTER_MODEL\s*:\s*(.+)$/im.exec(sample)?.[1] ??
    /^;\s*printer_settings_id\s*=\s*(.+)$/im.exec(sample)?.[1] ??
    null;
  const detected = declared ? declared.replace(/["']/g, "").trim().slice(0, 80) : null;
  if (!detected) {
    return {
      verdict: "unknown",
      detected: null,
      message: `El archivo no dice para qué impresora es. Envíalo solo si lo laminaste para tu ${name}.`,
    };
  }
  const matched = matchPrinterModel(detected);
  if (matched?.id === target.id) return { verdict: "match", detected, message: null };
  return {
    verdict: "mismatch",
    detected,
    message: `Este G-code dice «${detected}», pero elegiste ${name}. Un G-code de otra máquina puede chocar la boquilla o calentar de más.`,
  };
}
