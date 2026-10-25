# @squad/brain

Study brain (spec 03). This workstream (`brain-answers`) owns the answers half: ingest, Dean, chapter experts, citation checker, call captions, and the doubt, behind and hwpolicy skills. API: `docs/brain-api.md`.

## Run and test
```
pnpm --filter @squad/brain typecheck
pnpm --filter @squad/brain test          # unit tests (src/) then golden-set evals (evals/), FakeLlm only
pnpm test:smoke brain                     # end-to-end smoke over the fixture course
BRAIN_REAL_EVAL=1 pnpm --filter @squad/brain eval:real   # flagged real-key eval, hard cap BRAIN_EVAL_MAX_CALLS (default 14)
```
`eval:real` reads `GEMINI_API_KEY` from the repo-root `.env`; without the flag it prints "Skipped". It never runs in CI.

## How grounding works
1. Ingest: `unpdf` per-page text (Gemini PDF/vision only for pages with almost no text) into `pages`, `chapters` (one file = one chapter, or `splitByHeadings`), 3-line summaries from the `fast` tier with an extractive fallback.
2. Dean: `fast` tier picks 1 or 2 chapters or none; on any failure BM25 over the pages (`via: 'bm25'`).
3. Expert: the chapter block (with `[file p.N]` markers) is cached once with `Llm.createCache` (skipped for tiny chapters or if the cache call fails) and the `main` tier returns `{answer, claims[{text,file,page,quote}]}`.
4. Citation check in code (`citations/check.ts`): a claim survives only if its (file, page) exists and its quote, normalised for case/punctuation/hyphenation, is on that page. Struck claims are never shown; no surviving claim means `Not in the materials. Ask the TA.`
5. Captions: sentence-level; every factual sentence needs a verified cite, else it is dropped; if nothing survives a single "isn't in the materials" caption is emitted. Transcript rows go to `call_transcripts`.

Prompts are versioned files in `*/prompts/*.md` (first line `<!-- prompt: name vN -->`).

## Fixture and evals
`fixtures/openstax/`: 4 chapters excerpted from OpenStax Introductory Statistics 2e (CC BY 4.0, attribution in `fixtures/README.md`), `syllabus.txt` (synthetic, with a homework/AI policy), `golden.json` (16 answerable questions with verbatim quote and page, 8 unanswerable). `evals/` runs them with `OracleLlm`, a scripted stand-in that behaves honestly or plants wrong pages, fabricated quotes and cross-chapter quotes; the checker must reject all of them.

## Env
`GEMINI_API_KEY` (real runs only). Events go through `postEvent` (`HUB_BASE_URL`, `INTERNAL_EVENTS_SECRET`).
