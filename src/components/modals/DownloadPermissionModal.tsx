"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Box,
  Download,
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FolderDown,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  approveDownload,
  declineDownload,
  estimateRemoteSize,
  formatBytes,
  useDownloadPermissionStore,
} from "@/lib/downloadWithPermission";
import { getDesktopBridge } from "@/lib/printer/printerClient";
import { useSettingsStore } from "@/store/useSettingsStore";

// ============================================================================
// ANDROS — PERMISO DE DESCARGA (modal global)
// Se monta una sola vez (src/app/layout.tsx). Muestra la primera petición de
// la cola de `requestFileDownload`: nombre, tipo, peso y origen del archivo,
// con "Cancelar" y "Permitir y descargar".
// Dual-Engine: Paper Modernist (#F6F5F2) / Obsidian Monolith (#0D0E11).
// ============================================================================

const MODEL_3D = new Set(["stl", "obj", "3mf", "step", "stp"]);
const PRINT_CODE = new Set(["gx", "gcode", "g"]);
const ARCHIVES = new Set(["zip", "andros.zip"]);

const subscribeNothing = () => () => {};

function FileGlyph({ extension, className }: { extension: string; className?: string }) {
  if (MODEL_3D.has(extension)) return <Box className={className} />;
  if (PRINT_CODE.has(extension)) return <FileCode className={className} />;
  if (ARCHIVES.has(extension)) return <FileArchive className={className} />;
  if (extension === "json") return <FileBraces className={className} />;
  return <File className={className} />;
}

export const DownloadPermissionModal: React.FC = () => {
  const queue = useDownloadPermissionStore((s) => s.queue);
  const setModalMounted = useDownloadPermissionStore((s) => s.setModalMounted);
  const patch = useDownloadPermissionStore((s) => s.patch);
  const animations = useSettingsStore((s) => s.animations);
  // false en el servidor, true en el navegador (sin desajustes de hidratación).
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const allowRef = useRef<HTMLButtonElement>(null);

  const current = queue[0] ?? null;
  const starting = current?.phase === "starting";
  const isDesktop = mounted && getDesktopBridge() !== null;

  // Registra el modal: sin él, requestFileDownload usa window.confirm.
  useEffect(() => {
    setModalMounted(1);
    return () => setModalMounted(-1);
  }, [setModalMounted]);

  // Peso desconocido (URL): se estima con HEAD sin descargar el archivo.
  const currentId = current?.id;
  const needsSize = current !== null && current.sizeBytes === null && typeof current.source === "string";
  const sourceUrl = needsSize && typeof current.source === "string" ? current.source : null;
  const [sizeChecked, setSizeChecked] = useState<number | null>(null);
  useEffect(() => {
    if (currentId === undefined || !sourceUrl) return;
    const controller = new AbortController();
    void estimateRemoteSize(sourceUrl, controller.signal).then((bytes) => {
      if (controller.signal.aborted) return;
      if (bytes !== null) patch(currentId, { sizeBytes: bytes });
      setSizeChecked(currentId);
    });
    return () => controller.abort();
  }, [currentId, sourceUrl, patch]);

  // Teclado: Esc cancela. El foco empieza en "Permitir y descargar".
  useEffect(() => {
    if (currentId === undefined) return;
    const focusTimer = window.setTimeout(() => allowRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        declineDownload(currentId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [currentId]);

  if (!mounted || typeof document === "undefined") return null;

  const sizeText =
    current === null
      ? ""
      : current.sizeBytes !== null
        ? formatBytes(current.sizeBytes)
        : needsSize && sizeChecked !== current.id
          ? "Calculando…"
          : "Desconocido";
  const reduced = animations === "reduced";

  return createPortal(
    <AnimatePresence>
      {current && (
        <motion.div
          key="download-permission"
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          onPointerDown={() => declineDownload(current.id)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="andros-download-title"
            aria-describedby="andros-download-desc"
            onPointerDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 34, mass: 0.8 }}
            className="w-full max-w-md rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark p-5 space-y-4"
          >
            {/* Cabecera */}
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 shrink-0 rounded-xl bg-andros-accent/12 text-andros-accent-ink flex items-center justify-center">
                <Download className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <h2 id="andros-download-title" className="text-sm font-semibold text-andros-primary">
                  ¿Descargar este archivo?
                </h2>
                <p id="andros-download-desc" className="mt-0.5 text-xs leading-snug text-andros-muted">
                  Andros te pide permiso antes de guardar cualquier archivo en tu equipo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => declineDownload(current.id)}
                disabled={starting}
                aria-label="Cancelar descarga"
                className="p-1.5 -mr-1.5 -mt-1 rounded-lg text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Ficha del archivo */}
            <div className="rounded-xl border border-andros-border bg-andros-canvas p-3.5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 shrink-0 rounded-lg bg-andros-card border border-andros-border text-andros-primary flex items-center justify-center">
                  <FileGlyph extension={current.extension} className="w-4.5 h-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-semibold text-andros-primary break-all leading-snug">
                    {current.filename}
                  </p>
                  {current.description && (
                    <p className="mt-1 text-xs leading-snug text-andros-muted">{current.description}</p>
                  )}
                </div>
              </div>

              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-andros-muted">Tipo</dt>
                <dd className="text-andros-primary text-right truncate">{current.typeLabel}</dd>
                <dt className="text-andros-muted">Peso</dt>
                <dd className="text-andros-primary text-right font-mono">{sizeText}</dd>
                <dt className="text-andros-muted">Origen</dt>
                <dd className="text-andros-primary text-right truncate">{current.origin}</dd>
              </dl>
            </div>

            {/* Nota de seguridad / destino */}
            <p className="flex items-start gap-2 text-[11px] leading-snug text-andros-muted">
              {isDesktop ? (
                <FolderDown className="w-3.5 h-3.5 mt-px shrink-0 text-andros-success" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0 text-andros-success" />
              )}
              <span>
                {isDesktop
                  ? "Después elegirás la carpeta en el diálogo «Guardar como…» de Windows."
                  : "Nada se guarda hasta que pulses «Permitir y descargar»."}
              </span>
            </p>

            {queue.length > 1 && (
              <p className="text-[11px] font-mono text-andros-muted">
                {queue.length - 1} descarga(s) más en espera de permiso.
              </p>
            )}

            {/* Acciones */}
            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={() => declineDownload(current.id)}
                disabled={starting}
                className="sm:flex-1 min-h-[44px] px-4 rounded-xl border border-andros-border-active text-andros-primary text-sm font-semibold hover:border-andros-accent active:scale-[0.98] spring-micro disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                ref={allowRef}
                type="button"
                onClick={() => approveDownload(current.id)}
                disabled={starting}
                className="sm:flex-[1.4] min-h-[44px] px-4 rounded-xl bg-andros-accent-fill text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] spring-micro disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-andros-accent"
              >
                {starting ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{starting ? "Preparando descarga…" : "Permitir y descargar"}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
