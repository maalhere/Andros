// ============================================================================
// ANDROS — SUPABASE EN EL SERVIDOR (solo rutas /api, nunca en el navegador)
//
//   · `getRequestUser`: identifica a quien llama con SU sesión (Bearer del
//     cliente o, si no viene, las cookies de @supabase/ssr). Todo lo que lea
//     con ese cliente sigue pasando por la RLS de esa persona.
//   · `getServiceClient`: cliente con `SUPABASE_SERVICE_ROLE_KEY` (variable
//     SOLO de servidor, sin NEXT_PUBLIC_). Se usa únicamente para leer el
//     correo del destinatario de un aviso, después de comprobar los permisos
//     con la sesión del solicitante. Si no está configurada devuelve `null`.
// ============================================================================

import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./client";

export interface RequestUser {
  /** Cliente con la sesión de quien llama (RLS activa). */
  supabase: SupabaseClient;
  userId: string;
}

const NO_PERSIST = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/** Usuario autenticado de la petición, o `null` si no hay sesión válida. */
export async function getRequestUser(request: NextRequest): Promise<RequestUser | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+([\w.-]{20,4096})$/i)?.[1];
  if (bearer) {
    const supabase = createClient(env.url, env.anonKey, {
      auth: NO_PERSIST,
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    // `getUser` valida el JWT contra Supabase Auth (no basta con decodificarlo).
    const { data, error } = await supabase.auth.getUser(bearer);
    if (error || !data.user) return null;
    return { supabase, userId: data.user.id };
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      // Esta ruta no renueva la sesión: la cookie la mantiene el navegador.
      setAll: () => undefined,
    },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, userId: data.user.id };
}

/** Cliente de servicio (salta la RLS). `null` si falta la clave en el servidor. */
export function getServiceClient(): SupabaseClient | null {
  const env = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!env || serviceKey.length < 20) return null;
  return createClient(env.url, serviceKey, { auth: NO_PERSIST });
}

/** UUID v1–v8 (ids de espacios y usuarios). */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
