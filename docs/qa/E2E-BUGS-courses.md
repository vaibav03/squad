# E2E defects: course library (J13a-f)

Run: demo stack (hub 8873, web 5273), spec `e2e/specs/j13-courses.spec.ts`. Screenshots: `docs/design/shots/courses/`.
Scope: happy paths only. All 7 tests pass; the defects below were found while reading the screens and DOM.

| ID | Sev | Where | Defect | Evidence |
|---|---|---|---|---|
| E2E-C01 | medium | Source sheet, `.sq-source__tag` (`packages/web/src/components/source-viewer`) | The file name under the sheet title is set in the pixel font (Jersey 10) at 8px. A file name is data, not a label, and DESIGN.md section 2 allows the pixel font only for labels and never for paragraphs. At 8px it is barely legible. | Open a chapter with "Open source" on `/squad/courses/demo`. Shot: `docs/design/shots/courses/j13d-source-viewer-1280x800.png` |
| E2E-C02 | medium | Courses UI to source viewer | No surface on the courses page opens a citation with a quote, so the quote highlight (`mark.sq-source__mark`), "Verified quote" and "Copy quote" paths are not reachable by a student. `CitationChip` and `openSource({quote})` have no caller outside the module. "Open source" passes only file and page. J13d therefore checks the quote path at the API (`/v1/library/source?quote=`) and the chapter source at the UI. | `grep` for `CitationChip` and `openSource(` in `packages/web/src` |
| E2E-C03 | low | Upload, `/squad/courses/:id` at 1280x800 | The "Created ..." toast sits over the first file row while it ingests and covers its status chip. | Shot: `docs/design/shots/courses/j13b-ingesting-1280x800.png` |
| E2E-C04 | low | Test hygiene (`e2e/specs/j13-courses.spec.ts`) | If a run fails before J13e, the uploaded "E2E Stats ..." course stays in the shared hub DB and shows in the library on later runs. Cleaned by hand after the first failed run. The spec does not clean up in `afterAll`. | Seen at 390x844 in `docs/design/shots/courses/j13-library-mobile-390x844.png` (stale card above the sample) |
| E2E-C05 | info | Harness | `pnpm e2e` reporter labels the J13 rows "Resilience" in `docs/qa/E2E-REPORT.md`. That is the acceptance J13 (resilience). This branch's course journeys are J13a-f and were not merged into that report. | `e2e/lib/report-reporter.ts` |

## Checked and fine
- `/squad/courses` shows the OpenStax sample with "Introductory Statistics 2e, OpenStax, CC BY 4.0 (openstax.org)" and 4 chapters.
- Upload through the dropzone (`file-input`) returns 202, the status goes to `ready` within 90 s, and chapters appear.
- Chapter rename persists on the hub (`GET /v1/library/courses/:id`).
- Delete sheet: the button stays disabled until the title is typed. Confirm removes the course, and the GET returns 404.
- Second student GET of a private course returns 404 `not_found`, and it is absent from their list.
- Sample detail: "Delete course" is disabled with the reason shown.
- 390x844: no horizontal page scroll on the library.
