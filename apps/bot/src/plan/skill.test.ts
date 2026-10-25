// The shared study plan chat skill against a fake PlanPort: the group is never left on "thinking".
import { describe, expect, it } from 'vitest';
import type { Ctx, InboundMessage, OutboundMessage } from '@squad/core';
import { createSharedPlanSkill } from './skill';
import type { PlanPort, PlanSayOut } from './port';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const msg = (text: string, o: Partial<InboundMessage> = {}): InboundMessage => ({
  chatId: 'group:sq1',
  isGroup: true,
  from: 's_ana',
  text,
  attachments: [],
  mentionsBot: true,
  ts: NOW,
  ...o,
});
const ok = (text: string): PlanSayOut => ({ ok: true, text });
function setup(over: Partial<PlanPort> = {}, timeoutMs = 50) {
  const sent: OutboundMessage[] = [];
  const dms: { to: string; text: string }[] = [];
  const calls: string[] = [];
  const port: PlanPort = {
    propose: async (_s, _q, o) => {
      calls.push(`propose:${o.examDate ?? ''}`);
      return { ...ok('Study plan (proposed)'), privateText: 'Your part: ch1' };
    },
    reply: async (_s, _q, r) => {
      calls.push(`reply:${r.kind}`);
      return ok(`reply ${r.kind}`);
    },
    done: async (_s, _q, ref) => {
      calls.push(`done:${ref}`);
      return ok(`done ${ref}`);
    },
    state: () => ({ proposed: true, pendingMe: true, active: false, ownsOpen: () => true }),
    ...over,
  };
  const skill = createSharedPlanSkill({ plans: port, now: () => NOW, timeoutMs });
  const ctx = {
    send: async (o: OutboundMessage) => void sent.push(o),
    dm: async (to: string, text: string) => void dms.push({ to, text }),
    db: { prepare: () => ({ get: () => undefined }) },
  } as unknown as Ctx;
  return { skill, ctx, sent, dms, calls };
}

describe('shared plan skill', () => {
  it('claims a group study plan request and posts progress, then the plan', async () => {
    const t = setup();
    const m = msg('@cubbie study plan for the exam on Nov 4');
    expect(await t.skill.match(m, t.ctx)).toBeGreaterThan(0.9);
    const out = await t.skill.handle(m, t.ctx);
    expect(t.sent[0]!.text).toMatch(/On it/);
    expect(out[0]!.text).toContain('proposed');
    expect(t.calls).toEqual(['propose:2026-11-04']);
    expect(t.dms).toEqual([{ to: 's_ana', text: 'Your part: ch1' }]);
    expect(out.every((o) => o.chatId === 'group:sq1')).toBe(true);
  });

  it('a hanging plan service ends in a clear message, not silence', async () => {
    const t = setup({ propose: () => new Promise(() => {}) });
    const out = await t.skill.handle(msg('@cubbie study plan for the exam on Nov 4'), t.ctx);
    expect(out[0]!.text).toMatch(/longer than it should/);
  });

  it('a throwing plan service ends in a clear message', async () => {
    const t = setup({
      propose: async () => {
        throw new Error('boom');
      },
    });
    const out = await t.skill.handle(msg('@cubbie study plan'), t.ctx);
    expect(out[0]!.text).toMatch(/Something went wrong/);
    expect(out[0]!.text).not.toMatch(/boom/);
  });

  it('an unreadable date asks again and never calls the service', async () => {
    const t = setup();
    const out = await t.skill.handle(msg('@cubbie study plan for the exam on blorp 99'), t.ctx);
    expect(out[0]!.text).toMatch(/could not read/);
    expect(t.calls).toEqual([]);
  });

  it('numbered replies and done reports route to the port', async () => {
    const t = setup();
    expect(await t.skill.match(msg('plan 1', { mentionsBot: false }), t.ctx)).toBeGreaterThan(0.9);
    await t.skill.handle(msg('@cubbie plan 2'), t.ctx);
    await t.skill.handle(msg('@cubbie plan 3 ch6 to dev'), t.ctx);
    await t.skill.handle(msg('done ch6 review', { mentionsBot: false }), t.ctx);
    expect(t.calls).toEqual(['reply:decline', 'reply:edit', 'done:ch6 review']);
  });

  it('ignores plain chatter and unaddressed replies when nothing is waiting', async () => {
    const t = setup({
      state: () => ({ proposed: false, pendingMe: false, active: false, ownsOpen: () => false }),
    });
    expect(await t.skill.match(msg('anyone want pizza', { mentionsBot: false }), t.ctx)).toBe(0);
    expect(await t.skill.match(msg('plan 1', { mentionsBot: false }), t.ctx)).toBe(0);
  });

  it('in a DM it points to the squad chat instead of making a private plan', async () => {
    const t = setup();
    const out = await t.skill.handle(
      msg('study plan for the exam', { chatId: 'dm:s_ana', isGroup: false }),
      t.ctx,
    );
    expect(out[0]!.text).toMatch(/squad chat/);
  });
});
