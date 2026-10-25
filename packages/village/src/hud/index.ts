import type {
  AgentInfo,
  AgentState,
  CameraApi,
  CameraMode,
  Interactable,
  PlayerApi,
  VillageBus,
  WorldLayout,
  WorldTime,
  AgentRegistry,
} from '../world/api';
import { nearestInteractable } from '../world/interact';
import {
  KIND_ROLE,
  STATE_LABEL,
  STATUS_WORD,
  chipOrder,
  closePopovers,
  formatClock,
  initialOf,
  portraitKeyFor,
  portraitPath,
} from './math';
import { HUD_CSS } from './style';
import type { InspectorStore } from '../inspector/store';
import {
  getMastery,
  masteryLevel,
  masteryPips,
  masteryWord,
  MASTERY_PIPS,
} from '../scenes/mastery';

export interface HudDeps {
  parent: HTMLElement;
  bus: VillageBus;
  agents: AgentRegistry & { onChange?(fn: () => void): () => void };
  camera: Pick<CameraApi, 'setMode' | 'mode'>;
  player: Pick<PlayerApi, 'x' | 'walkTo'>;
  layout: WorldLayout;
  time: WorldTime;
  interactables: { list(): Interactable[] };
  calm: { get(): boolean; set(v: boolean): void };
  focusAgent(agentId: string): void;
  assetUrl(repoPath: string): string;
  /** Agent Inspector: chips carry the live current-activity line and open the inspector. */
  inspector?: InspectorStore;
  /** The viewer's student id (their own chip uses the red-hood portrait). */
  me?: string;
}

