"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AppWindow,
  EllipsisVertical,
  Laptop,
  MonitorDown,
  Share,
  Smartphone,
  SquarePlus,
  X,
} from "lucide-react";
import { AndrosMark } from "@/components/brand/AndrosMark";
import type { InstallPlatform } from "@/hooks/useInstallPrompt";

// ============================================================================
// ANDROS — MODAL "INSTALAR APP" (cuando el navegador no ofrece el instalador
// nativo en 1 clic: iPhone/iPad, Safari, Firefox o si el usuario lo rechazó).
// Muestra 2 pasos ilustrados según el dispositivo detectado, con pestañas
// para ver los de otro dispositivo.
// ============================================================================

interface InstallStep {
  icon: React.ReactNode;
  title: React.ReactNode;
  detail: string;
}

interface DeviceGuide {
  label: string;
  icon: React.ReactNode;
  steps: [InstallStep, InstallStep];
  note?: string;
}

const KEY_CHIP =
  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-andros-border/60 text-andros-primary font-semibold";

const GUIDES: Record<"ios" | "android" | "desktop" | "mac-safari", DeviceGuide> = {
  ios: {
    label: "iPhone / iPad",
    icon: <Smartphone className="w-3.5 h-3.5" />,
    steps: [
      {
        icon: <Share className="w-6 h-6" />,
        title: (
          <>
            Pulsa <span className={KEY_CHIP}>Compartir <Share className="w-3 h-3" /></span>
          </>
        ),
        detail: "En Safari está en la barra inferior (iPhone) o arriba a la derecha (iPad).",
      },
      {
        icon: <SquarePlus className="w-6 h-6" />,
        title: (
          <>
            Elige <span className={KEY_CHIP}>Agregar a pantalla de inicio</span>
          </>
        ),
        detail: "Si no lo ves, desliza la lista hacia abajo. Confirma con “Agregar”.",
      },
    ],
    note: "En Chrome para iPhone, el botón Compartir está junto a la barra de direcciones.",
  },
  android: {
    label: "Android",
    icon: <Smartphone className="w-3.5 h-3.5" />,
    steps: [
      {
        icon: <EllipsisVertical className="w-6 h-6" />,
        title: (
          <>
            Abre el menú <span className={KEY_CHIP}>⋮</span> del navegador
          </>
        ),
        detail: "Arriba a la derecha en Chrome, Edge o Samsung Internet.",
      },
      {
        icon: <SquarePlus className="w-6 h-6" />,
        title: (
          <>
            Pulsa <span className={KEY_CHIP}>Instalar app</span>
          </>
        ),
        detail: "En algunos teléfonos aparece como “Agregar a pantalla principal”.",
      },
    ],
  },
  desktop: {
    label: "PC (Chrome / Edge)",
    icon: <Laptop className="w-3.5 h-3.5" />,
    steps: [
      {
        icon: <MonitorDown className="w-6 h-6" />,
        title: (
          <>
            Pulsa el icono de instalar <span className={KEY_CHIP}><MonitorDown className="w-3 h-3" /></span>
          </>
        ),
        detail: "Está a la derecha de la barra de direcciones, junto a la estrella de favoritos.",
      },
      {
        icon: <AppWindow className="w-6 h-6" />,
        title: (
          <>
            Confirma con <span className={KEY_CHIP}>Instalar</span>
          </>
        ),
        detail: "Andros se abrirá en su propia ventana y quedará en el menú Inicio o el Dock.",
      },
    ],
    note: "¿No ves el icono? Menú ⋮ → “Transmitir, guardar y compartir” → “Instalar página como app” (Chrome) o Menú ⋯ → “Aplicaciones” → “Instalar este sitio” (Edge).",
  },
  "mac-safari": {
    label: "Mac (Safari)",
    icon: <Laptop className="w-3.5 h-3.5" />,
    steps: [
      {
        icon: <Share className="w-6 h-6" />,
        title: (
          <>
            Menú <span className={KEY_CHIP}>Archivo</span> o botón Compartir
          </>
        ),
        detail: "En la barra de menús de Safari (macOS Sonoma o posterior).",
      },
      {
        icon: <AppWindow className="w-6 h-6" />,
        title: (
          <>
            Elige <span className={KEY_CHIP}>Agregar al Dock</span>
          </>
        ),
        detail: "Andros aparecerá en el Dock y se abrirá como una app independiente.",
      },
    ],
  },
};

