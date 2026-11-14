// ============================================================================
// ANDROS — RETORNO DE GOOGLE OAUTH
//
// Google → Supabase → esta ruta con `?code=...`. Aquí se canjea el código por
// una sesión (cookies) y se devuelve al usuario al lienzo.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/supabase/client";

/** Solo permite volver a rutas internas (evita redirecciones a otros sitios). */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  return raw;
}

function redirectWithError(origin: string, message: string): NextResponse {
  const target = new URL("/", origin);
  target.searchParams.set("auth_error", message);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextPath = safeNextPath(searchParams.get("next"));

  // Error devuelto por Google o Supabase (ej. el usuario canceló).
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return redirectWithError(origin, providerError);
  }

  const env = getSupabaseEnv();
  if (!env || !code) {
    // Sin claves o sin código: se vuelve al lienzo en modo local, sin pantallas de error.
    return NextResponse.redirect(new URL(nextPath, origin));
  }

  const response = NextResponse.redirect(new URL(nextPath, origin));

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value)
        );
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectWithError(origin, "No se pudo completar el inicio de sesión con Google.");
  }

  return response;
}
