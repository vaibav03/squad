import type { AgentInfo, CameraApi, CameraMode, Interactable, PlayerApi, VillageBus, WorldLayout, WorldTime, AgentRegistry } from '../world/api';
import { nearestInteractable } from '../world/interact';
import { STATE_GLYPH, STATE_LABEL, chipOrder, formatClock, initialOf } from './math';
import { HUD_CSS } from './style';

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
}

const FONT_PATH = 'assets/pixel/ui/fonts/NinjaAdventure-NormalFont.ttf';
const MODES: Array<[CameraMode, string]> = [['left', 'Left'], ['mid', 'Mid'], ['right', 'Right'], ['zoom', 'Zoom']];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createHud(d: HudDeps): { update(): void; destroy(): void } {
  const style = el('style', undefined, { 'data-sqv-hud': '' });
  style.textContent = `@font-face{font-family:'Squad Pixel';src:url('${d.assetUrl(FONT_PATH)}') format('truetype');font-display:swap}` + HUD_CSS;
  document.head.appendChild(style);

  const root = el('div', 'sqv-hud', { role: 'group', 'aria-label': 'Village controls' });
  const top = el('div', 'sqv-top');
  const bottom = el('div', 'sqv-bottom');
  root.append(top, bottom);

  // top-left: camera segmented control
  const seg = el('div', 'sqv-panel sqv-seg', { role: 'group', 'aria-label': 'Camera' });
  const modeBtns = new Map<CameraMode, HTMLButtonElement>();
  for (const [m, label] of MODES) {
    const b = el('button', 'sqv-btn', { type: 'button', 'aria-pressed': 'false' }, label);
    b.addEventListener('click', () => { d.camera.setMode(d.camera.mode === m && m !== 'follow' ? 'follow' : m); syncCamera(); });
    modeBtns.set(m, b); seg.appendChild(b);
  }
  // top-right: clock, calm, help
  const right = el('div', 'sqv-right');
  const clock = el('div', 'sqv-panel sqv-clock', { role: 'timer', 'aria-label': 'Village clock' });
  const moon = el('span', 'sqv-moon', { 'aria-hidden': 'true' });
  const clockText = el('span');
  const badge = el('span', 'sqv-badge', { 'data-badge': '', 'aria-live': 'polite' });
  clock.append(moon, clockText, badge);
  const calmWrap = el('div', 'sqv-panel sqv-seg');
  const calm = el('button', 'sqv-btn', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Calm mode' }, 'Calm');
  calm.addEventListener('click', () => { d.calm.set(!d.calm.get()); syncCalm(); });
  calmWrap.appendChild(calm);
  const helpWrap = el('div', 'sqv-panel sqv-seg');
  const helpBtn = el('button', 'sqv-btn', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sqv-help', 'aria-label': 'Controls' }, '?');
  helpWrap.appendChild(helpBtn);
  right.append(clock, calmWrap, helpWrap);
  top.append(seg, right);

  // bottom: chips + prompt + trip
  const chips = el('div', 'sqv-panel sqv-chips', { role: 'list', 'aria-label': 'Agents' });
  const bottomRow = el('div', undefined, { style: 'display:flex;gap:8px;align-items:flex-end;justify-content:space-between;width:100%;flex-wrap:wrap' });
  const prompt = el('button', 'sqv-panel sqv-prompt', { type: 'button', 'data-show': 'false', tabindex: '-1' });
  const key = el('span', 'sqv-key', {}, 'Enter');
  const promptText = el('span');
  prompt.append(key, promptText);
  const trip = el('button', 'sqv-trip', { type: 'button', 'data-show': 'false' }, 'Trip');
  trip.addEventListener('click', () => { const s = d.layout.slot('trip-road'); void d.player.walkTo(s.x - 40); });
  bottomRow.append(chips, trip);
  bottom.append(bottomRow, prompt);

  const help = el('div', 'sqv-panel sqv-help', { id: 'sqv-help', role: 'dialog', 'aria-label': 'Controls' });
  help.innerHTML = '<b>Walk</b> arrow keys or A / D<br><b>Enter</b> open the nearest place<br><b>Tab</b> cycle places<br><b>Esc</b> leave a building<br><b>Tap</b> the world to walk<br><b>Calm</b> softens all motion';
  helpBtn.addEventListener('click', () => { const o = help.dataset.open !== 'true'; help.dataset.open = String(o); helpBtn.setAttribute('aria-expanded', String(o)); });
  root.appendChild(help);
  d.parent.appendChild(root);

  const syncCamera = () => modeBtns.forEach((b, m) => b.setAttribute('aria-pressed', String(d.camera.mode === m)));
  const syncCalm = () => { calm.setAttribute('aria-checked', String(d.calm.get())); root.classList.toggle('sqv-calm', d.calm.get()); };

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
        c = el('button', 'sqv-chip', { type: 'button', role: 'listitem' });
        const tex = a.portraitKey;
        if (tex) { const img = el('img', undefined, { alt: '', src: d.assetUrl(tex) }); c.appendChild(img); } else c.appendChild(el('span', 'sqv-initial', {}, initialOf(a.name)));
        c.appendChild(el('span', 'sqv-glyph', { 'aria-hidden': 'true' }));
        c.addEventListener('click', () => d.focusAgent(a.id));
        chipEls.set(a.id, c);
      }
      c.dataset.state = a.state;
      c.setAttribute('aria-label', `${a.name}, ${STATE_LABEL[a.state]}`);
      c.title = `${a.name}: ${STATE_LABEL[a.state]}`;
      (c.querySelector('.sqv-glyph') as HTMLElement).textContent = STATE_GLYPH[a.state];
      if (chips.children[i] !== c) chips.insertBefore(c, chips.children[i] ?? null);
    });
    for (const [id, c] of chipEls) if (!seen.has(id)) { c.remove(); chipEls.delete(id); }
    chips.style.display = list.length ? '' : 'none';
  };
  const unsubs = [
    d.bus.on('agentState', () => { dirty = true; }),
    d.bus.on('cameraMode', syncCamera),
    d.bus.on('calm', syncCalm),
    d.bus.on('tripDoor', (t) => { trip.dataset.show = String(t.visible); }),
    d.agents.onChange?.(() => { dirty = true; }) ?? (() => {}),
  ];
  let lastClock = '';
  let promptFor: Interactable | undefined;
  prompt.addEventListener('click', () => promptFor?.onActivate());
  syncCamera(); syncCalm();

  return {
    update() {
      if (dirty) render();
      const txt = formatClock(d.time.clockHours);
      if (txt !== lastClock) { lastClock = txt; clockText.textContent = txt; }
      moon.classList.toggle('sqv-sun', d.time.nightness < 0.5);
      const near = nearestInteractable(d.interactables.list(), d.player.x);
      if (near !== promptFor) {
        promptFor = near;
        if (near) promptText.textContent = near.label;
        prompt.dataset.show = String(!!near);
        prompt.tabIndex = near ? 0 : -1;
      }
    },
    destroy() { unsubs.forEach((u) => u()); root.remove(); style.remove(); },
  };
}
