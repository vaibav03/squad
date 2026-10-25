import type { VoiceOption } from './fixtures';

export type PreviewState = 'idle' | 'loading' | 'playing' | 'blocked' | 'unsupported' | 'error';

/**
 * Plays a short voice sample and reports amplitude. Interface for the media workstream:
 * replace `PreviewPlayer.source` with a function that returns an audio Blob (POST /v1/voices/preview)
 * and the rest (levels, single playback, state) keeps working. In mock mode we synthesize a
 * deterministic, voice-like phrase with WebAudio so the picker works before real audio lands.
 */
export interface PreviewPlayerLike {
  play(voice: VoiceOption, text: string): Promise<void>;
  stop(): void;
  onLevel(cb: (level: number) => void): () => void;
  onState(cb: (s: PreviewState) => void): () => void;
}

export interface SynthPlan {
  duration: number;
  syllables: { t: number; len: number; f0: number; formants: [number, number, number] }[];
  vibratoHz: number;
  vibratoDepth: number;
}

// vowel formants (F1,F2,F3) in Hz: a, e, i, o, u, schwa-ish
const VOWELS: [number, number, number][] = [
  [800, 1200, 2500],
  [500, 1900, 2600],
  [320, 2300, 3000],
  [500, 900, 2400],
  [330, 800, 2300],
  [600, 1400, 2500],
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Pure, deterministic: same voice and text give the same plan. */
export function buildSynthPlan(
  voice: Pick<VoiceOption, 'seed' | 'pitch'>,
  text: string,
): SynthPlan {
  const r = rng(voice.seed + text.length * 31);
  const count = Math.min(14, Math.max(6, Math.round(text.length / 5)));
  const tempo = 0.16 + r() * 0.08;
  const syllables: SynthPlan['syllables'] = [];
  let t = 0.05;
  let f0 = voice.pitch;
  for (let i = 0; i < count; i++) {
    const v = VOWELS[Math.floor(r() * VOWELS.length)]!;
    const scale = 1 + (voice.pitch - 150) / 900;
    const len = tempo * (0.7 + r() * 0.8);
    f0 = voice.pitch * (0.9 + r() * 0.25) * (i === count - 1 ? 0.88 : 1);
    syllables.push({ t, len, f0, formants: [v[0] * scale, v[1] * scale, v[2] * scale] });
    t += len + (i % 4 === 3 ? 0.08 : 0.015);
  }
  return { duration: t + 0.2, syllables, vibratoHz: 4.5 + r() * 1.5, vibratoDepth: 2 + r() * 3 };
}

export class PreviewPlayer implements PreviewPlayerLike {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stopFns: (() => void)[] = [];
  private raf = 0;
  private levelCbs = new Set<(l: number) => void>();
  private stateCbs = new Set<(s: PreviewState) => void>();
  private token = 0;

  onLevel(cb: (l: number) => void) {
    this.levelCbs.add(cb);
    return () => {
      this.levelCbs.delete(cb);
    };
  }
  onState(cb: (s: PreviewState) => void) {
    this.stateCbs.add(cb);
    return () => {
      this.stateCbs.delete(cb);
    };
  }
  private emit(s: PreviewState) {
    this.stateCbs.forEach((c) => c(s));
  }

  stop() {
    this.token++;
    this.stopFns.forEach((f) => f());
    this.stopFns = [];
    cancelAnimationFrame(this.raf);
    this.levelCbs.forEach((c) => c(0));
    this.emit('idle');
  }

  /** Real audio from the hub (audio/mpeg). Same levels and state reporting as the synth path. */
  async playBlob(blob: Blob): Promise<void> {
    this.stop();
    const my = ++this.token;
    const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined;
    if (!Ctor) {
      this.emit('unsupported');
      return;
    }
    this.emit('loading');
    try {
      this.ctx ??= new Ctor();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const audio = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      if (my !== this.token) return;
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = audio;
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      an.connect(ctx.destination);
      src.start();
      this.stopFns.push(() => {
        try {
          src.stop();
        } catch {
          /* ended */
        }
      });
      this.emit('playing');
      const buf = new Uint8Array(an.fftSize);
      const t0 = ctx.currentTime;
      const tick = () => {
        if (my !== this.token) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const b of buf) {
          const v = (b - 128) / 128;
          sum += v * v;
        }
        this.levelCbs.forEach((c) => c(Math.min(1, Math.sqrt(sum / buf.length) * 5)));
        if (ctx.currentTime - t0 > audio.duration) {
          this.stop();
          return;
        }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    } catch {
      this.emit('error');
    }
  }

  async play(voice: VoiceOption, text: string): Promise<void> {
    this.stop();
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctor) {
      this.emit('unsupported');
      return;
    }
    const my = ++this.token;
    this.emit('loading');
    try {
      this.ctx ??= new Ctor();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch {
      this.emit('blocked');
      return;
    }
    if (this.ctx.state !== 'running') {
      this.emit('blocked');
      return;
    }
    if (my !== this.token) return;
    const ctx = this.ctx;
    const plan = buildSynthPlan(voice, text);
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    master.connect(an);
    an.connect(ctx.destination);
    this.analyser = an;
    const t0 = ctx.currentTime + 0.03;
    const nodes: AudioScheduledSourceNode[] = [];
    for (const s of plan.syllables) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(s.f0, t0 + s.t);
      osc.frequency.linearRampToValueAtTime(s.f0 * 0.96, t0 + s.t + s.len);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = plan.vibratoHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = plan.vibratoDepth;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0 + s.t);
      env.gain.linearRampToValueAtTime(0.22, t0 + s.t + 0.03);
      env.gain.setTargetAtTime(0, t0 + s.t + s.len * 0.7, 0.03);
      s.formants.forEach((f, i) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = 6 + i * 3;
        const g = ctx.createGain();
        g.gain.value = [1, 0.7, 0.35][i]!;
        osc.connect(bp);
        bp.connect(g);
        g.connect(env);
      });
      env.connect(master);
      osc.start(t0 + s.t);
      lfo.start(t0 + s.t);
      osc.stop(t0 + s.t + s.len + 0.2);
      lfo.stop(t0 + s.t + s.len + 0.2);
      nodes.push(osc, lfo);
    }
    this.stopFns.push(() => {
      nodes.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      });
      try {
        master.disconnect();
        an.disconnect();
      } catch {
        /* ok */
      }
    });
    this.emit('playing');
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (my !== this.token) return;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) {
        const v = (b - 128) / 128;
        sum += v * v;
      }
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 5);
      this.levelCbs.forEach((c) => c(level));
      if (ctx.currentTime - t0 > plan.duration) {
        this.stop();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}
