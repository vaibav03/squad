"""Regenerate every composed asset, then verify the palette. Run: python3 make_all.py"""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
for s in ('palette.py', 'make_backgrounds.py', 'make_buildings.py', 'make_props.py', 'make_characters.py', 'check_assets.py'):
    p = os.path.join(here, s)
    if not os.path.exists(p): print('skip (missing)', s); continue
    print('==', s); r = subprocess.run([sys.executable, p], cwd=here)
    if r.returncode: sys.exit(r.returncode)
