---
name: verification-before-completion
description: Before claiming a fix is done, a bug is confirmed, a flake is real, or work is ready to ship — run the verification commands and read the output. Evidence before assertions. Use BEFORE typing "fixed", "done", "passing", "ready", or filing a PR.
---

# Verification Before Completion (prumo)

## Overview

Claiming work is complete without verification is dishonesty wearing efficiency's clothes. On prumo, the cost is paid by reviewers who trust the merge button: a "fix" that wasn't run produces extraction data corruption that's expensive to detect and worse to roll back.

**Core principle:** evidence before claims. Always. If you haven't run the verification command *in this session*, you cannot claim it passes.

## The iron law

> No completion claim without fresh verification evidence.

A test run from yesterday, a CI run on a sibling branch, a "should pass because the diff is small" — none of these count.

## The gate

Before saying any variant of "done", "fixed", "passing", "ready", "good to go", "confirmed":

1. **Identify** the command(s) that prove the claim.
2. **Run** the full command, fresh, this session. No partial scope unless explicitly justified.
3. **Read** the entire output. Check the exit code. Count failures, warnings, skipped tests.
4. **Verify** the output matches the claim.
   - If no → state the actual status with the evidence.
   - If yes → state the claim and include the evidence.
5. **Only then** make the claim.

Skipping any of these steps means you are *guessing*, not *verifying*.

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
| Frontend types | `cd frontend && npx tsc --noEmit` | exit 0, no errors |
| Migration is reversible | `cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head` | All three succeed |
| E2E pass | `npx playwright test` | All green, no `failed` lines |
| Bug reproduces | The test that should fail does fail (red), then after fix is green | TDD red-green cycle visible |

## Common failures — what is *not* sufficient

| Claim | Insufficient | Required |
|---|---|---|
| "Tests pass" | "Linter passed" | Test command exit 0, 0 failures |
| "Backend is clean" | `ruff check` only | `ruff check` + `mypy` + `pytest` |
| "Frontend is clean" | `npm run lint` only | `lint` + `tsc --noEmit` + `vitest run` |
| "Build succeeds" | "TypeScript compiles" | The actual build command exit 0 |
| "Bug is fixed" | Diff "looks right" | Failing test now passes; full suite still green |
| "Regression test works" | Test passes after fix | Red-green: revert fix → test fails; restore → test passes |
| "Migration is fine" | `alembic upgrade head` passes | upgrade → downgrade → upgrade all pass; data preserved |
| "RLS is correct" | Service-level test passes | Direct SQL with a non-reviewer JWT is rejected |
| "Agent finished" | Agent claims success | `git status` shows the expected diff; tests run locally |

## Red flags — stop

Any of the following means you are about to claim something you haven't verified:

- "Should work now."
- "Probably fine."
- "Looks correct."
- "Linter passed" *(as evidence of anything other than lint)*.
- "Tests passed last run."
- "Agent said it was done."
- "It's a one-line change, no need to test."
- "I'll verify after the commit."
- "Just this once."
- Any expression of satisfaction ("Great!", "Perfect!", "Done!") before the command has been re-run.
- About to write `git commit`, `gh pr create`, or "ready for review" without a fresh test run.

## Rationalisation prevention

| Excuse | Reality |
|---|---|
| "Should work now" | Then running the command is cheap. Run it. |
| "I'm confident" | Confidence is not evidence. |
| "Just this once" | This is exactly what "just this once" becomes. |
| "Linter passed" | Lint doesn't run tests. Tests don't run types. Types don't run RLS. |
| "Agent said success" | Verify independently. Agents lie when convenient. |
| "I'm tired" | Tired-you's lie ships to reviewers in the morning. |
| "Partial check is enough" | Partial proves nothing about the full claim. |
| "Different words so the rule doesn't apply" | Spirit over letter. "Looks good" is a completion claim. |

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
cd frontend && npx tsc --noEmit                   # type drift
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

Trust but verify. Agent self-reports do not count as evidence.

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

## When verification reveals failure

That's the system working. State the actual result with the evidence:

```
Not fixed. The new test still fails:

$ pytest -k advance_stage_toctou --tb=short
FAILED ...  AssertionError: expected ConcurrentUpdateError, got None

Hypothesis: the `with_for_update` lock isn't taken because the session
is using `autoflush=False`. Investigating.
```

This is honest and useful. A premature "fixed" claim followed by a "actually, never mind" is worse than this.

## Why this matters on prumo

- HITL data is *graded by humans*. A "fixed" extraction bug that ships unverified corrupts published values that took human time to produce.
- Cross-tenant bugs (BOLA/RLS) shipped unverified leak data across projects. There is no "small" version of that.
- The CI signal is the only thing reviewers can trust if they're not the author. Polluting it with unverified claims trains everyone to ignore it.

## The bottom line

No shortcuts. No "just this once". No "should pass". No "linter is green". No "agent said success".

Run the command. Read the output. Then claim the result.

This is non-negotiable.
