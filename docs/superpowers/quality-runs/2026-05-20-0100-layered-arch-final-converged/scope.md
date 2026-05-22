# Scope

**Run ID**: 2026-05-20-0100-layered-arch-final
**Status**: converged
**Scope**: 6 endpoint files in `backend/app/api/v1/endpoints/` (the 7 remaining layered-arch baselines after run 2026-05-20-0030)

## Why this scope

After run 2026-05-20-0030 closed the 6 extraction_runs.py violations,
7 layered-arch baselines remained spread across 6 small endpoint files.
Each is a direct import from `app.models.*` or `app.repositories.*`
that should route through a service or a cross-cutting support module.
Closing them in one batched run gets the baseline to zero and
exemplifies the patterns for future endpoints.

## Files in scope (6)

- article_text_blocks.py (1: app.models.article)
- articles_export.py (1: app.repositories.unit_of_work)
- citations.py (2: app.models.article, app.models.extraction)
- hitl_sessions.py (1: app.models.extraction)
- project_templates.py (1: app.models.extraction)
- zotero_import.py (1: app.repositories.unit_of_work)
