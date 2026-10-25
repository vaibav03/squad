/**
 * HUD stylesheet (docs/design/DESIGN.md section 8). Values mirror docs/design/tokens.css (the village does not import web CSS).
 * DOM animates only transform and opacity; hover only on fine pointers; 44 px targets; pixel font Jersey 10 at 18.667 px (2 art px).
 */
export const HUD_CSS = `
.sqv-hud{--ink:#070f1f;--hud-bg:rgb(11 29 56/.8);--hud-border:rgb(180 214 218/.2);--secondary:#12335a;--accent:#174a73;--fg:#eef3f8;--muted:#8fb0c4;--ring:#b4d6da;
 --glow:#ffc857;--moon:#fff2c4;--ok:#5fcf8a;--alert:#e0485a;--ember:#f08a3a;--idle:#6fa3b8;
 --ease-out:cubic-bezier(.23,1,.32,1);--ease-drawer:cubic-bezier(.32,.72,0,1);
 --top-h:auto;--bottom-h:auto;
 position:absolute;inset:0;pointer-events:none;z-index:5;color:var(--fg);box-sizing:border-box;
 font-family:'Jersey 10','Jersey 10 Fallback',ui-monospace,Menlo,Consolas,monospace;font-size:18.667px;line-height:1;letter-spacing:0;-webkit-font-smoothing:none;font-smooth:never;text-rendering:optimizeSpeed;
 display:grid;grid-template-columns:1fr auto 1fr;grid-template-rows:var(--top-h) 1fr var(--bottom-h);
 padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));gap:8px}
.sqv-hud *{box-sizing:border-box}
.sqv-hud[data-out-top=true]{top:calc(-1 * var(--top-h));padding-top:max(8px,env(safe-area-inset-top))}
.sqv-hud[data-out-bottom=true]{bottom:calc(-1 * var(--bottom-h));padding-bottom:max(8px,env(safe-area-inset-bottom))}
.sqv-panel{pointer-events:auto;background:var(--hud-bg);border:1px solid var(--hud-border);box-shadow:0 0 0 2px var(--ink),0 6px 18px rgb(7 15 31/.45);border-radius:12px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.sqv-chips{grid-area:1/1;justify-self:start;display:flex;gap:8px;padding:6px;max-width:100%;overflow-x:auto;scrollbar-width:none;align-self:start}
.sqv-chips::-webkit-scrollbar{display:none}
.sqv-clock-wrap{grid-area:1/2;align-self:start;justify-self:center}
.sqv-ctrl{grid-area:1/3;justify-self:end;align-self:start;display:flex;gap:8px;align-items:center}
.sqv-mid{grid-area:2/1/3/4;position:relative}
.sqv-bottom{grid-area:3/1/4/4}
.sqv-chip{position:relative;flex:none;width:44px;height:44px;border-radius:10px;border:0;background:var(--secondary);color:var(--fg);font:inherit;font-size:28px;display:grid;place-items:center;cursor:pointer;padding:0;
 box-shadow:0 0 0 2px var(--ink);transition:opacity .15s ease,transform .16s var(--ease-out),box-shadow .15s ease}
.sqv-chip:active{transform:scale(.97)}
.sqv-chip .sqv-initial{transform:translateY(-1px)}
.sqv-chip[data-state=idle]{opacity:.82}
.sqv-chip[data-selected=true]{outline:2px solid var(--ring,#b4d6da);outline-offset:2px}
.sqv-chip:focus-visible{outline:2px solid var(--ring,#b4d6da);outline-offset:2px}
.sqv-chip[data-state=studying]{box-shadow:0 0 0 2px var(--ink),0 0 0 4px var(--glow)}
.sqv-chip[data-state=in_call]{box-shadow:0 0 0 2px var(--ink),0 0 0 4px var(--ok)}
.sqv-chip[data-state=waiting_for_student]{box-shadow:0 0 0 2px var(--ink),0 0 0 4px var(--ember)}
.sqv-chip[data-state=waiting_for_student]::before{content:'';position:absolute;inset:-7px;border-radius:14px;border:2px solid var(--ember);opacity:.6;animation:sqv-ring 1.6s var(--ease-out) infinite}
.sqv-calm .sqv-chip::before{animation:none!important;opacity:.55}
.sqv-glyph{position:absolute;right:-6px;bottom:-6px;min-width:18px;height:18px;padding:0 3px;border-radius:9px;background:var(--ink);border:2px solid var(--secondary);font-size:18.667px;display:grid;place-items:center;color:var(--idle)}
.sqv-chip[data-state=studying] .sqv-glyph{color:var(--glow)}.sqv-chip[data-state=in_call] .sqv-glyph{color:var(--ok)}.sqv-chip[data-state=waiting_for_student] .sqv-glyph{color:var(--ember)}
.sqv-chip img{width:32px;height:32px;object-fit:none;object-position:center top;image-rendering:pixelated}
@keyframes sqv-ring{from{transform:scale(1);opacity:.6}to{transform:scale(1.15);opacity:0}}
.sqv-seg{display:flex;padding:3px;gap:3px}
.sqv-btn{min-width:48px;height:44px;padding:0 12px;font:inherit;color:var(--muted);background:transparent;border:0;border-radius:9px;cursor:pointer;transition:color .15s ease,background-color .15s ease,transform .16s var(--ease-out);white-space:nowrap}
.sqv-btn:active{transform:scale(.97)}
.sqv-btn[aria-pressed=true],.sqv-btn[aria-checked=true]{color:var(--ink);background:var(--glow)}
@media (hover:hover) and (pointer:fine){.sqv-btn:hover{color:var(--fg);background:var(--accent)}.sqv-btn[aria-pressed=true]:hover,.sqv-btn[aria-checked=true]:hover{color:var(--ink);background:var(--glow)}.sqv-chip:hover{box-shadow:0 0 0 2px var(--ink),0 0 0 4px var(--ring)}}
.sqv-hud button:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.sqv-clock{display:flex;gap:8px;align-items:center;padding:0 14px;height:44px;font-variant-numeric:tabular-nums;white-space:nowrap}
.sqv-moon{width:12px;height:12px;border-radius:50%;box-shadow:inset -4px 0 0 0 var(--moon);flex:none}
.sqv-sun{background:var(--glow);box-shadow:none}
.sqv-badge{font-family:'Silkscreen','Jersey 10',monospace;font-size:8px;letter-spacing:.06em;color:var(--ok);padding-left:8px;border-left:2px solid var(--hud-border);text-transform:uppercase}
.sqv-badge:empty{display:none}
.sqv-prompt{pointer-events:auto;position:absolute;left:50%;bottom:0;display:flex;gap:10px;align-items:center;height:44px;padding:0 14px;font:inherit;color:var(--fg);cursor:pointer;opacity:0;transform:translate(-50%,8px);transition:opacity .2s var(--ease-out),transform .2s var(--ease-out);visibility:hidden;white-space:nowrap;max-width:100%}
.sqv-prompt[data-show=true]{opacity:1;transform:translate(-50%,0);visibility:visible}
.sqv-key{border:2px solid var(--moon);color:var(--moon);padding:3px 6px;border-radius:5px;font-size:14px}
.sqv-trip{display:none;pointer-events:auto;position:absolute;right:0;bottom:0;height:44px;padding:0 16px;color:var(--ink);background:var(--glow);border:0;box-shadow:0 0 0 2px var(--ink);font:inherit;cursor:pointer;border-radius:10px}
.sqv-trip[data-show=true]{display:block;animation:sqv-pop .2s var(--ease-out)}
@keyframes sqv-pop{from{transform:scale(.95);opacity:0}to{transform:none;opacity:1}}
.sqv-menu{display:none;grid-area:1/3;justify-self:end;align-self:start}
.sqv-pop{display:none}
.sqv-help{position:absolute;right:0;top:0;width:min(300px,100%);padding:14px;pointer-events:auto;font-size:18.667px;line-height:1.35;opacity:0;transform:translateY(8px);visibility:hidden;transition:opacity .2s var(--ease-drawer),transform .2s var(--ease-drawer),visibility 0s .2s}
.sqv-help[data-open=true]{opacity:1;transform:none;visibility:visible;transition-delay:0s}
.sqv-help b{color:var(--moon);font-weight:normal}
.sqv-calm .sqv-prompt,.sqv-calm .sqv-help{transition-duration:.12s}
.sqv-calm .sqv-prompt{transform:translate(-50%,0)}
.sqv-calm .sqv-help{transform:none}
.sqv-calm .sqv-trip{animation:none}
/* narrow (phone): clock + menu on top, chips in the bottom dock, camera/calm/help inside the menu popover */
.sqv-hud[data-layout=narrow]{grid-template-columns:1fr auto}
.sqv-hud[data-layout=narrow] .sqv-clock-wrap{grid-area:1/1;justify-self:start}
.sqv-hud[data-layout=narrow] .sqv-menu{display:block;grid-area:1/2}
.sqv-hud[data-layout=narrow] .sqv-ctrl{display:none}
.sqv-hud[data-layout=narrow] .sqv-mid{grid-area:2/1/3/3}
.sqv-hud[data-layout=narrow] .sqv-bottom{grid-area:3/1/4/3;display:flex;align-items:flex-end}
.sqv-hud[data-layout=narrow] .sqv-chips{grid-area:auto;width:100%;justify-content:flex-start;align-self:end;pointer-events:auto}
.sqv-hud[data-layout=narrow] .sqv-menu .sqv-seg{padding:0}
.sqv-hud[data-layout=narrow] .sqv-pop .sqv-panel{box-shadow:none;border:0;background:none;backdrop-filter:none;-webkit-backdrop-filter:none}
.sqv-hud[data-layout=narrow] .sqv-pop{display:flex;flex-direction:row;flex-wrap:wrap;gap:4px;width:100%;position:absolute;right:0;top:0;padding:8px;opacity:0;transform:translateY(8px);visibility:hidden;transition:opacity .2s var(--ease-drawer),transform .2s var(--ease-drawer),visibility 0s .2s;pointer-events:auto;align-items:stretch}
.sqv-hud[data-layout=narrow] .sqv-pop[data-open=true]{opacity:1;transform:none;visibility:visible;transition-delay:0s}
.sqv-hud[data-layout=narrow] .sqv-pop .sqv-seg{padding:0;background:none;border:0;box-shadow:none;backdrop-filter:none}
.sqv-hud[data-layout=narrow] .sqv-prompt{bottom:8px}
@media (prefers-reduced-motion:reduce){.sqv-chip[data-state=waiting_for_student]::before{animation:none;opacity:.55}.sqv-prompt,.sqv-help,.sqv-pop{transition-duration:.12s}}
`;
