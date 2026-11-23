"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, MonitorOff, MoveDiagonal2, Play, X } from "lucide-react";
import {
  SCREEN_NODE_MIN_SIZE,
  useCollabStore,
} from "@/store/useCollabStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { stopCollabScreenShare } from "@/lib/collab/useCollabRoom";
import type { ScreenShareNodeData } from "@/types/collab";

// ============================================================================
// ANDROS — NODO DE PANTALLA COMPARTIDA (`screen-share-node`, efímero)
//   · Aparece solo cuando alguien pulsa «Compartir pantalla».
//   · Se arrastra por la cabecera y se redimensiona por la esquina, junto a
//     piezas 3D y notas. NUNCA se guarda en la nube: al cerrar la sesión o
//     terminar la transmisión se retira y no deja pantallas muertas.
// ============================================================================

const MAX_SIZE = { width: 1600, height: 1000 };

interface ScreenShareNodeProps {
  share: ScreenShareNodeData;
  stream: MediaStream | null;
  /** "canvas": dentro del lienzo (arrastrable). "docked": tarjeta fija en el teléfono. */
  variant: "canvas" | "docked";
  /** Zoom del lienzo para convertir el arrastre de pantalla a coordenadas del lienzo. */
  scale?: number;
}

export const ScreenShareNode: React.FC<ScreenShareNodeProps> = ({ share, stream, variant, scale = 1 }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; w: number; h: number } | null>(
    null
  );
  const reduced = useSettingsStore((s) => s.animations === "reduced");
  /** El navegador pausó el vídeo (ahorro de energía, pestaña oculta, autoplay). */
  const [paused, setPaused] = useState(false);
  const isLive = share.status === "live" && Boolean(stream);
  const isEnded = share.status === "ended";

  // Reproducción garantizada: `play()` explícito al recibir el flujo y cada vez
  // que la pista vuelve a traer imagen (renegociación o cambio de red).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (!stream) {
      return () => {
        video.srcObject = null;
      };
    }
    let disposed = false;
    const tryPlay = () => {
      if (disposed || !video.paused) return;
      video.play().then(
        () => {
          if (!disposed) setPaused(false);
        },
        (error: unknown) => {
          // AbortError = llegó otro flujo antes de terminar: no es una pausa real.
          if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) setPaused(true);
        }
      );
    };
    const onPlaying = () => setPaused(false);
    const onPause = () => {
      // Pausa ajena (no por cerrar el nodo): se reintenta y, si falla, se ofrece el botón.
      if (!disposed && video.srcObject === stream) tryPlay();
    };
    const tracks = stream.getVideoTracks();
    tracks.forEach((track) => track.addEventListener("unmute", tryPlay));
    stream.addEventListener("addtrack", tryPlay);
    video.addEventListener("loadedmetadata", tryPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    tryPlay();
    return () => {
      disposed = true;
      tracks.forEach((track) => track.removeEventListener("unmute", tryPlay));
      stream.removeEventListener("addtrack", tryPlay);
      video.removeEventListener("loadedmetadata", tryPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.srcObject = null;
    };
  }, [stream]);

  const resumePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    video.play().then(
      () => setPaused(false),
      () => setPaused(true)
    );
  };

  const patch = useCollabStore.getState().patchScreenShare;

  const handleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    const legacy = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (typeof video.requestFullscreen === "function") void video.requestFullscreen().catch(() => undefined);
    else legacy.webkitEnterFullscreen?.();
  };

  const handleRemove = () => {
    if (share.isLocal) stopCollabScreenShare();
    else useCollabStore.getState().removeScreenShare(share.id);
  };

  // --- Arrastre por la cabecera -------------------------------------------
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (variant !== "canvas" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: share.position.x,
      y: share.position.y,
    };
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    patch(share.id, {
      position: {
        x: Math.round(drag.x + (e.clientX - drag.startX) / scale),
        y: Math.round(drag.y + (e.clientY - drag.startY) / scale),
      },
    });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // --- Redimensionado por la esquina ----------------------------------------
  const onResizePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      w: share.size.width,
      h: share.size.height,
    };
  };
  const onResizePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
    patch(share.id, {
      size: {
        width: Math.round(clamp(resize.w + (e.clientX - resize.startX) / scale, SCREEN_NODE_MIN_SIZE.width, MAX_SIZE.width)),
        height: Math.round(
          clamp(resize.h + (e.clientY - resize.startY) / scale, SCREEN_NODE_MIN_SIZE.height, MAX_SIZE.height)
        ),
      },
    });
  };
  const endResize = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId !== e.pointerId) return;
    resizeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Teclado: flechas mueven el nodo (accesible sin ratón).
  const onHeaderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (variant !== "canvas") return;
    const step = e.shiftKey ? 64 : 16;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[e.key];
    if (!move) return;
    e.preventDefault();
    e.stopPropagation();
    patch(share.id, { position: { x: share.position.x + move[0], y: share.position.y + move[1] } });
  };

  const title = share.isLocal ? "Tu pantalla compartida" : `Pantalla de ${share.presenterName}`;
  const isCanvas = variant === "canvas";

  return (
    <article
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      className={`flex flex-col overflow-hidden rounded-2xl bg-andros-card border shadow-card-light dark:shadow-card-dark ${
        isLive ? "border-andros-accent/50" : "border-andros-border"
      } ${isCanvas ? "absolute" : "relative w-full"}`}
      style={
        isCanvas
          ? {
              left: share.position.x,
              top: share.position.y,
              width: share.size.width,
              height: share.size.height,
              zIndex: 30,
            }
          : { aspectRatio: "16 / 11" }
      }
    >
      {/* Cabecera (asa de arrastre) */}
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onHeaderKeyDown}
        tabIndex={isCanvas ? 0 : undefined}
        role={isCanvas ? "group" : undefined}
        aria-label={isCanvas ? `${title}. Usa las flechas para moverla por el lienzo` : undefined}
        className={`flex items-center gap-2 h-11 md:h-10 shrink-0 pl-3 pr-1.5 border-b border-andros-border ${
          isCanvas ? "cursor-grab active:cursor-grabbing touch-none" : ""
        }`}
      >
        {isEnded ? (
          <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-andros-canvas border border-andros-border text-[10px] font-semibold text-andros-muted">
            FINALIZADA
          </span>
        ) : (
          <span className="shrink-0 flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-andros-danger/10 text-[10px] font-semibold text-andros-danger">
            <span
              className={`w-1.5 h-1.5 rounded-full bg-andros-danger ${reduced ? "" : "animate-pulse motion-reduce:animate-none"}`}
              aria-hidden="true"
            />
            EN VIVO
          </span>
        )}
        <span
          className="w-2 h-2 shrink-0 rounded-full"
          style={{ backgroundColor: share.presenterColor }}
          aria-hidden="true"
        />
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-andros-primary">
          {share.presenterName}
        </h3>
        {!isEnded && (
          <button
            type="button"
            onClick={handleFullscreen}
            disabled={!isLive}
            aria-label={`Ver ${share.isLocal ? "tu pantalla" : `la pantalla de ${share.presenterName}`} a pantalla completa`}
            title="Pantalla completa"
            className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-canvas disabled:opacity-50 spring-micro active:scale-[0.96]"
          >
            <Maximize2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
        {share.isLocal ? (
          <button
            type="button"
            onClick={stopCollabScreenShare}
            className="h-11 md:h-8 shrink-0 px-2.5 rounded-lg flex items-center gap-1.5 bg-andros-danger/10 text-andros-danger text-xs font-medium spring-micro active:scale-[0.96]"
          >
            <MonitorOff className="w-4 h-4" aria-hidden="true" />
            Dejar de compartir
          </button>
        ) : (
          isEnded && (
            <button
              type="button"
              onClick={handleRemove}
              aria-label="Quitar del lienzo la pantalla finalizada"
              title="Quitar del lienzo"
              className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary hover:bg-andros-canvas spring-micro active:scale-[0.96]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )
        )}
      </div>

      {/* Cuerpo: vídeo en vivo */}
      <div className="relative flex-1 min-h-0 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label={title}
          className={`w-full h-full object-contain ${isLive ? "" : "opacity-0"}`}
        />
        {!isLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            {isEnded ? (
              <>
                <p className="text-sm text-white">La transmisión terminó.</p>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="h-11 md:h-8 px-3 rounded-lg bg-white/15 text-white text-xs font-medium hover:bg-white/25 spring-micro active:scale-[0.96]"
                >
                  Quitar del lienzo
                </button>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm text-white">
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Conectando con la pantalla de {share.presenterName}…
              </p>
            )}
          </div>
        )}
        {isLive && paused && (
          <button
            type="button"
            onClick={resumePlayback}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-11 md:h-9 px-3 rounded-lg flex items-center gap-1.5 bg-black/70 text-white text-xs font-medium hover:bg-black/80 spring-micro active:scale-[0.96]"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            Reanudar vídeo
          </button>
        )}
        {isCanvas && (
          <button
            type="button"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            aria-label="Redimensionar la pantalla compartida (arrastra la esquina)"
            title="Redimensionar"
            className="hit-slop absolute right-1 bottom-1 w-6 h-6 rounded-md flex items-center justify-center bg-black/50 text-white cursor-nwse-resize touch-none"
          >
            <MoveDiagonal2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
};

/** Todos los nodos de pantalla dentro de la capa transformable del lienzo. */
export const ScreenShareLayer: React.FC<{ scale: number; interactive: boolean }> = ({ scale, interactive }) => {
  const shares = useCollabStore((s) => s.screenShares);
  const streams = useCollabStore((s) => s.screenStreams);
  if (shares.length === 0) return null;
  return (
    <div className={interactive ? "pointer-events-auto" : "pointer-events-none"}>
      {shares.map((share) => (
        <ScreenShareNode
          key={share.id}
          share={share}
          stream={streams[share.id] ?? null}
          variant="canvas"
          scale={scale}
        />
      ))}
    </div>
  );
};

/** Teléfono: la pantalla más reciente en una tarjeta fija sobre la barra táctil. */
export const ScreenShareDock: React.FC = () => {
  const shares = useCollabStore((s) => s.screenShares);
  const streams = useCollabStore((s) => s.screenStreams);
  const share = shares[shares.length - 1];
  if (!share) return null;
  return (
    <div className="fixed left-3 right-3 bottom-24 z-30">
      <ScreenShareNode share={share} stream={streams[share.id] ?? null} variant="docked" />
    </div>
  );
};
