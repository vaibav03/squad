import type { InboundMessage } from '@squad/core';
import type { DecideFn, Decision, PolicyConfig, SkillScore } from './types';

export const DEFAULT_POLICY: PolicyConfig = { threshold: 0.8, unpromptedCooldownMs: 120_000 };

export const clampScore = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

/** Best score; ties go to the earliest registered Skill (stable). */
function best(scores: SkillScore[]): SkillScore | undefined {
  let top: SkillScore | undefined;
  for (const s of scores) if (!top || clampScore(s.score) > clampScore(top.score)) top = s;
  return top;
}

/**
 * Pure speaking policy. Group: speak if mentioned, or if best >= threshold and no unprompted
 * message in the last cooldown window. DM: always run the top skill. Everything else is quiet.
 */
export const decide: DecideFn = (msg: InboundMessage, scores, state, cfg = {}) => {
  const c = { ...DEFAULT_POLICY, ...cfg };
  const clean = scores.map((s) => ({ ...s, score: clampScore(s.score) }));
  const top = best(clean);
  const base = {
    scores: clean,
    mentioned: msg.mentionsBot || !msg.isGroup,
    best: top ? { skill: top.skill, score: top.score } : undefined,
  };
  const quiet = (reason: Decision['reason']): Decision => ({
    ...base,
    action: 'quiet',
    reason,
    unprompted: false,
  });
  if (!top) return quiet('no_skills');
  if (!msg.isGroup) {
    return { ...base, action: 'run', reason: 'dm', skill: top.skill, unprompted: false };
  }
  if (msg.mentionsBot) {
    return { ...base, action: 'run', reason: 'mentioned', skill: top.skill, unprompted: false };
  }
  if (top.score < c.threshold) return quiet('below_threshold');
  const last = state.lastUnpromptedAt;
  if (last !== undefined && state.now - last < c.unpromptedCooldownMs) return quiet('cooldown');
  return { ...base, action: 'run', reason: 'confident', skill: top.skill, unprompted: true };
};
