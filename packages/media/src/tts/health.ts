import { VoicesUnavailableError, type TtsReason } from '@squad/core';
import type { VoiceStore } from '../voices/store';
import { TtsHttpError, type SynthRequest } from './types';

/**
 * Truthful speech status. One tiny synthesis per candidate voice decides whether ElevenLabs can really speak
 * with this key and plan, once at startup and again every 10 minutes (lazily, never on a caller's path).
 *
 * Verified against the ElevenLabs API reference (2026-10): POST /v1/text-to-speech/{voice_id} (xi-api-key),
 * POST /v1/text-to-voice/design (voice_description) + POST /v1/text-to-voice (needs the `voices_write`
 * permission), GET /v2/voices (needs `voices_read`). Free plans answer 402 `paid_plan_required` for library voices.
 */
export interface TtsProbeEngine {
  synth(r: SynthRequest): Promise<unknown>;
  listVoices?(maxPages?: number): Promise<{ id: string; name: string; category?: string }[]>;
  designVoice?(description: string): Promise<{ generatedVoiceId: string }[]>;
  saveVoice?(generatedVoiceId: string, name: string, description: string): Promise<string>;
}

export interface TtsHealthStatus {
  tts: 'elevenlabs' | 'none';
  reason: TtsReason;
  /** true only while the first probe is in flight */
  probing: boolean;
  since?: number;
  lastProbeAt?: number;
  nextProbeAt?: number;
}

export interface TtsHealthOptions {
  /** Absent means no key: status is `none / no_key` and nothing is called. */
  engine?: TtsProbeEngine;
  store: VoiceStore;
  /** Voice ids the owner chose (ELEVENLABS_VOICE_ID, ELEVENLABS_FALLBACK_VOICE_ID); tried before anything else. */
  ownVoiceIds?: string[];
  /** Stock library voice, tried last: it works on plans that allow API voices and proves `paid_plan_required` on free ones. */
  stockVoiceId: string;
  now?: () => number;
  /** Re-probe spacing (default 10 min). */
  everyMs?: number;
  /** Voice design + save creates a voice in the account; `pnpm doctor` turns it off (read-only report). Default true. */
  allowDesign?: boolean;
  /** Per-probe deadline (default 8 s). */
  timeoutMs?: number;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
}

export const DESIGN_DESCRIPTION =
  'A warm, clear young adult study-buddy narrator with a friendly, steady pace';
export const DEFAULT_VOICE_KEY = 'squad-default';
const MAX_OWN = 3;
const MAX_LISTED = 3;

type Verdict = 'key_restricted' | 'paid_plan_required' | 'rate_limited' | 'unavailable' | 'voice';

/** Maps an ElevenLabs failure to what it means for speech as a whole. */
export function classifyTtsError(e: unknown): Verdict {
  if (e instanceof TtsHttpError) {
    const d = e.detail.toLowerCase();
    if (e.status === 401 || e.status === 403) {
      return /quota_exceeded/.test(d) ? 'rate_limited' : 'key_restricted';
    }
    if (e.status === 402) return /quota|credit/.test(d) ? 'rate_limited' : 'paid_plan_required';
    if (e.status === 429) return 'rate_limited';
    if (e.status === 404 || e.status === 400 || e.status === 422) return 'voice';
    return 'unavailable';
  }
  return 'unavailable';
}

export class TtsHealth {
  private st: TtsHealthStatus;
  private voice: string | undefined;
  private flight: Promise<TtsHealthStatus> | undefined;
  private started = false;
  private readonly now: () => number;

  constructor(private readonly o: TtsHealthOptions) {
    this.now = o.now ?? Date.now;
    this.st = o.engine
      ? { tts: 'none', reason: 'unavailable', probing: true }
      : { tts: 'none', reason: 'no_key', probing: false };
  }

  /** Current truth. A stale verdict kicks one background re-probe; the answer returned is the cached one. */
  status(): TtsHealthStatus {
    if (this.o.engine) {
      if (!this.started) void this.start();
      else if (
        !this.flight &&
        this.st.nextProbeAt !== undefined &&
        this.now() >= this.st.nextProbeAt
      )
        void this.probe();
    }
    return { ...this.st };
  }

  /** The voice id proven usable, if any. */
  voiceId(): string | undefined {
    return this.st.tts === 'elevenlabs' ? this.voice : undefined;
  }

  /** Starts the first probe (idempotent) and resolves with its result. Never rejects. */
  start(): Promise<TtsHealthStatus> {
    this.started = true;
    return this.o.engine ? this.probe() : Promise.resolve({ ...this.st });
  }

  /** Resolves once any probe in flight is done (immediately otherwise). */
  async ready(): Promise<TtsHealthStatus> {
    if (this.o.engine && !this.started) await this.start();
    else if (this.flight) await this.flight;
    return { ...this.st };
  }

