import { describe, expect, it } from 'vitest';
import {
  FIXTURE_LABEL,
  PROVENANCE_LABELS,
  agoWords,
  composeProvenance,
  hasCitationMarkers,
  imessageIndicator,
  provenanceLine,
  planBadge,
  type ChatCitation,
  type ImessageStatus,
} from './index';

const pdf = (page = 4): ChatCitation => ({ file: 'ch6.pdf', page, label: `ch6.pdf p.${page}` });
const src: ChatCitation = {
  file: 'Syllabus',
  page: 1,
  label: 'Syllabus',
  source: { kind: 'canvas_file', id: 'src_1', title: 'Syllabus' },
};
const base = { text: 'An answer.', mode: 'live' as const, verify: () => true };

describe('composeProvenance', () => {
  it('verified citations make a grounded reply with a count', () => {
    const r = composeProvenance({ ...base, citations: [pdf(4), pdf(4), src] });
    expect(r.provenance).toMatchObject({ kind: 'grounded', sources: 2, label: '2 sources' });
    expect(r.citations).toHaveLength(2);
  });
  it('one source reads singular', () => {
    expect(composeProvenance({ ...base, citations: [pdf()] }).provenance.label).toBe('1 source');
  });
  it('citations that do not verify are dropped and the reply is downgraded, never grounded without chips', () => {
    const r = composeProvenance({ ...base, citations: [pdf()], verify: () => false });
    expect(r.citations).toEqual([]);
    expect(r.provenance).toMatchObject({ kind: 'ungrounded', label: PROVENANCE_LABELS.ungrounded });
  });
  it('markers in the text without any citation are also downgraded', () => {
    const r = composeProvenance({ ...base, text: 'It is 68% [ch6.pdf p.4].', citations: [] });
    expect(r.provenance.kind).toBe('ungrounded');
  });
  it('a partly verified reply keeps only the verified chips', () => {
    const r = composeProvenance({
      ...base,
      citations: [pdf(4), pdf(9)],
      verify: (c) => c.page === 4,
    });
    expect(r.citations.map((c) => c.page)).toEqual([4]);
    expect(r.provenance.kind).toBe('grounded');
  });
  it('no citations: explicit labels per situation', () => {
    expect(composeProvenance({ ...base, citations: [] }).provenance).toMatchObject({
      kind: 'no_sources',
      label: 'No course sources used',
    });
    expect(composeProvenance({ ...base, citations: [], mode: 'demo' }).provenance).toMatchObject({
      kind: 'demo',
      label: 'Demo: scripted, not Gemini',
    });
    expect(
      composeProvenance({ ...base, citations: [], hint: { kind: 'sample' } }).provenance,
    ).toMatchObject({ kind: 'sample', label: 'Not grounded: sample data' });
    expect(
      composeProvenance({ ...base, citations: [], hint: { label: 'Quiz question from ch6' } })
        .provenance.label,
    ).toBe('Quiz question from ch6');
  });
  it('carries mode and the channel', () => {
    const p = composeProvenance({ ...base, citations: [], mode: 'degraded', via: 'imessage' })
      .provenance;
    expect(p).toMatchObject({ mode: 'degraded', via: 'imessage' });
  });
  it('every composed provenance has chips or a non-empty label', () => {
    for (const citations of [[], [pdf()], [src]])
      for (const verify of [() => true, () => false])
        for (const mode of ['live', 'degraded', 'demo'] as const)
          for (const text of ['x', 'see [a.pdf p.1]']) {
            const r = composeProvenance({ text, citations, verify, mode });
            expect(r.citations.length > 0 || r.provenance.label.length > 0).toBe(true);
          }
  });
});

describe('plain text provenance', () => {
  it('detects both marker spellings', () => {
    expect(hasCitationMarkers('x (ch6.pdf p.4)')).toBe(true);
    expect(hasCitationMarkers('x [ch6.pdf p.4]')).toBe(true);
    expect(hasCitationMarkers('see p.4 of the book')).toBe(false);
  });
  it('lists the sources or states the label', () => {
    const g = composeProvenance({ ...base, citations: [pdf()] });
    expect(provenanceLine(g.provenance, g.citations)).toBe('Sources: [ch6.pdf p.4]');
    const n = composeProvenance({ ...base, citations: [] });
    expect(provenanceLine(n.provenance)).toBe('No course sources used');
    expect(provenanceLine(undefined)).toBeUndefined();
  });
});

describe('planBadge', () => {
  it('labels agent and fallback plans honestly', () => {
    expect(planBadge({ mode: 'live', source: 'planner', note: '', kind: 'agent' })).toMatchObject({
      label: 'Live',
      kindLabel: 'Planner agent',
      fallback: false,
    });
    expect(
      planBadge({ mode: 'degraded', source: 'x', note: '', kind: 'fallback', reason: 'quota' }),
    ).toMatchObject({ label: 'Degraded: quota', kindLabel: 'Fallback sample plan', fallback: true });
    expect(planBadge({ mode: 'demo', source: 'x', note: '' })).toMatchObject({
      label: 'Demo: sample data, scripted',
      kindLabel: 'Fallback sample plan',
    });
  });
});

