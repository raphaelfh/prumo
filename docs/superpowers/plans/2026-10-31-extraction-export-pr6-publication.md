---
status: in_progress
last_reviewed: 2026-11-01
owner: '@raphaelfh'
---

# PR6 Publication Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `shape=publication` becomes a paper-ready characteristics workbook. Its cells show display values (labels, numbers, NI/NA/NE with footnotes) and never machine codes or UUIDs. The export dialog uses reader-facing labels, offers anonymise in every mode, lets a Codebook export run with zero articles, and names an `EXPORT_TOO_LARGE` failure. Script readers get a README pandas snippet that keeps the `"None"`/`"N/A"` codes intact. An adjudicator gets a Member letter when the export is anonymised.

**Architecture:** The core is a new required `*, target: Literal["matrix", "publication"]` on `exports/values.display_value` (R2). PR3 shipped `display_value(v, field)` with the matrix rules only; PR6 adds the publication branch and passes `target="matrix"` at every existing caller in the same PR. Three builders consume the publication branch:
- the Publication branch of `build_level_tables(layout, titles, shape)` (PR4);
- the Appraisal builder, which already renders `ExportValue` verdicts through `display_value` (PR3, R3);
- the README reading snippet, which renders a text-column tuple derived from PR5's `DATA_COLUMNS` in `data_sheet.py`.

The frontend change is copy values in `frontend/lib/copy/extraction.ts`, two gate changes in `HITLExportDialog.tsx`, and one error-text helper shared by the dialog and `NotificationCenter.tsx`. PR6 owns every UI and schema-description change for `anonymize_reviewer_names` and `include_ai_metadata`, plus `generate:api-types` (R5).

**Tech Stack:** Python 3, openpyxl, pandas (dev dependency added by PR1, R24), pytest (unit, plus integration against local Supabase Postgres), React 19, Vitest with Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-extraction-export-options-design.md` sections:
- §3 (shapes and labels, anonymise in every mode, dictionary with `[]`)
- §4.1 (status set, scope stamp)
- §4.2 (Publication cells)
- §4.5 (reading snippet)
- §4.6 (display column)
- §5 rules 5 and 8, §12.3 (Overall (worst domain) only in the Review workbook)
- §6 (pseudonyms)
- §11 row 6

**Depends on (PR1–PR4 merged to `dev`; PR5 is this branch's base):**
- PR1: `exports/extraction/run.py` (`ExportRequest`, `build_export(db, req, *, user_id, trace_id=None) -> ExportFile`), `exports/extraction/workbook.py` (`ExportShape`, `SheetTitles`, `allocate_titles`), `build_workbook(layout, shape, *, include_matrix)`, sub-builders `build_<x>(layout, titles)`, fixed titles "Matrix" / "Appraisal" / "AI proposals" (R7), the dictionary `article_ids=[]` model validator, and pandas in `[dependency-groups] dev` (R24).
- PR3: `exports/values.py` (`ExportValue`, `to_export_value`, `display_value(v, field)` at :257, `machine_value`), `exports/descriptors.py` (`ValueKey`, `value_key`, `primary_rater` (R1)), `value_map: dict[ValueKey, ExportValue]`, `AppraisalRow.domain_verdicts: tuple[ExportValue | None, ...]` and `AppraisalModel.domain_fields: tuple[FieldDescriptor, ...]` (R3), unit tests in `tests/unit/test_export_values.py` (R20).
- PR4: `level_tables.py` (`build_level_tables`, Publication key headers `Article`/`DOI`/`PMID`), `FieldDescriptor.code` / `.allowed_units`, `exports/codebook_model.py` (`CodebookEntry` with `section_id`, `build_codebook_entries`), `SheetTitles.sheet_for`, `front_matter.build_front_matter(layout, titles)`, and the unit helper module `tests/unit/helpers/export_layouts.py` (`export_value`, `make_layout`) (R12).
- PR5: `data_sheet.py` (`DATA_COLUMNS` at :75, `value_bool` per D3), `verification.py`, `ExtractionExportService._load_rater_labels(self, *, project_id, anonymize, named_only=None)` (`extraction_export_service.py:1332`, delegating to `exports/rater_labels.label_raters`), `ExportTooLargeError` in `exports/extraction/run.py:92` (`EXPORT_TOO_LARGE`, 422, message prefix `"EXPORT_TOO_LARGE: "`), `estimate_sheet_cells(layout, shape)` in `workbook.py:333` (its local `footnotes = 5` in Publication, :342), `backend/tests/integration/helpers/export_fixtures.py` holding `make_run`, `record_decision`, `export_service` (R4), and in `tests/unit/helpers/export_layouts.py` `make_cell`, `ai_link`, `make_run_view_field` (R12). `make_layout` passes no `cells` / `rater_labels`; both fall back to the `ExportLayout` field defaults (empty mappings), and a test overrides them as `**over` kwargs.

Line numbers below are from `feat/export-data-provenance` @ f77e3649 (PR5 tip, PR #1076; PR1–PR4 on dev), backend and frontend alike; "dev :N" below means that base. Locate each symbol by name before editing.

**Branch:** `feat/export-publication`, stacked on `feat/export-data-provenance` (PR #1076) until that merges to `dev`.

## Global Constraints

- **Shape labels.** The `shape` wire values are unchanged. Only the UI labels change:
  - `complete` → **Review workbook**
  - `publication` → **Publication tables**
  - `dictionary` → **Codebook**
  - `include_ai_metadata` → "Include AI detail"
- **Publication sheet set:** README · Articles · level sheets · [Appraisal].
  - Headers are field labels.
  - The unit sits in the header ("Label (unit)"), or in each cell for `allowed_units` fields.
  - There are no `.unit` / `.other` companions and no UUID columns.
- **§4.6 Publication display:**

  | Value | Publication display |
  | --- | --- |
  | number | the number; `"n unit"` text for an `allowed_units` field |
  | nonconforming number | its raw `value_text` |
  | select | label (§4.4 chain), else the raw code |
  | multiselect | labels joined with `"; "` |
  | other | `"Other: …"` |
  | boolean | `Yes` / `No` |
  | date | ISO text |
  | absent marker | **NI / NA / NE, with a footnote** |
  | out-of-scope recorded value | **`NA*`, with a footnote** (D7) |
  | rejected / cleared | blank |

- **Scope-rule stamps.** A stamp is `status=absent`, `absent_code=not_applicable`, `out_of_scope=true` (§4.1). It is an absent marker, so it shows `NA`, not `NA*`.
- **Footnotes (D7).** Rows below each Publication table: one blank row, then one single-cell row per used marker, in the order NI, NA, NE, NA*. A sheet with no markers gets no extra rows.
- **NI/NA/NE placement.** The Matrix keeps the full label ("No information"). Data and the Review level sheets never carry NI/NA/NE.
- **Overall.** "Overall (worst domain)" appears only in the Review workbook. Template `derived_judgments` overalls appear in Appraisal in every shape (§5 rule 5) and keep their full text (D7).
- **README snippets, verbatim:**
  - `readxl::read_excel(path, "Data", guess_max = Inf)`
  - `pd.read_excel(path, "Data", keep_default_na=False, na_values=[""], dtype={<text columns>: str})`
- **Anonymised labels.** "Member A, B, …", ordered by each person's earliest reviewer **or consensus** decision, ties broken by id (PR5). The toggle is offered in every mode and role (§3, D4).
- **Test helpers (R12).** Unit layouts come only from `tests/unit/helpers/export_layouts.py`; PR6 extends it and creates no new helper module and no file-local layout builder. Unit cells come from PR5's `make_cell` / `ai_link` there. Integration run helpers come from `tests.integration.helpers.export_fixtures` (R4).
- **Language and copy.** English only. Copy goes through `frontend/lib/copy/`.

## Review Focus

1. **Falsy values vanish.** A Publication cell for `0` (number) or `False` (boolean) must render `0` / `"No"`, not blank. Test: Task 1.
2. **Scope stamp versus scope marker.** A stamp on an empty cell must show `NA` and footnote `NA`. Only a recorded out-of-scope value shows `NA*`. Test: Task 1.
3. **Every `display_value` caller passes `target`.** The kwarg is required; a missed caller is a runtime `TypeError`. Test: Task 1 Step 5 grep plus the full unit suite.
4. **Duplicate field labels in one Publication sheet.** Two fields labelled "Value" get distinct headers. Test: Task 2.
5. **Anonymise across a mode switch.** Ticking anonymise in All users and switching to Consensus must keep the box visibly ticked and still send `true`. Today the value is sent while the box is hidden (`HITLExportDialog.tsx:275`, gate at `:605`). Test: Task 6.
6. **`EXPORT_TOO_LARGE` reaches the user as words, not a code.** Sync (dialog failure list) and async (NotificationCenter toast and job line). Test: Task 7.

## Tasks

### Task 1: `target` on `display_value` and its Publication branch

**Files:**
- Modify: `backend/app/services/exports/values.py` (PR3; `display_value`)
- Modify: every `display_value(` caller from PR3–PR5 (see Step 5)
- Test: `backend/tests/unit/test_export_values.py` (PR3's file, R20; append)

**Interfaces:**
- Consumes:
  - `ExportValue` (PR3; `raw, status, value_num, value_text, value_bool, value_label, unit, other_text, absent_code, out_of_scope`)
  - `FieldDescriptor` (`extraction_export_service.py:142`; `unit`, `allowed_units` from PR4)
  - `ABSENT_REASON_LABELS` (`value_semantics.py:68`)
  - `export_value(status="answered", **over)` (PR4 `export_layouts.py`)
- Produces, in `values.py`:
  - `def display_value(v: ExportValue, field: FieldDescriptor, *, target: Literal["matrix", "publication"]) -> CellValue`. `target="matrix"` is PR3's rule list unchanged (it checks `out_of_scope` first and renders "Not applicable"). `CellValue` stays a TYPE_CHECKING import (values.py must not import `exports/extraction` at runtime; see its module docstring).
  - `PUBLICATION_ABSENT_CODES: Final[Mapping[str, str]] = {"no_information": "NI", "not_applicable": "NA", "not_evaluated": "NE"}`
  - `SCOPE_MARKER: Final[str] = "NA*"` (D7)
  - `def footnote_key(v: ExportValue) -> str | None`. The abbreviation when `v.status == "absent"`; else `SCOPE_MARKER` when `v.out_of_scope and v.status not in {"rejected", "cleared"}`; else `None`.
  - `def publication_footnotes(used: Collection[str]) -> tuple[str, ...]`. Fixed order NI, NA, NE, `SCOPE_MARKER`.
    - Each abbreviation line is `f"{abbr} = {ABSENT_REASON_LABELS[code]}"`.
    - The scope line is `"NA* = Not applicable under the template's scope rule; the recorded value is kept in the Review workbook (Data sheet)."`

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/test_export_values.py`). The file already imports `pytest`, `uuid4`, `ExtractionFieldType`, `FieldDescriptor`, `ABSENT_REASON_LABELS` and `display_value`; extend the existing `from app.services.exports.values import ...` line rather than adding a second one. Its `_field(ftype, *, options, unit, allow_other)` helper has no `allowed_units`, hence the new `_f`.

