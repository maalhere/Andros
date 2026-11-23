"use client";

import React, { useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronUp,
  HeadphoneOff,
  Headphones,
  Link2,
  Loader2,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  X,
} from "lucide-react";
import { useCollabStore } from "@/store/useCollabStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useTabsBarVisible } from "@/store/useTabsStore";
import {
  LOCAL_MODE_MESSAGE,
  canShareScreen,
  copyCollabInviteLink,
  joinCollabRoom,
  leaveCollabRoom,
  startCollabScreenShare,
  stopCollabScreenShare,
  toggleCollabDeafen,
  toggleCollabMute,
} from "@/lib/collab/useCollabRoom";
import type { CollabPresence } from "@/types/collab";

// ============================================================================
// ANDROS — SALA DE VOZ ESTILO DISCORD (compacta, Dual-Engine)
//   · CollabRoomButton → botón «Sala» + «Copiar invitación» de la barra superior.
//   · VoiceRoomBar     → avatares en vivo (aro verde al hablar) y controles:
//                        Silenciar · Ensordecer · Compartir pantalla · Salir.
// ============================================================================

const TOP_BUTTON =
  "rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro flex items-center justify-center";

function initialsOf(name: string): string {
  const parts = name.replace(/\(tú\)/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

// ----------------------------------------------------------------------------
// Botones de la barra superior
// ----------------------------------------------------------------------------

export const CollabRoomButton: React.FC = () => {
  const status = useCollabStore((s) => s.status);
  const peerCount = useCollabStore((s) => Object.keys(s.peers).length);
  const panelOpen = useCollabStore((s) => s.panelOpen);
  const hasInvite = useCollabStore((s) => Boolean(s.invite));
  const anySpeaking = useCollabStore((s) => Object.values(s.speaking).some(Boolean));
  const inRoom = status !== "idle";

  const handleClick = () => {
    if (!inRoom) {
      void joinCollabRoom();
      return;
    }
    useCollabStore.getState().setPanelOpen(!panelOpen);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={
          inRoom
            ? `Sala de voz activa con ${peerCount + 1} ${peerCount === 0 ? "persona" : "personas"}. ${
                panelOpen ? "Ocultar" : "Mostrar"
              } controles`
            : "Unirse a la sala de voz del espacio"
        }
        aria-expanded={inRoom ? panelOpen : undefined}
        title={inRoom ? "Controles de la sala" : "Unirse a sala / Voz"}
        className={`relative w-11 h-11 md:w-auto md:h-9 md:px-3 gap-1.5 ${TOP_BUTTON} ${
          inRoom ? "border-andros-success/50" : ""
        }`}
      >
        <Headphones
          className={`w-4 h-4 ${inRoom ? "text-andros-success" : "text-andros-accent-ink"}`}
          aria-hidden="true"
        />
        <span className="hidden md:inline text-xs font-medium text-andros-primary">
          {inRoom ? "En sala" : "Sala"}
        </span>
        {inRoom && status !== "local" && (
          <span className="hidden md:inline font-mono tabular-nums text-[11px] text-andros-muted">
            {peerCount + 1}
          </span>
        )}
        {(hasInvite && !inRoom) || anySpeaking ? (
          <span
            aria-hidden="true"
            className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
              anySpeaking ? "bg-andros-success" : "bg-andros-accent"
            }`}
          />
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => void copyCollabInviteLink()}
        aria-label="Copiar enlace de invitación al espacio actual"
        title="Copiar enlace de invitación"
        className={`hidden md:flex w-9 h-9 ${TOP_BUTTON}`}
      >
        <Link2 className="w-4 h-4" aria-hidden="true" />
      </button>
    </>
  );
};

// ----------------------------------------------------------------------------
// Audio remoto (se silencia al ensordecer)
// ----------------------------------------------------------------------------

const RemoteAudio: React.FC<{ stream: MediaStream; muted: boolean }> = ({ stream, muted }) => {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => {
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);

  return <audio ref={ref} autoPlay muted={muted} className="hidden" />;
};

// ----------------------------------------------------------------------------
// Avatar con aro de voz
// ----------------------------------------------------------------------------

interface AvatarProps {
  name: string;
  color: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  detail: string;
}

const PeerAvatar: React.FC<AvatarProps> = ({ name, color, speaking, muted, deafened, sharing, detail }) => {
  const states = [
    speaking ? "hablando" : null,
    deafened ? "ensordecido" : muted ? "micrófono silenciado" : null,
    sharing ? "comparte pantalla" : null,
  ].filter(Boolean);

  return (
    <li className="relative shrink-0" title={`${name} · ${detail}`}>
      <span
        className={`flex items-center justify-center w-9 h-9 rounded-full text-[11px] font-semibold text-white transition-shadow duration-150 ${
          speaking
            ? "ring-2 ring-andros-success ring-offset-2 ring-offset-[var(--surface-card)]"
            : "ring-1 ring-andros-border"
        }`}
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
      {(muted || deafened) && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-andros-card border border-andros-border"
          aria-hidden="true"
        >
          {deafened ? (
            <HeadphoneOff className="w-2.5 h-2.5 text-andros-danger" />
          ) : (
            <MicOff className="w-2.5 h-2.5 text-andros-danger" />
          )}
        </span>
      )}
      {sharing && (
        <span
          className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-andros-card border border-andros-border"
          aria-hidden="true"
        >
          <MonitorUp className="w-2.5 h-2.5 text-andros-accent-ink" />
        </span>
      )}
      <span className="sr-only">
        {name}, {detail}
        {states.length > 0 ? `, ${states.join(", ")}` : ""}
      </span>
    </li>
  );
};

// ----------------------------------------------------------------------------
// Barra de la sala
// ----------------------------------------------------------------------------

const CONTROL =
  "w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center border spring-micro active:scale-[0.96] disabled:opacity-50 disabled:pointer-events-none";
const CONTROL_IDLE =
  "border-andros-border bg-andros-card text-andros-muted hover:text-andros-primary hover:border-andros-border-active";
const CONTROL_DANGER_ON = "border-andros-danger/40 bg-andros-danger/10 text-andros-danger";
const CONTROL_ACCENT_ON = "border-andros-accent/40 bg-andros-accent/15 text-andros-accent-ink";

export const VoiceRoomBar: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const status = useCollabStore((s) => s.status);
  const errorMessage = useCollabStore((s) => s.errorMessage);
  const roomLabel = useCollabStore((s) => s.roomLabel);
  const selfPeerId = useCollabStore((s) => s.selfPeerId);
  const selfColor = useCollabStore((s) => s.selfColor);
  const muted = useCollabStore((s) => s.muted);
  const deafened = useCollabStore((s) => s.deafened);
  const hasMic = useCollabStore((s) => s.hasMic);
  const sharing = useCollabStore((s) => s.sharing);
  const peers = useCollabStore((s) => s.peers);
  const speaking = useCollabStore((s) => s.speaking);
  const remoteAudio = useCollabStore((s) => s.remoteAudio);
  const invite = useCollabStore((s) => s.invite);
  const guest = useCollabStore((s) => s.guest);
  const panelOpen = useCollabStore((s) => s.panelOpen);
  const userName = useCloudStore((s) => s.user?.name);
  const cloudWorkspaceId = useCloudStore((s) => s.workspaceId);
  const hasTabs = useTabsBarVisible();

  const placement = `fixed z-40 ${
    hasTabs ? "top-[6.75rem] md:top-24" : "top-16 md:top-[3.75rem]"
  } left-3 right-3 md:left-auto md:right-6 md:w-[22rem]`;

  // Invitación pendiente (se pulsa para unirse: el navegador pide el micrófono).
  if (status === "idle") {
    if (!invite) return null;
    return (
      <section
        aria-label="Invitación a una sala en vivo"
        className={`${placement} p-3 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark`}
      >
        <div className="flex items-start gap-3">
          <Headphones className="w-4 h-4 mt-0.5 shrink-0 text-andros-accent-ink" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-andros-primary">Te invitaron a una sala en vivo</h2>
            <p className="mt-0.5 text-xs text-andros-muted">
              Al unirte podrás hablar, ver pantallas compartidas y editar el lienzo con el equipo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => useCollabStore.getState().setInvite(null)}
            aria-label="Descartar invitación"
            className="hit-slop w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-andros-muted hover:text-andros-primary"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => void joinCollabRoom()}
          className="mt-3 w-full h-11 md:h-9 rounded-lg bg-andros-accent-fill text-white text-sm font-medium active:scale-[0.96] spring-micro"
        >
          Unirse a la sala
        </button>
      </section>
    );
  }

  const isLocal = status === "local";
  const peerList = Object.values(peers).sort((a, b) => a.joinedAt - b.joinedAt);
  const selfDetail = guest
    ? `invitado en «${guest.workspaceName}»`
    : isLocal
      ? "modo local"
      : "tú";
  const statusDot =
    status === "connected"
      ? "bg-andros-success"
      : status === "error"
        ? "bg-andros-danger"
        : "bg-andros-muted";
  const statusText =
    status === "connected"
      ? "Conectado"
      : status === "connecting"
        ? "Conectando…"
        : status === "error"
          ? "Sin conexión"
          : "Modo local";
  const screenSupported = canShareScreen();
  const canInvite = !isLocal && Boolean(guest?.workspaceId ?? cloudWorkspaceId);

  const peerDetail = (peer: CollabPresence) =>
    peer.workspaceId && peer.workspaceId === (guest?.workspaceId ?? cloudWorkspaceId)
      ? `en este espacio`
      : `en «${peer.workspaceName}»`;

  return (
    <section
      aria-label="Sala de voz"
      className={`${placement} p-2 rounded-2xl bg-andros-surface backdrop-blur-xl border border-andros-border shadow-hud-light dark:shadow-hud-dark`}
    >
      {/* Audio de los demás (oculto; se silencia al ensordecer) */}
      {Object.entries(remoteAudio).map(([peerId, stream]) => (
        <RemoteAudio key={peerId} stream={stream} muted={deafened} />
      ))}

      {/* Cabecera */}
      <div className="flex items-center gap-2 px-1.5 h-8">
        <span className={`w-2 h-2 shrink-0 rounded-full ${statusDot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
          <span className="truncate text-xs font-semibold text-andros-primary">{roomLabel || "Sala"}</span>
          <span className="shrink-0 text-[11px] text-andros-muted" role="status">
            {statusText}
          </span>
        </div>
        {status === "connecting" && (
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-andros-muted motion-reduce:animate-none" aria-hidden="true" />
        )}
        {!isLocal && (
          <span
            className="shrink-0 font-mono tabular-nums text-[11px] text-andros-muted"
            aria-label={`${peerList.length + 1} en la sala`}
          >
            {peerList.length + 1}
          </span>
        )}
        <button
          type="button"
          onClick={() => useCollabStore.getState().setPanelOpen(!panelOpen)}
          aria-label={panelOpen ? "Plegar la barra de la sala" : "Desplegar la barra de la sala"}
          aria-expanded={panelOpen}
          className="hit-slop w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-andros-muted hover:text-andros-primary"
        >
          {panelOpen ? (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {panelOpen && (
        <>
          {/* Mensajes de estado */}
          {isLocal && (
            <p className="mx-1.5 mt-1 px-2.5 py-2 rounded-lg bg-andros-card border border-andros-border text-xs text-andros-warning">
              {LOCAL_MODE_MESSAGE}. Puedes previsualizar tu pantalla compartida en el lienzo.
            </p>
          )}
          {status === "error" && errorMessage && (
            <p className="mx-1.5 mt-1 text-xs text-andros-danger" role="alert">
              {errorMessage}
            </p>
          )}
          {guest && (
            <p className="mx-1.5 mt-1 text-xs text-andros-muted">
              Ves el lienzo de <span className="text-andros-primary font-medium">{guest.hostName}</span>{" "}
              en vivo. Tus cambios los guarda el anfitrión, no tu nube.
            </p>
          )}

          {/* Participantes */}
          <ul
            aria-label="Participantes de la sala"
            className="flex items-center gap-2.5 px-1.5 py-2.5 overflow-x-auto"
          >
            <PeerAvatar
              name={userName || "Tú"}
              color={selfColor}
              speaking={Boolean(speaking[selfPeerId]) && !muted}
              muted={!hasMic || muted}
              deafened={deafened}
              sharing={sharing}
              detail={selfDetail}
            />
            {peerList.map((peer) => (
              <PeerAvatar
                key={peer.peerId}
                name={peer.name}
                color={peer.color}
                speaking={Boolean(speaking[peer.peerId])}
                muted={!peer.hasMic || peer.muted}
                deafened={peer.deafened}
                sharing={peer.sharing}
                detail={peer.guest ? `invitado ${peerDetail(peer)}` : peerDetail(peer)}
              />
            ))}
            {!isLocal && peerList.length === 0 && status === "connected" && (
              <li className="text-xs text-andros-muted">
                Aún no hay nadie más. Copia la invitación para llamar al equipo.
              </li>
            )}
          </ul>
        </>
      )}

      {/* Controles */}
      <div className="flex items-center gap-1.5 px-0.5 pt-0.5" role="group" aria-label="Controles de la llamada">
        <button
          type="button"
          onClick={() => void toggleCollabMute()}
          disabled={isLocal}
          aria-label={
            !hasMic ? "Activar micrófono" : muted ? "Activar micrófono (quitar silencio)" : "Silenciar micrófono"
          }
          aria-pressed={hasMic ? muted : undefined}
          title={!hasMic ? "Activar micrófono" : muted ? "Quitar silencio" : "Silenciar"}
          className={`${CONTROL} ${!hasMic || muted ? CONTROL_DANGER_ON : CONTROL_IDLE}`}
        >
          {!hasMic || muted ? (
            <MicOff className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Mic className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={toggleCollabDeafen}
          disabled={isLocal}
          aria-label={deafened ? "Dejar de ensordecer" : "Ensordecer (no escuchar a nadie)"}
          aria-pressed={deafened}
          title={deafened ? "Dejar de ensordecer" : "Ensordecer"}
          className={`${CONTROL} ${deafened ? CONTROL_DANGER_ON : CONTROL_IDLE}`}
        >
          {deafened ? (
            <HeadphoneOff className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Headphones className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => (sharing ? stopCollabScreenShare() : void startCollabScreenShare())}
          disabled={!screenSupported && !sharing}
          aria-label={sharing ? "Dejar de compartir pantalla" : "Compartir pantalla"}
          aria-pressed={sharing}
          title={
            screenSupported || sharing
              ? sharing
                ? "Dejar de compartir"
                : "Compartir pantalla"
              : "Tu navegador no permite compartir pantalla"
          }
          className={`${CONTROL} ${sharing ? CONTROL_ACCENT_ON : CONTROL_IDLE}`}
        >
          {sharing ? (
            <MonitorOff className="w-4 h-4" aria-hidden="true" />
          ) : (
            <MonitorUp className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => void copyCollabInviteLink()}
          disabled={!canInvite}
          aria-label="Copiar enlace de invitación a la sala"
          title="Copiar invitación"
          className={`${CONTROL} ${CONTROL_IDLE}`}
        >
          <Link2 className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => void leaveCollabRoom()}
          aria-label="Salir de la llamada"
          title="Salir de la llamada"
          className={`ml-auto h-11 md:h-9 px-3 rounded-lg flex items-center gap-1.5 bg-andros-danger/10 border border-andros-danger/40 text-andros-danger text-xs font-medium spring-micro active:scale-[0.96]`}
        >
          <PhoneOff className="w-4 h-4" aria-hidden="true" />
          {!isMobile && <span>Salir</span>}
        </button>
      </div>
    </section>
  );
};
