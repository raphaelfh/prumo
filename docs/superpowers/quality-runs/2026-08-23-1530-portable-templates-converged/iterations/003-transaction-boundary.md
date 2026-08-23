# 003 — transaction boundary of `set_template_active`

Findings: la_004, tg_004

## PLAN

- Files (3): `backend/app/services/project_template_active_service.py`,
  `backend/app/api/v1/endpoints/project_templates.py`,
  `backend/tests/unit/test_project_templates_portable_endpoints_unit.py`.
- Failing test first: `test_patch_active_commits_in_the_handler` asserted
  `db.commit` awaited once by the PATCH handler — failed (the handler did
  not commit; the service did). Plus the 404 and 400 mappings.
- Recurrence guard: the handler test pins the boundary.
- LOC: ±60.

## DIFF

Commit `abeb82c7`. Sole caller of `set_template_active` is the PATCH handler
(verified by grep).

## VERIFY

- pytest: the endpoint unit file + `test_project_template_active_service` +
  `test_single_active_extraction_invariant` + `test_template_clone_service`
  → 36 passed.
- Judge: RESOLVES.

## Reflexion

What could still go wrong: a future service caller of `set_template_active`
that expects the old auto-commit would silently not persist. Next time: the
docstring now says "flushes only — the endpoint commits"; a grep for
`db.commit()` under `app/services/` is the cheap drift check.
