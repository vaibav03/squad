import { Pix } from './png.mjs';
export function drawContact(path, { tiles, placed }) {
  const S = 3;
  const bg = [58, 42, 58, 255];
  const cols = 16;
  const tw = cols * 18;
  const th = Math.ceil(tiles.length / cols) * 18;
  const propsW = 560;
  const sheet = new Pix(Math.max(tw, propsW) + 8, 8 + th + 8 + 700);
  sheet.rect(0, 0, sheet.w, sheet.h, bg);
  tiles.forEach((t, i) => sheet.blit(t.pix, 4 + (i % cols) * 18, 4 + Math.floor(i / cols) * 18));
  // props: simple shelf layout on a checker so transparency reads
  let x = 4,
    y = th + 12,
    rowH = 0;
  for (const p of placed) {
    if (x + p.pix.w > propsW) {
      x = 4;
      y += rowH + 6;
      rowH = 0;
    }
    sheet.rect(x, y, p.pix.w, p.pix.h, [150, 160, 140, 255]);
    sheet.blit(p.pix, x, y);
    x += p.pix.w + 6;
    rowH = Math.max(rowH, p.pix.h);
  }
  const trimmed = new Pix(sheet.w, Math.min(sheet.h, y + rowH + 8));
  trimmed.blit(sheet, 0, 0, 0, 0, trimmed.w, trimmed.h);
  trimmed.scaled(S).save(path);
}
