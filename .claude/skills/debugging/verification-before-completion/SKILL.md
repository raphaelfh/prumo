---
name: verification-before-completion
description: prumo's command table for proving a claim. Before saying a fix is done, a bug is confirmed, a flake is real, or work is ready to ship — run the command that proves it and read the output. Use BEFORE typing "fixed", "done", "passing", "ready", or filing a PR.
---

# Verification Before Completion (prumo)

**Read `superpowers:verification-before-completion` first.** It owns the generic
gate: the iron law, the five-step gate function, the red-flag list, and the
rationalisation table. This file does not repeat them — it supplies the prumo
commands that make the gate executable, and is the canonical gate `code-review`
points at.

On prumo the cost of an unverified claim is paid by reviewers who trust the merge button: a "fix" that wasn't run produces extraction data corruption that's expensive to detect and worse to roll back.

## Verification commands for prumo

| Claim | Command | What "passes" looks like |
|---|---|---|
| Backend tests pass | `make test-backend` or `cd backend && pytest` | `exit 0`, no `FAILED`, no `E` lines |
| One backend test passes | `cd backend && pytest -k <name> -x --tb=short` | Single `1 passed` line, exit 0 |
| Backend lint clean | `make lint-backend` (= `ruff check` + `ruff format --check`) | `All checks passed!`, exit 0 |
| Backend stricter lint | `cd backend && ruff check --select B,S,SIM,PIE,RUF,ASYNC` | `All checks passed!`, exit 0 |
| Backend types | `cd backend && mypy app/` | `Success: no issues found`, exit 0 |
| Frontend tests pass | `npm test` (or `npx vitest run`) | All green, exit 0 |
| One frontend test passes | `npx vitest run <path> -t "<name>"` | `1 passed`, exit 0 |
| Frontend lint clean | `npm run lint` | exit 0, no errors |
| Frontend types | `npm run typecheck` (from the REPO ROOT) | exit 0, no errors |
| Migration is reversible | `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head` | All three succeed |
| E2E pass | `npx playwright test` | All green, no `failed` lines |
| Bug reproduces | The test that should fail does fail (red), then after fix is green | TDD red-green cycle visible |
| Full deterministic gate | `make quality-scan` (`scripts/verify_all.sh`) | lint + typecheck + tests + fitness, exit 0 |

## prumo-specific insufficiency — what does *not* prove the claim

| Claim | Insufficient | Required |
|---|---|---|
| "Backend is clean" | `ruff check` only | `ruff check` + `mypy` + `pytest` |
| "Frontend is clean" | `npm run lint` only, or a bare `tsc --noEmit` | `lint` + `npm run typecheck` + `vitest run` |
| "Migration is fine" | `alembic upgrade head` passes | upgrade → downgrade → upgrade all pass; data preserved |
| "RLS is correct" | Service-level test passes | Direct SQL with a non-reviewer JWT is rejected |
| "Bug is fixed" | Diff "looks right" | Failing test now passes; full suite still green |
| "Regression test works" | Test passes after fix | Red-green: revert fix → test fails; restore → test passes |

## Verification patterns

### Bug fixes — TDD red-green

```
1. Write the test that captures the bug.
2. Run it → must fail (red). [Evidence: the failure output]
3. Apply the fix.
4. Run the test → passes (green). [Evidence: the pass output]
5. Run the surrounding module's tests. [Evidence: exit 0]
6. Run `make test-backend` or `npm test`. [Evidence: exit 0]
7. Then claim "fixed".
```

If you never saw the red, you don't have a regression test — you have a test that happens to pass.

### Backend service changes

```bash
cd backend
pytest -k <touched_service> --tb=short            # fast, focused
ruff check --select B,S,SIM,PIE,RUF,ASYNC .       # async correctness, security
mypy app/                                          # type drift
pytest                                             # full suite
```

Read the full output of each. Exit 0 alone is necessary, not sufficient — warnings and `XPASS` mean something.

### Frontend hook/service changes

```bash
npx vitest run frontend/hooks/extraction          # focused
npx vitest run                                     # full
npm run typecheck                                  # type drift — NOT `tsc --noEmit`
npm run lint
```

For UI changes, add a visual check via `make start` and TanStack Query devtools open. Never claim "the UI looks right" without having looked.

### Migrations

```bash
cd backend
alembic upgrade head
alembic downgrade -1
alembic upgrade head
pytest backend/tests/migrations/   # if applicable
```

A migration that can't downgrade is a migration that can't be rolled back in production.

### RLS

A new policy is not "verified" until a *direct SQL test with a non-privileged JWT* is rejected. Service-level tests run as the service role and bypass RLS. Always test the policy with the actual auth context it's protecting.

```bash
pytest backend/tests/rls/    # policy tests use real JWTs with limited roles
```

### Multi-agent / sub-task delegation

```
1. Agent returns "success".
2. `git status` — diff matches expectations?
3. `git diff` — code is what it should be?
4. Run the relevant tests yourself.
5. Then report status.
```

Agent self-reports do not count as evidence. On prumo this bites hardest when the
agent read a dirty working tree rather than the commit.

## Evidence to include in your claim

When you claim "fixed", paste the proof:

```
Fixed.

$ pytest -k advance_stage_toctou --tb=short
backend/tests/services/test_run_lifecycle_service.py::test_advance_stage_toctou PASSED
1 passed in 0.42s

$ make test-backend
... 412 passed, 0 failed in 38.21s
```

Don't paraphrase ("all tests pass"). Show it.

When verification reveals failure, state the actual result with the evidence and
the next hypothesis. That is the system working — a premature "fixed" followed by
"actually, never mind" is strictly worse.

## Why this matters on prumo

- HITL data is *graded by humans*. A "fixed" extraction bug that ships unverified corrupts published values that took human time to produce.
- Cross-tenant bugs (BOLA/RLS) shipped unverified leak data across projects. There is no "small" version of that.
- The CI signal is the only thing reviewers can trust if they're not the author. Polluting it with unverified claims trains everyone to ignore it.
