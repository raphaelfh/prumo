---
status: draft
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Iteration 002 — evict the AI-suggestion-era DTOs, bind the refusal code to its enum

## FINDINGS CLOSED

- concept-drift:f_1, f_2, f_3 (0.85/0.85/0.75) FieldSuggestion, SuggestionResponse, ReviewSuggestionRequest unreferenced outside the re-export and their own tests → deleted with their tests and re-exports.
- concept-drift:f_6 (0.8) code literal not bound to the enum → `ExtractionErrorCode.MISSING_ENTITY_KEY.value`; the unit test asserts the equality.
- concept-drift:f_10 (0.75) async-only wording → classifier docstring and schema banner retitled.
- code-review Important 1: the real models-path raise had no no-run-row proof → `test_an_unkeyed_container_is_refused_not_duplicated` rolls back like the route and asserts the run count is unchanged.

## PLAN

Files: schemas/extraction.py, schemas/__init__.py, services/entity_key.py, services/extraction_errors.py, scripts/fitness/check_legacy_concepts.py (+ tests). Failing tests first: the enum-binding assertion and the no-run-row assertion. Recurrence guard: warn-tier pattern `suggestion_dtos` (blacklist entry 5) in check_legacy_concepts.py so the three names cannot return silently. LOC ≈ 120 (mostly deletions).

## DIFF

Commit `90597f82` on `claude/entry-key-typed-refusal` (`git show 90597f82 --stat`).

## GATE

See `../telemetry.jsonl` (phase VERIFY) and `../summary.md`: `scripts/verify_all.sh` after all three iterations.

## JUDGE

Recorded in `../summary.md` once the verdict is in.
