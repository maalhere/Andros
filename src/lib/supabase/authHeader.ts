// ============================================================================
// ANDROS — CABECERA `Authorization` CON TU SESIÓN (navegador)
// Para las rutas /api que exigen sesión (`getRequestUser`): vista previa de
// enlaces, IA con la clave del servidor, escáner de la Arena, avisos…
// Sin Supabase o sin sesión devuelve `{}` (la ruta responde lo que toque).
// ============================================================================

import { getSupabaseBrowserClient } from "./client";

export async function sessionAuthHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return {};
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
