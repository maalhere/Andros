// ============================================================================
// ANDROS — MALLA WEBRTC PARA 2–5 PERSONAS EN VOZ ($0: sin servidor multimedia)
//
// Cada pareja de participantes tiene UN RTCPeerConnection que lleva su audio,
// su cámara (si la enciende) y su pantalla (si comparte). Cámara y pantalla
// viajan con un `MediaStream.id` fijo por llamada que se anuncia en Presence,
// así el receptor las distingue sin mezclarlas. La señalización viaja por
// Supabase Broadcast. Para que dos ofertas simultáneas no rompan la conexión:
//   · La PRIMERA oferta la envía solo el peer con el id MAYOR (regla
//     determinista anti-glare); el menor solo responde.
//   · Una vez negociado, cualquiera puede renegociar (p. ej. al compartir
//     pantalla o encender la cámara) con el patrón "negociación perfecta"
//     (W3C): el id menor es el "educado" y cede ante una colisión.
// Solo una OFERTA puede abrir un enlace nuevo: los candidatos ICE o las
// respuestas que llegan tarde de alguien que ya salió se descartan (antes
// recreaban un enlace "zombi" que acababa en «Sin audio — red restringida»).
//
// Redes móviles (Wi-Fi ↔ 4G): si ICE pasa a `disconnected` o `failed` se
// reinicia (`restartIce`) con espera creciente, máx. 2 veces, antes de dar el
// enlace por perdido. Cámara y pantalla llevan un tope de bitrate para no
// ahogar la subida de un teléfono.
// ============================================================================

import type { LinkState, RtcSignalPayload } from "@/types/collab";

export type { LinkState };

/** Tiempo máximo en «comprobando» antes de tratar el enlace como caído. */
const ICE_STUCK_MS = 12000;
/** `disconnected` suele recuperarse solo (cambio breve de red): se espera un poco. */
const DISCONNECT_GRACE_MS = 2500;
/** Reinicios de ICE antes de marcar el enlace en rojo. */
const MAX_ICE_RESTARTS = 2;
/** Espera antes de cada reinicio (1 s, 2 s): no se bombardea una red inestable. */
const RESTART_BACKOFF_MS = 1000;
/** El peer educado espera un poco más para que la oferta del otro llegue primero. */
const POLITE_RESTART_DELAY_MS = 1200;

/** Topes de subida por enlace (bits/s). */
const SCREEN_MAX_BITRATE = 900_000;
const SCREEN_MAX_FRAMERATE = 15;
const CAMERA_MAX_BITRATE = 350_000;

/** STUN público por defecto; TURN opcional con variables NEXT_PUBLIC_TURN_*. */
export function buildRtcConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  // Acceso estático: Next.js solo sustituye `process.env.NEXT_PUBLIC_X` literal.
  const turnUrls = parseTurnUrls(process.env.NEXT_PUBLIC_TURN_URL);
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim();
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
  if (turnUrls.length > 0) {
    iceServers.push(
      turnUsername && turnCredential
        ? { urls: turnUrls, username: turnUsername, credential: turnCredential }
        : { urls: turnUrls }
    );
  }
  return { iceServers };
}

/**
 * `NEXT_PUBLIC_TURN_URL` admite varias URL separadas por comas (p. ej.
 * `turn:x:3478?transport=udp, turns:x:443?transport=tcp`). Se quitan
 * comillas y espacios, y se descartan las que no son `turn:`/`turns:`/`stun:`.
 */
