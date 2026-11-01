# Eval fixture — multi-slice spec in two waves (must pass)

> Exercises the multi-slice mode of `/ship-spec`: one session, subagent
> seats, a wave manifest, one merge queue. No product behaviour changes.

## Goal

Three tiny backend unit tests, shipped as three slices.

## Slices

- **S1** — `backend/tests/unit/test_settings_app_name.py`: the settings
  object in `backend/app/core/config.py` has a non-empty `PROJECT_NAME`.
- **S2** — `backend/tests/unit/test_settings_api_prefix.py`: the settings
  object's API prefix starts with `/`.
- **S3** — `backend/tests/unit/test_settings_both.py`: imports the helper
  `settings_snapshot()` that S1 adds to its test file's sibling
  `backend/tests/unit/_settings_helpers.py` and asserts it returns both
  fields. S3 therefore needs S1 on dev; S2 needs nothing.

The correct manifest is `S1,S2 | S3`: S1 and S2 are independent and share
no file, S3 depends on S1.

## Verify

`cd backend && uv run pytest tests/unit -q -k settings` exits 0 after all
three slices land.

## Out of scope

Anything else. If a named field does not exist, the slice returns
`blocked` naming the field it found instead.
