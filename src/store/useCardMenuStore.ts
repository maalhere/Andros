import { create } from "zustand";

// ============================================================================
// ANDROS — ESTADO DEL MENÚ CONTEXTUAL (ficha o fondo del lienzo)
// ============================================================================

export interface CardMenuRequest {
  /** Posición en pantalla donde se abre. */
  x: number;
  y: number;
  /** Ficha sobre la que actúa; `null` = fondo del lienzo (solo «Pegar»). */
  nodeId: string | null;
  /** Punto del lienzo donde pegar (menú del fondo). */
  pasteAt?: { x: number; y: number };
}

interface CardMenuState {
  menu: CardMenuRequest | null;
  openMenu: (menu: CardMenuRequest) => void;
  closeMenu: () => void;
}

export const useCardMenuStore = create<CardMenuState>((set) => ({
  menu: null,
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
}));
