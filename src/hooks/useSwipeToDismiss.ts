"use client";

import { useDragControls, type PanInfo } from "framer-motion";
import type React from "react";

// ============================================================================
// ANDROS — DESLIZAR HACIA ABAJO PARA CERRAR (hojas inferiores en el teléfono)
// El arrastre empieza solo desde el asa/cabecera (`handleProps`) para no
// pelear con el scroll del contenido. Cierra si se arrastra > 96 px o con un
// gesto rápido (> 520 px/s); si no, el resorte la devuelve a su sitio.
// ============================================================================

const DISTANCE_PX = 96;
const VELOCITY_PX_S = 520;

export function useSwipeToDismiss(onDismiss: () => void, enabled = true) {
  const controls = useDragControls();

  const sheetProps = enabled
    ? {
        drag: "y" as const,
        dragControls: controls,
        dragListener: false,
        dragConstraints: { top: 0, bottom: 0 },
        dragElastic: { top: 0, bottom: 0.7 },
        dragSnapToOrigin: true,
        onDragEnd: (_: unknown, info: PanInfo) => {
          if (info.offset.y > DISTANCE_PX || info.velocity.y > VELOCITY_PX_S) onDismiss();
        },
      }
    : {};

  const handleProps = enabled
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          // Los botones de la cabecera (cerrar, etc.) siguen funcionando normal.
          if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
          controls.start(e);
        },
        style: { touchAction: "none" as const },
      }
    : {};

  return { sheetProps, handleProps };
}
