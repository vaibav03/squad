import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Citation, Llm, OutboundMessage } from '@squad/core';
import sharp from 'sharp';
import { z } from 'zod';
import type { BudgetGuard } from '../tts/budget';
import { readJsonIfExists, writeFileEnsured } from '../tts/audio';
import { C, DiagramSpec, esc, renderDiagramSvg, W, wrap } from './diagram';
import { illustrationPrompt, type ImageGen } from './imagegen';

export * from './diagram';
export * from './imagegen';

export interface ExplainerMaterial {
  chapterTitle: string;
  passages: { id: string; text: string; cite: Citation }[];
  /** Real figures the diagram may plot (label + value), e.g. quiz stats or numbers from the chapter. */
  figures?: { label: string; value: number; unit?: string }[];
}
export type ExplainerMaterialProvider = (req: {
  courseId: string;
  chapter: string;
  question?: string;
}) => Promise<ExplainerMaterial>;

export const PlanSchema = z.object({
  panels: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('diagram'),
          diagram: DiagramSpec,
          sources: z.array(z.string()).default([]),
        }),
        z.object({
          kind: z.literal('illustration'),
          concept: z.string().min(3).max(200),
          caption: z.string().min(1).max(140),
        }),
      ]),
    )
    .min(1)
    .max(3),
});
export type Plan = z.infer<typeof PlanSchema>;

export interface ExplainerDeps {
  llm: Llm;
  material: ExplainerMaterialProvider;
  imageGen?: ImageGen;
  budget?: BudgetGuard;
  outDir: string;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
}

export interface Panel {
  path: string;
  kind: 'diagram' | 'illustration';
  caption: string;
}

export interface ExplainerResult {
  message: OutboundMessage;
  panels: Panel[];
  plan: Plan;
}

const hash = (...p: unknown[]) =>
  createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 20);

function planPrompt(m: ExplainerMaterial, question?: string) {
  const system = [
    'You plan a visual explainer of 1-3 panels for a study chat.',
    'Use "diagram" panels for anything with labels, numbers or steps: fill the structured spec (flow, bars, compare, timeline) using ONLY facts from the passages and figures given. Never invent numbers.',
    'Use at most one "illustration" panel, purely decorative: give a short concept and a one-line caption. The image model will not draw any text.',
    'Reply JSON {"panels":[...]} with: diagram panels {"kind":"diagram","diagram":{...},"sources":[passageIds]}; illustration {"kind":"illustration","concept","caption"}.',
  ].join(' ');
  const user = [
    `Chapter: ${m.chapterTitle}`,
    question ? `Student question: ${question}` : 'Explain the chapter visually.',
    ...m.passages.map((p) => `[${p.id}] ${p.text}`),
    ...(m.figures?.length
      ? [
          'Figures:',
          ...m.figures.map((f) => `- ${f.label}: ${f.value}${f.unit ? ' ' + f.unit : ''}`),
        ]
      : []),
  ].join('\n');
  return { system, user };
}

async function svgToPng(svg: string, out: string): Promise<void> {
  await writeFileEnsured(out, await sharp(Buffer.from(svg)).png().toBuffer());
}

/** Illustration (or decorative fallback) with a caption band added by code, 1080 px wide. */
async function captioned(img: Uint8Array, caption: string): Promise<Buffer> {
  const resized = await sharp(img).resize({ width: W, height: W, fit: 'cover' }).png().toBuffer();
  const lines = wrap(caption, 34, W - 120).slice(0, 3);
  const bandH = lines.length * 44 + 50;
  const band =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${bandH}"><rect width="100%" height="100%" fill="${C.bg}"/>` +
    lines
      .map(
        (l, i) =>
          `<text x="${W / 2}" y="${50 + i * 44}" font-size="34" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" text-anchor="middle" fill="${C.ink}">${esc(l)}</text>`,
      )
      .join('') +
    '</svg>';
  return sharp({ create: { width: W, height: W + bandH, channels: 3, background: C.bg } })
    .composite([
      { input: resized, top: 0, left: 0 },
      { input: Buffer.from(band), top: W, left: 0 },
    ])
    .png()
    .toBuffer();
}

