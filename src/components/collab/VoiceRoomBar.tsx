"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  HeadphoneOff,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  SlidersHorizontal,
  Video,
  VideoOff,
  Volume2,
  X,
} from "lucide-react";
import { useCollabStore } from "@/store/useCollabStore";
import { useCloudStore } from "@/store/useCloudStore";
import { useTabsBarVisible } from "@/store/useTabsStore";
import {
  LOCAL_MODE_MESSAGE,
  canShareScreen,
  canUseCamera,
  getMicLevel,
  joinCollabRoom,
  leaveCollabRoom,
  playRemoteAudio,
  registerRemoteAudioElement,
  resumeCollabAudio,
  selectCamera,
  selectMicrophone,
  selectSpeaker,
  startCollabScreenShare,
  stopCollabScreenShare,
  toggleCollabCamera,
  toggleCollabDeafen,
  toggleCollabMute,
} from "@/lib/collab/useCollabRoom";
import {
  supportsSpeakerSelection,
  useMediaDevices,
  useMediaDevicesStore,
  type MediaDeviceOption,
} from "@/lib/collab/mediaDevices";
import type { LinkState } from "@/lib/collab/peerMesh";
import type { CollabPresence } from "@/types/collab";

// ============================================================================
// ANDROS — CANAL DE VOZ ESTILO DISCORD (compacto, Dual-Engine)
//   · CollabRoomButton → vista previa del canal en la barra superior: ves
//                        quién está en voz ANTES de entrar (1 clic = entrar).
//   · VoiceRoomBar     → dentro de la voz: avatares (aro verde al hablar) y
//                        Silenciar · Ensordecer · Cámara · Pantalla ·
//                        Dispositivos · Salir de voz.
// ============================================================================

const CONTROL =
  "w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center border spring-micro active:scale-[0.96] disabled:opacity-50 disabled:pointer-events-none";
const CONTROL_IDLE =
  "border-andros-border bg-andros-card text-andros-muted hover:text-andros-primary hover:border-andros-border-active";
const CONTROL_DANGER_ON = "border-andros-danger/40 bg-andros-danger/10 text-andros-danger";
const CONTROL_ACCENT_ON = "border-andros-accent/40 bg-andros-accent/15 text-andros-accent-ink";
const TOP_BUTTON =
  "rounded-xl bg-andros-surface backdrop-blur-md border border-andros-border text-andros-muted hover:text-andros-primary shadow-sm active:scale-[0.96] spring-micro flex items-center justify-center";

