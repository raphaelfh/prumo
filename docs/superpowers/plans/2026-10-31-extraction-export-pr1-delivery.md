---
status: in_progress
last_reviewed: 2026-10-31
owner: '@raphaelfh'
---

# Extraction export PR1: delivery and safety, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every export reaches the browser under its real filename. Authorization failures are real 404s on both the sync and async paths, before any dispatch. The async path refuses an empty export. A Matrix that is too wide is left out instead of failing the export. Sheet titles are allocated once, without collisions. Cell strings survive Excel and pandas. A dictionary export accepts `article_ids=[]`.

**Architecture:** A new `exports/extraction/run.py` is the single entry point. It holds `authorize_export`, which the endpoint calls before choosing sync or async, and `build_export`, which both the sync endpoint and the Celery task call. `workbook.py` gains a title pre-pass: `allocate_titles` produces a `SheetTitles` object, and every sub-builder receives it. `sheet_spec.py` gains `safe_sheet_title`, `RESERVED_TITLES` and writer hygiene in `_render_sheet_spec`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Celery (JSON result backend), openpyxl, pandas (test only), pytest against real Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-extraction-export-options-design.md`. It covers §3 (`article_ids`), §4.6 (writer hygiene), §5 rule 4, §8 (`run.py`), §9 and §11 row 1.

**Depends on:** none (first PR).

**Branch:** `feat/export-delivery-safety` off `dev`. Create it as a worktree; every command runs with `git -C "$WT"`.

## Global Constraints

- **No DDL, no data migration, no seed change** (§9).
- **Wire values and field names are unchanged.**
  - Celery task kwargs are unchanged and pinned by a test (§9).
  - API types are regenerated because description text changes.
- **Visible API changes (§9):**
  - A foreign or missing article id returns 404 on both paths.
  - A dictionary export accepts an empty `article_ids`.
  - Unchanged (R22): a non-dictionary request with `article_ids=[]` returns 422, whatever `article_scope` says. Today `min_length=1` returns it and the endpoint's `selected_only` 400 (`extraction_export.py:150`) is unreachable; after Task 8 the model validator returns it. PR1 deletes the unreachable check.
- **Fixed titles (R7):** PR1 owns every fixed title. `SheetTitles.fixed` sets `matrix` → "Matrix" (was the template name), `appraisal_summary` → "Appraisal" (was "Appraisal summary") and `ai_proposals` → "AI proposals" (was "AI metadata"). Later PRs assume these titles.
- **AI role id (R8a):** PR1 renames the builder id `ai_metadata` → `ai_proposals` in `_SHAPE_BUILDERS`, `_ARTICLE_BUILDERS`, `_ordered_specs` and `allocate_titles`. The module `ai_metadata.py` and `build_ai_metadata` keep their names until PR5.
- **Reserved titles** are claimed first and compared case-insensitively: `README`, `Summary`, `Matrix`, `Articles`, `Data`, `Verification`, `AI proposals`, `Appraisal`, `Codebook`, `Options`, `History`.
  - Titles are at most 31 characters, with a deterministic suffix when needed.
- **Writer hygiene** lives in the single writer `_render_sheet_spec`:
  - `ILLEGAL_CHARACTERS_RE` is stripped from every string;
  - a string starting with `=` is written as text (`data_type="s"`, quote prefix).
- **Async storage key:** `exports/extraction/{user_id}/{task_id}/{filename}`.
- **Async failures:**
  - Domain errors fail the task without retry.
  - The status `error` field carries a message that starts with a stable code (`EMPTY_ELIGIBLE_ARTICLES: …`).
  - The status schema does not change.
- **`EmptyExportError`** keeps the code `EMPTY_ELIGIBLE_ARTICLES`, which the frontend reads (`HITLExportDialog.test.tsx:401`, `e2e/flows/extraction-export.e2e.ts:191`).
- **Out of scope:**
  - `EXPORT_CELL_BUDGET` and `ExportTooLargeError` belong to PR5 (contract F20).
  - "Data dictionary" and "Dropdown lists" keep their names until PR4 replaces them with Codebook and Options.
  - All frontend work: the dialog gate that blocks a dictionary export with zero articles (`HITLExportDialog.tsx:232-233`) and `EXPORT_TOO_LARGE` handling belong to PR6 (R23). The AI toggle copy belongs to PR6 (R5).
- **One ownership predicate (BOLA).**
  - Articles go through `article_read_service.owned_articles`.
  - Templates go through `project_template_active_service.owned_template`.
  - `check_scope_guards.baseline:7` is removed.
- **Every commit runs.** No intermediate commit leaves a caller on an old signature.

## Review Focus

1. **Contents vs real sheets.** The README contents must equal the rendered sheet list for every shape, with and without the AI toggle, even when `layout.front_matter is None`. Task 4 adds `test_readme_contents_equal_sheetnames_for_every_shape`.
2. **A section title Excel refuses.** A label made only of forbidden characters, one wrapped in `'`, or one whose 31-character cut ends in `'` (Excel rejects a leading or trailing `'`). Task 2 adds `test_safe_sheet_title_falls_back_and_strips_apostrophes`.
3. **Celery round-trip.** `EmptyExportError` must survive the JSON backend's `exception_to_python` with its `EMPTY_ELIGIBLE_ARTICLES: ` prefix. Task 7 adds `test_empty_export_error_survives_the_json_result_backend`.
4. **Membership before existence.** A non-member sending a foreign article id gets 403, not 404, so there is no cross-project existence oracle. Task 6 adds `test_authorize_checks_membership_before_ownership`.
5. **A merged header with a leading `=`.** Hygiene must not touch merged non-anchor cells, and must still quote an anchor starting with `=`. Task 3 adds `test_formula_like_string_in_merged_anchor_is_text`.
6. **Fixed titles (R7).** Every fixed role title is a reserved name, and no legacy title ("Appraisal summary", "AI metadata", template-name Matrix) survives in code or tests. Task 4 adds `test_fixed_titles_are_the_reserved_names` and a grep step.

## Tasks

### Task 1: refactor: drop the unused `ExtractionExportService.storage`

The service assigns `storage` (`extraction_export_service.py:387`) and never reads it (contract F14). This is a sibling `refactor(...)` commit, landed first so that `run.py` can build the service with no storage adapter.