```python
from app.services.exports.values import SCOPE_MARKER, display_value, footnote_key, publication_footnotes
from tests.unit.helpers.export_layouts import export_value as _ev

def _f(t, **kw) -> FieldDescriptor:
    return FieldDescriptor(field_id=uuid4(), label="Sample size", type=t, allowed_values=(), **kw)

def test_publication_number_is_the_bare_number_with_fixed_unit():
    f = _f(ExtractionFieldType.NUMBER, unit="participants")
    assert display_value(_ev(value_num=7394), f, target="publication") == 7394
    assert display_value(_ev(value_num=7394), f, target="matrix") == "7394 participants"

def test_publication_number_with_allowed_units_carries_unit_in_cell():
    f = _f(ExtractionFieldType.NUMBER, allowed_units=("mg", "g"))
    assert display_value(_ev(value_num=5, unit="mg"), f, target="publication") == "5 mg"

def test_publication_nonconforming_number_keeps_raw_text():
    v = _ev("nonconforming", value_text="approx 50")
    assert display_value(v, _f(ExtractionFieldType.NUMBER), target="publication") == "approx 50"

@pytest.mark.parametrize(("code", "abbr"), [("no_information", "NI"), ("not_applicable", "NA"), ("not_evaluated", "NE")])
def test_absent_marker_is_abbreviated_only_in_publication(code, abbr):
    v = _ev("absent", absent_code=code)
    f = _f(ExtractionFieldType.TEXT)
    assert display_value(v, f, target="publication") == abbr
    assert display_value(v, f, target="matrix") == ABSENT_REASON_LABELS[code]
    assert footnote_key(v) == abbr

def test_scope_stamp_on_empty_cell_is_plain_na():  # Review Focus 2
    v = _ev("absent", absent_code="not_applicable", out_of_scope=True)
    assert display_value(v, _f(ExtractionFieldType.NUMBER), target="publication") == "NA"
    assert footnote_key(v) == "NA"

def test_out_of_scope_recorded_value_shows_scope_marker():
    v = _ev(value_num=12, out_of_scope=True)
    assert display_value(v, _f(ExtractionFieldType.NUMBER), target="publication") == SCOPE_MARKER == "NA*"
    assert footnote_key(v) == SCOPE_MARKER

def test_publication_select_multiselect_other_date_rejected():
    sel = _f(ExtractionFieldType.SELECT)
    assert display_value(_ev(value_text="L", value_label="Low"), sel, target="publication") == "Low"
    assert display_value(_ev(value_text="L"), sel, target="publication") == "L"
    multi = _f(ExtractionFieldType.MULTISELECT)
    assert display_value(_ev(value_text="a; b", value_label="Alpha; Beta"), multi, target="publication") == "Alpha; Beta"
    assert display_value(_ev(other_text="custom"), sel, target="publication") == "Other: custom"
    assert display_value(_ev(value_text="2024-01-31"), _f(ExtractionFieldType.DATE), target="publication") == "2024-01-31"
    assert display_value(_ev("rejected"), sel, target="publication") is None
    assert display_value(_ev("cleared", out_of_scope=True), sel, target="publication") is None
    assert footnote_key(_ev("cleared", out_of_scope=True)) is None

def test_publication_falsy_values_are_not_blank():  # Review Focus 1
    assert display_value(_ev(value_num=0), _f(ExtractionFieldType.NUMBER), target="publication") == 0
    assert display_value(_ev(value_bool=False), _f(ExtractionFieldType.BOOLEAN), target="publication") == "No"

def test_footnotes_fixed_order_only_used():
    assert publication_footnotes({"NE", "NI"}) == ("NI = No information", "NE = Not evaluated")
    assert publication_footnotes(set()) == ()
    assert publication_footnotes({SCOPE_MARKER, "NA"})[0] == "NA = Not applicable"
    assert publication_footnotes({SCOPE_MARKER})[0].startswith("NA* = ")
```

