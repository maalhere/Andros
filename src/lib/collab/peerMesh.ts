// ============================================================================
// ANDROS — MALLA WEBRTC PARA 2–6 PERSONAS ($0: sin servidor multimedia)
//
// Cada pareja de participantes tiene UN RTCPeerConnection que lleva su audio
// y, si alguien comparte, su pantalla. La señalización viaja por Supabase
// Broadcast. Se usa el patrón "negociación perfecta" (W3C) para que dos
// ofertas simultáneas no rompan la conexión: el peer con el id menor es el
// "educado" y cede.
// ============================================================================

import type { RtcSignalPayload } from "@/types/collab";

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

interface PeerLink {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  micSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  /** Candidatos ICE que llegaron antes de la descripción remota. */
  pendingCandidates: RTCIceCandidateInit[];
}

export interface PeerMeshOptions {
  selfId: string;
  sendSignal: (payload: RtcSignalPayload) => void;
  onRemoteAudio: (peerId: string, stream: MediaStream | null) => void;
  onRemoteScreen: (peerId: string, stream: MediaStream | null) => void;
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
    if (this.micTrack && this.micStream) {
      if (link.micSender) void link.micSender.replaceTrack(this.micTrack).catch(() => undefined);
      else link.micSender = link.pc.addTrack(this.micTrack, this.micStream);
    } else if (link.micSender) {
      try {
        link.pc.removeTrack(link.micSender);
      } catch {
        /* conexión cerrada */
      }
      link.micSender = null;
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
    const link: PeerLink = {
      pc,
      polite: this.options.selfId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      micSender: null,
      screenSender: null,
      pendingCandidates: [],
    };
    this.links.set(peerId, link);

    pc.onnegotiationneeded = async () => {
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
      if (pc.iceConnectionState === "failed") pc.restartIce();
    };

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === "audio") {
        this.options.onRemoteAudio(peerId, stream);
      } else if (track.kind === "video") {
        // La pantalla siempre llega en su propio flujo, separado del micrófono.
        this.options.onRemoteScreen(peerId, new MediaStream([track]));
      }
    };

    this.syncMicSender(link);
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
  }

  private closeLink(link: PeerLink): void {
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
    }
    this.links.clear();
    this.micTrack = null;
    this.micStream = null;
    this.screenTrack = null;
    this.screenStream = null;
  }
}
