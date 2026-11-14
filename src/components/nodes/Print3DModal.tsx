"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Download,
  ExternalLink,
  Feather,
  Gem,
  Printer,
  ShieldCheck,
  X,
} from "lucide-react";
import { getCloudFileLink } from "@/hooks/useCloudSync";
import { useCloudStore } from "@/store/useCloudStore";
import { formatMm, type ModelDimensions } from "@/components/nodes/Model3DPreview";

// ============================================================================
// ASISTENTE GUIADO DE IMPRESIÓN 3D
// Pensado para alguien que nunca ha usado una impresora 3D: 3 pasos, sin jerga.
//   1. Elegir el tipo de pieza  →  la configuración se recomienda sola.
//   2. Abrir el archivo en el programa de la impresora (o descargarlo).
//   3. Imprimir / guardar en PDF una hoja de control.
// La pieza nunca se modifica: sus medidas son solo informativas.
// ============================================================================

const PRINTABLE_EXTENSIONS = ["stl", "obj", "3mf", "step", "stp", "gcode"];

export function isPrintable3D(extension: string): boolean {
  return PRINTABLE_EXTENSIONS.includes(extension.toLowerCase());
}

type ProfileId = "prototype" | "strong" | "detail";

interface PrintProfile {
  id: ProfileId;
  title: string;
  everyday: string;
  icon: React.ReactNode;
  settings: { label: string; value: string }[];
}

const PROFILES: PrintProfile[] = [
  {
    id: "prototype",
    title: "Prototipo Rápido / Adorno",
    everyday: "Figuras, maquetas y pruebas. Sale rápido y gasta poco material.",
    icon: <Feather className="w-5 h-5" />,
    settings: [
      { label: "Material", value: "Plástico PLA estándar" },
      { label: "Relleno interior", value: "Ligero · 15 %" },
      { label: "Altura de capa", value: "0.20 mm (estándar)" },
      { label: "Acabado", value: "Rápido" },
    ],
  },
  {
    id: "strong",
    title: "Pieza Resistente / Uso Diario",
    everyday: "Soportes, ganchos y repuestos que van a aguantar peso o uso.",
    icon: <ShieldCheck className="w-5 h-5" />,
    settings: [
      { label: "Material", value: "PETG o PLA+" },
      { label: "Relleno interior", value: "Medio · 40 %" },
      { label: "Altura de capa", value: "0.20 mm (estándar)" },
      { label: "Acabado", value: "Mayor firmeza" },
    ],
  },
  {
    id: "detail",
    title: "Alta Precisión / Detalle Fino",
    everyday: "Miniaturas y piezas que deben encajar o verse muy lisas. Tarda más.",
    icon: <Gem className="w-5 h-5" />,
    settings: [
      { label: "Material", value: "Plástico PLA estándar" },
      { label: "Altura de capa", value: "Capas finas · 0.12 mm" },
      { label: "Velocidad", value: "Suave (lenta)" },
      { label: "Acabado", value: "Detalle fino" },
    ],
  },
];

type SlicerId = "bambu" | "prusa" | "cura";

const SLICERS: { id: SlicerId; name: string; scheme: string }[] = [
  { id: "bambu", name: "Bambu Studio", scheme: "bambustudio://open?file=" },
  { id: "prusa", name: "PrusaSlicer", scheme: "prusaslicer://open?file=" },
  { id: "cura", name: "Cura", scheme: "cura://open?file=" },
];

const SLICER_STORAGE_KEY = "andros-print-program";

function readSavedSlicer(): SlicerId {
  try {
    const saved = window.localStorage.getItem(SLICER_STORAGE_KEY);
    if (saved === "bambu" || saved === "prusa" || saved === "cura") return saved;
  } catch {
    // Sin acceso a localStorage: se usa el valor por defecto.
  }
  return "bambu";
}

interface Print3DModalProps {
  /** Nombre que el usuario le dio a la pieza (título del nodo). */
  pieceName: string;
  fileName: string;
  extension: string;
  downloadUrl: string;
  storagePath?: string;
  dimensions: ModelDimensions | null;
  onClose: () => void;
}

function StepHeader({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 w-7 h-7 rounded-full bg-andros-accent text-white text-sm font-semibold flex items-center justify-center">
        {number}
      </span>
      <h3 className="text-sm font-semibold text-andros-primary">{title}</h3>
    </div>
  );
}

