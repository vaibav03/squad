import { z } from 'zod';

/**
 * Diagram specs are plain data; CODE draws them. Every label and number in the PNG comes straight
 * from the spec (which the planner builds from real passages and figures), so the image can never
 * invent text. Layout is deterministic: no randomness anywhere.
 */
const label = z.string().min(1).max(120);

export const FlowSpec = z.object({
  kind: z.literal('flow'),
  title: label,
  nodes: z
    .array(z.object({ id: z.string().min(1).max(40), label }))
    .min(2)
    .max(10),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: label.optional() })).max(20),
});
export const BarsSpec = z.object({
  kind: z.literal('bars'),
  title: label,
  unit: z.string().max(20).optional(),
  series: z
    .array(z.object({ label, value: z.number().finite() }))
    .min(2)
    .max(10),
});
export const CompareSpec = z.object({
  kind: z.literal('compare'),
  title: label,
  left: z.object({ heading: label, points: z.array(label).min(1).max(6) }),
  right: z.object({ heading: label, points: z.array(label).min(1).max(6) }),
});
export const TimelineSpec = z.object({
  kind: z.literal('timeline'),
  title: label,
  steps: z
    .array(z.object({ label, detail: label.optional() }))
    .min(2)
    .max(8),
});
export const DiagramSpec = z.discriminatedUnion('kind', [
  FlowSpec,
  BarsSpec,
  CompareSpec,
  TimelineSpec,
]);
export type DiagramSpec = z.infer<typeof DiagramSpec>;

export const W = 1080;
const FONT = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"';
export const C = {
  bg: '#FBF7EF',
  ink: '#2B2620',
  soft: '#6B6257',
  box: '#FFFFFF',
  line: '#CBBFAE',
  a: '#D9772B',
  b: '#3E7C6B',
  c: '#5B6FA8',
};

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Greedy word wrap by estimated glyph width (0.56 em). */
export function wrap(text: string, fontSize: number, maxWidth: number): string[] {
  const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * 0.56)));
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const w = word.length > maxChars ? word.match(new RegExp(`.{1,${maxChars}}`, 'g'))! : [word];
    for (const piece of w) {
      if (cur && (cur + ' ' + piece).length > maxChars) {
        lines.push(cur);
        cur = piece;
      } else cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function text(
  x: number,
  y: number,
  lines: string[],
  size: number,
  o: { anchor?: string; weight?: number; fill?: string; lh?: number } = {},
): string {
  const lh = o.lh ?? size * 1.25;
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${Math.round(y + i * lh)}" font-size="${size}" ${FONT} text-anchor="${o.anchor ?? 'start'}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? C.ink}">${esc(l)}</text>`,
    )
    .join('');
}

interface Drawn {
  body: string;
  height: number;
}

function title(t: string): Drawn {
  const lines = wrap(t, 44, W - 120);
  return {
    body: text(60, 80, lines, 44, { weight: 700 }),
    height: 80 + (lines.length - 1) * 55 + 40,
  };
}

function drawFlow(s: z.infer<typeof FlowSpec>, top: number): Drawn {
  // layer = longest path from a root (cycle-safe by iteration cap)
  const layer = new Map(s.nodes.map((n) => [n.id, 0]));
  for (let it = 0; it < s.nodes.length; it++)
    for (const e of s.edges)
      if (layer.has(e.from) && layer.has(e.to))
        layer.set(
          e.to,
          Math.min(s.nodes.length - 1, Math.max(layer.get(e.to)!, layer.get(e.from)! + 1)),
        );
  const rows = new Map<number, string[]>();
  for (const n of s.nodes)
    rows.set(layer.get(n.id)!, [...(rows.get(layer.get(n.id)!) ?? []), n.id]);
  const nodeH = 110;
  const gap = 90;
  const pos = new Map<string, { x: number; y: number; w: number }>();
  const keys = [...rows.keys()].sort((a, b) => a - b);
  keys.forEach((k, r) => {
    const ids = rows.get(k)!;
    const w = Math.min(420, (W - 120 - (ids.length - 1) * 40) / ids.length);
    const total = ids.length * w + (ids.length - 1) * 40;
    ids.forEach((id, i) =>
      pos.set(id, { x: (W - total) / 2 + i * (w + 40), y: top + r * (nodeH + gap), w }),
    );
  });
  let body =
    '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="' +
    C.soft +
    '"/></marker></defs>';
  for (const e of s.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + a.w / 2;
    const y1 = a.y + nodeH;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    body += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2 - 4}" stroke="${C.soft}" stroke-width="3" marker-end="url(#ah)"/>`;
    if (e.label) {
      const lab = text((x1 + x2) / 2, (y1 + y2) / 2 + 8, wrap(e.label, 24, 300).slice(0, 2), 24, {
        fill: C.soft,
        anchor: 'middle',
      });
      body += lab.replace(
        /<text /g,
        `<text stroke="${C.bg}" stroke-width="10" paint-order="stroke" `,
      );
    }
  }
  const colors = [C.a, C.b, C.c];
  s.nodes.forEach((n) => {
    const p = pos.get(n.id)!;
    const lines = wrap(n.label, 30, p.w - 30).slice(0, 3);
    body += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${nodeH}" rx="18" fill="${C.box}" stroke="${colors[layer.get(n.id)! % 3]}" stroke-width="4"/>`;
    body += text(p.x + p.w / 2, p.y + nodeH / 2 - ((lines.length - 1) * 37.5) / 2 + 10, lines, 30, {
      anchor: 'middle',
      weight: 600,
      lh: 37.5,
    });
  });
  return { body, height: top + keys.length * (nodeH + gap) - gap + 40 - top };
}