**Files:**
- Modify:
  - `backend/app/services/extraction_export_service.py:33` (import) and `:379-388` (`__init__`)
  - `backend/app/api/v1/endpoints/extraction_export.py:30,159-165,312-326`: drop `create_storage_adapter`, the `supabase: SupabaseClient` params and the `storage=` kwarg.
  - `backend/app/worker/tasks/extraction_export_tasks.py:70-78`: the storage adapter is now built only for the upload.
- Test (mechanical, drop the `storage=` kwarg):
  - `tests/integration/test_extraction_export_{ai_outcome,ai_outcome_ordering,ai_value_resolution,appraisal_summary,golden_structure,many_cardinality_fanout,new_sheets,snapshot_diff,template_bola,value_resolution}.py`
  - `tests/integration/test_qa_rules_frozen.py`, `tests/integration/test_run_lifecycle_service.py`
  - `tests/unit/test_extraction_export_{determinism,load_sections,obsolete_fields,service}.py`
  - `tests/unit/test_extraction_export_start_endpoint.py`: drop `supabase=` and the `create_storage_adapter` patch.

**Interfaces:**
- Produces `ExtractionExportService.__init__(self, db: AsyncSession, user_id: str, trace_id: str | None = None) -> None`.

- [ ] Run `grep -rn "\.storage\b" backend/app/services/extraction_export_service.py`. Expected: only the assignment at `:387`.
- [ ] Delete the parameter, the attribute and the `StorageAdapter` import, then update every call site above.
- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_export_service.py tests/unit/test_extraction_export_start_endpoint.py tests/integration/test_extraction_export_template_bola.py tests/integration/test_worker_eager_mode.py -q`. Expected: PASS.
- [ ] Commit: `refactor(export): drop the unread storage adapter from ExtractionExportService`.

### Task 2: `safe_sheet_title` and `RESERVED_TITLES`

**Files:**
- Modify: `backend/app/services/exports/extraction/sheet_spec.py`. The new symbols go beside `SheetSpec`; the module stays openpyxl-only and imports no service.
- Test: `backend/tests/unit/test_extraction_safe_sheet_title.py` (new).

**Interfaces:**
- Produces `RESERVED_TITLES: Final[tuple[str, ...]] = ("README","Summary","Matrix","Articles","Data","Verification","AI proposals","Appraisal","Codebook","Options","History")`.
- Produces `def safe_sheet_title(raw: str, taken: Collection[str], *, fallback: str) -> str`. Its steps:
  1. strip `[]:*?/\` and `ILLEGAL_CHARACTERS_RE`;
  2. trim whitespace and `'` from both ends;
  3. use `fallback` when the result is empty;
  4. cut to 31 characters, then trim whitespace and `'` again;
  5. while the result collides case-insensitively with `taken`, try `base + " (n)"` for n = 2, 3, …. The base is cut to `31 - len(suffix)` and trimmed of whitespace and `'` after the cut.

- [ ] Write the failing tests.

```python
from app.services.exports.extraction.sheet_spec import RESERVED_TITLES, safe_sheet_title

def test_reserved_titles_are_the_spec_list() -> None:
    assert RESERVED_TITLES == ("README", "Summary", "Matrix", "Articles", "Data", "Verification",
                               "AI proposals", "Appraisal", "Codebook", "Options", "History")

def test_collision_is_case_insensitive_and_suffixed() -> None:
    assert safe_sheet_title("history", RESERVED_TITLES, fallback="T") == "history (2)"
    assert safe_sheet_title("Data", RESERVED_TITLES, fallback="T") == "Data (2)"
    assert safe_sheet_title("data", [*RESERVED_TITLES, "data (2)"], fallback="T") == "data (3)"

def test_forbidden_chars_stripped_and_length_capped() -> None:
    assert safe_sheet_title("Risk: [bias]/*?", (), fallback="T") == "Risk bias"
    long = "x" * 40
    assert safe_sheet_title(long, (), fallback="T") == "x" * 31
    assert safe_sheet_title(long, ("x" * 31,), fallback="T") == "x" * 27 + " (2)"

def test_safe_sheet_title_falls_back_and_strips_apostrophes() -> None:  # Review Focus 2
    assert safe_sheet_title("[]:*?", (), fallback="Table 3") == "Table 3"
    assert safe_sheet_title("'Bias'", (), fallback="T") == "Bias"
    assert safe_sheet_title("a\x0cb", (), fallback="T") == "ab"
    assert safe_sheet_title("a" * 30 + "'b", (), fallback="T") == "a" * 30

def test_deterministic() -> None:
    taken = ("README", "Sec")
    assert safe_sheet_title("Sec", taken, fallback="T") == safe_sheet_title("Sec", taken, fallback="T") == "Sec (2)"
```

- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_safe_sheet_title.py -q`. Expected: FAIL with `ImportError` (`RESERVED_TITLES`).
- [ ] Implement the two symbols in `sheet_spec.py` and add both to `__all__`.
- [ ] Run the test again. Expected: PASS.
- [ ] Commit: `feat(export): add safe_sheet_title and the reserved sheet titles`.

### Task 3: writer hygiene in `_render_sheet_spec`

**Files:**
- Modify:
  - `backend/app/services/exports/extraction/sheet_spec.py:74-110` (`_render_sheet_spec`)
  - `backend/pyproject.toml:160-167`: add `"pandas>=3.0"` to `[dependency-groups] dev`, then run `cd backend && uv lock`. pandas is only transitive today (through `docling-core`, `backend/uv.lock:1048`; locked at 3.0.3, `uv.lock:3157-3165`), and the spec's §11 test reads back through `pd.read_excel`. Do not use `importorskip`, because the CI skip budget counts skips. PR1 is the only PR that adds it (R24); PR6 relies on it.
- Test: `backend/tests/unit/test_extraction_sheet_spec_hygiene.py` (new).

**Interfaces:**
- Consumes `openpyxl.cell.cell.ILLEGAL_CHARACTERS_RE`.
- Produces a private `def _clean(value: CellValue) -> CellValue`, which strips illegal characters from a `str`. After each value is bound, a `str` that starts with `=` gets `target.data_type = "s"` and `target.quotePrefix = True`.

- [ ] Write the failing tests.

```python
import io
import pandas as pd
from openpyxl import Workbook, load_workbook
from app.services.exports.extraction.sheet_spec import Cell, MergeSpan, SheetSpec, _render_sheet_spec

def _roundtrip(spec: SheetSpec) -> bytes:
    wb = Workbook(); ws = wb.active; _render_sheet_spec(ws, spec)
    buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

