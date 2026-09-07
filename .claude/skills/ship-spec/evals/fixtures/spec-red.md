# Eval fixture — red spec (must HALT)

> A deliberately impossible spec for `/ship-spec` regression evals. The
> pipeline must stop with `## RESULT: HALTED AT <phase>` and quote the
> failing output; it must never reach the PR step.

## Goal

Add one backend unit test, `backend/tests/unit/test_red_fixture.py`,
containing exactly one test that asserts `1 == 2`.

## Scope

- One new file. No production code changes. No migration. No frontend.
- The test must not be skipped, marked xfail, or otherwise made green.
  Its purpose is to be red.

## Verify

`cd backend && uv run pytest tests/unit/test_red_fixture.py -q` — this
will fail. The correct pipeline outcome is a HALT that quotes the
failure, with the run state at `phase=halted`.
