# media-art: personas, sprites, portraits, GIFs, Persona Wall

Contract for consumers: `docs/sprite-api.md` (format v2). Art is the design-foundation 32x32 side-view cast (`assets/pixel/composed/scripts/characters_*.py`, read-only) plus extension characters in `build/ext_chars.py`.

```
pnpm --filter @squad/media build:sprites   # python3 + Pillow: assets/sprites/** (strips, portraits, cast.png/json, contact sheets), deterministic
pnpm --filter @squad/media build:gifs      # needs ffmpeg: <id>/hello.gif, talk.gif (< 400 KB)
pnpm --filter @squad/media build:wall      # assets/sprites/wall/persona-wall.html + wall-dark/light.png
pnpm --filter @squad/media test            # registry, atlas validity, palette lock, GIFs
open assets/sprites/wall/persona-wall.html # review every character, light/dark, 2x/3x/4x
```

Review sheets: `assets/sprites/_contact-cast-{2x,3x}-{dark,light}.png`, `_contact-anims.png`, and `docs/design/shots/media-art/`.
Add a character: add a spec to `build/ext_chars.py` (palette names only), a row in `ROSTER` and `NAMES` in `build/build_cast.py`, a seed in `src/personas/data.ts`, rebuild, run the tests.
Not verified: ElevenLabs voices (voiceId unset until media-audio designs them), real iMessage rendering of the GIFs on a phone.
