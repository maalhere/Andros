import { create } from "zustand";

// ============================================================================
// ANDROS — AVISOS EFÍMEROS (toasts) con acción opcional «Deshacer»
// Una sola cola global: el Toaster los pinta y los retira al expirar.
// ============================================================================

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface Toast {
  id: string;
  message: string;
  tone: "neutral" | "success" | "error";
  action?: ToastAction;
  /** Se llama si el aviso expira o se cierra SIN pulsar la acción. */
  onExpire?: () => void;
  durationMs: number;
}

export type ToastInput = Omit<Toast, "id" | "tone" | "durationMs"> &
  Partial<Pick<Toast, "tone" | "durationMs">>;

interface ToastState {
  toasts: Toast[];
  show: (toast: ToastInput) => string;
  /** Cierra el aviso. `acted` = el usuario pulsó la acción (no se llama onExpire). */
  dismiss: (id: string, acted?: boolean) => void;
}

const MAX_VISIBLE = 3;
let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (input) => {
    const id = `toast-${Date.now()}-${++counter}`;
    const toast: Toast = {
      tone: "neutral",
      durationMs: input.action ? 7000 : 3500,
      ...input,
      id,
    };
    const overflow = get().toasts.slice(0, Math.max(0, get().toasts.length - (MAX_VISIBLE - 1)));
    overflow.forEach((t) => t.onExpire?.());
    set((state) => ({
      toasts: [...state.toasts.filter((t) => !overflow.includes(t)), toast],
    }));
    return id;
  },
  dismiss: (id, acted = false) => {
    const toast = get().toasts.find((t) => t.id === id);
    if (!toast) return;
    if (!acted) toast.onExpire?.();
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Atajo para mostrar un aviso desde cualquier sitio (fuera de React también). */
export const toast = (input: ToastInput) => useToastStore.getState().show(input);
