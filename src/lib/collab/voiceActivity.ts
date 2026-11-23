// ============================================================================
// ANDROS — DETECTOR LIGERO DE VOZ (AudioContext + AnalyserNode)
// Un solo AudioContext para todos los participantes; mide el nivel RMS cada
// ~120 ms y avisa solo cuando alguien EMPIEZA o DEJA de hablar.
// ============================================================================

const TICK_MS = 120;
/** Nivel RMS (0–1) a partir del cual se considera que alguien habla. */
const SPEAKING_THRESHOLD = 0.02;
/** Tiempo que el aro verde sigue encendido tras la última sílaba. */
const HOLD_MS = 350;

interface Entry {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  speaking: boolean;
  lastLoudAt: number;
  /** Último nivel RMS medido (0–1), para el medidor del micrófono. */
  level: number;
}

type AudioContextCtor = typeof AudioContext;

export class VoiceActivityMonitor {
  private context: AudioContext | null = null;
  private readonly entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onChange: (id: string, speaking: boolean) => void) {}

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === "undefined") return null;
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.context = new Ctor();
    } catch {
      return null;
    }
    return this.context;
  }

  /** Empieza a escuchar el nivel de `stream` bajo el id `id`. */
  watch(id: string, stream: MediaStream): void {
    this.unwatch(id);
    if (stream.getAudioTracks().length === 0) return;
    const context = this.ensureContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      // Solo se mide: el analizador NO se conecta a los altavoces.
      source.connect(analyser);
      this.entries.set(id, {
        source,
        analyser,
        buffer: new Float32Array(analyser.fftSize),
        speaking: false,
        lastLoudAt: 0,
        level: 0,
      });
    } catch {
      return;
    }
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  unwatch(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    try {
      entry.source.disconnect();
      entry.analyser.disconnect();
    } catch {
      /* ya desconectado */
    }
    this.entries.delete(id);
    if (entry.speaking) this.onChange(id, false);
    if (this.entries.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      entry.analyser.getFloatTimeDomainData(entry.buffer);
      let sum = 0;
      for (let i = 0; i < entry.buffer.length; i += 1) sum += entry.buffer[i] * entry.buffer[i];
      const rms = Math.sqrt(sum / entry.buffer.length);
      entry.level = rms;
      if (rms > SPEAKING_THRESHOLD) entry.lastLoudAt = now;
      const speaking = now - entry.lastLoudAt < HOLD_MS;
      if (speaking !== entry.speaking) {
        entry.speaking = speaking;
        this.onChange(id, speaking);
      }
    }
  }

  /** Nivel actual (0–1) de `id`, o 0 si no se está midiendo. */
  level(id: string): number {
    return this.entries.get(id)?.level ?? 0;
  }

  /** Reanuda el AudioContext si el navegador lo dejó suspendido. */
  async resume(): Promise<void> {
    if (this.context && this.context.state === "suspended") {
      await this.context.resume().catch(() => undefined);
    }
  }

  /** Libera todo (analizadores, temporizador y AudioContext). */
  dispose(): void {
    for (const id of [...this.entries.keys()]) this.unwatch(id);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }
}
