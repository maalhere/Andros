// ============================================================================
// ANDROS — INTERFAZ COMÚN DE ADAPTADORES DE IMPRESORA
// Cada ecosistema del registro (src/lib/printers/registry.ts) tiene un
// adaptador con la misma forma. El diálogo de impresión solo habla con esta
// interfaz: añadir una impresora nueva = una entrada en el registro.
// ============================================================================

import type { PrintResult, PrinterStatus } from "@/lib/printer/flashforgeShared";
import type { LocalTarget } from "../network";
import type { PrintProfile, PrinterEcosystem, PrinterModel, SlicerId } from "../registry";

/** Archivo que se entrega al laminador (ya escalado / con soportes, o el original). */
export interface HandoffFile {
  bytes: Uint8Array<ArrayBuffer>;
  fileName: string;
  mimeType: string;
  description: string;
}

export interface HandoffOptions {
  slicer: SlicerId;
  /**
   * Enlace https temporal al archivo ORIGINAL en la nube. Solo se usa para el
   * protocolo del laminador si el archivo entregado es ese mismo original.
   */
  originalCloudLink: string | null;
  fileIsOriginal: boolean;
}

/**
 * Cómo terminó la entrega:
 *   native   → la app de Windows lo abrió en el laminador instalado.
 *   protocol → se pidió al navegador abrir el laminador (orcaslicer://…).
 *   download → se descargó (con permiso) para abrirlo a mano.
 *   none     → la persona canceló la descarga.
 */
export type HandoffOutcome = "native" | "protocol" | "download" | "none";

export interface HandoffResult {
  outcome: HandoffOutcome;
  slicer: SlicerId;
  /** El laminador elegido no está instalado (solo app de Windows). */
  notInstalled?: boolean;
}

export interface PrinterAdapter {
  readonly ecosystem: PrinterEcosystem;
  readonly title: string;
  /** Puede imprimir directo por el Wi-Fi local (sin laminador externo). */
  readonly directNetwork: boolean;
  /** Extensiones que acepta para el envío directo. */
  readonly directFormats: readonly string[];
  /** Este entorno puede contactar la impresora (app de Windows / npm run dev en la red). */
  canUseNetwork(): boolean;
  status?(target: LocalTarget): Promise<PrinterStatus>;
  send?(target: LocalTarget, fileName: string, bytes: Uint8Array<ArrayBuffer>): Promise<PrintResult>;
  /** Exporta el archivo y lo abre en el laminador (nativo → protocolo → descarga). */
  handoff(printer: PrinterModel, file: HandoffFile, options: HandoffOptions): Promise<HandoffResult>;
  /** Guía de 3 pasos con los parámetros del perfil. */
  guide(printer: PrinterModel, profile: PrintProfile, fileName: string, slicer: SlicerId): string[];
}
