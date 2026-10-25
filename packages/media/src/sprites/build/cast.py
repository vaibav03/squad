"""Cast table for the Squad pixel cast.

Stable keys (consumed elsewhere): id, name, role. `src` + `swap` + `acc` are also read by the portrait builder
(portraits are the CC0 Ninja Adventure faceset recoloured with `swap`); the SPRITES are drawn procedurally by
bodies.py from the `look` dict below so the whole cast shares one body, one outline and one moon light.
`swap`: {palette-name: palette-name} applied to the portrait after quantization (keeps portraits on-palette).
`acc`: accessory names (accessories.py; the portrait pack mirrors these names).
`look`: skin / hair / top / pants / shoes ramps, detail, hat+prop ramps (all palette names)."""

SKIN = {   # base, shade, blush
  'lt': ('skin-lt', 'wood-lit', 'ember'),
  'md': ('wood-lit', 'wood', 'ember'),
  'dk': ('wood', 'wood-dark', 'wood-lit'),
  'fur': ('wood', 'wood-dark', 'wood-lit'),
}
HAIR = {   # hi, base, shade
  'black':  ('hill-near', 'ground', 'sky-deep'),
  'brown':  ('wood-lit', 'wood', 'wood-dark'),
  'dark':   ('wood', 'wood-dark', 'sky-deep'),
  'blonde': ('glow-core', 'glow', 'ember'),
  'ginger': ('glow', 'ember', 'roof-wine'),
  'white':  ('cloud-hi', 'wall-lit', 'wall-mid'),
  'grey':   ('wall-lit', 'wall-mid', 'wall-shade'),
  'violet': ('cloud-hi', 'violet', 'wall-shade'),
  'wine':   ('alert', 'roof-wine', 'roof-shade'),
}
CLOTH = {  # hi, base, shade
  'teal':   ('cloud-lo', 'leaf-lit', 'leaf-dark'),
  'blue':   ('cloud-lo', 'sky-low', 'sky-mid'),
  'violet': ('cloud-hi', 'violet', 'wall-shade'),
  'wine':   ('alert', 'roof-wine', 'roof-shade'),
  'red':    ('ember', 'alert', 'roof-wine'),
  'gold':   ('glow-core', 'glow', 'ember'),
  'orange': ('glow', 'ember', 'roof-wine'),
  'brown':  ('wood-lit', 'wood', 'wood-dark'),
  'green':  ('ok', 'leaf-lit', 'leaf-dark'),
  'white':  ('wall-lit', 'wall-mid', 'wall-shade'),
  'cream':  ('moon', 'cloud-hi', 'cloud-lo'),
  'navy':   ('hill-mid', 'hill-near', 'sky-deep'),
  'char':   ('wall-shade', 'ground', 'sky-deep'),
  'steel':  ('wall-mid', 'wall-shade', 'hill-near'),
}
TRIM = {   # hi, dark
  'gold': ('glow', 'ember'), 'white': ('wall-lit', 'wall-mid'), 'red': ('alert', 'roof-wine'), 'violet': ('violet', 'wall-shade'),
  'teal': ('leaf-lit', 'leaf-dark'), 'ink': ('wall-shade', 'sky-deep'), 'ember': ('ember', 'roof-wine'), 'cream': ('moon', 'glow'),
}

def L(skin='lt', hair='short', hair_c='brown', top='tee', top_c='teal', detail='plain', trim='gold', pants='dark', shoes='wood-dark',
      acc_c=('wood-lit', 'wood', 'wood-dark'), prop=None, base_dy=0):
    P = {'dark': ('wood', 'wood-dark'), 'navy': ('hill-near', 'sky-deep'), 'char': ('ground', 'sky-deep'), 'brown': ('wood-lit', 'wood'),
         'steel': ('wall-shade', 'hill-near'), 'wine': ('roof-wine', 'roof-shade'), 'khaki': ('glow', 'ember'), 'grey': ('wall-mid', 'wall-shade'),
         'blue': ('sky-low', 'sky-mid'), 'teal': ('leaf-lit', 'leaf-dark'), 'violet': ('violet', 'wall-shade')}[pants]
    return dict(skin=SKIN[skin], hair=hair, hair_c=HAIR[hair_c], top=top, top_c=CLOTH[top_c], detail=detail, trim_c=TRIM[trim],
                pants_c=P, shoes=shoes, acc_c=acc_c, prop=prop, base_dy=base_dy)