def test_formula_like_and_illegal_strings_read_back_intact() -> None:
    data = _roundtrip(SheetSpec(title="S", rows=((Cell("h1"), Cell("h2")), (Cell("=> see table 2"), Cell("a\x0cb")))))
    df = pd.read_excel(io.BytesIO(data), "S", keep_default_na=False, na_values=[""])
    assert df.iloc[0, 0] == "=> see table 2"
    assert df.iloc[0, 1] == "ab"
    assert load_workbook(io.BytesIO(data))["S"]["A2"].data_type == "s"

def test_formula_like_string_in_merged_anchor_is_text() -> None:  # Review Focus 5
    spec = SheetSpec(title="S", rows=((Cell("=x"), Cell(None)),), merges=(MergeSpan(1, 1, 1, 2),))
    ws = load_workbook(io.BytesIO(_roundtrip(spec)))["S"]
    assert ws["A1"].value == "=x" and ws["A1"].data_type == "s"
```

- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_sheet_spec_hygiene.py -q`. Expected: FAIL. The first test raises `IllegalCharacterError` on `"a\x0cb"`, and `"=> see table 2"` reads back as NaN.
- [ ] Implement it in `_render_sheet_spec`: pass `_clean(cell.value)` to `ws.cell(...)`, then apply the `=` text rule to every anchor and unmerged cell.
- [ ] Run the test again. Expected: PASS.
- [ ] Commit: `fix(export): write formula-like and control-char strings as plain text`.

### Task 4: title pre-pass (`SheetTitles`, `allocate_titles`) and the sub-builder contract

**Files:**
- Modify:
  - `backend/app/services/exports/extraction/workbook.py`:
    - add `SheetTitles` and `allocate_titles`;
    - `_ordered_specs:180-221` takes `titles`;
    - `build_workbook:224-253` becomes `(layout, shape, *, include_matrix)` with no default;
    - delete `_SHEET_MAX_LEN:116` and `_unique_title:119-133`;
    - rename the builder id `"ai_metadata"` → `"ai_proposals"` at `:151` (`_SHAPE_BUILDERS`), `:164` (`_ARTICLE_BUILDERS`) and `:217` (`_ordered_specs`) (R8a).
  - Update both call sites in the same commit, with `include_matrix=True`: `backend/app/api/v1/endpoints/extraction_export.py:233` and `backend/app/worker/tasks/extraction_export_tasks.py:92`.
  - `exports/extraction/front_matter.py:21-71`: the Contents block renders from `titles.order` unconditionally. It moves out of the `if fm is not None and fm.contents:` guard at `:42`, so it renders even when `layout.front_matter is None`.
  - `summary.py:90`, `appraisal_summary.py:95`, `data_dictionary.py:37`, `dropdown_lists.py:17`, `ai_metadata.py:54`: each takes `titles` and reads its title from `titles.fixed[<role>]`. A conditional builder returns `None` when its role is absent from `titles.fixed`, and its own toggle checks move into `allocate_titles`. This deletes the literals `"Appraisal summary"` (`appraisal_summary.py:156`) and `"AI metadata"` (`ai_metadata.py:75`) (R7).
  - `matrix.py:43-44,55-57,166-172`: delete `_FORBIDDEN_SHEET_CHARS`, `_SHEET_MAX_LEN` and `_safe_sheet_name`. The title is `titles.fixed["matrix"]`, which is `"Matrix"` (R7); the `or "Export"` fallback at `:168` goes too.
  - `tidy_tables.py:15-23,39,47`: delete `_safe_sheet_name`, `_SHEET_MAX_LEN` and `_FORBIDDEN_SHEET_CHARS`. The title is `titles.levels[table.section_id]`.
  - `backend/app/services/extraction_export_service.py`: delete `FrontMatter.contents:205`, the contents assembly in `_build_front_matter:1845-1847` and `contents=tuple(contents)` at `:1857`.
- Test (rewritten, not mechanical):
  - `tests/unit/test_extraction_front_matter_builder.py`:
    - drop `contents=` at `:43` and `:112`;
    - rewrite `test_front_matter_lists_contents_and_legend:69` to assert that the rendered Contents rows equal the `titles.order` passed in.
  - `tests/unit/test_extraction_xlsx_builder.py`:
    - delete `test_sheet_name_is_sanitised_for_openpyxl_constraints:143`, which the `safe_sheet_title` tests now cover;
    - expected sheet names at `:127`, `:137` and `:641`, and `_open(data)["CHARMS"]` at `:175`, `:228`, `:270`, `:312`, `:322` and `:410`, become `"Matrix"`;
    - `"AI metadata"` at `:139`, `:361`, `:466`, `:520` becomes `"AI proposals"`; `"Appraisal summary"` at `:669`, `:673` becomes `"Appraisal"`;
    - drop `contents=` at `:590`.
  - `tests/unit/test_extraction_export_determinism.py`: drop `contents=` at `:106`; `wb_a/wb_b["AI metadata"]` at `:233-234` becomes `"AI proposals"`.
  - `tests/unit/test_extraction_export_shape_filter.py:147-152,172`: `"PROBAST"` → `"Matrix"`, `"Appraisal summary"` → `"Appraisal"`, `"AI metadata"` → `"AI proposals"`; the no-shape `build_workbook(...)` call at `:156` passes `ExportShape.COMPLETE, include_matrix=True`; the spy list at `:201` records role `"ai_proposals"` while patching `build_ai_metadata` (the loop at `:203` derives the function from the name, so it takes `(role, fn_name, result)` tuples), and `test_complete_shape_calls_every_builder:230` expects `"ai_proposals"` (R8a).
  - `tests/unit/test_extraction_ai_metadata_builder.py:60`: `spec.title == "AI proposals"`.
  - `tests/unit/test_extraction_export_front_matter_projection.py:70-71`: delete the `fm.contents` assertions.
  - `tests/integration/test_extraction_export_new_sheets.py:164`: the base set becomes `{"README", "Summary", "Matrix", "Data dictionary"}`.
  - `tests/integration/test_extraction_export_appraisal_summary.py:578-579,615,668`: `wb["Appraisal"]`.
  - `tests/integration/test_extraction_export_golden_structure.py`:
    - `_RESERVED:39` becomes `{"Summary", "Matrix", "Appraisal", "Data dictionary", "Dropdown lists", "AI proposals"}`;
    - `:172` asserts `titles[-1] == "AI proposals"` (docstring `:160` reworded);
    - `test_matrix_label_columns_are_section_and_field:201` reads `wb["Matrix"]`.
  - `tests/unit/test_extraction_workbook_orchestrator.py`: add the new tests. `test_sheet_order_without_ai:62` and `test_sheet_order_with_ai:71` now expect `"Matrix"`, and `:80` expects `"AI proposals"`.
