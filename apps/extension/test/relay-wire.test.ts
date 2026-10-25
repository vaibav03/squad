import { describe, expect, it } from 'vitest';
import { isBridgeRequest } from '../src/relay';
import {
  EXTENSION_MARKER_VALUE,
  extensionMarkerAttribute,
  extensionMessageTypes,
} from '../src/wire';

describe('wire and relay (Nook parity P23)', () => {
  it('uses the squad namespace', () => {
    const T = extensionMessageTypes('squad');
    expect(T.canvasAuthorize).toBe('squad:canvas-authorize');
    expect(T.bridgeResponse).toBe('squad:bridge-response');
    expect(T.canvasOpenSignIn).toBe('squad:canvas-open-sign-in');
    expect(extensionMarkerAttribute('squad')).toBe('data-squad-extension');
    expect(EXTENSION_MARKER_VALUE).toBe('1');
  });
  it('validates bridge requests', () => {
    const ok = { type: 'squad:bridge-request', requestId: 'r1', message: { type: 'squad:ping' } };
    expect(isBridgeRequest(ok, 'squad')).toBe(true);
    expect(isBridgeRequest({ ...ok, requestId: '' }, 'squad')).toBe(false);
    expect(isBridgeRequest({ ...ok, message: { type: 'nook:ping' } }, 'squad')).toBe(false);
    expect(isBridgeRequest({ ...ok, type: 'squad:other' }, 'squad')).toBe(false);
    expect(isBridgeRequest(null, 'squad')).toBe(false);
    expect(isBridgeRequest({ ...ok, message: null }, 'squad')).toBe(false);
  });
});