- [ ] **Step 2: Run it.** `cd backend && uv run pytest tests/unit/test_export_values.py -q`
  - Expected: FAIL with `ImportError` (`SCOPE_MARKER`, `footnote_key`, `publication_footnotes`).
- [ ] **Step 3: Implement** in `values.py`: add `target` (keyword-only, no default) and the publication branch. Precedence:
  1. `status` ∈ {`rejected`, `cleared`} → `None`.
  2. `status == "absent"` → `PUBLICATION_ABSENT_CODES[v.absent_code]`.
  3. `v.out_of_scope` → `SCOPE_MARKER`.
  4. **number** with `v.value_num is not None` → `v.value_num` when `not field.allowed_units`, else the matrix `"n unit"` text.
  5. Everything else, including a `nonconforming` number → the matrix branch.

  Use `is None` checks, never truthiness. Mirror the same precedence in `footnote_key`.
- [ ] **Step 4: Update every caller (R2).** `grep -rn "display_value(" backend/app backend/tests | grep -v app/api/mcp/`. Add `target="matrix"` to every hit that is not a new publication call. Hits at the PR5 tip (confirm each by the grep, not this list):
  - app, PR3: `extraction_export_service.py:729` (`_build_appraisal_model._overall`, the Overall input), `exports/extraction/matrix.py:205` (cell), `exports/extraction/summary.py:64` (filled check), `exports/extraction/appraisal_summary.py:149` (verdict cells, R3);
  - app, PR4: `exports/extraction/level_tables.py:66`, the Publication branch of `_field_cells` (the only call there: Review cells use `machine_value`; Task 2 switches it to `target="publication"`);
  - app, PR5: `exports/extraction/verification.py:154` (`_shown`, reviewer and Consensus cells; also reword its docstring "(R2, no ``target``)") and `:200` (the [AI] column);
  - tests: `tests/unit/test_export_values.py` (PR3 calls, :42–:164), `tests/unit/test_extraction_front_matter_builder.py:263` (legend anti-drift), `tests/unit/test_extraction_appraisal_model_resolution.py:64` (`_shown`), `tests/integration/test_qa_rules_frozen.py:326`.
  - Not callers: `app/api/mcp/draft_diff.py:90` defines an unrelated `display_value(value)` used there and in `app/api/mcp/template_changes.py:101-102`; leave both. The AI sheet (`ai_proposals.py`) writes the machine scalar (D6) and never calls it; `_tidy_value`, `final_value_used`, `ai_proposed_value` and `_untyped_field` no longer exist.
- [ ] **Step 5: Run it.**
  - `grep -rn "display_value(" backend/app backend/tests | grep -v app/api/mcp/ | grep -v "target="`. Expected: only the `def display_value(` line in `values.py` (multi-line calls: read each remaining hit).
  - `cd backend && uv run pytest tests/unit tests/integration/test_qa_rules_frozen.py -q`. Expected: PASS, no `TypeError: display_value() missing 1 required keyword-only argument: 'target'`.
- [ ] **Step 6: Commit.** `feat(export): publication display values with NI/NA/NE and scope marker`

### Task 2: Publication level sheets (display cells, label headers, footnotes)

