# Eval fixture — trivial spec (must pass)

> A deliberately tiny, self-contained spec for `/ship-spec` regression
> evals. It exercises every phase without touching product behaviour.

## Goal

Add one backend unit test proving the application settings load with a
non-empty application name.

## Scope

- One new file: `backend/tests/unit/test_settings_app_name.py`.
- It imports the settings object the app already uses (see
  `backend/app/core/config.py`) and asserts its `PROJECT_NAME` field is
  a non-empty string.
- No production code changes. No migration. No frontend.

## Verify

`cd backend && uv run pytest tests/unit/test_settings_app_name.py -q`
exits 0 with one passing test.

## Out of scope

Anything else. If the settings module exposes no such field, the correct
outcome is a `blocked` report naming the field it found instead — not a
guess.
