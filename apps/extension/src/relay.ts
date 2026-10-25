import { extensionMessageTypes } from './wire';

/** A page-to-extension request: same shape Nook validates (type, requestId, namespaced inner message). */
export function isBridgeRequest(d: unknown, ns: string): boolean {
  if (!d || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  const m = r.message as Record<string, unknown> | undefined;
  return (
    r.type === extensionMessageTypes(ns).bridgeRequest &&
    typeof r.requestId === 'string' &&
    r.requestId.length > 0 &&
    !!m &&
    typeof m === 'object' &&
    typeof m.type === 'string' &&
    m.type.startsWith(`${ns}:`)
  );
}
