import type { MetadataRoute } from "next";

// ============================================================================
// ANDROS — MANIFIESTO PWA
// Permite instalar Andros como app (Chrome/Edge/Windows/macOS/Android/iOS).
// ============================================================================

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Andros — Engineering Canvas",
    short_name: "Andros",
    description:
      "Lienzo de ingeniería e investigación: nodos, notas, modelos 3D y proyectos portables.",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0D0E11",
    theme_color: "#0D0E11",
    categories: ["productivity", "utilities", "education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
