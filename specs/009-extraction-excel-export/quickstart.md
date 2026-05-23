# Quickstart — Extraction Excel Export

**Feature**: 009-extraction-excel-export
**Audience**: contributors implementing this feature locally

This guide walks you through the dependencies, code layout, and manual
test recipe for the extraction Excel export. It does **not** prescribe
the order of implementation tasks — that comes from
`/speckit-tasks`. Use this as the "first half-hour" doc once you
start working on this feature.

---

## 1. One-time dependency bump

The backend gains one new dependency.

```bash
cd backend
uv add openpyxl
# This updates backend/pyproject.toml and backend/uv.lock.
# Commit both.
```

Verify locally:

```bash
uv run python -c "import openpyxl; print(openpyxl.__version__)"
# Expect: 3.1.x or newer
```

The frontend has no new package dependencies — the feature reuses
`ArticlesExportDialog`'s primitives (Radix Dialog, Radio, Checkbox)
which are already installed.

---

## 2. Where the new code goes

Backend:

```
backend/app/
  api/v1/endpoints/extraction_export.py        (new — POST/GET/POST endpoints)
  api/v1/router.py                              (modified — register router)
  services/extraction_export_service.py         (new — orchestrator)
  services/exports/__init__.py                  (new — package marker)
  services/exports/extraction_xlsx_builder.py   (new — pure builder)
  schemas/extraction_export.py                  (new — Pydantic request/response)
  worker/tasks/extraction_export_tasks.py       (new — Celery task)
  repositories/extraction_template_version_repository.py   (new IF missing)

backend/tests/
  unit/test_extraction_xlsx_builder.py          (new — pure-function tests)
  integration/test_extraction_export_endpoint.py (new — endpoint + auth)
  integration/test_extraction_export_service.py (new — service-level)
```

Frontend:

```
frontend/
  components/extraction/ExtractionExportDialog.tsx   (new — Radix dialog)
  components/extraction/ExtractionInterface.tsx      (modified — add Export button)
  services/extractionExportService.ts                (new — apiClient wrapper)
  hooks/exports/useExtractionExportJob.ts            (new — polling hook)
  types/extraction-export.ts                         (new — TS types)
  types/background-jobs.ts                            (modified — add factory)
  lib/copy/extraction.ts                              (modified — i18n keys)
```

---

## 3. Run the API contract test (Phase 1 deliverable)

The contract file is `specs/009-extraction-excel-export/contracts/extraction-export.openapi.yaml`.

The endpoint implementation must satisfy it. A minimal contract test
(to be added under `backend/tests/integration/`) uses FastAPI's
built-in OpenAPI schema and compares it against the contract:

```python
# Sketch — actual test lives in backend/tests/integration/test_extraction_export_contract.py
import yaml, pathlib, json
from fastapi.testclient import TestClient
from app.main import app

def test_openapi_paths_match_contract():
    contract = yaml.safe_load(
        pathlib.Path(__file__).parents[2]
        / "../specs/009-extraction-excel-export/contracts/extraction-export.openapi.yaml"
    )
    client = TestClient(app)
    live = client.get("/api/openapi.json").json()
    for path in contract["paths"]:
        assert path in live["paths"], f"missing endpoint: {path}"
```

A stricter version diffs request/response schemas; that's a Phase 2 (`/speckit-tasks`) decision.

---

## 4. Local manual test recipe

Prereq: `make start` produces a running stack with Supabase + Postgres
+ Redis + backend + frontend.

1. **Seed a project with extraction data**. The fastest path is to use
   the existing `make seed` + `make seed-data` targets and add 2–3
   articles, run AI extraction on each, and finalize the Runs through
   the existing UI (Data Extraction → Extract for each article →
   Publish).

2. **Open the Data Extraction page** for the project (URL: `/projects/{id}?tab=data-extraction`).

3. **Click the new "Export" button** in the page top bar (next to the
   existing "Configure template" affordance).

4. **Dialog opens** with defaults: `Consensus`, `Current list (N)`,
   AI metadata off, anonymize off.

5. **Click Export**. For ≤ 50 articles you get an inline `.xlsx`
   download; otherwise a toast notification + an entry in the
   notification center linking to the signed URL when ready.

6. **Open the file** in Excel or LibreOffice Calc. Validate:
   - First sheet is named after the template (e.g. `CHARMS`).
   - Column A has section labels (only on section rows), column B has
     field labels, columns C+ have one column per article.
   - An article with N model instances has N adjacent columns under
     one merged article header.
   - The `Notes` sheet exists at the end with the export mode,
     timestamp, and any skipped-article count.

7. **Toggle "Include AI metadata sheet"** and re-export. Verify the
   `AI metadata` sheet appears in tab order between the main sheet and
   `Notes`, has one row per AI proposal, includes confidence + rationale
   + evidence + reviewer outcome.

8. **Switch to "All users" mode** (manager only). Each article header
   spans `Consensus` + one sub-column per reviewer. Toggle
   "Anonymize reviewer names" and confirm reviewers become
   "Reviewer A/B/…" in stable order.

9. **Negative test**: switch to a reviewer who has no decisions in the
   project. The dialog's `Export` button should disable with an inline
   reason; clicking it (if you bypass the disable via devtools) should
   return 422 with `code=EMPTY_ELIGIBLE_ARTICLES`.

---

## 5. Performance smoke test

For the worst-case scenario described in spec SC-002, seed a project
with 500 articles via `backend/scripts/seed_large_project.py` (to be
created as a Phase 2 task — leave a stub for now), finalize the Runs,
and run the export. Expected:

- Async path is taken automatically (article count > 50).
- Generation completes within 60 s P95.
- The resulting file opens cleanly in Excel (no warning dialogs).

---

## 6. Where to look when something breaks

| Symptom | First place to look |
|---|---|
| 403 on a sync export | `ProjectMemberRepository.is_member` query — check that the test project's `project_members` row exists |
| 503 on a large export | Redis/Celery worker — `docker compose logs redis celery_worker` |
| Empty cells where you expected values | Run stage isn't `finalized` for Consensus mode; reviewer has no decisions for Single-user mode; reviewer's only decision is `reject` |
| Multi-instance article has the wrong number of sub-columns | `extraction_instances` rows for the `model_section` entity types — count must equal what you see in the UI's `ModelSelector` |
| File opens but column layout is wrong | Diff the in-memory `ExportLayout` against the snapshot in `extraction_template_versions.schema_` for the active version |

---

## 7. Out-of-scope for V1 (don't get nerd-sniped)

- Multi-template workbook (one sheet per template).
- Evidence on the main sheet.
- Schema fix for `edited_from_proposal_id` lineage (separate spec).
- Retention cleanup task for old `exports/extraction/*.xlsx` objects.
- Recent-exports list / one-click re-export (FR-034, V2).
