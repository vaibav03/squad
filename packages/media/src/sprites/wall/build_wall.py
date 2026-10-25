#!/usr/bin/env python3
"""Persona Wall: python3 packages/media/src/sprites/wall/build_wall.py
Writes assets/sprites/wall/{wall-dark.png, wall-light.png, persona-wall.html}. Rebuilds from whatever is in assets/sprites.
Design rules from docs/design/DESIGN.md: night art never sits on white (each sprite gets a sky-deep plate), integer scales, Jersey 10 + Inter."""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '../../../../..'))
sys.path.insert(0, os.path.join(ROOT, 'assets/pixel/composed/scripts'))
from palette import PALETTE, RGB
from PIL import Image, ImageDraw, ImageFont

SP = os.path.join(ROOT, 'assets/sprites'); OUT = os.path.join(SP, 'wall')
JERSEY = os.path.join(ROOT, 'assets/fonts/jersey-10/Jersey10-Regular.ttf'); INTER = os.path.join(ROOT, 'assets/fonts/inter/InterVariable.ttf')
meta = json.load(open(os.path.join(SP, 'cast.meta.json'))); P = meta['personas']
STRIP = [('idle', 2), ('walk', 4), ('talk', 2), ('sit', 2), ('wave', 2)]

def frames(pid):
    out = {}
    for k, n in STRIP:
        s = Image.open(os.path.join(SP, pid, k + '.png')).convert('RGBA')
        out[k] = [s.crop((i * 32, 0, i * 32 + 32, 32)) for i in range(n)]
    return out

def render(theme, scale=3):
    paper = theme == 'light'
    bg, fg, mut, line = ((0xf4, 0xf1, 0xe8), RGB['sky-deep'], RGB['wall-shade'], (0xd6, 0xd3, 0xc6)) if paper else (RGB['ink'], (0xee, 0xf3, 0xf8), (0x8f, 0xb0, 0xc4), (0x1d, 0x41, 0x63))
    cell = 32 * scale; plate_w = (2 + 4 + 2 + 2 + 2) * cell + 5 * 6 + 12
    pad = 16; col_w = plate_w + cell + pad * 3; cols = 1
    rows = len(P); rowh = cell + 40
    W = pad * 2 + 130 + plate_w + cell + 12; H = 72 + rows * rowh + pad
    im = Image.new('RGBA', (W, H), bg + (255,)); d = ImageDraw.Draw(im)
    fj, fi = ImageFont.truetype(JERSEY, 30), ImageFont.truetype(INTER, 13)
    d.text((pad, 14), f'PERSONA WALL  {len(P)} characters  {scale}x  {"day" if paper else "night"}', font=fj, fill=fg)
    d.text((pad, 46), 'idle 2 | walk 4 | talk 2 | sit 2 | wave 2 | portrait', font=fi, fill=mut)
    for i, p in enumerate(P):
        y = 72 + i * rowh; d.line([(pad, y - 6), (W - pad, y - 6)], fill=line)
        d.text((pad, y), p['name'], font=ImageFont.truetype(JERSEY, 22), fill=fg); d.text((pad, y + 22), p['role'], font=fi, fill=mut)
        plate = Image.new('RGBA', (plate_w, cell + 8), RGB['sky-deep'] + (255,)); fr = frames(p['id']); x = 6
        for k, n in STRIP:
            for f in fr[k]: plate.alpha_composite(f.resize((cell, cell), Image.NEAREST), (x, 4)); x += cell
            x += 6
        im.alpha_composite(plate, (pad + 130, y))
        port = Image.open(os.path.join(SP, p['id'], 'portrait.png')).convert('RGBA').resize((cell, cell), Image.NEAREST)
        im.alpha_composite(port, (pad + 130 + plate_w + 12, y))
    im.convert('RGB').save(os.path.join(OUT, f'wall-{"light" if paper else "dark"}.png'), optimize=True)

