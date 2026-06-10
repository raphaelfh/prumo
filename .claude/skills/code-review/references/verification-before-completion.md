# Verification before completion

The Iron Law: **No completion claim ships without fresh evidence.**

## Gate procedure

For every claim you are about to make:

1. **Identify** the command whose output would prove or disprove the claim.
2. **Run** the command in full, not a subset. Don't skip "the slow tests".
3. **Read** the output. Don't pattern-match on exit code alone — read for warnings, deprecations, skipped tests.
4. **Confirm** the output literally supports the claim. "Tests pass" means "0 failures, 0 errors, expected count of tests ran".
5. **Then** claim — and quote the relevant line of output if the reviewer would otherwise have to take your word for it.

Skipping any step is lying, not reviewing.

## Claim → command table (prumo)

| Claim                                       | Command                                                          | What "pass" means                                                  |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| "Backend tests pass"                        | `make test-backend`                                              | Exit 0, no `FAILED`, no `ERROR`, expected count collected          |
| "Backend lint clean"                        | `make lint-backend`                                              | Exit 0, no `would reformat` lines from ruff                        |
| "Type-check passes (backend)"               | `cd backend && mypy app` (if configured) or run pre-commit       | Exit 0                                                             |
| "Frontend tests pass"                       | `npm test --prefix frontend`                                     | Exit 0, no failed suites                                           |
| "Frontend lint clean"                       | `npm run lint --prefix frontend`                                 | Exit 0                                                             |
| "Frontend typechecks"                       | `npm run typecheck --prefix frontend` or `tsc --noEmit`          | Exit 0                                                             |
| "E2E passes"                                | `npx playwright test` (frontend)                                 | All specs green                                                    |
| "Migration applies"                         | `cd backend && alembic upgrade head`                             | Exit 0, no pending revisions                                       |
| "Migration is reversible"                   | `alembic downgrade -1 && alembic upgrade head`                   | Both exit 0, schema diff after round-trip is empty                 |
| "Bug fixed"                                 | A new test reproducing the original symptom passes               | The test fails on `HEAD~1` and passes on `HEAD`                    |
| "Endpoint authorized"                       | `grep -n ensure_project_member <file>`                           | Match on a line that executes before the data access               |
| "No N+1"                                    | Run the endpoint with `SQLALCHEMY_ECHO=1`, count queries         | Query count independent of result-set size                         |
| "Cache invalidated"                         | Grep `invalidateQueries` in the mutation; key matches the reader | Key prefix matches the reader's `queryKey`                         |
| "Build succeeds"                            | `npm run build --prefix frontend`                                | Exit 0, no warnings about missing deps                             |
| "CI green"                                  | `gh pr checks <pr>` or branch status                             | All required checks green; pending checks do not count             |

## Red flags — stop and run something

The moment you catch yourself typing or thinking any of these, stop and execute the corresponding command:

- "Should work" / "should be fine" / "probably right" → run the test.
- "Looks equivalent to me" → run both versions, diff the output.
- "I refactored but the behavior is the same" → run the full test suite, not just the touched module.
- "Tests should still pass since I didn't change logic" → famously wrong roughly 30% of the time. Run them.
- "Linter will catch anything else" → run the linter now.
- "Nice, that does it" before any verification → first sign you are about to ship a bug.

## When evidence is unavailable

Sometimes the evidence is hard to get — flaky tests, environments you can't reach, external services. In that case:

1. Say so. Don't claim success; claim "the parts I could verify pass; here's what I couldn't verify and why".
2. Propose how the reviewer can fill the gap (run the manual step, point at the staging env).
3. Never paper over a missing verification with a sentence like "should be fine in prod".

## Verification ≠ "I tried it once"

A test that passed once on your machine is **not** evidence the feature works. Evidence is:

- The test is committed and runs in CI.
- The CI run on this branch is green.
- The failing-then-passing pair exists for any bug-fix claim.

## Trusting subagent reports

When a subagent reports "task complete", that is not evidence. Read its tool output. Re-run the verification gate yourself. The subagent might have:

- Skipped the test (`pytest -k <pattern>` excluded the new test).
- Marked a `xfail` it should have fixed.
- Confused "no compile error" with "behavior is correct".

Treat subagent claims like external reviewer claims: verify, then trust.
