import { useMemo } from 'react';
import type { HubCtx } from '../pages/village/hub';
import { mockLiveTransport } from './fixtures';
import { hubLiveTransport, liveErrorKind, type LiveTransport } from './live-client';

/** `?livemock=1` forces the scripted discussion. */
export const livemockOn = (): boolean =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('livemock') === '1';

/**
 * The real hub transport, except when `?livemock=1` is set, there is no hub, or the hub has no `/v1/live` route yet
 * (404 on start): then the scripted Demo transport takes over so the whole UI still works.
 */
export function chooseTransport(hub: HubCtx | null): LiveTransport {
  if (livemockOn() || !hub) return mockLiveTransport();
  const real = hubLiveTransport(hub);
  let cur: LiveTransport = real;
  const mock = mockLiveTransport();
  return {
    get mock() {
      return cur.mock;
    },
    start: async (b) => {
      try {
        return await real.start(b);
      } catch (e) {
        if (liveErrorKind(e) !== 'not_found') throw e;
        cur = mock;
        return mock.start(b);
      }
    },
    get: (id) => cur.get(id),
    open: (id, h) => cur.open(id, h),
    say: (id, b) => cur.say(id, b),
    stop: (id) => cur.stop(id),
    postToChat: (id) => cur.postToChat(id),
    makeQuiz: (id) => cur.makeQuiz(id),
    addToPlan: (id) => cur.addToPlan(id),
  };
}

export function useLiveTransport(hub: HubCtx | null, override?: LiveTransport): LiveTransport {
  const url = hub?.hubUrl;
  const token = hub?.token;
  return useMemo(() => override ?? chooseTransport(hub), [override, url, token]);
}
