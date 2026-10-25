import { NAMESPACE } from './config';
import { isBridgeRequest } from './relay';
import { EXTENSION_MARKER_VALUE, extensionMarkerAttribute, extensionMessageTypes } from './wire';

const T = extensionMessageTypes(NAMESPACE);
document.documentElement.setAttribute(extensionMarkerAttribute(NAMESPACE), EXTENSION_MARKER_VALUE);

function announce() {
  document.dispatchEvent(new CustomEvent(T.ready));
  window.postMessage({ type: T.ready }, location.origin);
}
announce();
if (document.readyState !== 'complete') window.addEventListener('load', announce, { once: true });

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data as { requestId: string; message: unknown };
  if (!isBridgeRequest(d, NAMESPACE)) return;
  try {
    chrome.runtime.sendMessage({ kind: 'bridge', message: d.message }, (response: unknown) => {
      if (chrome.runtime.lastError || response === undefined) return;
      window.postMessage(
        { type: T.bridgeResponse, requestId: d.requestId, response },
        location.origin,
      );
    });
  } catch {
    /* extension reloaded */
  }
});
