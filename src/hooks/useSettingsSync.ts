"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCloudStore } from "@/store/useCloudStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import {
  DEFAULT_PREFERENCES,
  sanitizePreferences,
  useSettingsStore,
  type Preferences,
} from "@/store/useSettingsStore";

// ============================================================================
// ANDROS — PERSISTENCIA DE AJUSTES (localStorage + Supabase `profiles.preferences`)
// Llamar una sola vez en `page.tsx`.
// ============================================================================

const STORAGE_KEY = "andros:preferences:v1";
const REMOTE_DEBOUNCE_MS = 1500;

export function collectPreferences(): Preferences {
  const s = useSettingsStore.getState();
  return {
    theme: useWorkspaceStore.getState().theme,
    snapToGrid: s.snapToGrid,
    cableStyle: s.cableStyle,
    canvasBackground: s.canvasBackground,
    animations: s.animations,
    autosave: s.autosave,
    experienceMode: s.experienceMode,
    onboardingDone: s.onboardingDone,
  };
}

function applyAll(prefs: Partial<Preferences>) {
  useSettingsStore.getState().applyPreferences(prefs);
  if (prefs.theme && prefs.theme !== useWorkspaceStore.getState().theme) {
    useWorkspaceStore.getState().setTheme(prefs.theme);
  }
}

export function useSettingsSync() {
  useEffect(() => {
    let suppress = false; // true mientras se aplican ajustes que ya están guardados
    let remoteTimer: ReturnType<typeof setTimeout> | null = null;
    let userId: string | null = null;
    let remoteReady = false; // no se sube nada hasta haber leído lo guardado en la nube

    // 1. Cargar lo guardado en este navegador.
    suppress = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = sanitizePreferences(raw ? JSON.parse(raw) : null);
      // Quien ya usaba Andros antes del Modo Simple conserva todas sus herramientas.
      if (raw && !stored.experienceMode) stored.experienceMode = "expert";
      applyAll({ ...DEFAULT_PREFERENCES, ...stored });
    } catch {
      applyAll(DEFAULT_PREFERENCES);
    }
    suppress = false;

    const syncMotionAttribute = () => {
      document.documentElement.dataset.motion = useSettingsStore.getState().animations;
    };
    syncMotionAttribute();

    const saveLocal = () => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(collectPreferences()));
      } catch {
        // Sin acceso a localStorage: se sigue funcionando sin guardar.
      }
    };

    const pushRemote = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !userId || !remoteReady) return;
      const { error } = await supabase
        .from("profiles")
        .update({ preferences: collectPreferences() })
        .eq("id", userId);
      if (error) console.warn("[Andros] No se pudieron guardar los ajustes en la nube:", error.message);
    };

    const onChange = () => {
      syncMotionAttribute();
      if (suppress) return;
      saveLocal();
      if (userId && remoteReady) {
        if (remoteTimer) clearTimeout(remoteTimer);
        remoteTimer = setTimeout(() => void pushRemote(), REMOTE_DEBOUNCE_MS);
      }
    };

    const unsubSettings = useSettingsStore.subscribe(onChange);
    const unsubTheme = useWorkspaceStore.subscribe((state, prev) => {
      if (state.theme !== prev.theme) onChange();
    });

    // 2. Al iniciar sesión: los ajustes de la nube mandan; si no hay, se suben los locales.
    const loadRemote = async (uid: string) => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", uid)
        .maybeSingle();
      if (userId !== uid) return;
      if (error) {
        console.warn("[Andros] No se pudieron leer los ajustes de la nube:", error.message);
        return;
      }
      const remote = sanitizePreferences(data?.preferences);
      remoteReady = true;
      if (Object.keys(remote).length > 0) {
        suppress = true;
        applyAll(remote);
        suppress = false;
        saveLocal();
        syncMotionAttribute();
      } else {
        void pushRemote();
      }
    };

    const handleUser = (id: string | null) => {
      if (id === userId) return;
      userId = id;
      remoteReady = false;
      if (id) void loadRemote(id);
    };
    handleUser(useCloudStore.getState().user?.id ?? null);
    const unsubCloud = useCloudStore.subscribe((state) => handleUser(state.user?.id ?? null));

    return () => {
      if (remoteTimer) clearTimeout(remoteTimer);
      unsubSettings();
      unsubTheme();
      unsubCloud();
    };
  }, []);
}
