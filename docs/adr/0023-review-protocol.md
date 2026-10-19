---
status: accepted
last_reviewed: 2026-10-18
owner: '@raphaelfh'
adr_number: '0023'
---

# Eligibility and study design join the AI review question

> **Status:** Accepted · Date: 2026-10-18 · Deciders: @raphaelfh
> **Amends:** N/A · **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

Every AI extraction and quality-assessment call is prefixed with the project's
review question. Until now that question was rendered from the PICOTS slots
alone (population, index and comparator, outcomes, timing, setting), each with
its own include/exclude criteria.

A project also records its eligibility criteria (include/exclude) and the study
designs it accepts. Those were stored for the people configuring the review
but never reached the model, so criteria that do not belong to any one PICOTS
element (language, publication type, date range, design) were invisible to the
AI unless a manager retyped them into a slot.

Which parts of the stored protocol should feed prompts, and how?

## Decision Drivers

- Criteria the reviewers apply must be the criteria the model sees.
- A project that never filled eligibility or study design must keep a
  byte-identical prompt.
- One place controls what is sent: one length cap and one "send to AI" switch.
- What a manager previews is exactly what the model receives.
- Every AI decision stays traceable to the text it was given.

## Decision Outcome

- **PICOTS slot criteria stay per element.** A criterion about the population
  belongs to the population slot.
- **Project eligibility carries cross-cutting criteria**, such as language,
  publication type and dates.
- **Eligibility and study designs feed prompts after PICOTS.** The rendered
  review question is the unchanged PICOTS lines, then `Eligibility:` with
  `Include:` and/or `Exclude:` lines, then `Eligible study designs:`. Each part
  renders only when it has content.
- **One cap and one switch govern the whole block.** The existing 4,000
  character cap applies to the combined text, and turning off "send to AI"
  withholds all of it. The editor preview is rendered by the same function.
- **Notes do not feed prompts.** The `notes` on eligibility and study design
  are for the people configuring the review.
- **Other project fields do not feed prompts:** `review_keywords`,
  `search_strategy`, `condition_studied`, `review_rationale` and the free-text
  `review_context` column.
- **Runs keep the question they pinned.** A run pins the review question on its
  first AI call; editing eligibility or study design later changes new runs
  only.

Stored eligibility and study-design values are not migrated. The renderer reads
them tolerantly: a legacy shape or a non-string item contributes nothing.

## Consequences

- Good: criteria entered once on the project details reach every AI call.
- Good: projects without eligibility or study design see no prompt change.
- Neutral: projects that already filled eligibility or study design get a
  longer review question on new runs; runs that already made their first AI
  call keep theirs.
- Bad: the shared cap means a very long PICOTS can truncate the eligibility
  lines that follow it.

## Validation

Unit tests pin the rendered text byte for byte, including identical output for
absent and empty eligibility and design, fixed order, ignored notes and legacy
shapes, and the single cap. Integration tests show the editor preview carrying
the eligibility lines and going silent with the switch off, a new run's prompt
and provenance carrying them, and a run pinned before an edit keeping its text.