export function parseTurnUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((url) => url.trim().replace(/^["']|["']$/g, ""))
    .filter((url) => /^(turns?|stun):/i.test(url));
}

export const RTC_CONFIG: RTCConfiguration = buildRtcConfig();

interface PeerLink {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Yo envío la primera oferta (mi id es mayor que el del otro). */
  initiator: boolean;
  /** Ya hubo una negociación completa (desde aquí cualquiera puede renegociar). */
  negotiated: boolean;
  micSender: RTCRtpSender | null;
  /** Emisores de vídeo: se conservan al apagar para reutilizar su transceptor. */
  cameraSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  /** Temporizador único de recuperación (espera, reinicio o atasco de ICE). */
  recoveryTimer: ReturnType<typeof setTimeout> | null;
  /** Reinicios de ICE hechos desde la última conexión buena. */
  iceRestarts: number;
  /** Candidatos ICE que llegaron antes de la descripción remota. */
  pendingCandidates: RTCIceCandidateInit[];
}

export interface PeerMeshOptions {
  selfId: string;
  sendSignal: (payload: RtcSignalPayload) => void;
  onRemoteAudio: (peerId: string, stream: MediaStream | null) => void;
  /**
   * Vídeo remoto (cámara o pantalla) con el `MediaStream.id` del emisor.
   * `streamId === null` = se cerró el enlace: borra todos sus vídeos.
   */
  onRemoteVideo: (peerId: string, streamId: string | null, stream: MediaStream | null) => void;
  /** Estado real del enlace (`null` = enlace cerrado). */
  onLinkState?: (peerId: string, state: LinkState | null) => void;
  /** ¿Se acepta una oferta de este participante? (p. ej. sigue dentro de la voz). */
  acceptPeer?: (peerId: string) => boolean;
}

export class PeerMesh {
  private readonly links = new Map<string, PeerLink>();
  private micTrack: MediaStreamTrack | null = null;
  private micStream: MediaStream | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  /** Flujos "contenedor" de salida: su id identifica la cámara y la pantalla. */
  private readonly cameraOut = new MediaStream();
  private readonly screenOut = new MediaStream();
  private closed = false;

  constructor(private readonly options: PeerMeshOptions) {}

  /** Ids de los participantes con conexión abierta. */
  peerIds(): string[] {
    return [...this.links.keys()];
  }

  /** Ids con los que viajan tu cámara y tu pantalla (se anuncian en Presence). */
  outStreamIds(): { camera: string; screen: string } {
    return { camera: this.cameraOut.id, screen: this.screenOut.id };
  }

  /** Micrófono: si ya hay emisor, se cambia la pista en caliente (replaceTrack). */
  setMicStream(stream: MediaStream | null): void {
    this.micStream = stream;
    this.micTrack = stream?.getAudioTracks()[0] ?? null;
    for (const link of this.links.values()) this.syncMicSender(link);
  }

  setScreenStream(stream: MediaStream | null): void {
    this.screenTrack = stream?.getVideoTracks()[0] ?? null;
    // Texto y líneas nítidos antes que fluidez (pantallas con código o planos).
    if (this.screenTrack && "contentHint" in this.screenTrack) this.screenTrack.contentHint = "detail";
    for (const link of this.links.values()) this.syncScreenSender(link);
  }

  /** Cámara: `null` la quita; otra pista la cambia en caliente (replaceTrack). */
  setCameraTrack(track: MediaStreamTrack | null): void {
    this.cameraTrack = track;
    for (const link of this.links.values()) this.syncCameraSender(link);
  }

  private syncMicSender(link: PeerLink): void {
    if (link.micSender) {
      // El emisor de audio es fijo: solo se cambia (o quita) su pista.
      void link.micSender.replaceTrack(this.micTrack).catch(() => undefined);
    } else if (this.micTrack && this.micStream) {
      link.micSender = link.pc.addTrack(this.micTrack, this.micStream);
    }
  }

  private syncScreenSender(link: PeerLink): void {
    link.screenSender = this.syncVideoSender(link, link.screenSender, this.screenTrack, this.screenOut);
    this.tuneVideoSenders(link);
  }

  private syncCameraSender(link: PeerLink): void {
    link.cameraSender = this.syncVideoSender(link, link.cameraSender, this.cameraTrack, this.cameraOut);
    this.tuneVideoSenders(link);
  }

  /**
   * Añade, cambia o quita una pista de vídeo de un enlace. Al quitarla se
   * conserva el emisor: al volver a compartir se reutiliza su transceptor
   * (renegociación limpia, sin acumular líneas en el SDP).
   */
  private syncVideoSender(
    link: PeerLink,
    sender: RTCRtpSender | null,
    track: MediaStreamTrack | null,
    outStream: MediaStream
  ): RTCRtpSender | null {
    const { pc } = link;
    if (track) {
      const transceiver = sender ? pc.getTransceivers().find((t) => t.sender === sender) : undefined;
      if (sender && transceiver && transceiver.direction !== "stopped") {
        void sender.replaceTrack(track).catch(() => undefined);
        // Volver a "enviar" dispara la renegociación (onnegotiationneeded).
        if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
        return sender;
      }
      return pc.addTrack(track, outStream);
    }
    if (sender?.track) {
      try {
        pc.removeTrack(sender);
      } catch {
        /* conexión cerrada */
      }
    }
    return sender;
  }

  /** Aplica el tope de bitrate (y fps de pantalla) a los emisores de vídeo activos. */
  private tuneVideoSenders(link: PeerLink): void {
    if (link.cameraSender?.track) tuneSender(link.cameraSender, CAMERA_MAX_BITRATE);
    if (link.screenSender?.track) tuneSender(link.screenSender, SCREEN_MAX_BITRATE, SCREEN_MAX_FRAMERATE);
  }

  private emit(peerId: string, state: LinkState | null): void {
    this.options.onLinkState?.(peerId, state);
  }

  private clearRecovery(link: PeerLink): void {
    if (link.recoveryTimer) clearTimeout(link.recoveryTimer);
    link.recoveryTimer = null;
  }

  /** Enlace caído: reinicia ICE con espera creciente; tras 2 intentos, rojo. */
  private recover(peerId: string, link: PeerLink): void {
    this.clearRecovery(link);
    if (this.links.get(peerId) !== link) return;
    if (link.iceRestarts >= MAX_ICE_RESTARTS) {
      this.emit(peerId, "failed");
      return;
    }
    link.iceRestarts += 1;
    this.emit(peerId, "reconnecting");
    const delay =
      RESTART_BACKOFF_MS * 2 ** (link.iceRestarts - 1) + (link.polite ? POLITE_RESTART_DELAY_MS : 0);
    link.recoveryTimer = setTimeout(() => {
      link.recoveryTimer = null;
      if (this.links.get(peerId) !== link) return;
      const ice = link.pc.iceConnectionState;
      if (ice === "connected" || ice === "completed" || ice === "closed") return;
      link.pc.restartIce();
      // Si el reinicio tampoco conecta, se intenta de nuevo (o se marca en rojo).
      link.recoveryTimer = setTimeout(() => this.recover(peerId, link), ICE_STUCK_MS);
    }, delay);
  }

  /** Crea (si falta) la conexión con `peerId` y le adjunta micrófono, cámara y pantalla. */
  ensurePeer(peerId: string): PeerLink | null {
    if (this.closed || peerId === this.options.selfId) return null;
    const existing = this.links.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const initiator = this.options.selfId > peerId;
    const link: PeerLink = {
      pc,
      polite: !initiator,
      makingOffer: false,
      ignoreOffer: false,
      initiator,
      negotiated: false,
      micSender: null,
      cameraSender: null,
      screenSender: null,
      recoveryTimer: null,
      iceRestarts: 0,
      pendingCandidates: [],
    };
    this.links.set(peerId, link);
    this.emit(peerId, "connecting");
    // Si la primera oferta se pierde (o nunca llega respuesta), el reinicio la reenvía.
    link.recoveryTimer = setTimeout(() => this.recover(peerId, link), ICE_STUCK_MS);

    pc.onnegotiationneeded = async () => {
      // Anti-glare: la primera oferta solo la envía el peer con el id mayor.
      if (!link.initiator && !link.negotiated) return;
      try {
        link.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.options.sendSignal({
            from: this.options.selfId,
            to: peerId,
            description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
          });
        }
      } catch (error) {
        console.warn("[Andros · sala] No se pudo crear la oferta WebRTC.", error);
      } finally {
        link.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.options.sendSignal({ from: this.options.selfId, to: peerId, candidate: candidate.toJSON() });
    };

    pc.oniceconnectionstatechange = () => {
      if (this.links.get(peerId) !== link) return;
      const ice = pc.iceConnectionState;
      if (ice === "connected" || ice === "completed") {
        this.clearRecovery(link);
        link.iceRestarts = 0;
        this.emit(peerId, "connected");
        this.tuneVideoSenders(link);
      } else if (ice === "failed") {
        this.recover(peerId, link);
      } else if (ice === "disconnected") {
        this.clearRecovery(link);
        this.emit(peerId, "reconnecting");
        link.recoveryTimer = setTimeout(() => this.recover(peerId, link), DISCONNECT_GRACE_MS);
      } else if (ice === "checking" || ice === "new") {
        // Durante un reinicio ya hay un temporizador de atasco en marcha.
        if (link.iceRestarts > 0) return;
        this.clearRecovery(link);
        this.emit(peerId, "connecting");
        link.recoveryTimer = setTimeout(() => this.recover(peerId, link), ICE_STUCK_MS);
      }
    };

    pc.ontrack = ({ track, streams, transceiver }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === "audio") {
        // Quien responde aún no tiene emisor de audio: se enlaza al transceptor
        // recibido y se le pone el micrófono ANTES de crear la respuesta.
        if (!link.micSender) {
          link.micSender = transceiver.sender;
          try {
            transceiver.direction = "sendrecv";
          } catch {
            /* transceptor detenido */
          }
          this.syncMicSender(link);
        }
        this.options.onRemoteAudio(peerId, stream);
      } else if (track.kind === "video") {
        // Cámara o pantalla: el id del flujo del emisor (anunciado en
        // Presence) dice cuál es. Cada una llega en su propio flujo.
        const streamId = streams[0]?.id ?? `track-${track.id}`;
        this.options.onRemoteVideo(peerId, streamId, new MediaStream([track]));
      }
    };

    // Quien inicia crea SIEMPRE el audio (con o sin micrófono) para poder
    // escuchar; la pista local ya va dentro antes de `createOffer`.
    if (initiator) {
      const transceiver = pc.addTransceiver(this.micTrack ?? "audio", {
        direction: "sendrecv",
        streams: this.micStream ? [this.micStream] : [],
      });
      link.micSender = transceiver.sender;
    } else {
      this.syncMicSender(link);
    }
    this.syncCameraSender(link);
    this.syncScreenSender(link);
    return link;
  }

  /** Procesa una señal (oferta, respuesta o candidato ICE) dirigida a ti. */
  async handleSignal(signal: RtcSignalPayload): Promise<void> {
    if (this.closed || signal.to !== this.options.selfId || typeof signal.from !== "string") return;
    let link = this.links.get(signal.from);
    if (!link) {
      // Solo una OFERTA abre un enlace: un candidato o una respuesta sin
      // enlace es un resto de una llamada que ya terminó.
      if (signal.description?.type !== "offer") return;
      if (this.options.acceptPeer && !this.options.acceptPeer(signal.from)) return;
      link = this.ensurePeer(signal.from) ?? undefined;
      if (!link) return;
    }
    const { pc } = link;

    try {
      if (signal.description) {
        const description = signal.description;
        const offerCollision =
          description.type === "offer" && (link.makingOffer || pc.signalingState !== "stable");
        link.ignoreOffer = !link.polite && offerCollision;
        if (link.ignoreOffer) return;

        await pc.setRemoteDescription(description);
        link.negotiated = true;
        // Candidatos que llegaron antes de la descripción remota.
        for (const candidate of link.pendingCandidates.splice(0)) {
          await pc.addIceCandidate(candidate).catch(() => undefined);
        }
        if (description.type === "offer") {
          await pc.setLocalDescription();
          if (pc.localDescription) {
            this.options.sendSignal({
              from: this.options.selfId,
              to: signal.from,
              description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
            });
          }
        }
        // Con la negociación hecha ya existen las codificaciones: se aplica el tope.
        this.tuneVideoSenders(link);
      } else if (signal.candidate) {
        if (!pc.remoteDescription) {
          link.pendingCandidates.push(signal.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (error) {
          if (!link.ignoreOffer) throw error;
        }
      }
    } catch (error) {
      console.warn("[Andros · sala] Señal WebRTC descartada.", error);
    }
  }

  /** Cierra la conexión con un participante que salió (o dejó la voz). */
  removePeer(peerId: string): void {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    this.closeLink(link);
    this.options.onRemoteAudio(peerId, null);
    this.options.onRemoteVideo(peerId, null, null);
    this.emit(peerId, null);
  }

  private closeLink(link: PeerLink): void {
    this.clearRecovery(link);
    link.pendingCandidates.length = 0;
    link.pc.onnegotiationneeded = null;
    link.pc.onicecandidate = null;
    link.pc.oniceconnectionstatechange = null;
    link.pc.ontrack = null;
    // Los tracks RECIBIDOS se detienen aquí; los propios los detiene la sala.
    for (const receiver of link.pc.getReceivers()) receiver.track?.stop();
    link.pc.close();
  }

  /** Cierra TODAS las conexiones (al salir de la llamada o desmontar). */
  closeAll(): void {
    this.closed = true;
    for (const [peerId, link] of this.links) {
      this.closeLink(link);
      this.options.onRemoteAudio(peerId, null);
      this.options.onRemoteVideo(peerId, null, null);
      this.emit(peerId, null);
    }
    this.links.clear();
    this.micTrack = null;
    this.micStream = null;
    this.screenTrack = null;
    this.cameraTrack = null;
  }
}

/**
 * Tope de subida de un emisor. Antes de negociar algunos navegadores aún no
 * tienen codificaciones: se vuelve a aplicar tras cada negociación.
 */
function tuneSender(sender: RTCRtpSender, maxBitrate: number, maxFramerate?: number): void {
  let params: RTCRtpSendParameters;
  try {
    params = sender.getParameters();
  } catch {
    return;
  }
  const encodings = params.encodings;
  if (!encodings || encodings.length === 0) return;
  const tuned = encodings.every(
    (e) => e.maxBitrate === maxBitrate && (maxFramerate === undefined || e.maxFramerate === maxFramerate)
  );
  if (tuned) return;
  for (const encoding of encodings) {
    encoding.maxBitrate = maxBitrate;
    if (maxFramerate !== undefined) encoding.maxFramerate = maxFramerate;
  }
  void sender.setParameters(params).catch(() => undefined);
}
