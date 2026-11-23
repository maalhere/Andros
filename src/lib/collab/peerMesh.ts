// ============================================================================
// ANDROS — MALLA WEBRTC PARA 2–6 PERSONAS ($0: sin servidor multimedia)
//
// Cada pareja de participantes tiene UN RTCPeerConnection que lleva su audio
// y, si alguien comparte, su pantalla. La señalización viaja por Supabase
// Broadcast. Para que dos ofertas simultáneas no rompan la conexión:
//   · La PRIMERA oferta la envía solo el peer con el id MAYOR (regla
//     determinista anti-glare); el menor solo responde.
//   · Una vez negociado, cualquiera puede renegociar (p. ej. al compartir
//     pantalla) con el patrón "negociación perfecta" (W3C): el id menor es el
//     "educado" y cede ante una colisión.
// Los candidatos ICE que llegan antes de la descripción remota se guardan en
// `pendingCandidates` y se aplican justo después de `setRemoteDescription`.
// ============================================================================

import type { RtcSignalPayload } from "@/types/collab";

/** Estado del enlace de audio con un participante (visible en la barra). */
export type LinkState = "connecting" | "connected" | "failed";

/** Tiempo máximo en «comprobando» antes de dar el enlace por restringido. */
const ICE_STUCK_MS = 15000;

/** STUN público por defecto; TURN opcional con variables NEXT_PUBLIC_TURN_*. */
export function buildRtcConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  // Acceso estático: Next.js solo sustituye `process.env.NEXT_PUBLIC_X` literal.
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL?.trim();
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME?.trim();
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
  if (turnUrl) {
    const urls = turnUrl
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    iceServers.push(
      turnUsername && turnCredential
        ? { urls, username: turnUsername, credential: turnCredential }
        : { urls }
    );
  }
  return { iceServers };
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
  screenSender: RTCRtpSender | null;
  stuckTimer: ReturnType<typeof setTimeout> | null;
  /** Candidatos ICE que llegaron antes de la descripción remota. */
  pendingCandidates: RTCIceCandidateInit[];
}

export interface PeerMeshOptions {
  selfId: string;
  sendSignal: (payload: RtcSignalPayload) => void;
  onRemoteAudio: (peerId: string, stream: MediaStream | null) => void;
  onRemoteScreen: (peerId: string, stream: MediaStream | null) => void;
  /** Estado real del enlace (`null` = enlace cerrado). */
  onLinkState?: (peerId: string, state: LinkState | null) => void;
}

export class PeerMesh {
  private readonly links = new Map<string, PeerLink>();
  private micTrack: MediaStreamTrack | null = null;
  private micStream: MediaStream | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private screenStream: MediaStream | null = null;
  private closed = false;

  constructor(private readonly options: PeerMeshOptions) {}

  /** Ids de los participantes con conexión abierta. */
  peerIds(): string[] {
    return [...this.links.keys()];
  }

  setMicStream(stream: MediaStream | null): void {
    this.micStream = stream;
    this.micTrack = stream?.getAudioTracks()[0] ?? null;
    for (const link of this.links.values()) this.syncMicSender(link);
  }

  setScreenStream(stream: MediaStream | null): void {
    this.screenStream = stream;
    this.screenTrack = stream?.getVideoTracks()[0] ?? null;
    for (const link of this.links.values()) this.syncScreenSender(link);
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
    if (this.screenTrack && this.screenStream) {
      if (link.screenSender) {
        void link.screenSender.replaceTrack(this.screenTrack).catch(() => undefined);
      } else {
        link.screenSender = link.pc.addTrack(this.screenTrack, this.screenStream);
      }
    } else if (link.screenSender) {
      try {
        link.pc.removeTrack(link.screenSender);
      } catch {
        /* conexión cerrada */
      }
      link.screenSender = null;
    }
  }

  /** Crea (si falta) la conexión con `peerId` y le adjunta micrófono y pantalla. */
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
      screenSender: null,
      stuckTimer: null,
      pendingCandidates: [],
    };
    this.links.set(peerId, link);
    this.options.onLinkState?.(peerId, "connecting");

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
      const ice = pc.iceConnectionState;
      if (link.stuckTimer) clearTimeout(link.stuckTimer);
      link.stuckTimer = null;
      if (ice === "connected" || ice === "completed") {
        this.options.onLinkState?.(peerId, "connected");
      } else if (ice === "failed") {
        this.options.onLinkState?.(peerId, "failed");
        pc.restartIce();
      } else {
        this.options.onLinkState?.(peerId, "connecting");
        if (ice === "checking" || ice === "disconnected") {
          link.stuckTimer = setTimeout(
            () => this.options.onLinkState?.(peerId, "failed"),
            ICE_STUCK_MS
          );
        }
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
        // La pantalla siempre llega en su propio flujo, separado del micrófono.
        this.options.onRemoteScreen(peerId, new MediaStream([track]));
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
    this.syncScreenSender(link);
    return link;
  }

  /** Procesa una señal (oferta, respuesta o candidato ICE) dirigida a ti. */
  async handleSignal(signal: RtcSignalPayload): Promise<void> {
    if (this.closed || signal.to !== this.options.selfId || typeof signal.from !== "string") return;
    const link = this.ensurePeer(signal.from);
    if (!link) return;
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

  /** Cierra la conexión con un participante que salió. */
  removePeer(peerId: string): void {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    this.closeLink(link);
    this.options.onRemoteAudio(peerId, null);
    this.options.onRemoteScreen(peerId, null);
    this.options.onLinkState?.(peerId, null);
  }

  private closeLink(link: PeerLink): void {
    if (link.stuckTimer) clearTimeout(link.stuckTimer);
    link.stuckTimer = null;
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
      this.options.onRemoteScreen(peerId, null);
      this.options.onLinkState?.(peerId, null);
    }
    this.links.clear();
    this.micTrack = null;
    this.micStream = null;
    this.screenTrack = null;
    this.screenStream = null;
  }
}