HTML = r'''<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Persona Wall</title>
<style>
@font-face{font-family:"Jersey 10";src:url(../../fonts/jersey-10/Jersey10-latin.woff2) format("woff2");font-display:swap}
@font-face{font-family:"Inter";src:url(../../fonts/inter/InterVariable-latin.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{__TOKENS__
 --bg:var(--ink);--fg:#eef3f8;--mut:#8fb0c4;--card:var(--sky-deep);--line:#1d4163;--chip:#0f2a4a;--accent:var(--glow);--on-accent:var(--ink);--px:3}
:root[data-theme="light"]{--bg:#f4f1e8;--fg:#0b1d38;--mut:#4d5b78;--card:#fbf9f3;--line:#d6d3c6;--chip:#e9e5d8;--accent:var(--sky-deep);--on-accent:var(--moon)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/24px Inter,system-ui,sans-serif}
header{display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-end;justify-content:space-between;padding:32px 16px 8px;max-width:1280px;margin:0 auto}
h1{font:400 56px/1 "Jersey 10",monospace;margin:0;letter-spacing:0}
header p{margin:8px 0 0;color:var(--mut);max-width:56ch;font-size:14px;line-height:20px}
.ctl{display:flex;gap:8px;flex-wrap:wrap}
button{font:500 14px/20px Inter,sans-serif;min-height:44px;min-width:48px;padding:0 16px;border:2px solid var(--line);background:var(--chip);color:var(--fg);cursor:pointer;border-radius:8px;transition:background-color .15s,transform .1s}
button:active{transform:scale(.97)}
button[aria-pressed="true"]{background:var(--accent);color:var(--on-accent);border-color:var(--ink)}
button:focus-visible{outline:3px solid var(--violet);outline-offset:2px}
main{max-width:1280px;margin:0 auto;padding:8px 16px 64px}
h2{font:400 28px/1 "Jersey 10",monospace;margin:32px 0 12px;color:var(--mut)}
.plate{background:var(--sky-deep);border:2px solid var(--ink);border-radius:10px;padding:16px;display:flex;gap:calc(var(--px)*8px);align-items:flex-end;overflow-x:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,calc(var(--px)*32px*4 + 56px)),1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;display:grid;gap:12px}
.top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.card h3{margin:0;font:400 22px/22px "Jersey 10",monospace}.card small{color:var(--mut);font-size:12px;line-height:16px}
.stage{background:var(--sky-deep);border:2px solid var(--ink);border-radius:8px;padding:8px;display:flex;gap:4px;align-items:flex-end;justify-content:space-around}
.sp{width:calc(var(--px)*32px);height:calc(var(--px)*32px);flex:none;background-repeat:no-repeat;image-rendering:pixelated;background-size:auto 100%}
.sp[data-a="walk"]{animation:walk .5s steps(4) infinite}.sp[data-a="idle"]{animation:idle 1s steps(2) infinite}.sp[data-a="talk"]{animation:talk .25s steps(2) infinite}.sp[data-a="wave"]{animation:wave .5s steps(2) infinite}
@keyframes walk{to{background-position-x:calc(var(--px)*-128px)}}@keyframes idle{to{background-position-x:calc(var(--px)*-64px)}}@keyframes talk{to{background-position-x:calc(var(--px)*-64px)}}@keyframes wave{to{background-position-x:calc(var(--px)*-64px)}}
.port{width:calc(var(--px)*32px);height:calc(var(--px)*32px);image-rendering:pixelated;flex:none;border-radius:0}
.sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}.sw div{padding:32px 8px 8px;font:12px/16px Inter,sans-serif;border:2px solid var(--ink);border-radius:8px}
@media (max-width:560px){:root{--px:2}h1{font-size:44px}}
@media (prefers-reduced-motion:reduce){.sp{animation:none!important}}
</style></head><body>
<header><div><h1>PERSONA WALL</h1><p>All __N__ characters of the Squad cast: the walk, idle, talk and wave loops at integer scale, with their portraits. Master palette only; every pixel is checked by the build.</p></div>
<div class="ctl" role="group" aria-label="Display options"><button data-t="dark" aria-pressed="true">Night</button><button data-t="light" aria-pressed="false">Day</button><button data-s="2" aria-pressed="false">2x</button><button data-s="3" aria-pressed="true">3x</button><button data-s="4" aria-pressed="false">4x</button></div></header>
<main><h2>Squad of three walking</h2><div class="plate" id="squad" aria-label="Three students walking together"></div>
<h2>Cast</h2><div class="grid" id="grid"></div><h2>Palette</h2><div class="sw" id="sw"></div></main>
<script>
const P=__DATA__;
const sp=(p,a)=>`<div class="sp" data-a="${a}" role="img" aria-label="${p.name} ${a}" style="background-image:url(../${p.id}/${a}.png)"></div>`;
document.getElementById('grid').innerHTML=P.map(p=>`<article class="card"><div class="top"><div><h3>${p.name}</h3><small>${p.role==p.id?p.role:p.role+' &middot; '+p.id}</small></div><img class="port" alt="${p.name} portrait" src="../${p.id}/portrait.png"></div><div class="stage">${['walk','idle','talk','wave'].map(a=>sp(p,a)).join('')}</div></article>`).join('');
document.getElementById('squad').innerHTML=['student-02','student-04','student-06'].map(id=>P.find(p=>p.id==id)).filter(Boolean).map(p=>sp(p,'walk')).join('');
const lum=v=>parseInt(v.slice(1,3),16)*.3+parseInt(v.slice(3,5),16)*.6+parseInt(v.slice(5,7),16)*.1;
document.getElementById('sw').innerHTML=Object.entries(__PAL__).map(([k,v])=>`<div style="background:${v};color:${lum(v)>140?'#070f1f':'#fff2c4'}">${k}<br>${v}</div>`).join('');
const root=document.documentElement;const cur=getComputedStyle(root).getPropertyValue('--px').trim();document.querySelectorAll('[data-s]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.s===cur)));
document.querySelectorAll('button').forEach(b=>b.onclick=()=>{
 if(b.dataset.t){root.dataset.theme=b.dataset.t;document.querySelectorAll('[data-t]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}
 if(b.dataset.s){root.style.setProperty('--px',b.dataset.s);document.querySelectorAll('[data-s]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}});
</script></body></html>'''

def main():
    os.makedirs(OUT, exist_ok=True)
    for t in ('light', 'dark'): render(t)
    tokens = ''.join(f'--{k}:{v};' for k, v in PALETTE.items())
    html = HTML.replace('__TOKENS__', tokens).replace('__N__', str(len(P))).replace('__DATA__', json.dumps(P)).replace('__PAL__', json.dumps(PALETTE))
    open(os.path.join(OUT, 'persona-wall.html'), 'w').write(html); print('wall', len(P))
if __name__ == '__main__': main()