export function initialsOf(name: string): string {
  const parts = name.replace(/\(tú\)/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

// ----------------------------------------------------------------------------
// Barra superior: vista previa del canal de voz del espacio
// ----------------------------------------------------------------------------

export const CollabRoomButton: React.FC = () => {
  const status = useCollabStore((s) => s.status);
  const inCall = useCollabStore((s) => s.inCall);
  const callConnecting = useCollabStore((s) => s.callConnecting);
  const peers = useCollabStore((s) => s.peers);
  const panelOpen = useCollabStore((s) => s.panelOpen);
  const hasInvite = useCollabStore((s) => Boolean(s.invite));
  const anySpeaking = useCollabStore((s) => Object.values(s.speaking).some(Boolean));

  const voicePeers = Object.values(peers)
    .filter((p) => p.inCall)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const isLocal = status === "local";
  const voiceCount = voicePeers.length + (inCall && !isLocal ? 1 : 0);
  const names = voicePeers.map((p) => p.name);

  const handleClick = () => {
    if (!inCall) {
      void joinCollabRoom();
      return;
    }
    useCollabStore.getState().setPanelOpen(!panelOpen);
  };

  // Texto visible: «Voz · Vacío», «En voz · 2» o «Voz · modo local».
  const [head, tail, tailIsCount]: [string, string, boolean] = inCall
    ? isLocal
      ? ["Voz", "modo local", false]
      : ["En voz", String(voiceCount), true]
    : voicePeers.length === 0
      ? ["Voz", "Vacío", false]
      : ["En voz", String(voicePeers.length), true];

  const ariaLabel = inCall
    ? `Estás en el canal de voz${voiceCount > 1 ? ` con ${namesList(names)}` : ""}. ${
        panelOpen ? "Ocultar" : "Mostrar"
      } controles`
    : voicePeers.length === 0
      ? "Unirse al canal de voz del espacio (vacío)"
      : `Unirse al canal de voz: ${namesList(names)} ${voicePeers.length === 1 ? "está" : "están"} dentro`;

  const title = inCall
    ? "Controles de la voz"
    : voicePeers.length === 0
      ? "Canal de voz vacío · 1 clic para unirte"
      : `En voz: ${names.join(", ")}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={callConnecting}
      aria-label={ariaLabel}
      aria-expanded={inCall ? panelOpen : undefined}
      title={title}
      className={`relative h-11 md:h-9 min-w-11 px-2.5 md:px-3 gap-1.5 ${TOP_BUTTON} ${
        inCall ? "border-andros-success/50" : ""
      }`}
    >
      {callConnecting ? (
        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : !inCall && voicePeers.length > 0 ? (
        <span className="flex -space-x-1.5" aria-hidden="true">
          {voicePeers.slice(0, 3).map((p) => (
            <span
              key={p.peerId}
              className="flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold text-white ring-2 ring-[var(--surface-card)]"
              style={{ backgroundColor: p.color }}
            >
              {initialsOf(p.name)}
            </span>
          ))}
        </span>
      ) : (
        <Headphones
          className={`w-4 h-4 ${inCall ? "text-andros-success" : "text-andros-accent-ink"}`}
          aria-hidden="true"
        />
      )}
      <span className="hidden md:inline text-xs font-medium text-andros-primary" aria-hidden="true">
        {head}
        <span className="text-andros-muted"> · </span>
        <span className={tailIsCount ? "font-mono tabular-nums" : "text-andros-muted"}>{tail}</span>
      </span>
      {/* Móvil: solo el conteo */}
      {voiceCount > 0 && !isLocal && (
        <span className="md:hidden font-mono tabular-nums text-[11px] text-andros-primary" aria-hidden="true">
          {voiceCount}
        </span>
      )}
      {(hasInvite && !inCall) || anySpeaking ? (
        <span
          aria-hidden="true"
          className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
            anySpeaking ? "bg-andros-success" : "bg-andros-accent"
          }`}
        />
      ) : null}
    </button>
  );
};

// ----------------------------------------------------------------------------
// Audio remoto (se silencia al ensordecer)
// ----------------------------------------------------------------------------

/**
 * <audio> real dentro del DOM (nada de `new Audio()` suelto: el recolector o
 * Safari lo detienen). `srcObject` + `play()` explícito; si el navegador
 * bloquea el autoplay, la barra muestra «Activar sonido». La salida elegida
 * (setSinkId) se aplica al registrarlo.
 */
const RemoteAudio: React.FC<{ stream: MediaStream; muted: boolean }> = ({ stream, muted }) => {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const unregister = registerRemoteAudioElement(element);
    element.srcObject = stream;
    void playRemoteAudio(element);
    return () => {
      unregister();
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);

  return <audio ref={ref} autoPlay playsInline muted={muted} className="absolute h-0 w-0 opacity-0 pointer-events-none" />;
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
  video: boolean;
  detail: string;
  /** Estado del enlace de audio (solo para otros participantes). */
  link?: LinkState;
}

const LINK_TEXT: Record<LinkState, string> = {
  connecting: "Conectando audio…",
  connected: "Audio conectado",
  failed: "Sin audio — red restringida",
};
const LINK_DOT: Record<LinkState, string> = {
  connecting: "bg-andros-warning animate-pulse motion-reduce:animate-none",
  connected: "bg-andros-success",
  failed: "bg-andros-danger",
};

