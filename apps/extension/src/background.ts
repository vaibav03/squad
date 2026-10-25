import { createExtensionAuth } from './auth';
import { createCanvasClient } from './canvas';
import { HUB_BASE, NAMESPACE, WEB_ORIGIN } from './config';
import { createHandler } from './protocol';
import { chromeStateStore } from './state';

const store = chromeStateStore();
const auth = createExtensionAuth(HUB_BASE, store);
const canvas = createCanvasClient();
const handle = createHandler({
  namespace: NAMESPACE,
  hubBase: HUB_BASE,
  store,
  auth,
  canvas,
  fetch: (...a) => fetch(...a),
  openSignIn: () => chrome.runtime.openOptionsPage(),
  log: (...a) => console.warn(...a),
});

function originOf(sender: chrome.runtime.MessageSender): string | null {
  if (sender.origin && sender.origin !== 'null') return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : null;
  } catch {
    return null;
  }
}
function respond(p: Promise<unknown>, sendResponse: (r?: unknown) => void) {
  p.then(
    (r) => sendResponse(r ?? undefined),
    () => sendResponse(undefined),
  );
}

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  respond(handle(msg, { senderOrigin: originOf(sender) }), sendResponse);
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const m = msg as { kind?: string; message?: unknown; origin?: unknown };
  if (m?.kind === 'bridge' && sender.tab) {
    respond(handle(m.message, { senderOrigin: originOf(sender) }), sendResponse);
    return true;
  }
  if (m?.kind === 'canvas-seen' && typeof m.origin === 'string') {
    // Probe with the student's own cookies; remember only a real signed-in Canvas login.
    const origin = m.origin;
    void (async () => {
      const session = await createCanvasClient().probe(origin);
      if (!session) return;
      const cur = await store.get();
      const rest = cur.accounts.filter(
        (a) => !(a.origin === origin && a.canvasUserId === session.canvasUserId),
      );
      await store.patch({ accounts: [...rest, session] });
    })();
    return false;
  }
  return false;
});

try {
  void chrome.runtime.setUninstallURL(`${WEB_ORIGIN.replace(/\/+$/, '')}/extension/uninstalled`);
} catch {
  /* not available */
}
