# Phase 0 — Research: Extraction Excel Export

**Feature**: 009-extraction-excel-export
**Date**: 2026-05-23

This document records the four design-time decisions taken before Phase 1
artefacts (data model, contracts) are produced. Each section follows the
**Decision / Rationale / Alternatives considered** template.

---

## 1. Excel library choice

**Decision**: Add **`openpyxl ≥ 3.1`** as a backend dependency
(via `uv add openpyxl` → recorded in `backend/pyproject.toml` and
`backend/uv.lock`). All `.xlsx` writes go through openpyxl directly,
not via pandas.

**Rationale**:

- `openpyxl` is the de-facto standard for `.xlsx` read/write in Python,
  actively maintained, MIT-licensed, no native extensions (pure Python),
  installs cleanly under `uv`.
- It supports everything the spec needs: `mergedCells` for the article
  header row, cell styles (bold, fill colour) for section rows, named
  worksheets, multiple sheets per workbook, ISO date cells, and
  large-file write mode (`write_only=True`) for the 500-article
  worst case.
- Memory footprint for the worst-case spec scenario (500 × 100 × ~3
  models ≈ 150 k cells) under `write_only=True` is well below 200 MB
  on the existing Render worker plan.
- The pure-function builder pattern (no I/O, no DB) means a switch to
  a different library later would be a localised change.

**Alternatives considered**:

| Library | Why rejected |
|---|---|
| `xlsxwriter` | Faster write throughput than openpyxl but **write-only** — we don't need read, but `openpyxl` has a far richer feature surface (cell styling, named ranges, comments, evidence as cell comments for v2) that we will use over time. Sticking with one library for the project keeps the dep graph minimal. |
| `pandas.ExcelWriter` (with openpyxl engine) | pandas would only help if we wanted to round-trip via DataFrames. Our data shape (sections-as-rows, articles-as-columns with variable-arity sub-columns per article) is not a clean DataFrame — we would end up bypassing pandas's row-orientation for most cells. Adds a heavy (~70 MB) transitive dep for no win. |
| `pyxlsb` / `xlrd` | Read-only of legacy formats; not relevant. |
| Build SpreadsheetML XML by hand | Avoids the dependency but trades it for ~600 LOC of fragile XML and our own implementation of mergedCells, styles, and shared strings. Bad cost/benefit. |

**Open follow-up**: None. openpyxl is added in the `feat:` commit that
implements the endpoint; the CI Docker build will install it.

---

## 2. Storage bucket and signed-URL path

**Decision**: Reuse the existing Supabase Storage bucket **`articles`**
with a new path prefix **`exports/extraction/{user_id}/{job_id}.xlsx`**.
The signed URL is generated via the existing
`StorageAdapter.get_signed_url()` (1-hour TTL, same as `articles_export`).

**Rationale**:

- The `articles` bucket already exists, has RLS configured, and the
  `articles_export` async path writes to `exports/{user_id}/{job_id}.zip`
  under the same bucket — we are extending an established convention.