describe('imessageIndicator', () => {
  const now = 1_000_000_000;
  const squad = { squadId: 'sq', name: 'Squad Demo', bound: 1, lastSyncAt: now - 3 * 60_000 };
  const on: ImessageStatus = { enabled: true, mode: 'live', transport: 'ok', queued: 2, squads: [squad] };
  const g = { kind: 'group' as const, squadId: 'sq' };
  it('DMs are web only', () => {
    expect(imessageIndicator(on, { kind: 'dm' }, now)).toMatchObject({
      state: 'web_only',
      label: 'Web only',
    });
  });
  it('off or unknown is not connected (setup) for a group', () => {
    expect(imessageIndicator({ enabled: false, mode: 'off', killSwitch: true }, g, now)).toMatchObject({
      state: 'not_connected',
      label: 'iMessage: not connected (setup)',
      setup: true,
    });
    expect(imessageIndicator(null, g, now).state).toBe('web_only');
  });
  it('running with no bound group is not connected', () => {
    expect(
      imessageIndicator({ ...on, squads: [{ ...squad, bound: 0, lastSyncAt: null }] }, g, now).state,
    ).toBe('not_connected');
  });
  it('dry run', () => {
    expect(imessageIndicator({ ...on, mode: 'dry_run', dryRun: true }, g, now).label).toBe(
      'iMessage: dry run',
    );
  });
  it('connected names the squad, the last sync and the queue', () => {
    expect(imessageIndicator(on, g, now).label).toBe(
      'iMessage: connected to Squad Demo, last sync 3 min ago, 2 queued',
    );
  });
  it('degraded gives the reason', () => {
    const r = imessageIndicator(
      { ...on, transport: 'degraded', degradedReason: 'the Messages watcher stopped' },
      g,
      now,
    );
    expect(r).toMatchObject({
      state: 'degraded',
      label: 'iMessage: degraded: the Messages watcher stopped',
    });
  });
  it('a scripted transport never reads as a real connection', () => {
    const r = imessageIndicator({ ...on, mode: 'fixture', fixture: true }, g, now);
    expect(r.state).toBe('fixture');
    expect(r.label.startsWith(FIXTURE_LABEL)).toBe(true);
    expect(r.label).toContain('connected to Squad Demo');
  });
  it('ago words', () => {
    expect(agoWords(now - 5_000, now)).toBe('just now');
    expect(agoWords(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(agoWords(now - 3 * 86_400_000, now)).toBe('3 d ago');
  });
});

describe('mode follows the sources: simulated data is never Live', () => {
  const fx = (id: string): ChatCitation => ({
    ...src,
    source: { kind: 'canvas_assignment', id, title: id, provenance: 'fixture' },
  });
  const real = (id: string): ChatCitation => ({
    ...src,
    source: { kind: 'canvas_assignment', id, title: id, provenance: 'real' },
  });
  it('fixture-only: demo', () => {
    const p = composeProvenance({ ...base, citations: [fx('a'), fx('b')] }).provenance;
    expect(p).toMatchObject({ kind: 'grounded', mode: 'demo', sources: 2 });
    expect(p.label).toMatch(/demo data/);
  });
  it('live-only with a live model: live', () => {
    expect(composeProvenance({ ...base, citations: [real('a')] }).provenance).toMatchObject({ mode: 'live', label: '1 source' });
  });
  it('mixed: demo (one simulated source is enough)', () => {
    expect(composeProvenance({ ...base, citations: [real('a'), fx('b')] }).provenance.mode).toBe('demo');
  });
  it('live sources but a degraded model stay degraded; a demo model stays demo', () => {
    expect(composeProvenance({ ...base, mode: 'degraded', citations: [real('a')] }).provenance.mode).toBe('degraded');
    expect(composeProvenance({ ...base, mode: 'demo', citations: [real('a')] }).provenance.mode).toBe('demo');
  });
  it('no citations: mode is whatever the model is, no demo-data claim', () => {
    expect(composeProvenance({ ...base, citations: [] }).provenance).toMatchObject({ kind: 'no_sources', mode: 'live' });
  });
  it('the isFixture callback (hub store lookup) wins over the citation field', () => {
    expect(composeProvenance({ ...base, citations: [real('a')], isFixture: () => true }).provenance.mode).toBe('demo');
  });
});

describe('related-only sources are not grounding', () => {
  it('a related chip alone yields no_sources with zero count', () => {
    const rel: ChatCitation = { ...src, source: { ...src.source!, relation: 'related' } };
    const r = composeProvenance({ ...base, citations: [rel] });
    expect(r.provenance).toMatchObject({ kind: 'no_sources', sources: 0 });
    expect(r.citations).toHaveLength(1);
  });
});
