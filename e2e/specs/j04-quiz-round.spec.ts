import { actor, api, expect, shot, test } from '../lib/helpers';
import { GROUP, botCount, history, needChat, openChat, say, waitBot } from '../lib/chat';

const J = 'j4-quiz';
const BANNED = /\b(score|scores|scored|xp|streak|streaks|bet|bets|betting|points?|leaderboard|rank(ed|ing)?|level up)\b/i;

test('J4 quiz round in group chat: card, private plain feedback, no gamification words', async ({ browser }) => {
  await needChat();
  const ana = await actor(browser, 's_ana');
  const ben = await actor(browser, 's_ben');
  await openChat(ana, GROUP);
  await openChat(ben, GROUP);
  const before = await botCount(ben.token, 'dm:s_ben');
  await say(ana.page, '@cubbie quiz me on chapter 6');
  const choice = ben.page.getByTestId('chat-quiz-choice-A').first();
  await expect(choice, 'J4: a quiz card with choice A should appear for Ben in the group').toBeVisible({ timeout: 40_000 });
  const card = ben.page.getByTestId('chat-quiz-card').first();
  const cardText = await card.innerText();
  expect(cardText, 'J4: quiz card must not use score/XP/streak/bet words').not.toMatch(BANNED);
  await shot(ben.page, J, '01-quiz-card');
  await choice.click();
  const fb = await waitBot(ben.token, 'dm:s_ben', () => true, 30_000);
  expect(fb, 'J4: Ben should get private feedback in his DM').toBeDefined();
  expect(await botCount(ben.token, 'dm:s_ben')).toBeGreaterThan(before);
  expect(fb!.text.length, 'J4: feedback should be plain text, non-empty').toBeGreaterThan(5);
  expect(fb!.text, 'J4: feedback must not use score/XP/streak/bet words').not.toMatch(BANNED);
  await ben.page.waitForTimeout(800);
  await shot(ben.page, J, '02-after-answer');
  // nobody else sees Ben's feedback
  const anaDm = (await history(ana.token, 'dm:s_ana')).map((m) => m.text).join('\n');
  expect(anaDm, "J4: Ana's DM must not contain Ben's feedback").not.toContain(fb!.text);
  // every bot message either student can read (quiz cards, feedback) is clean
  for (const a of [ana, ben]) {
    const texts = [...(await history(a.token, GROUP)), ...(await history(a.token, `dm:${a.id}`))]
      .filter((m) => m.sender.kind === 'persona')
      .map((m) => `${m.text} ${JSON.stringify(m.card ?? '')}`);
    expect.soft(texts.filter((t) => BANNED.test(t)), `E2E-quiz-gamified: ${a.id} bot messages contain a score/XP/streak/bet word`).toEqual([]);
  }
  // hub quiz route reachable for the card's quiz id (from the squad stream is not exposed in chat; just check 404 shape)
  const r = await api(ben.token, '/v1/quiz/does_not_exist');
  expect(r.status, 'J4: unknown quiz id should 404, not 5xx').toBe(404);
  note();
  await ana.ctx.close();
  await ben.ctx.close();
});
function note() {
  test.info().annotations.push({ type: 'note', description: 'village classroom quiz overlay (canvas) not driven: happy-path scope; chat quiz only' });
}
