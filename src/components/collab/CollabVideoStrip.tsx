"use client";

import React, { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Mic, MicOff, Video } from "lucide-react";
import { useCollabStore } from "@/store/useCollabStore";
import { useCloudStore } from "@/store/useCloudStore";
import { initialsOf } from "./VoiceRoomBar";

// ============================================================================
// ANDROS — TIRA DE VÍDEO COMPACTA (cámaras de la llamada)
//   · Solo aparece si al menos una persona en voz tiene la cámara encendida.
//   · Escritorio: columna en la esquina inferior derecha. Móvil: fila
//     horizontal sobre la barra táctil. Plegable sin apagar las cámaras.
//   · Independiente de la pantalla compartida (ScreenShareNode): son pistas
//     separadas y nunca se mezclan.
// ============================================================================

interface TileProps {
  stream: MediaStream;
  name: string;
  color: string;
  speaking: boolean;
  micOff: boolean;
  isLocal: boolean;
}

const VideoTile: React.FC<TileProps> = ({ stream, name, color, speaking, micOff, isLocal }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    // El vídeo va siempre en silencio (el audio viaja por los <audio> de la
    // barra de voz), así que el navegador permite reproducirlo solo.
    void element.play().catch(() => undefined);
    return () => {
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <li
      className={`relative shrink-0 w-40 md:w-full aspect-video rounded-xl overflow-hidden bg-andros-canvas border border-andros-border transition-shadow duration-150 ${
        speaking ? "ring-2 ring-andros-success" : ""
      }`}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        aria-label={isLocal ? "Tu cámara (vista previa en espejo)" : `Cámara de ${name}`}
        className={`w-full h-full object-cover ${isLocal ? "-scale-x-100" : ""}`}
      />
      <div className="absolute left-1.5 right-1.5 bottom-1.5 flex items-center gap-1.5">
        <span
          className="flex items-center justify-center w-5 h-5 shrink-0 rounded-full text-[9px] font-semibold text-white"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        >
          {initialsOf(name)}
        </span>
        <span className="min-w-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[11px] text-white">
          <span className="truncate">{isLocal ? `${name} (tú)` : name}</span>
          {micOff ? (
            <MicOff className="w-3 h-3 shrink-0" aria-label="Micrófono silenciado" />
          ) : (
            <Mic className="w-3 h-3 shrink-0" aria-label="Micrófono activo" />
          )}
        </span>
      </div>
    </li>
  );
};

export const CollabVideoStrip: React.FC = () => {
  const inCall = useCollabStore((s) => s.inCall);
  const localCamera = useCollabStore((s) => s.localCamera);
  const remoteCameras = useCollabStore((s) => s.remoteCameras);
  const peers = useCollabStore((s) => s.peers);
  const speaking = useCollabStore((s) => s.speaking);
  const selfPeerId = useCollabStore((s) => s.selfPeerId);
  const selfColor = useCollabStore((s) => s.selfColor);
  const muted = useCollabStore((s) => s.muted);
  const hasMic = useCollabStore((s) => s.hasMic);
  const open = useCollabStore((s) => s.videoStripOpen);
  const userName = useCloudStore((s) => s.user?.name);

  const remote = Object.entries(remoteCameras)
    .map(([peerId, stream]) => ({ peerId, stream, peer: peers[peerId] }))
    .filter((r) => r.peer?.inCall);
  const count = remote.length + (localCamera ? 1 : 0);
  if (!inCall || count === 0) return null;

  return (
    <section
      aria-label="Cámaras de la llamada"
      className="fixed z-40 left-3 right-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:left-auto md:right-6 md:bottom-[5.75rem] md:w-64 p-1.5 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark"
    >
      <div className="flex items-center gap-1.5 px-1.5 h-7">
        <Video className="w-3.5 h-3.5 shrink-0 text-andros-accent-ink" aria-hidden="true" />
        <span className="flex-1 text-xs font-semibold text-andros-primary">
          Cámaras <span className="font-mono tabular-nums text-andros-muted">{count}</span>
        </span>
        <button
          type="button"
          onClick={() => useCollabStore.getState().setVideoStripOpen(!open)}
          aria-label={open ? "Plegar las cámaras" : "Mostrar las cámaras"}
          aria-expanded={open}
          className="hit-slop w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-andros-muted hover:text-andros-primary"
        >
          {open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronUp className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <ul className="mt-1 flex md:flex-col gap-1.5 overflow-x-auto md:overflow-x-visible md:overflow-y-auto md:max-h-[60vh]">
          {localCamera && (
            <VideoTile
              stream={localCamera}
              name={userName || "Tú"}
              color={selfColor}
              speaking={Boolean(speaking[selfPeerId]) && !muted}
              micOff={!hasMic || muted}
              isLocal
            />
          )}
          {remote.map(({ peerId, stream, peer }) => (
            <VideoTile
              key={peerId}
              stream={stream}
              name={peer?.name ?? "Participante"}
              color={peer?.color ?? "#2563EB"}
              speaking={Boolean(speaking[peerId])}
              micOff={!peer?.hasMic || Boolean(peer?.muted)}
              isLocal={false}
            />
          ))}
        </ul>
      )}
    </section>
  );
};
