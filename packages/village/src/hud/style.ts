/** HUD stylesheet. Tokens are CSS custom properties on .sqv-hud; palette from docs/design/palette.json. DOM animates transform/opacity only. */
export const HUD_CSS = `
.sqv-hud{--ink:#070f1f;--panel:rgba(7,15,31,.82);--panel-hi:rgba(11,29,56,.92);--line:#2f5f84;--line-hi:#4a7695;--text:#e8f0f6;--dim:#8fb0c6;--glow:#ffc857;--ok:#5fcf8a;--alert:#e0485a;--moon:#fff2c4;
 --ease-out:cubic-bezier(.23,1,.32,1);--ease-drawer:cubic-bezier(.32,.72,0,1);
 position:absolute;inset:0;pointer-events:none;z-index:5;font-family:'Squad Pixel','Courier New',monospace;font-size:16px;line-height:1;color:var(--text);
 padding:max(8px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));
 display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;-webkit-font-smoothing:none;font-smooth:never}
.sqv-hud *{box-sizing:border-box}
.sqv-top,.sqv-bottom{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.sqv-bottom{align-items:flex-end}
.sqv-panel{pointer-events:auto;background:var(--panel);border:2px solid var(--line);box-shadow:0 0 0 2px var(--ink),inset 0 0 0 1px rgba(180,214,218,.08);border-radius:3px}
.sqv-chips{display:flex;gap:6px;padding:5px;max-width:100%;overflow-x:auto;scrollbar-width:none;pointer-events:auto}
.sqv-chips::-webkit-scrollbar{display:none}
.sqv-chip{position:relative;flex:none;width:44px;height:44px;border-radius:50%;border:2px solid var(--line-hi);background:var(--panel-hi);color:var(--text);font:inherit;font-size:18px;display:grid;place-items:center;cursor:pointer;padding:0;transition:border-color .15s ease,opacity .15s ease,transform .16s var(--ease-out)}
.sqv-chip:active{transform:scale(.97)}
.sqv-chip[data-state=idle]{opacity:.78}
.sqv-chip[data-state=studying]{border-color:var(--glow)}
.sqv-chip[data-state=in_call]{border-color:var(--ok)}
.sqv-chip[data-state=waiting_for_student]{border-color:var(--alert)}
.sqv-chip[data-state=waiting_for_student]::before{content:'';position:absolute;inset:-5px;border-radius:50%;border:2px solid var(--alert);opacity:.6;animation:sqv-ring 1.6s var(--ease-out) infinite}
.sqv-calm .sqv-chip::before{animation:none!important;opacity:.5}
.sqv-glyph{position:absolute;right:-4px;bottom:-4px;min-width:18px;height:18px;padding:0 3px;border-radius:9px;background:var(--ink);border:2px solid currentColor;font-size:14px;display:grid;place-items:center}
.sqv-chip[data-state=idle] .sqv-glyph{color:var(--dim)}.sqv-chip[data-state=studying] .sqv-glyph{color:var(--glow)}.sqv-chip[data-state=in_call] .sqv-glyph{color:var(--ok)}.sqv-chip[data-state=waiting_for_student] .sqv-glyph{color:var(--alert)}
.sqv-chip img{width:100%;height:100%;border-radius:50%;object-fit:cover;image-rendering:pixelated}
@keyframes sqv-ring{from{transform:scale(1);opacity:.6}to{transform:scale(1.15);opacity:0}}
.sqv-seg{display:flex;padding:3px;gap:3px}
.sqv-btn{min-width:44px;height:44px;padding:0 10px;font:inherit;font-size:16px;color:var(--dim);background:transparent;border:0;border-radius:2px;cursor:pointer;transition:color .15s ease,background-color .15s ease,transform .16s var(--ease-out)}
.sqv-btn:active{transform:scale(.97)}
.sqv-btn[aria-pressed=true],.sqv-btn[aria-checked=true]{color:var(--ink);background:var(--moon)}
@media (hover:hover) and (pointer:fine){.sqv-btn:hover{color:var(--text);background:rgba(180,214,218,.12)}.sqv-btn[aria-pressed=true]:hover{color:var(--ink);background:var(--moon)}.sqv-chip:hover{border-color:var(--moon)}}
.sqv-hud button:focus-visible{outline:2px solid var(--moon);outline-offset:2px}
.sqv-right{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.sqv-clock{pointer-events:auto;display:flex;gap:8px;align-items:center;padding:0 12px;height:44px;font-variant-numeric:tabular-nums}
.sqv-moon{width:12px;height:12px;border-radius:50%;box-shadow:inset -4px 0 0 0 var(--moon);background:transparent;flex:none;transition:opacity .15s ease}
.sqv-sun{background:var(--glow);box-shadow:none}
.sqv-badge{font-size:14px;letter-spacing:1px;color:var(--ok);padding-left:8px;border-left:2px solid var(--line)}
.sqv-badge:empty{display:none}
.sqv-prompt{pointer-events:auto;align-self:center;margin:0 auto;display:flex;gap:8px;align-items:center;height:44px;padding:0 14px;font:inherit;color:var(--text);cursor:pointer;opacity:0;transform:translateY(8px);transition:opacity .2s var(--ease-out),transform .2s var(--ease-out);visibility:hidden}
.sqv-prompt[data-show=true]{opacity:1;transform:none;visibility:visible}
.sqv-key{border:2px solid var(--moon);color:var(--moon);padding:3px 5px;border-radius:2px;font-size:13px}
.sqv-trip{display:none;pointer-events:auto;height:44px;padding:0 14px;color:var(--ink);background:var(--glow);border:2px solid var(--ink);font:inherit;cursor:pointer;border-radius:3px}
.sqv-trip[data-show=true]{display:block;animation:sqv-pop .2s var(--ease-out)}
@keyframes sqv-pop{from{transform:scale(.95);opacity:0}to{transform:none;opacity:1}}
.sqv-help{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:72px;width:min(280px,calc(100% - 20px));padding:12px;pointer-events:auto;font-size:14px;line-height:1.5;opacity:0;transform:translateY(8px);visibility:hidden;transition:opacity .2s var(--ease-drawer),transform .2s var(--ease-drawer),visibility 0s .2s}
.sqv-help[data-open=true]{opacity:1;transform:none;visibility:visible;transition-delay:0s}
.sqv-help b{color:var(--moon);font-weight:normal}
.sqv-calm .sqv-prompt,.sqv-calm .sqv-help,.sqv-calm .sqv-trip{transition-duration:.12s;transform:none;animation:none}
@media (max-width:640px){
 .sqv-hud{justify-content:space-between}
 .sqv-top{flex-wrap:nowrap;justify-content:center}
 .sqv-top .sqv-seg{transform-origin:top left}
 .sqv-bottom{flex-direction:column-reverse;align-items:stretch;gap:6px}
 .sqv-chips{justify-content:flex-start;width:100%}
 .sqv-btn{min-width:44px;padding:0 8px}
 .sqv-clock{padding:0 8px}
 .sqv-help{bottom:76px}
}
@media (prefers-reduced-motion:reduce){.sqv-chip[data-state=waiting_for_student]::before{animation:none;opacity:.5}.sqv-prompt,.sqv-help{transition-duration:.12s;transform:none}}
`;
