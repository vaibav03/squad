import { actor, expect, note, shot, test } from '../lib/helpers';
import { GROUP, makePng, needChat, openChat, say, sendApi, waitBot, botCount, history, isBot } from '../lib/chat';
import { HUB } from '../lib/env';

const J = 'j7-modes';
const NO_GRADE = /\b\d{1,3}\s*\/\s*(10|100)\b|\b[ABCDF][+-]?\s+grade\b|\b\d{2,3}\s?%/i;

test.describe('J7 study modes (demo model)', () => {
  test('J7 Feynman: the freshman asks me to explain, then reacts', async ({ browser }) => {
    await needChat();
    const a = await actor(browser, 's_ben');
    await openChat(a, GROUP);
    await say(a.page, '@cubbie feynman ch3 z-scores');
    expect(await waitBot(a.token, GROUP, (m) => /in your own words/i.test(m.text), 60_000)).toBeTruthy();
    await shot(a.page, J, 'feynman');
    await a.ctx.close();
  });

  test("J7 Devil's TA plants a mistake and asks to find it", async ({ browser }) => {
    await needChat();
    const a = await actor(browser, 's_ben');
    await openChat(a, GROUP);
    await say(a.page, "@cubbie devil's TA ch2");
    const m = await waitBot(a.token, GROUP, (x) => /Devil's TA/i.test(x.text), 60_000);
    expect(m).toBeTruthy();
    expect(m!.text).toMatch(/wrong|mistake/i);
    await shot(a.page, J, 'devils-ta');
    await a.ctx.close();
  });

  test('J7 Debate: both sides argued, I get a private vote prompt', async ({ browser }) => {
    await needChat();
    const a = await actor(browser, 's_ben');
    await openChat(a, GROUP);
    await say(a.page, '@cubbie debate should exams be open book?');
    const m = await waitBot(a.token, GROUP, (x) => /Debate on the stage/i.test(x.text), 60_000);
    expect(m, 'debate message').toBeTruthy();
    expect(m!.text).toMatch(/For/);
    expect(m!.text).toMatch(/Against/);
    const vote = await waitBot(a.token, 'dm:s_ben', (x) => x.card?.type === 'confirm' && /Debate/.test(x.text), 30_000);
    expect(vote, 'private vote card in the DM').toBeTruthy();
    await sendApi(a.token, 'dm:s_ben', '1'); // answer it so it cannot swallow later DMs
    await shot(a.page, J, 'debate');
    await a.ctx.close();
  });

  test('J7 Exam Oracle ranks chapters and gives a mock question each', async ({ browser }) => {
    await needChat();
    const a = await actor(browser, 's_chi');
    await openChat(a, GROUP);
    await say(a.page, '@cubbie exam oracle');
    const m = await waitBot(a.token, GROUP, (x) => /Exam Oracle/i.test(x.text), 60_000);
    expect(m).toBeTruthy();
    expect(m!.text).toMatch(/Ranked chapters/);
    expect(m!.text).toMatch(/Q:/);
    await shot(a.page, J, 'exam-oracle');
    await a.ctx.close();
  });

  test('J7 Rubric: criterion-by-criterion feedback, no grade numbers', async ({ browser }) => {
    await needChat();
    const a = await actor(browser, 's_chi');
    await openChat(a, GROUP);
    const before = await botCount(a.token, GROUP);
    await sendApi(a.token, GROUP, '@cubbie rubric check rubric:\nClarity: explains in simple words\nAccuracy: states the facts correctly\nGaps: covers the key ideas\nAnswer: the mean is the sum of the values divided by their count, and the median is the middle value.');
    const m = await waitBot(a.token, GROUP, (x) => /Clarity/i.test(x.text) && /Accuracy/i.test(x.text), 60_000);
    note(`bot messages before ${before}; rubric reply: ${m ? m.text.slice(0, 160) : 'none (see E2E-RUBRIC)'}`);
    expect.soft(m, 'E2E-007: a pasted rubric plus an answer should produce Clarity/Accuracy/Gaps feedback; the bot only says it cannot find a rubric').toBeTruthy();
    if (m) expect(m.text).not.toMatch(NO_GRADE);
    await shot(a.page, J, 'rubric');
    await a.ctx.close();
  });

  test('J7 Step Diff: two uploaded images show where they split, never a verdict', async ({ browser }) => {
    await needChat();
    const a = await actor(browser, 's_dev');
    await openChat(a, GROUP);
    await say(a.page, '@cubbie diff');
    expect(await waitBot(a.token, GROUP, () => true, 30_000)).toBeTruthy();
    const ids: string[] = [];
    for (const shade of [180, 90]) {
      const fd = new FormData();
      fd.append('file', new Blob([makePng(64, 64, shade)], { type: 'image/png' }), `solution-${shade}.png`);
      const r = await fetch(`${HUB}/v1/chat/upload`, { method: 'POST', headers: { authorization: `Bearer ${a.token}` }, body: fd });
      expect(r.status).toBe(200);
      ids.push(((await r.json()) as { attachment: { id: string } }).attachment.id);
    }
    const mine = (await history(a.token, 'dm:s_dev')).filter(isBot).length;
    await sendApi(a.token, 'dm:s_dev', 'here are the two solutions', ids.map((id) => ({ id })));
    const m = await waitBot(a.token, 'dm:s_dev', (x) => /step/i.test(x.text), 60_000);
    note(`bot DMs before ${mine}; step diff reply: ${m ? m.text.slice(0, 200) : 'none'}`);
    expect.soft(m, 'E2E-008: Step Diff should answer in the DM with the step where the solutions split').toBeTruthy();
    if (m) expect(m.text).not.toMatch(/\b(correct|incorrect|wrong answer|winner|you are right|better solution)\b/i);
    await shot(a.page, J, 'step-diff');
    await a.ctx.close();
  });

  test('J7 Oral exam: the Hut opens and states the typed fallback and feedback-only policy', async ({ browser }) => {
    await needChat();
    const a = await actor(browser, 's_ana');
    await openChat(a, GROUP);
    await say(a.page, '@cubbie oral exam');
    const m = await waitBot(a.token, GROUP, (x) => /Oral Exam Hut/i.test(x.text), 60_000);
    expect(m).toBeTruthy();
    expect(m!.text).toMatch(/type if you have no microphone/i);
    expect(m!.text).toMatch(/No grades/i);
    await shot(a.page, J, 'oral-exam');
    await a.ctx.close();
  });
});
