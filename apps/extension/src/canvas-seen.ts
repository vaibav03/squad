/** Content script on Canvas pages: tells the service worker which Canvas origin this browser uses. */
try {
  chrome.runtime.sendMessage({ kind: 'canvas-seen', origin: location.origin });
} catch {
  /* extension reloaded */
}
