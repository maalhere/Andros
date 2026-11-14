// ============================================================================
// ANDROS — CLIENTE DE SUPABASE PARA EL NAVEGADOR
//
// Seguro por diseño: si `.env.local` todavía no tiene las claves, NO lanza
// errores. `getSupabaseBrowserClient()` devuelve `null` y la app sigue
// funcionando en modo local.
// ============================================================================

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Nombre del bucket de Storage donde viven los archivos de los `file-node`. */
export const PRINT_FILES_BUCKET = "print-files";

// Next.js solo incrusta en el navegador las variables escritas literalmente.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const SUPABASE_ANON_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  ""
).trim();

function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** `true` solo si `.env.local` tiene una URL y una clave válidas. */
export const isSupabaseConfigured =
  looksLikeUrl(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;

/** Lee las claves para usarlas en el servidor (ruta /auth/callback). */
export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  return isSupabaseConfigured ? { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } : null;
}

let browserClient: SupabaseClient | null = null;

/**
 * Cliente único del navegador. Devuelve `null` si faltan las claves o si se
 * llama desde el servidor, para que nadie tenga que envolverlo en try/catch.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured || typeof window === "undefined") return null;
  if (!browserClient) {
    try {
      browserClient = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (error) {
      console.warn("[Andros] No se pudo iniciar Supabase. Modo local activo.", error);
      return null;
    }
  }
  return browserClient;
}