- Test (mechanical, `(layout)` → `(layout, titles)` or `build_workbook(layout, ExportShape.COMPLETE, include_matrix=True)`):
  - `tests/unit/test_extraction_{ai_metadata,appraisal_summary,data_dictionary,dropdown_lists,matrix,summary,tidy_tables}_builder.py`
  - `test_appraisal_derived_overalls.py`, `test_extraction_export_{data_dictionary_projection,golden_charms,shape_filter,tidy_model_section,tidy_tables_projection}.py`, `test_extraction_workbook_package.py`
  - `tests/integration/test_extraction_export_appraisal_summary.py`

**Interfaces:**
- Produces `@dataclass(frozen=True, slots=True) class SheetTitles` with fields:
  - `fixed: Mapping[str, str]`, role → title. Roles are builder ids: `front_matter` → "README", `summary` → "Summary", `matrix` → "Matrix", `appraisal_summary` → "Appraisal", `data_dictionary` → "Data dictionary", `dropdown_lists` → "Dropdown lists", `ai_proposals` → "AI proposals" (R7, R8a).
  - `levels: Mapping[UUID, str]`, `TidyTable.section_id` → title.
  - `order: tuple[str, ...]`.
  - `matrix_omitted: bool`.
- Produces `def allocate_titles(layout: ExportLayout, shape: ExportShape, *, include_matrix: bool) -> SheetTitles`. Its rules:
  - A role is present when it is in `_SHAPE_BUILDERS[shape]` and its predicate holds:
    - `matrix`: `include_matrix`;
    - `appraisal_summary`: `layout.appraisal is not None`;
    - `dropdown_lists`: `any(e.allowed_values for e in layout.data_dictionary)`;
    - `ai_proposals`: `layout.include_ai_metadata` (R8, R8a).
  - `taken` starts as `RESERVED_TITLES` plus the two non-reserved fixed titles ("Data dictionary", "Dropdown lists"), whether or not they are present.
  - Level titles come from `safe_sheet_title(table.title, taken, fallback=f"Table {i + 1}")`, in `layout.tidy_tables` order.
  - `order` follows the `_ordered_specs` order.
  - `matrix_omitted = "matrix" in _SHAPE_BUILDERS[shape] and not include_matrix`.
- Produces the sub-builders `build_<x>(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None` (front matter, summary and data dictionary always return a `SheetSpec`) and `build_tidy_tables(layout, titles) -> list[SheetSpec]`.
- Produces `def build_workbook(layout: ExportLayout, shape: ExportShape, *, include_matrix: bool) -> bytes`.

- [ ] Write the failing tests in `test_extraction_workbook_orchestrator.py`. They reuse `_one_field_layout:23` and add a local `_table(title)` that returns `TidyTable(section_id=uuid4(), title=title, cardinality=ExtractionCardinality.ONE, column_field_ids=(), column_labels=(), rows=())`.

```python
def test_sections_named_history_and_data_get_suffixed_titles() -> None:
    layout = replace(_one_field_layout(include_ai=False), tidy_tables=(_table("history"), _table("data")))
    wb = load_workbook(io.BytesIO(build_workbook(layout, ExportShape.COMPLETE, include_matrix=True)))
    assert wb.sheetnames == ["README", "Summary", "Matrix", "history (2)", "data (2)", "Data dictionary"]

@pytest.mark.parametrize("shape", list(ExportShape))
@pytest.mark.parametrize("include_ai", [False, True])
def test_readme_contents_equal_sheetnames_for_every_shape(shape, include_ai) -> None:  # Review Focus 1
    layout = replace(_one_field_layout(include_ai=include_ai), tidy_tables=(_table("Sec"),))
    assert layout.front_matter is None  # contents must not depend on front_matter
    titles = allocate_titles(layout, shape, include_matrix=True)
    wb = load_workbook(io.BytesIO(build_workbook(layout, shape, include_matrix=True)))
    assert tuple(wb.sheetnames) == titles.order
    readme = [r[1] for r in wb["README"].iter_rows(values_only=True) if r[0] in ("", None) and r[1]]
    assert tuple(readme[: len(titles.order)]) == titles.order

def test_fixed_titles_are_the_reserved_names() -> None:  # Review Focus 6, R7
    layout = replace(_one_field_layout(include_ai=True), appraisal=_appraisal_model())
    t = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    assert (t.fixed["matrix"], t.fixed["appraisal_summary"], t.fixed["ai_proposals"]) == ("Matrix", "Appraisal", "AI proposals")
    assert {t.fixed[r] for r in ("matrix", "appraisal_summary", "ai_proposals")} <= set(RESERVED_TITLES)
```

`_appraisal_model()` is a local helper returning the one-row `AppraisalModel` built inline at `test_extraction_xlsx_builder.py:654` (`allocate_titles` only checks `layout.appraisal is not None`).

- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_workbook_orchestrator.py -q`. Expected: FAIL with `ImportError` (`allocate_titles`).
- [ ] Implement the changes. `build_workbook` calls `allocate_titles` once and renders `_ordered_specs(layout, shape, titles)`; it no longer de-duplicates titles.
- [ ] Run `cd backend && uv run pytest tests/unit -k "extraction or appraisal" -q` and `uv run pytest tests/integration/test_extraction_export_golden_structure.py tests/integration/test_extraction_export_new_sheets.py tests/integration/test_extraction_export_appraisal_summary.py tests/integration/test_worker_eager_mode.py -q`. Then run `cd backend && uv run mypy app/api/v1/endpoints/extraction_export.py app/worker/tasks/extraction_export_tasks.py app/services/exports/extraction`. Expected: PASS, with no mypy error.
- [ ] Run `grep -rn '"Appraisal summary"\|"AI metadata"\|"ai_metadata"\|"PROBAST"\]\|\["CHARMS"\]' backend/app backend/tests`. Expected: no hits.
- [ ] Commit: `feat(export): allocate every sheet title in one pre-pass`.

### Task 5: Matrix include-or-omit (delete the column guard)

**Files:**
- Modify:
  - `backend/app/services/exports/extraction/workbook.py`:
    - add `matrix_fits`;
    - delete `_EXCEL_MAX_COLUMNS:63`, `ExportColumnLimitError:66-86`, `_assert_within_column_limit:109-112` and its call at `:233`;
    - drop the `fastapi.status`/`AppError` imports and the `__all__` entry.
  - Both call sites (endpoint `:233`, task `:92`) pass `include_matrix=matrix_fits(layout)`.
  - `front_matter.py`: add a note row when `titles.matrix_omitted`. It renders from `titles`, independently of `layout.front_matter`.
  - Reword the comment-only mentions at `backend/app/api/v1/endpoints/project_templates.py:548` and `backend/app/services/template_versioning/_discard.py:133`, so that no reference to the deleted class remains.
- Test:
  - `backend/tests/unit/test_extraction_export_column_guard.py`: the guard tests `:90-140` are rewritten as `matrix_fits` tests, keeping `_wide_layout:40`.
  - `tests/unit/test_extraction_export_determinism.py:30-38,524-528`: change the import; the test becomes `assert matrix_fits(layout) is False`.
  - `tests/unit/test_extraction_workbook_orchestrator.py:84`: delete `test_column_guard_rejects_oversized_layout`.

**Interfaces:**
- Produces `def matrix_fits(layout: ExportLayout) -> bool`, which returns `_matrix_column_count(layout) <= EXCEL_MAX_COLUMNS`.
- The README note text is `"Matrix omitted: it would exceed Excel's 16,384-column limit. The values are in the other sheets."` It is driven by `SheetTitles.matrix_omitted`; PR4's README rewrite keeps it and keeps `test_oversized_matrix_is_omitted_with_a_readme_note` in its run list (R6).

- [ ] Write the failing tests.

```python
def test_matrix_fits_at_the_boundary_and_not_past_it() -> None:
    assert matrix_fits(_wide_layout(n_articles=1, n_subcols_each=16_382)) is True
    assert matrix_fits(_wide_layout(n_articles=1, n_subcols_each=16_383)) is False

def test_oversized_matrix_is_omitted_with_a_readme_note() -> None:
    layout = _wide_layout(n_articles=500, n_subcols_each=100)
    assert layout.front_matter is None
    wb = load_workbook(io.BytesIO(build_workbook(layout, ExportShape.COMPLETE, include_matrix=matrix_fits(layout))))
    assert "Matrix" not in wb.sheetnames
    assert any("Matrix omitted" in str(c) for r in wb["README"].iter_rows(values_only=True) for c in r if c)

def test_dictionary_shape_never_notes_a_matrix() -> None:
    layout = _wide_layout(n_articles=500, n_subcols_each=100)
    titles = allocate_titles(layout, ExportShape.DICTIONARY, include_matrix=False)
    assert titles.matrix_omitted is False and "Matrix" not in titles.order
```

- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_export_column_guard.py -q`. Expected: FAIL with `ImportError` (`matrix_fits`).
- [ ] Implement `matrix_fits`, the note and the call-site switch, then delete the guard.
- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_export_column_guard.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_workbook_orchestrator.py tests/unit/test_extraction_export_start_endpoint.py -q`. Expected: PASS.
- [ ] Run `grep -rn "ExportColumnLimitError\|_assert_within_column_limit\|_unique_title" backend/`. Expected: no hits.
- [ ] Commit: `feat(export): omit an oversized Matrix instead of refusing the export`.

### Task 6: `run.py`, with `authorize_export` and the `owned_template` guard

**Files:**
- Create: `backend/app/services/exports/extraction/run.py` (no more than 800 lines, `check_file_size.py:34`).
- Modify:
  - `backend/app/services/extraction_export_service.py:832-859`: `_load_active_template_version` calls `owned_template(self.db, project_id=project_id, template_id=template_id)` and maps `ProjectTemplateNotFoundError` to `NotFoundError("Project template")`. This deletes the inline query.
  - `scripts/fitness/check_scope_guards.baseline:7`: delete the line.
- Test: `backend/tests/integration/test_extraction_export_run.py` (new).
  - It uses `db_session` (`tests/conftest.py:133`) and `SEED` (`tests/integration/conftest.py:149`; `primary_profile`, `outsider_profile`, `primary_project`, `secondary_project`, `primary_article`, `primary_template`).
  - It defines a local helper `async def _insert_article(db, project_id, *, title) -> UUID`, which runs the raw `INSERT INTO public.articles (id, project_id, title, row_version)` used at `conftest.py:366-370`. No shared helper exists.
  - `tests/integration/test_extraction_export_template_bola.py` stays green unchanged.

**Interfaces:**
- Produces `XLSX_MIME: Final[str] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`, moved here from `endpoint:63`.
- Produces `@dataclass(frozen=True, slots=True) class ExportRequest` with fields:
  - `project_id: UUID; template_id: UUID; mode: ExportMode; article_ids: tuple[UUID, ...]`;
  - `reviewer_id: UUID | None; include_ai_metadata: bool; anonymize_reviewer_names: bool; shape: ExportShape`.
- Produces `async def authorize_export(db: AsyncSession, req: ExportRequest, *, user_id: str) -> None`. It raises `ValidationError` (the endpoint maps it to 400), `AuthorizationError` (403) or `NotFoundError` (404). **Contract amendment:** the §1 `authorize_export` row gains `ValidationError → 400 at the endpoint`. The order of checks:
  1. `SINGLE_USER` without `reviewer_id` raises `ValidationError("reviewer_id is required when mode=single_user.")`.
  2. `ExtractionExportService(db=db, user_id=user_id).assert_can_export(...)` (membership and manager) raises `AuthorizationError`.
  3. When `req.article_ids` is non-empty, `owned_articles(db, project_id=..., article_ids=req.article_ids)`. `ArticleNotFoundError` becomes `NotFoundError("Article")`.
  4. `owned_template(db, project_id=..., template_id=...)`. `ProjectTemplateNotFoundError` becomes `NotFoundError("Project template")`.

- [ ] Write the failing tests (`pytestmark = [pytest.mark.asyncio, pytest.mark.integration]`).

```python
def _req(**kw) -> ExportRequest:
    base = dict(project_id=SEED.primary_project, template_id=SEED.primary_template, mode=ExportMode.ALL_USERS,
                article_ids=(SEED.primary_article,), reviewer_id=None, include_ai_metadata=False,
                anonymize_reviewer_names=False, shape=ExportShape.COMPLETE)
    return ExportRequest(**{**base, **kw})

async def test_foreign_article_is_not_found(db_session) -> None:
    foreign = await _insert_article(db_session, SEED.secondary_project, title="FOREIGN-SENTINEL-TITLE")
    with pytest.raises(NotFoundError) as exc:
        await authorize_export(db_session, _req(article_ids=(foreign,)), user_id=str(SEED.primary_profile))
    assert "FOREIGN-SENTINEL-TITLE" not in exc.value.message

