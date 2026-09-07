# Plan — trivial spec (eval fixture for `--from-plan`)

> The plan form of `spec-trivial.md`, so eval 2 can start at the panel
> review. Spec: `.claude/skills/ship-spec/evals/fixtures/spec-trivial.md`.

## Global Constraints

- Work only in the worktree named in the brief.
- No production code changes; one new test file only.
- Backend tests run with `cd backend && uv run pytest <path> -q`.

## Task 1 — settings app-name test

**Goal:** `backend/tests/unit/test_settings_app_name.py` proves the
application settings expose a non-empty application name.

**Steps**

1. Read `backend/app/core/config.py` and note the settings object; the
   field is `PROJECT_NAME` (a `str`, default "Prumo API").
2. Write the failing test first: import the settings object, assert
   `PROJECT_NAME` is an instance of `str` and non-empty. Run it; it fails only if
   the import path or field name is wrong — fix the test, not the app.
3. Run `cd backend && uv run pytest tests/unit/test_settings_app_name.py -q`
   and read the output: one test passed.

**Verify:** the command above exits 0 with `1 passed`.
