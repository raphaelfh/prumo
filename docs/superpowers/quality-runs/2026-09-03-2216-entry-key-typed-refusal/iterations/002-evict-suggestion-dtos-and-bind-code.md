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

## LOOPBACK 1

Judge verdict on `90597f82`: DOES_NOT_RESOLVE — the no-run-row assertion was
vacuous (the helper it used never creates a run). Fix in `b23419c3`: the refusal
now drives `ModelExtractionService.extract` for real (article text stubbed,
pinned tree empty), asserting zero run rows after the service's raise and
after the route-mirroring rollback, with a positive control proving the same
kickoff flushes a run row when the container is keyed.

## GATE

See `../telemetry.jsonl` (phase VERIFY) and `../summary.md`: `scripts/verify_all.sh` after all three iterations.

## JUDGE

Recorded in `../summary.md` once the verdict is in.

## Reflexion (iteration 002)
**What could still go wrong:** The recurrence guard is warn-tier, so a reintroduced `SuggestionResponse` would be reported, not blocked; and vulture cannot see dead Pydantic schemas, so the next dead DTO waits for a scan rather than a gate.
**What I'd do differently next time:** Promote `suggestion_dtos` to the hard tier once the current five warn hits (the enum names in migration tests) are baselined, and consider a knip-like "unreferenced schema class" fitness rule for `app/schemas`.
