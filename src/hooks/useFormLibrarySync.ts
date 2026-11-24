"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import {
  libraryDocument,
  mergeLibraryDocuments,
  parseLibraryDocument,
  useFormsLibraryStore,
  type FormLibraryDocument,
} from "@/store/useFormsLibraryStore";
import { BUILT_IN_TEMPLATES } from "@/lib/forms/formSchema";

// ============================================================================
// ANDROS — PERSISTENCIA DE LA LIBRERÍA DE FICHAS
//   1. localStorage `andros_form_library` (siempre; funciona sin cuenta).
//   2. Con sesión: Supabase `profiles.form_library` (JSONB). Al entrar se
//      fusionan ambas copias (gana la edición más reciente) y se sube el
//      resultado. Si la columna aún no existe (no se ejecutó schema.sql), la
//      librería sigue funcionando con la copia local, sin errores visibles.
// Llamar una sola vez en `page.tsx`.
// ============================================================================

export const FORM_LIBRARY_STORAGE_KEY = "andros_form_library";
const REMOTE_DEBOUNCE_MS = 1500;

/** Columna inexistente (42703) o fuera de la caché de PostgREST (PGRST204). */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /form_library/.test(error.message ?? "");
}

function readLocal(): FormLibraryDocument | null {
  try {
    const raw = window.localStorage.getItem(FORM_LIBRARY_STORAGE_KEY);
    return raw ? parseLibraryDocument(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveLocal(): void {
  try {
    window.localStorage.setItem(FORM_LIBRARY_STORAGE_KEY, JSON.stringify(libraryDocument()));
  } catch {
    // Sin espacio o sin acceso a localStorage: se sigue en memoria.
  }
}

export function useFormLibrarySync() {
  useEffect(() => {
    const store = useFormsLibraryStore;
    let suppress = false;
    let userId: string | null = null;
    let remoteReady = false;
    let remoteTimer: ReturnType<typeof setTimeout> | null = null;

    // 1. Copia local (o los 4 formatos iniciales la primera vez).
    suppress = true;
    store.getState().hydrate(readLocal() ?? { version: 1, templates: BUILT_IN_TEMPLATES, deleted: {} });
    suppress = false;

    const pushRemote = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !userId || !remoteReady) return;
      const { error } = await supabase
        .from("profiles")
        .update({ form_library: libraryDocument() })
        .eq("id", userId);
      if (isMissingColumn(error)) {
        remoteReady = false;
        store.getState().setCloudStatus("setup");
        return;
      }
      if (error) console.warn("[Andros] No se pudo guardar la librería de fichas en la nube:", error.message);
      else store.getState().setCloudStatus("synced");
    };

    const unsubTemplates = store.subscribe((state, prev) => {
      if (state.templates === prev.templates && state.deleted === prev.deleted) return;
      if (suppress) return;
      saveLocal();
      if (userId && remoteReady) {
        if (remoteTimer) clearTimeout(remoteTimer);
        remoteTimer = setTimeout(() => void pushRemote(), REMOTE_DEBOUNCE_MS);
      }
    });

    // 2. Nube: se fusiona con la copia local y se sube el resultado.
    const loadRemote = async (uid: string) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data, error } = await supabase.from("profiles").select("form_library").eq("id", uid).maybeSingle();
      if (userId !== uid) return;
      if (isMissingColumn(error)) {
        store.getState().setCloudStatus("setup");
        return;
      }
      if (error) {
        console.warn("[Andros] No se pudo leer la librería de fichas de la nube:", error.message);
        return;
      }
      const remote = parseLibraryDocument((data as { form_library?: unknown } | null)?.form_library);
      const merged = remote ? mergeLibraryDocuments(remote, libraryDocument()) : libraryDocument();
      suppress = true;
      store.getState().hydrate(merged);
      suppress = false;
      saveLocal();
      remoteReady = true;
      void pushRemote();
    };

    const handleUser = (id: string | null) => {
      if (id === userId) return;
      userId = id;
      remoteReady = false;
      store.getState().setCloudStatus("local");
      if (id) void loadRemote(id);
    };
    handleUser(useCloudStore.getState().user?.id ?? null);
    const unsubCloud = useCloudStore.subscribe((state) => handleUser(state.user?.id ?? null));

    return () => {
      if (remoteTimer) clearTimeout(remoteTimer);
      unsubTemplates();
      unsubCloud();
    };
  }, []);
}