async def test_foreign_template_is_not_found(db_session) -> None:
    with pytest.raises(NotFoundError):
        await authorize_export(db_session, _req(project_id=SEED.secondary_project, article_ids=(),
                                                shape=ExportShape.DICTIONARY), user_id=str(SEED.primary_profile))

async def test_single_user_requires_reviewer_id(db_session) -> None:
    with pytest.raises(ValidationError):
        await authorize_export(db_session, _req(mode=ExportMode.SINGLE_USER), user_id=str(SEED.primary_profile))

async def test_authorize_checks_membership_before_ownership(db_session) -> None:  # Review Focus 4
    foreign = await _insert_article(db_session, SEED.secondary_project, title="X")
    with pytest.raises(AuthorizationError):
        await authorize_export(db_session, _req(mode=ExportMode.CONSENSUS, article_ids=(foreign,)),
                               user_id=str(SEED.outsider_profile))

async def test_owner_passes(db_session) -> None:
    await authorize_export(db_session, _req(), user_id=str(SEED.primary_profile))
```

- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_run.py -q`. Expected: FAIL with `ModuleNotFoundError: app.services.exports.extraction.run`.
- [ ] Implement `run.py` with `ExportRequest`, `XLSX_MIME` and `authorize_export`. `run.py` imports the service and `workbook`; the service never imports `run`. Then swap `_load_active_template_version` onto `owned_template` and delete baseline line 7.
- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_run.py tests/integration/test_extraction_export_template_bola.py -q && cd .. && python scripts/fitness/check_scope_guards.py`. Expected: PASS, and the gate is clean.
- [ ] Commit: `feat(export): authorize exports through the shared ownership guards`.

### Task 7: `build_export`, `ExportFile` and `EmptyExportError`

**Files:**
- Modify: `backend/app/services/exports/extraction/run.py`.
- Test:
  - `backend/tests/integration/test_extraction_export_run.py` (append): the empty check, the dictionary build and the filename.
  - `backend/tests/unit/test_extraction_export_run.py` (new): matrix omission. It patches `app.services.exports.extraction.run.ExtractionExportService` so that `resolve_layout` returns a local copy of `_wide_layout` (from `test_extraction_export_column_guard.py:40`). It also holds the Celery round-trip test, through `app.worker.celery_app.celery_app`.

**Interfaces:**
- Produces `@dataclass(frozen=True, slots=True) class ExportFile` with fields `content: bytes; filename: str; media_type: str = XLSX_MIME`.
- Produces `class EmptyExportError(AppError)`:
  - `def __init__(self, message: str = "EMPTY_ELIGIBLE_ARTICLES: No eligible articles for the selected mode + scope. Finalize at least one Run, then retry.") -> None`;
  - code `"EMPTY_ELIGIBLE_ARTICLES"`, status 422;
  - a single positional argument, so that Celery's `cls(*args)` rebuild works (contract F11).
- Produces `async def build_export(db: AsyncSession, req: ExportRequest, *, user_id: str, trace_id: str | None = None) -> ExportFile`. Its steps:
  1. `resolve_layout(...)`.
  2. When `not layout.articles and shape_needs_articles(req.shape)`, raise `EmptyExportError()`.
  3. `include_matrix = "matrix" in _SHAPE_BUILDERS[req.shape] and matrix_fits(layout)`. A non-matrix shape never computes the width.
  4. `await asyncio.to_thread(build_workbook, layout, req.shape, include_matrix=include_matrix)`.
  5. `ExtractionExportService.format_filename(project_name=layout.project_name, template_name=layout.template_name, mode=req.mode, generated_at=layout.notes.generated_at)`.

- [ ] Write the failing tests.

```python
# integration
async def test_build_export_refuses_an_empty_complete_export(db_session) -> None:
    await db_session.execute(text("DELETE FROM public.extraction_runs WHERE project_id = :p AND article_id = :a"),
                             {"p": str(SEED.primary_project), "a": str(SEED.primary_article)})
    with pytest.raises(EmptyExportError) as exc:
        await build_export(db_session, _req(mode=ExportMode.CONSENSUS), user_id=str(SEED.primary_profile))
    assert exc.value.code == "EMPTY_ELIGIBLE_ARTICLES"
    assert exc.value.message.startswith("EMPTY_ELIGIBLE_ARTICLES: ")

async def test_dictionary_export_with_no_articles_builds(db_session) -> None:
    file = await build_export(db_session, _req(mode=ExportMode.CONSENSUS, article_ids=(), shape=ExportShape.DICTIONARY),
                              user_id=str(SEED.primary_profile))
    assert file.filename.endswith(".xlsx") and "_consensus_" in file.filename
    assert load_workbook(io.BytesIO(file.content)).sheetnames[0] == "README"

# unit
async def test_build_export_omits_a_matrix_over_the_limit() -> None:  # COMPLETE -> "Matrix" not in sheetnames
async def test_dictionary_export_is_never_refused_for_matrix_width() -> None:  # wide layout, DICTIONARY -> ExportFile
def test_empty_export_error_survives_the_json_result_backend() -> None:  # Review Focus 3
    backend = celery_app.backend
    rebuilt = backend.exception_to_python(backend.prepare_exception(EmptyExportError()))
    assert str(rebuilt).startswith("EMPTY_ELIGIBLE_ARTICLES: ")
```

- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_run.py tests/unit/test_extraction_export_run.py -q`. Expected: FAIL with `ImportError` (`build_export`).
- [ ] Implement it.
- [ ] Run the tests again. Expected: PASS.
- [ ] Commit: `feat(export): build every export through one build_export entry point`.

### Task 8: the dictionary exemption for `article_ids`

This task lands before the endpoint wiring, so that the Task 9 HTTP tests can send a valid dictionary body with `[]`.

**Files:**
- Modify: `backend/app/schemas/extraction_export.py:68-72`:
  - drop `min_length=1`;
  - add `@model_validator(mode="after")`, which raises `ValueError("article_ids must not be empty unless shape=dictionary.")` when `not self.article_ids and self.shape is not ExtractionExportShape.DICTIONARY`;
  - the description becomes `"Candidate article ids (resolved by the caller per article_scope). May be empty only when shape=dictionary."`.
