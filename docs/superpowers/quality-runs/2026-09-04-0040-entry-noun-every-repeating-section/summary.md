---
status: draft
last_reviewed: 2026-09-04
owner: '@raphaelfh'
---

# Summary — 2026-09-04-0040-entry-noun-every-repeating-section

One manual cycle invoked by `/ship-spec` Phase 4 on the entry-noun slice
(branch `feat/entry-noun-every-repeating-section`, range `origin/dev..HEAD`).

| Phase | Result |
|---|---|
| SCOPE | 25 production files (see `scope.md`); no prior run with this `scope_hash`. |
| SCAN | Deterministic lane: `make quality-scan` on 920a86cb — ruff, eslint, tsc, knip ×2, vulture, pytest 4080, vitest 2400, React Compiler build and 14 fitness scripts OK; Playwright SKIP (local stack down). Inferential lane: 5 subagents, 27 rows (concept-drift 10, layered-arch 4, security 0, legacy 3, test-gaps 10); three lanes needed a second attempt after an API rate limit cut the first short (`telemetry.jsonl`). |
| TRIAGE | 0 rows below the 0.7 floor (each lane applied it before emitting); 27 rows in `backlog.md`, none deduped (distinct file/line/category). |
| PLAN/APPLY | 1 iteration (`iterations/001-*.md`), two commits: `66862235` (comments, docstrings, guidance string, role enum) and `2c08adf9` (prompt-noun pins, None-vs-blank split, dialog copy indirection, one vacuous assertion dropped). |
| VERIFY | Targeted gates green on both commits; the final `make quality-scan` on `2c08adf9` is recorded below. Judge: RESOLVES. |
| CONVERGE | Deterministic re-scan green. 19 backlog rows closed, 7 deferred with a destination, 1 won't-fix recorded. Status: non-converged by choice, human triage recorded here. |

## Closed (19 rows)

concept-drift f_1–f_10 · layered-arch f_4 · legacy f_1, f_2 · test-gaps f_1, f_2, f_7, f_8, f_9, f_10.

## Deferred (7 rows, ≥ 0.7, not fixed here)

| Row | Why not here | Destination |
|---|---|---|
| layered-arch f_1, f_2 — noun input placeholder is `DEFAULT_ENTRY_NOUN`, not a copy key | Decided by the plan review (constitution + simplicity lenses): the placeholder shows the data fallback a legacy blank reads as, exactly as the run form shows the noun; two placeholder keys spelling the same word were the drift risk. The copy gate is green. | Won't fix; recorded. Revisit if placeholders need localization independent of the data noun. |
| layered-arch f_3 — the Undo replay posts the fallback noun client-side | Decided by the plan review (security, altitude, coverage lenses): the replay is the boundary that adapts a raw snapshot to the create contract; a server-side NULL acceptance would need a restore bypass of the new rule. | The entry-group trees spec makes the column NOT NULL, which deletes every fallback including this one. |
| legacy f_3 — `docs/reference/templates/charms-v1.1-complete.md:327` queries the dropped `extracted_values` table | Outside the slice; docs/ is outside `check_legacy_concepts.py`. | Follow-up task chip "Fix stale extracted_values query in CHARMS template doc". |
| test-gaps f_3, f_4, f_6 — `SectionAccordion`, `useAddEntry`, `InstanceCard` fallbacks unpinned | Those sites already read `'entry'` before this PR; the diff swapped the literal for the constant without changing behaviour. | Pin when the trees spec reworks the run form. |
| test-gaps f_5 — `ExtractionFullScreen` page-level fallbacks unpinned | The same expression and constant are pinned at the dialog/selector level (`entryLabelNoun`, `ModelSection`); a page render with a noun-less container is heavy for a one-word assertion. | Same as above. |

## Dropped (0 rows < 0.7)

`findings_dropped.jsonl` is empty: every lane applied the confidence floor before emitting.

## Quarantine

None: no finding exhausted three loopbacks.

status="non_converged"
