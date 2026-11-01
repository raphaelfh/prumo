---
status: in_progress
last_reviewed: 2026-11-01
owner: '@raphaelfh'
---

# PR5 Data, Verification and AI provenance: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three sheets: the machine-readable `Data` sheet, the `Verification` sheet (all_users only) and the reworked `AI proposals` sheet. All three read from one pair of provenance loaders that return `CellRecord`. The PR also adds one project-wide rater/pseudonym map and the export cell budget. It deletes the AI-outcome heuristic and the "best-effort" caveat. Backend only: the dialog, copy and schema-description work for `anonymize_reviewer_names`/`include_ai_metadata` belongs to PR6 (R5).

**Architecture:**
- **Loaders.** Two loaders feed `layout.cells`:
  - `_load_reviewer_cells` reads current reviewer decisions and LEFT JOINs each one's linked proposal.
  - `_load_consensus_cells` reads published states. It LEFT JOINs the latest consensus decision (`DISTINCT ON`), then the selected decision's linked proposal (D10).
- **Value map.** `value_map` becomes one pure projection of `cells` per mode, under PR3's keys (R1: reviewer slots keyed by `reviewer_id`, consensus by `None`; no re-keying here). This replaces the three `_build_*_value_map` builders and the duplicated consensus query.
- **Pinned fields.** `layout.pinned_fields` comes from PR4's single `_load_pinned_versions` pass (R14). PR4 shipped `VersionSections` without `run_view_fields` (dropped as unread in c3c1102e); Task 6 re-adds it with its first reader. No second version load.
- **Origin.** Origin is computed only in the pure builders (`data_sheet.py`, `verification.py`). It compares against the run's pinned `RunViewField` through `values.canonical_keys`, which applies the both-sides fallback.
- **Budget.** `build_export` refuses a build whose `estimate_cells` exceeds `EXPORT_CELL_BUDGET`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, openpyxl and Celery. Tests use pytest; integration tests run against real Postgres.

**Spec:** `docs/superpowers/specs/2026-10-30-extraction-export-options-design.md`. Sections in scope:
- §4.1, §4.3, §6 (rater/pseudonym map, backend) and all of §7.
- §8 rows for `data_sheet.py`, `verification.py`, `ai_metadata.py` (renamed `ai_proposals.py` here, R8a), the service loaders and `run_lifecycle_service.py`.
- §11 row 5.
- §13: the cost of the provenance join and the cell-budget value.

