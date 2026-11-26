import type { NextConfig } from "next";

/**
 * (Sprint 17B) Cabeceras básicas de seguridad para todas las rutas.
 *   · nosniff: el navegador respeta el Content-Type (sin «adivinar» scripts).
 *   · strict-origin-when-cross-origin: a otros sitios solo viaja el origen
 *     (los vídeos de YouTube incrustados lo siguen recibiendo).
 *   · SAMEORIGIN: ninguna web ajena puede incrustar Andros (clickjacking).
 *     No afecta al login con Google (es una redirección de página completa)
 *     ni a la app de Windows (carga la web como vista principal, sin iframe).
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
