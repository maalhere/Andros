import { ImageResponse } from "next/og";
import { SITE_TAGLINE } from "@/lib/site";

// ============================================================================
// ANDROS — IMAGEN PARA REDES (Open Graph / Twitter), generada en el build.
// Obsidian Monolith + doble chevrón oficial. Sin imágenes de terceros.
// ============================================================================

export const alt = "Andros — lienzo de ingeniería para piezas 3D, cálculos e investigación";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0D0E11",
          backgroundImage: "radial-gradient(#1F222A 1.5px, transparent 1.5px)",
          backgroundSize: "28px 28px",
          color: "#EDEDEF",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 32 32" fill="none">
            <polyline points="4.5,20.8 16,9.3 27.5,20.8" stroke="#EDEDEF" strokeWidth="5.5" strokeLinejoin="miter" />
            <polyline points="10.5,25.3 16,19.8 21.5,25.3" stroke="#C95A3B" strokeWidth="3.6" strokeLinejoin="miter" />
          </svg>
          <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>Andros</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2, maxWidth: 980 }}>
            {SITE_TAGLINE}
          </span>
          <span style={{ fontSize: 28, color: "#8B8D98" }}>
            Visor STL/3MF · Tinta a mano alzada · Fuentes citables · Oráculo IA
          </span>
        </div>
      </div>
    ),
    size
  );
}
