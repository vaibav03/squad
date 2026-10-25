#!/usr/bin/env python3
"""Persona Wall: python3 packages/media/src/sprites/wall/build_wall.py
Writes assets/sprites/wall/{wall-light.png, wall-dark.png, persona-wall.html}. Rebuilds from whatever is in assets/sprites."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'assets/pixel/composed/scripts'))
from palette import PALETTE, RGB
from PIL import Image, ImageDraw, ImageFont

SP = os.path.join(ROOT, 'assets/sprites'); OUT = os.path.join(SP, 'wall')
FONT = os.path.join(OUT, 'pixel-font.ttf')
meta = json.load(open(os.path.join(SP, 'cast.meta.json')))
P = meta['personas']
STRIP = ['idle_r_0', 'idle_r_1', 'walk_r_0', 'walk_r_1', 'walk_r_2', 'walk_r_3', 'idle_f_0', 'idle_f_1', 'talk_f_0', 'talk_f_1', 'talk_r_0', 'talk_r_1']

def frames(pid):
    d = os.path.join(SP, pid); fj = json.load(open(os.path.join(d, 'frames.json'))); sh = Image.open(os.path.join(d, fj['image'])).convert('RGBA')
    return {n: sh.crop((r['x'], r['y'], r['x']+r['w'], r['y']+r['h'])) for n, r in fj['frames'].items()}

def render(theme, scale):
    bg, fg, mut, line = (RGB['wall-lit'], RGB['ink'], RGB['wall-shade'], RGB['wall-mid']) if theme == 'light' else (RGB['sky-deep'], RGB['moon'], RGB['cloud-lo'], RGB['hill-near'])
    cell = 24*scale; cols = len(STRIP); pw = 40*scale; rowh = max(cell, pw) + 14*2 + 8
    W = 16 + pw + 12 + cell*cols + 16; H = 56 + rowh*len(P) + 16
    im = Image.new('RGBA', (W, H), bg + (255,)); d = ImageDraw.Draw(im)
    f1 = ImageFont.truetype(FONT, 16); f2 = ImageFont.truetype(FONT, 12)
    d.text((16, 14), f'PERSONA WALL  {theme}  {scale}x', font=f1, fill=fg); d.text((16, 34), 'idle r x2 | walk r x4 | idle f x2 | talk f x2 | talk r x2', font=f2, fill=mut)
    for i, p in enumerate(P):
        y = 56 + i*rowh; d.line([(16, y-4), (W-16, y-4)], fill=line)
        d.text((16, y), f"{p['name']}  ({p['role']})", font=f2, fill=fg)
        fr = frames(p['id']); pimg = Image.open(os.path.join(SP, p['id'], 'portrait.png')).convert('RGBA').resize((pw, pw), Image.NEAREST)
        im.alpha_composite(pimg, (16, y+14))
        for k, n in enumerate(STRIP): im.alpha_composite(fr[n].resize((cell, cell), Image.NEAREST), (16+pw+12+k*cell, y+14))
    im.convert('RGB').save(os.path.join(OUT, f'wall-{theme}.png'), optimize=True)

HTML = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Persona Wall</title>
<style>
@font-face{font-family:"Ninja";src:url(pixel-font.ttf) format("truetype")}
:root{__TOKENS__
 --bg:var(--sky-deep);--fg:var(--moon);--mut:var(--cloud-lo);--card:var(--ground);--line:var(--hill-near);--scale:3;--chip:var(--sky-mid)}
:root[data-theme="light"]{--bg:var(--wall-lit);--fg:var(--ink);--mut:var(--wall-shade);--card:#dfe6f0;--line:var(--wall-mid);--chip:var(--cloud-hi)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
header{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:end;justify-content:space-between;padding:24px 16px 8px;max-width:1280px;margin:0 auto}
h1{font:400 28px/1 "Ninja",monospace;margin:0;letter-spacing:.04em}
header p{margin:6px 0 0;color:var(--mut);max-width:52ch}
.ctl{display:flex;gap:8px}
button{font:inherit;min-height:44px;padding:0 16px;border:2px solid var(--line);background:var(--chip);color:var(--fg);cursor:pointer;border-radius:0}
button[aria-pressed="true"]{background:var(--glow);color:var(--ink);border-color:var(--ink)}
button:focus-visible{outline:3px solid var(--violet);outline-offset:2px}
main{max-width:1280px;margin:0 auto;padding:8px 16px 48px}
h2{font:400 18px/1 "Ninja",monospace;margin:28px 0 12px;color:var(--mut);letter-spacing:.06em}
.squad{display:flex;gap:24px;align-items:end;padding:24px;background:var(--card);border:2px solid var(--line);overflow-x:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,calc(var(--scale)*104px + 24px)),1fr));gap:12px}
.card{background:var(--card);border:2px solid var(--line);padding:12px;display:grid;gap:10px}
.card h3{margin:0;font:400 16px/1.1 "Ninja",monospace}.card small{color:var(--mut)}
.row{display:flex;align-items:flex-end;gap:12px;min-height:calc(var(--scale)*24px)}
.sp{width:calc(var(--scale)*24px);height:calc(var(--scale)*24px);flex:none;background-repeat:no-repeat;image-rendering:pixelated;background-size:calc(var(--scale)*var(--w)*24px) calc(var(--scale)*24px)}
.sp.walk{animation:walk .5s steps(4) infinite}.sp.idle{animation:idle 1s steps(2) infinite}.sp.talk{animation:talk .25s steps(2) infinite}
@keyframes walk{from{background-position-x:calc(var(--scale)*-24px*var(--s0))}to{background-position-x:calc(var(--scale)*-24px*(var(--s0) + 4))}}
@keyframes idle{from{background-position-x:calc(var(--scale)*-24px*var(--s0))}to{background-position-x:calc(var(--scale)*-24px*(var(--s0) + 2))}}
@keyframes talk{from{background-position-x:calc(var(--scale)*-24px*var(--s0))}to{background-position-x:calc(var(--scale)*-24px*(var(--s0) + 2))}}
.port{width:calc(var(--scale)*40px);height:calc(var(--scale)*40px);image-rendering:pixelated;flex:none}.top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px}.sw div{padding:28px 6px 6px;font-size:11px;border:2px solid var(--line)}
@media (prefers-reduced-motion:reduce){.sp{animation:none!important}}
</style></head><body>
<header><div><h1>PERSONA WALL</h1><p>Every character of the Squad cast: walk, idle and talk loops at integer scale, plus pixel portraits. __N__ characters, master palette only.</p></div>
<div class="ctl" role="group" aria-label="Display"><button data-t="dark" aria-pressed="true">Night</button><button data-t="light" aria-pressed="false">Day</button><button data-s="2" aria-pressed="false">2x</button><button data-s="3" aria-pressed="true">3x</button><button data-s="4" aria-pressed="false">4x</button></div></header>
<main><h2>SQUAD OF THREE</h2><div class="squad" id="squad" aria-label="Three students walking together"></div>
<h2>CAST</h2><div class="grid" id="grid"></div><h2>PALETTE</h2><div class="sw" id="sw"></div></main>
<script>
const P=__DATA__,W=__W__,STRIP=__STRIP__,col=n=>STRIP.indexOf(n);
const sp=(p,a,first,cls)=>`<div class="sp ${cls}" role="img" aria-label="${p.name} ${a}" style="--w:${W};--s0:${col(first)};background-image:url(../${p.id}/sheet.png)"></div>`;
const grid=document.getElementById('grid');
grid.innerHTML=P.map(p=>`<article class="card"><div class="top"><div><h3>${p.name}</h3><small>${p.role}<br>${p.source}</small></div><img class="port" alt="${p.name} portrait" src="../${p.id}/portrait.png"></div><div class="row">${sp(p,'walking','walk_r_0','walk')}${sp(p,'idle','idle_f_0','idle')}${sp(p,'talking','talk_f_0','talk')}</div></article>`).join('');
document.getElementById('squad').innerHTML=['student-01','student-04','student-02'].map(id=>P.find(p=>p.id==id)).filter(Boolean).map(p=>sp(p,'walking','walk_r_0','walk')).join('');
document.getElementById('sw').innerHTML=Object.entries(__PAL__).map(([k,v])=>`<div style="background:${v};color:${parseInt(v.slice(1,3),16)*.3+parseInt(v.slice(3,5),16)*.6+parseInt(v.slice(5,7),16)*.1>140?'#070f1f':'#fff2c4'}">${k}<br>${v}</div>`).join('');
const root=document.documentElement;
document.querySelectorAll('button').forEach(b=>b.onclick=()=>{
 if(b.dataset.t){root.dataset.theme=b.dataset.t;document.querySelectorAll('[data-t]').forEach(x=>x.setAttribute('aria-pressed',x===b))}
 if(b.dataset.s){root.style.setProperty('--scale',b.dataset.s);document.querySelectorAll('[data-s]').forEach(x=>x.setAttribute('aria-pressed',x===b))}});
</script></body></html>'''

def main():
    os.makedirs(OUT, exist_ok=True)
    for t in ('light', 'dark'): render(t, 3)
    tokens = ''.join(f'--{k}:{v};' for k, v in PALETTE.items())
    first = os.path.join(SP, P[0]['id'], 'sheet.png'); W = Image.open(first).width // 24 * 24 // 24  # frames per strip
    html = HTML.replace('__TOKENS__', tokens).replace('__N__', str(len(P))).replace('__DATA__', json.dumps(P)).replace('__W__', str(W)).replace('__STRIP__', json.dumps(STRIP_ORDER())).replace('__PAL__', json.dumps(PALETTE))
    open(os.path.join(OUT, 'persona-wall.html'), 'w').write(html)
    print('wall', len(P))

def STRIP_ORDER():
    """Strip order of sheet.png per docs/sprite-api.md writer: for anim in idle,walk,talk: for dir in r,f: frames."""
    out = []
    for a, n in (('idle', 2), ('walk', 4), ('talk', 2)):
        for d in ('r', 'f'):
            out += [f'{a}_{d}_{i}' for i in range(n)]
    return out

if __name__ == '__main__': main()
