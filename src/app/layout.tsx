import type { Metadata } from "next";
import {
  Inter,
  JetBrains_Mono,
  Playfair_Display,
  Space_Grotesk,
  Syne,
  Instrument_Serif,
  Bebas_Neue,
  Cormorant_Garamond,
} from "next/font/google";
import "./globals.css";

// ============================================================================
// TIPOGRAFÍAS — Todas se descargan en el build y se sirven desde Andros
// (sin peticiones a Google en el navegador). Las 6 últimas alimentan el
// logo generativo mutante de la Landing (MutantAndrosLogo).
// ============================================================================

const inter = Inter({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-mono",
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas",
  display: "swap",
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const fontVariables = [
  inter.variable,
  jetbrainsMono.variable,
  playfairDisplay.variable,
  spaceGrotesk.variable,
  syne.variable,
  instrumentSerif.variable,
  bebasNeue.variable,
  cormorantGaramond.variable,
].join(" ");

export const metadata: Metadata = {
  title: "Andros — Engineering Canvas & Research Workspace",
  description:
    "Plataforma colaborativa de ingeniería e investigación con arquitectura Dual-Engine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`dark ${fontVariables}`} suppressHydrationWarning>
      <body className="bg-andros-canvas text-andros-primary font-sans antialiased selection:bg-andros-accent/20">
        {children}
      </body>
    </html>
  );
}
