"use client";

import React, { useEffect, useRef } from "react";
import { useCollabStore } from "@/store/useCollabStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { sendCollabCursor } from "@/lib/collab/useCollabRoom";

// ============================================================================
// ANDROS — CURSORES EN VIVO DEL EQUIPO (dentro de la capa transformable)
//   · Envía tu cursor en coordenadas del LIENZO (~16 fps, con la última posición).
//   · Pinta el puntero de cada compañero que está en tu mismo espacio, con su
//     nombre y color; el tamaño se compensa para no crecer con el zoom.
// ============================================================================

interface CollabCursorsLayerProps {
  /** Zoom actual del lienzo (para que el puntero mantenga su tamaño). */
  scale: number;
}

export const CollabCursorsLayer: React.FC<CollabCursorsLayerProps> = ({ scale }) => {
  const originRef = useRef<HTMLDivElement>(null);
  const connected = useCollabStore((s) => s.status === "connected");
  const cursors = useCollabStore((s) => s.cursors);
  const peers = useCollabStore((s) => s.peers);
  const guestWorkspaceId = useCollabStore((s) => s.guest?.workspaceId ?? null);
  const cloudWorkspaceId = useCloudStore((s) => s.workspaceId);
  const reduced = useSettingsStore((s) => s.animations === "reduced");
  const liveWorkspace = guestWorkspaceId ?? cloudWorkspaceId;

  // Emisión: el origen (0,0) de la capa ya incluye el paneo y el zoom.
  useEffect(() => {
    if (!connected) return;
    const handleMove = (e: PointerEvent) => {
      const origin = originRef.current;
      if (!origin) return;
      const rect = origin.getBoundingClientRect();
      const currentScale = rect.width > 0 ? rect.width / 100 : 1;
      sendCollabCursor((e.clientX - rect.left) / currentScale, (e.clientY - rect.top) / currentScale);
    };
    window.addEventListener("pointermove", handleMove, { passive: true });
    return () => window.removeEventListener("pointermove", handleMove);
  }, [connected]);

  const visible = Object.values(cursors).filter(
    (cursor) => peers[cursor.peerId] && cursor.workspaceId === liveWorkspace
  );

  return (
    <>
      {/* Regla invisible de 100 px: mide el zoom real aunque la cámara esté animando. */}
      <div ref={originRef} className="absolute left-0 top-0 w-[100px] h-0 pointer-events-none" aria-hidden="true" />
      {visible.length > 0 && (
        <div className="absolute left-0 top-0 pointer-events-none" style={{ zIndex: 45 }} aria-hidden="true">
          {visible.map((cursor) => {
            const peer = peers[cursor.peerId];
            return (
              <div
                key={cursor.peerId}
                className="absolute left-0 top-0"
                style={{
                  transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0) scale(${1 / scale})`,
                  transformOrigin: "0 0",
                  transition: reduced ? undefined : "transform 90ms linear",
                }}
              >
                <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-sm">
                  <path
                    d="M1.5 1.5 L1.5 16.5 L5.6 12.6 L8.4 18.5 L11 17.3 L8.3 11.5 L14 11.5 Z"
                    fill={peer.color}
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
                <span
                  className="absolute left-4 top-4 whitespace-nowrap px-1.5 py-0.5 rounded-md text-[11px] font-medium text-white shadow-sm"
                  style={{ backgroundColor: peer.color }}
                >
                  {peer.name}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
