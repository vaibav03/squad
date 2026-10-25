/** Web Audio playback of 24 kHz 16-bit PCM chunks, plus push-to-talk helpers. No key or model call in the browser. */

export const LIVE_RATE = 24000;
export const PREBUFFER_S = 0.12;

/** Base64 little-endian 16-bit mono PCM to Float32 in [-1, 1). */
export function pcm16ToFloat32(b64: string): Float32Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const n = Math.floor(bin.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

/**
 * When does the next chunk start? Back to back with the previous one while the queue is ahead of the clock; after an
 * underrun (or at the start) wait for a small jitter buffer so playback does not stutter.
 */
export function scheduleStart(now: number, nextTime: number, prebuffer = PREBUFFER_S): number {
  return nextTime > now ? nextTime : now + prebuffer;
}

export type SoundState = 'off' | 'idle' | 'locked' | 'ready' | 'muted';

interface CtxLike {
  currentTime: number;
  state: string;
  destination: unknown;
  resume(): Promise<void>;
  close?(): Promise<void>;
  createGain(): { gain: { value: number }; connect(n: unknown): void };
  createAnalyser(): {
    fftSize: number;
    connect(n: unknown): void;
    getByteTimeDomainData(a: Uint8Array): void;
  };
  createBuffer(ch: number, len: number, rate: number): {
    duration: number;
    copyToChannel(d: Float32Array, c: number): void;
  };
  createBufferSource(): {
    buffer: unknown;
    onended: (() => void) | null;
    connect(n: unknown): void;
    start(t: number): void;
    stop(): void;
  };
}

export interface LivePlayerOptions {
  /** `false` is captions-only: no AudioContext is ever created. */
  enabled: boolean;
  createContext?: () => CtxLike;
}

/** Per-turn ordered queue with gapless scheduling, a level analyser and an instant `flush()`. */
export class LivePlayer {
  private ctx: CtxLike | null = null;
  private gain: ReturnType<CtxLike['createGain']> | null = null;
  private analyser: ReturnType<CtxLike['createAnalyser']> | null = null;
  private nextTime = 0;
  private sources = new Set<ReturnType<CtxLike['createBufferSource']>>();
  /** turn id -> {next expected seq, held out-of-order chunks} */
  private turns = new Map<string, { next: number; held: Map<number, Float32Array> }>();
  private muted = false;
  private buf = new Uint8Array(256);
  private listeners = new Set<() => void>();
  private cut = new Set<string>();

  constructor(private opts: LivePlayerOptions) {}

  get enabled() {
    return this.opts.enabled;
  }
  get state(): SoundState {
    if (!this.opts.enabled) return 'off';
    if (this.muted) return 'muted';
    if (!this.ctx) return 'idle';
    return this.ctx.state === 'running' ? 'ready' : 'locked';
  }
  get contextCreated() {
    return this.ctx !== null;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  private ensure(): CtxLike | null {
    if (!this.opts.enabled) return null;
    if (this.ctx) return this.ctx;
    const make =
      this.opts.createContext ??
      (() => {
        const C =
          (globalThis as unknown as { AudioContext?: new () => CtxLike }).AudioContext ??
          (globalThis as unknown as { webkitAudioContext?: new () => CtxLike }).webkitAudioContext;
        if (!C) throw new Error('no audio');
        return new C();
      });
    try {
      this.ctx = make();
    } catch {
      this.opts.enabled = false;
      this.emit();
      return null;
    }
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : 1;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.emit();
    return this.ctx;
  }

  /** Call from a user gesture (any click in the panel) to unlock autoplay. */
  async resume() {
    const c = this.ensure();
    if (!c) return;
    if (c.state !== 'running') {
      try {
        await c.resume();
      } catch {
        /* still locked */
      }
    }
    this.emit();
  }

  /** Queue one chunk. Chunks of a cut turn are dropped; out-of-order chunks wait for their predecessor. */
  enqueue(turnId: string, seq: number, pcm: string) {
    if (!this.opts.enabled || this.cut.has(turnId)) return;
    const c = this.ensure();
    if (!c) return;
    const t = this.turns.get(turnId) ?? { next: 0, held: new Map<number, Float32Array>() };
    this.turns.set(turnId, t);
    t.held.set(seq, pcm16ToFloat32(pcm));
    for (let d = t.held.get(t.next); d; d = t.held.get(t.next)) {
      t.held.delete(t.next);
      t.next += 1;
      this.play(c, d);
    }
    this.emit();
  }

  private play(c: CtxLike, data: Float32Array) {
    if (!data.length || !this.gain) return;
    const b = c.createBuffer(1, data.length, LIVE_RATE);
    b.copyToChannel(data, 0);
    const src = c.createBufferSource();
    src.buffer = b;
    src.connect(this.gain);
    const at = scheduleStart(c.currentTime, this.nextTime);
    src.start(at);
    this.nextTime = at + b.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      this.emit();
    };
  }

  /** Stop everything now (the user interrupted). The cut turn stays silent even if more chunks arrive. */
  flush(turnId?: string) {
    if (turnId) this.cut.add(turnId);
    else for (const id of this.turns.keys()) this.cut.add(id);
    for (const s of this.sources) {
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.turns.clear();
    this.nextTime = 0;
    this.emit();
  }

  /** Is something audible queued or playing right now? */
  get speaking(): boolean {
    return this.sources.size > 0;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.gain) this.gain.gain.value = m ? 0 : 1;
    this.emit();
  }
  get isMuted() {
    return this.muted;
  }

  /** 0..1 output level for the waveform and speaker ring. */
  level(): number {
    if (!this.analyser || this.muted) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let peak = 0;
    for (const v of this.buf) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(1, peak / 64);
  }

  dispose() {
    this.flush();
    void this.ctx?.close?.();
    this.ctx = null;
    this.listeners.clear();
  }
}

// ---- push to talk ----

export type TalkState = 'idle' | 'listening' | 'denied' | 'unsupported';

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function getRecognitionCtor(): (new () => RecognitionLike) | null {
  const g = globalThis as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

export interface Talk {
  start(): void;
  /** Stops listening; the final text (if any) goes to `onFinal`. */
  stop(): void;
  dispose(): void;
}

export interface TalkHandlers {
  onState(s: TalkState): void;
  onFinal(text: string): void;
  onLevel?(l: number): void;
}

/**
 * Local transcription with the browser's SpeechRecognition. The mic level meter opens `getUserMedia` only while the
 * user is talking and only if permission is allowed; a denied or missing mic reports `denied` / `unsupported`.
 */
export function createTalk(h: TalkHandlers): Talk {
  const Ctor = getRecognitionCtor();
  let rec: RecognitionLike | null = null;
  let transcript = '';
  let stream: MediaStream | null = null;
  let raf = 0;
  let meterCtx: AudioContext | null = null;
  let active = false;

  const stopMeter = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void meterCtx?.close();
    meterCtx = null;
    h.onLevel?.(0);
  };
  const startMeter = async () => {
    if (!h.onLevel || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active) return s.getTracks().forEach((t) => t.stop());
      stream = s;
      meterCtx = new AudioContext();
      const an = meterCtx.createAnalyser();
      an.fftSize = 256;
      meterCtx.createMediaStreamSource(s).connect(an);
      const data = new Uint8Array(256);
      const tick = () => {
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        h.onLevel?.(Math.min(1, peak / 64));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      h.onState('denied');
    }
  };

  return {
    start() {
      if (active) return;
      if (!Ctor) return h.onState('unsupported');
      active = true;
      transcript = '';
      rec = new Ctor();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i]![0]!.transcript;
        transcript = t;
      };
      rec.onerror = (e) => {
        active = false;
        stopMeter();
        h.onState(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : 'idle');
      };
      rec.onend = () => {
        active = false;
        stopMeter();
        h.onState('idle');
        const text = transcript.trim();
        transcript = '';
        if (text) h.onFinal(text);
      };
      try {
        rec.start();
        h.onState('listening');
        void startMeter();
      } catch {
        active = false;
        h.onState('idle');
      }
    },
    stop() {
      if (!active) return;
      active = false;
      rec?.stop();
      stopMeter();
    },
    dispose() {
      active = false;
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      rec = null;
      stopMeter();
    },
  };
}