type GuideId = keyof typeof GUIDES;

function guideFor(platform: InstallPlatform): GuideId {
  switch (platform) {
    case "ios":
      return "ios";
    case "android":
      return "android";
    case "mac-safari":
      return "mac-safari";
    default:
      return "desktop";
  }
}

interface InstallAppModalProps {
  open: boolean;
  platform: InstallPlatform;
  onClose: () => void;
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({ open, platform, onClose }) => {
  // Pestaña elegida a mano; si no, los pasos del dispositivo actual.
  const [pickedGuide, setPickedGuide] = useState<GuideId | null>(null);
  const guideId = pickedGuide ?? guideFor(platform);
  const setGuideId = setPickedGuide;

  const close = useCallback(() => {
    setPickedGuide(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  const guide = GUIDES[guideId];

  // Portal a <body>: así ninguna barra flotante (z-40/z-50) queda por encima.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="install-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs flex items-end md:items-center justify-center p-3 md:p-6"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl bg-andros-card border border-andros-border shadow-sheet-light dark:shadow-sheet-dark p-5 md:p-6"
          >
            {/* Encabezado */}
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 shrink-0 rounded-2xl bg-andros-canvas border border-andros-border flex items-center justify-center">
                <AndrosMark className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="install-title" className="text-base font-semibold text-andros-primary">
                  Instala Andros en 2 pasos
                </h2>
                <p className="text-xs text-andros-muted leading-relaxed">
                  Ábrelo desde tu pantalla de inicio como cualquier app, a pantalla completa.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className="min-w-[40px] min-h-[40px] -mr-2 -mt-2 rounded-xl flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-border/40 spring-micro"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selector de dispositivo */}
            <div className="mt-4 flex gap-1 p-1 rounded-xl bg-andros-canvas border border-andros-border overflow-x-auto no-scrollbar">
              {(Object.keys(GUIDES) as GuideId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGuideId(id)}
                  aria-pressed={guideId === id}
                  className={`flex-1 whitespace-nowrap flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium spring-micro ${
                    guideId === id
                      ? "bg-andros-card text-andros-primary shadow-sm"
                      : "text-andros-muted hover:text-andros-primary"
                  }`}
                >
                  {GUIDES[id].icon}
                  {GUIDES[id].label}
                </button>
              ))}
            </div>

            {platform === "firefox" && (
              <p className="mt-3 text-[11px] leading-relaxed text-andros-accent">
                Firefox de escritorio no instala apps web. Abre Andros en Chrome o Edge y sigue
                estos pasos.
              </p>
            )}

            {/* Los 2 pasos ilustrados */}
            <ol className="mt-4 space-y-2.5">
              {guide.steps.map((step, index) => (
                <li
                  key={index}
                  className="flex items-center gap-3.5 p-3 rounded-2xl bg-andros-canvas border border-andros-border"
                >
                  <div className="relative w-14 h-14 shrink-0 rounded-xl bg-andros-accent/10 text-andros-accent flex items-center justify-center">
                    {step.icon}
                    <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-andros-accent text-white text-[11px] font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] text-andros-primary leading-snug">{step.title}</p>
                    <p className="mt-1 text-[11px] text-andros-muted leading-relaxed">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>

            {guide.note && (
              <p className="mt-3 text-[11px] leading-relaxed text-andros-muted">{guide.note}</p>
            )}

            <button
              type="button"
              onClick={close}
              className="mt-5 w-full h-11 rounded-xl bg-andros-primary text-andros-canvas text-sm font-semibold hover:opacity-90 active:scale-[0.98] spring-micro"
            >
              Entendido
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
