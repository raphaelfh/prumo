---
status: draft
last_reviewed: 2026-09-04
owner: '@raphaelfh'
---

# Iteration 001 — retire the last 'model'-default comments; pin the fallback noun

## PLAN

Backlog rows closed here, all inside the slice's files, ≤ 300 LOC across the
two commits: concept-drift f_1–f_10 (eight stale comments/docstrings that
still described the deleted container default; the import-guidance rule
string that mis-stated where `entry_label` is allowed and also feeds the
template-import AI prompt; two inline role literals replaced by the shared
enum), layered-arch f_4 (the create schema's docstring now states that the
"repeating ⇒ noun" rule lives at the API boundary until the trees spec makes
the column NOT NULL), legacy f_1–f_2 (duplicates of concept-drift f_5/f_7),
test-gaps f_1, f_2, f_7, f_8, f_9, f_10.

Failing tests first: the two identification-prompt assertions
(`test_entry_group_extraction.py`, `test_model_extraction_service.py`) were
added against the already-shipped fallback line, so they are regression pins
rather than red-first TDD — recorded as such. No recurrence guard is needed
for a comment fix; the prompt pins are the guard for the noun fallback.

## DIFF

- `66862235` chore(quality-loop): retire the last 'model'-default comments;
  role enum over inline strings — `backend/app/models/extraction.py`,
  `schemas/template_portable.py`, `schemas/extraction_run.py`,
  `schemas/template_structure.py`, `services/exports/extraction_snapshot_reader.py`,
  `services/extraction_export_service.py`, `services/template_section_service.py`,
  `frontend/components/extraction/template-config/templateTree.ts`,
  `frontend/hooks/extraction/useTemplateEntityTypes.ts`,
  `frontend/lib/copy/templateConfig.ts`, regenerated `frontend/types/api/*`.
- `2c08adf9` test(quality-loop): pin the fallback noun in both identification
  prompts and the dialog's copy indirection — six test files.

## VERIFY

Deterministic lane on the commits above: `ruff check` + `ruff format --check`
clean on every touched backend file; `npx eslint` clean; `npm run typecheck`
clean; targeted pytest 101 passed (entry-group, model service, section
service, portable service); targeted vitest 19 passed (ModelSection,
AddSectionDialog) plus 30 passed (templateTree, ImportTemplateJsonGuidance,
aiPrompt); `bash scripts/generate_api_types.sh` re-run and committed. The
full `make quality-scan` on the final tree is recorded in `summary.md`.

Judge (self-applied, counterfactual probe): reverting any one comment fix
leaves the scanner's exact evidence string in place → DOES_NOT_RESOLVE;
reverting the prompt pin makes `identify every entry it describes`
unasserted for a NULL noun → the fallback could silently return to 'model'.
With both applied: RESOLVES.

## Reflexion

What could still go wrong: the placeholder-as-constant decision (layered-arch
f_1/f_2) is a judgment call the copy gate cannot arbitrate; if the team later
wants localizable placeholders, the constant has to be interpolated into a
copy string. What I'd do differently: run the scanner BEFORE the simplify
pass next time — six of the ten concept-drift rows were comments the diff's
own rename had left behind, cheap to catch while the files were open.