const SVG = 'http://www.w3.org/2000/svg';
const ICON_PATH: Record<AgentState, string> = {
  idle: 'M9 2a5 5 0 1 0 1 8A4 4 0 0 1 9 2z', // moon
  studying: 'M6 1a3.5 3.5 0 0 0-1 6.8V10h2V7.8A3.5 3.5 0 0 0 6 1z', // bulb
  in_call: 'M6 1.5a2 2 0 0 0-2 2v2.5a2 2 0 0 0 4 0V3.5a2 2 0 0 0-2-2zM3 6a3 3 0 0 0 6 0M6 9v2', // mic
  waiting_for_student: 'M3 1h6M3 11h6M4 1c0 3 4 3 4 5s-4 2-4 5', // hourglass
};
function statusIcon(): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.appendChild(document.createElementNS(SVG, 'path'));
  return svg;
}
function setStatusIcon(svg: Element, state: AgentState): void {
  svg.firstElementChild?.setAttribute('d', ICON_PATH[state]);
}
const FONT_PATH = 'assets/fonts/jersey-10/Jersey10-latin.woff2';
const FONT_MICRO = 'assets/fonts/silkscreen/Silkscreen-latin.woff2';
const MODES: Array<[CameraMode, string]> = [
  ['left', 'Left'],
  ['mid', 'Mid'],
  ['right', 'Right'],
  ['zoom', 'Zoom'],
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createHud(d: HudDeps): { update(): void; destroy(): void } {
  const style = el('style', undefined, { 'data-sqv-hud': '' });
  style.textContent =
    `@font-face{font-family:'Jersey 10';src:url('${d.assetUrl(FONT_PATH)}') format('woff2');font-display:swap}@font-face{font-family:'Silkscreen';src:url('${d.assetUrl(FONT_MICRO)}') format('woff2');font-display:swap}` +
    HUD_CSS;
  document.head.appendChild(style);

  const root = el('div', 'sqv-hud', {
    role: 'group',
    'aria-label': 'Village controls',
    'data-layout': 'wide',
  });
  const mid = el('div', 'sqv-mid');
  const bottom = el('div', 'sqv-bottom');

  // camera segmented control
  const seg = el('div', 'sqv-panel sqv-seg', { role: 'group', 'aria-label': 'Camera' });
  const modeBtns = new Map<CameraMode, HTMLButtonElement>();
  for (const [m, label] of MODES) {
    const b = el('button', 'sqv-btn', { type: 'button', 'aria-pressed': 'false' }, label);
    b.addEventListener('click', () => {
      d.camera.setMode(d.camera.mode === m && m !== 'follow' ? 'follow' : m);
      syncCamera();
    });
    modeBtns.set(m, b);
    seg.appendChild(b);
  }
  const calmWrap = el('div', 'sqv-panel sqv-seg');
  const calm = el(
    'button',
    'sqv-btn',
    { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Calm mode' },
    'Calm',
  );
  calm.addEventListener('click', () => {
    d.calm.set(!d.calm.get());
    syncCalm();
  });
  calmWrap.appendChild(calm);
  const helpWrap = el('div', 'sqv-panel sqv-seg');
  const helpBtn = el(
    'button',
    'sqv-btn',
    {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'sqv-help',
      'aria-label': 'Controls',
    },
    '?',
  );
  helpWrap.appendChild(helpBtn);

  // clock + badge slot
  const clockWrap = el('div', 'sqv-clock-wrap');
  const clock = el('div', 'sqv-panel sqv-clock', { role: 'timer', 'aria-label': 'Village clock' });
  const moon = el('span', 'sqv-moon', { 'aria-hidden': 'true' });
  const clockText = el('span');
  const badge = el('span', 'sqv-badge', { 'data-badge': '', 'aria-live': 'polite' });
  clock.append(moon, clockText, badge);
  clockWrap.appendChild(clock);

  const ctrl = el('div', 'sqv-ctrl');
  ctrl.append(seg, calmWrap, helpWrap);

  // narrow layout: menu button + popover that adopts the controls
  const menuWrap = el('div', 'sqv-menu');
  const menuPanel = el('div', 'sqv-panel sqv-seg');
  const menuBtn = el(
    'button',
    'sqv-btn',
    { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sqv-pop' },
    'Menu',
  );
  menuPanel.appendChild(menuBtn);
  menuWrap.appendChild(menuPanel);
  const pop = el('div', 'sqv-panel sqv-pop', {
    id: 'sqv-pop',
    role: 'group',
    'aria-label': 'Camera and calm',
  });
  menuBtn.addEventListener('click', () => {
    const o = pop.dataset.open !== 'true';
    pop.dataset.open = String(o);
    menuBtn.setAttribute('aria-expanded', String(o));
  });

  // chips
  const chips = el('div', 'sqv-panel sqv-chips', { role: 'group', 'aria-label': 'Agents' });

  // roving focus: arrows move between the agent chips, Enter/Space activates (native button)
  chips.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = [...chips.querySelectorAll<HTMLButtonElement>('.sqv-chip')];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]?.focus();
  });

  // prompt (Enter to open the nearest place) and trip door live over the canvas
  const prompt = el('button', 'sqv-panel sqv-prompt', {
    type: 'button',
    'data-show': 'false',
    tabindex: '-1',
  });
  const key = el('span', 'sqv-key', {}, 'Enter');
  const promptText = el('span');
  prompt.append(key, promptText);
  const trip = el('button', 'sqv-trip', { type: 'button', 'data-show': 'false' }, 'Trip');
  trip.addEventListener('click', () => {
    const s = d.layout.slot('trip-road');
    void d.player.walkTo(s.x - 60);
  });
  // compact mastery chip: word + pips for the chapter house the player stands at (no numbers)
  const mchip = el('div', 'sqv-panel sqv-mchip', { role: 'status', 'data-show': 'false' });
  const mchipName = el('span', 'sqv-mchip__name');
  const mchipPips = el('span', 'sqv-mchip__pips', { 'aria-hidden': 'true' });
  for (let i = 0; i < MASTERY_PIPS; i++) mchipPips.appendChild(el('i'));
  const mchipWord = el('span', 'sqv-mchip__word');
  mchip.append(mchipName, mchipPips, mchipWord);
  mid.append(mchip, prompt, trip);

  const help = el('div', 'sqv-panel sqv-help', {
    id: 'sqv-help',
    role: 'dialog',
    'aria-label': 'Controls',
  });
  help.innerHTML =
    '<b>Walk</b> arrow keys or A / D<br><b>Enter</b> open the nearest place<br><b>Tab</b> cycle places<br><b>Esc</b> leave a building<br><b>Click</b> an agent to see what it is doing<br><b>I</b> cycle through agents<br><b>Calm</b> softens all motion';
  helpBtn.addEventListener('click', () => {
    const o = help.dataset.open !== 'true';
    help.dataset.open = String(o);
    helpBtn.setAttribute('aria-expanded', String(o));
  });
  mid.appendChild(help);

  // Escape closes the Controls / menu popovers (and is not also treated as "leave the building").
  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    const hadFocus = root.contains(document.activeElement);
    if (
      closePopovers([
        { panel: help, button: helpBtn },
        { panel: pop, button: menuBtn },
      ])
    ) {
      e.stopPropagation();
      if (hadFocus) d.parent.focus?.();
    }
  };
  document.addEventListener('keydown', onEsc, true);

  root.append(chips, clockWrap, ctrl, menuWrap, mid, bottom);
  d.parent.appendChild(root);
  mid.appendChild(pop);

  // Layout: wide = chips | clock | controls on top. Narrow = clock + menu on top, chips in a bottom dock, controls in the menu.
  const stageEl = d.parent;
  let layoutKey = '';
  const relayout = () => {
    const w = stageEl.clientWidth;
    const narrow = w < 560;
    const outer = stageEl.parentElement;
    const roomY = outer ? Math.max(0, (outer.clientHeight - stageEl.clientHeight) / 2) : 0;
    const outTop = narrow && roomY >= 60;
    const outBottom = narrow && roomY >= 80;
    const k = `${narrow}|${outTop}|${outBottom}`;
    if (k === layoutKey) return;
    layoutKey = k;
    root.dataset.layout = narrow ? 'narrow' : 'wide';
    root.dataset.outTop = String(outTop);
    root.dataset.outBottom = String(outBottom);
    root.style.setProperty('--top-h', outTop ? '60px' : 'auto');
    root.style.setProperty('--bottom-h', narrow ? (outBottom ? '80px' : 'auto') : 'auto');
    if (narrow) {
      pop.append(seg, calmWrap, helpWrap);
      bottom.appendChild(chips);
    } else {
      ctrl.append(seg, calmWrap, helpWrap);
      root.insertBefore(chips, clockWrap);
    }
  };
  const ro = new ResizeObserver(relayout);
  ro.observe(stageEl);
  if (stageEl.parentElement) ro.observe(stageEl.parentElement);
  relayout();

  const syncCamera = () =>
    modeBtns.forEach((b, m) => b.setAttribute('aria-pressed', String(d.camera.mode === m)));
  const syncCalm = () => {
    calm.setAttribute('aria-checked', String(d.calm.get()));
    root.classList.toggle('sqv-calm', d.calm.get());
  };

  // chips (re-rendered only when the roster or a state changed)
  const chipEls = new Map<string, HTMLButtonElement>();
  let dirty = true;
  const render = () => {
    dirty = false;
    const list = chipOrder(d.agents.list());
    const seen = new Set<string>();
    list.forEach((a: AgentInfo, i) => {
      seen.add(a.id);
      let c = chipEls.get(a.id);
      if (!c) {
        c = el('button', 'sqv-chip', { type: 'button' });
        // a distinct portrait per agent (cast busts for the council, the village cast for everyone else), never initials
        const img = el('img', undefined, {
          alt: '',
          src: d.assetUrl(a.portraitKey ?? portraitPath(portraitKeyFor(a, d.me))),
        });
        img.addEventListener('error', () => {
          img.replaceWith(el('span', 'sqv-initial', { 'aria-hidden': 'true' }, initialOf(a.name)));
        });
        c.appendChild(img);
        const st = el('span', 'sqv-status');
        st.appendChild(statusIcon());
        st.appendChild(el('span', 'sqv-status__w'));
        c.appendChild(st);
        c.addEventListener('click', () => d.focusAgent(a.id));
        chipEls.set(a.id, c);
      }
      c.dataset.state = a.state;
      const act = d.inspector?.view(a.id)?.headline;
      const word = STATUS_WORD[a.state];
      c.setAttribute('aria-label', `${a.name}, ${word}`);
      c.title = `${a.name}, ${KIND_ROLE[a.kind]}: ${word}${act ? `. ${act}` : ''}. Open its panel`;
      c.querySelector('.sqv-status__w')!.textContent = word;
      setStatusIcon(c.querySelector('.sqv-status svg')!, a.state);
      c.dataset.selected = String(d.inspector?.selected === a.id);
      c.setAttribute('aria-pressed', String(d.inspector?.selected === a.id));
      if (chips.children[i] !== c) chips.insertBefore(c, chips.children[i] ?? null);
    });
    for (const [id, c] of chipEls)
      if (!seen.has(id)) {
        c.remove();
        chipEls.delete(id);
      }
    chips.style.display = list.length ? '' : 'none';
  };
  const unsubs = [
    d.bus.on('agentState', () => {
      dirty = true;
    }),
    d.bus.on('cameraMode', syncCamera),
    d.bus.on('calm', syncCalm),
    d.bus.on('tripDoor', (t) => {
      trip.dataset.show = String(t.visible);
    }),
    d.agents.onChange?.(() => {
      dirty = true;
    }) ?? (() => {}),
    d.inspector?.subscribe(() => {
      dirty = true;
    }) ?? (() => {}),
  ];
  let lastClock = '';
  let promptFor: Interactable | undefined;
  let lastChip = '';
  prompt.addEventListener('click', () => {
    promptFor?.onActivate();
    // keys (Esc to leave the room, arrows to walk) only reach the world while the stage has focus
    d.parent.focus?.({ preventScroll: true });
  });
  syncCamera();
  syncCalm();

  return {
    update() {
      if (dirty) render();
      const txt = formatClock(d.time.clockHours);
      if (txt !== lastClock) {
        lastClock = txt;
        clockText.textContent = txt;
      }
      moon.classList.toggle('sqv-sun', d.time.nightness < 0.5);
      const near = nearestInteractable(d.interactables.list(), d.player.x);
      if (near !== promptFor) {
        promptFor = near;
        if (near) promptText.textContent = near.label;
        prompt.dataset.show = String(!!near);
        prompt.tabIndex = near ? 0 : -1;
      }
      // mastery chip: chapter houses only, and only while the house is open (a dim house has nothing to say yet)
      const slotId = near?.id.startsWith('enter-chapter-') ? near.id.slice('enter-'.length) : '';
      const ch = slotId ? getMastery().chapters.find((c) => c.slot === slotId) : undefined;
      const mkey = ch ? `${ch.title}|${masteryPips(ch.box)}` : '';
      if (mkey !== lastChip) {
        lastChip = mkey;
        if (ch) {
          mchipName.textContent = ch.title;
          mchipWord.textContent = masteryWord(ch.box);
          mchip.dataset.level = masteryLevel(ch.box);
          [...mchipPips.children].forEach((p, i) =>
            (p as HTMLElement).toggleAttribute('data-on', i < masteryPips(ch.box)),
          );
          mchip.setAttribute(
            'aria-label',
            `${ch.title} mastery: ${masteryWord(ch.box)}, ${masteryPips(ch.box)} of ${MASTERY_PIPS} pips`,
          );
        }
        mchip.dataset.show = String(!!ch);
      }
    },
    destroy() {
      unsubs.forEach((u) => u());
      document.removeEventListener('keydown', onEsc, true);
      ro.disconnect();
      root.remove();
      style.remove();
    },
  };
}