- Creating a new bucket (`extraction-exports`) would require a Supabase
  CLI migration (per the constitution's split-ownership rule), a new
  RLS policy file, and a follow-up coordination step. Net cost is
  significant for zero functional gain.
- The path prefix `exports/extraction/` makes audit and cleanup
  obvious: a future scheduled cleanup task can sweep
  `articles/exports/extraction/*` older than N days without confusing
  it for an article artefact.

**Alternatives considered**:

- **New `extraction-exports` bucket**: rejected (see rationale).
- **Stream the file directly from the endpoint in async mode**:
  rejected — the user closes the browser tab between submission and
  completion; the file must persist server-side so the notification
  link works.

**Open follow-up**: A scheduled "exports retention" cleanup task
(deletes objects under `exports/` older than 7 days) is out of scope
for V1 but should be filed as a separate ticket. The 1-hour signed-URL
TTL already limits exposure even without cleanup.

---

## 3. Sync vs async delivery threshold

**Decision**: Use **article count** as the sync/async decision input.
Threshold: **≤ 50 articles AND no AI metadata sheet AND mode ∈
{Consensus, Single user}** → sync inline `.xlsx`; otherwise → Celery
task with signed-URL completion via the in-app notification center.
Constant lives in `extraction_export.py` as
`SYNC_EXPORT_MAX_ARTICLES = 50` (same value as
`articles_export.SYNC_METADATA_ONLY_MAX_ARTICLES`).

**Rationale**:

- Mirrors the user's mental model from the articles export ("small
  exports come back instantly; big ones queue").
- 50 articles × 100 fields × 3 models ≈ 15 k cells — fits comfortably
  inside the 10 s P50 target on a single worker.
- The "All users" mode and the AI metadata sheet are both
  super-linear in cost (per-reviewer or per-proposal extra rows), so
  pushing them to async by default avoids tying up a request worker
  for > 30 s.
- The threshold is a single constant, easy to tune with operational
  data after launch.

**Alternatives considered**:

| Approach | Why rejected |
|---|---|
| Always sync | 500-article exports would exceed Gunicorn's 120 s timeout. |
| Always async | Forces the user to wait for a notification even on a 5-article export — worse UX for the common case. |
| Total-cell budget (articles × fields × models) | More accurate but harder to explain in the dialog's preview line. Article count is what the user sees in the radio label, so it's the natural unit. |

**Operational note**: When Redis/Celery is unavailable, the endpoint
returns `503 SERVICE_UNAVAILABLE` rather than silently falling back to
a long-running sync request — same behaviour as `articles_export`.

---

## 4. Layout anchor — frozen version vs live template

**Decision**: The exported sheet's column layout (section order,
field order, field labels, role partition) is driven by the
**currently active `extraction_template_versions` row** of the active
`project_extraction_templates` row at export time. Data from individual
Runs is read with each Run's own `version_id` snapshot; values from a
Run on an older version populate fields that still exist by `field_id`
in the live version; obsolete fields are listed under that Run's
article in the `Notes` sheet rather than silently dropped (per spec
FR-017).

**Rationale**:

- The user's mental model is "this is my CHARMS template today" —
  they expect the file's layout to match what they see in the
  Configuration tab now, not what existed when each Run was created.
- Field identity is stable across version bumps: a removed-then-readded
  field gets a new `field_id`, so matching by id correctly treats it
  as a new field (not a backwards-compatible same-field).
- The Notes sheet caveat keeps the export honest about data lineage
  without forcing the user to reason about every version separately.

**Alternatives considered**:

- **Use each Run's frozen version directly** (one column layout per
  version): rejected because a project with N versions would produce
  N sheet skeletons — confusing and impractical.
- **Snapshot the *latest finalized* Run's version**: rejected because
  it makes the layout depend on when the user last finalized, which
  is not stable.
- **Allow the user to pick a version in the dialog**: deferred to V2;
  V1 keeps the dialog minimal.

**Open follow-up**: None. The matching-by-field-id logic is a 5-line
helper in the builder.

---

## Cross-cutting follow-ups (deferred, not blocking V1)

- **Schema fix for AI lineage** — add a nullable `edited_from_proposal_id`
  FK on `extraction_reviewer_decisions` so `decision='edit'` rows can
  point back to the AI proposal they edited from. This would upgrade
  the AI metadata sheet's `Reviewer outcome` column from
  "edited (best-effort)" to exact. Migration is straightforward
  (1 new nullable column + CHECK relaxation) but lives in a separate
  feature spec.
- **Retention cleanup task** — schedule a Celery beat task to delete
  `articles/exports/extraction/` objects older than 7 days.
- **Multi-template export** — V2 enhancement: a workbook with one
  sheet per active template. Spec keeps V1 single-template.
- **Evidence on main sheet** — V2: a third "Evidence" sheet (per
  spec FR-021). V1 already surfaces evidence on the optional AI
  metadata sheet.
