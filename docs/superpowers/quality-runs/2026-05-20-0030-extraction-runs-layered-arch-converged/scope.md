# Scope

**Run ID**: 2026-05-20-0030-extraction-runs-layered-arch
**Status**: converged
**Scope**: `backend/app/api/v1/endpoints/extraction_runs.py` (524 LOC)

## Why this scope

`extraction_runs.py` held 6 of the 13 layered-arch baseline entries:
- 3 direct model imports (`extraction`, `extraction_workflow`, `user`)
- 3 direct repository imports (consensus/proposal/reviewer-decision repos)

All 6 are runtime usages inside `get_run`, `list_run_reviewers`, and the
`_load_run_and_check_member` helper (inline `select(Model)`, repository
instantiation, `db.get(ExtractionRun, ...)`). The cleanest fix is to
move those queries into a dedicated read-service module that the
endpoint then imports — a one-pass refactor closes all 6 entries
together.

## Findings (synthesized from baseline)

- 3 model imports (extraction / extraction_workflow / user)
- 3 repository imports (3 separate workflow repos)

All `confidence=1.0` deterministic (AST import graph).