**Files:**
- Modify: `backend/app/services/exports/extraction/level_tables.py` (PR4; the Publication branch of `build_level_tables`)
- Modify: `backend/tests/unit/helpers/export_layouts.py` (PR4; add `make_article`)
- Test: `backend/tests/unit/test_extraction_level_tables_builder.py` (PR4's file; append). It already has file-local `_f`, `_s`, `_art`, `_sheets(layout, shape)`, `_values`, `_field_of` (field/section/article/sheet helpers, not layout builders); reuse them. Update `test_publication_has_label_headers_and_no_uuid` (:298): its `:327` expectation `"81 %"` becomes `81` (a fixed-unit number is bare in Publication; the header keeps "AUC (%)").
- Modify: `backend/tests/integration/test_extraction_export_appraisal_summary.py` (`test_qa_out_of_scope_domain_reads_not_applicable_end_to_end`, :703-706): the two Publication "Risk of bias" headers become "Risk of bias" and "Risk of bias (2)", and the out-of-scope recorded "High" reads `NA*`, not "Not applicable" (D7). The Review-workbook Appraisal assertions at :680-686 stay.
- Test: `backend/tests/integration/test_extraction_export_publication_markers.py` (new; §11 row 6, this PR's red-first integration test)

**Interfaces:**
- Consumes:
  - `build_level_tables(layout, titles, shape) -> list[SheetSpec]` (PR4; `level_tables.py:207`). It computes `publication = shape == "publication"` (:214) and threads the bool into `_field_headers(f, publication)` (:52) and `_field_cells(v, f, publication)` (:64); Articles title is `titles.fixed["articles"]`. Today's Publication header is `f"{f.label} ({f.unit})" if f.unit else f.label`, ignoring `allowed_units`.
  - `allocate_titles(layout, shape, *, include_matrix) -> SheetTitles` (PR1)
  - `ExportRequest`, `build_export(db, req, *, user_id, trace_id=None) -> ExportFile` (PR1)
  - `value_key(run_id, instance_id, field_id, rater=None)` (PR3); CONSENSUS → `primary_rater(...) is None` (R1)
  - `make_layout(*, sections=(), articles=(), value_map=None, mode=ExportMode.CONSENSUS, reviewers=(), **over)`, `export_value` (PR4)
  - `from tests.integration.helpers.export_fixtures import make_run` (PR5, R4)
  - `SEED` (`tests/integration/conftest.py:149`), `db_session` (`tests/conftest.py:133`)
  - `ExtractionConsensusService.record_consensus(*, run_id, instance_id, field_id, consensus_user_id, mode, selected_decision_id=None, value=None, rationale=None, enforce_contract=True)` (`extraction_consensus_service.py:50`), `RunLifecycleService.advance_stage(*, run_id, target_stage, user_id)` (`run_lifecycle_service.py:177`; PENDING → EXTRACT → CONSENSUS → FINALIZED, `_ALLOWED_TRANSITIONS` :92)
  - Task 1 symbols
- Produces, in `level_tables.py`:
  - `def publication_header(field: FieldDescriptor) -> str`. `field.label` when `field.allowed_units` is set or `field.unit` is blank; otherwise `f"{field.label} ({field.unit})"`. It replaces the Publication branch of `_field_headers`.
  - Duplicate headers within one sheet get `" (2)"`, `" (3)"`, … in field order.
  - Footnote block (D7): after the last data row, one empty row, then one single-cell row per `publication_footnotes(used)`, where `used` is the set of non-`None` `footnote_key` values on that sheet.
  - At most 5 extra rows (1 blank + NI, NA, NE, NA*): fits PR5's `footnotes` (+5) Publication row headroom on Articles and level sheets in `estimate_sheet_cells` (`workbook.py:342`); no budget change here.
- Produces, in `export_layouts.py`:
  - `def make_article(*, section_id: UUID, label: str) -> tuple[ArticleDescriptor, UUID, UUID]`. Returns the article, `run_id` and `instance_id`, with `entries={(section_id, None): (instance_id,)}` and `article_label=label`.

- [ ] **Step 1: Write the failing unit tests.**
  - One root ONE section `participants`:
    - `n`: NUMBER, label "Sample size", `unit="participants"`
    - `dose`: NUMBER, label "Dose", `allowed_units=("mg","g")`
    - `risk`: SELECT, label "Risk", options `AllowedValue("L","Low")`
    - `age`, `sex`, `site`: TEXT, labels "Age", "Sex", "Site"
  - "Smith 2020": `n=7394`, `dose=5 mg`, `risk="L"` (`value_label="Low"`), absent `no_information` / `not_applicable` / `not_evaluated` on age / sex / site.
  - "Jones 2021": `n=12` with `out_of_scope=True`.
  - Layouts are `make_layout(sections=..., articles=..., value_map=...)` with values keyed `value_key(run_id, instance_id, field_id)`; the section and value dicts are module constants, not a layout builder (R12). Build sections and fields with the file's `_s` / `_f`; `make_layout` stamps rule-3 codes onto copies, so key values by the module-constant field ids.

```python
def _publication_articles(layout):
    return next(s for s in _sheets(layout, ExportShape.PUBLICATION) if s.title == "Articles")

def test_publication_articles_sheet_shows_display_cells_and_footnotes():
    spec = _publication_articles(make_layout(sections=(PARTICIPANTS,), articles=ARTICLES, value_map=MARKED_VALUES))
    header = [c.value for c in spec.rows[0]]
    assert header[0] == "Article"
    assert "Sample size (participants)" in header
    assert "Dose" in header and "Dose (mg)" not in header
    assert not any(isinstance(h, str) and h.endswith((".unit", ".other")) for h in header)
    row1 = dict(zip(header, (c.value for c in spec.rows[1])))
    assert (row1["Sample size (participants)"], row1["Dose"], row1["Risk"]) == (7394, "5 mg", "Low")
    assert (row1["Age"], row1["Sex"], row1["Site"]) == ("NI", "NA", "NE")
    row2 = dict(zip(header, (c.value for c in spec.rows[2])))
    assert row2["Sample size (participants)"] == SCOPE_MARKER
    assert all(c.value is None for c in spec.rows[3])
    assert [r[0].value for r in spec.rows[4:]] == list(publication_footnotes({"NI", "NA", "NE", SCOPE_MARKER}))

def test_publication_sheet_without_markers_has_no_footnote_rows():
    spec = _publication_articles(make_layout(sections=(PARTICIPANTS,), articles=ARTICLES, value_map=ANSWERED_VALUES))
    assert len(spec.rows) == 3  # header + 2 articles

def test_publication_duplicate_labels_get_distinct_headers():  # Review Focus 4
    spec = _publication_articles(make_layout(sections=(TWO_VALUE_FIELDS,), articles=ONE_ARTICLE, value_map={}))
    header = [c.value for c in spec.rows[0]]
    assert header.count("Value") == 1 and "Value (2)" in header

def test_review_workbook_level_sheet_never_abbreviates():
    layout = make_layout(sections=(PARTICIPANTS,), articles=ARTICLES, value_map=MARKED_VALUES)
    titles = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    cells = {c.value for s in build_level_tables(layout, titles, ExportShape.COMPLETE) for r in s.rows for c in r}
    assert cells & {"NI", "NA", "NE", SCOPE_MARKER} == set()
```

- [ ] **Step 2: Write the failing integration test** (§11 row 6). `pytestmark = [pytest.mark.asyncio, pytest.mark.integration]`.
  - Seed (`SEED.primary_field` is the NUMBER field `sample_size`): `run = await make_run(db, project_id=SEED.primary_project, article_id=SEED.primary_article, template_id=SEED.primary_template, profile_id=SEED.primary_profile)`; when `run.stage == ExtractionRunStage.PENDING.value`, `advance_stage(..., EXTRACT)` first (as `test_extraction_export_data_sheet.py:47-50`); `advance_stage(..., CONSENSUS)`; `record_consensus(run_id=run.id, instance_id=SEED.primary_instance, field_id=SEED.primary_field, consensus_user_id=SEED.primary_profile, mode=ExtractionConsensusMode.MANUAL_OVERRIDE, value={"value": {"value": None, "absent_reason": "no_information"}}, rationale="publication markers", enforce_contract=False)`; `advance_stage(..., FINALIZED)`.

```python
async def test_ni_appears_only_in_publication(db_session):
    await _seed_finalized_absent_run(db_session)  # the three calls above, inline in this file
    def req(shape):
        return ExportRequest(project_id=SEED.primary_project, template_id=SEED.primary_template,
                             mode=ExportMode.CONSENSUS, article_ids=(SEED.primary_article,), reviewer_id=None,
                             include_ai_metadata=False, anonymize_reviewer_names=False, shape=shape)
    def values(out):
        wb = load_workbook(io.BytesIO(out.content))
        return {c.value for ws in wb.worksheets for row in ws.iter_rows() for c in row if c.value is not None}
    uid = str(SEED.primary_profile)
    complete = values(await build_export(db_session, req(ExportShape.COMPLETE), user_id=uid))
    pub = values(await build_export(db_session, req(ExportShape.PUBLICATION), user_id=uid))
    assert "NI" in pub and "NI = No information" in pub
    assert complete & {"NI", "NA", "NE", SCOPE_MARKER} == set()
```

- [ ] **Step 3: Run both.**
  - `cd backend && uv run pytest tests/unit/test_extraction_level_tables_builder.py tests/integration/test_extraction_export_publication_markers.py -q` (needs local Supabase).
  - Expected: FAIL. Publication cells still use `target="matrix"` ("No information", not `"NI"`), headers lack "(unit)", and there are no footnote rows.
- [ ] **Step 4: Implement.** In the Publication branch (`publication=True` in `_field_headers` / `_field_cells`, plus the footnote block in `_articles_sheet` / `_level_sheet` before `_sheet(...)`):
  - field headers via `publication_header(field)`, deduplicated per sheet;
  - cells via `display_value(v, field, target="publication")` (replacing Task 1's `target="matrix"` there);
  - collect `footnote_key(v)` per sheet and append the footnote block.

  The Review branch is unchanged.
- [ ] **Step 5: Run it.** Same command, plus `uv run pytest tests/unit -q -k "level_tables or matrix"` and `uv run pytest tests/integration/test_extraction_export_cell_budget.py tests/integration/test_extraction_export_appraisal_summary.py -q` (PR5 bound still holds with footnotes; the updated out-of-scope Publication assertions). Expected: PASS with no regressions.
- [ ] **Step 6: Commit.** `feat(export): publication level sheets with label headers, display cells and footnotes`

### Task 3: Appraisal in Publication: display cells, no worst-domain Overall

PR3 already holds `ExportValue` verdicts, `AppraisalModel.domain_fields`, and renders through `display_value` inside the builder (R3). PR6 adds only the shape parameter and the target choice.

**Files:**
- Modify: `backend/app/services/exports/extraction/appraisal_summary.py` (`build_appraisal_summary`, :99; `_OVERALL_COL` :22, appended at :131 when no `derived_labels`; per-reviewer `Overall — …` columns :140-143; verdict cells :148-151; `column_widths` :162-168)
- Modify: `backend/app/services/exports/extraction/workbook.py` (the `appraisal_summary` dispatch in `_ordered_specs`, :291-292; `estimate_sheet_cells` (PR5, :333): `appraisal_cells()` (:352-357) adds the existing `footnotes` local (:342) to its row count, since PR5 applies it only to Articles and level sheets)
- Modify callers (`grep -rn "build_appraisal_summary(" backend/tests`), each passing `ExportShape.COMPLETE`:
  - `backend/tests/unit/test_extraction_export_determinism.py` (:542, :545, :593, :603)
  - `backend/tests/unit/test_appraisal_derived_overalls.py` (:76, :100, :137, :168; module-level `_TITLES`)
  - `backend/tests/unit/test_extraction_appraisal_summary_builder.py` (:134, :161, :202, :237, :273)
  - `tests/unit/test_extraction_export_shape_filter.py`'s `_spy` (:166) already takes `*_shape`: no change.
- Test: `backend/tests/unit/test_extraction_appraisal_summary_builder.py` (append)

**Interfaces:**
- Consumes: `AppraisalModel(domain_section_ids, domain_labels, domain_fields, rows, derived_labels=())`, `AppraisalRow(article_id, record_label, domain_verdicts: tuple[ExportValue | None, ...], overall, per_reviewer_overall, derived_values=())` (PR3; `extraction_export_service.py:260`, `:278`); `AllowedValue` (re-exported by `extraction_export_service`, as the test file's :12 imports it); `display_value`, `footnote_key`, `publication_footnotes` (Task 1); `make_layout`, `export_value` (PR4); `estimate_sheet_cells` (`workbook.py`).
- Produces: `def build_appraisal_summary(layout: ExportLayout, titles: SheetTitles, shape: ExportShape) -> SheetSpec | None`. A deliberate deviation from the `(layout, titles)` sub-builder contract: §5 rule 8 / §12.3 make the Overall column shape-dependent.
  - **Publication:** drops `_OVERALL_COL` and the per-reviewer `Overall — …` columns; keeps the `derived_labels` columns with their full text (D7); renders verdicts with `target="publication"`; appends the Task 2 footnote block.
  - **Review workbook:** unchanged (`target="matrix"`).

- [ ] **Step 1: Write the failing tests.**

```python
_RISK = FieldDescriptor(field_id=uuid.uuid4(), label="Risk", type=ExtractionFieldType.SELECT,
                        allowed_values=(AllowedValue("low", "Low"), AllowedValue("high", "High")))

def _appraisal(derived_labels=(), derived_values=()):
    return AppraisalModel(
        domain_section_ids=(uuid.uuid4(), uuid.uuid4()),
        domain_labels=("Participants", "Predictors"),
        domain_fields=(_RISK, _RISK),
        rows=(AppraisalRow(article_id=uuid.uuid4(), record_label="Gaca 2011",
                           domain_verdicts=(export_value("absent", absent_code="no_information"),
                                            export_value(value_text="high", value_label="High")),
                           overall="High", per_reviewer_overall={}, derived_values=derived_values),),
        derived_labels=derived_labels,
    )

def _build(appraisal, shape):
    layout = make_layout(appraisal=appraisal)
    return build_appraisal_summary(layout, allocate_titles(layout, shape, include_matrix=False), shape)

def test_publication_appraisal_drops_worst_domain_overall_and_abbreviates():
    pub = _build(_appraisal(), ExportShape.PUBLICATION)
    assert "Overall" not in [c.value for c in pub.rows[0]]
    assert [c.value for c in pub.rows[1]][1:3] == ["NI", "High"]
    assert "NI = No information" in {r[0].value for r in pub.rows[2:] if r}
    review = _build(_appraisal(), ExportShape.COMPLETE)
    assert "Overall" in [c.value for c in review.rows[0]]
    assert [c.value for c in review.rows[1]][1] == "No information"

def test_publication_appraisal_keeps_derived_overalls_in_full_text():  # D7
    pub = _build(_appraisal(("Overall risk of bias (evaluation)",), ("Not applicable",)), ExportShape.PUBLICATION)
    header = [c.value for c in pub.rows[0]]
    row = dict(zip(header, (c.value for c in pub.rows[1])))
    assert row["Overall risk of bias (evaluation)"] == "Not applicable"

def test_publication_appraisal_fits_cell_estimate():  # footnotes add up to 5 rows
    layout = make_layout(appraisal=_appraisal())
    pub = _build(_appraisal(), ExportShape.PUBLICATION)
    assert estimate_sheet_cells(layout, ExportShape.PUBLICATION)["appraisal_summary"] >= len(pub.rows) * max(len(r) for r in pub.rows)
```

- [ ] **Step 2: Run it.** `cd backend && uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py -q`
  - Expected: FAIL with `TypeError: build_appraisal_summary() takes 2 positional arguments but 3 were given`.
- [ ] **Step 3: Implement.** Add `shape`; pass it from the `workbook.py` dispatch; gate the legacy and per-reviewer Overall columns on `shape is ExportShape.COMPLETE`; pick `target` by shape; append footnotes in Publication; in `estimate_sheet_cells`'s `appraisal_cells()`, use `(len(a.rows) + 1 + footnotes) * width`. Update every caller listed under Files.
- [ ] **Step 4: Run it.** `uv run pytest tests/unit/test_extraction_appraisal_summary_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_appraisal_derived_overalls.py tests/integration/test_extraction_export_cell_budget.py -q`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): appraisal publication view without worst-domain overall`

### Task 4: README reading snippet and the "None"/"N/A" round-trip

**Files:**
- Modify: `backend/app/services/exports/extraction/data_sheet.py` (PR5): the typed set and the derived text columns, after `DATA_COLUMNS` (:75).
- Modify: `backend/app/services/exports/extraction/front_matter.py` (`build_front_matter(layout, titles)`, :148, PR4): a "Reading this file" block. `front_matter.py` already imports from `data_sheet` (`LINEAGE_EXACT_SINCE`, `Origin`, `origin_counts`), so the new import adds no cycle.
- Test: `backend/tests/unit/test_extraction_readme_snippet_roundtrip.py` (new)


**Interfaces:**
- Consumes: `DATA_COLUMNS` (PR5, 27 names; `value_bool` after `value_text`, D3); `make_layout` (its `option_labels` kwarg feeds the Codebook, PR4), `make_article` (Task 2), `export_value`, `make_cell` (PR5); `build_workbook(layout, shape, *, include_matrix)` (PR1). No hand-built `CodebookEntry` (R12): `make_layout` derives `codebook` from `sections`.
- Produces, in `data_sheet.py`:
  - `DATA_TYPED_COLUMNS: Final[frozenset[str]] = frozenset({"value_num", "value_bool", "out_of_scope", "ai_proposed", "n_raters_with_value", "decided_at"})`. `decided_at` is typed: PR5 writes a naive-UTC `datetime` cell (`_naive_utc`, `data_sheet.py:213`), never `isoformat()` text, so `dtype=str` must not coerce it.
  - `DATA_TEXT_COLUMNS: Final[tuple[str, ...]] = tuple(c for c in DATA_COLUMNS if c not in DATA_TYPED_COLUMNS)`
  - `R_READ_SNIPPET: Final[str] = 'readxl::read_excel(path, "Data", guess_max = Inf)'`
  - `def pandas_read_snippet() -> str`. The verbatim pandas snippet with `<text columns>` expanded to `{"article_id": str, ...}` from `DATA_TEXT_COLUMNS`.

- [ ] **Step 1: Write the failing test.**
  - Module constants: one root ONE section with one SELECT field whose `allowed_values` are `AllowedValue("None","None")` and `AllowedValue("N/A","N/A")` (CHARMS seeds `None`, `seed.py:1254`; no seed has `N/A`, so the test plants it); two `make_article` articles; `value_map` with consensus keys holding `export_value(value_text="None", value_label="None")` and `export_value(value_text="N/A", value_label="N/A")`; `cells` with `make_cell({"value": code}, actor_id=uuid4())` on the same keys (a decided cell, not a stamp); `option_labels={(fid, "None"): "None", (fid, "N/A"): "N/A"}`.

```python
def _xlsx():
    layout = make_layout(sections=(SECTION,), articles=ARTICLES, value_map=VALUES, cells=CELLS, option_labels=LABELS)
    return build_workbook(layout, ExportShape.COMPLETE, include_matrix=True)

def test_none_and_na_codes_read_back_intact_with_readme_snippet():
    xlsx = _xlsx()
    readme = {c.value for row in load_workbook(io.BytesIO(xlsx))["README"].iter_rows() for c in row if isinstance(c.value, str)}
    assert pandas_read_snippet() in readme and R_READ_SNIPPET in readme
    df = pd.read_excel(io.BytesIO(xlsx), "Data", keep_default_na=False, na_values=[""],
                       dtype={c: str for c in DATA_TEXT_COLUMNS})
    assert sorted(df["value_text"].tolist()) == ["N/A", "None"]
    assert sorted(df["value_label"].tolist()) == ["N/A", "None"]
    assert pd.read_excel(io.BytesIO(xlsx), "Data")["value_text"].isna().all()  # pandas defaults lose both

def test_options_codes_read_back_intact():
    opts = pd.read_excel(io.BytesIO(_xlsx()), "Options", keep_default_na=False, na_values=[""], dtype=str)
    assert {"None", "N/A"} <= set(opts["code"])

def test_text_columns_cover_every_data_column_but_the_typed_ones():
    assert set(DATA_TEXT_COLUMNS) | DATA_TYPED_COLUMNS == set(DATA_COLUMNS)
    assert DATA_TYPED_COLUMNS <= set(DATA_COLUMNS)
```

- [ ] **Step 2: Run it.** `cd backend && uv run pytest tests/unit/test_extraction_readme_snippet_roundtrip.py -q`
  - Expected: FAIL with `ImportError` (`DATA_TEXT_COLUMNS`, `pandas_read_snippet`).
- [ ] **Step 3: Implement.** Add the constants. In `build_front_matter`, add `rows.extend(_block("Reading this file"))` followed by `(Cell(""), Cell(line, _WRAP))` rows, the same pattern as the Lineage / Notes / Caveats blocks (:176-182). The three lines are: `R_READ_SNIPPET`, `pandas_read_snippet()`, `"Blank is the only missing marker."` The README carries the same rows in every shape.
- [ ] **Step 4: Run it.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): README reading snippets that keep None/N/A codes`

### Task 5: Adjudicator Member letter (regression pin)

Not red-first: PR5 owns the reviewer-or-consensus ordering. The PR's red-first backend test is Task 2's integration test.

**Files:**
- Test: `backend/tests/integration/test_extraction_export_member_letters.py` (new)

**Interfaces:**
- Consumes:
  - `ExportRequest`, `build_export` (PR1)
  - `_load_rater_labels(self, *, project_id, anonymize, named_only=None) -> dict[UUID, str]` (PR5, `extraction_export_service.py:1332`; letters by `label_raters` in `exports/rater_labels.py`)
  - `from tests.integration.helpers.export_fixtures import make_run, record_decision, export_service` (PR5, R4; `record_decision(db, *, run_id, instance_id, field_id, reviewer_id, decision, proposal_record_id=None, value=None)`, `export_service(db, *, profile_id)`)
  - `SEED` (`tests/integration/conftest.py:149`; `primary_profile`, `reviewer_profile` (full name "Integration Reviewer", `conftest.py:308`), `primary_instance`, `primary_field` = NUMBER `sample_size`), `db_session`
  - Data columns `rater`, `decided_by` (`DATA_COLUMNS`); Verification tail column `consensus_by` (`verification.py:46-53`)
  - `RunLifecycleService.advance_stage`, `ExtractionConsensusService.record_consensus`

- [ ] **Step 1: Write the test.** `pytestmark = [pytest.mark.asyncio, pytest.mark.integration]`.

```python
async def test_adjudicator_without_reviewer_decisions_gets_a_member_letter(db_session):
    run = await make_run(db_session, project_id=SEED.primary_project, article_id=SEED.primary_article,
                          template_id=SEED.primary_template, profile_id=SEED.primary_profile)
    lifecycle = RunLifecycleService(db_session)
    if run.stage == ExtractionRunStage.PENDING.value:  # PENDING may only advance to EXTRACT
        await lifecycle.advance_stage(run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=SEED.primary_profile)
    await record_decision(db_session, run_id=run.id, instance_id=SEED.primary_instance,
                           field_id=SEED.primary_field, reviewer_id=SEED.reviewer_profile,
                           decision=ExtractionReviewerDecisionType.EDIT, value={"value": 10})
    await lifecycle.advance_stage(run_id=run.id, target_stage=ExtractionRunStage.CONSENSUS, user_id=SEED.primary_profile)
    await ExtractionConsensusService(db_session).record_consensus(
        run_id=run.id, instance_id=SEED.primary_instance, field_id=SEED.primary_field,
        consensus_user_id=SEED.primary_profile, mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"value": 12}, rationale="adjudicated")
    await lifecycle.advance_stage(run_id=run.id, target_stage=ExtractionRunStage.FINALIZED, user_id=SEED.primary_profile)

    labels = await export_service(db_session, profile_id=SEED.primary_profile)._load_rater_labels(
        project_id=SEED.primary_project, anonymize=True)
    assert re.fullmatch(r"Member [A-Z]+", labels[SEED.primary_profile])
    assert labels[SEED.primary_profile] != labels[SEED.reviewer_profile]

    out = await build_export(db_session, ExportRequest(
        project_id=SEED.primary_project, template_id=SEED.primary_template, mode=ExportMode.ALL_USERS,
        article_ids=(SEED.primary_article,), reviewer_id=None, include_ai_metadata=False,
        anonymize_reviewer_names=True, shape=ExportShape.COMPLETE), user_id=str(SEED.primary_profile))
    wb = load_workbook(io.BytesIO(out.content))
    consensus = [r for r in _rows_as_dicts(wb["Data"]) if r["rater"] == "consensus"]  # local: header -> dict per row
    assert consensus and {r["decided_by"] for r in consensus} == {labels[SEED.primary_profile]}
    assert {r["consensus_by"] for r in _rows_as_dicts(wb["Verification"])} == {labels[SEED.primary_profile]}
    assert "Integration Reviewer" not in {c.value for ws in wb.worksheets for row in ws.iter_rows() for c in row}
```

- [ ] **Step 2: Run it.** `cd backend && uv run pytest tests/integration/test_extraction_export_member_letters.py -q` (needs local Supabase).
  - Expected: PASS. A `KeyError: SEED.primary_profile` means PR5's map ignores consensus decisions: a PR5 defect. Stop and report it; do not patch it here.
- [ ] **Step 3: Commit.** `test(export): pin adjudicator Member letter in anonymised exports`

### Task 6: Dialog relabel, anonymise in every mode, schema descriptions (R5)

**Files:**
- Modify: `frontend/lib/copy/extraction.ts` (dev :420-434, :445). Values only; key names unchanged.
- Modify: `frontend/components/hitl/HITLExportDialog.tsx:605`. Drop the `mode === "all_users" && isManager &&` gate, keeping the wrapper `div`.
- Modify: `backend/app/schemas/extraction_export.py` (unconditional, R5):
  - `include_ai_metadata` (dev :73-76) → `"Adds the AI proposals sheet and, in All users mode, an AI column in Verification."`
  - `anonymize_reviewer_names` (dev :79-82) → `"Replaces names with Member A/B/… in every mode, adjudicators included."`
- Regenerate: `frontend/types/api/schema.d.ts` (:4793 anonymize, :4809 AI) and `frontend/types/api/openapi.json` (:6377, :6397) via `npm run generate:api-types`.
- Test: `frontend/components/hitl/HITLExportDialog.test.tsx`. Delete `:301-314`; edit `:8`, `:227`, `:450-461`; add three tests.

New copy values:

| key | value |
| --- | --- |
| `exportShapeComplete` | `'Review workbook'` |
| `exportShapeCompleteDesc` | `'Every sheet for analysis and verification: tidy level sheets, the Data sheet, the codebook and, when it fits, the matrix.'` |
| `exportShapeDictionary` | `'Codebook'` |
| `exportShapeDictionaryDesc` | `'The codebook and its options, for wiring R or Python to this template before any run is finalized.'` |
| `exportShapePublicationDesc` | `'Characteristics tables with NI/NA/NE codes and DOIs, ready to paste into a manuscript.'` |
| `exportIncludeAiMetadata` | `'Include AI detail'` |
| `exportIncludeAiMetadataDesc` | `'Adds the AI proposals sheet and, in All users mode, an AI column in Verification.'` |
| `exportAnonymizeReviewersDesc` | `'Replace names with Member A / B / … everywhere in the file, adjudicators included.'` |
| `exportPreviewLineDictionaryFmt` | `"Will export this template's codebook → {delivery}"` |

- [ ] **Step 1: Write failing tests.**

```tsx
it("labels the shapes for their readers (§3)", () => {
    renderDialog();
    expect(screen.getByLabelText(/Review workbook/i)).toBeChecked();
    expect(screen.getByLabelText(/^Codebook$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Publication tables/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Include AI detail/i)).not.toBeChecked();
});

it("offers anonymize in every mode and role (§3)", async () => {
    const user = userEvent.setup();
    renderDialog({isManager: false});
    expect(screen.getByLabelText(/Anonymize reviewer names/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Single user/i));
    expect(screen.getByLabelText(/Anonymize reviewer names/i)).toBeInTheDocument();
});

it("keeps anonymize ticked and sent across a mode switch", async () => {  // Review Focus 5
    startExportMock.mockResolvedValueOnce({kind: "sync", blob: new Blob(["x"]), filename: "x.xlsx"});
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByLabelText(/All users/i));
    await user.click(screen.getByLabelText(/Anonymize reviewer names/i));
    await user.click(screen.getByLabelText("Consensus"));
    expect(screen.getByLabelText(/Anonymize reviewer names/i)).toBeChecked();
    await user.click(screen.getByTestId("extraction-export-submit"));
    await waitFor(() => expect(startExportMock).toHaveBeenCalled());
    expect(startExportMock.mock.calls[0][1]).toMatchObject({mode: "consensus", anonymize_reviewer_names: true});
});
```

  Edits to existing tests: delete the gating test at `:301-314`; `:227` `/Include AI metadata sheet/i` → `/Include AI detail/i`; `:455` `/Data dictionary only/i` → `/^Codebook$/i`; `:461` `/field catalogue/i` → `/codebook/i`; update the comments at `:8` / `:450`.

- [ ] **Step 2: Run it.** `npx vitest run frontend/components/hitl/HITLExportDialog.test.tsx` (repo root).
  - Expected: FAIL. No label matches `/Review workbook/i`; the anonymize checkbox is absent in Consensus.
- [ ] **Step 3: Implement.** Apply the copy values, remove the gate, edit the two schema descriptions, then `npm run generate:api-types`.
- [ ] **Step 4: Run it.** Same command, plus `npm run typecheck` and `git diff --stat frontend/types/api` (expect exactly the two description lines in each file).
- [ ] **Step 5: Commit** (with the regenerated types). `feat(export-dialog): reader-facing shape labels and anonymize in every mode`

### Task 7: Codebook with zero articles, and `EXPORT_TOO_LARGE` text (R23)

**Files:**
- Create: `frontend/lib/extraction-export-errors.ts`
- Modify: `frontend/components/hitl/HITLExportDialog.tsx`:
  - `canSubmit` (dev :232-233): `(articleCount > 0 || shape === "dictionary") && modeReady && selectedTemplateIds.length > 0 && !submitting`
  - the empty-scope reason (dev :640-644): render only when `articleCount === 0 && shape !== "dictionary"`
  - `failureMessage` (dev :116-121): after the 429 branch, return `extractionExportErrorText(error instanceof ApiError ? error.code : undefined, error.message)`
- Modify: `frontend/components/navigation/NotificationCenter.tsx`:
  - the `extraction-export` failed line (dev :618-619): `extractionExportErrorText(undefined, job.error)`
  - `onJobFailed` (dev :199-213): an `extraction-export` branch that toasts `extractionExportErrorText(undefined, job.error)`
- Modify: `frontend/lib/copy/extraction.ts`: add `exportTooLarge: 'This export is too large for one file. Export fewer articles, or choose Publication tables or Codebook.'`
- Test: `frontend/components/hitl/HITLExportDialog.test.tsx` (two tests), `frontend/components/navigation/__tests__/NotificationCenter.test.tsx` (one test)

**Interfaces:**
- Consumes: `ApiError(code, message, status)` (`frontend/integrations/api/client.ts:67-71`); PR5's `ExportTooLargeError` (sync: `ApiError("EXPORT_TOO_LARGE", …, 422)`; async: `ExtractionExportStatus.error` (`frontend/types/extraction-export.ts:46`) on `status: "failed"`, starting `"EXPORT_TOO_LARGE: "`, copied to `job.error` by the poll at `NotificationCenter.tsx:102`); PR1's dictionary `article_ids=[]` acceptance (`_require_articles_unless_dictionary`, `backend/app/schemas/extraction_export.py:88-91`).
- Produces: `export function extractionExportErrorText(code: string | undefined, message: string | undefined): string`. Returns `t("extraction", "exportTooLarge")` when `code === "EXPORT_TOO_LARGE"` or `message?.startsWith("EXPORT_TOO_LARGE: ")`; else `message || t("extraction", "exportFailedToast")`. The code literal stays module-private (knip).

- [ ] **Step 1: Write failing tests.**

```tsx
it("submits a Codebook export with zero articles (§3)", async () => {
    startExportMock.mockResolvedValueOnce({kind: "sync", blob: new Blob(["x"]), filename: "x.xlsx"});
    const user = userEvent.setup();
    renderDialog({currentListIds: []});
    expect(screen.getByTestId("extraction-export-submit")).toBeDisabled();
    await user.click(screen.getByLabelText(/^Codebook$/i));
    expect(screen.queryByText(/No articles in scope/i)).not.toBeInTheDocument();
    await user.click(screen.getByTestId("extraction-export-submit"));
    await waitFor(() => expect(startExportMock).toHaveBeenCalled());
    expect(startExportMock.mock.calls[0][1]).toMatchObject({shape: "dictionary", article_ids: []});
});

it("names a too-large export in words, not a code", async () => {  // Review Focus 6
    startExportMock.mockRejectedValueOnce(
        new ApiError("EXPORT_TOO_LARGE", "EXPORT_TOO_LARGE: this export would write 9,000,000 cells", 422));
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByTestId("extraction-export-submit"));
    const failures = await screen.findByTestId("extraction-export-failures");
    expect(failures).toHaveTextContent(/too large for one file/i);
    expect(failures).not.toHaveTextContent(/EXPORT_TOO_LARGE/);
});
```

  In `NotificationCenter.test.tsx`, following its existing extraction-export polling setup (the `beforeEach` default at :121-128 and the per-test `vi.mocked(getExtractionExportStatus).mockResolvedValue(...)` override at :270-271; no failed-export test exists yet): a status response `{status: "failed", error: "EXPORT_TOO_LARGE: this export would write 9,000,000 cells; …"}` yields `toast.error` called with a string matching `/too large for one file/i` and not containing `EXPORT_TOO_LARGE`.

- [ ] **Step 2: Run it.** `npx vitest run frontend/components/hitl/HITLExportDialog.test.tsx frontend/components/navigation/__tests__/NotificationCenter.test.tsx`
  - Expected: FAIL. The submit button stays disabled with zero articles; the failure text shows the raw `EXPORT_TOO_LARGE: …` message.
- [ ] **Step 3: Implement** the helper, the two dialog changes, the two NotificationCenter call sites and the copy key.
- [ ] **Step 4: Run it.** Same command, plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export-dialog): codebook export without articles and a readable too-large error`

### Task 8: E2E selectors

**Files:**
- Modify: `frontend/e2e/flows/extraction-export.e2e.ts`
  - `:15`: header comment, now "AI detail".
  - `:225`: test title, now "AI detail".
  - `:326-334`: defaults comment and selectors.
  - `:361-379`: rewrite as "anonymize toggle is available in every mode": visible under Consensus and still visible after `getByLabel(/Single user/i).check()`. Drop the manager skip.
- Modify: `frontend/e2e/flows/qa-export.e2e.ts`
  - `:69`: `/Complete workbook/i` → `/Review workbook/i`
  - `:79`: `/Data dictionary only/i` → `/^Codebook$/i`

- [ ] **Step 1: Edit the selectors.** `:328` → `getByLabel(/Review workbook/i)`; `:330` → `getByLabel(/Include AI detail/i)`; `:333-334` → `.toBeVisible()` plus `.not.toBeChecked()`.
- [ ] **Step 2: See red against the old copy.** Tasks 6–7 are committed, so restore the pre-Task-6 copy into the working tree:
  1. `git show HEAD~2:frontend/lib/copy/extraction.ts > frontend/lib/copy/extraction.ts`
  2. `npx playwright test --project=local-api frontend/e2e/flows/extraction-export.e2e.ts` (needs `make start`). Expected: FAIL; locator `/Review workbook/i` not found.
  3. `git checkout -- frontend/lib/copy/extraction.ts`
- [ ] **Step 3: Run green.**
  - `npx playwright test --project=local-api frontend/e2e/flows/extraction-export.e2e.ts`
  - `npx playwright test --project=local-hitl frontend/e2e/flows/qa-export.e2e.ts`

  Expected: PASS, or skip-on-missing-env exactly as today.
- [ ] **Step 4: Commit.** `test(e2e): export dialog selectors follow the new labels`

### Task 9: Gates

- [ ] `make lint-backend`: clean.
- [ ] Targeted backend tests: all pass.

  ```
  cd backend && uv run pytest tests/unit/test_export_values.py tests/unit/test_extraction_level_tables_builder.py tests/unit/test_extraction_appraisal_summary_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_appraisal_derived_overalls.py tests/unit/test_extraction_readme_snippet_roundtrip.py tests/integration/test_extraction_export_publication_markers.py tests/integration/test_extraction_export_member_letters.py tests/integration/test_extraction_export_cell_budget.py -q
  ```
- [ ] `make test-backend` (local Supabase): no regressions.
- [ ] `npm run test:run`, `npm run lint`, `npm run typecheck`: clean.
- [ ] `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints`: zero findings.
- [ ] `python3 scripts/fitness/check_copy_keys.py`: passes; the only new key is `exportTooLarge`, which is used.
- [ ] `python3 scripts/fitness/check_scope_guards.py`: baseline unchanged.
- [ ] `npm run generate:api-types && git diff --exit-code frontend/types/api`: no diff (Task 6 committed the regenerated types).
- [ ] `python3 scripts/fitness/check_file_size.py`: `values.py`, `level_tables.py`, `front_matter.py`, `data_sheet.py` ≤ 800 lines; `extraction_export_service.py` within its baseline (`scripts/fitness/check_file_size.baseline:4`, as PR5 left it).
- [ ] `cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec` (as `.github/workflows/ci.yml:71`). PR6 deletes no symbol, so the baseline is unchanged.
- [ ] `make quality-scan`: green.

## Rulings applied

- **R2:** `display_value` gains required `*, target`; Task 1 Step 4 updates every PR3–PR5 caller (service appraisal Overall, matrix, summary, appraisal_summary, level_tables, verification ×2, three unit test files, one integration test file) to `target="matrix"`; the unrelated MCP `display_value` is out of scope.
- **R3:** verdicts stay `ExportValue`; `domain_fields` (required, no default) and in-builder rendering come from PR3; PR6 adds no model field. Task 3 adds only `shape` and the target choice; the service edits are gone.
- **R4:** `make_run` / `record_decision` / `export_service` are imported from `tests.integration.helpers.export_fixtures` (PR5; Tasks 2, 5).
- **R5:** PR6 owns the anonymise gate, both toggle descriptions in copy and schema, and `generate:api-types`, unconditionally (Task 6).
- **R7:** assumes PR1's "Appraisal" / "AI proposals" titles.
- **R12:** `make_export_value` / `helpers/export_values.py` / `helpers/export_layout.py` are dropped. PR6 uses PR4's `export_layouts.py` (`export_value`, `make_layout`), consumes PR5's `make_cell` / `ai_link` there, adds only `make_article`, passes `option_labels` as PR4's `make_layout` kwarg (no helper edit), and builds no `CodebookEntry` by hand (it has `section_id`, not `sheet`).
- **R20:** publication value tests go in `tests/unit/test_export_values.py`.
- **R23:** Task 7 relaxes the dialog gate for `shape=dictionary` with zero articles and maps `EXPORT_TOO_LARGE` to copy in the dialog (sync) and NotificationCenter (async).
- **R24:** no pandas step; PR1 ships the dev dependency.
- **D3:** `value_bool` is a typed Data column in `DATA_TYPED_COLUMNS`.
- **D4:** the anonymise toggle shows for every role.
- **D7:** footnotes are rows below each table; the scope marker is `NA*`; derived overalls keep full text.
