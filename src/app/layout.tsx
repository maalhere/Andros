import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/shared/PwaRegister";
import { DownloadPermissionModal } from "@/components/modals/DownloadPermissionModal";
import { CookieBanner } from "@/components/legal/CookieBanner";
import { AnalyticsGate } from "@/components/legal/AnalyticsGate";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";

// ============================================================================
// TIPOGRAFÍAS — Todas se descargan en el build y se sirven desde Andros
// (sin peticiones externas en el navegador). Sprint 22: la portada usa una
// tipografía editorial estática (Inter), así que ya no se cargan familias
// decorativas.
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

const fontVariables = [inter.variable, jetbrainsMono.variable].join(" ");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: "/",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
  // iOS / Safari: instalar en pantalla de inicio sin barra de navegador.
  appleWebApp: { capable: true, title: "Andros", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0D0E11",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <PwaRegister />
        {/* Consentimiento de cookies: la analítica opcional solo carga tras «Aceptar todas» */}
        <CookieBanner />
        <AnalyticsGate />
        {/* Ninguna descarga sin permiso explícito (requestFileDownload) */}
        <DownloadPermissionModal />
      </body>
    </html>
  );
}
