/** DOM HUD over the canvas: room chip, interaction prompt, live region. Styled from docs/design tokens. */
const CSS = `
.sqi-hud{position:absolute;inset:0;pointer-events:none;z-index:5;font-family:'Inter',system-ui,sans-serif}
.sqi-chip{position:absolute;left:12px;top:12px;display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;
  background:rgba(11,29,56,.82);color:#fff2c4;border:2px solid #070f1f;border-radius:8px;
  font-family:'Jersey 10','Courier New',monospace;font-size:18.667px;line-height:1;letter-spacing:0;
  -webkit-font-smoothing:none;backdrop-filter:blur(6px);transition:opacity 150ms ease}
.sqi-chip i{width:8px;height:8px;border-radius:50%;background:#ffc857;display:block}
.sqi-prompt{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);pointer-events:auto;
  display:flex;align-items:center;gap:10px;min-height:44px;padding:0 16px 0 10px;cursor:pointer;
  background:rgba(11,29,56,.9);color:#fff;border:2px solid #070f1f;border-radius:8px;font:500 14px/20px 'Inter',system-ui,sans-serif;
  transition:opacity 150ms ease,transform 160ms cubic-bezier(.23,1,.32,1);touch-action:manipulation;max-width:calc(100% - 32px)}
.sqi-prompt[hidden]{display:flex;opacity:0;pointer-events:none;transform:translateX(-50%) translateY(6px)}
.sqi-prompt:active{transform:translateX(-50%) scale(.97)}
.sqi-prompt kbd{font:400 16px/1 'Jersey 10','Courier New',monospace;background:#ffc857;color:#070f1f;border-radius:4px;padding:4px 7px;
  min-width:24px;text-align:center}
.sqi-prompt:focus-visible{outline:2px solid #ffc857;outline-offset:2px}
.sqi-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.sqi-chip,.sqi-prompt{transition:opacity 150ms ease}}
`;

export interface Hud {
  setRoom(label: string): void;
  setPrompt(label: string | undefined, onActivate?: () => void): void;
  announce(text: string): void;
  destroy(): void;
}

export function createHud(stage: HTMLElement, opts: { show: boolean; assetBase: string }): Hud {
  const style = document.createElement('style');
  style.dataset.sqiHud = '';
  style.textContent = `@font-face{font-family:'Jersey 10';src:url('${opts.assetBase}/fonts/jersey-10/Jersey10-latin.woff2') format('woff2');font-display:swap}${CSS}`;
  document.head.appendChild(style);

  const hud = document.createElement('div');
  hud.className = 'sqi-hud';
  const chip = document.createElement('div');
  chip.className = 'sqi-chip';
  chip.setAttribute('role', 'status');
  const dot = document.createElement('i');
  const chipText = document.createElement('span');
  chip.append(dot, chipText);
  const prompt = document.createElement('button');
  prompt.type = 'button';
  prompt.className = 'sqi-prompt';
  prompt.hidden = true;
  const key = document.createElement('kbd');
  key.textContent = 'E';
  const promptText = document.createElement('span');
  prompt.append(key, promptText);
  const live = document.createElement('div');
  live.className = 'sqi-sr';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'log');
  if (opts.show) hud.append(chip, prompt);
  hud.append(live);
  stage.appendChild(hud);

  let activate: (() => void) | undefined;
  prompt.addEventListener('click', () => activate?.());
  prompt.addEventListener('pointerdown', (e) => e.stopPropagation());

  return {
    setRoom(label) {
      if (chipText.textContent === label) return;
      chipText.textContent = label;
    },
    setPrompt(label, onActivate) {
      activate = onActivate;
      if (label === undefined) {
        prompt.hidden = true;
        prompt.tabIndex = -1;
        return;
      }
      promptText.textContent = label;
      prompt.hidden = false;
      prompt.tabIndex = 0;
    },
    announce(text) {
      live.textContent = text;
    },
    destroy() {
      hud.remove();
      style.remove();
    },
  };
}
