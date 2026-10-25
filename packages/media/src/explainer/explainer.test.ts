import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeLlm } from '@squad/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BudgetGuard } from '../tts/budget';
import { DiagramSpec, renderDiagramSvg, specStrings } from './diagram';
import { FakeImageGen, illustrationPrompt } from './imagegen';
import { makeExplainer, type ExplainerMaterial, type Plan } from './index';

const cite = { courseId: 'demo', chapter: 'ch5', file: 'ch5.pdf', page: 7 };
const material: ExplainerMaterial = {
  chapterTitle: 'Chapter 5: Rates',
  passages: [{ id: 'p1', text: 'Rate = change / time.', cite }],
  figures: [{ label: 'Class average', value: 72.5, unit: '%' }],
};
const plan: Plan = {
  panels: [
    {
      kind: 'diagram',
      sources: ['p1'],
      diagram: {
        kind: 'bars',
        title: 'Scores <by> "topic" & more',
        unit: '%',
        series: [
          { label: 'Class average', value: 72.5 },
          { label: 'Top quartile', value: 91 },
        ],
      },
    },
    { kind: 'illustration', concept: 'a river flowing downhill', caption: 'Rates are about flow' },
  ],
};

async function run(
  over: { budget?: BudgetGuard; imageGen?: FakeImageGen | undefined; llm?: FakeLlm } = {},
) {
  const llm = over.llm ?? new FakeLlm({ fallback: plan as unknown as Record<string, unknown> });
  const outDir = await mkdtemp(join(tmpdir(), 'ex-'));
  const imageGen = 'imageGen' in over ? over.imageGen : new FakeImageGen();
  const r = await makeExplainer(
    {
      llm,
      material: async () => material,
      ...(imageGen ? { imageGen } : {}),
      ...(over.budget ? { budget: over.budget } : {}),
      outDir,
    },
    { courseId: 'demo', chapter: 'ch5', chatId: 'c' },
  );
  return { r, llm, imageGen, outDir };
}

describe('explainer', () => {
  it('diagram svg contains every label and number verbatim (escaped)', () => {
    const spec = DiagramSpec.parse(
      plan.panels[0] && (plan.panels[0] as { diagram: unknown }).diagram,
    );
    const { svg } = renderDiagramSvg(spec, ['Sources: ch5.pdf p.7']);
    for (const s of specStrings(spec)) {
      const esc = s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      const words = esc.split(/\s+/);
      for (const w of words) expect(svg).toContain(w);
    }
    expect(svg).toContain('72.5');
    expect(svg).not.toContain('<by>');
    expect(svg).toContain('Sources: ch5.pdf p.7');
  });

  it('every diagram kind renders deterministically to PNG', () => {
    const specs = [
      {
        kind: 'flow',
        title: 'Flow',
        nodes: [
          { id: 'a', label: 'Input' },
          { id: 'b', label: 'Process' },
          { id: 'c', label: 'Output' },
        ],
        edges: [
          { from: 'a', to: 'b', label: 'x' },
          { from: 'b', to: 'c' },
        ],
      },
      {
        kind: 'compare',
        title: 'Cmp',
        left: { heading: 'L', points: ['one', 'two'] },
        right: { heading: 'R', points: ['three'] },
      },
      {
        kind: 'timeline',
        title: 'T',
        steps: [{ label: 'First', detail: 'does a' }, { label: 'Second' }],
      },
    ].map((s) => DiagramSpec.parse(s));
    for (const s of specs) {
      const a = renderDiagramSvg(s).svg;
      expect(renderDiagramSvg(s).svg).toBe(a);
    }
  });

  it('produces PNG panels 1080 wide with citations; illustration prompt says no text', async () => {
    const { r, imageGen } = await run();
    expect(r.panels).toHaveLength(2);
    for (const p of r.panels) expect((await sharp(p.path).metadata()).width).toBe(1080);
    expect(imageGen!.prompts[0]).toMatch(/no text, no labels/i);
    expect(illustrationPrompt('x')).toMatch(/no text/i);
    expect(r.message.attachments?.every((a) => a.mime === 'image/png')).toBe(true);
    expect(r.message.text).toContain('ch5.pdf p.7');
  });

  it('plan is cached: second run makes no LLM call and reuses files', async () => {
    const { llm, outDir, imageGen } = await run();
    const again = await makeExplainer(
      { llm, material: async () => material, imageGen: imageGen!, outDir },
      { courseId: 'demo', chapter: 'ch5', chatId: 'c' },
    );
    expect(llm.calls).toHaveLength(1);
    expect(imageGen!.prompts).toHaveLength(1);
    expect(again.panels).toHaveLength(2);
  });

  it('degrades to a decorative panel when the budget is out or no generator exists', async () => {
    const a = await run({ budget: new BudgetGuard({ meters: { 'gemini.images': { total: 0 } } }) });
    expect(a.imageGen!.prompts).toHaveLength(0);
    expect(a.r.panels).toHaveLength(2);
    const b = await run({ imageGen: undefined });
    expect(b.r.panels).toHaveLength(2);
  });
});