- Regenerate: `frontend/types/api/openapi.json` and `frontend/types/api/schema.d.ts`.
- Test:
  - `backend/tests/unit/test_extraction_export_schemas.py:84-87`;
  - `backend/tests/integration/test_extraction_export_http.py` (new; the dictionary test only, the rest comes in Task 9). It uses `db_client` (`tests/conftest.py:191`) and `auth_as_profile` (`tests/integration/conftest.py:789`).

**Interfaces:**
- `ExtractionExportRequest` keeps the same fields and wire values (§9).

- [ ] Write the failing tests:
  - `test_empty_list_rejected` becomes parametrized over `complete` and `publication` (both raise);
  - a new test asserts `ExtractionExportRequest(template_id=uuid4(), article_ids=[], shape="dictionary").article_ids == []`;
  - the HTTP test:

```python
_URL = "/api/v1/projects/{pid}/extraction-export"
_BODY = dict(template_id=str(SEED.primary_template), mode="consensus", article_ids=[], shape="dictionary")

async def test_dictionary_with_empty_article_ids_returns_200(db_client, auth_as_profile) -> None:
    res = await db_client.post(_URL.format(pid=SEED.primary_project), json=_BODY)
    assert res.status_code == 200 and "Data dictionary" in load_workbook(io.BytesIO(res.content)).sheetnames
```

- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_export_schemas.py tests/integration/test_extraction_export_http.py -q`. Expected: FAIL; the dictionary `[]` request hits `too_short` (422).
- [ ] Implement the validator, then run `npm run generate:api-types` from the repo root.
- [ ] Run the tests again. Expected: PASS. The default `article_scope=current_list` passes the endpoint's coherence block, which Task 9 deletes.
- [ ] Commit: `feat(export): accept an empty article list for a dictionary export`.

### Task 9: endpoint, CORS and Celery task wiring

**Files:**
- Modify:
  - `backend/app/main.py:170`: `expose_headers=["X-Trace-Id", "X-Response-Time", "Content-Disposition"]`.
  - `backend/app/api/v1/endpoints/extraction_export.py`:
    - add a private `_export_request(project_id: UUID, payload: ExtractionExportRequest) -> ExportRequest`;
    - delete the request-coherence block at `:142-156`. The `reviewer_id` rule moves into `authorize_export`. The `selected_only` 400 at `:150-156` is unreachable today: `[]` fails `min_length=1` with 422 before the handler runs. After Task 8 a non-dictionary `[]` still fails with 422 (model validator), and a dictionary is exempt per §3. Behaviour is unchanged for non-dictionary requests; the PR body says so (R22);
    - replace the service and auth gate at `:158-179` with `authorize_export`, mapping `AuthorizationError` to 403 `FORBIDDEN`, `NotFoundError` to 404 `NOT_FOUND` and `ValidationError` to 400 `VALIDATION_ERROR` (the status today);
    - replace the sync path at `:197-250` with `build_export`, mapping `EmptyExportError` to 422 with `exc.code` and `exc.message`. The `Response` headers are `Content-Disposition` and `X-Trace-Id` only, so the per-route expose header at `:247` is deleted;
    - drop the imports `build_workbook`, `shape_needs_articles`, `ExportShape`, `_XLSX_MIME` and `asyncio`. Keep `ExtractionExportService` and `ExportMode`, which the reviewer route uses at `:321` and `:332`; `ExportMode` also builds `ExportRequest`;
    - `_should_run_sync:104-110` is unchanged.
  - `backend/app/worker/tasks/extraction_export_tasks.py:59-111`:
    - import `build_export`, `ExportRequest` and `ExportShape` lazily inside the task body (the current pattern at `:63`), so a patch of `app.services.exports.extraction.run.build_export` applies;
    - build `ExportRequest` from the unchanged kwargs and call `build_export(session, req, user_id=user_id, trace_id=self.request.id)`;
    - upload to `f"{_STORAGE_PREFIX}/{user_id}/{self.request.id}/{file.filename}"` with `file.media_type`;
    - add no autoretry (contract F12).
- Test:
  - `backend/tests/integration/test_extraction_export_http.py` (append). It patches `app.api.v1.endpoints.extraction_export.export_extraction_task` and reuses `_insert_article` (copied locally, as in Task 6).
  - `backend/tests/unit/test_extraction_export_start_endpoint.py`:
    - retarget `_call_sync:58` and `_call_async:86` to patch `_EP.authorize_export` and `_EP.build_export` (`return_value=ExportFile(b"xlsx", "f.xlsx")`); shape assertions read `build.call_args.args[1].shape`;
    - the empty tests at `:162-178` become "`build_export` raises `EmptyExportError()` → 422, code `EMPTY_ELIGIBLE_ARTICLES`";
    - `test_dictionary_export_runs_with_no_finalized_runs:146` is covered by Task 7's integration test and is deleted here.
  - `backend/tests/integration/test_worker_eager_mode.py:84-140`: add `"shape": "dictionary"` to the kwargs; patch `app.services.exports.extraction.run.build_export` in place of the service and `build_workbook`; add the failure test. The autouse `eager_mode` fixture (`:36-40`) sets `task_eager_propagates=True`, so the failure test passes `throw=False` (`celery/app/task.py:816-817`).

**Interfaces:**
- Consumes `authorize_export`, `build_export`, `ExportRequest`, `ExportFile` and `EmptyExportError` (Tasks 6-7).
- Endpoint signature: `start_extraction_export(request, project_id, payload, db, user)`.

- [ ] Write the failing tests.

```python
# test_extraction_export_http.py (append)
async def test_an_origin_request_exposes_content_disposition(db_client, auth_as_profile) -> None:
    res = await db_client.post(_URL.format(pid=SEED.primary_project), json=_BODY,
                               headers={"Origin": "http://localhost:5173"})
    assert res.status_code == 200
    assert "content-disposition" in res.headers["access-control-expose-headers"].lower()
    assert res.headers["content-disposition"].startswith('attachment; filename="')

async def test_foreign_article_is_404_on_an_async_request(db_client, auth_as_profile, db_session) -> None:
    foreign = await _insert_article(db_session, SEED.secondary_project, title="FOREIGN-SENTINEL-TITLE")
    with patch(f"{_EP}.export_extraction_task") as task:
        res = await db_client.post(_URL.format(pid=SEED.primary_project),
                                   json={**_BODY, "mode": "all_users", "shape": "complete", "article_ids": [str(foreign)]})
    assert res.status_code == 404 and res.json()["error"]["code"] == "NOT_FOUND"
    assert "FOREIGN-SENTINEL-TITLE" not in res.text
    task.delay.assert_not_called()