function drawBars(s: z.infer<typeof BarsSpec>, top: number): Drawn {
  const max = Math.max(...s.series.map((x) => Math.abs(x.value)), 1e-9);
  const rowH = 96;
  let body = '';
  s.series.forEach((p, i) => {
    const y = top + i * rowH;
    const w = Math.max(6, (Math.abs(p.value) / max) * 440);
    body += text(60, y + 38, wrap(p.label, 28, 380).slice(0, 2), 28, { lh: 32 });
    body += `<rect x="460" y="${y + 8}" width="${w}" height="52" rx="10" fill="${[C.a, C.b, C.c][i % 3]}"/>`;
    body += text(
      460 + w + 14,
      y + 46,
      [`${Number.isInteger(p.value) ? p.value : p.value.toString()}${s.unit ? ' ' + s.unit : ''}`],
      30,
      { weight: 700 },
    );
  });
  return { body, height: s.series.length * rowH + 20 };
}

function drawCompare(s: z.infer<typeof CompareSpec>, top: number): Drawn {
  const colW = (W - 120 - 40) / 2;
  const cols = [s.left, s.right];
  let maxH = 0;
  let body = '';
  cols.forEach((c, i) => {
    const x = 60 + i * (colW + 40);
    let y = top + 70;
    let inner = text(x + 24, top + 48, wrap(c.heading, 32, colW - 48).slice(0, 2), 32, {
      weight: 700,
      fill: [C.a, C.b][i]!,
    });
    for (const p of c.points) {
      const lines = wrap(p, 26, colW - 70);
      inner +=
        `<circle cx="${x + 30}" cy="${y + 16}" r="6" fill="${[C.a, C.b][i]}"/>` +
        text(x + 50, y + 24, lines, 26, { lh: 32 });
      y += lines.length * 32 + 22;
    }
    maxH = Math.max(maxH, y - top + 16);
    body += `<g>${inner}</g>`;
  });
  cols.forEach((_, i) => {
    const x = 60 + i * (colW + 40);
    body =
      `<rect x="${x}" y="${top}" width="${colW}" height="${maxH}" rx="20" fill="${C.box}" stroke="${C.line}" stroke-width="3"/>` +
      body;
  });
  return { body, height: maxH + 20 };
}

function drawTimeline(s: z.infer<typeof TimelineSpec>, top: number): Drawn {
  let y = top;
  let body = '';
  s.steps.forEach((st, i) => {
    const l1 = wrap(st.label, 32, W - 260).slice(0, 2);
    const l2 = st.detail ? wrap(st.detail, 24, W - 260).slice(0, 3) : [];
    const h = l1.length * 40 + l2.length * 30 + 30;
    body +=
      `<circle cx="100" cy="${y + 24}" r="26" fill="${[C.a, C.b, C.c][i % 3]}"/>` +
      text(100, y + 34, [String(i + 1)], 28, { anchor: 'middle', weight: 700, fill: '#fff' });
    if (i < s.steps.length - 1)
      body += `<line x1="100" y1="${y + 52}" x2="100" y2="${y + h + 22}" stroke="${C.line}" stroke-width="4"/>`;
    body +=
      text(160, y + 34, l1, 32, { weight: 600, lh: 40 }) +
      text(160, y + 34 + l1.length * 40 - 6, l2, 24, { fill: C.soft, lh: 30 });
    y += h + 40;
  });
  return { body, height: y - top };
}

/** Render a validated spec to a complete SVG document (1080 px wide), with a citations footer drawn by code. */
export function renderDiagramSvg(
  spec: DiagramSpec,
  footer: string[] = [],
): { svg: string; width: number; height: number } {
  const t = title(spec.title);
  const top = t.height;
  const d =
    spec.kind === 'flow'
      ? drawFlow(spec, top)
      : spec.kind === 'bars'
        ? drawBars(spec, top)
        : spec.kind === 'compare'
          ? drawCompare(spec, top)
          : drawTimeline(spec, top);
  const flines = footer.flatMap((f) => wrap(f, 22, W - 120)).slice(0, 3);
  const bottom = top + d.height + 30;
  const height = bottom + (flines.length ? flines.length * 28 + 40 : 20);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">` +
    `<rect width="100%" height="100%" fill="${C.bg}"/>${t.body}${d.body}` +
    (flines.length
      ? `<line x1="60" y1="${bottom}" x2="${W - 60}" y2="${bottom}" stroke="${C.line}" stroke-width="2"/>` +
        text(60, bottom + 36, flines, 22, { fill: C.soft, lh: 28 })
      : '') +
    `</svg>`;
  return { svg, width: W, height };
}

/** Every human-visible string in a spec, for tests and caption checks. */
export function specStrings(spec: DiagramSpec): string[] {
  switch (spec.kind) {
    case 'flow':
      return [
        spec.title,
        ...spec.nodes.map((n) => n.label),
        ...spec.edges.flatMap((e) => (e.label ? [e.label] : [])),
      ];
    case 'bars':
      return [spec.title, ...spec.series.flatMap((p) => [p.label, String(p.value)])];
    case 'compare':
      return [
        spec.title,
        spec.left.heading,
        spec.right.heading,
        ...spec.left.points,
        ...spec.right.points,
      ];
    case 'timeline':
      return [
        spec.title,
        ...spec.steps.flatMap((s) => (s.detail ? [s.label, s.detail] : [s.label])),
      ];
  }
}