function decorativeSvg(seed: string): Buffer {
  const h = createHash('sha256').update(seed).digest();
  const cols = [C.a, C.b, C.c];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}"><rect width="100%" height="100%" fill="${C.bg}"/>`;
  for (let i = 0; i < 9; i++)
    s += `<circle cx="${120 + (h[i]! % 8) * 120}" cy="${120 + (h[i + 9]! % 8) * 120}" r="${60 + (h[i + 18]! % 80)}" fill="${cols[i % 3]}" fill-opacity="0.28"/>`;
  return Buffer.from(s + '</svg>');
}

export async function makeExplainer(
  deps: ExplainerDeps,
  req: { courseId: string; chapter: string; question?: string; chatId: string },
): Promise<ExplainerResult> {
  const material = await deps.material(req);
  const { system, user } = planPrompt(material, req.question);
  const planPath = join(deps.outDir, 'plans', `${hash('plan', system, user)}.json`);
  let plan = await readJsonIfExists<Plan>(planPath);
  if (!plan) {
    plan = await deps.llm.json({
      model: 'main',
      system,
      messages: user,
      schema: PlanSchema,
      temperature: 0.4,
    });
    await writeFileEnsured(planPath, JSON.stringify(plan));
  }

  const byId = new Map(material.passages.map((p) => [p.id, p.cite]));
  const allCites: Citation[] = [];
  const panels: Panel[] = [];
  for (const [i, panel] of plan.panels.entries()) {
    if (panel.kind === 'diagram') {
      const cites = panel.sources.map((s) => byId.get(s)).filter((c): c is Citation => !!c);
      allCites.push(...cites);
      const footer = cites.length
        ? [
            `Sources: ${[...new Set(cites.map((c) => `${c.file}${c.page ? ` p.${c.page}` : ''}`))].join(', ')}`,
          ]
        : [];
      const { svg } = renderDiagramSvg(panel.diagram, footer);
      const out = join(deps.outDir, 'panels', `diagram-${hash(svg)}.png`);
      if (
        !(await access(out).then(
          () => true,
          () => false,
        ))
      )
        await svgToPng(svg, out);
      panels.push({ path: out, kind: 'diagram', caption: panel.diagram.title });
    } else {
      const prompt = illustrationPrompt(panel.concept);
      const out = join(deps.outDir, 'panels', `illus-${hash(prompt, panel.caption)}.png`);
      if (
        !(await access(out).then(
          () => true,
          () => false,
        ))
      ) {
        let img: Uint8Array;
        try {
          if (!deps.imageGen) throw new Error('no image generator configured');
          deps.budget?.charge('gemini.images', 1);
          img = await deps.imageGen.generate(prompt);
        } catch (e) {
          deps.log?.('illustration unavailable, drawing decorative panel', {
            reason: e instanceof Error ? e.name : 'error',
            panel: i,
          });
          img = await sharp(decorativeSvg(prompt)).png().toBuffer();
        }
        await writeFileEnsured(out, await captioned(img, panel.caption));
      }
      panels.push({ path: out, kind: 'illustration', caption: panel.caption });
    }
  }
  const uniq = [...new Set(allCites.map((c) => `${c.file}${c.page ? ` p.${c.page}` : ''}`))];
  const text = `Picture It: ${material.chapterTitle}\n${uniq.length ? `Sources: ${uniq.join(', ')}` : 'Sources: course materials'}`;
  return {
    message: {
      chatId: req.chatId,
      text,
      personaId: 'cubbie',
      attachments: panels.map((p) => ({ path: p.path, mime: 'image/png' })),
    },
    panels,
    plan,
  };
}

export async function readPanel(p: Panel): Promise<Buffer> {
  return readFile(p.path);
}
