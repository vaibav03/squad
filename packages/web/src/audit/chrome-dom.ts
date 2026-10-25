/**
 * DOM chrome audit: no emoji and no bare dot markers in text outside user-authored content.
 * User-authored regions are marked `data-user-content` (message bodies also carry data-testid="chat-message-body").
 * Allowed exceptions (documented, keep this list short):
 *  - anything inside [data-user-content] or [data-testid=chat-message-body] (messages, user names, titles)
 *  - <canvas>, <svg> and <script>/<style> content (art, not chrome text)
 *  - ASCII punctuation separators such as the middle dot used between words ("a · b") are NOT flagged on their own;
 *    only a text node that is nothing but a marker glyph is.
 */
export const USER_CONTENT = '[data-user-content],[data-testid="chat-message-body"]';
const EMOJI = /\p{Extended_Pictographic}|️|\p{Regional_Indicator}/u;
const BARE_MARKER = /^[\s]*[●•◆▲○◐◑◇■□▪▫★☆♥⚙✓✕≠≡→←↔]+[\s]*$/u;
const MARKER_LEAD = /^[\s]*[●•◆▲○◐◑◇■□▪▫★☆♥⚙✓✕≠≡]\s/u;

export interface ChromeViolation {
  kind: 'emoji' | 'marker';
  text: string;
  where: string;
}

export function auditChromeText(root: ParentNode): ChromeViolation[] {
  const out: ChromeViolation[] = [];
  const doc = (root as Document).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue ?? '';
    if (!t.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest(`${USER_CONTENT},script,style,canvas,svg`)) continue;
    const kind = EMOJI.test(t) ? 'emoji' : BARE_MARKER.test(t) || MARKER_LEAD.test(t) ? 'marker' : null;
    if (kind) out.push({ kind, text: t.trim().slice(0, 60), where: `${el.tagName.toLowerCase()}.${el.className}` });
  }
  return out;
}