const PeerAvatar: React.FC<AvatarProps> = ({ name, color, speaking, muted, deafened, sharing, video, detail, link }) => {
  const linkText = link ? LINK_TEXT[link] : null;
  const states = [
    speaking ? "hablando" : null,
    deafened ? "ensordecido" : muted ? "micrófono silenciado" : null,
    video ? "cámara encendida" : null,
    sharing ? "comparte pantalla" : null,
    linkText,
  ].filter(Boolean);

  return (
    <li className="relative shrink-0" title={`${name} · ${detail}${linkText ? ` · ${linkText}` : ""}`}>
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
      {link && (
        <span
          className="absolute -bottom-0.5 -left-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-andros-card border border-andros-border"
          aria-hidden="true"
        >
          <span className={`w-2 h-2 rounded-full ${LINK_DOT[link]}`} />
        </span>
      )}
      {(sharing || video) && (
        <span
          className="absolute -top-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-andros-card border border-andros-border"
          aria-hidden="true"
        >
          {sharing ? (
            <MonitorUp className="w-2.5 h-2.5 text-andros-accent-ink" />
          ) : (
            <Video className="w-2.5 h-2.5 text-andros-accent-ink" />
          )}
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
// Popover de dispositivos (micrófono, salida y cámara) + nivel en vivo
// ----------------------------------------------------------------------------

const SELECT =
  "w-full h-11 md:h-9 px-2.5 rounded-lg bg-andros-canvas border border-andros-border text-xs text-andros-primary focus:outline-none focus:border-andros-border-active";

const DeviceSelect: React.FC<{
  id: string;
  label: string;
  value: string;
  options: MediaDeviceOption[];
  onChange: (deviceId: string) => void;
}> = ({ id, label, value, options, onChange }) => {
  // Si el dispositivo guardado ya no está conectado, se muestra el predeterminado.
  const current = options.some((o) => o.deviceId === value) ? value : "";
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[11px] font-medium text-andros-muted">
        {label}
      </label>
      <select id={id} value={current} onChange={(e) => onChange(e.target.value)} className={SELECT}>
        <option value="">Predeterminado del sistema</option>
        {options.map((o) => (
          <option key={o.deviceId} value={o.deviceId}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
};

/** Barra de nivel del micrófono (~12 fps, solo mientras el popover está abierto). */
const MicLevelMeter: React.FC<{ active: boolean }> = ({ active }) => {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setLevel(getMicLevel()), 80);
    return () => {
      clearInterval(timer);
      setLevel(0);
    };
  }, [active]);

  const percent = Math.round(Math.min(1, level * 7) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-andros-muted">
        <span id="andros-mic-level-label">Nivel del micrófono</span>
        {!active && <span>Activa el micrófono para medirlo</span>}
      </div>
      <div
        role="meter"
        aria-labelledby="andros-mic-level-label"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 rounded-full bg-andros-border/60 overflow-hidden"
      >
        <div
          className="h-full rounded-full bg-andros-success transition-[width] duration-75 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

const DevicesPopover: React.FC<{ micActive: boolean }> = ({ micActive }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mics = useMediaDevicesStore((s) => s.mics);
  const speakers = useMediaDevicesStore((s) => s.speakers);
  const cameras = useMediaDevicesStore((s) => s.cameras);
  const selectedMicId = useMediaDevicesStore((s) => s.selectedMicId);
  const selectedSpeakerId = useMediaDevicesStore((s) => s.selectedSpeakerId);
  const selectedCameraId = useMediaDevicesStore((s) => s.selectedCameraId);
  const speakerSupported = supportsSpeakerSelection();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="md:relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Dispositivos de audio y video"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Dispositivos de audio y video"
        className={`${CONTROL} ${open ? CONTROL_ACCENT_ON : CONTROL_IDLE}`}
      >
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Dispositivos de audio y video"
          className="absolute left-0 right-0 md:left-auto md:right-0 md:w-72 top-full mt-2 p-3 space-y-3 rounded-2xl bg-andros-card border border-andros-border shadow-hud-light dark:shadow-hud-dark z-50"
        >
          <DeviceSelect
            id="andros-device-mic"
            label="Micrófono"
            value={selectedMicId}
            options={mics}
            onChange={(id) => void selectMicrophone(id)}
          />
          <MicLevelMeter active={micActive} />
          {speakerSupported ? (
            <DeviceSelect
              id="andros-device-speaker"
              label="Salida / Audífonos"
              value={selectedSpeakerId}
              options={speakers}
              onChange={(id) => void selectSpeaker(id)}
            />
          ) : (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-andros-muted">Salida / Audífonos</p>
              <p className="text-xs text-andros-primary">Salida controlada por el sistema</p>
            </div>
          )}
          <DeviceSelect
            id="andros-device-camera"
            label="Cámara"
            value={selectedCameraId}
            options={cameras}
            onChange={(id) => void selectCamera(id)}
          />
          {mics.length === 0 && cameras.length === 0 && (
            <p className="text-[11px] text-andros-muted">
              Los nombres de los dispositivos aparecen al dar permiso de micrófono o cámara.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Barra de la voz
// ----------------------------------------------------------------------------


export const VoiceRoomBar: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
  // Lista de micrófonos, salidas y cámaras al día (devicechange).
  useMediaDevices();

  const status = useCollabStore((s) => s.status);
  const inCall = useCollabStore((s) => s.inCall);
  const errorMessage = useCollabStore((s) => s.errorMessage);
  const roomLabel = useCollabStore((s) => s.roomLabel);
  const selfPeerId = useCollabStore((s) => s.selfPeerId);
  const selfColor = useCollabStore((s) => s.selfColor);
  const muted = useCollabStore((s) => s.muted);
  const deafened = useCollabStore((s) => s.deafened);
  const hasMic = useCollabStore((s) => s.hasMic);
  const sharing = useCollabStore((s) => s.sharing);
  const hasVideo = useCollabStore((s) => s.hasVideo);
  const peers = useCollabStore((s) => s.peers);
  const speaking = useCollabStore((s) => s.speaking);
  const remoteAudio = useCollabStore((s) => s.remoteAudio);
  const linkStates = useCollabStore((s) => s.linkStates);
  const audioBlocked = useCollabStore((s) => s.audioBlocked);
  const invite = useCollabStore((s) => s.invite);
  const guest = useCollabStore((s) => s.guest);
  const panelOpen = useCollabStore((s) => s.panelOpen);
  const userName = useCloudStore((s) => s.user?.name);
  const cloudWorkspaceId = useCloudStore((s) => s.workspaceId);
  const hasTabs = useTabsBarVisible();

  const placement = `fixed z-40 ${
    hasTabs ? "top-[6.75rem] md:top-24" : "top-16 md:top-[3.75rem]"
  } left-3 right-3 md:left-auto md:right-6 md:w-[22rem]`;

  // Fuera de la voz no hay barra: el canal se ve en la barra superior.
  if (!inCall) {
    // Enlace antiguo `?sala=`: se pulsa para unirse (el navegador pide el micrófono).
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
          Unirse a voz
        </button>
      </section>
    );
  }

  const isLocal = status === "local";
  const allPeers = Object.values(peers).sort((a, b) => a.joinedAt - b.joinedAt);
  const voicePeers = allPeers.filter((p) => p.inCall);
  const outsidePeers = allPeers.filter((p) => !p.inCall);
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
      ? "En voz"
      : status === "connecting"
        ? "Conectando…"
        : status === "error"
          ? "Sin conexión"
          : "Modo local";
  const screenSupported = canShareScreen();
  const cameraSupported = canUseCamera();

  const peerDetail = (peer: CollabPresence) =>
    peer.workspaceId && peer.workspaceId === (guest?.workspaceId ?? cloudWorkspaceId)
      ? `en este espacio`
      : `en «${peer.workspaceName}»`;

  return (
    <section
      aria-label="Canal de voz"
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
          <span className="truncate text-xs font-semibold text-andros-primary">{roomLabel || "Voz"}</span>
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
            aria-label={`${voicePeers.length + 1} en voz`}
          >
            {voicePeers.length + 1}
          </span>
        )}
        <button
          type="button"
          onClick={() => useCollabStore.getState().setPanelOpen(!panelOpen)}
          aria-label={panelOpen ? "Plegar la barra de voz" : "Desplegar la barra de voz"}
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

      {/* El navegador bloqueó el audio automático: un clic lo reactiva */}
      {audioBlocked && !isLocal && (
        <button
          type="button"
          onClick={() => void resumeCollabAudio()}
          className="mx-1.5 mt-1 w-[calc(100%-0.75rem)] h-11 md:h-9 rounded-lg bg-andros-accent-fill text-white text-xs font-medium flex items-center justify-center gap-1.5 active:scale-[0.96] spring-micro"
        >
          <Volume2 className="w-4 h-4" aria-hidden="true" />
          Activar sonido
        </button>
      )}

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

          {/* Participantes en voz */}
          <ul
            aria-label="Participantes en voz"
            className="flex items-center gap-2.5 px-1.5 py-2.5 overflow-x-auto"
          >
            <PeerAvatar
              name={userName || "Tú"}
              color={selfColor}
              speaking={Boolean(speaking[selfPeerId]) && !muted}
              muted={!hasMic || muted}
              deafened={deafened}
              sharing={sharing}
              video={hasVideo}
              detail={selfDetail}
            />
            {voicePeers.map((peer) => (
              <PeerAvatar
                key={peer.peerId}
                name={peer.name}
                color={peer.color}
                speaking={Boolean(speaking[peer.peerId])}
                muted={!peer.hasMic || peer.muted}
                deafened={peer.deafened}
                sharing={peer.sharing}
                video={peer.hasVideo}
                detail={peer.guest ? `invitado ${peerDetail(peer)}` : peerDetail(peer)}
                link={linkStates[peer.peerId] ?? "connecting"}
              />
            ))}
            {!isLocal && voicePeers.length === 0 && status === "connected" && (
              <li className="text-xs text-andros-muted">
                Nadie más en voz todavía. Quien abra este espacio verá que estás dentro.
              </li>
            )}
          </ul>
          {outsidePeers.length > 0 && (
            <p className="mx-1.5 mb-1.5 text-[11px] text-andros-muted">
              En el espacio, fuera de voz: {namesList(outsidePeers.map((p) => p.name))}
            </p>
          )}
          {voicePeers.some((peer) => linkStates[peer.peerId] === "failed") && (
            <p className="mx-1.5 mb-1 text-xs text-andros-warning" role="status">
              Sin audio con{" "}
              {voicePeers
                .filter((peer) => linkStates[peer.peerId] === "failed")
                .map((peer) => peer.name)
                .join(", ")}{" "}
              — red restringida (puede requerir un servidor TURN).
            </p>
          )}
        </>
      )}

      {/* Controles */}
      <div className="relative flex items-center gap-1.5 px-0.5 pt-0.5" role="group" aria-label="Controles de la llamada">
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
          onClick={() => void toggleCollabCamera()}
          disabled={isLocal || (!cameraSupported && !hasVideo)}
          aria-label={hasVideo ? "Apagar cámara" : "Encender cámara"}
          aria-pressed={hasVideo}
          title={hasVideo ? "Apagar cámara" : cameraSupported ? "Encender cámara" : "Tu navegador no permite usar la cámara"}
          className={`${CONTROL} ${hasVideo ? CONTROL_ACCENT_ON : CONTROL_IDLE}`}
        >
          {hasVideo ? <Video className="w-4 h-4" aria-hidden="true" /> : <VideoOff className="w-4 h-4" aria-hidden="true" />}
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
        {!isLocal && <DevicesPopover micActive={hasMic && !muted} />}
        <button
          type="button"
          onClick={() => void leaveCollabRoom()}
          aria-label="Salir de voz"
          title="Salir de voz (sigues en el espacio)"
          className={`ml-auto h-11 md:h-9 px-3 rounded-lg flex items-center gap-1.5 bg-andros-danger/10 border border-andros-danger/40 text-andros-danger text-xs font-medium spring-micro active:scale-[0.96]`}
        >
          <PhoneOff className="w-4 h-4" aria-hidden="true" />
          {!isMobile && <span>Salir de voz</span>}
        </button>
      </div>
    </section>
  );
};
