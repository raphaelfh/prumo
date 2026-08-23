# 002 — backend vocabulary drift

Findings: cd_002, cd_003, cd_004, cd_005, cd_006

## PLAN

- Files (7, two of them one-line import additions in unrelated services
  that shared the literal): `backend/app/models/extraction.py`
  (`DEFAULT_ENTRY_LABEL`), `backend/app/schemas/extraction.py` (`Framework`
  alias), `backend/app/schemas/template_portable.py`,
  `backend/app/services/template_portable_service.py`,
  `backend/app/services/template_delete_service.py`,
  `backend/app/services/model_extraction_service.py`,
  `backend/app/services/extraction_export_service.py`.
- Test-first: behaviour is unchanged by construction (enum `.value` equals
  the literal); the existing round-trip, derivation and 409-message tests
  pin it. No new test — the recurrence guard is the enum/constant itself
  (a future literal would be a grep-visible regression).
- LOC: ±25.

## DIFF

Commit `bc0bc35a`.

## VERIFY

- pytest `-k "model_extraction or extraction_export or template or
  entry_label"` → 899 passed, 3 skipped.
- ruff + format clean; mypy ratchet: 77 ≤ 79, no new errors.
- Judge: RESOLVES.

## Reflexion

What could still go wrong: `DEFAULT_ENTRY_LABEL` lives in `app.models`; a
schema-layer consumer would have to re-declare it (layering forbids the
import). Next time: if a schema needs it, move the constant to `app/core`.
