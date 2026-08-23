# 001 — evict `createInitialInstances` + the catalogue pre-read

Findings: cd_001, la_001, la_002, la_003, sec_002, leg_001 (+ tg_005 tests)

## PLAN

- Files (4): `frontend/services/templateImportService.ts`,
  `frontend/test/services/templateImportService.test.ts` (deleted),
  `frontend/services/templateImportService.test.ts`,
  `scripts/fitness/check_legacy_concepts.py`.
- Failing test first: `importGlobalTemplate` happy path + server-404 case
  (the function had no vitest at all).
- No-recurrence guard: blacklist entry 7's regex extended to
  `createInitialInstances`; counterfactual probe — a planted
  `const createInitialInstances = 1;` is flagged by the gate (verified, then
  removed).
- LOC: −118 / +40.

## DIFF

Commit `234f8a04`. `templateImportService.ts` no longer imports the supabase
client (apiClient-only); the two component tests that stubbed it only to load
this module dropped the stub.

## VERIFY

- `python3 scripts/fitness/check_legacy_concepts.py` → exit 0; evicted name:
  0 matches; planted probe: 1 match (guard bites).
- vitest `frontend/services frontend/components/extraction/dialogs
  frontend/components/extraction/template-config` → 23 files / 351 passed.
- tsc clean; eslint clean.
- Judge: RESOLVES (dead blacklist-#7 code gone; dual read path gone; guard
  present and proven by counterfactual).

## Reflexion

What could still go wrong: `check_frontend_data_path.py` matches per line, so
any future `supabase\n  .from(` split across lines in a service stays
invisible to CI — the catalogue pre-read removed here was exactly that.
Next time: make the data-path checker multi-line aware (follow-up), rather
than relying on a scanner to notice.
