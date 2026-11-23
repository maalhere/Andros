"use client";

import { useState } from "react";

/**
 * `true` desde la primera vez que `open` vale `true` (y para siempre).
 * Sirve para descargar un panel pesado con `next/dynamic` SOLO cuando se abre
 * por primera vez y, a partir de ahí, dejarlo montado para que conserve sus
 * animaciones de salida.
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  // Actualización durante el render (patrón oficial de React para derivar
  // estado de una prop): no provoca un render extra ni un efecto.
  if (open && !opened) setOpened(true);
  return opened || open;
}
