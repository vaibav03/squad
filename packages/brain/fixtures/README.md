# Brain fixtures

## openstax/ (course material)

Excerpted pages of **Introductory Statistics 2e** by Barbara Illowsky, Susan Dean and OpenStax contributors,
published by OpenStax, Rice University. Licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/).
Source: https://openstax.org/details/books/introductory-statistics-2e (PDF release "Introductory Statistics 2e - WEB").
Access for free at openstax.org.

Modifications: we extracted contiguous page ranges of the PDF into four chapter files (page counts and
ranges below), unchanged otherwise. No endorsement by OpenStax or Rice University is implied.

| Chapter id | File                            | Source PDF pages | Content                                                                                |
| ---------- | ------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| ch2        | ch2-descriptive-statistics.pdf  | 111-122          | 2.5 center of the data, 2.6 skewness, 2.7 spread                                       |
| ch3        | ch3-probability-topics.pdf      | 179-190          | Chapter 3 introduction, 3.1 terminology, 3.2 independent and mutually exclusive events |
| ch6        | ch6-the-normal-distribution.pdf | 347-358          | Chapter 6 introduction, 6.1 standard normal, empirical rule, 6.2 start                 |
| ch12       | ch12-linear-regression.pdf      | 629-642          | Chapter 12 introduction through 12.4, regression equation, correlation                 |

Page numbers in citations (`[ch12-linear-regression.pdf p.7]`) are the **page index inside the excerpt file**, 1-based, not the printed book page.

## syllabus.txt

Synthetic syllabus written for the demo (not OpenStax). Its "Homework policy" section feeds `hwPolicySkill`.

## course.json

Chapter ids, titles, files, and hand-written 2-line router summaries (used when no Llm is available at ingest).

## golden.json

Golden evaluation set: `answerable` questions with a verbatim quote, file and page (verified by a test against the
extracted PDF text), and `unanswerable` questions that the brain must refuse with "not in the materials".
