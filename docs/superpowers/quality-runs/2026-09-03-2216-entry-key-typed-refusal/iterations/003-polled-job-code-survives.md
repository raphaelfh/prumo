---
status: draft
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Iteration 003 — polled job failures keep their classified code

## FINDINGS CLOSED

- layered-arch:f_3 (0.7) / legacy-spotter:f_8 (0.65, dropped but same mechanism) pollUntilDone flattened the job's errorCode → it now returns an APIError carrying the code, forwarded at both wrap sites.
- legacy-spotter:f_7 (0.9) 'Unknown error' literal in the service → `common.errors_unknownError`.
- test-gaps:f_1 (0.9) wrap sites untested → `extractModels` rejects with the mocked ApiError and the thrown APIError carries the code; a failed poll carries its code too.

## PLAN

Files: services/sectionExtractionService.ts (+ its test). Failing tests first: the two new service tests. Recurrence guard: those tests. LOC ≈ 60.

## DIFF

Commit `3c289b73` on `claude/entry-key-typed-refusal` (`git show 3c289b73 --stat`).

## GATE

See `../telemetry.jsonl` (phase VERIFY) and `../summary.md`: `scripts/verify_all.sh` after all three iterations.

## JUDGE

Recorded in `../summary.md` once the verdict is in.

## Reflexion (iteration 003)
**What could still go wrong:** Batch runs still swallow per-section failures into text, so a keyless group inside a batch shows the generic copy; this is the documented boundary, not a regression, but it is where the next confusion will come from.
**What I'd do differently next time:** Nothing for this slice; the batch taxonomy is the entry-group trees spec's B1 concern.
