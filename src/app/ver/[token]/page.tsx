import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicBoardClient, PublicBoardSkeleton } from "@/components/share/PublicBoardClient";

// ============================================================================
// ANDROS — RUTA PÚBLICA «VISTA INVITADO» (/ver/<token>)
// No espera `params` aquí: el token se lee dentro de <Suspense> (Cache
// Components), así la cáscara de la página se sirve al instante. Sin login,
// sin Realtime y sin WebRTC; los buscadores no la indexan.
// ============================================================================

export const metadata: Metadata = {
  title: "Vista invitado",
  description: "Tablero compartido en solo lectura, organizado en Andros.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GuestViewPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<PublicBoardSkeleton />}>
      <PublicBoardClient params={params} />
    </Suspense>
  );
}
