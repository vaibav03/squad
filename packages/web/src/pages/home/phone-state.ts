import { useEffect, useState } from 'react';
import { getJson, obj, type HubCtx } from './setup-state';
import { notSetUp } from '../../lib/state-labels';

/** What the iMessage bridge really is on the server, in customer words (GET /v1/imessage/status). */
export type PhoneBridge = 'unknown' | 'off' | 'practice' | 'dry' | 'live';

export function bridgeFrom(raw: unknown): PhoneBridge {
  const o = obj(raw);
  if (o.enabled !== true) return 'off';
  if (o.mode === 'fixture') return 'practice';
  if (o.mode === 'dry_run') return 'dry';
  return 'live';
}

export function bridgeNote(b: PhoneBridge, linked: boolean): string {
  if (linked) return b === 'practice' ? 'Practice mode: texts are simulated' : 'Connected';
  switch (b) {
    case 'off':
      return notSetUp('the Sendblue settings');
    case 'practice':
      return 'Practice mode: texts are simulated, nothing is really sent';
    case 'dry':
      return 'Dry run: messages are prepared but not sent';
    case 'live':
      return 'Link your number so your agent can text you';
    default:
      return 'Checking...';
  }
}

export function usePhoneBridge(ctx: HubCtx): PhoneBridge {
  const [b, setB] = useState<PhoneBridge>('unknown');
  const { hubUrl, token } = ctx;
  useEffect(() => {
    if (!hubUrl || !token) return;
    let dead = false;
    getJson({ hubUrl, token }, '/v1/imessage/status').then(
      (r) => !dead && setB(bridgeFrom(r)),
      () => !dead && setB('unknown'),
    );
    return () => {
      dead = true;
    };
  }, [hubUrl, token]);
  return b;
}
