# Verification before completion (prumo)

`superpowers:verification-before-completion` owns the generic gate: the iron law, the five-step gate function, the red-flag list, and the rationalisation table. This file supplies the prumo commands that make the gate executable. `SKILL.md` § "The verification gate" carries the short table for the review flow; this is the full one.

On prumo the cost of an unverified claim is paid by reviewers who trust the merge button: a "fix" that wasn't run corrupts extraction data that humans graded, and cross-tenant bugs shipped unverified leak data across projects.

## Verification commands

| Claim | Command | What "passes" looks like |
|---|---|---|
| Backend tests pass | `make test-backend` | `exit 0`, no `FAILED`, no `E` lines |
| One backend test passes | `cd backend && pytest -k <name> -x --tb=short` | Single `1 passed` line, exit 0 |
| Backend lint clean | `make lint-backend` (= `ruff check` + `ruff format --check`) | `All checks passed!`, exit 0 |
| Backend stricter lint | `cd backend && ruff check --select B,S,SIM,PIE,RUF,ASYNC` | `All checks passed!`, exit 0 |
| Backend types | `cd backend && mypy app/` | `Success: no issues found`, exit 0 |
| Frontend tests pass | `npm run test:run` (repo root) | All green, exit 0 |
| One frontend test passes | `npx vitest run <path> -t "<name>"` | `1 passed`, exit 0 |
| Frontend lint clean | `npm run lint` | exit 0, no errors |
| Frontend types | `npm run typecheck` (repo root, not a bare `tsc --noEmit`) | exit 0, no errors |
| Migration is reversible | `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head` | All three succeed |
| E2E pass | `npx playwright test` | All green, no `failed` lines |
| Bug reproduces | The test that should fail does fail (red), then after the fix is green | Red-green visible in output |
| Full deterministic gate | `make quality-scan` (`scripts/verify_all.sh`) | lint + typecheck + tests + fitness, exit 0 |

There is no `frontend/package.json`; every npm command runs from the repo root.

## What does *not* prove the claim

| Claim | Insufficient | Required |
|---|---|---|
| "Backend is clean" | `ruff check` only | `ruff check` + `mypy` + `pytest` |
| "Frontend is clean" | `npm run lint` only, or a bare `tsc --noEmit` | `lint` + `npm run typecheck` + `vitest run` |
| "Migration is fine" | `alembic upgrade head` passes | upgrade → downgrade → upgrade all pass; data preserved |
| "RLS is correct" | Service-level test passes | Direct SQL with a non-reviewer JWT is rejected |
| "Bug is fixed" | Diff "looks right" | Failing test now passes; full suite still green |
| "Regression test works" | Test passes after fix | Red-green: revert fix → test fails; restore → test passes |
| "The UI is right" | Class strings read correctly | Rendered and looked at (`design-review`) |
| "The subagent finished" | Its "success" report | `git status`, `git diff`, and the tests run by you |

## Patterns

### Bug fixes — red-green

1. Write the test that captures the bug. Run it: it must fail. Keep the failure output.
2. Apply the fix. Run the test: it passes. Keep the output.
3. Run the surrounding module's tests, then `make test-backend` or `npm run test:run`.
4. Then claim "fixed".

If you never saw the red, you don't have a regression test; you have a test that happens to pass.

### Backend service changes

```bash
cd backend
pytest -k <touched_service> --tb=short            # fast, focused
ruff check --select B,S,SIM,PIE,RUF,ASYNC .       # async correctness, security
mypy app/                                          # type drift
pytest                                             # full suite
```

Read the full output. Exit 0 alone is necessary, not sufficient; warnings and `XPASS` mean something.

### Frontend hook/service changes

```bash
npx vitest run frontend/hooks/extraction          # focused
npm run test:run                                  # full
npm run typecheck
npm run lint
```

### Migrations

```bash
cd backend
alembic upgrade head && alembic downgrade -1 && alembic upgrade head
```

A migration that can't downgrade can't be rolled back in production.

### RLS

A new policy is verified only when a direct SQL test with a non-privileged JWT is rejected. Service-level tests run as the service role and bypass RLS; test the policy with the auth context it protects.

## Evidence to include in your claim

Paste the proof, don't paraphrase:

```text
$ pytest -k advance_stage_toctou --tb=short
backend/tests/services/test_run_lifecycle_service.py::test_advance_stage_toctou PASSED
1 passed in 0.42s
```

When verification reveals failure, state the actual result with the evidence and the next hypothesis. A premature "fixed" followed by "actually, never mind" is strictly worse.
