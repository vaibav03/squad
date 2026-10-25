import { describe, expect, it } from 'vitest';
import { LivePlayer, pcm16ToFloat32, scheduleStart } from './audio';

const b64 = (samples: number[]) => {
  const bytes = new Uint8Array(samples.length * 2);
  samples.forEach((v, i) => {
    const u = v < 0 ? v + 0x10000 : v;
    bytes[i * 2] = u & 255;
    bytes[i * 2 + 1] = u >> 8;
  });
  return Buffer.from(bytes).toString('base64');
};

function fakeCtx(state = 'running') {
  const started: { at: number; dur: number; stopped: boolean }[] = [];
  const ctx = {
    currentTime: 1,
    state,
    destination: {},
    resume: async () => {
      ctx.state = 'running';
    },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createAnalyser: () => ({ fftSize: 0, connect() {}, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) }),
    createBuffer: (_c: number, len: number, rate: number) => ({ duration: len / rate, copyToChannel() {} }),
    createBufferSource: () => {
      const rec = { at: 0, dur: 0, stopped: false };
      const src = {
        buffer: null as { duration: number } | null,
        onended: null as (() => void) | null,
        connect() {},
        start(t: number) {
          rec.at = t;
          rec.dur = src.buffer!.duration;
          started.push(rec);
        },
        stop() {
          rec.stopped = true;
        },
      };
      return src;
    },
  };
  return { ctx, started };
}

describe('audio math', () => {
  it('decodes 16-bit little-endian PCM', () => {
    const f = pcm16ToFloat32(b64([0, 16384, -16384, -32768]));
    expect(Array.from(f)).toEqual([0, 0.5, -0.5, -1]);
  });
  it('schedules back to back, with a jitter buffer only at the start or after an underrun', () => {
    expect(scheduleStart(1, 0)).toBeCloseTo(1.12);
    expect(scheduleStart(1, 1.5)).toBe(1.5);
    expect(scheduleStart(2, 1.5)).toBeCloseTo(2.12);
  });
});

describe('LivePlayer', () => {
  const chunk = (n: number) => b64(new Array(2400).fill(n)); // 100 ms

  it('queues chunks gaplessly per turn, in seq order', () => {
    const { ctx, started } = fakeCtx();
    const p = new LivePlayer({ enabled: true, createContext: () => ctx as never });
    p.enqueue('t1', 1, chunk(2)); // out of order: held
    expect(started).toHaveLength(0);
    p.enqueue('t1', 0, chunk(1));
    expect(started).toHaveLength(2);
    expect(started[0]!.at).toBeCloseTo(1.12);
    expect(started[1]!.at).toBeCloseTo(started[0]!.at + 0.1);
    expect(p.state).toBe('ready');
  });

  it('flush stops every source at once and silences the cut turn', () => {
    const { ctx, started } = fakeCtx();
    const p = new LivePlayer({ enabled: true, createContext: () => ctx as never });
    p.enqueue('t1', 0, chunk(1));
    p.enqueue('t1', 1, chunk(1));
    p.flush('t1');
    expect(started.every((s) => s.stopped)).toBe(true);
    p.enqueue('t1', 2, chunk(1));
    expect(started).toHaveLength(2);
    p.enqueue('t2', 0, chunk(1));
    expect(started).toHaveLength(3);
    expect(started[2]!.at).toBeCloseTo(1.12);
  });

  it('a suspended context reports locked until resume()', async () => {
    const { ctx } = fakeCtx('suspended');
    const p = new LivePlayer({ enabled: true, createContext: () => ctx as never });
    p.enqueue('t1', 0, chunk(1));
    expect(p.state).toBe('locked');
    await p.resume();
    expect(p.state).toBe('ready');
  });

  it('mute zeroes the gain; captions-only never creates a context', () => {
    let made = 0;
    const { ctx } = fakeCtx();
    const p = new LivePlayer({ enabled: true, createContext: () => (made++, ctx as never) });
    p.setMuted(true);
    p.enqueue('t1', 0, chunk(1));
    expect(p.state).toBe('muted');
    const off = new LivePlayer({ enabled: false, createContext: () => (made++, ctx as never) });
    off.enqueue('t1', 0, chunk(1));
    void off.resume();
    expect(off.state).toBe('off');
    expect(off.contextCreated).toBe(false);
    expect(made).toBe(1);
  });
});