  /** Throws `VoicesUnavailableError` unless speech is proven to work; waits for a probe in flight. */
  async gate(): Promise<void> {
    const s = await this.ready();
    if (s.tts !== 'elevenlabs')
      throw new VoicesUnavailableError(s.reason as Exclude<TtsReason, 'ok'>);
    this.status(); // schedule a re-probe when stale
  }

  private probe(): Promise<TtsHealthStatus> {
    if (this.flight) return this.flight;
    this.flight = (async () => {
      const t0 = this.now();
      let result: { ok: true; voiceId: string } | { ok: false; reason: TtsReason };
      try {
        result = await this.deadline(this.run());
      } catch {
        result = { ok: false, reason: 'unavailable' };
      }
      const at = this.now();
      const every = this.o.everyMs ?? 600_000;
      const changed =
        this.st.tts !== (result.ok ? 'elevenlabs' : 'none') ||
        this.st.reason !== (result.ok ? 'ok' : result.reason);
      if (result.ok) {
        this.voice = result.voiceId;
        this.st = {
          tts: 'elevenlabs',
          reason: 'ok',
          probing: false,
          since: changed ? at : (this.st.since ?? at),
          lastProbeAt: at,
          nextProbeAt: at + every,
        };
      } else {
        this.voice = undefined;
        this.st = {
          tts: 'none',
          reason: result.reason,
          probing: false,
          since: changed ? at : (this.st.since ?? at),
          lastProbeAt: at,
          nextProbeAt: at + every,
        };
      }
      this.o.log?.('tts probe done', { tts: this.st.tts, reason: this.st.reason, ms: at - t0 });
      return this.st;
    })().finally(() => {
      this.flight = undefined;
    });
    return this.flight;
  }

  private deadline<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('tts probe timed out')),
        this.o.timeoutMs ?? 8000,
      );
      t.unref?.();
      p.then(resolve, reject).finally(() => clearTimeout(t));
    });
  }

  /** Candidates in order; the first voice that synthesizes one character wins. Stops early on key or rate problems. */
  private async run(): Promise<{ ok: true; voiceId: string } | { ok: false; reason: TtsReason }> {
    const eng = this.o.engine!;
    const tried = new Set<string>();
    const verdicts: Verdict[] = [];
    let stop: Verdict | undefined;
    const attempt = async (id: string): Promise<boolean> => {
      if (stop || tried.has(id)) return false;
      tried.add(id);
      try {
        await eng.synth({ voiceId: id, text: 'a', model: 'flash' });
        return true;
      } catch (e) {
        const v = classifyTtsError(e);
        verdicts.push(v);
        if (v === 'key_restricted' || v === 'rate_limited' || v === 'unavailable') stop = v;
        return false;
      }
    };

    // 1. a voice the owner saved or named: it belongs to this account, so no plan gate applies
    const own = [
      ...new Set([...Object.values(this.o.store.all()), ...(this.o.ownVoiceIds ?? [])]),
    ].filter(Boolean);
    for (const id of own.slice(0, MAX_OWN)) if (await attempt(id)) return { ok: true, voiceId: id };

    // 2. voice design then save (needs the voices_write permission; without it the call fails fast and is skipped)
    if (!stop && this.o.allowDesign !== false && eng.designVoice && eng.saveVoice) {
      try {
        const previews = await eng.designVoice(DESIGN_DESCRIPTION);
        const first = previews[0];
        if (first) {
          const id = await eng.saveVoice(
            first.generatedVoiceId,
            'Squad narrator',
            DESIGN_DESCRIPTION,
          );
          this.o.store.set(DEFAULT_VOICE_KEY, id);
          if (await attempt(id)) return { ok: true, voiceId: id };
        }
      } catch (e) {
        if (classifyTtsError(e) === 'rate_limited') stop = 'rate_limited';
      }
    }

    // 3. the account's own listed voices (needs voices_read)
    if (!stop && eng.listVoices) {
      try {
        const listed = (await eng.listVoices(1)).filter((v) => !tried.has(v.id));
        for (const v of listed.slice(0, MAX_LISTED))
          if (await attempt(v.id)) return { ok: true, voiceId: v.id };
      } catch (e) {
        if (classifyTtsError(e) === 'rate_limited') stop = 'rate_limited';
      }
    }

    // 4. the stock library voice: proves `paid_plan_required` on free plans, works on plans that allow it
    if (await attempt(this.o.stockVoiceId)) return { ok: true, voiceId: this.o.stockVoiceId };

    const pick = (v: Verdict) => verdicts.includes(v);
    const reason: TtsReason = pick('key_restricted')
      ? 'key_restricted'
      : pick('paid_plan_required')
        ? 'paid_plan_required'
        : pick('rate_limited')
          ? 'rate_limited'
          : 'unavailable';
    return { ok: false, reason };
  }
}

/** Process-wide instance per API key so the hub, the bot skills and the ports all share one verdict. */
const shared = new Map<string, TtsHealth>();
export function sharedTtsHealth(key: string, make: () => TtsHealth): TtsHealth {
  let h = shared.get(key);
  if (!h) shared.set(key, (h = make()));
  return h;
}
