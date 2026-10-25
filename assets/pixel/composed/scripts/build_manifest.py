#!/usr/bin/env python3
"""Build assets/asset-manifest.json and docs/design/asset-manifest.md (deterministic).

Reads the per-folder provenance.json files under assets/pixel/composed, but NEVER trusts them:
width/height/frame counts come from the PNG itself (PIL) and mismatches are reported in the
`verification` section. Run: python3 build_manifest.py   (from any cwd).
"""
import json, os, re, sys, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
COMP = os.path.join(REPO, 'assets', 'pixel', 'composed')
COMP_REL = 'assets/pixel/composed'
sys.path.insert(0, HERE)


def jload(p):
    with open(p) as f:
        return json.load(f)


PAL = jload(os.path.join(REPO, 'docs/design/palette.json'))
PROV = {g: jload(os.path.join(COMP, g, 'provenance.json')) for g in
        ['buildings', 'props', 'fx', 'ui', 'characters', 'backgrounds']}
ATLAS = jload(os.path.join(COMP, 'characters/atlas.json'))

# ---------------------------------------------------------------- licenses
L_ORIG = 'original, CC0-dedicated by Squad'
L_STYLE = 'original, CC0-dedicated by Squad; style reference Autumn Town (free to use)'
L_BG = 'original (procedural), CC0-dedicated by Squad'
L_CHAR = 'original, CC0-dedicated by Squad; style reference Autumn Town (free to use)'
L_AT = ('Autumn Town (Nirva): creator statement "free to use/edit in any commercial or personal project '
        'without crediting me" (not a formal CC license); derived night re-grade')
L_NINJA = 'CC0 1.0 (Ninja Adventure, Pixel-boy and AAA), requantized to Squad palette'
LIC_CODE = {L_ORIG: 'ORIG', L_STYLE: 'ORIG*', L_BG: 'ORIG', L_AT: 'AT', L_NINJA: 'CC0-NA'}


def fontlic(d):
    with open(os.path.join(REPO, 'assets/fonts', d, 'OFL.txt')) as f:
        first = f.readline().strip()
    return 'SIL OFL 1.1; ' + first


def map_lic(s, source=''):
    t = (s or '').lower()
    if t.startswith('autumn town'):
        return L_AT
    if 'ninja' in t:
        return L_NINJA
    if t.startswith('project-original (autumn') or 'autumn town palette' in t:
        return L_STYLE
    if 'original' in t:
        return L_ORIG
    return s


# ---------------------------------------------------------------- helpers
ASSETS = []
VERIFY = {'mismatches': [], 'notes': [], 'missing_files': [], 'off_palette': []}
_dim_cache = {}


def dims(rel):
    if rel not in _dim_cache:
        p = os.path.join(REPO, rel)
        if not os.path.exists(p):
            VERIFY['missing_files'].append(rel)
            _dim_cache[rel] = (0, 0)
        else:
            _dim_cache[rel] = Image.open(p).size
    return _dim_cache[rel]


def C(rel):  # composed-relative -> repo-relative
    return f'{COMP_REL}/{rel}'