CAST = [
  dict(id='cubbie', name='Cubbie', role='cubbie', src='CaveLion2', swap={'ember': 'wood', 'leaf-lit': 'wood-lit', 'cloud-lo': 'wood-lit'}, acc=['bear-ears', 'muzzle'],
       look=L(skin='fur', hair='none', top='tee', top_c='brown', detail='scarf', trim='gold', pants='char', acc_c=('wood-lit', 'wood', 'wood-dark'), prop='lantern')),
  dict(id='examiner', name='The Examiner', role='examiner', src='Inspector', swap={'alert': 'wood-lit', 'ember': 'skin-lt'}, acc=['proctor-cap', 'specs'],
       look=L(skin='lt', hair='none', top='tee', top_c='char', detail='tie', trim='red', pants='char', shoes='ink', acc_c=('wall-mid', 'wall-shade', 'hill-near'), prop='clipboard')),
  dict(id='dean', name='The Dean', role='dean', src='Master', swap={'alert': 'skin-lt', 'ember': 'skin-lt', 'moon': 'wall-lit'}, acc=['mortarboard', 'tassel'],
       look=L(skin='lt', hair='short', hair_c='white', top='robe', top_c='wine', detail='collar', trim='gold', acc_c=('roof-wine', 'roof-shade', 'sky-deep'))),
  dict(id='expert-ada', name='Prof. Ada', role='expert', src='OldWoman', swap={'alert': 'wood-lit', 'ember': 'wood-lit', 'wall-mid': 'wall-lit'}, acc=['owl-specs'],
       look=L(skin='md', hair='bun', hair_c='grey', top='tee', top_c='teal', detail='vest', trim='gold', pants='navy')),
  dict(id='expert-sage', name='Sage', role='expert', src='OldMan', swap={}, acc=['beard', 'brows'],
       look=L(skin='lt', hair='short', hair_c='white', top='robe', top_c='green', detail='sash', trim='cream')),
  dict(id='expert-monk', name='Brother Bit', role='expert', src='Monk2', swap={'ember': 'wood-lit', 'alert': 'wood'}, acc=[],
       look=L(skin='md', hair='monk', hair_c='dark', top='robe', top_c='orange', detail='sash', trim='cream')),
  dict(id='expert-mage', name='Mage Moda', role='expert', src='SorcererBlack', swap={}, acc=['wizard-hat'],
       look=L(skin='lt', hair='long', hair_c='white', top='robe', top_c='violet', detail='cape', trim='gold', acc_c=('violet', 'wall-shade', 'sky-deep'))),
  dict(id='rival', name='The Rival', role='rival', src='Hunter', swap={'alert': 'wood-lit', 'ember': 'wood-lit', 'roof-wine': 'wood-dark'}, acc=['goggles-fh'],
       look=L(skin='md', hair='spiky', hair_c='black', top='tee', top_c='char', detail='scarf', trim='red', pants='navy')),
  dict(id='council-chill', name='Chill', role='council', src='Villager6', swap={'alert': 'wood', 'ember': 'wood'}, acc=['headphones'],
       look=L(skin='dk', hair='curly', hair_c='black', top='tee', top_c='teal', detail='hoodie', trim='white', pants='steel', acc_c=('violet', 'wall-shade', 'sky-deep'))),
  dict(id='council-grind', name='Grind', role='council', src='Samurai', swap={'alert': 'skin-lt'}, acc=['headband'],
       look=L(skin='lt', hair='spiky', hair_c='dark', top='tee', top_c='blue', detail='stripe', trim='white', pants='char', acc_c=('alert', 'alert', 'roof-wine'), prop='coffee')),
  dict(id='council-advisor', name='Advisor', role='council', src='Noble', swap={}, acc=['monocle'],
       look=L(skin='md', hair='short', hair_c='grey', top='tee', top_c='steel', detail='tie', trim='gold', pants='char', shoes='ink')),
  dict(id='chairman', name='The Chairman', role='council', src='Sultan', swap={'alert': 'wood-lit', 'ember': 'wood-lit'}, acc=['crown'],
       look=L(skin='md', hair='none', top='robe', top_c='violet', detail='cape', trim='gold', acc_c=('glow-core', 'glow', 'ember'), prop='gavel')),
  dict(id='feynman', name='Feynman Freshman', role='feynman', src='EggBoy', swap={}, acc=['goggles-big', 'prop-cap', 'propeller'],
       look=L(skin='lt', hair='none', top='tee', top_c='white', detail='stripe', trim='teal', pants='khaki', acc_c=('cloud-hi', 'leaf-lit', 'leaf-dark'), base_dy=1)),
  dict(id='student-01', name='Student 1', role='student', src='Boy', swap={'alert': 'skin-lt', 'ember': 'skin-lt'}, acc=[],
       look=L(skin='lt', hair='spiky', hair_c='ginger', top='tee', top_c='blue', pants='char')),
  dict(id='student-02', name='Student 2', role='student', src='Villager3', swap={}, acc=[],
       look=L(skin='dk', hair='curly', hair_c='black', top='tee', top_c='gold', detail='hoodie', trim='white', pants='navy')),
  dict(id='student-03', name='Student 3', role='student', src='Villager4', swap={'ember': 'wood-lit', 'alert': 'wood-lit', 'glow': 'wood-lit'}, acc=[],
       look=L(skin='md', hair='long', hair_c='dark', top='tee', top_c='green', pants='brown')),
  dict(id='student-04', name='Student 4', role='student', src='Woman', swap={'ember': 'skin-lt'}, acc=[],
       look=L(skin='lt', hair='ponytail', hair_c='blonde', top='tee', top_c='violet', pants='navy')),
  dict(id='student-05', name='Student 5', role='student', src='Cavegirl2', swap={}, acc=[],
       look=L(skin='md', hair='bun', hair_c='wine', top='tee', top_c='cream', detail='stripe', trim='teal', pants='teal')),
  dict(id='student-06', name='Student 6', role='student', src='Villager5', swap={'alert': 'skin-lt', 'ember': 'skin-lt'}, acc=[],
       look=L(skin='lt', hair='mohawk', hair_c='violet', top='tee', top_c='red', pants='char')),
]
