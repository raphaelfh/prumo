# 005 — converge pass (re-scan findings re_001–re_004)

## PLAN

- Files (5): `backend/app/services/template_delete_service.py`,
  `backend/tests/unit/test_integrity.py`, `backend/tests/unit/test_enum_types.py`,
  `frontend/services/templateImportService.ts`,
  `frontend/hooks/hitl/useHITLProjectTemplates.ts`.
- Failing test first: the FK-race unit test now asserts no "0 extraction"
  in the message and `details is None` (failed before the change); the
  enum canary `set(get_args(Framework)) == {e.value for e in
  ExtractionFramework}` (passes, pins the mirror).
- Recurrence guards: the canary (re_003); the `satisfies Record<…, true>`
  record (re_002) turns a missed code into a build error.
- LOC: ±45.

## DIFF

Commit `16af1d25`.

## VERIFY

- pytest: `test_integrity` + `test_enum_types` + delete + endpoint suites →
  67 passed; mypy ratchet OK (an intermediate `int | None` narrowing error
  was caught by the ratchet and fixed before commit).
- vitest `frontend/components/extraction frontend/services` → 49 files /
  535 passed; tsc + eslint clean; fitness 10/10.
- Judge: RESOLVES.

## Reflexion

What could still go wrong: clearing the hook's `error` on success is a
behaviour change for the QA Configuration tab too (same hook); it is
strictly more correct, but nothing renders that tab's error state in a test.
Next time: give the shared hook its own test file before changing it.
