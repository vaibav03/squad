import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMotionPrefs } from '@squad/village/motion';
import { CSS_VARS } from '@squad/village/motion';
import { bindMotionPrefsToDom, closePanel, openPanel } from './index';

const css = readFileSync(new URL('./motion.css', import.meta.url), 'utf8');
const tokens = (() => {
  try {
    return readFileSync(new URL('../../../../docs/design/tokens.css', import.meta.url), 'utf8');
  } catch {
    return '';
  }
})();

describe('bindMotionPrefsToDom', () => {
  it('reflects calm and reduced override', () => {
    const attrs: Record<string, string> = {};
    const root = { setAttribute: (k: string, v: string) => void (attrs[k] = v) };
    const prefs = createMotionPrefs({ storage: null, matchMedia: null });
    const detach = bindMotionPrefsToDom(root, prefs);
    expect(attrs['data-calm']).toBe('false');
    prefs.setCalm(true);
    expect(attrs['data-calm']).toBe('true');
    prefs.setReducedOverride(true);
    expect(attrs['data-reduced-motion']).toBe('true');
    detach();
    prefs.setCalm(false);
    expect(attrs['data-calm']).toBe('true');
  });
  it('panel helpers flip data-state only', () => {
    const attrs: Record<string, string> = {};
    const el = { setAttribute: (k: string, v: string) => void (attrs[k] = v) };
    closePanel(el);
    expect(attrs['data-state']).toBe('closed');
    openPanel(el);
    expect(attrs['data-state']).toBe('open');
  });
});

describe('motion.css never-ship lint', () => {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  it('no transition: all', () => {
    expect(noComments).not.toMatch(/transition(-property)?\s*:\s*all/);
  });
  it('no scale(0)', () => {
    expect(noComments).not.toMatch(/scale\(\s*0(\.0+)?\s*\)/);
  });
  it('no bare ease-in', () => {
    expect(noComments.replace(/ease-in-out/g, '')).not.toMatch(/ease-in/);
  });
  it('no layout properties in transitions', () => {
    for (const m of noComments.matchAll(/transition[^;]*;/g)) {
      expect(m[0]).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding)\b/);
    }
  });
  it('no keyframes', () => {
    expect(noComments).not.toMatch(/@keyframes/);
  });
  it('all durations are 300ms or less', () => {
    for (const m of noComments.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
      const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
      expect(ms).toBeLessThanOrEqual(300);
    }
  });
  it('hover only inside (hover: hover) and (pointer: fine)', () => {
    const idx = [...noComments.matchAll(/:hover/g)].map((m) => m.index ?? 0);
    expect(idx.length).toBeGreaterThan(0);
    for (const i of idx) {
      const before = noComments.slice(0, i);
      const open = before.lastIndexOf('@media');
      expect(open).toBeGreaterThanOrEqual(0);
      expect(before.slice(open)).toMatch(/\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
    }
  });
  it('every .m-* class that animates has reduced rules (media and calm)', () => {
    const reducedBlock = noComments.slice(noComments.indexOf('prefers-reduced-motion'));
    for (const cls of ['m-panel', 'm-press', 'm-fade', 'm-check']) {
      expect(reducedBlock).toContain(`.${cls}`);
      expect(reducedBlock).toContain(`[data-calm='true'] .${cls}`);
    }
  });
  it('fallback curves equal the shared tokens', () => {
    expect(css).toContain(CSS_VARS['--ease-out'].replace(/, /g, ', '));
    expect(css).toContain(CSS_VARS['--ease-in-out']);
    expect(css).toContain(CSS_VARS['--ease-drawer']);
    if (tokens) {
      expect(tokens).toContain(CSS_VARS['--ease-out']);
      expect(tokens).toContain(CSS_VARS['--ease-in-out']);
      expect(tokens).toContain(CSS_VARS['--ease-drawer']);
    }
  });
});
