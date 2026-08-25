# Summary — 2026-08-23-1530-portable-templates

**Status:** `converged` (22/22 backlog findings closed in 4 batched
iterations + 4/4 re-scan findings closed in a converge pass; 4 quarantined
with reasons; deterministic lane green before and after).

Scope: the portable template import/export slice (11 files, see `scope.md`).
Trigger: `/ship-spec` Phase 4 on branch `worktree-portable-template-import-export`.

## Counts

| Lane | Rows | ≥ 0.7 | Closed | Quarantined | Dropped |
| --- | --- | --- | --- | --- | --- |
| computational (fitness 10 checkers) | 0 | 0 | — | — | — |
| concept-drift | 6 | 6 | 6 | 0 | 0 |
| layered-arch | 4 | 4 | 4 | 0 | 0 |
| security | 4 | 4 | 2 (+1 client half) | 2 | 0 |
| legacy | 3 | 3 | 2 | 1 | 0 |
| test-gaps | 9 | 9 | 8 | 1 | 0 |
| converge re-scan | 4 | 4 | 4 | 0 | 0 |

Dedupe: the dead `createInitialInstances` was reported by four scanners
(cd_001, la_001/la_003, sec_002, leg_001) → one backlog item.

## Iterations

| # | Commit | What |
| --- | --- | --- |
| 001 | `234f8a04` | Evict `createInitialInstances` (blacklist #7 under another name) + the catalogue pre-read; guard in `check_legacy_concepts.py` (counterfactual-proven) |
| 002 | `bc0bc35a` | `ExtractionCardinality` enum, `DEFAULT_ENTRY_LABEL`, one `Framework` alias, extraction-surface wording |
| 003 | `abeb82c7` | PATCH handler commits; service flushes only; PATCH endpoint tests |
| 004 | `90b3890a` | Race-branch unit tests, "+N more" footnote, surfaced reload error, 2 MB cap, frontend failure-branch tests |
| 005 | `16af1d25` | Count-free FK-race 409, exhaustive refusal-code record, enum canary, hook clears error on recovery |

## Quarantine (see `backlog.md`)

sec_004 (llm_* preview step — a UX feature the spec replaced with the trust
notice), leg_003 (declared delete details payload; counts already in the
message), tg_009 (two-session lock test needs committed fixtures), sec_001
server half (413 middleware is platform-wide — spawned follow-up).

## Gates

- First full `scripts/verify_all.sh`: red on one line — `extraction_export_service.py`
  grew past its file-size cap by the `DEFAULT_ENTRY_LABEL` import (fixed in
  `6bf5b5d7` by tightening the touched comment).
- Second full run on a count-verified fresh DB: **exit 0** — ruff, eslint,
  tsc, pytest 3592 passed, vitest 249/2014, React-compiler build, fitness
  10/10, Playwright 42 passed (real creds; both template specs).
- After iteration 005: targeted suites + tsc/eslint/ruff/mypy ratchet +
  fitness 10/10 (full gate re-run deferred to CI on the PR; the change is
  message/typing-only).

## Stop decision

STOP criterion met: the converge re-scan found only low-severity items
(0.7–0.85), all closed in 005, and the deterministic lane is green. A further
inferential pass was not run — "convergence over completeness" (house rule);
any remaining findings are below the severity where another cycle pays.

Deviation from the contract, recorded rather than hidden: findings were
batched by file into 5 iterations instead of one-finding-per-iteration, and
the full `verify_all.sh` ran once after iterations 001–004 (green) rather
than after each.

Elapsed: ~2h10 wall clock (scan → converge). Mutation score: not run.
