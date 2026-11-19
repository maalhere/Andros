import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AiProvider } from "@/types/workspace";
import { AI_DEFAULT_MODELS } from "@/lib/ai/providers";

// ============================================================================
// ANDROS — CLAVES DE IA PROPIAS (BYOK)
//
// Las claves del usuario para Gemini, Claude y ChatGPT se guardan SOLO en este
// navegador (localStorage), nunca en Supabase ni en el repositorio. Viajan a
// /api/ai/node-chat únicamente en la petición que las usa, y el servidor no
// las guarda ni las registra. Sin clave propia, Gemini usa la clave del servidor.
// ============================================================================

interface AiProvidersState {
  keys: Partial<Record<AiProvider, string>>;
  /** Modelo por defecto de cada proveedor para los Nodos IA nuevos. */
  defaultModels: Record<AiProvider, string>;
  isKeysModalOpen: boolean;
  setKey: (provider: AiProvider, key: string) => void;
  clearKey: (provider: AiProvider) => void;
  setDefaultModel: (provider: AiProvider, model: string) => void;
  setKeysModalOpen: (open: boolean) => void;
}

export const useAiProvidersStore = create<AiProvidersState>()(
  persist(
    (set) => ({
      keys: {},
      defaultModels: { ...AI_DEFAULT_MODELS },
      isKeysModalOpen: false,
      setKey: (provider, key) =>
        set((state) => ({ keys: { ...state.keys, [provider]: key.trim() } })),
      clearKey: (provider) =>
        set((state) => {
          const keys = { ...state.keys };
          delete keys[provider];
          return { keys };
        }),
      setDefaultModel: (provider, model) =>
        set((state) => ({
          // Se guarda tal cual mientras se escribe; vacío → por defecto al salir del campo.
          defaultModels: { ...state.defaultModels, [provider]: model },
        })),
      setKeysModalOpen: (isKeysModalOpen) => set({ isKeysModalOpen }),
    }),
    {
      name: "andros-ai-providers",
      storage: createJSONStorage(() => window.localStorage),
      // El estado del modal no se guarda: solo claves y modelos.
      partialize: (state) => ({ keys: state.keys, defaultModels: state.defaultModels }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AiProvidersState>;
        return {
          ...current,
          keys: p.keys ?? {},
          defaultModels: { ...AI_DEFAULT_MODELS, ...(p.defaultModels ?? {}) },
        };
      },
    }
  )
);

/** Clave propia del usuario para un proveedor (o `undefined`). */
export function getUserAiKey(provider: AiProvider): string | undefined {
  const key = useAiProvidersStore.getState().keys[provider];
  return key && key.trim() ? key.trim() : undefined;
}