export const Print3DModal: React.FC<Print3DModalProps> = ({
  pieceName,
  fileName,
  extension,
  downloadUrl,
  storagePath,
  dimensions,
  onClose,
}) => {
  const isSignedIn = useCloudStore((s) => s.user !== null);

  const [profileId, setProfileId] = useState<ProfileId | null>(null);
  const [slicerId, setSlicerId] = useState<SlicerId>(readSavedSlicer);
  const [cloudLink, setCloudLink] = useState<string | null>(
    /^https?:/.test(downloadUrl) ? downloadUrl : null
  );
  const [openHint, setOpenHint] = useState<"none" | "tried" | "needs-cloud">("none");

  const profile = PROFILES.find((p) => p.id === profileId) ?? null;
  const slicer = SLICERS.find((s) => s.id === slicerId) ?? SLICERS[0];
  const isGcode = extension.toLowerCase() === "gcode";

  // Enlace temporal de la nube: es lo que el programa de impresión puede abrir.
  useEffect(() => {
    if (!storagePath || !isSignedIn) return;
    let cancelled = false;
    void getCloudFileLink(storagePath).then((link) => {
      if (!cancelled && link) setCloudLink(link);
    });
    return () => {
      cancelled = true;
    };
  }, [storagePath, isSignedIn]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const chooseSlicer = (id: SlicerId) => {
    setSlicerId(id);
    setOpenHint("none");
    try {
      window.localStorage.setItem(SLICER_STORAGE_KEY, id);
    } catch {
      // No pasa nada si no se puede recordar la elección.
    }
  };

  const openInSlicer = () => {
    if (!cloudLink) {
      setOpenHint("needs-cloud");
      return;
    }
    setOpenHint("tried");
    window.location.href = `${slicer.scheme}${encodeURIComponent(cloudLink)}`;
  };

  const dimensionsText = dimensions
    ? `${formatMm(dimensions.widthMm)} × ${formatMm(dimensions.depthMm)} × ${formatMm(dimensions.heightMm)} mm`
    : "No disponibles para este tipo de archivo";

  const today = new Date().toLocaleDateString("es", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lockedStep = profile ? "" : "opacity-45 pointer-events-none select-none";

  return createPortal(
    <>
      {/* ------------------------------------------------------------------
          VENTANA DEL ASISTENTE
          ------------------------------------------------------------------ */}
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        // La ventana vive fuera del nodo: sus toques no deben arrastrarlo.
        onPointerDown={(e) => e.stopPropagation()}
        onDragOver={(e) => e.stopPropagation()}
        onDrop={(e) => e.stopPropagation()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Imprimir en 3D"
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark"
        >
          {/* Cabecera */}
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 pt-5 pb-4 bg-andros-card border-b border-andros-border">
            <div className="flex items-start gap-3 min-w-0">
              <div className="shrink-0 p-2 rounded-xl bg-andros-accent/10 text-andros-accent">
                <Printer className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-andros-primary">Imprimir en 3D</h2>
                <p className="text-xs text-andros-muted truncate" title={fileName}>
                  {fileName}
                  {dimensions ? ` · ${dimensionsText}` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="shrink-0 min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-5 py-5 space-y-7">
            {/* ---------------- PASO 1 ---------------- */}
            <section className="space-y-3">
              <StepHeader number={1} title="¿Qué tipo de pieza quieres?" />
              <div className="space-y-2">
                {PROFILES.map((option) => {
                  const selected = option.id === profileId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setProfileId(option.id)}
                      className={`w-full text-left px-4 py-3.5 rounded-2xl border flex items-center gap-3.5 active:scale-[0.99] spring-micro ${
                        selected
                          ? "border-andros-accent bg-andros-accent/10 ring-1 ring-andros-accent/40"
                          : "border-andros-border-active bg-andros-canvas hover:border-andros-accent"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${
                          selected
                            ? "bg-andros-accent text-white"
                            : "bg-andros-accent/10 text-andros-accent"
                        }`}
                      >
                        {selected ? <Check className="w-5 h-5" /> : option.icon}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-andros-primary">
                          {option.title}
                        </span>
                        <span className="block mt-0.5 text-xs leading-relaxed text-andros-muted">
                          {option.everyday}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {profile && (
                <div className="rounded-2xl border border-andros-border bg-andros-canvas px-4 py-3">
                  <p className="text-xs font-semibold text-andros-primary">
                    Te recomendamos esta configuración:
                  </p>
                  <dl className="mt-2 space-y-1.5 text-xs">
                    {profile.settings.map((setting) => (
                      <div key={setting.label} className="flex justify-between gap-3">
                        <dt className="text-andros-muted">{setting.label}</dt>
                        <dd className="text-andros-primary font-medium text-right">
                          {setting.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-[11px] leading-relaxed text-andros-muted">
                    {isGcode
                      ? "Tu archivo ya viene preparado para una impresora (G-code), así que estos valores son solo de referencia."
                      : "Elige estos mismos valores en tu programa de impresión. El tamaño de la pieza no cambia."}
                  </p>
                </div>
              )}
            </section>

            {/* ---------------- PASO 2 ---------------- */}
            <section className={`space-y-3 ${lockedStep}`} aria-disabled={!profile}>
              <StepHeader number={2} title="Llévalo a tu impresora" />

              <div className="space-y-2">
                <p className="text-xs text-andros-muted">¿Qué programa usa tu impresora?</p>
                <div className="grid grid-cols-3 gap-2">
                  {SLICERS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={option.id === slicerId}
                      onClick={() => chooseSlicer(option.id)}
                      className={`min-h-[40px] px-2 rounded-xl border text-xs font-medium spring-micro active:scale-95 ${
                        option.id === slicerId
                          ? "border-andros-accent bg-andros-accent/10 text-andros-primary"
                          : "border-andros-border-active text-andros-muted hover:border-andros-accent"
                      }`}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={openInSlicer}
                className="w-full min-h-[48px] px-4 rounded-2xl bg-andros-accent text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] spring-micro"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Abrir en mi programa de impresión</span>
              </button>

              {openHint === "tried" && (
                <p className="text-xs leading-relaxed text-andros-muted" role="status">
                  Si tu navegador pregunta, acepta abrir {slicer.name}. ¿No pasó nada? Puede que
                  el programa no esté instalado en este equipo o no acepte abrir archivos desde
                  la web: usa el botón de descarga de aquí abajo.
                </p>
              )}
              {openHint === "needs-cloud" && (
                <p className="text-xs leading-relaxed text-andros-muted" role="status">
                  {isSignedIn
                    ? "El archivo todavía se está guardando en tu nube. Espera unos segundos y vuelve a intentarlo, o usa el botón de descarga."
                    : "Para abrirlo directamente, primero inicia sesión con Google (arriba) para guardar el archivo en tu nube. Mientras tanto, usa el botón de descarga."}
                </p>
              )}

              <a
                href={downloadUrl}
                download={fileName}
                className="w-full min-h-[48px] px-4 rounded-2xl border border-andros-border-active bg-andros-canvas text-andros-primary text-sm font-semibold flex items-center justify-center gap-2 hover:border-andros-accent active:scale-[0.98] spring-micro"
              >
                <Download className="w-4 h-4 text-andros-accent" />
                <span>Descargar archivo listo para imprimir</span>
              </a>

              <ol className="rounded-2xl bg-andros-canvas border border-andros-border px-4 py-3 space-y-1.5 text-xs leading-relaxed text-andros-primary">
                <li>
                  <span className="font-semibold">1.</span> Descarga el archivo.
                </li>
                <li>
                  <span className="font-semibold">2.</span> Arrástralo a tu programa de impresora
                  (Cura / Bambu Studio / PrusaSlicer) y dale a <strong>Imprimir</strong>.
                </li>
              </ol>
            </section>

            {/* ---------------- PASO 3 ---------------- */}
            <section className={`space-y-3 ${lockedStep}`} aria-disabled={!profile}>
              <StepHeader number={3} title="Hoja de control (opcional)" />
              <p className="text-xs leading-relaxed text-andros-muted">
                Una ficha de una página con el nombre de la pieza, sus medidas y la
                configuración que elegiste, para tenerla junto a la impresora.
              </p>
              <button
                type="button"
                onClick={() => window.print()}
                className="w-full min-h-[44px] px-4 rounded-2xl border border-andros-border-active text-andros-primary text-sm font-medium flex items-center justify-center gap-2 hover:border-andros-accent active:scale-[0.98] spring-micro"
              >
                <Printer className="w-4 h-4 text-andros-accent" />
                <span>Imprimir o guardar en PDF la hoja de control</span>
              </button>
            </section>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------
          HOJA DE CONTROL — solo visible al imprimir (ver globals.css)
          ------------------------------------------------------------------ */}
      {profile && (
        <div className="andros-print-sheet">
          <header className="aps-header">
            <div>
              <p className="aps-brand">ANDROS · Hoja de control de impresión 3D</p>
              <h1>{pieceName || fileName}</h1>
            </div>
            <p className="aps-date">{today}</p>
          </header>

          <h2>Pieza</h2>
          <table>
            <tbody>
              <tr>
                <th>Nombre de la pieza</th>
                <td>{pieceName || fileName}</td>
              </tr>
              <tr>
                <th>Archivo</th>
                <td>{fileName}</td>
              </tr>
              <tr>
                <th>Dimensiones (Ancho × Profundidad × Alto)</th>
                <td>{dimensionsText}</td>
              </tr>
            </tbody>
          </table>

          <h2>Configuración sugerida — {profile.title}</h2>
          <table>
            <tbody>
              {profile.settings.map((setting) => (
                <tr key={setting.label}>
                  <th>{setting.label}</th>
                  <td>{setting.value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Antes de imprimir</h2>
          <ul className="aps-checklist">
            <li>Material cargado en la impresora</li>
            <li>Base de impresión limpia y despejada</li>
            <li>Configuración de arriba elegida en el programa</li>
            <li>Primera capa revisada (se pega bien a la base)</li>
          </ul>

          <h2>Notas</h2>
          <div className="aps-notes" />

          <p className="aps-footer">
            Las dimensiones son las reales del archivo y no se modifican en Andros.
          </p>
        </div>
      )}
    </>,
    document.body
  );
};