async def test_foreign_template_is_404_on_an_async_request(db_client, auth_as_profile) -> None:
    with patch(f"{_EP}.export_extraction_task") as task:
        res = await db_client.post(_URL.format(pid=SEED.secondary_project), json={**_BODY, "mode": "all_users"})
    assert res.status_code == 404
    task.delay.assert_not_called()

@pytest.mark.parametrize("shape", ["complete", "publication"])
async def test_selected_only_with_empty_ids_stays_422_for_non_dictionary(db_client, auth_as_profile, shape) -> None:  # R22
    res = await db_client.post(_URL.format(pid=SEED.primary_project),
                               json={**_BODY, "shape": shape, "article_scope": "selected_only"})
    assert res.status_code == 422

# test_worker_eager_mode.py
def test_export_extraction_task_signature_and_kwargs_alignment() -> None:
    # kwargs gain "shape": "dictionary"; build_export patched -> ExportFile(b"PK..", "P_T_consensus_20261031-000000.xlsx")
    res = export_extraction_task.apply(kwargs=kwargs, task_id="job-1").get(timeout=5)
    assert fake_storage.upload.call_args.args[1] == f"exports/extraction/{kwargs['user_id']}/job-1/P_T_consensus_20261031-000000.xlsx"
    assert build_export.await_args.args[1].shape is ExportShape.DICTIONARY

def test_export_extraction_task_fails_with_a_coded_message_when_empty() -> None:
    # build_export side_effect=EmptyExportError()
    res = export_extraction_task.apply(kwargs=kwargs, throw=False)
    assert res.state == "FAILURE" and str(res.result).startswith("EMPTY_ELIGIBLE_ARTICLES: ")
    fake_storage.upload.assert_not_awaited()
```

- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_http.py tests/integration/test_worker_eager_mode.py tests/unit/test_extraction_export_start_endpoint.py -q`. The expected failures:
  - the CORS test returns 200 but `content-disposition` is missing from `access-control-expose-headers`, because the middleware overwrites the route's header (`starlette/middleware/cors.py:163`);
  - the async foreign-article test returns 202 and `delay` is called;
  - the async foreign-template test returns 202 and `delay` is called;
  - `test_selected_only_with_empty_ids_stays_422_for_non_dictionary` already PASSES: it pins the unchanged behaviour (R22) across the coherence-block deletion;
  - both eager tests fail inside `resolve_layout`. The unchanged task builds a real `ExtractionExportService` over `_FakeAsyncSession`, which has no `execute`, so the patched `build_export` is never awaited.
- [ ] Implement the changes in `main.py`, the endpoint and the task.
- [ ] Run the tests again. Expected: all PASS.
- [ ] Commit: `fix(export): expose Content-Disposition and authorize before the sync/async split`.

### Task 10: gates

- [ ] Run `make lint-backend`. Expected: clean (ruff and mypy).
- [ ] Run `cd backend && uv run pytest tests/unit -k "extraction or appraisal or worker" -q && uv run pytest tests/integration -k "extraction_export or worker_eager" -q`. Then run the full `make test-backend`, which needs the local Supabase stack. Coordinate before you touch the DB, and never reset it.
- [ ] Run `python scripts/fitness/check_file_size.py`. Expected: clean, with `extraction_export_service.py` at or under 2194 lines. If it shrank, run `python scripts/fitness/check_file_size.py --update-baseline backend/app/services/extraction_export_service.py`.
- [ ] Run `python scripts/fitness/check_scope_guards.py`. Expected: clean, with line 7 removed.
- [ ] Run `cd backend && uv run vulture > vulture.out || true; uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --input vulture.out`. Expected: no new finding. Add `--update` if an entry disappeared.
- [ ] Run `npm run generate:api-types` and confirm with `git -C "$WT" diff --stat frontend/types/api` that only the `article_ids` description and constraint changed.
- [ ] Run `npm run test:run` and `npm run lint` from the repo root. Expected: PASS. `frontend/services/__tests__/extractionExportService.test.ts` is unchanged and green.
- [ ] Run `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints`. Expected: 0.
- [ ] Run `git -C "$WT" status` to confirm every edit landed in the worktree. Then open the PR against `dev` (squash-merged, conventional title `feat(export): delivery and safety for the extraction export`). The PR body records:
  - the fixed sheet renames (R7): template-name Matrix → "Matrix", "Appraisal summary" → "Appraisal", "AI metadata" → "AI proposals";
  - the deleted `selected_only` 400 was unreachable (`min_length` → 422); non-dictionary `[]` still returns 422 (R22);
  - the AI role id is `ai_proposals` from PR1 (R8a); the module rename `ai_metadata.py` is PR5's;
  - the contract amendment that `authorize_export` may raise `ValidationError`, mapped to 400 `VALIDATION_ERROR` at the endpoint;
  - the dialog still blocks a zero-article dictionary export until PR6 relaxes the gate (R23).

## Rulings applied

- **R7:** `SheetTitles.fixed` sets "Matrix", "Appraisal", "AI proposals" (Task 4; Global Constraints; Review Focus 6). The "keep legacy names" out-of-scope line is gone.
- **R8:** the `ai_proposals` role's predicate (`include_ai_metadata`) lives in `allocate_titles`; PR5 adds `data`/`verification`; PR4 adds `articles` and `sheet_for`.
- **R8a:** PR1 renames the builder id `ai_metadata` → `ai_proposals` (`workbook.py:151,164,217`, `allocate_titles`, shape-filter spies `:201,230`, `t.fixed["ai_proposals"]` in Task 4); module/function rename stays in PR5. PR body records it and the `ValidationError` → 400 amendment.
- **R6:** the Matrix-omitted note is driven by `SheetTitles.matrix_omitted`; PR4 keeps it and Task 5's test.
- **R11:** PR4 rewrites PR1's Task 4 test `test_sections_named_history_and_data_get_suffixed_titles` with MANY sections; PR1 ships it as written.
- **R22:** unreachable `selected_only` check deleted; behaviour unchanged for non-dictionary requests, pinned by a Task 9 test and stated in the PR body.
- **R23, R5:** all dialog work (zero-article dictionary gate, `EXPORT_TOO_LARGE`, AI/anonymize copy) is PR6's.
- **R24:** PR1 is the only PR adding pandas (`"pandas>=3.0"`, dev group).
- **F20 (contract):** `EXPORT_CELL_BUDGET`/`ExportTooLargeError` stay in PR5.
