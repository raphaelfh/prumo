---
status: draft
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Iteration 001 — toast helper to the hooks layer, dead classes and literals out

## FINDINGS CLOSED

- layered-arch:f_1 (0.75) showJobErrorToast in lib imports sonner → moved to `hooks/extraction/helpers/showExtractionErrorToast.ts`; the pure mapper stays in lib as `extractionErrorToast`.
- layered-arch:f_4 / legacy-spotter:f_3 / concept-drift:f_14 (0.7–0.8) batch hook on the old ladder → routed through the helper; its two never-true branches deleted.
- legacy-spotter:f_1, f_2 (0.85) PDFNotFoundError / AuthenticationError never constructed → deleted; concept-drift:f_7 (0.8) resolved by that deletion.
- legacy-spotter:f_4 (0.85) JobErrorToast exported with no importer → interface now module-internal; legacy-spotter:f_5 (0.85) the mapper stays exported for its own unit test (deliberate; recorded in the docstring).
- concept-drift:f_9 (0.8) job-only naming → extractionErrorToast / showExtractionErrorToast.
- concept-drift:f_5 (0.85) hardcoded completion summary in useRunAIExtraction → copy key `fullAICompleteSummary` with placeholders.
- legacy-spotter:f_6 (0.95) 'Unknown error' literal in getErrorMessage → `common.errors_unknownError`.
- test-gaps:f_2 (0.8) helper without a direct test → `frontend/test/hooks/showExtractionErrorToast.test.ts` (both return values).

## PLAN

Files (≤5 production): lib/ai-extraction/extractionErrorToast.ts (renamed), hooks/extraction/helpers/showExtractionErrorToast.ts (new), the four hooks, lib/ai-extraction/errors.ts, lib/copy/extraction.ts. Failing tests first: the helper test (true/false paths) and the renamed mapper test; the run-AI hook test resolves the summary key for real. Recurrence guard: the helper test and knip (a lib module importing sonner is the layering hazard; the mapper's docstring states the split). LOC ≈ 180.

## DIFF

Commit `a65f30a5` on `claude/entry-key-typed-refusal` (`git show a65f30a5 --stat`).

## GATE

See `../telemetry.jsonl` (phase VERIFY) and `../summary.md`: `scripts/verify_all.sh` after all three iterations.

## JUDGE

Recorded in `../summary.md` once the verdict is in.