def anchor_from(name, w, h):
    n = name or ''
    m = re.search(r'\((\d+),\s*(\d+)\)', n)
    if m:
        return [int(m.group(1)), int(m.group(2))]
    n = n.lower()
    if 'bottom-center' in n or n == 'bc':
        return [w // 2, h - 1]
    if 'bottom-left' in n:
        return [0, h - 1]
    if 'top-center' in n:
        return [w // 2, 0]
    if 'top-left' in n:
        return [0, 0]
    if 'top-right' in n:
        return [w - 1, 0]
    if 'left-center' in n:
        return [0, h // 2]
    if 'center' in n:
        return [w // 2, h // 2]
    return None


def origin_frac(anchor, w, h):
    if not anchor:
        return None
    x, y = anchor
    fx = round(x / w, 4)
    fy = 1.0 if y == h - 1 else round(y / h, 4)
    if x == w - 1 and anchor[0] != 0 and w > 1 and y == 0:
        fx = 1.0
    return [fx, fy]


def add(id, group, need, file, kind=None, frame=None, anchor=None, variants=None, scrollFactor=None,
        depth=None, license=None, source='', notes='', **extra):
    """frame: (fw, fh, fps|None) horizontal strip; sizes are computed from the PNG."""
    w, h = dims(file)
    fr = None
    if frame:
        fw, fh, fps = frame[:3]
        sp = frame[3] if len(frame) > 3 else 0
        cnt = ((w + sp) // (fw + sp)) * ((h + sp) // (fh + sp)) if fw and fh else 0
        if not sp and (w % fw or h % fh):
            VERIFY['mismatches'].append(f'{file}: size {w}x{h} is not a whole multiple of frame {fw}x{fh}')
        fr = {'w': fw, 'h': fh, 'count': cnt}
        if sp:
            fr['spacing'] = sp
        if fps:
            fr['fps'] = fps
    if kind is None:
        kind = 'spritesheet' if (fr and fr['count'] > 1) else 'image'
    aw, ah = (fr['w'], fr['h']) if fr else (w, h)
    if isinstance(anchor, str):
        anchor = anchor_from(anchor, aw, ah)
    a = {'id': id, 'group': group, 'need': need, 'file': file, 'kind': kind, 'size': [w, h]}
    if fr:
        a['frame'] = fr
    if anchor:
        a['anchor'] = anchor
        a['originFrac'] = origin_frac(anchor, aw, ah)
    if variants:
        a['variants'] = variants
        for k, v in variants.items():
            if isinstance(v, str):
                dims(v)
    if scrollFactor is not None:
        a['scrollFactor'] = scrollFactor
    a['depthHint'] = depth
    a['license'] = license
    a['source'] = source
    if notes:
        a['notes'] = notes
    a.update(extra)
    ASSETS.append(a)
    return a


def src_of(p, default=''):
    s = p.get('source', default)
    return s


# ================================================================== BUILDINGS
B = PROV['buildings']
STALE = ('Door/window/sign/chimney meta in assets/pixel/composed/buildings/provenance.json is in pre-trim canvas '
         'space and is NOT published here; only sprite size + anchor are authoritative. Re-measure on the trimmed PNG '
         'before attaching smoke, signs or door triggers.')

HOUSES = {
    'tenement': 'chapter house: tenement shape (tallest silhouette)',
    'shop': 'chapter house: shop shape',
    'hut': 'chapter house: hut shape (smallest, only one <=135px)',
    'cottage': 'chapter house: cottage shape',
    'brick': 'chapter house: brick shape',
}
for k, need in HOUSES.items():
    lit = B[f'houses/house_{k}_lit.png']
    dark = B[f'houses/house_{k}_dark.png']
    add(f'house.{k}', 'building', need, C(f'buildings/houses/house_{k}_lit.png'),
        anchor=lit['anchor'], variants={'lit': C(f'buildings/houses/house_{k}_lit.png'),
                                        'dark': C(f'buildings/houses/house_{k}_dark.png')},
        depth='buildings', license=map_lic(lit['license']),
        source=lit['source'], notes='lit = occupied/active chapter (warm windows), dark = idle chapter. ' + STALE,
        meta_coords_stale=True)
add('house.signboard', 'building', 'hanging sign plank for chapter houses (text drawn at runtime)',
    C('buildings/houses/signboard_empty.png'), anchor=B['houses/signboard_empty.png']['anchor'],
    depth='buildings', license=L_ORIG, source=B['houses/signboard_empty.png']['source'],
    notes='32x14 plank; flat text region x2..29,y6..12 (own art, not trimmed). Anchor is the BOTTOM row, '
          'so place it by its bottom-centre.')

LM = [
    ('council_hall', 'council hall exterior', 'council_hall'),
    ('debate_stage', 'debate stage', 'debate_stage'),
    ('round_table_pavilion', 'round table pavilion', 'round_table_pavilion'),
    ('feynman_porch', 'Feynman porch', 'feynman_porch'),
    ('oral_exam_hut', 'oral exam hut', 'oral_exam_hut'),
    ('rubric_courthouse', 'rubric courthouse', 'rubric_courthouse'),
    ('exam_oracle', 'exam oracle tower', 'exam_oracle'),
    ('devils_ta_cave', "devil's TA cave", 'devils_ta_cave'),
    ('classroom_house', 'classroom house', 'classroom_house'),
]
for key, need, base in LM:
    p = B[f'landmarks/{base}.png']
    extra = {}
    if base == 'round_table_pavilion':
        extra['seats'] = p['seats']  # own composed canvas, not trimmed after (verified below)
    add(f'landmark.{key.replace("_", "-")}', 'landmark', need, C(f'buildings/landmarks/{base}.png'),
        anchor=p['anchor'],
        variants={'active': C(f'buildings/landmarks/{base}.png'), 'locked': C(f'buildings/landmarks/{base}_locked.png')},
        depth='buildings', license=map_lic(p['license']), source=p['source'],
        notes='locked variant has identical size/anchor (dark windows, desaturated). Overlay ui.padlock on the door. ' + STALE,
        meta_coords_stale=True, **{k: v for k, v in extra.items() if k != 'seats'})
pb = B['landmarks/panic_booth_off.png']
pg = B['landmarks/panic_booth_glow.png']
add('landmark.panic-booth', 'landmark', 'panic booth (2am glow state)', C('buildings/landmarks/panic_booth_off.png'),
    anchor=pb['anchor'],
    variants={'off': C('buildings/landmarks/panic_booth_off.png'), 'glow': C('buildings/landmarks/panic_booth_glow.png'),
              'locked': C('buildings/landmarks/panic_booth_locked.png')},
    depth='buildings', license=map_lic(pb.get('license', 'project-original')),
    source='hand-pixeled landmark', notes='glow variant is 33x60 (wider: halo dither) with its own anchor '
    f'{pg["anchor"]}; off/locked are 28x60 anchor {pb["anchor"]}. Swap texture AND origin when toggling.',
    meta_coords_stale=True, glowAnchor=pg['anchor'])
add('landmark.padlock-8x8', 'landmark', 'padlock overlay centred on a locked landmark door',
    C('buildings/landmarks/padlock_8x8.png'), anchor=B['landmarks/padlock_8x8.png']['anchor'],
    depth='ui-world', license=L_ORIG, source='hand-pixeled', notes='duplicate of ui.padlock; prefer ui.padlock.')

wl, wd, ws = (B['windmill/windmill_lit.png'], B['windmill/windmill_dark.png'], B['windmill/windmill_sails_strip.png'])
add('landmark.windmill', 'landmark', 'windmill (tower body, no sails)', C('buildings/windmill/windmill_lit.png'),
    anchor=wl['anchor'], variants={'lit': C('buildings/windmill/windmill_lit.png'), 'dark': C('buildings/windmill/windmill_dark.png')},
    depth='buildings', license=L_ORIG, source=wl['source'],
    notes='hub (sail pivot) = [21,25] from sprite top-left; verified by eye on the lit PNG. 84px tall tower; windmill '
          'is a backdrop/landmark, not a foreground house.', hub=wl['hub'])
add('landmark.windmill.sails', 'landmark', 'windmill sail rotation strip', C('buildings/windmill/windmill_sails_strip.png'),
    frame=(72, 72, None), anchor=[36, 36], depth='buildings', license=L_ORIG, source=ws['source'],
    notes='8 frames x 11.25deg = one 90deg cycle (4-fold symmetric). Put pivot [36,36] on windmill hub: '
          'sailsX = windmillX + (hub.x - anchor.x) = windmillX + 0, sailsY = windmillY - (anchor.y - hub.y) = windmillY - 58 '
          '(windmill anchor [21,83], hub [21,25]); sails origin = their pivot (0.5,0.5). Loop frames 0..7 at 6-10 fps.',
    base_angle_deg=ws['base_angle_deg'], cycle_deg=ws['cycle_deg'])
lp = B['props/lamp_post_lit.png']
add('prop.lamp-post-tall-lit', 'prop', 'tall street lamp (lit only; larger than prop.lamp-post)',
    C('buildings/props/lamp_post_lit.png'), anchor=lp['anchor'], depth='props-back', license=map_lic(lp['license']),
    source=lp['source'], notes='23x95. No unlit twin. Prefer prop.lamp-post (24x64) at human scale; this one is kept '
                               'for a tall boulevard lamp at council hall.')

INTERIORS = [
    ('study', 'student study / chapter house interior', 'interior_study'),
    ('classroom', 'classroom house interior', 'interior_classroom'),
    ('council', 'council hall interior', 'interior_council'),
    ('oral-exam', 'oral exam hut interior', 'interior_oral_exam'),
]
for key, need, base in INTERIORS:
    p = B[f'interiors/{base}.png']
    add(f'interior.{key}', 'interior', need, C(f'buildings/interiors/{base}.png'), anchor=[112, p['floor_y']],
        depth='interior', license=L_STYLE, source='hand-pixeled interior composed in Autumn Town style',
        notes='224x128 untrimmed fixed canvas; floor line y=%d (anchor is floor-centre). Anchors (px from top-left): %s'
              % (p['floor_y'], json.dumps(p['anchors'])), floorY=p['floor_y'], anchors=p['anchors'])

# ================================================================== CHARACTERS
CH = PROV['characters']
PERSONAS = [
    ('student', 'persona: student (player)', 'persona'),
    ('dean', 'persona: dean', 'persona'),
    ('expert', 'persona: chapter expert', 'persona'),
    ('council-chill', 'persona: council member (chill)', 'persona'),
    ('council-hard', 'persona: council member (hard)', 'persona'),
    ('council-balance', 'persona: council member (balance)', 'persona'),
    ('chairman', 'persona: chairman', 'persona'),
    ('examiner', 'persona: examiner', 'persona'),
    ('freshman', 'persona: freshman (NPC)', 'npc'),
    ('mediator', 'persona: mediator', 'persona'),
    ('ta', 'persona: teaching assistant', 'persona'),
    ('cast-chill', 'council cast: Chill (green hoodie, tea, moon charm)', 'persona'),
    ('cast-grind', 'council cast: Grind (orange headband, books, coffee)', 'persona'),
    ('cast-advisor', 'council cast: Advisor (purple, glasses, clipboard)', 'persona'),
    ('cast-chair', 'council cast: Chairman (pale grey-blue, crest, gavel)', 'persona'),
]
ANIMS = CH['animations']
add('atlas.characters', 'persona', 'all 11 cast members, 5 animations + portrait each (single texture atlas)',
    C('characters/atlas.png'), kind='atlas', frame=(32, 32, None), anchor=[16, 31], depth='actors',
    license=L_CHAR, source='characters/atlas.png + atlas.json packed by make_characters.py',
    notes='Frame keys "<persona>/<anim>/<n>" and "<persona>/portrait"; atlas.json also carries Phaser `animations` '
          'with frameRate/repeat. All frames 32x32, pivot (0.5,1.0). Art faces RIGHT: flipX for left. '
          'Walk: planted foot moves 3px/frame so ground speed = 3*fps = 24 px/s at 8 fps.',
    atlasJson=C('characters/atlas.json'), facing='right', frameCount=len(ATLAS['frames']),
    animations={k: dict(v) for k, v in ANIMS.items()}, walkStridePxPerFrame=CH['walk']['stride_px_per_frame'])
for pid, need, grp in PERSONAS:
    info = CH['characters'][pid]
    cast = pid.startswith('cast-')
    vs = {a: C(f'characters/{pid}/{a}.png') for a in ['walk', 'idle', 'talk', 'sit', 'wave'] + (['think'] if cast else [])}
    if cast: vs['bust'] = C(f'characters/{pid}/bust.png')
    vs['portrait'] = C(f'characters/{pid}/portrait.png')
    add(f'persona.{pid}', grp, need, C(f'characters/{pid}/walk.png'), kind='atlas', frame=(32, 32, 8),
        anchor=[16, 31], variants=vs, depth='actors', license=L_CHAR,
        source='redrawn original, make_characters.py; proportions studied from Autumn Town player/NPC sheets '
               '(no pixels copied)',
        notes='Load through atlas.characters (frames "%s/<anim>/<n>"). Per-animation PNG strips in `variants` are '
              'for reference/tools only. role=%s; palette skin=%s hair=%s outfit=%s. Portrait is an opaque 32x32 tile '
              '(show at 2x/3x in UI).' % (pid, info['role'], info['skin'], info['hair'], info['outfit']),
        loadVia='atlas.characters', animations={a: {'frames': ATLAS['animations'][pid][a]['frames'] if cast else ANIMS[a]['frames'], 'fps': ATLAS['animations'][pid][a]['frameRate'] if cast else ANIMS[a]['fps']} for a in (ATLAS['animations'][pid] if cast else ANIMS)},
        loadVariants=False)

# ================================================================== BACKGROUNDS
BG = PROV['backgrounds']
LAYER_NEED = {
    '0_sky': ('sky gradient (night)', 'sky'),
    '1_stars': ('star field', 'sky'),
    '2_moon': ('crescent moon with halo', 'sky'),
    '3_clouds_far': ('far clouds', 'clouds-far'),
    '4_clouds_near': ('near clouds', 'clouds-near'),
    '5_hills_far': ('far pale hills', 'hills'),
    '6_hills_mid': ('mid hills', 'hills'),
    '7_hills_near': ('near hills', 'hills'),
    '8_fenceline': ('fence line + dark trees behind street', 'fence'),
    '9_ground': ('ground strip (street level)', 'ground'),
    '10_foreground': ('foreground grass in front of actors', 'foreground'),
}
for lid, lay in BG['layers'].items():
    need, depth = LAYER_NEED[lid]
    vs = {}
    notes = lay.get('note', '')
    kw = {}
    if lid == '0_sky':
        vs = {'dusk': C('backgrounds/0_sky_dusk.png'), 'dawn': C('backgrounds/0_sky_dawn.png'), 'day': C('backgrounds/0_sky_day.png')}
        kw['tileX'] = True
        notes = 'banded 2px-dither 16x270 column: stretch/tile across the viewport width (tileSprite, scrollFactor 0). ' \
                'Variants are time-of-day skies of identical size.'
    if lid == '1_stars':
        vs = {f'twinkle_{i}': C(f'backgrounds/1_stars_twinkle_{i}.png') for i in range(4)}
        vs['twinkle_mask'] = C('backgrounds/1_stars_twinkle_mask.png')
        notes = 'static star field; cycle the 4 twinkle frames (~400 ms each) as a second tileSprite on top, or tween ' \
                'alpha. twinkle_mask marks the animated pixels.'
        kw['twinkleMsPerFrame'] = 400
    anch = None
    if lid == '2_moon':
        anch = [40, 40]
        notes = 'crescent 29px, halo r=33, origin (0.5,0.5); suggested screen position (86,56) of a 427x240 view'
    if lid == '9_ground':
        anch = [0, 0]
        notes = 'origin top-left at y=240 (top of the ground band). 480x30.'
    if lid in ('3_clouds_far', '4_clouds_near'):
        notes = 'full 480x270 composed layer; individual cloud sprites are listed separately (parallax.cloud-*). ' \
                'Drift slowly +x (tile position or sprite tween) on top of the scrollFactor.'
    elif lid not in ('0_sky', '1_stars', '2_moon', '9_ground'):
        anch = [0, 269]
        notes = (notes + ' ' if notes else '') + 'bottom-anchored 480x270 tile, x-wraps seamlessly; origin (0,1) at world y=270.'
    add(f'parallax.{lid}', 'parallax', need, C(f'backgrounds/{lay["file"]}'), kind='tile', anchor=anch,
        variants=vs or None, scrollFactor=lay['scrollFactor'], depth=depth, license=L_BG,
        source='make_backgrounds.py (procedural, palette-only)', notes=notes, groundLineY=240, **kw)
for fam, n in (('far', 6), ('near', 5)):
    for i in range(n):
        add(f'parallax.cloud-{fam}-{i}', 'parallax', f'{fam} cloud sprite {i} (free-floating drifters)',
            C(f'backgrounds/clouds/{fam}_{i}.png'), anchor='center', scrollFactor=0.1 if fam == 'far' else 0.2,
            depth='clouds-far' if fam == 'far' else 'clouds-near', license=L_BG,
            source='make_backgrounds.py', notes='outlined puffy cloud sprite; use for spawning drifting clouds.')

# ================================================================== PROPS
P = PROV['props']
PROP_NEED = {
    'bench': 'bench (sit spot)', 'barrel': 'barrel', 'stall-bunting': 'market stall with bunting',
    'stall-awning': 'market stall awning', 'bunting-a': 'bunting string (long)', 'bunting-b': 'bunting string (short)',
    'sofa': 'sofa (interior)', 'sofa-small': 'small sofa (interior)', 'bookshelf': 'bookshelf (interior)',
    'signpost-board': 'signpost board', 'signpost-arrow': 'signpost arrow', 'stump': 'tree stump (sit spot)',
    'shelf-table': 'shelf table (interior)', 'crate-a': 'crate', 'crate-b': 'crate', 'stool': 'stool',
    'lamp-post': 'street lamp (unlit)', 'lamp-post-lit': 'street lamp (lit)', 'lamp-halo': 'lamp light pool (warm dither)',
    'rock-big': 'rock', 'rock-small': 'rock', 'tuft-a': 'grass tuft', 'tuft-b': 'grass tuft', 'tuft-c': 'grass tuft',
    'tuft-d': 'grass tuft', 'flower': 'flower', 'flower-1': 'flower', 'flower-2': 'flower', 'flower-3': 'flower',
    'tree-1': 'round dark tree', 'tree-2': 'round dark tree', 'tree-3': 'round dark tree', 'tree-4': 'round dark tree',
    'tree-5': 'round dark tree', 'tree-6': 'round dark tree', 'pine-1': 'pine tree', 'pine-2': 'pine tree',
    'bush-1': 'bush', 'bush-2': 'bush', 'fence': 'fence segment (tiles in x)', 'mailbox': 'mailbox',
    'window-dark': 'window decal (unlit)', 'window-lit': 'window decal (lit)', 'window-curtained': 'window decal (curtained)',
    'desk-lamp': 'desk lamp (interior)', 'desk': 'desk (interior)', 'chair': 'chair (interior)', 'books': 'books (interior)',
    'chalkboard': 'chalkboard (interior/classroom)', 'chalk-tick': 'chalkboard tick overlay',
    'chalk-cross': 'chalkboard cross overlay', 'round-table': 'round table (debate)', 'scroll': 'scroll', 'map': 'map',
    'telescope': 'telescope', 'van': 'trip vehicle (van)', 'van-luggage': 'trip vehicle (van with luggage)',
    'van-cone': 'van headlight cone (long)', 'road-tile': 'road tile (trip road)',
}
INTERIOR_PROPS = {'sofa', 'sofa-small', 'bookshelf', 'shelf-table', 'desk-lamp', 'desk', 'chair', 'books', 'chalkboard',
                  'chalk-tick', 'chalk-cross', 'scroll', 'map', 'telescope', 'stool'}
for key in sorted(P, key=lambda k: list(P).index(k)):
    name = key.split('/')[1][:-4]
    p = P[key]
    fr = None
    if 'frame' in p and name not in ('fence', 'road-tile'):
        fr = (p['frame'][0], p['frame'][1], p.get('fps'))
    grp = 'vehicle' if name.startswith('van') or name == 'road-tile' else 'prop'
    depth = ('vehicle' if grp == 'vehicle' else 'interior-props' if name in INTERIOR_PROPS else
             'ground-tiles' if name in ('fence', 'road-tile') else 'fx-light' if name == 'lamp-halo' else
             'props-front' if name.startswith(('tuft', 'flower', 'bush')) else 'props-back')
    anch = p.get('anchor')
    kind = None
    if name in ('fence', 'road-tile'):
        kind = 'tile'
    vs = None
    if name == 'lamp-post':
        vs = {'lit': C('props/lamp-post-lit.png')}
    if name == 'van':
        vs = {'luggage': C('props/van-luggage.png')}
    if name == 'lamp-post-lit' or name == 'van-luggage':
        continue  # folded into variants of the base entry
    extra = {}
    if name in ('window-dark', 'window-lit', 'window-curtained'):
        anch = None
    if name == 'road-tile':
        extra['tileX'] = True
        extra['roadTopY'] = 4
    if name == 'fence':
        extra['tileX'] = True
    if name == 'van':
        extra['frontX'] = 51
    notes = p.get('note') or ''
    if name == 'lamp-post':
        notes = 'lit/unlit twins, identical size/anchor. Add prop.lamp-halo at the lamp head when lit.'
    if name == 'van':
        notes = (p.get('note') or '') + ' wheels on y=39, front at x=51, headlight cone x52..63. van-luggage is the packed variant. ' \
                'Only one van exists; no second colourway (see gaps).'
    if name in ('flower', 'flower-1'):
        notes = (notes + ' ' if notes else '') + ('flower.png is a duplicate sprite of flower-1; use flower-1..3.' if name == 'flower' else '')
    if name == 'chalkboard':
        notes = 'empty 48x32 frame; tick/cross overlays fit slate inner area x4..43,y4..27.'
    add(('vehicle.' if grp == 'vehicle' else 'prop.') + name, grp, PROP_NEED.get(name, name), C(key),
        kind=kind, frame=fr, anchor=anch, variants=vs, depth=depth, license=map_lic(p['license']),
        source=p['source'], notes=notes.strip(), **extra)

# ================================================================== FX
FXP = PROV['fx']
fx_need = {
    'campfire': 'campfire (fire + base, 6 frames)', 'campfire-fire': 'campfire flame only (6 frames, composable)',
    'campfire-base': 'campfire log ring only', 'campfire-light': 'campfire light pool (additive/alpha)',
    'campfire-sparks': 'campfire sparks (3 frames)', 'chimney-smoke': 'chimney smoke (8 frames)',
}
for key, p in FXP.items():
    name = key.split('/')[1][:-4]
    fr = (p['frame'][0], p['frame'][1], p.get('fps')) if 'frame' in p else None
    if name.startswith('star-'):
        need = f'twinkling star sprite {name[-1]} (3 frames)'
    else:
        need = fx_need[name]
    add('fx.' + name, 'fx', need, C(key), frame=fr, anchor=p.get('anchor'), depth='fx-light' if 'light' in name else 'fx',
        license=map_lic(p['license']), source=p['source'], notes=p.get('note', ''))

# ================================================================== UI
U = PROV['ui']
ui_need = {
    'bubble-wall': 'speech bubble (wall palette) 9-slice', 'bubble-moon': 'speech bubble (moon palette) 9-slice',
    'bubble-wall-tail-left': 'wall bubble tail (left)', 'bubble-wall-tail-right': 'wall bubble tail (right)',
    'bubble-moon-tail-left': 'moon bubble tail (left)', 'bubble-moon-tail-right': 'moon bubble tail (right)',
    'thought-wall-dots': 'thought bubble trail dots (wall)', 'thought-moon-dots': 'thought bubble trail dots (moon)',
    'withheld-bar': 'withheld/redaction black bar 9-slice', 'envelope': 'envelope', 'envelope-pop': 'envelope pop-in (4 frames)',
    'padlock': 'padlock (locked)', 'padlock-open': 'padlock (open)', 'door-ring': 'door pulse ring (3 sizes)',
    'door-ring-ok': 'door ring (ok colour)', 'check': 'check mark', 'marker-alert': 'alert marker (!) above heads',
    'marker-question': 'question marker (?) above heads', 'lantern-council': 'council lantern (3-frame flicker)',
    'lantern-dissent': 'dissent lantern (3-frame flicker)', 'lantern-street': 'street lantern (3-frame flicker)',
    'zzz': 'sleeping zzz (3 frames)', 'notes': 'music/notes particles (2 frames)', 'notice-board': 'notice board (unlit)',
    'notice-board-lit': 'notice board (lit)', 'card-shared': 'card state: shared', 'card-hidden': 'card state: hidden',
    'card-blocked': 'card state: blocked', 'card-pinned': 'card state: pinned', 'trip-door': 'trip door (closed/open)',
    'emote-alert': 'emote: alert', 'emote-question': 'emote: question', 'emote-heart': 'emote: heart',
    'emote-zzz': 'emote: zzz', 'emote-dots': 'emote: typing dots', 'emote-smile': 'emote: smile',
}
for key, p in U.items():
    name = key.split('/')[1][:-4]
    fr = (p['frame'][0], p['frame'][1], p.get('fps')) if 'frame' in p else None
    if name == 'notes':  # provenance says 9x8; the PNG is 17x9 = two 8x9 frames with a 1px gap
        fr = (8, 9, p.get('fps'), 1)
    kind = 'nineslice' if 'nineslice' in p else None
    extra = {}
    notes = p.get('note', '') or ''
    if 'nineslice' in p:
        ns = p['nineslice']
        extra['nineslice'] = {'corner': ns['corner'], 'borders': [ns['corner']] * 4}
        notes = (notes + ' ' if notes else '') + f'this.add.nineslice(x,y,key,undefined,w,h,{ns["corner"]},{ns["corner"]},{ns["corner"]},{ns["corner"]}) (Phaser >= 3.60)'
    if 'slots' in p:
        extra['slots'] = p['slots']  # own composed art, untrimmed
    if name.startswith('emote-'):
        extra['coarse16'] = True
        notes = 'native 16px from Ninja Adventure, 2x coarser than scene art: use ONLY above characters at the same 1x scale (do not enlarge). ' + notes
    anch = p.get('anchor')
    if name == 'padlock' or name == 'padlock-open':
        anch = 'bottom-center'
    grp = 'ui'
    add('ui.' + name, grp, ui_need[name], C(key), kind=kind, frame=fr, anchor=anch,
        depth='ui-world', license=map_lic(p['license']), source=p['source'], notes=notes.strip(), **extra)

# ================================================================== FONTS
FONTS = [
    ('font.jersey-10', 'pixel display font (headings, in-world text)', 'assets/fonts/jersey-10/Jersey10-Regular.ttf', 'jersey-10',
     'family "Jersey 10"; art pixel em 9.3333, sizes 18.667/28/37.333/56 px (typography.md). Also latin/latin-ext woff2.'),
    ('font.silkscreen', 'pixel micro font (labels, caps only)', 'assets/fonts/silkscreen/Silkscreen-Regular.ttf', 'silkscreen',
     'family "Silkscreen"; sizes 8/16/24 px; caps only.'),
    ('font.inter', 'DOM UI font (panels, body text outside the canvas)', 'assets/fonts/inter/InterVariable.ttf', 'inter',
     'family "Inter Variable", weight axis 100..900. Latin + latin-ext woff2 present.'),
]
for fid, need, f, d, note in FONTS:
    ASSETS.append({'id': fid, 'group': 'font', 'need': need, 'file': f, 'kind': 'font', 'size': None, 'depthHint': 'ui-screen',
                   'license': fontlic(d), 'source': f'assets/fonts/{d}/ (Google Fonts upstream); license file assets/fonts/{d}/OFL.txt',
                   'notes': note + ' Load via CSS @font-face and await document.fonts.load() before creating text.'})
    if not os.path.exists(os.path.join(REPO, f)):
        VERIFY['missing_files'].append(f)

# ================================================================== SCALE / LAYERS / WARNINGS
SCALE = {'nativeTile': 16, 'charCell': 32, 'zoomDesktop': 3, 'zoomPhone': 2}
VIEWPORT = {'desktopNative': [427, 240], 'phoneNative': '195 x (screenHeightPx / 2)', 'worldHeight': 270, 'groundLineY': 240,
            'note': 'All art is placed at 1x in a native-resolution canvas; CSS/canvas upscales by integer zoom (3 desktop, 2 phone). '
                    'Camera scrollY = 30 so the view spans world y 30..270 and the ground band sits at the bottom of the screen.'}
LAYERS = [
    {'z': 0, 'name': 'sky', 'asset': 'parallax.0_sky', 'scrollFactor': 0, 'y': 'tileSprite, origin (0,0), y=0, height 270', 'notes': 'stretch 16px column across width'},
    {'z': 1, 'name': 'stars', 'asset': 'parallax.1_stars', 'scrollFactor': 0.02, 'y': 'origin (0,1) at y=270', 'notes': 'twinkle overlay'},
    {'z': 2, 'name': 'moon', 'asset': 'parallax.2_moon', 'scrollFactor': 0.02, 'y': 'origin (0.5,0.5) at screen (86,56)', 'notes': ''},
    {'z': 3, 'name': 'clouds-far', 'asset': 'parallax.3_clouds_far', 'scrollFactor': 0.1, 'y': 'origin (0,1) at y=270', 'notes': 'drift +x'},
    {'z': 4, 'name': 'clouds-near', 'asset': 'parallax.4_clouds_near', 'scrollFactor': 0.2, 'y': 'origin (0,1) at y=270', 'notes': 'drift +x'},
    {'z': 5, 'name': 'hills-far', 'asset': 'parallax.5_hills_far', 'scrollFactor': 0.3, 'y': 'origin (0,1) at y=270', 'notes': ''},
    {'z': 6, 'name': 'hills-mid', 'asset': 'parallax.6_hills_mid', 'scrollFactor': 0.45, 'y': 'origin (0,1) at y=270', 'notes': ''},
    {'z': 7, 'name': 'hills-near', 'asset': 'parallax.7_hills_near', 'scrollFactor': 0.6, 'y': 'origin (0,1) at y=270', 'notes': ''},
    {'z': 8, 'name': 'fence', 'asset': 'parallax.8_fenceline', 'scrollFactor': 0.9, 'y': 'origin (0,1) at y=270; posts stand on y=240', 'notes': ''},
    {'z': 9, 'name': 'ground', 'asset': 'parallax.9_ground', 'scrollFactor': 1.0, 'y': 'origin (0,0) at y=240', 'notes': '480x30'},
    {'z': 10, 'name': 'props-back', 'asset': 'prop.* (trees, lamps, signposts)', 'scrollFactor': 1.0, 'y': 'origin (0.5,1) at y=240 (+/- up to 6 px depth jitter)', 'notes': 'behind buildings'},
    {'z': 20, 'name': 'buildings', 'asset': 'house.*, landmark.*', 'scrollFactor': 1.0, 'y': 'origin = originFrac at y=240', 'notes': 'ground contact on the ground line'},
    {'z': 25, 'name': 'fx', 'asset': 'fx.chimney-smoke, fx.campfire*', 'scrollFactor': 1.0, 'y': 'per anchor', 'notes': 'smoke above buildings'},
    {'z': 30, 'name': 'actors', 'asset': 'atlas.characters / persona.*', 'scrollFactor': 1.0, 'y': 'origin (0.5,1) at y=240; sort by y between 236..244', 'notes': ''},
    {'z': 40, 'name': 'props-front', 'asset': 'prop.tuft/flower/bush', 'scrollFactor': 1.0, 'y': 'origin (0.5,1) at y=240..246', 'notes': 'overlap actor feet'},
    {'z': 45, 'name': 'fx-light', 'asset': 'fx.campfire-light, prop.lamp-halo', 'scrollFactor': 1.0, 'y': 'centred on ground contact', 'notes': 'blendMode ADD'},
    {'z': 50, 'name': 'foreground', 'asset': 'parallax.10_foreground', 'scrollFactor': 1.2, 'y': 'origin (0,1) at y=270', 'notes': 'content only in bottom ~25px'},
    {'z': 60, 'name': 'ui-world', 'asset': 'ui.* (bubbles, markers, emotes, rings)', 'scrollFactor': 1.0, 'y': 'above actor head', 'notes': ''},
    {'z': 100, 'name': 'ui-screen', 'asset': 'DOM / fonts', 'scrollFactor': 0, 'y': '-', 'notes': 'HUD, dock'},
]
DEPTH = {l['name']: l['z'] for l in LAYERS}
DEPTH.update({'sky': 0, 'clouds-far': 3, 'clouds-near': 4, 'hills': 6, 'ground-tiles': 9, 'vehicle': 32, 'interior': 0, 'interior-props': 10})

# ================================================================== VERIFICATION
from palette import RGB  # read-only import of the master palette
OKRGB = set(RGB.values())
for g, d in PROV.items():
    for key, p in d.items():
        if g in ('characters', 'backgrounds'):
            break
        rel = C(key if g != 'buildings' else f'buildings/{key}')
        w, h = dims(rel)
        if 'size' in p and list(p['size']) != [w, h]:
            VERIFY['mismatches'].append(f'{rel}: provenance size {p["size"]} != PNG {[w, h]}')
        if 'frame' in p and key == 'ui/notes.png':
            VERIFY['mismatches'].append(f'{rel}: provenance frame {p["frame"]} x{p["count"]} is wrong for a {w}x{h} PNG; real layout is 2 frames of 8x9 separated by a 1px gap (manifest uses frame 8x9, spacing 1)')
        elif 'frame' in p:
            fw, fh = p['frame']
            if w % fw or h % fh:
                VERIFY['mismatches'].append(f'{rel}: frame {p["frame"]} does not divide PNG {w}x{h}')
            elif 'count' in p and p['count'] != (w // fw) * (h // fh):
                VERIFY['mismatches'].append(f'{rel}: provenance count {p["count"]} != computed {(w // fw) * (h // fh)}')
        if 'frame_size' in p:
            fw, fh = p['frame_size']
            if w // fw != p.get('frames'):
                VERIFY['mismatches'].append(f'{rel}: provenance frames {p.get("frames")} != computed {w // fw}')
        if 'anchor' in p and isinstance(p['anchor'], list):
            ax, ay = p['anchor']
            if not (0 <= ax < w and 0 <= ay < h):
                VERIFY['mismatches'].append(f'{rel}: anchor {p["anchor"]} is outside {w}x{h}')
            elif g == 'buildings' and ay != h - 1 and 'windmill' not in key and 'interiors' not in key:
                VERIFY['mismatches'].append(f'{rel}: anchor y {ay} is not the bottom row ({h - 1})')
for lid, lay in BG['layers'].items():
    w, h = dims(C(f'backgrounds/{lay["file"]}'))
    if list(lay['size']) != [w, h]:
        VERIFY['mismatches'].append(f'backgrounds/{lay["file"]}: provenance size {lay["size"]} != PNG {[w, h]}')
CH_CAST = CH.get('council_cast_animations', {})
for pid in CH['characters']:
    for a, spec in ({**ANIMS, **CH_CAST} if pid.startswith('cast-') else ANIMS).items():
        w, h = dims(C(f'characters/{pid}/{a}.png'))
        if (w, h) != (32 * spec['frames'], 32):
            VERIFY['mismatches'].append(f'characters/{pid}/{a}.png: {w}x{h} but expected {32 * spec["frames"]}x32 ({spec["frames"]} frames)')
    if dims(C(f'characters/{pid}/portrait.png')) != (32, 32):
        VERIFY['mismatches'].append(f'characters/{pid}/portrait.png is not 32x32')
aw, ah = dims(C('characters/atlas.png'))
if [aw, ah] != [ATLAS['meta']['size']['w'], ATLAS['meta']['size']['h']]:
    VERIFY['mismatches'].append(f'atlas.png {aw}x{ah} != atlas.json meta size {ATLAS["meta"]["size"]}')
for k, f in ATLAS['frames'].items():
    r = f['frame']
    if r['x'] + r['w'] > aw or r['y'] + r['h'] > ah or (r['w'], r['h']) != (32, 32):
        VERIFY['mismatches'].append(f'atlas frame {k} out of bounds or not 32x32: {r}')
n_anim_frames = sum(len(v['frames']) for pa in ATLAS['animations'].values() for v in pa.values())
VERIFY['notes'].append(f'atlas.json: {len(ATLAS["frames"])} frames = 11 personas x (12 animation frames + 1 portrait); '
                       f'{n_anim_frames} animation frame refs, all inside the {aw}x{ah} atlas.')
# palette check over every composed PNG used by an asset
seen = set()


def all_files(a):
    out = [a['file']]
    for v in (a.get('variants') or {}).values():
        if isinstance(v, str):
            out.append(v)
    return out


for a in ASSETS:
    if a['kind'] == 'font':
        continue
    for f in all_files(a):
        if f in seen or not os.path.exists(os.path.join(REPO, f)):
            continue
        seen.add(f)
        im = Image.open(os.path.join(REPO, f)).convert('RGBA')
        cols = im.getcolors(1 << 20) or []
        off = {c for _, c in cols if c[3] == 255 and c[:3] not in OKRGB}
        semi = sum(k for k, c in cols if 0 < c[3] < 255)
        if off or semi:
            VERIFY['off_palette'].append(f'{f}: {len(off)} off-palette colours, {semi} semi-transparent px')
VERIFY['notes'].append(f'palette check ran on {len(seen)} distinct PNGs referenced by the manifest.')
for i in sorted(set(a['id'] for a in ASSETS)):
    pass
ids = [a['id'] for a in ASSETS]
dup = sorted({i for i in ids if ids.count(i) > 1})
if dup:
    VERIFY['mismatches'].append('duplicate ids: ' + ', '.join(dup))
# cross-check duplicates between lamp post / padlock families
VERIFY['notes'].append('Two lamp posts exist: props/lamp-post(.lit) 24x64 and buildings/props/lamp_post_lit 23x95 (different heights, '
                       'different folders); manifest keeps both with distinct ids.')
VERIFY['notes'].append('props/flower.png duplicates props/flower-1.png (same 5x7 size).')
_nb = [f for f in glob.glob(os.path.join(COMP, 'buildings', '*', '*.png')) if Image.open(f).convert('RGBA').getbbox() != (0, 0) + Image.open(f).size]
VERIFY['notes'].append(f'{len(_nb)} building PNGs have transparent padding (bbox != full canvas): ' + (', '.join(os.path.basename(f) for f in _nb) or 'none'))
VERIFY['notes'].append('Building provenance doors/windows/sign_slot/chimney_x/seats/chair/glints/slit/chalkboard rects are pre-trim '
                       'canvas coordinates; every building sprite PNG (sails strip excepted, see previous note) now has bbox == full canvas so '
                       'they CANNOT be mapped back without the original trim offsets. Treated as stale and not published.')
VERIFY['notes'].append('Windmill hub [21,25] checked by eye on windmill_lit.png: it lands on the wooden roof beam/hub block, so it is '
                       'published (windmill meta is not part of the stale set).')
VERIFY['notes'].append('Interior anchors (floor_y 112, seats, desks) are in an untrimmed 224x128 canvas and are published as-is; '
                       'only size was cross-checked, positions were not visually verified.')

# ================================================================== SIZE WARNINGS
def H(i):
    return next(a for a in ASSETS if a['id'] == i)['size'][1]


houses_by_h = sorted([(H(f'house.{k}'), k) for k in HOUSES], reverse=True)
SIZE_WARN = [
    f'Character is 32px cell (~28px figure). Tenement is {H("house.tenement")}px tall = {H("house.tenement")/28:.1f}x a person. '
    'Use it only as a backdrop/dormitory landmark (e.g. beyond the fence, x-parallax 0.9) and never in the street row.',
    'A person is about door height in Autumn Town scale. Heights by chapter shape: ' + ', '.join(f'{k} {h}px' for h, k in houses_by_h) +
    '. Only the hut (%dpx) meets the <=135px foreground recommendation; cottage (%dpx) is borderline-large, brick (%dpx), shop (%dpx) and tenement (%dpx) are mid-ground/landmark only.' % (
        H('house.hut'), H('house.cottage'), H('house.brick'), H('house.shop'), H('house.tenement')),
    'Landmark heights: ' + ', '.join(f'{a["id"].split(".")[1]} {a["size"][1]}px' for a in ASSETS if a['group'] == 'landmark' and a['id'].count('.') == 1 and a['id'] not in ('landmark.padlock-8x8',)) +
    '. exam-oracle (%dpx) and debate-stage (%dpx) are intentionally tall; flag if the street row feels crowded.' % (H('landmark.exam-oracle'), H('landmark.debate-stage')),
    f'Windmill is {H("landmark.windmill")}px tall and only 42px wide: reads as a small silhouette; keep as backdrop landmark (hub-anchored sails 72x72 overhang the roof; check parallax clipping).',
    'Trees: heights 50-74px; mid-scale dark trees are fine in props-back; they are shorter than the cottage/brick/shop houses.',
    'Emotes (ui.emote-*) are native 16px Ninja Adventure art (2x coarser than 1x scene art) - keep at their native scale above heads; do not scale up.',
    'Lamp posts: props 64px vs tall boulevard lamp 95px; the 95px one is taller than a hut door.',
]

# ================================================================== PACKS NOT CHOSEN
PACKS = [
    ('assets/pixel/buildings/windmill-128px-vector-style.png', 'windmill-128px (OGA, CC0)', 'NOT chosen: 128x128 vector-style isometric windmill; wrong projection and 2-3x too large for the 28px-person scale. Replaced by hand-pixeled landmark.windmill (42x84 side-view) + sails strip.'),
    ('assets/pixel/buildings/village-buildings-oga', 'village-buildings-oga (CC0)', 'NOT chosen: 64px sprites in a different pixel scale/perspective; outlines do not match; would read as a mashup next to Autumn Town. Only the Autumn Town cut-outs are used.'),
    ('assets/pixel/buildings/kenney-tiny-town', 'Kenney Tiny Town (CC0)', 'NOT chosen: 16px tiles are 2x coarser than the 32px character scale.'),
    ('assets/pixel/buildings/autumn-town', 'Autumn Town buildings/props (Nirva)', 'USED as the source for houses, debate stage and Autumn-derived props (night re-graded into the Squad palette); raw day art is never loaded.'),
    ('assets/pixel/characters/ninja-adventure-npcs-16px', 'Ninja Adventure NPCs 16px', 'NOT chosen: 16px sprites must not mix with scene art. Cast was redrawn at 32px (originals). Only requantized emotes are reused.'),
    ('assets/pixel/characters/autumn-town-npcs-32px', 'Autumn Town NPCs 32px', 'Style/proportion reference only; no pixels copied (cast was redrawn to palette with the required poses).'),
    ('assets/pixel/characters/autumn-town-player-day-night-32px', 'Autumn Town player sheets', 'Style/proportion reference only.'),
    ('assets/pixel/characters/kenney-roguelike-characters', 'Kenney Roguelike characters', 'NOT chosen: 16px scale and different outline style.'),
    ('assets/pixel/characters/kenney-pixel-platformer-chars', 'Kenney Pixel Platformer chars', 'NOT chosen: different scale/style.'),
    ('assets/pixel/characters/gothicvania-hero', 'Gothicvania hero', 'NOT chosen: action-game hero, different proportions, no talk/sit poses.'),
    ('assets/pixel/characters/oga-pixel-platformer-chars', 'OGA pixel platformer chars', 'NOT chosen: different scale/style.'),
    ('assets/pixel/backgrounds/generated-village', 'generated-village (earlier in-house parallax, 320x180)', 'SUPERSEDED by composed/backgrounds (480x270, palette-locked, ground line y=240).'),
    ('assets/pixel/backgrounds/gothicvania-night-town', 'Gothicvania night town', 'NOT chosen: gothic palette/scale; would break the cerulean night look.'),
    ('assets/pixel/backgrounds/hills-scenery-day', 'hills-scenery-day (OGA)', 'NOT chosen: day palette; hills re-drawn procedurally in palette.'),
    ('assets/pixel/backgrounds/pixel-clouds-oga', 'pixel-clouds-oga', 'NOT chosen: no outlined puffy style; new outlined clouds were drawn.'),
    ('assets/pixel/backgrounds/fence-lamp-oga', 'fence-lamp-oga', 'NOT chosen: different style; own fence and lamp-post drawn.'),
    ('assets/pixel/backgrounds/autumn-town-day-night', 'Autumn Town day/night backgrounds', 'NOT chosen: fixed scene illustrations, not parallax-friendly; used as palette reference only.'),
    ('assets/pixel/backgrounds/kenney-pixel-platformer-bg', 'Kenney platformer bg', 'NOT chosen: day/cartoon palette.'),
    ('assets/pixel/fx/chimney_smoke.png', 'chimney_smoke.png (OGA, CC0)', 'NOT chosen: dithered noise cone; clashes with outlined clouds. Replaced by fx.chimney-smoke.'),
    ('assets/pixel/fx/campfire-sprite-sheet.png', 'campfire-sprite-sheet (OGA, CC0)', 'NOT chosen: 4 frames 32x32 non-palette; used as reference for the hand-pixeled fx.campfire.'),
    ('assets/pixel/fx/ninja-adventure', 'Ninja Adventure FX', 'NOT chosen: 16px scale.'),
    ('assets/pixel/ui/ninja-adventure', 'Ninja Adventure UI', 'Only 6 emotes (Emote/emote11,20,21,23,27,28) requantized and reused as ui.emote-*; dialog/theme art not used.'),
    ('assets/pixel/ui/kenney-pixel-ui-pack', 'Kenney Pixel UI', 'NOT chosen: UI is DOM/Inter; in-world bubbles are original 9-slice.'),
    ('assets/pixel/ui/kenney-ui-pixel-adventure', 'Kenney UI Pixel Adventure', 'NOT chosen: see above.'),
    ('assets/pixel/ui/kenney-emotes-pixel', 'Kenney emotes pixel', 'NOT chosen: different style than the chosen Ninja emotes.'),
    ('assets/pixel/ui/speech-emote-balloons-oga', 'OGA speech/emote balloons', 'NOT chosen: own 9-slice bubbles drawn in palette.'),
    ('assets/pixel/interiors/ninja-adventure-interior', 'Ninja Adventure interiors 16px', 'NOT chosen: 16px scale; interiors redrawn at 224x128.'),
    ('assets/pixel/monsters', 'monsters (all packs)', 'Out of scope for the village (no monster need).'),
    ('assets/pixel/items', 'items (Ninja/Kenney)', 'NOT chosen: 16px scale; props redrawn.'),
    ('assets/fluent-objects', 'Fluent objects + Lucide icons', 'DOM-side only (3D/flat icons, hero art, lottie); not part of the pixel scene. Lucide icons (assets/fluent-objects/icons, 38 SVGs) are the candidate mobile dock icons - see gaps.'),
    ('assets/fluent-characters', 'Fluent characters', 'DOM-side only; not used in the pixel scene.'),
]
PACK_ROWS = [{'path': p, 'name': n, 'exists': os.path.exists(os.path.join(REPO, p)), 'decision': d} for p, n, d in PACKS]
for r in PACK_ROWS:
    if not r['exists']:
        VERIFY['notes'].append(f'pack path listed but not present on disk: {r["path"]}')

# ================================================================== GAPS
GAPS = [
    ('NPC extras: cat, birds, fireflies', 'No ambient-creature sprites exist in composed/ (ninja-adventure-animal 16px is the wrong scale).',
     'Hand-pixel a 3-4 frame cat (sit/walk) at ~14px tall, a 2-frame bird for the fence line, and use a 3x3 glow-core dot sprite as firefly particles (Phaser emitter, ADD blend).'),
    ('Lit-window flicker frames', 'Windows are baked into lit/dark house PNGs; no per-window frames exist.',
     'Engine-side: overlay prop.window-lit decals with an alpha tween (0.85..1, random 600-1800 ms); meta window rects are stale, so re-measure first.'),
    ('Rain / snow', 'No weather particles.', 'Phaser particle emitter with a 1x2 / 2x2 px white sprite drawn at runtime (palette cloud-hi); no art needed beyond that.'),
    ('Second van / colourway', 'Only van and van-luggage exist.', 'Palette-remap the van (roof-wine -> hill-far) with a new variant script; bus-stop sign optional.'),
    ('Feynman freshman sitting on the porch', 'freshman has a generic sit pose but landmark.feynman-porch has no seat anchor (provenance has only a stale sign_slot).',
     'Measure a seat point on the trimmed feynman_porch.png and place persona.freshman sit frames there; optionally add a porch-specific sit pose.'),
    ('Dissenter bubble variants', 'Only wall and moon bubble palettes exist.', 'Add a third bubble (alert-tinted outline) and matching tails for dissent speech; reuse the 9-slice recipe in props_ui.py.'),
    ('Mobile dock icons', 'No pixel dock icons. Lucide SVGs exist in assets/fluent-objects/icons (38, e.g. users, vote, lock, bus, mail).',
     'Use Lucide SVGs in the DOM dock (phone) and tint to palette; optionally hand-pixel 16x16 versions for in-canvas use.'),
    ('Day variants of buildings', 'Not produced.', 'Not needed: tint/multiply in engine, or swap the sky variant only.'),
    ('Interiors for debate stage, rubric courthouse, exam oracle, devil\'s TA cave', 'Only 4 interiors exist: study, classroom, council, oral exam.',
     'Reuse interior.council for the courthouse and debate stage (stage props overlay), interior.oral-exam for the oracle; draw a dark cave interior (stalactite silhouette, glints) as a new 224x128 sheet.'),
    ('Per-persona 4-frame idle', 'Idle is 2 frames at 2 fps for every persona.', 'Acceptable for now; extend idle to 4 frames in make_characters.py if breathing needs more life.'),
    ('Wind-blown grass / tree sway', 'Static tufts and trees.', 'Engine-side vertical-shear tween on prop.tuft-*; no new art needed.'),
    ('Building door / sign / chimney anchors', 'Provenance meta is pre-trim and stale (flagged meta_coords_stale).',
     'Re-run the building generators to export post-trim coordinates (door rect, chimney top, sign slot, seats) into provenance.json; until then do eyeball placement from PNG.'),
    ('Left-facing and back-facing character frames', 'Art faces right only; no back or front views.', 'flipX for left; add front/back idle only if a scene needs it.'),
    ('Sit anchors', 'persona sit frames exist but bench/stool/stump have no seat anchors in provenance.', 'Use anchor bottom-centre of the prop plus a y offset of -4 px for the person and tune per prop.'),
    ('Unlit twin for the tall lamp post', 'buildings/props/lamp_post_lit.png has no unlit version.', 'Palette-remap lit -> unlit or use prop.lamp-post.'),
    ('Fonts in canvas', 'Silkscreen/Jersey are TTF only for canvas text.', 'Use CSS @font-face and Phaser text, or hand-pixel a bitmap font if crispness at 3x becomes a problem.'),
]

# ================================================================== PHASER SNIPPETS
GROUP_ORDER = ['parallax', 'building', 'landmark', 'interior', 'persona', 'npc', 'prop', 'vehicle', 'fx', 'ui', 'font']


def load_calls(a):
    k = a['id']
    if a['kind'] == 'font':
        return []
    if a['id'].startswith('persona.'):
        return []
    f = a['file']
    out = []
    if a['kind'] == 'atlas':
        out.append(f"this.load.atlas('{k}', '{f}', '{a['atlasJson']}');")
        return out
    if a['kind'] == 'spritesheet':
        fr = a['frame']
        sp = f", spacing: {fr['spacing']}" if fr.get('spacing') else ''
        out.append(f"this.load.spritesheet('{k}', '{f}', {{ frameWidth: {fr['w']}, frameHeight: {fr['h']}{sp} }});")
    else:
        out.append(f"this.load.image('{k}', '{f}');")
    if a.get('loadVariants', True):
        for vn, vf in (a.get('variants') or {}).items():
            if vf == f:
                continue  # primary file already loaded under the bare id
            out.append(f"this.load.image('{k}:{vn}', '{vf}');")
    return out


PRELOAD = {}
for g in GROUP_ORDER:
    calls = []
    for a in ASSETS:
        if a['group'] == g:
            calls += load_calls(a)
    if g == 'persona':
        calls = [c for c in calls]
    PRELOAD[g] = calls
PRELOAD['persona'] = [load_calls(next(a for a in ASSETS if a['id'] == 'atlas.characters'))[0]]

# frames for variants that are spritesheets (door ring etc. have no variants) -> note only
ANIM_SNIPPET = """// after preload: register every animation from the atlas JSON
const atlas = this.cache.json.get('characters-anims'); // this.load.json('characters-anims', '<atlas.json>')
for (const [persona, anims] of Object.entries(atlas.animations)) {
  for (const [name, a] of Object.entries(anims)) {
    this.anims.create({ key: `${persona}:${name}`, frames: a.frames.map(f => ({ key: 'atlas.characters', frame: f })),
                        frameRate: a.frameRate, repeat: a.repeat });
  }
}
// sprites: this.add.sprite(x, 240, 'atlas.characters', 'student/idle/0').setOrigin(0.5, 1); sprite.play('student:walk');"""

SPRITESHEET_ANIMS = [
    (a['id'], a['frame']) for a in ASSETS if a['kind'] == 'spritesheet' and a.get('frame', {}).get('fps')
]

HINTS = {
    'scale': 'All art at 1x. Game config: type AUTO, pixelArt true (roundPixels true), width 427 height 240 on desktop (zoom 3) and 195 x floor(h/2) on phone (zoom 2). Never scale sprites by non-integer factors.',
    'origin': 'originFrac is anchor/size; bottom-row anchors map to fy=1. Prefer sprite.setOrigin(...originFrac) and position at the ground contact (x, 240).',
    'atlasFacing': 'Characters face right; set flipX for left. Walk speed = 24 px/s at 8 fps (3 px per frame).',
    'parallax': 'For layers with scrollFactor<1 use this.add.tileSprite(0, 270, viewW, 270, key).setOrigin(0,1).setScrollFactor(0) and update tilePositionX = cam.scrollX * factor in update(); for factor 1 use plain images/tileSprite scrollFactor 1.',
    'nineslice': 'Phaser >= 3.60: this.add.nineslice(x, y, key, undefined, w, h, 5, 5, 5, 5) for bubbles (corner 5); corner 2 for withheld-bar.',
    'variants': "Variant textures are loaded as '<id>:<variant>' (e.g. 'house.hut:dark'); swap with sprite.setTexture().",
    'animations': 'Spritesheet animations: this.anims.create({ key: id, frames: this.anims.generateFrameNumbers(id), frameRate: fps, repeat: -1 }). fps values are in the manifest `frame.fps`.',
    'blend': 'Light pools (fx.campfire-light, prop.lamp-halo) use blendMode ADD (or ordinary alpha 0.6); they contain no alpha ramp, only stepped dithered bands.',
}

# ================================================================== EMIT JSON
for a in ASSETS:
    d = a.get('depthHint')
    a['depthZ'] = DEPTH.get(d) if d else None
out = {
    'version': 1,
    'generator': 'assets/pixel/composed/scripts/build_manifest.py',
    'palette': PAL,
    'scale': SCALE,
    'viewport': VIEWPORT,
    'licenses': {'ORIG': L_ORIG, 'ORIG*': L_STYLE, 'AT': L_AT, 'CC0-NA': L_NINJA},
    'assets': ASSETS,
    'layers': LAYERS,
    'sizeWarnings': SIZE_WARN,
    'packsNotChosen': PACK_ROWS,
    'gaps': [{'need': n, 'why': w, 'suggested approach': s} for n, w, s in GAPS],
    'phaserLoadHints': {'notes': HINTS, 'preload': PRELOAD, 'animationSnippet': ANIM_SNIPPET},
    'verification': {'mismatches': VERIFY['mismatches'], 'missingFiles': VERIFY['missing_files'],
                     'offPalette': VERIFY['off_palette'], 'notes': VERIFY['notes'],
                     'assetCount': len(ASSETS)},
}
with open(os.path.join(REPO, 'assets/asset-manifest.json'), 'w') as f:
    json.dump(out, f, indent=1, sort_keys=False)
    f.write('\n')

# ================================================================== EMIT MD
def code(a):
    return LIC_CODE.get(a.get('license'), 'ORIG' if 'font' not in a['id'] else 'OFL')


def row_size(a):
    return 'n/a' if not a['size'] else f"{a['size'][0]}x{a['size'][1]}"


def row_frame(a):
    fr = a.get('frame')
    if not fr:
        return '-'
    s = f"{fr['w']}x{fr['h']} x{fr['count']}"
    if 'fps' in fr:
        s += f" @{fr['fps']}fps"
    return s


def row_anchor(a):
    if 'anchor' not in a:
        return '-'
    return f"[{a['anchor'][0]},{a['anchor'][1]}] / {a['originFrac'][0]},{a['originFrac'][1]}"


def short(f):
    return '`' + f.replace(COMP_REL + '/', '~/') + '`'


def variants_cell(a):
    v = a.get('variants')
    if not v:
        return '-'
    if a['id'].startswith('persona.'):
        return 'walk idle talk sit wave portrait'
    return ', '.join(f"{k}: {short(x)}" for k, x in v.items() if isinstance(x, str))


md = []
w = md.append
w('# Asset manifest\n')
w('Generated by `assets/pixel/composed/scripts/build_manifest.py` into `assets/asset-manifest.json` (machine-readable, source of truth) and this file. '
  'Do not edit by hand: re-run the script after any art change. Sizes, frame counts and frame sizes were **computed from the PNGs with PIL**, not copied from provenance.\n')
w(f'`~/` in file cells means `{COMP_REL}/`. Anchor cell = `[x,y] px from top-left / originFrac [fx,fy]` for `setOrigin`. '
  'License codes: **ORIG** = original, CC0-dedicated by Squad; **ORIG\\*** = original, CC0-dedicated by Squad, style reference Autumn Town (free to use); '
  '**AT** = Autumn Town (Nirva), "free to use/edit in any commercial or personal project without crediting me" (creator statement, not a formal CC license); '
  '**CC0-NA** = CC0 1.0 Ninja Adventure (requantized); **OFL** = SIL OFL 1.1.\n')
w(f'Total assets: **{len(ASSETS)}**.\n')
w('## Scale and viewport\n')
w('| | |\n|---|---|')
w(f"| native tile | {SCALE['nativeTile']} px |\n| character cell | {SCALE['charCell']}x{SCALE['charCell']} (figure ~28 px, anchor [16,31], faces right) |")
w(f"| zoom desktop / phone | {SCALE['zoomDesktop']}x / {SCALE['zoomPhone']}x |\n| native viewport desktop | 427 x 240 |\n| native viewport phone | 195 x (screen height / 2) |")
w('| world height / ground line | 270 / y=240 (backgrounds are 480x270 tiles, bottom anchored) |')
w('\nRules: all art is placed at **1x**; integer zoom only; camera `scrollY = 30` so the ground band is on screen; emotes are 16px native and stay at 1x.\n')
w('## Palette (docs/design/palette.json)\n')
w('| name | hex |\n|---|---|')
for k, v in PAL.items():
    w(f'| {k} | `{v}` |')
w('')
w('## Village scene layers (z-order)\n')
w('| z | layer | asset | scrollFactor | placement | notes |\n|---|---|---|---|---|---|')
for l in LAYERS:
    w(f"| {l['z']} | {l['name']} | `{l['asset']}` | {l['scrollFactor']} | {l['y']} | {l['notes']} |")
w('')

TITLES = {
    'persona': 'Personas (characters)', 'npc': 'NPCs', 'building': 'Chapter houses (buildings)', 'landmark': 'Council landmarks and windmill',
    'interior': 'Interiors', 'prop': 'Props', 'vehicle': 'Vehicle and road', 'fx': 'FX', 'ui': 'UI (in-world)', 'parallax': 'Parallax and backgrounds',
    'font': 'Fonts',
}
order = ['persona', 'npc', 'building', 'landmark', 'interior', 'prop', 'vehicle', 'fx', 'ui', 'parallax', 'font']
for g in order:
    items = [a for a in ASSETS if a['group'] == g]
    if g == 'persona':
        items = [a for a in ASSETS if a['id'] == 'atlas.characters'] + items
    if not items:
        continue
    w(f'## {TITLES[g]}\n')
    if g == 'persona':
        w('All 11 cast members (incl. freshman, listed under NPCs) live in one atlas, `atlas.characters` (416x352, 143 frames). Frame keys `<persona>/<anim>/<n>` and `<persona>/portrait`. '
          'Animations: idle 2f @2fps, walk 4f @8fps, talk 2f @8fps, sit 2f @2fps, wave 2f @4fps. Walk stride 3 px/frame.\n')
    if g == 'parallax':
        w('| id | need | file | size | scrollFactor | anchor / originFrac | depth | lic |\n|---|---|---|---|---|---|---|---|')
        for a in items:
            w(f"| `{a['id']}` | {a['need']} | {short(a['file'])} | {row_size(a)} | {a.get('scrollFactor')} | {row_anchor(a)} | {a['depthHint']} | {code(a)} |")
        w('\nSky variants: `0_sky_dusk`, `0_sky_dawn`, `0_sky_day` (16x270). Stars twinkle frames: `1_stars_twinkle_0..3` + `_mask` (480x270, ~400 ms/frame).\n')
        continue
    if g == 'font':
        w('| id | need | file | license |\n|---|---|---|---|')
        for a in items:
            w(f"| `{a['id']}` | {a['need']} | `{a['file']}` | {a['license']} |")
        w('')
        continue
    w('| id | need | file | size | frame | anchor / originFrac | variants | depth | lic |\n|---|---|---|---|---|---|---|---|---|')
    for a in items:
        w(f"| `{a['id']}` | {a['need']} | {short(a['file'])} | {row_size(a)} | {row_frame(a)} | {row_anchor(a)} | {variants_cell(a)} | {a['depthHint']} | {code(a)} |")
    w('')
    notes = [a for a in items if a.get('notes') and g in ('building', 'landmark', 'interior', 'vehicle', 'fx')]
    if g in ('building', 'landmark'):
        w('Door, window, sign and chimney coordinates are **not published**: the source provenance records them in pre-trim canvas space (`meta_coords_stale: true`). '
          'Only sprite size and the bottom-centre anchor are authoritative; re-measure on the PNG until the generators export post-trim data.\n')
    for a in notes:
        if g in ('building', 'landmark') and a['notes'].endswith(STALE):
            continue
        w(f"- `{a['id']}`: {a['notes'].replace(STALE, '').strip()}")
    w('')

w('## Size warnings\n')
for s in SIZE_WARN:
    w(f'- {s}')
w('')
w('## Packs that are NOT chosen (and why)\n')
w('| path | pack | decision |\n|---|---|---|')
for r in PACK_ROWS:
    w(f"| `{r['path']}` | {r['name']} | {r['decision']}{'' if r['exists'] else ' (path not found on disk)'} |")
w('')
w('## Gaps (honest list)\n')
w('| need | why | suggested approach |\n|---|---|---|')
for n, wy, s in GAPS:
    w(f'| {n} | {wy} | {s} |')
w('')
w('## Phaser preload snippets\n')
w('Keys equal the manifest `id`. Variant textures use `<id>:<variant>`. Paths are repo-relative (prefix with your static base URL). Personas load via the single atlas.\n')
for k, v in HINTS.items():
    w(f'- **{k}**: {v}')
w('')
for g in GROUP_ORDER:
    if g in ('font',):
        continue
    calls = PRELOAD[g]
    if not calls:
        continue
    w(f'### {g}\n')
    w('```ts\n' + '\n'.join(calls) + '\n```\n')
w('### character animations\n')
w('```ts\nthis.load.json(\'characters-anims\', \'' + C('characters/atlas.json') + '\');\n' + ANIM_SNIPPET + '\n```\n')
w('### spritesheet animations (generated list)\n')
w('| key | frames | fps |\n|---|---|---|')
for i, fr in SPRITESHEET_ANIMS:
    w(f"| `{i}` | {fr['count']} | {fr['fps']} |")
w('')
w('### fonts\n')
w('```css\n@font-face { font-family: "Jersey 10"; src: url("assets/fonts/jersey-10/Jersey10-latin.woff2") format("woff2"); }\n'
  '@font-face { font-family: "Silkscreen"; src: url("assets/fonts/silkscreen/Silkscreen-latin.woff2") format("woff2"); }\n'
  '@font-face { font-family: "Inter Variable"; src: url("assets/fonts/inter/InterVariable-latin.woff2") format("woff2"); font-weight: 100 900; }\n```\n')
w('## Verification\n')
w('Computed from PNGs with PIL; provenance was cross-checked, not trusted.\n')
w(f"- mismatches: **{len(VERIFY['mismatches'])}**")
for m in VERIFY['mismatches']:
    w(f'  - {m}')
w(f"- missing files: **{len(VERIFY['missing_files'])}**")
for m in VERIFY['missing_files']:
    w(f'  - {m}')
w(f"- off-palette PNGs: **{len(VERIFY['off_palette'])}**")
for m in VERIFY['off_palette']:
    w(f'  - {m}')
for n in VERIFY['notes']:
    w(f'- note: {n}')
w('')
with open(os.path.join(REPO, 'docs/design/asset-manifest.md'), 'w') as f:
    f.write('\n'.join(md))
print(f'{len(ASSETS)} assets; {len(VERIFY["mismatches"])} mismatches; {len(VERIFY["missing_files"])} missing; {len(VERIFY["off_palette"])} off-palette')
for m in VERIFY['mismatches'] + VERIFY['missing_files'] + VERIFY['off_palette']:
    print(' -', m)
