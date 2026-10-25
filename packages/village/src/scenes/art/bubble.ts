import { Raster } from '../pixel/raster';
import { GLYPH_H, drawText, textWidth } from '../pixel/font';
import type { BubbleStyle } from '../contract';

export interface BubbleArt {
  r: Raster;
  /** Tail tip, relative to the raster's top-left; place this on the speaker's head. */
  tail: { x: number; y: number };
}

/** Word-wrap for the 3x5 font. Long unbroken words are hard-split. */
export function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > maxChars) {
      if (line) {
        out.push(line);
        line = '';
      }
      out.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out;
}

const cache = new Map<string, BubbleArt>();

/**
 * Pixel speech bubble. Styles: speech (ink text on wall-lit), thought (round puffs, cloud tone),
 * dissent (red-lined: alert border and underline, it stays), announce (chairman, glow-core),
 * caption (dark plate). Text appears whole; this never animates the words.
 */
export function bubble(text: string, style: BubbleStyle, maxChars = 18, maxLines = 4): BubbleArt {
  const key = `${style}|${maxChars}|${maxLines}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let lines = wrap(text, maxChars);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 2))}..`;
  }
  const tw = Math.max(...lines.map(textWidth), 6);
  const w = tw + 6;
  const h = lines.length * (GLYPH_H + 1) - 1 + 6;
  const tailH = style === 'thought' ? 5 : 2;
  const r = new Raster(w, h + tailH);

  const fill =
    style === 'thought'
      ? 'cloud-hi'
      : style === 'announce'
        ? 'glow-core'
        : style === 'caption'
          ? 'sky-deep'
          : 'wall-lit';
  const edge =
    style === 'dissent'
      ? 'alert'
      : style === 'announce'
        ? 'wood'
        : style === 'caption'
          ? 'cloud-lo'
          : 'ink';
  const textInk = style === 'caption' ? 'cloud-hi' : 'ink';

  // rounded rect: corners notched
  r.rect(1, 0, w - 2, h, fill);
  r.rect(0, 1, w, h - 2, fill);
  r.rect(1, 0, w - 2, 1, edge);
  r.rect(1, h - 1, w - 2, 1, edge);
  r.rect(0, 1, 1, h - 2, edge);
  r.rect(w - 1, 1, 1, h - 2, edge);
  if (style === 'dissent') {
    r.hline(3, h - 2, w - 6, 'alert'); // red underline: the lone dissenting view
  }
  lines.forEach((ln, i) => drawText(r, 3, 3 + i * (GLYPH_H + 1), ln, textInk));

  const cx = Math.floor(w / 2);
  if (style === 'thought') {
    r.rect(cx - 1, h, 2, 2, fill);
    r.frame(cx - 1, h, 2, 2, edge);
    r.px(cx, h + 3, edge);
    r.px(cx - 1, h + 3, fill);
    r.px(cx - 1, h + 4, edge);
  } else {
    r.hline(cx - 1, h - 1, 3, fill); // open the bottom edge
    r.px(cx - 1, h, edge);
    r.px(cx, h, fill);
    r.px(cx + 1, h, edge);
    r.px(cx, h + 1, edge);
  }
  const art: BubbleArt = { r, tail: { x: cx, y: h + tailH - 1 } };
  cache.set(key, art);
  return art;
}
