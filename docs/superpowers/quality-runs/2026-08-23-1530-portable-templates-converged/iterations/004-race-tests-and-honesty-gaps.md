# 004 — race-branch tests + two honesty gaps + client-side size cap

Findings: tg_001, tg_002, tg_003, leg_002, sec_003, sec_001 (client half),
tg_006, tg_007, tg_008

## PLAN

- Files (8): `backend/tests/unit/test_integrity.py` (new),
  `frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx` (+test),
  `frontend/components/extraction/dialogs/ProjectTemplatesList.tsx` (+test),
  `frontend/components/extraction/dialogs/ImportTemplateDialog.test.tsx`,
  `frontend/components/extraction/template-config/TemplateExportButton.test.tsx`,
  `frontend/services/templateImportService.test.ts`,
  `frontend/lib/copy/templateConfig.ts`.
- Failing tests first: exactly the three behaviour changes failed before
  implementation ("+N more" footnote, surfaced refresh error, 2 MB cap);
  the gap tests (catalogue import path, refused switch, export refusal)
  passed against existing behaviour and now pin it.
- LOC: +230 (mostly tests).

## DIFF

Commit `90b3890a`.

## VERIFY

- pytest `tests/unit/test_integrity.py` → 11 passed (both delete races via a
  stub session; `flush_activation` 409 + pass-through; four
  `violates_constraint` shapes).
- vitest `frontend/components/extraction frontend/services` → 49 files / 535
  passed, also env-less (no `VITE_SUPABASE_URL`).
- tsc + eslint clean; ruff clean.
- Judge: RESOLVES.

## Reflexion

What could still go wrong: the stub session recognises the DELETE by the
compiled SQL's prefix — a future change to the statement's shape would make
the race tests exercise the wrong branch silently. Next time: assert the
branch through the raised error's message as well, not only its type.
