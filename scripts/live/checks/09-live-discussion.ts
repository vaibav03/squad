// One tiny REAL Gemini Live call (manual, never part of ALL_CHECKS or `pnpm check`): connect, send one short text,
// read the output transcript, close. Costs a few cents at most; never loops. Guarded: needs GEMINI_API_KEY and
// LIVE_DISCUSSION_REAL=1.   Run: LIVE_DISCUSSION_REAL=1 pnpm --dir scripts/live exec tsx checks/09-live-discussion.ts
// Exit codes: 0 pass, 1 fail, 2 skipped (guard not set). Close reasons are mapped like apps/hub/src/live/gemini-client.ts.
import { GoogleGenAI, Modality } from '@google/genai';

const kind = (reason: string): string =>
  /credits|prepayment|depleted|billing/i.test(reason)
    ? 'credits'
    : /api key|permission|unauth|denied/i.test(reason)
      ? 'auth'
      : /quota|rate|exhausted/i.test(reason)
        ? 'rate_limited'
        : 'unavailable';

async function main(): Promise<number> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || process.env.LIVE_DISCUSSION_REAL !== '1') {
    console.log('SKIP live discussion: set GEMINI_API_KEY and LIVE_DISCUSSION_REAL=1 to run the one real call');
    return 2;
  }
  const model = process.env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
  const ai = new GoogleGenAI({ apiKey: key });
  let transcript = '';
  let failure = '';
  let done: () => void = () => undefined;
  const finished = new Promise<void>((r) => (done = r));
  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: 'You are a study buddy. Reply with one short sentence.',
      outputAudioTranscription: {},
    },
    callbacks: {
      onmessage: (m) => {
        const sc = m.serverContent;
        if (sc?.outputTranscription?.text) transcript += sc.outputTranscription.text;
        if (sc?.turnComplete) done();
      },
      onerror: (e) => {
        failure = `error: ${(e as Error).message ?? 'unknown'}`;
        done();
      },
      onclose: (e) => {
        if (!transcript) failure = `closed ${e.code ?? ''} (${kind(e.reason ?? '')}): ${e.reason ?? ''}`;
        done();
      },
    },
  }).catch((e: unknown) => {
    failure = `connect failed (${kind(String(e))})`;
    return undefined;
  });
  if (session) {
    session.sendRealtimeInput({ text: 'Say hello and name one fact about averages.' });
    await Promise.race([finished, new Promise((r) => setTimeout(r, 20_000))]);
    session.close();
  }
  if (transcript.trim()) {
    console.log(`PASS live discussion: ${model} said "${transcript.trim().slice(0, 120)}"`);
    return 0;
  }
  console.log(`FAIL live discussion: ${failure || 'no transcript within 20s'}`);
  return 1;
}

main().then((c) => process.exit(c));
