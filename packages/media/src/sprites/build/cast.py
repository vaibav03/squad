"""Cast table: which Ninja Adventure (CC0) character each persona is built from, plus deliberate palette swaps.
swap: {palette-name: palette-name} applied after quantization to the master palette (so the outputs stay locked).
acc:  accessory names drawn by accessories.py (code-drawn pixel overlays)."""
CAST = [
  # id, display name, role, source dir, swaps, accessories, portrait expression index (unused for now)
  dict(id='cubbie',       name='Cubbie',            role='cubbie',   src='CaveLion2',  swap={}, acc=[]),
  dict(id='examiner',     name='The Examiner',      role='examiner', src='Inspector',  swap={}, acc=[]),
  dict(id='dean',         name='The Dean',          role='dean',     src='Master',     swap={}, acc=[]),
  dict(id='expert-ada',   name='Prof. Ada',         role='expert',   src='OldWoman',   swap={}, acc=[]),
  dict(id='expert-sage',  name='Sage',              role='expert',   src='OldMan',     swap={}, acc=[]),
  dict(id='expert-monk',  name='Brother Bit',       role='expert',   src='Monk2',      swap={}, acc=[]),
  dict(id='expert-mage',  name='Mage Moda',         role='expert',   src='SorcererBlack', swap={}, acc=[]),
  dict(id='rival',        name='The Rival',         role='rival',    src='Hunter',     swap={}, acc=[]),
  dict(id='council-chill',   name='Chill',          role='council',  src='Villager6',  swap={}, acc=[]),
  dict(id='council-grind',   name='Grind',          role='council',  src='Samurai',    swap={}, acc=[]),
  dict(id='council-advisor', name='Advisor',        role='council',  src='Noble',      swap={}, acc=[]),
  dict(id='chairman',     name='The Chairman',      role='council',  src='Sultan',     swap={}, acc=[]),
  dict(id='feynman',      name='Feynman Freshman',  role='feynman',  src='EggBoy',     swap={}, acc=[]),
  dict(id='student-01',   name='Student 1',         role='student',  src='Boy',        swap={}, acc=[]),
  dict(id='student-02',   name='Student 2',         role='student',  src='Villager3',  swap={}, acc=[]),
  dict(id='student-03',   name='Student 3',         role='student',  src='Villager4',  swap={}, acc=[]),
  dict(id='student-04',   name='Student 4',         role='student',  src='Woman',      swap={}, acc=[]),
  dict(id='student-05',   name='Student 5',         role='student',  src='Cavegirl2',  swap={}, acc=[]),
  dict(id='student-06',   name='Student 6',         role='student',  src='Villager5',  swap={}, acc=[]),
]
