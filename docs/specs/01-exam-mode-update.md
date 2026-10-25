# 01: Exam Mode update (Picture It + Recap Radio)

Draft for approval. Build in the order set by `00-OVERVIEW.md` (step 3, Experience).
Skill: `/Users/vaibav/Documents/projects/devhacks/exam-mode` (published as `clutch`, repo github.com/vaibav03/clutch).

## Summary
Two new things a student can text, both built from their own course material:
- **Picture It** (`explain ch5 visually`): an illustrated explainer (a short doc or a few images) that cites slides.
- **Recap Radio** (`podcast ch5`): a short two-host audio episode, with more airtime for the student's weak topics and quiz breaks.

Why it matters: the gallery is voted on by students, and pictures and audio show well in a 30-second demo video.
For judges, it adds media output without breaking the Skill's main rule: everything is grounded in the student's
material and cited, and factual diagrams are never made up by an image model.

Same rules, separate stores: Exam Mode's Python `quiz.py` and the village quiz engine (spec 03) both use the same Leitner box rules. They do not sync with each other.

## Scope
- Change only `SKILL.md` (two new phases, plus a few lines in the failure list), `README.md` (two feature-table rows) and `evals/evals.json` (two evals).
- No new scripts. The existing `search.py` and `quiz.py readiness`/`next`/`record` supply everything.
- Out of scope: squad episodes, persona voices and Step Diff pictures (those belong to specs 03 and 05).

## Key design
- **Accuracy rule:** labels, numbers and formulas come from the real slide figure, or from a diagram Cubbie draws as
  HTML/SVG or Mermaid. Generated art is only for decoration, such as a cover image.
- **Personal cut:** Cubbie runs `quiz.py readiness` and gives roughly 60% of the episode to the red and yellow topics.
- **Quiz breaks:** the episode stops 2 or 3 times with "pause and answer". The student replies by voice note or text.
  Cubbie grades the answer and records it with `quiz.py record`, using the ids from `quiz.py next`.
- **Fallbacks, if Cubbie can't make images or audio (see Verification):** for Picture It, send a PDF/HTML explainer
  with the drawn diagrams and the slide figures. For Recap Radio, Cubbie calls the student (a documented ability) and
  reads the recap, then sends the quiz-break questions by text.

## Proposed SKILL.md additions
```diff
@@ description (frontmatter)
- ...asks for a practice quiz, or needs an exam wake-up call.
+ ...asks for a practice quiz, wants a topic explained visually or as a short podcast, or needs an exam wake-up call.
@@ after "### Phase 5", add:
+### Picture It: illustrated explainer
+Use when the student asks to see a topic or chapter explained visually ("explain ch5 visually").
+1. Run `python3 scripts/search.py --course <COURSE> --query "<topic>"` and read the matching slides.
+2. Make a short illustrated explainer of 3 to 6 panels. Each panel has one idea, one picture, one line of text and its source ("slide 14").
+3. For anything factual (labels, numbers, formulas, structures), reuse the real figure from the slides, or draw it
+   yourself as a clean diagram (HTML/SVG or Mermaid). Never let a generated image carry facts. Decorative art is fine.
+4. Send the images in the chat, or as one PDF if there are more than 4, with a one-line summary. If you can't make
+   images, send a PDF of the drawn diagrams and the slide figures instead.
+### Recap Radio: concept podcast
+Use when the student asks for a podcast, audio recap or something to listen to ("podcast ch5").
+1. Run `search.py` for the topic and `quiz.py readiness --course <COURSE>`. Give the weak (red/yellow) topics most of the airtime.
+2. Write a 3-to-5-minute script for two hosts: a host who explains, citing slides, and a skeptic who asks the naive "why".
+   Add 2 or 3 quiz breaks ("pause and answer: ..."), each written from a chunk returned by `quiz.py next`.
+3. Turn it into audio with two different voices and send it, with a one-line summary.
+4. When the student answers a quiz break, grade it and run `quiz.py record` with that chunk's id.
+5. If you can't make audio, offer a phone call where you read the recap (only after their yes), then send the quiz breaks by text.
@@ When something fails
+- Can't make images or audio: use the PDF or phone-call fallback above, and never skip the citations.
```

## Sample exchanges
> **Student:** explain ch5 visually
> **Cubbie:** Here's chapter 5 in 4 pictures, all from your slides. [img 1: glycolysis, the slide 12 figure] [img 2: Krebs cycle, drawn diagram, slide 14] ...
> One-line take: glucose to pyruvate to the Krebs cycle to ATP. Want a quiz on it?

> **Student:** podcast ch5
> **Cubbie:** Your 4-minute ch5 episode. Extra time on the electron transport chain, your red topic. [audio]
> There are 2 quiz breaks inside. Voice-note me your answers.

## Verification (do this first)
1. Text your Cubbie: "make an image of a cell diagram and send it here". Check that an image arrives in iMessage.
2. Text: "make a 20-second audio clip of two voices talking about mitosis and send it". Check that an audio file arrives.
3. Both arrive: ship as written. Either one fails: ship it with the fallback wording as the main path (decision 1).

## Updating the gallery entry
From `/Users/vaibav/Documents/projects/devhacks/cubbie-hackathon-kit/skills/cubbie-hackathon`:
`python3 scripts/hackathon.py mine` (to see the current entry), then
`python3 scripts/hackathon.py submit --track skills --pitch "<new pitch, 140 characters or fewer>"` (preview only) and, after your yes, the same command with `--yes`.
Change only the pitch, plus `--post` if a new demo clip is posted. The repo stays the same: push to it and the Skill updates.
Example pitch: "Your slides become an exam coach in iMessage: quizzes, illustrated explainers, a personal podcast and a wake-up call."

## Acceptance checks
- `validate_cubbie_skill.py .` passes, and the existing `--sample` commands still run.
- On a real Cubbie: `explain ch5 visually` returns pictures or a PDF in which every factual panel cites a slide.
- On a real Cubbie: `podcast ch5` returns audio (or offers the call), puts the weak topic first, and a quiz-break answer is recorded.
- Two new evals are added (one for each feature) and check citations and the fallback.

## Risks
- Image or audio generation is undocumented and may be missing or slow. Mitigation: run the verification first and keep the fallback wording in the Skill.
- An image model invents a label. Mitigation: the accuracy rule, plus code-drawn diagrams.
- The audio file is long or large. Mitigation: cap episodes at 5 minutes.

## Decisions for you
1. **If the verification fails:** (a) ship with the fallbacks, or (b) drop the feature that failed. **Recommend (a).**
2. **Diagram method:** (a) Cubbie draws HTML/SVG or Mermaid with no installs, or (b) add matplotlib to the venv plus a script. **Recommend (a).**
3. **Episode length:** (a) 3–5 minutes, or (b) "Last Mile", sized to the walk to the exam. **Recommend (a) now, (b) later.**
4. **Gallery update:** (a) pitch only, or (b) pitch plus a new demo post showing both features, added with `posts --add URL`. **Recommend (a) first, then (b).**
5. **Who builds it:** (a) one build agent edits the 3 files and you test on your phone, or (b) you edit by hand. **Recommend (a).**
