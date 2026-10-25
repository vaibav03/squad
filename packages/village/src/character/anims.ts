import type Phaser from 'phaser';

export const CHAR_ATLAS = 'atlas.characters';
const RATES: Record<string, number> = { idle: 2, walk: 8, talk: 8, sit: 2, wave: 4 };
export const WALK_FPS = 12; // 3 px planted-foot stride per frame x 12 fps = 36 px/s: no foot sliding (design handoff)

/** Creates `<cast>-<anim>` animations (e.g. 'student-walk') for every group in the composed character atlas. Idempotent. Shared with NPC code. */
export function ensureCharacterAnims(scene: Phaser.Scene, atlasKey = CHAR_ATLAS): void {
  if (!scene.textures.exists(atlasKey)) return;
  const names = scene.textures.get(atlasKey).getFrameNames();
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const m = /^(.+)\/(idle|walk|talk|sit|wave)\/(\d+)$/.exec(n);
    if (!m) continue;
    const k = `${m[1]}-${m[2]}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(n);
  }
  for (const [key, frames] of groups) {
    if (scene.anims.exists(key)) continue;
    frames.sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()));
    const rate = RATES[key.split('-').pop()!] ?? 8;
    scene.anims.create({
      key,
      frames: frames.map((f) => ({ key: atlasKey, frame: f })),
      frameRate: rate,
      repeat: -1,
    });
  }
  const walk = scene.anims.get('student-walk');
  if (walk && !scene.anims.exists('student-walk-fast')) {
    scene.anims.create({
      key: 'student-walk-fast',
      frames: walk.frames.map((f) => ({ key: atlasKey, frame: f.textureFrame })),
      frameRate: WALK_FPS,
      repeat: -1,
    });
  }
}