**Depends on:**
- PR1: `exports/extraction/run.py` (`build_export(db, req, *, user_id, trace_id=None)`, `ExportRequest`, `EmptyExportError`), `exports/extraction/workbook.py` (`SheetTitles`, `allocate_titles(layout, shape, *, include_matrix)`, `matrix_fits`, `_SHAPE_BUILDERS`, `_ARTICLE_BUILDERS`, `_FIXED_TITLES`, `_ROLE_ORDER`, `_role_present`, `_ordered_specs`), `safe_sheet_title` and `RESERVED_TITLES` (already holds `"Data"`) in `exports/extraction/sheet_spec.py`; fixed titles "Matrix", "Appraisal", "AI proposals" (R7); the `ai_proposals` role id, title and `include_ai_metadata` predicate, already named so by PR1 (R8, R8a). PR5 renames no role.
- PR2: the write path, **released to prod** at 2026-10-31T21:41:32Z (recorded on PR #1067), so `LINEAGE_EXACT_SINCE = date(2026, 10, 31)` (R21).
- PR3: `exports/values.py` (`ExportValue`, `to_export_value(raw, field, labels, *, rejected=False)`, `display_value(v, field)` with no `target` (R2), `OptionLabels`, `peel_envelope(raw) -> PeeledValue(value, unit, absent_reason)`), `value_key` / `ValueKey`, `primary_rater(mode, reviewer_id)` in `exports/descriptors.py` (R1), the scope fix, `tests/unit/test_export_values.py` (R20).
- PR4 (names per R13): `_load_article_refs`, `_load_pinned_versions(*, template_id, versions)` returning `VersionSections(version_id, version_label, sections)` (R14; `VersionSections` lives in `exports/codebook_model.py`; `run_view_fields` was deferred to PR5, Task 6) and exposed as `ExportLayout.versions` (active first), `record_label`, `level_of`, `walk_sections`, `record_keys(article, instance_id, sections) -> (record_id, parent_record_id, section | None)` (R18), `iter_records`, `ArticleDescriptor.article_label` / `keyed_labels`, `CodebookEntry` in `exports/codebook_model.py` with `section_id` (R12), `layout.raters_by_run` and `_list_reviewers_for_runs(*, run_ids, anonymize) -> (reviewers, raters_by_run)` with its test `test_raters_by_run_groups_reviewers_per_run` (R16), the `articles` role and `SheetTitles.sheet_for(section_id)` (`"Articles"` for `None`, `None` for a section outside the active tree; R8), the README row "Values outside any level sheet" (R17), `level_tables`, and `tests/unit/helpers/export_layouts.py` (`export_value`, `make_layout`, R12).

**Branch:** `feat/export-data-provenance`, stacked on PR4's `feat/export-levels-codebook` (PR #1075, not yet on `dev`); rebase onto `dev` once #1075 merges.

All line numbers are from `feat/export-levels-codebook` @ 7fe8d678 (PR4 head, PR1–PR3 included). Earlier PR5 tasks move them, so find each symbol by name before editing.

## Global Constraints

**Data sheet (§4.1)**
- There is one row per (`article_id`, `instance_id`, `field_id`, `rater`).
- The sheet is sparse: only recorded values and scope-rule stamps appear.
- The columns, in this order (27 in total):
  - Keys: `article_id, article_label, sheet, record_id, parent_record_id, instance_id, record_label, field_id, field_code, rater`.
  - Value: `status, value_num, value_text, value_bool, value_label, unit, other_text, absent_code, out_of_scope`. `value_bool` holds an Excel boolean (D3). `unit` is the envelope unit only (D9).
  - Lineage: `origin, ai_proposed, ai_proposal_id, decided_by, decided_at, rationale`.
  - Consensus only: `consensus_method, n_raters_with_value`. These two columns are always present and are blank on reviewer rows.
- `rater` is the reserved literal `consensus` on consensus rows, in every mode.
- In `all_users`, each coordinate has one consensus row next to its reviewer rows.
- `sheet` is `titles.sheet_for(section.entity_type_id)`, where `section` is the third element of `record_keys(article, instance_id, layout.sections)`, and only when `field_id` is one of `section.fields`. Otherwise it is blank: an instance whose section is outside the active tree, a removed field, or an orphan field (D10). Never call `sheet_for(None)`: it answers `"Articles"`, which would point a value at a sheet that does not hold it.

**Closed value sets**
- `status ∈ {answered, absent, rejected, cleared, nonconforming}`.
- `origin ∈ {ai_accepted, ai_edited, human, rule, mixed}`. `mixed` appears on consensus rows only.
- `consensus_method ∈ {select_existing, no_conflict, override}`.
- A scope-rule stamp is `status=absent`, `absent_code=not_applicable`, `out_of_scope=true`, `origin=rule`.

**Origin rules (§7)**
- `ai_accepted`: the cell links to a `source=ai` proposal and is canonically equal to it.
- `ai_edited`: the cell links to a `source=ai` proposal and differs from it.
- `human`: the cell is unlinked, or it links to a proposal that is not `ai` (`reopen_run` seeds `source=system` proposals, `run_lifecycle_service.py:634-645`).
- Consensus rows:
  - `select_existing`: the origin of the selected decision's own link (D10), even when that decision is no longer current.
  - `no_conflict`: a `manual_override` whose rationale `== APPROVE_ALL_RATIONALE`. Its origin is the reviewers' shared origin, else `mixed`.
  - `override`: any other `manual_override`, and a published state with no consensus decision (D10). Its origin is `human`.
- `APPROVE_ALL_RATIONALE: Final[str] = "Approved: reviewers agree (Phase 2 approve-all)."` is frozen.

**Fact columns**
- `ai_proposed` is true when a `source=ai` proposal exists for (instance, field) in **any** run of the article, or when the linked proposal is AI.
- `ai_proposal_id` is filled only when the link has `source=ai`.

**Canonical equality**
- Values are canonicalized against the run's **pinned** field (`layout.pinned_fields[article.version_id]`).
- `verification` is stripped, and multiselects compare as sets.
- If `ValueContractError` is raised on **either** side, or the pinned field is unknown (narrow legacy version, D5), **both** sides are compared as peeled raw values.
- An absent marker compares by its code.

**Verification (§4.3)**
- Columns: `article_label, record_label, field_code, field_label`, one column per reviewer, then [AI], `Consensus`, `match`, `n_raters`, `n_raters_with_value`, `consensus_method`, `consensus_by`, `consensus_rationale`.
- The rater set per article is `layout.raters_by_run[article.run_id]` (R16: reviewers with ≥ 1 non-reject current decision on the run).
- A reviewer column outside the rater set shows `—`.
- `match`:
  - `all_equal`: every rater has a value, `n_raters ≥ 2`, and there is one distinct value.
  - `conflict`: there are two or more distinct values.
  - `incomplete`: anything else.
- Percent agreement is the number of `all_equal` rows divided by the number of rows with `n_raters ≥ 2`. The README states this denominator.

**Rater labels (§6, D4)**
- Anonymised: "Member A, B, …", ordered by each person's earliest reviewer or consensus decision in the project, with ties broken by id.
- Named: the display name. A collision with another name, or with `consensus`, appends `_short_id(reviewer_id)`.
- Who is named:
  - `anonymize_reviewer_names=true`: nobody, in every mode.
  - A manager without anonymisation: everybody.
  - A non-manager (consensus or single_user): only the exporter; everyone else gets their Member letter (D4).
- One map per project feeds `rater`, `decided_by`, `consensus_by` and `ReviewerDescriptor.display_label`.

**AI proposals sheet (§7, D6)**
- Rows: the `source=ai` proposals of the current runs, plus any `source=ai` proposal that an in-scope decision references. Links may cross runs.
- Columns (14): `article_id, instance_id, field_id, field_code, ai_proposal_id, provider, model, prompt_version, value, unit, confidence, rationale, evidence_quote, page`.
- `value` is the machine scalar, joinable to Data (`value_num`, else `value_bool`, else `value_text`, else `absent_code`); `unit` is `ExportValue.unit`.

**Budget and errors**
- `EXPORT_CELL_BUDGET: Final[int] = 5_000_000` initially. Task 11 measures it and may lower it.
- `ExportTooLargeError`: code `EXPORT_TOO_LARGE`, status 422, a message that starts with `"EXPORT_TOO_LARGE: "`, and a single positional `__init__(message)`.

**README (§7)**
- It states that `ai_accepted` is exact in every period.
- It states that before `LINEAGE_EXACT_SINCE`, a value typed over an AI suggestion reads `human` with `ai_proposed=true`.
- It states that an unlinked re-save reads `human`.
- It states that a reopened run's earlier AI chain is not traced, and that Member letters can shift after a reopen or an entry delete (contract F3).
- PR4's row "Values outside any level sheet" is reworded to "Values only in Data"; there is no second such row (R17).
- No "best-effort" text appears anywhere.

**Single-slot readers (R1).** Every reader that wants one value per coordinate (origin counts, agreement, README rows) reads `primary_rater(layout.mode, <single_user reviewer id>)`, never a literal `None`.

## Review Focus

1. **A selected decision that is no longer current (F4).**
   - Scenario: in EXTRACT, reviewer A writes d1, linked and equal to the AI proposal. A then writes d2, unlinked, which becomes current. In CONSENSUS the manager selects d1.
   - Expected: the consensus origin is `ai_accepted`, not `human`.
   - Test: `test_select_existing_uses_selected_decision_even_when_not_current` (Task 4).
2. **A published state with no consensus decision (D10).**
   - Legacy synthetic runs wrote published states directly (`alembic/versions/archive/20260427_0015_synthetic_runs_for_extracted_values.py:78`).
   - An inner join would drop those values without warning.
   - Test: `test_published_state_without_decision_still_yields_override_row` (Task 4).
3. **Data joins to the level sheets (§1 success criterion).**
   - Every Data `record_id` whose `sheet` is non-blank must appear in that sheet's key column, found by header name. That column is `record_id` on a level sheet and `article_id` on Articles.
   - Test: `test_every_data_record_id_joins_its_level_sheet` (Task 7).
4. **The budget estimate is an upper bound for each sheet (R9).**
   - For `all_users` with two reviewers and several records, each sheet's estimate must be ≥ that sheet's rendered `max_row·max_column`. Otherwise the guard lets an oversized build through.
   - Test: `test_estimate_cells_bounds_rendered_cells_per_sheet` (Task 10).
5. **Memory use of the AI loader.**
   - `generation_snapshot` carries `prompt_text` and `prompt_composition`. The AI loader must not load them.
   - A snapshot left empty by the strip must still not borrow `provenance`.
   - Test: `test_engine_facts_ignore_prompt_payload_and_never_borrow_provenance` (Task 8).
6. **Name exposure (D4).** A non-manager's consensus or single_user export must not show another person's name.
   - Test: `test_non_manager_sees_only_own_name` (Task 5).

## Tasks

### Task 1: Freeze `APPROVE_ALL_RATIONALE`

**Files:**
- Modify: `backend/app/services/run_lifecycle_service.py:289`. Add a module-level constant and use it at this call site.
- Test: `backend/tests/integration/test_run_lifecycle_service.py`. Extend `test_approve_and_finalize_publishes_agreed_and_finalizes` (:529).

**Interfaces:** Produces `APPROVE_ALL_RATIONALE: Final[str]`.

- [ ] Write the failing test. After the `published` assertion, add:
  ```python
  from app.services.run_lifecycle_service import APPROVE_ALL_RATIONALE
  assert APPROVE_ALL_RATIONALE == "Approved: reviewers agree (Phase 2 approve-all)."
  rationale = (await db_session.execute(text(
      "SELECT rationale FROM public.extraction_consensus_decisions WHERE run_id = :r"),
      {"r": str(run.id)})).scalar_one()
  assert rationale == APPROVE_ALL_RATIONALE
  ```
- [ ] Run `cd backend && uv run pytest tests/integration/test_run_lifecycle_service.py -k approve_and_finalize_publishes -q`. Expected: FAIL with `ImportError: cannot import name 'APPROVE_ALL_RATIONALE'`.
- [ ] Implement the constant, with the comment "Frozen: the export classifies `no_conflict` consensus rows by equality with this text; editing it reclassifies past rows." Replace the literal at :289.
- [ ] Run the test again. Expected: PASS.
- [ ] Commit: `refactor(runs): name the frozen approve-all rationale`

### Task 2: `canonical_keys` with the both-sides fallback

**Files:**
- Modify: `backend/app/services/exports/values.py` (PR3).
- Modify: `backend/tests/unit/helpers/export_layouts.py` (PR4, R12): add `make_run_view_field(**kw) -> RunViewField` (`id=uuid4(), name="f", label="F", is_required=False, sort_order=0`, `kw` wins).
- Test: Create `backend/tests/unit/test_export_canonical_key.py`.

**Interfaces:**
- Consumes `value_contract.canonicalize_value(raw, field)` (`value_contract.py:202`), `ValueContractError` (:45), `peel_envelope` (`exports/values.py:46`, PR3), `RunViewField` (`schemas/extraction_run.py:204`; required fields `id, name, label, field_type, is_required, sort_order`).
- Produces `def canonical_keys(raws: Sequence[Any], pinned_field: RunViewField | None) -> tuple[str, ...]`.
  - It canonicalizes every raw value. If any one raises `ValueContractError`, or if `pinned_field is None`, every raw value falls back to its peeled form.
  - It is n-ary on purpose: no unary `canonical_key` exists in shipped code, and a unary function cannot know that the other side raised.
- Produces `def canonical_equal(a: Any, b: Any, pinned_field: RunViewField | None) -> bool`, defined as `len(set(canonical_keys((a, b), pinned_field))) == 1`.

- [ ] Write the failing tests (`_field = make_run_view_field`):
  ```python
  def test_number_string_and_int_are_equal():
      assert canonical_equal({"value": "7394"}, {"value": 7394}, _field(field_type="number"))
  def test_multiselect_compares_as_set_under_pinned_options():
      f = _field(field_type="multiselect", allowed_values=[{"value": "a", "label": "A"}, {"value": "b", "label": "B"}])
      assert canonical_equal({"value": ["b", "a"]}, {"value": ["a", "b"]}, f)
  def test_option_removed_in_later_version_falls_back_to_peeled_raw():
      v2 = _field(field_type="multiselect", allowed_values=[{"value": "a", "label": "A"}])
      assert not canonical_equal({"value": ["b", "a"]}, {"value": ["a", "b"]}, v2)
  def test_one_side_raising_compares_both_peeled():
      f = _field(field_type="number")
      assert canonical_keys(({"value": 7}, {"value": "x"}), f) == (
          canonical_keys(({"value": 7},), None)[0], canonical_keys(({"value": "x"},), None)[0])
  def test_verification_sibling_is_ignored():
      assert canonical_equal({"value": "x", "verification": {"verdict": "ok"}}, {"value": "x"}, _field(field_type="text"))
  def test_absent_marker_compares_by_code_even_when_field_disallows_it():
      f = _field(field_type="text", allows_not_applicable=False)
      assert not canonical_equal({"value": None, "absent_reason": "not_applicable"}, {"value": None, "absent_reason": "no_information"}, f)
  ```
- [ ] Run `cd backend && uv run pytest tests/unit/test_export_canonical_key.py -q`. Expected: FAIL with `ImportError: canonical_keys`.
- [ ] Implement:
  1. Drop the `verification` key from each raw value.
  2. When `pinned_field` is set, call `canonicalize_value` on every raw value; sort a multiselect's `value` (or `selected`) list.
  3. On the first `ValueContractError`, or with no field, map every raw value to `{"value": p.value, "unit": p.unit, "absent_reason": p.absent_reason}` (`p = peel_envelope(raw)`, `None` keys dropped).
  4. Encode with `json.dumps(obj, sort_keys=True, default=str)`.
- [ ] Run the tests again. Expected: PASS.
- [ ] Commit: `feat(export): canonical equality against the run's pinned field`

### Task 3: `CellRecord` and the origin functions

**Files:**
- Create: `backend/app/services/exports/cell_record.py` (under `exports/`, outside the `descriptors.py:3-8` import cycle).
- Create: `backend/app/services/exports/extraction/data_sheet.py`. This task adds only `Origin`, `origin_of`, `consensus_origin_of` and `LINEAGE_EXACT_SINCE`.
- Modify: `backend/tests/unit/helpers/export_layouts.py` (R12): add `make_cell` and `ai_link`. `make_layout` needs no new defaults: the new `ExportLayout` fields (`cells`, `rater_labels`, `pinned_fields`, `ai_proposed`) default to empty on the dataclass, and `make_layout` passes `**over` through.
- Test: Create `backend/tests/unit/test_extraction_export_origin.py`.

**Interfaces:**
- Produces `DecisionFact`, `LinkedProposal` and `CellRecord`, each `@dataclass(frozen=True, slots=True)` with the contract's fields. On a consensus `CellRecord`, `linked_proposal` is the selected decision's link (D10).
- Produces `Origin = Literal["ai_accepted","ai_edited","human","rule","mixed"]` and `ConsensusMethod = Literal["select_existing","no_conflict","override"]`.
- Produces `def origin_of(cell: CellRecord, pinned_field: RunViewField | None) -> Origin`, using `canonical_equal` against `linked_proposal.proposed_value`.
- Produces `def consensus_origin_of(cell: CellRecord, reviewers: Sequence[CellRecord], pinned_field: RunViewField | None) -> tuple[Origin, ConsensusMethod]`. The contract's `selected` parameter is dropped: the cell already carries the selected decision's link (D10).
- Produces `LINEAGE_EXACT_SINCE: Final[date] = date(2026, 10, 31)`: PR2 reached prod at 2026-10-31T21:41:32Z, recorded on PR #1067 (R21).
- Test helpers in `export_layouts.py`:
  - `make_cell(envelope: Any, *, kind: str = "edit", actor_id: UUID | None = None, link: LinkedProposal | None = None, rationale: str | None = None, selected_decision_id: UUID | None = None) -> CellRecord`.
  - `ai_link(value: Any, *, source: str = "ai") -> LinkedProposal`.

- [ ] Write the failing tests (`_num = make_run_view_field(field_type="number")`):
  ```python
  def test_linked_equal_is_ai_accepted(): assert origin_of(make_cell({"value": 42}, link=ai_link(42)), _num) == "ai_accepted"
  def test_legacy_accept_proposal_is_ai_accepted(): assert origin_of(make_cell({"value": 42}, kind="accept_proposal", link=ai_link(42)), _num) == "ai_accepted"
  def test_linked_different_is_ai_edited(): assert origin_of(make_cell({"value": 43}, link=ai_link(42)), _num) == "ai_edited"
  def test_unlinked_is_human(): assert origin_of(make_cell({"value": 42}), _num) == "human"
  def test_system_link_is_human(): assert origin_of(make_cell({"value": 42}, link=ai_link(42, source="system")), _num) == "human"
  def test_unfilled_cell_is_human(): assert origin_of(make_cell(None, kind="reject", link=ai_link(42)), _num) == "human"
  def test_v1_pinned_options_keep_ai_accepted():
      v1 = make_run_view_field(field_type="multiselect", allowed_values=[{"value":"a","label":"A"},{"value":"b","label":"B"}])
      assert origin_of(make_cell({"value": ["a","b"]}, link=ai_link(["b","a"])), v1) == "ai_accepted"
  def test_approve_all_with_agreeing_origins_is_no_conflict():
      c = make_cell({"value": 42}, kind="manual_override", rationale=APPROVE_ALL_RATIONALE)
      assert consensus_origin_of(c, [make_cell({"value": 42}, link=ai_link(42))] * 2, _num) == ("ai_accepted", "no_conflict")
  def test_approve_all_with_differing_origins_is_mixed():
      c = make_cell({"value": 42}, kind="manual_override", rationale=APPROVE_ALL_RATIONALE)
      assert consensus_origin_of(c, [make_cell({"value": 42}, link=ai_link(42)), make_cell({"value": 42})], _num) == ("mixed", "no_conflict")
  def test_typed_override_is_human_override():
      assert consensus_origin_of(make_cell({"value": 50}, kind="manual_override", rationale="typo"), [], _num) == ("human", "override")
  def test_select_existing_takes_the_selected_link():
      c = make_cell({"value": 42}, kind="select_existing", link=ai_link(42))
      assert consensus_origin_of(c, [make_cell({"value": 42})], _num) == ("ai_accepted", "select_existing")
  ```
- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_export_origin.py -q`. Expected: FAIL with `ModuleNotFoundError: app.services.exports.cell_record`.
- [ ] Implement:
  - `origin_of` returns `"human"` when the envelope is unfilled (`value_semantics.is_value_filled`).
  - `no_conflict` takes the `origin_of` set of the filled reviewer cells: one element → that origin, else `mixed`.
- [ ] Run the tests again. Expected: PASS.
- [ ] Commit: `feat(export): CellRecord and the simple-variant origin rules`

### Task 4: Two cell loaders replace the three value-map builders

**Files:**
- Create `backend/tests/integration/helpers/export_fixtures.py` (R4, following `tests/integration/helpers/*_fixtures.py`). Move `_make_run` (:125), `_record_decision` (:191) and `_service` (:235) out of `backend/tests/integration/test_extraction_export_ai_outcome.py` as `make_run`, `record_decision` and `export_service`, and import them there.
- Modify `backend/app/services/extraction_export_service.py`:
  - Add `_load_reviewer_cells`, `_load_consensus_cells` and `_load_orphan_fields`.
  - Add `ExportLayout.cells: Mapping[ValueKey, CellRecord] = field(default_factory=dict)`.
  - Rewire the mode dispatch in `resolve_layout` (:447-496). It currently builds `fields_by_id` from the active `sections` only (:438-440); replace that with the Task 4 `fields` map below.
- Add a pure `value_map_from_cells` in `backend/app/services/exports/cell_record.py`.
- Delete from the service: `_build_consensus_value_map` (:1032), `_build_single_user_value_map` (:1142) and `_build_all_users_value_map` (:1421). `_list_reviewers_for_runs` (:1351) stays: it is the R16 predicate behind `raters_by_run` (PR4).
- Modify `backend/tests/unit/test_extraction_export_service.py`:
  - Delete `TestBuildConsensusValueMap` (:316), `TestBuildAllUsersValueMap` (:1337) and `TestBuildSingleUserValueMap` (:2120).
  - Fix the T2 and T6 docstring lines (:9, :13).
  - In `TestResolveLayoutAiTarget` (:1863, `_stub_loaders`), stub `_load_reviewer_cells` / `_load_consensus_cells` with `AsyncMock(return_value={})`. Task 8 deletes this class.
- Modify `backend/tests/unit/test_extraction_export_scope_marking.py::test_resolve_layout_marks_the_primary_rater_slot` (:510): it stubs `_build_single_user_value_map` / `_build_consensus_value_map` (:542-543); stub `_load_reviewer_cells` / `_load_consensus_cells` instead (and, after Task 5, `_load_rater_labels` and `_project_members_repo().has_role`; after Task 6, `_load_ai_proposed` and the `VersionSections(...)` stub at :533 gains `{}`).
- Modify `backend/tests/integration/test_run_lifecycle_service.py:1498`: call `_load_reviewer_cells(run_ids=[run_id], reviewer_ids=[profile_id])`, project through `value_map_from_cells(..., slots="reviewer", ...)`, keep the assertion.
- Modify `backend/app/services/extraction_run_read_service.py:309`: the NOTE names `_build_single_user_value_map`; reword it to `_load_reviewer_cells`.
- Test: Create `backend/tests/integration/test_extraction_export_cell_loaders.py`.

**Interfaces:**
- `async def _load_reviewer_cells(self, *, run_ids: list[UUID], reviewer_ids: Sequence[UUID] | None) -> dict[ValueKey, CellRecord]`
  - One statement: `ExtractionReviewerState ⋈ ExtractionReviewerDecision (current_decision_id) ⟕ ExtractionProposalRecord`. Rejects are included.
  - Envelope: `resolve_reviewer_value(decision, value, proposed_value)` (`value_semantics.py:134`). `DecisionFact.kind` is the `ExtractionReviewerDecision.decision` column (`accept_proposal | reject | edit`); on consensus cells it is `ExtractionConsensusDecision.mode` (`select_existing | manual_override`).
  - Key: `value_key(run, inst, field, reviewer_id)` (R1).
- `async def _load_consensus_cells(self, *, run_ids: list[UUID]) -> dict[ValueKey, CellRecord]` (D10)
  - One statement: published states ⟕ latest-decision subquery ⟕ the selected `ExtractionReviewerDecision` ⟕ that decision's `ExtractionProposalRecord`.
  - Subquery: `select(ExtractionConsensusDecision).where(run_id.in_(run_ids)).distinct(run_id, instance_id, field_id).order_by(run_id, instance_id, field_id, created_at.desc(), id.desc())`.
  - No decision → `DecisionFact(id=published_state.id, kind="manual_override", actor_id=published_by, created_at=published_at, rationale=None, selected_decision_id=None)`.
  - Key: `value_key(run, inst, field)`.
- `async def _load_orphan_fields(self, *, template_id: UUID, field_ids: Collection[UUID]) -> dict[UUID, FieldDescriptor]` (D10)
  - For a decision or AI proposal whose field is in no loaded version (the field FK is RESTRICT, `extraction_workflow.py:172`, so a live row exists).
  - One statement over `ExtractionField ⋈ ExtractionEntityType`, `ExtractionEntityType.project_template_id == template_id` in the WHERE clause.
  - Minimal descriptor: `field_id`, `label`, `type`, `allowed_values=()`, `unit`.
- `def value_map_from_cells(cells: Mapping[ValueKey, CellRecord], *, slots: Literal["consensus","reviewer","both"], fields: Mapping[UUID, FieldDescriptor], labels: OptionLabels) -> dict[ValueKey, ExportValue]`
  - Keeps each cell's key unchanged; `slots` filters on `key[3] is None`.
  - Value: `to_export_value(c.envelope, fields[k[2]], labels, rejected=c.decision.kind == "reject")`.
  - `fields` = the coded active `sections` (`resolve_layout`'s `apply_field_codes` result), then the fields of every pinned `VersionSections.sections` (the `pinned` tail of `_load_pinned_versions`, so the active descriptor wins), then the orphan fields. No extra version load (R14).
- Modes:
  - consensus: reviewer cells for all reviewers plus consensus cells in `layout.cells`; `slots="consensus"`.
  - single_user: reviewer cells for `[reviewer_id]` only; `slots="reviewer"`.
  - all_users: both kinds; `slots="both"`.

- [ ] Move the three helpers into `export_fixtures.py`; run `cd backend && uv run pytest tests/integration/test_extraction_export_ai_outcome.py -q`. Expected: PASS. Commit: `refactor(tests): share the export run and decision helpers`.
- [ ] Write the failing tests. `_consensus_run(db)` uses `make_run`, `land_ai_proposal` (`tests/integration/conftest.py:701`), `ExtractionReviewService(db).record_decision(...)` as `SEED.primary_profile` / `SEED.reviewer_profile` on `SEED.primary_instance` / `SEED.primary_field`, and `RunLifecycleService.advance_stage`.
  ```python
  async def test_reviewer_loader_resolves_legacy_accept_to_its_proposal(db_session):  # accept_proposal stores value=NULL
      c = (await svc._load_reviewer_cells(run_ids=[run_id], reviewer_ids=None))[
          value_key(run_id, SEED.primary_instance, SEED.primary_field, SEED.primary_profile)]
      assert c.envelope == {"value": 42} and c.decision.kind == "accept_proposal" and c.linked_proposal.source == "ai"
  async def test_reviewer_loader_keeps_reject_and_clear(db_session):
      assert cells[key_a].decision.kind == "reject" and cells[key_a].envelope is None
      assert cells[key_b].decision.kind == "edit" and cells[key_b].envelope is None   # edit {"value": None}
  async def test_consensus_loader_reads_latest_decision(db_session):
      # select_existing, then UPDATE its created_at = now() - interval '1 minute', then manual_override {"value": 50}
      c = (await svc._load_consensus_cells(run_ids=[run_id]))[value_key(run_id, inst, fid)]
      assert c.decision.kind == "manual_override" and c.envelope == {"value": 50}
  async def test_select_existing_uses_selected_decision_even_when_not_current(db_session):
      # A: d1 edit {"value":42} linked to AI; d2 edit {"value":42} unlinked (current); consensus selects d1
      assert c.decision.selected_decision_id == d1.id and c.linked_proposal.id == ai_pid
  async def test_published_state_without_decision_still_yields_override_row(db_session):
      # DELETE FROM extraction_consensus_decisions WHERE run_id=:r  (keeps the published state)
      assert c.decision.kind == "manual_override" and c.decision.actor_id == SEED.primary_profile
  async def test_loaders_issue_one_statement_each(db_session):
      # before_cursor_execute listener idiom of tests/integration/test_extraction_batch_reads.py:170-180
      assert len(statements) == 1   # per loader
  async def test_value_for_field_outside_every_loaded_version_is_kept(db_session):
      # active version schema := build_template_version_snapshot(...) (non-narrow), then INSERT a live field
      # into SEED.primary_entity_type; run pinned to the active version; record_decision edit {"value": "kept"}
      layout = await svc.resolve_layout(..., mode=ExportMode.SINGLE_USER, reviewer_id=SEED.primary_profile, ...)
      assert layout.value_map[value_key(run_id, inst, new_fid, SEED.primary_profile)].status == "answered"
  ```
- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_cell_loaders.py -q`. Expected: FAIL with `AttributeError: _load_reviewer_cells`.
- [ ] Implement the signatures above; delete the three builders and their three test classes; apply the caller edits under Files.
- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_cell_loaders.py tests/unit/test_extraction_export_service.py tests/integration/test_run_lifecycle_service.py -q`. Expected: PASS.
- [ ] Run `grep -rn "_build_\(consensus\|single_user\|all_users\)_value_map" backend`. Expected: no output.
- [ ] Commit: `refactor(export): one reviewer and one consensus loader return CellRecord`

### Task 5: Project rater/pseudonym map

**Files:**
- Modify the service:
  - Add `_load_rater_labels` and `ExportLayout.rater_labels: Mapping[UUID, str] = field(default_factory=dict)`.
  - `ReviewerDescriptor.display_label` and the order of `layout.reviewers` come from the map. In `_list_reviewers_for_runs` (:1351; PR4 already selects `run_id` and returns `(reviewers, raters_by_run)`), delete the `anonymize` parameter, the FR-011 ordering docstring, the `Profile` import and outer join, the `by_id` name fallback and the "Reviewer X" / alphabetical branches (:1394-1413).
- Modify `backend/tests/unit/test_extraction_export_service.py::TestListReviewersForRuns` (:2300):
  - Delete `test_anonymize_false_returns_named_reviewers` (:2325), `test_anonymize_true_returns_letter_labels` (:2346) and `test_email_fallback_when_no_name` (:2369) (naming moves to `_load_rater_labels`).
  - `test_empty_run_ids_returns_empty_tuple` (:2304): drop `anonymize=`, pass `labels={}`, expect `((), {})`.
  - Rewrite PR4's `test_raters_by_run_groups_reviewers_per_run` (:2310, below): rows `(rid, run_id, name, email)` lose name and email, `anonymize=` is gone, and labels come from a stubbed `_load_rater_labels` map.
- Test: `backend/tests/integration/test_extraction_export_cell_loaders.py`.
- No schema-description or frontend change (R5: PR6).

**Interfaces:**
- `async def _load_rater_labels(self, *, project_id: UUID, anonymize: bool, named_only: UUID | None = None) -> dict[UUID, str]`, one statement:
  - a `UNION ALL` of `(reviewer_id, created_at)` from `ExtractionReviewerDecision` and `(consensus_user_id, created_at)` from `ExtractionConsensusDecision`, each joined to `ExtractionRun` with `ExtractionRun.project_id == project_id` in the WHERE clause;
  - grouped by actor with `min(created_at)`; LEFT JOIN `Profile` for `full_name`, `email`.
- Labelling:
  - Every actor gets a letter `f"Member {_letter_for(i)}"` in `(min_created_at, str(id))` order.
  - `anonymize=True`: letters only. `named_only` set: that id gets its name, the rest keep letters. Otherwise: names.
  - Name: `full_name or email or _short_id(id)`. A group whose names collide under casefold, or a name that casefolds to `consensus`, becomes `f"{name} {_short_id(id)}"`.
- `async def _list_reviewers_for_runs(self, *, run_ids: list[UUID], labels: Mapping[UUID, str]) -> tuple[tuple[ReviewerDescriptor, ...], dict[UUID, tuple[UUID, ...]]]`
  - Same non-reject current-decision predicate (R16); selects `(reviewer_id, run_id)` only.
  - `reviewers` follow the order of `labels` (Member-letter order); `display_label = labels[rid]`. Per-run tuples follow the `reviewers` order.
- `resolve_layout` (D4): `caller_id = UUID(self.user_id)` (as `assert_can_export` does, :378-381), then `is_manager = await self._project_members_repo().has_role(project_id, caller_id, ProjectMemberRole.MANAGER)`; it passes `named_only=None if is_manager else caller_id`, then hands the map to `_list_reviewers_for_runs(run_ids=..., labels=layout.rater_labels)` in the all_users branch.

- [ ] Write the failing tests:
  ```python
  async def test_same_name_reviewers_get_distinct_raters(db_session):
      # UPDATE profiles SET full_name='Alex Doe' WHERE id IN (primary, reviewer); both decide on one run
      labels = await svc._load_rater_labels(project_id=SEED.primary_project, anonymize=False)
      assert labels[SEED.primary_profile] != labels[SEED.reviewer_profile]
      assert labels[SEED.primary_profile].startswith("Alex Doe ")
  async def test_member_letters_follow_earliest_decision(db_session):
      # reviewer's decision created_at forced one minute earlier than primary's
      labels = await svc._load_rater_labels(project_id=SEED.primary_project, anonymize=True)
      assert (labels[SEED.reviewer_profile], labels[SEED.primary_profile]) == ("Member A", "Member B")
  async def test_adjudicator_without_reviewer_decisions_is_labelled(db_session):
      # only a consensus decision by primary
      assert labels[SEED.primary_profile] == "Member A"
  async def test_name_equal_to_consensus_is_suffixed(db_session):
      # full_name='Consensus'
      assert labels[SEED.primary_profile] == f"Consensus {str(SEED.primary_profile).split('-')[0]}"
  async def test_non_manager_sees_only_own_name(db_session):
      labels = await svc._load_rater_labels(project_id=SEED.primary_project, anonymize=False,
                                            named_only=SEED.reviewer_profile)
      assert labels[SEED.reviewer_profile] == "Integration Reviewer"
      assert re.fullmatch(r"Member [A-Z]+", labels[SEED.primary_profile])
  ```
  Unit, replacing PR4's version in `TestListReviewersForRuns`:
  ```python
  async def test_raters_by_run_groups_reviewers_per_run(self):
      svc = _make_service(); r1, r2, run_a, run_b = uuid4(), uuid4(), uuid4(), uuid4()
      svc.db.execute = AsyncMock(return_value=_rows_result([(r1, run_a), (r2, run_a), (r1, run_b)]))
      labels = {r2: "Member A", r1: "Member B"}   # the _load_rater_labels map, stubbed
      reviewers, by_run = await svc._list_reviewers_for_runs(run_ids=[run_a, run_b], labels=labels)
      assert [(r.reviewer_id, r.display_label) for r in reviewers] == [(r2, "Member A"), (r1, "Member B")]
      assert by_run == {run_a: (r2, r1), run_b: (r1,)}
  ```
- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_cell_loaders.py -k "labels or raters or labelled or suffixed or own_name" -q`. Expected: FAIL with `AttributeError: _load_rater_labels`.
- [ ] Implement the loader and the D4 wiring in every mode.
- [ ] Run the tests again, plus `tests/unit/test_extraction_export_service.py`. Expected: PASS.
- [ ] Commit: `feat(export): one project pseudonym map labels raters in every mode`

### Task 6: Pinned fields, AI facts and the pinned-version stamp guard

**Files:**
- Modify the service:
  - Add `_load_ai_proposed`, `ExportLayout.pinned_fields: Mapping[UUID, Mapping[UUID, RunViewField]] = field(default_factory=dict)` and `ExportLayout.ai_proposed: frozenset[tuple[UUID, UUID, UUID]] = frozenset()`.
  - `pinned_fields = {v.version_id: v.run_view_fields for v in layout.versions}`, from the `VersionSections` PR4 already loads and exposes on `ExportLayout.versions` (R14). No new version loader.
- Modify `backend/app/services/exports/codebook_model.py` and `_load_pinned_versions` (:830): re-add `VersionSections.run_view_fields: Mapping[UUID, RunViewField]` (TYPE_CHECKING import of `RunViewField`) and its write `run_view_fields={f.id: f for et in views for f in et.fields}`, the inverse of c3c1102e (PR4 dropped it as unread). The positional `VersionSections(...)` constructors that commit edited regain a trailing `{}`: `git show --stat c3c1102e` lists the nine test files, plus `tests/unit/helpers/export_layouts.py` (`make_layout`).
- Modify `backend/app/services/exports/extraction_scope_marking.py`: `mark_out_of_scope_values` (:95; today keyword-only `rules_by_article, sections, articles, raters, value_map`).
- Test: `backend/tests/unit/test_extraction_export_scope_marking.py` and `backend/tests/integration/test_extraction_export_cell_loaders.py`.

**Interfaces:**
- `async def _load_ai_proposed(self, *, project_id: UUID, template_id: UUID, article_ids: list[UUID]) -> frozenset[tuple[UUID, UUID, UUID]]`, one statement:
  ```sql
  SELECT DISTINCT r.article_id, p.instance_id, p.field_id
  FROM public.extraction_proposal_records p JOIN public.extraction_runs r ON r.id = p.run_id
  WHERE r.project_id = :pid AND r.template_id = :tid
    AND r.article_id IN :aids AND p.source = 'ai'
  ```
- `mark_out_of_scope_values(..., pinned_field_ids: Mapping[UUID, frozenset[UUID]])`, keyed by `article_id`. A field not in the article's pinned version is skipped. An article whose version is absent from the mapping (narrow legacy version, D5) is not filtered.

- [ ] Write the failing tests:
  ```python
  def test_no_stamp_for_field_missing_from_pinned_version():  # unit, scope_marking file
      mark_out_of_scope_values(..., pinned_field_ids={article.article_id: frozenset({kept_fid})})
      assert value_key(run, inst, unpinned_fid) not in value_map
  async def test_ai_proposed_spans_every_run_of_the_article(db_session):
      # AI proposal in a run later replaced by reopen_run(...)
      assert (SEED.primary_article, inst, fid) in layout.ai_proposed
  async def test_pinned_fields_reuse_the_single_version_load(db_session, monkeypatch):
      # spy on app.services.extraction_export_service.entity_types_for_version (imported by name, :98),
      # not extraction_snapshot's; run pinned to an older non-narrow version
      layout = await svc.resolve_layout(...)
      assert set(layout.pinned_fields) == {active_vid, older_vid} and spy.call_count == 2
  ```
- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_export_scope_marking.py tests/integration/test_extraction_export_cell_loaders.py -q`. Expected: FAIL with an unexpected kwarg or a missing attribute.
- [ ] Implement the signatures above.
- [ ] Run the tests again. Expected: PASS.
- [ ] Commit: `feat(export): pinned fields from the version load, AI-proposed facts, stamp only pinned fields`

### Task 7: The Data sheet

**Files:**
- Modify `backend/app/services/exports/extraction/data_sheet.py`.
- Modify `backend/app/services/exports/extraction/workbook.py`:
  - Add `"data"` to `_SHAPE_BUILDERS[COMPLETE]`, `_ARTICLE_BUILDERS`, `_FIXED_TITLES` (`"Data"`) and `_ROLE_ORDER` (right after `"level_tables"`); call `build_data_sheet(layout, titles)` in `_ordered_specs` right after `build_level_tables`.
  - Role predicate `shape is ExportShape.COMPLETE` (R8): `allocate_titles` already applies it through `_SHAPE_BUILDERS` membership, so `_role_present` needs no `data` branch (it defaults to `True`).
- Modify `backend/tests/unit/helpers/export_layouts.py` only if a new default is needed (R12; no file-local layout builder).
- Modify the tests that pin the COMPLETE sheet list (R11): add `"Data"` after the level sheets in `backend/tests/integration/test_extraction_export_level_fixtures.py` (the `expected` params, asserted at :169), `backend/tests/unit/test_extraction_export_level_fixtures.py` (:92, :114), `backend/tests/unit/test_extraction_workbook_orchestrator.py` (:127, :136, and PR4's `test_sections_named_history_and_data_get_suffixed_titles` at :146/:153) and `backend/tests/unit/test_extraction_xlsx_builder.py` (:137, :146, :603). The other `grep -rn "sheetnames ==" backend/tests` hits are DICTIONARY lists (`test_extraction_export_shape_filter.py:231`, `test_extraction_codebook_builder.py:184`) and stay; `test_extraction_export_determinism.py` and `test_extraction_export_new_sheets.py` only test membership.
- Test: Create `backend/tests/unit/test_extraction_data_sheet_builder.py` and `backend/tests/integration/test_extraction_export_data_sheet.py`.

**Interfaces:**
- Consumes PR4's `record_keys(article, instance_id, layout.sections)` (R18) for `record_id`, `parent_record_id` and the active `section` (`None` outside the active tree); `iter_records`; `walk_sections`; `titles.sheet_for(section_id)`. No key logic of its own.
- `DATA_COLUMNS: Final[tuple[str, ...]]`: the 27 names in Global Constraints order.
- `DataRow = tuple[CellValue, ...]` in `DATA_COLUMNS` order (a tuple, so vulture has no fields to flag).
- `def data_rows(layout: ExportLayout, titles: SheetTitles) -> tuple[DataRow, ...]` iterates `layout.value_map`:
  - `cell = layout.cells.get(key)`; `None` means a stamp (`origin="rule"`).
  - `field_code` from `layout.codebook`; `sheet` per Global Constraints (blank, never `"Articles"`, when `record_keys` returns no section or the field is not in it).
  - `record_label`: the label `iter_records` gives `record_id` on its level sheet when `sheet` is non-blank, else `""`.
  - `rater`, `decided_by`, `consensus_by` from `layout.rater_labels`; `decided_at` as a real `datetime`, converted to UTC and made timezone-naive (`.astimezone(UTC).replace(tzinfo=None)`): openpyxl cannot store tz-aware datetimes. Never `isoformat()` text.
  - `n_raters_with_value` on consensus rows counts the filled reviewer cells of the coordinate in `layout.cells`.
  - Sort: article index; the instance's `walk_sections` position (unknown instances last, by `str(id)`); `field_code`; consensus before reviewers; `rater`.
- `def build_data_sheet(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None`: `None` when `"data"` is absent from `titles.fixed`; one header row, freeze `"A2"`.
- `def origin_counts(layout: ExportLayout) -> Mapping[Origin, int]` over the `primary_rater` slot (R1).

- [ ] Write the failing tests. Unit (`make_layout`, `make_cell`, `export_value`; `_row(r) = dict(zip(DATA_COLUMNS, r))`):
  ```python
  def test_columns_are_the_machine_contract(): assert DATA_COLUMNS[:10] == ("article_id","article_label","sheet","record_id","parent_record_id","instance_id","record_label","field_id","field_code","rater") and len(DATA_COLUMNS) == 27
  def test_stamp_row(): r = _row(_only(layout_with_stamp)); assert (r["status"], r["absent_code"], r["out_of_scope"], r["origin"]) == ("absent","not_applicable",True,"rule")
  def test_unlinked_with_ai_proposal_is_human_and_ai_proposed(): assert (r["origin"], r["ai_proposed"], r["ai_proposal_id"]) == ("human", True, None)
  def test_consensus_row_has_method_and_n_raters_with_value(): assert (r["rater"], r["consensus_method"], r["n_raters_with_value"]) == ("consensus","no_conflict",2)
  def test_reviewer_row_leaves_consensus_columns_blank(): assert (r["consensus_method"], r["n_raters_with_value"]) == (None, None)
  def test_section_outside_active_tree_leaves_sheet_blank():   # guard: never "Articles"
      # value_map key on an instance whose entity_type_id is not in layout.sections
      r = _row(_only(layout)); assert r["sheet"] in (None, "") and r["record_label"] == ""
  def test_rejected_vs_cleared(): assert {r["status"] for r in rows} == {"rejected","cleared"}
  def test_boolean_goes_to_value_bool(): assert (r["value_bool"], r["value_text"]) == (False, None)   # D3
  def test_decided_at_is_naive_utc_datetime(): assert r["decided_at"] == aware.astimezone(UTC).replace(tzinfo=None) and r["decided_at"].tzinfo is None
  def test_single_user_rows_carry_the_reviewer_label():   # R1
      layout = make_layout(mode=ExportMode.SINGLE_USER, value_map={value_key(run, i, f, rid): export_value(value_text="x")},
                           cells={value_key(run, i, f, rid): make_cell({"value": "x"}, actor_id=rid)}, rater_labels={rid: "Member A"})
      assert _row(data_rows(layout, titles)[0])["rater"] == "Member A"
  ```
  Integration (`build_workbook` → `openpyxl.load_workbook`; `_header_col(ws, name)` finds a header by name):
  ```python
  async def test_legacy_accept_proposal_reads_answered_ai_accepted(db_session): assert (row["status"], row["origin"]) == ("answered","ai_accepted")
  async def test_all_users_has_one_consensus_row_per_coordinate(db_session): assert Counter(coords_of(rater="consensus")).most_common(1)[0][1] == 1
  async def test_removed_field_value_is_present_in_data(db_session):
      # 1. UPDATE the active version's schema := await build_template_version_snapshot(db, SEED.primary_template)
      #    (non-narrow, so the live-row fallback at extraction_snapshot.py:321-325 is not taken)
      # 2. INSERT a live text field into SEED.primary_entity_type
      # 3. insert ExtractionTemplateVersion(version=9001, is_active=False,
      #    schema_=await build_template_version_snapshot(...))  (idiom: _add_pinned_version, test_extraction_export_codebook.py:27-35)
      # 4. UPDATE the run's version_id to 9001's id; record_decision edit {"value": "kept"} on the new field
      layout = await svc.resolve_layout(...)
      assert new_fid not in {f.field_id for s in layout.sections for f in s.fields}
      r = row_for(new_fid); assert r["field_code"] and r["sheet"] in (None, "") and r["value_text"] == "kept"
  async def test_every_data_record_id_joins_its_level_sheet(db_session):
      for r in data:
          if not r["sheet"]: continue
          ws = wb[r["sheet"]]
          key = "article_id" if r["sheet"] == titles.sheet_for(None) else "record_id"
          col = _header_col(ws, key)
          assert r["record_id"] in {row[col - 1].value for row in ws.iter_rows(min_row=2)}
  async def test_two_same_name_reviewers_have_distinct_rater(db_session): assert len({r["rater"] for r in reviewer_rows}) == 2
  async def test_decided_at_cell_is_a_datetime(db_session): assert isinstance(ws.cell(2, _header_col(ws, "decided_at")).value, datetime)
  ```
- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_data_sheet_builder.py tests/integration/test_extraction_export_data_sheet.py -q`. Expected: FAIL with `ImportError: build_data_sheet`, or no `Data` sheet.
- [ ] Implement the signatures above and update the pinned sheet lists.
- [ ] Run the tests again, plus `tests/unit/test_extraction_export_level_fixtures.py tests/integration/test_extraction_export_level_fixtures.py tests/unit/test_extraction_workbook_orchestrator.py tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_export_shape_filter.py tests/integration/test_extraction_export_new_sheets.py`. Expected: PASS.
- [ ] Run `cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`. Expected: no new findings.
- [ ] Commit: `feat(export): Data sheet with keys, values and lineage`

### Task 8: The AI proposals sheet

**Files:**
- Modify `backend/app/services/exports/ai_proposal_projection.py`: replace `proposal_model_used` (:25) with `proposal_engine`.
- Modify the service:
  - Rewrite `_load_ai_proposal_rows` (:1504; today `(articles, sections, value_map, mode, target_reviewer_id, labels)`, called from `resolve_layout` at :516 only when `include_ai_metadata`) and `AIProposalRow` (:226-248).
  - Delete `_infer_reviewer_outcome` (:1759), and PR3's `_untyped_field` (:1751, R15): field descriptors come from the Task 4 `fields` map (active, pinned, orphan).
  - Always load the rows (the README AI-tools table needs them); load evidence only when `include_ai_metadata` is set.
- `git mv backend/app/services/exports/extraction/ai_metadata.py backend/app/services/exports/extraction/ai_proposals.py` (R8a: module file only), then rewrite it as `build_ai_proposals`, reading every row field by name (no `astuple`).
- `workbook.py`: update the import (:25) to `from app.services.exports.extraction.ai_proposals import build_ai_proposals` and the `_ordered_specs` call (`build_ai_metadata(layout, titles)`). The `ai_proposals` role id and predicate already exist from PR1 (R8a); no role change.
- Machine scalar: reuse PR4's level-sheet machine-cell rule. It is inline in the private `level_tables._field_cells` (:60-73: keep only `status in _MACHINE_STATUSES` and not `out_of_scope`, then the first non-`None` of `value_num, value_bool, value_text`). Move it to `exports/values.py` as `machine_value(v: ExportValue) -> CellValue` and call it from both; the AI `value` adds Global Constraints' `absent_code` fallback on top of it.
- Tests:
  - Rewrite `backend/tests/unit/test_export_ai_proposal_projection.py` and `backend/tests/unit/test_extraction_ai_metadata_builder.py` (its import, :7, follows the module rename).
  - `git mv backend/tests/integration/test_extraction_export_ai_outcome.py backend/tests/integration/test_extraction_export_ai_proposals.py`. Delete the outcome tests (:267-513); keep the evidence and model tests (:514 onward), pointed at the `model` column. The run/decision helpers already live in `helpers/export_fixtures.py` (Task 4); `_ai_metadata_rows` (:622) stays in the renamed module.
  - `backend/tests/integration/test_proposal_generation_read.py::test_export_projects_original_proposal_model`: its import (:235) follows the rename to `test_extraction_export_ai_proposals`, and `rows[0].model_used` (:249, :262) becomes `rows[0].engine.model`.
  - Delete `backend/tests/integration/test_extraction_export_ai_outcome_ordering.py`.
  - `backend/tests/integration/test_extraction_export_ai_value_resolution.py`: drop the `final_value_used` assertion (:144) and its docstring and comment lines (:11, :101); point the `ai_proposed_value` checks (:141, :143) at `value`.
  - `backend/tests/unit/test_extraction_export_determinism.py`: delete `test_load_ai_proposal_rows_populates_final_value_for_all_users_mode` with its section comment (:215-337); update the `AIProposalRow(` construction (:172); rename `test_build_workbook_ai_metadata_path_is_deterministic` (:165) to `..._ai_proposals_path_...`.
  - `backend/tests/unit/test_extraction_export_service.py`: delete `TestInferReviewerOutcome` (:581), `TestLoadAiProposalRows` (:757), `TestResolveLayoutAiTarget` (:1863), `TestAiProposalRowsModelInstances` (:2385) and PR3's `test_ai_row_value_for_a_field_outside_the_active_version` (:2453, R15); drop the T4/T5 docstring lines (:11, :12).
  - Update the `AIProposalRow(` constructions in `backend/tests/unit/test_extraction_xlsx_builder.py` (:449, :503).
  - `backend/tests/unit/test_extraction_export_shape_filter.py`: the spy list (PR1's `(role, fn_name, result)` tuples, :180) patches `build_ai_proposals` instead of `build_ai_metadata` for role `"ai_proposals"`.
  - `backend/tests/integration/test_extraction_export_golden_structure.py` (after PR4's rewrite): assert the §3 order
    ```python
    assert titles.index("Data") > titles.index("Articles")
    assert titles.index("AI proposals") > titles.index("Data")
    assert titles.index("AI proposals") < titles.index("Codebook")
    ```
  - Find every remaining reader with `grep -rn "reviewer_outcome\|final_value_used\|model_used\|proposal_model_used\|_untyped_field" backend`.

**Interfaces:**
- `@dataclass(frozen=True, slots=True) class EngineFacts: provider: str; model: str; prompt_version: str`.
- `def proposal_engine(proposal: ExtractionProposalRecord, *, had_snapshot: bool) -> EngineFacts`
  - Uses `serialize_proposal_generation(proposal, ProposalRevealContext({}))` (`proposal_generation_read.py:115`).
  - `had_snapshot` → `provider`/`model` from the snapshot only; else from `provenance`. `prompt_version` always from the snapshot. A non-`str` value becomes `""`.
- The loader selects `generation_snapshot.op("-")("prompt_text").op("-")("prompt_composition")`, `(generation_snapshot IS NOT NULL).label("had_snapshot")` and `provenance`, then builds a transient `ExtractionProposalRecord` for `proposal_engine`.
- Row set: `source == "ai" AND (run_id IN current_run_ids OR id IN {c.linked_proposal.id for c in cells.values() if c.linked_proposal and c.linked_proposal.source == "ai"})`.
- `AIProposalRow`: `article_id, instance_id, field_id, ai_proposal_id, created_at, engine: EngineFacts, value: ExportValue, confidence: float | None, rationale: str | None, evidence_quote: str, page: str`.
- `def build_ai_proposals(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None`: `None` when `"ai_proposals"` is absent from `titles.fixed`. Headers are the 14 columns of Global Constraints; `field_code` from `layout.codebook`; `value` = `machine_value(row.value)`, `unit` = `row.value.unit` (D6).

- [ ] Write the failing tests:
  ```python
  def test_pre_0075_proposal_names_its_model():
      assert proposal_engine(_proposal(provenance={"provider": "openai", "model": "gpt-4o"}), had_snapshot=False) == EngineFacts("openai", "gpt-4o", "")
  def test_engine_facts_ignore_prompt_payload_and_never_borrow_provenance():
      assert proposal_engine(_proposal(snapshot={"strategy": "x"}, provenance={"model": "row"}), had_snapshot=True).model == ""
      assert proposal_engine(_proposal(snapshot={}, provenance={"model": "row"}), had_snapshot=True).model == ""
  def test_headers_have_no_outcome_column(): assert [c.value for c in spec.rows[0]] == ["article_id","instance_id","field_id","field_code","ai_proposal_id","provider","model","prompt_version","value","unit","confidence","rationale","evidence_quote","page"]
  def test_value_is_the_machine_scalar_with_its_unit():   # D6
      row = _ai_row(value=export_value(value_num=5, unit="mg"))
      assert (cells["value"], cells["unit"]) == (5, "mg")
  async def test_loader_does_not_select_prompt_text(db_session):  # before_cursor_execute idiom, test_extraction_batch_reads.py:170-180
      assert all("prompt_text" not in s or "-" in s for s in statements)
  async def test_cross_run_ai_proposal_appears_with_its_keys(db_session):
      # run1: land_ai_proposal, consensus, finalize; reopen_run → run2 (EXTRACT);
      # record_decision(run2, edit, value=AI value, proposal_record_id=old_pid); export single_user + include_ai_metadata
      assert (str(SEED.primary_article), str(inst), str(fid), str(old_pid)) in {(r[0], r[1], r[2], r[4]) for r in ai_rows}
  ```
- [ ] Run `cd backend && uv run pytest tests/unit/test_export_ai_proposal_projection.py tests/unit/test_extraction_ai_metadata_builder.py tests/integration/test_extraction_export_ai_proposals.py -q`. Expected: FAIL with `ImportError: proposal_engine`, or the wrong headers.
- [ ] Implement. Delete the heuristic, `reviewer_outcome`, `final_value_used`, `proposal_model_used` and `_untyped_field`.
- [ ] Run the tests again, adding `tests/integration/test_extraction_export_ai_value_resolution.py tests/integration/test_proposal_generation_read.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_service.py tests/unit/test_extraction_export_shape_filter.py tests/integration/test_extraction_export_golden_structure.py`. Expected: PASS.
- [ ] Run `grep -rn "reviewer_outcome\|final_value_used\|proposal_model_used\|_untyped_field\|extraction.ai_metadata\|build_ai_metadata" backend`. Expected: no output.
- [ ] Run `cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec`. Expected: no new findings.
- [ ] Commit: `feat(export): AI proposals sheet with keys and generation facts; drop the outcome heuristic`

### Task 9: Verification sheet and README lineage

**Files:**
- Create `backend/app/services/exports/extraction/verification.py`.
- Modify `backend/app/services/exports/extraction/workbook.py`: add `"verification"` to `_SHAPE_BUILDERS[COMPLETE]`, `_ARTICLE_BUILDERS`, `_FIXED_TITLES` (`"Verification"`) and `_ROLE_ORDER` (after `"data"`, before `"ai_proposals"`), with its `_ordered_specs` call in the same place; predicate `shape is COMPLETE and layout.mode is ExportMode.ALL_USERS` (R8): COMPLETE via `_SHAPE_BUILDERS`, the mode via a new `_role_present` branch.
- Modify `backend/app/services/exports/extraction/front_matter.py` (PR4): add the origin counts, the lineage block citing `LINEAGE_EXACT_SINCE`, the AI-tools table and the percent-agreement line; reword PR4's "Values outside any level sheet" (`_value_rows`, :87) to "Values only in Data" (R17).
- Delete the best-effort caveat (the last `_CAVEATS` entry, `front_matter.py:58-59`; PR4 moved it there from the service).
- Modify the R11 list: add an all_users CHARMS case to `backend/tests/integration/test_extraction_export_level_fixtures.py` expecting `[..., "Data", "Verification", "Codebook", "Options"]`.
- Test:
  - Create `backend/tests/unit/test_extraction_verification_builder.py`.
  - Extend `backend/tests/unit/test_extraction_front_matter_builder.py`: drop the best-effort assertion in `test_readme_carries_the_rule_notes_and_caveats` (:223), and change PR4's `("Values outside any level sheet", 1)` (:189) to `("Values only in Data", 1)`.

**Interfaces:**
- `def build_verification(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None`: `None` when `"verification"` is absent from `titles.fixed`.
  - Rows: the coordinates with at least one reviewer cell, in Data order.
  - Reviewer columns follow `layout.reviewers`. A cell is `display_value(v, field)` (R2, no `target`), or `"—"` when the reviewer is not in `layout.raters_by_run[article.run_id]` (R16).
  - [AI] appears only with `include_ai_metadata`: the latest current-run `AIProposalRow` per coordinate by `(created_at DESC, ai_proposal_id DESC)`, rendered with `display_value(row.value, field)`.
- `def match_of(raws_by_rater: Mapping[UUID, Any | None], n_raters: int, pinned_field: RunViewField | None) -> Literal["all_equal","conflict","incomplete"]`. `None` = no value; distinct values are counted over `canonical_keys` of the filled raws.
- `def agreement(layout: ExportLayout) -> tuple[int, int]`: `(all_equal, rows with n_raters ≥ 2)`.

- [ ] Write the failing tests (`_num = make_run_view_field(field_type="number")`):
  ```python
  def test_a_filled_b_blank_is_incomplete(): assert match_of({a: {"value": 1}, b: None}, 2, _num) == "incomplete"
  def test_two_distinct_values_conflict(): assert match_of({a: {"value": 1}, b: {"value": 2}}, 2, _num) == "conflict"
  def test_string_and_int_are_all_equal(): assert match_of({a: {"value": "7"}, b: {"value": 7}}, 2, _num) == "all_equal"
  def test_single_rater_never_all_equal(): assert match_of({a: {"value": 1}}, 1, _num) == "incomplete"
  def test_reviewer_outside_rater_set_shows_dash():
      layout = make_layout(mode=ExportMode.ALL_USERS, reviewers=(ra, rb), raters_by_run={run: (ra.reviewer_id,)}, ...)
      assert row[col_of("Member B")].value == "—"
  def test_verification_absent_outside_all_users():
      layout = make_layout(mode=ExportMode.CONSENSUS)
      assert build_verification(layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)) is None
  def test_readme_states_agreement_denominator_and_no_best_effort():
      flat = _flat(build_front_matter(layout, titles)); assert "rows with n_raters ≥ 2" in flat and "best-effort" not in flat.lower()
      assert LINEAGE_EXACT_SINCE.isoformat() in flat
  def test_readme_ai_tools_table_says_not_recorded(): assert "not recorded" in _flat(...)   # proposal without prompt_version
  def test_readme_has_one_out_of_sheet_row(): assert [r for r in rows if r[0] in ("Values only in Data", "Values outside any level sheet")] == [("Values only in Data", 1)]
  ```
- [ ] Run `cd backend && uv run pytest tests/unit/test_extraction_verification_builder.py tests/unit/test_extraction_front_matter_builder.py -q`. Expected: FAIL with `ModuleNotFoundError: verification`.
- [ ] Implement the signatures above.
- [ ] Run the tests again, plus `tests/integration/test_extraction_export_level_fixtures.py`. Expected: PASS.
- [ ] Commit: `feat(export): Verification sheet and README lineage, agreement and AI tools`

### Task 10: Cell budget

**Files:**
- Modify `backend/app/services/exports/extraction/run.py`: add `EXPORT_CELL_BUDGET` and `ExportTooLargeError` (beside `EmptyExportError`, :71); `build_export` checks the budget after the empty check (:103-104).
- Modify `backend/app/services/exports/extraction/workbook.py`: add `estimate_sheet_cells` and `estimate_cells`.
- Tests:
  - Create `backend/tests/integration/test_extraction_export_cell_budget.py`.
  - `backend/tests/unit/test_extraction_export_endpoint.py`: add a test after `test_status_other_users_failed_job_does_not_leak_error` (:117).
  - `backend/tests/unit/test_extraction_export_start_endpoint.py`: add the sync-path test beside `test_empty_export_is_422_with_the_stable_code` (:199). The sync path catches only `EmptyExportError` (`extraction_export.py:191`), so `ExportTooLargeError` propagates out of `_start` to the global `AppError` handler.
  - `backend/tests/integration/test_worker_eager_mode.py`: add a test after `test_export_extraction_task_fails_with_a_coded_message_when_empty` (:143), same idiom.

**Interfaces:**
- `def estimate_sheet_cells(layout: ExportLayout, shape: ExportShape) -> dict[str | UUID, int]`: an upper bound of `rows × columns` per present role, keyed like `titles` (string roles from `titles.fixed`, level `entity_type_id`s from `titles.levels`). It calls `allocate_titles(layout, shape, include_matrix=matrix_fits(layout))` so an omitted Matrix costs nothing. `R = 1 + len(layout.reviewers)` in ALL_USERS, else `1`. Bounds (R9):

  | Sheet | Upper bound |
  |---|---|
  | Data | `(len(value_map)+1) × len(DATA_COLUMNS)` |
  | Matrix | `_matrix_column_count × (fields + sections + 2)` |
  | Each level sheet | `(records × R + 1) × (5 + n_repeating_ancestors + 1 + 3 × n_fields)` |
  | Articles | `(articles × R + 1) × (5 + 1 + 3 × n_fields)` |
  | Verification | `(coords+1) × (13 + len(reviewers))` |
  | AI proposals | `(len(ai_proposal_rows)+1) × 14` |
  | Appraisal | `(len(appraisal.rows)+1) × (1 + len(domain_labels) + max(1, len(derived_labels)) + len(reviewers))` |
  | Codebook | `(len(codebook)+1) × 17` |
  | Options | `(options+1) × 5` |
  | README and Summary | `(articles + records + len(omitted) + 200) × 4` each |

  Publication shape: Articles and each level sheet add `+5` rows (one blank row plus up to four footnote rows: NI, NA, NE, NA*), headroom for PR6's footnotes (D7) so PR6 needs no budget change.

- `def estimate_cells(layout: ExportLayout, shape: ExportShape) -> int`: `sum(estimate_sheet_cells(layout, shape).values())`.
- `class ExportTooLargeError(AppError)`: `__init__(self, message: str)`, code `"EXPORT_TOO_LARGE"`, status 422. `build_export` raises it with `f"EXPORT_TOO_LARGE: this export would write {n:,} cells; the limit is {EXPORT_CELL_BUDGET:,}. Export fewer articles or a smaller shape."`.

- [ ] Write the failing tests:
  ```python
  async def test_oversized_build_raises_export_too_large(db_session, monkeypatch):
      monkeypatch.setattr("app.services.exports.extraction.run.EXPORT_CELL_BUDGET", 10)
      with pytest.raises(ExportTooLargeError) as exc: await build_export(db_session, req, user_id=str(SEED.primary_profile))
      assert exc.value.status_code == 422 and exc.value.message.startswith("EXPORT_TOO_LARGE: ")
  async def test_estimate_cells_bounds_rendered_cells_per_sheet(db_session):
      # all_users, two reviewers (primary + reviewer) each deciding on 3 records of one MANY section, include_ai_metadata
      for shape in ExportShape:
          titles = allocate_titles(layout, shape, include_matrix=matrix_fits(layout))
          wb = load_workbook(BytesIO(build_workbook(layout, shape, include_matrix=matrix_fits(layout))))
          est = estimate_sheet_cells(layout, shape)
          assert {titles.fixed.get(r) or titles.levels[r] for r in est} == set(wb.sheetnames), shape
          for role, n in est.items():
              ws = wb[titles.fixed.get(role) or titles.levels[role]]
              assert n >= ws.max_row * ws.max_column, (shape, role)
  def test_error_survives_celery_rebuild(): e = ExportTooLargeError("EXPORT_TOO_LARGE: x"); assert type(e)(*e.args).message == e.message
  async def test_sync_path_propagates_export_too_large():
      with pytest.raises(ExportTooLargeError):
          await _call_sync(_payload(), build_side_effect=ExportTooLargeError("EXPORT_TOO_LARGE: x"))
  def test_task_fails_without_retry_on_export_too_large():  # patches as in the :143 empty-export test
      res = export_extraction_task.apply(kwargs=_export_kwargs(), throw=False)
      assert res.state == "FAILURE" and str(res.result).startswith("EXPORT_TOO_LARGE: ")
      fake_storage.upload.assert_not_awaited()
  async def test_status_own_failed_job_carries_the_export_too_large_code(client):
      # mock_result.state="FAILURE", result=ExportTooLargeError("EXPORT_TOO_LARGE: 9 cells"); owner=CALLER_USER_ID
      assert res.json()["data"]["error"].startswith("EXPORT_TOO_LARGE: ")
  ```
- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_cell_budget.py tests/unit/test_extraction_export_endpoint.py tests/unit/test_extraction_export_start_endpoint.py tests/integration/test_worker_eager_mode.py -q`. Expected: FAIL with `ImportError: ExportTooLargeError`.
- [ ] Implement the signatures above.
- [ ] Run the tests again. Expected: PASS.
- [ ] Commit: `feat(export): refuse builds over the cell budget with EXPORT_TOO_LARGE`

### Task 11: Measure the provenance join and set the budget (spec §13)

**Files:**
- Modify `run.py`: the value of `EXPORT_CELL_BUDGET` and its comment.
- The measurement script lives in the scratchpad, uncommitted; its numbers go in the PR body.

- [ ] **Seed.** In a rolled-back `db_session`: `clone_charms` (`tests/integration/conftest.py:547`) into `SEED.primary_project`; `INSERT` 300 articles with `generate_series`; `open_session` per article; `INSERT … SELECT` two reviewers' decisions and states over every (instance × field), plus one published state and one consensus decision per coordinate.
- [ ] **Time the loaders.** `time.perf_counter` around `_load_reviewer_cells`, `_load_consensus_cells`, `_load_ai_proposed` and `_load_rater_labels`; capture `EXPLAIN (ANALYZE, BUFFERS)` for each. Expected: index scans on `uq_extraction_reviewer_states_run_reviewer_item`, `idx_extraction_reviewer_decisions_run_reviewer_item`, `idx_extraction_consensus_decisions_run_item` and `idx_extraction_proposal_records_run_item`; no seq scan on the decision tables. A seq scan → stop and report (a migration is out of scope).
- [ ] **Memory per cell.** Synthetic layouts of 200k and 400k Data cells; peak `tracemalloc` and wall time of `build_workbook`; confirm linear growth; compute `bytes_per_cell`.
- [ ] **Worker memory limit.** Railway MCP: `list-services`, then `get-service-config` (or `describe-service`) on the Celery worker. If unavailable or unset, use 1 GiB (fallback approved) and say so in the PR body.
- [ ] **Set the budget.** `EXPORT_CELL_BUDGET = min(5_000_000, floor(0.5 × worker_memory_limit / bytes_per_cell))`, rounded down to a multiple of 100_000. One-line comment: date, worker limit, bytes per cell, seconds per 1M cells; same numbers in the PR body.
- [ ] Run `cd backend && uv run pytest tests/integration/test_extraction_export_cell_budget.py -q`. Expected: PASS.
- [ ] Commit: `perf(export): set EXPORT_CELL_BUDGET from a measured build`

### Task 12: Gates

- [ ] **Backend lint.** `make lint-backend`. Expected: ruff, the formatter and the mypy ratchet clean.
- [ ] **Targeted backend tests.**
  ```
  cd backend && uv run pytest tests/unit/test_export_canonical_key.py tests/unit/test_extraction_export_origin.py \
    tests/unit/test_extraction_data_sheet_builder.py tests/unit/test_extraction_verification_builder.py \
    tests/unit/test_export_ai_proposal_projection.py tests/unit/test_extraction_ai_metadata_builder.py \
    tests/unit/test_extraction_front_matter_builder.py tests/unit/test_extraction_export_scope_marking.py \
    tests/unit/test_extraction_export_service.py tests/unit/test_extraction_export_determinism.py \
    tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_endpoint.py \
    tests/unit/test_extraction_export_start_endpoint.py tests/unit/test_extraction_export_level_fixtures.py \
    tests/unit/test_extraction_workbook_orchestrator.py tests/integration/test_extraction_export_cell_loaders.py \
    tests/integration/test_extraction_export_data_sheet.py tests/integration/test_extraction_export_ai_proposals.py \
    tests/integration/test_extraction_export_ai_value_resolution.py tests/integration/test_extraction_export_cell_budget.py \
    tests/integration/test_extraction_export_level_fixtures.py tests/integration/test_worker_eager_mode.py \
    tests/integration/test_run_lifecycle_service.py tests/integration/test_extraction_export_golden_structure.py -q
  ```
- [ ] **Full backend suite.** `make test-backend`. Expected: green, at most 25 skips.
- [ ] **Vulture.**
  1. In `scripts/vulture_baseline.py`, delete the `AIProposalRow` bullet (:86-87) and change "five shapes" to "four shapes" (:78).
  2. `cd backend && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --exec --update`.
  3. `git diff backend/.vulture_baseline`. Expected: only the header bullet (`.vulture_baseline:14-15`) and the deleted `AIProposalRow` field entries (`ai_proposed_value`, `final_value_used`, `instance_index`, `model_used`, `proposed_at`, `reviewer_outcome`, `.vulture_baseline:35-40`, plus any field Tasks 7–8 removed) leave; nothing is added.
- [ ] **File size.** `python3 scripts/fitness/check_file_size.py`, then `python3 scripts/fitness/check_file_size.py --update-baseline backend/app/services/extraction_export_service.py` (shrink only). New files stay under 800 lines.
- [ ] **Other fitness gates.** `python3 scripts/fitness/check_scope_guards.py` (covers `_load_orphan_fields`, `_load_ai_proposed`, `_load_rater_labels`).
- [ ] **No API or frontend change.** `git diff --stat dev -- frontend backend/app/schemas`. Expected: empty (R5).
- [ ] **Graph.** `graphify update .` if `graphify-out/graph.json` exists.
- [ ] Commit, if anything changed: `chore(export): tighten vulture and file-size baselines`

## Rulings applied

- **R1:** loaders key reviewer cells by `reviewer_id` in every mode, consensus by `None`; no re-keying; single-slot readers use `primary_rater`.
- **R2:** `display_value(v, field)` without `target` everywhere in PR5 (Verification cells, [AI] column); PR6 adds `target`.
- **R4:** `make_run` / `record_decision` / `export_service` move to `tests/integration/helpers/export_fixtures.py` (Task 4).
- **R5:** no dialog, copy, schema-description or API-type work; backend label map applies in every mode.
- **R8:** `data` (COMPLETE) and `verification` (COMPLETE + ALL_USERS) roles added; `articles`/`sheet_for(section_id)` consumed, with the Data `sheet` guard (blank, never `"Articles"`, for a section outside the active tree).
- **R8a:** the `ai_proposals` role id exists from PR1; PR5 only `git mv`s `ai_metadata.py` → `ai_proposals.py` (Task 8).
- **R9:** budget bounds per the table in Task 10, every sheet covered.
- **R11:** PR4 level-fixture and suffixed-title sheet lists gain Data (and Verification for all_users).
- **R12:** unit helpers extend `tests/unit/helpers/export_layouts.py` (`make_run_view_field`, `make_cell`, `ai_link`, new `make_layout` defaults).
- **R13, R14, R16, R17, R18:** PR4 names; one pinned-version load read through `layout.versions[*].run_view_fields`; `raters_by_run`, with PR4's `test_raters_by_run_groups_reviewers_per_run` rewritten (no `anonymize=`, labels from a stubbed `_load_rater_labels` map, Task 5); one "Values only in Data" row; `record_keys` consumed as `(record_id, parent_record_id, section)`.
- **R15:** `_untyped_field` and its test deleted in Task 8.
- **R21:** `LINEAGE_EXACT_SINCE` = PR2's recorded prod promotion date.
- **D3, D4, D6, D10:** `value_bool`; pseudonyms for others in non-manager exports; AI `value` machine scalar plus `unit`; LEFT JOIN latest consensus decision, selected decision's own link, orphan fields with a blank `sheet`.
