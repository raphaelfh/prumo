---
status: draft
last_reviewed: 2026-09-03
owner: '@raphaelfh'
---

# Summary — 2026-09-03-2216-entry-key-typed-refusal

One manual cycle invoked by `/ship-spec` Phase 4 on the typed
`MISSING_ENTITY_KEY` refusal slice (branch `claude/entry-key-typed-refusal`,
range `origin/dev..HEAD`).

| Phase | Result |
|---|---|
| SCOPE | 10 production files (see `scope.md`); no prior run with this `scope_hash`. |
| SCAN | Deterministic lane: 14 fitness scripts + ruff/eslint/tsc, all exit 0. Inferential lane: 5 subagents, 36 rows (concept-drift 14, legacy 11, layered-arch 5, security 3, test-gaps 3). |
| TRIAGE | 12 rows dropped below the 0.7 floor (`findings_dropped.jsonl`); 24 rows in `backlog.md` after dedupe. |
| PLAN/APPLY | 3 iterations, each ≤ 300 LOC and inside the slice's files: `001` toast helper to the hooks layer + dead classes/branches/literals (a65f30a5); `002` AI-suggestion-era DTOs evicted with a warn-tier recurrence guard, refusal code bound to its enum, no-run-row proof (90597f82 + loopback 1 b23419c3); `003` polled job failures keep their classified code (3c289b73). |
| VERIFY | `scripts/verify_all.sh` on b23419c3: every lane OK except `deadcode:knip` (worktree artefact: no `.bin` in `node_modules`; `npx knip --no-tag-hints --exclude dependencies,unlisted,binaries` exits 0; CI is the authority). pytest 4073 passed / 3 skipped; vitest 292 files / 2396 tests. Judge: 001 RESOLVES; 002 DOES_NOT_RESOLVE (vacuous no-run-row assertion) → loopback 1 → RESOLVES; 003 RESOLVES. |
| CONVERGE | Deterministic re-scan green. 20 backlog rows closed. 4 rows deferred with a destination (below). Status: non-converged by choice, human triage recorded here. |

## Closed (20 rows)

layered-arch f_1, f_3, f_4 · concept-drift f_1, f_2, f_3, f_5, f_6, f_7, f_9, f_10 · legacy-spotter f_1, f_2, f_3, f_4, f_5 (kept exported for its unit test, recorded), f_6, f_7 · test-gaps f_1, f_2 · plus the code-review Important 1 (no-run-row proof through the real kickoff).

## Deferred (4 rows, ≥ 0.7, not fixed here)

| Row | Why not here | Destination |
|---|---|---|
| layered-arch f_2 — `sectionExtractionService` throws `APIError` instead of returning `ErrorResult` | Pre-existing contract violation across three methods; the diff only extended one throw site. | The entry-group trees spec retires `extractModels`; the async variants already use `toResult`. |
| concept-drift f_4 — `suggestions_created` wire name | Wire-visible rename across backend, generated types and hooks. | Its own PR. |
| concept-drift f_11 — service JSDoc example says "suggestions" | Follows f_4. | With the rename PR. |
| concept-drift f_8 — `string`-typed code parameter on the toast mapper | By design: no runtime copy of the generated union exists; the title table keeps the keys typechecked (altitude lens, panel). | Won't fix; recorded. |

## Dropped (12 rows < 0.7)

Audit trail in `findings_dropped.jsonl`: among them security f_1 (a log line the simplify pass removed by design), f_2 (pre-existing generic-500 message echo) and f_3 (an `AUTH_ERROR` branch that could never fire: the client throws `AUTH_REQUIRED`, the backend `AUTHENTICATION_ERROR`); test-gaps f_3 (rollback assertion on the direct-coroutine test; covered by the real-kickoff proof instead).

## Quarantine

None: no finding exhausted three loopbacks.

status="non_converged"
