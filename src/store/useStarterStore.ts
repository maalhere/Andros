import { create } from "zustand";

// ============================================================================
// ANDROS — ¿SE DESCARTÓ LA TARJETA DE ARRANQUE? («o empezar en blanco»)
// Vale para esta visita (sessionStorage), igual que la guía anterior. Lo
// comparten el lienzo de escritorio y la pila del teléfono.
// ============================================================================

const KEY = "andros:starter-dismissed:v1";

const read = (): boolean => {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

interface StarterState {
  dismissed: boolean;
  dismiss: () => void;
  reopen: () => void;
}

export const useStarterStore = create<StarterState>((set) => ({
  // En el servidor no hay `window`: `page.tsx` solo monta esto ya en el cliente.
  dismissed: typeof window === "undefined" ? false : read(),
  dismiss: () => {
    set({ dismissed: true });
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      // Sin storage: solo se oculta durante esta visita.
    }
  },
  reopen: () => {
    set({ dismissed: false });
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      // Nada que limpiar.
    }
  },
}));
