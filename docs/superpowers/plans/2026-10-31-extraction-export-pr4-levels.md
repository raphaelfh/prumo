---
status: in_progress
last_reviewed: 2026-11-01
owner: '@raphaelfh'
---

# Export PR4: Levels, identity and Codebook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-section tidy tables, Data dictionary and Dropdown lists with:
- one level sheet per repeating level, with shape-aware key columns and rule-6 record labels;
- a version-spanning Codebook and Options;
- "Surname Year" article labels;
- a README with status counts and no UUIDs, and a Summary that lists each omitted article.

**Architecture:**
- Pure tree helpers live in `exports/descriptors.py`: `walk_sections`, `level_of`, `instance_in_record`, `record_label`, `record_keys`, `count_level_records`.
- A pure codebook model lives in a new top-level `exports/codebook_model.py`. It sits outside `exports/extraction/` because of the import cycle.
- The service loads every version (active + pinned) once through `entity_types_for_version` and the article refs once, in `resolve_layout`.
- The builders read titles from the PR1 pre-pass (`SheetTitles`) and never allocate titles themselves.

**Tech Stack:** Python 3 / FastAPI service layer, SQLAlchemy 2 async, openpyxl, pytest (unit tests, plus integration tests against local Supabase Postgres).

**Spec:** `docs/superpowers/specs/2026-10-30-extraction-export-options-design.md`. This PR covers:
- §3 (sheet order, line 72);
- §4.2, §4.4, and §4.5 (status counts and the Summary omitted list);
- §5 rules 1–3, 6, 7 and 8;
- §6 `article_label`;
- the PR4 rows of §8, the §11 row-4 tests, and the PR4 items of §13.

**Depends on:**
- **PR1:**
  - `safe_sheet_title` and `RESERVED_TITLES` (`sheet_spec.py`).
  - `SheetTitles`, `allocate_titles` and `matrix_fits` (`workbook.py`).
  - `build_workbook(layout, shape, *, include_matrix)`.
  - Sub-builders shaped `build_<x>(layout, titles)`.
  - README contents read from `titles.order`; the Matrix-omitted note from `titles.matrix_omitted` (PR1 test `test_oversized_matrix_is_omitted_with_a_readme_note`).
  - `run.build_export`.
  - Fixed titles (R7): `"Matrix"`, `"Appraisal"`, `"AI proposals"`, and the AI role id `ai_proposals` (R8a). PR4 assumes them, has no fallback for older titles, and renames no fixed title.
- **PR3** (`exports/values.py`, `exports/descriptors.py`):
  - `ExportValue`, `display_value(v, field)` (no `target`, R2), `OptionLabels`, `build_option_labels(active)`. PR4 adds `pinned_latest_first`.
  - `value_key(run, instance, field, rater)`, `ValueKey` (rater = `k[3]`).
  - `primary_rater(mode, reviewer_id) -> UUID | None` (R1) and the single_user reviewer on `ExportLayout.reviewer_id`, which PR3's R1 readers need.
  - `ExportLayout.value_map: dict[ValueKey, ExportValue]`.
  - Unit test file `tests/unit/test_export_values.py` (R20).

**Branch:** `feat/export-levels-codebook` off `dev`.

## Contract changes (consumed by PR5/PR6 under these names)

| Contract §1 | Final here | Why |
|---|---|---|
| `CodebookEntry` in `exports/extraction/codebook.py`, field `sheet: str \| None` | `CodebookEntry` in `exports/codebook_model.py` with `section_id: UUID \| None` (no `sheet`) and `options: tuple[CodebookOption, ...]` (R12). The `sheet` cell is `titles.sheet_for(section_id)` at build time, blank when `section_id is None` | The service imports the type at module level, and `exports/extraction/__init__.py:13` → `workbook` → service closes the cycle. Titles exist only at build time. |
| `assign_field_codes(entries: Sequence[CodebookEntry])` | `assign_field_codes(candidates: Sequence[tuple[UUID, str, bool]]) -> dict[UUID, str]` in `codebook_model.py` | An entry already holds `field_code`, so the contract signature is circular. |
| `_load_codebook(...) -> tuple[CodebookEntry, ...]` | `_load_pinned_versions(...) -> tuple[VersionSections, ...]` (R14), active first. The entries are on `ExportLayout.codebook` | One `entity_types_for_version` call per version feeds sections, `RunViewField`s, the label chain, the codebook and `template_version`. PR5 reuses it. |
| `_load_article_labels(...) -> dict[UUID, str]` | `_load_article_refs(...) -> dict[UUID, ArticleRef]` (R13). The labels are `ArticleDescriptor.article_label` | One project-scoped query also yields doi/pmid. |
| `ArticleDescriptor.article_label: str = ""` (added) | `header_label` renamed to `article_label: str` (no default) | Avoids two divergent labels. |
| `ExportLayout` PR4 = drop `notes`/`data_dictionary`/`tidy_tables`; add `generated_at`/`omitted`/`codebook` | As contracted, and additionally: drop `front_matter` and `obsolete_fields`; add `appraisal_notes`, `raters_by_run` (R16), `versions` (R14), `narrow_pinned_versions` (D5) | The README is built from the layout. |
| — | `SheetTitles.sheet_for(section_id: UUID \| None) -> str \| None` and the `articles` role in `allocate_titles` (R8) | Codebook (PR4) and the Data `sheet` (PR5). |
| — | `record_keys(article, instance_id, sections)` in `descriptors.py` (R18) | Level sheets use it; PR5 only consumes it. |

## Global Constraints

- **No DDL and no data migration.** No change to the seed, the global catalogue or project template copies (§9).
- **Rule 1, levels:** "The root is Articles. Each `cardinality='many'` section is a level. Each `one` section joins its nearest repeating ancestor, or the root."
- **Rule 2, walk and skip:** "Sections are walked depth-first. A section is skipped only when neither it nor any descendant has fields."
- **Rule 3, field codes:** "`field_code` = `<section.name>.<field.name>`. Active-version fields always get the bare code. On a name clash, only non-active fields get a deterministic short-id suffix." Active–active clash (D1): the first field in walk order keeps the bare code, later ones get `__<8hex>`, and the README lists every clash.
- **Raters (R1, R16):** the single-slot readers (README counts, consensus/single_user level sheets) read `primary_rater(layout.mode, layout.reviewer_id)`, never a literal `None`. all_users level sheets read `(None, *layout.raters_by_run.get(run_id, ()))`; the rater set is the reviewers with ≥1 non-reject current decision on that run.
- **Reserved titles** are claimed first and compared case-insensitively: `README`, `Summary`, `Matrix`, `Articles`, `Data`, `Verification`, `AI proposals`, `Appraisal`, `Codebook`, `Options`, `History`.
- **Review-workbook sheet order** (§3): README · Summary · [Matrix] · Articles · one sheet per repeating level · [AI proposals] · [Appraisal] · Codebook · Options. Data and Verification arrive in PR5.
- **Level sheets:**
  - Review-workbook titles come from the section code. Publication titles come from the section label.
  - Level sheets carry active-version fields only.
- **`Articles` columns:** `article_id, article_label, doi, pmid, template_version`, then the root-level fields, then `rater` in `all_users`.
- **Other level sheets:** key columns `article_id, article_label, record_id, parent_record_id, record_label`, then one `<ancestor_code>.label` column per repeating ancestor, then `rater` in `all_users`, then the fields. Each record gets one consensus row next to its reviewer rows.
- **Review-workbook cells:**
  - One column per `field_code`.
  - A `.unit` companion when the field has `allowed_units`; otherwise the header reads "code (unit)".
  - An `.other` companion when the field has `allow_other`.
  - Absent markers and out-of-scope recorded values are blank.
  - When two ONE instances share a parent, the cell shows the first.
- **Publication cells:** field-label headers ("Label (unit)"). No `.unit`/`.other` companions and no UUID columns.
- **`rater`** is the reserved literal `consensus` on consensus rows.
- **Codebook columns:** `field_code, field_id, sheet, section_code, section_label, parent_section_code, field_label, type, unit, allowed_units, required, is_entity_key, allowed_absent_codes` (joined with `"; "`), `allow_other, description, in_current_version, versions`.
  - Scope: every version pinned by any run of this template in this project, plus the active version, independent of `article_ids`.
  - Metadata comes from the active version, otherwise from the latest pinned version.
  - `sheet` is blank only when the field's section is absent from the active tree.
  - Narrow legacy pinned snapshots are skipped (D5); the README counts them.
- **Options:** one row per (`field_code`, `code`), with `label, order, in_current_version`. It uses the same label chain and replaces Dropdown lists.
- **`article_label`:** "Surname Year".
  - Fallbacks, in order: the surname, then `title[:60]`, then the short id.
  - Shared labels (D2): in `(created_at, id)` order the first keeps the bare label, later ones get `b`, `c`, …. A label is stable once it appears; deleting an article can shift later suffixes, and the README says so.
  - Built in one query, with `project_id` in the WHERE clause.
- **Rule 6:**
  - A keyed instance's `record_label` is its trimmed `instance.label`. Otherwise it is the positional "{stem} {i}", with no article prefix.
  - The same rule fills every `<ancestor_code>.label`.
- **Rule 7:**
  - A field missing from the pinned version gives a blank cell.
  - `field_id` survives moves.
  - A value without an active level sheet is counted in the README row "Values outside any level sheet", the only such count (R17).
- **Rule 8:**
  - Appraisal appears when a **root** section has a SELECT field whose labels are all in the vocabulary.
  - A custom appraisal template gets no sheet and a README note.
  - Domains that are not at the root are skipped, with a README note.
- **Summary reasons:** `pending`, `extract`, `consensus`, `cancelled`, `no_run`, `no_decisions_from_reviewer`.
- **README:** no UUIDs anywhere.
- **Gates:**
  - New files stay ≤ 800 lines (`scripts/fitness/check_file_size.py:34`).
  - The `extraction_export_service.py` baseline of 2156 (`check_file_size.baseline:5`; the file is 2150 lines on `dev`) only shrinks.
  - The vulture baseline is shrink-only.
  - Every commit is green on its own suites.

## Review Focus

1. **A section whose code equals a reserved title in another case** (a MANY section named `options`). It must get a suffixed level title, and its Codebook `sheet` must equal that suffixed title. Test in Task 8.
2. **A ONE → ONE chain below a record** (MANY > fieldless ONE > fielded ONE). `instance_in_record` must walk two singleton steps. Tests in Tasks 3 and 7.
3. **A keyed instance whose label is blank.** It must fall back to "{stem} {i}". Test in Task 4.
4. **Two title-only articles that share their first 60 characters.** The first keeps the bare label, the second gets `b` (D2), and no Publication or README cell matches the UUID pattern. Tests in Tasks 5, 7 and 9.
5. **`all_users` with a reviewer who decided on article A only, and one whose only decisions are rejects.** No reviewer rows on B, no rows for the reject-only reviewer, `(record_id, rater)` stays unique, and the README status counts read the primary slot only. Tests in Tasks 7 and 9.
6. **single_user.** Level sheets and README counts read `primary_rater(layout.mode, layout.reviewer_id)`, i.e. the `reviewer_id` slot (R1); no reader keys single_user as `rater=None`, so a stray consensus key is ignored. Tests in Tasks 7 and 9.

## Tasks

### Task 1: Pin the §13 PR4 facts (section names may repeat)

**Files:**
- Create: `backend/tests/integration/test_extraction_export_identity_facts.py`
- Modify: `docs/superpowers/specs/2026-10-30-extraction-export-options-design.md` §5 rule 3 (record D1) and §6 (record D2).

**Evidence (read-only; record it in the commit body):**
- `section.name` is NOT unique within a template:
  - `ExtractionEntityType.__table_args__` holds two CHECKs only (`models/extraction.py:376-386`).
  - The baseline has no unique index on it (`baseline_v1.sql:1203,1471,1475`).
  - `create_section` does no name check (`template_section_service.py:136-183`).
  - The name is immutable after create: `SectionUpdateRequest` has no `name` (`schemas/template_structure.py:358`).
  - Field names are unique per section (`models/extraction.py:470-481`, `uq_extraction_fields_entity_type_name`).
- A restored field keeps its id (`template_versioning/_restore.py:411`). This is pinned by `test_draft_deleted_field_is_recreated` (`tests/integration/test_template_restore_service.py:521`).

- [ ] **Step 1: Write the characterization test.**
  ```python
  async def test_two_sections_in_one_template_may_share_a_name(db_session):
      await clean_project_clones(db_session, SEED.secondary_project)
      clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
      payload = SectionCreateRequest(name="dup_section", label="Dup", cardinality="one")
      a = await create_section(db_session, project_id=SEED.secondary_project,
                               template_id=clone.project_template_id, payload=payload)
      b = await create_section(db_session, project_id=SEED.secondary_project,
                               template_id=clone.project_template_id, payload=payload)
      assert a.id != b.id and a.name == b.name == "dup_section"
  ```
- [ ] **Step 2: Run it.**
  - Command: `cd backend && uv run pytest tests/integration/test_extraction_export_identity_facts.py -q`
  - Expected: PASS (characterization). The active–active clash is reachable, so Task 6 applies D1 and spec §5 rule 3 records D1 in this commit.
- [ ] **Step 3: Commit.** `test(export): pin that section names may repeat within a template` (body: evidence above, D1/D2 recorded in the spec).

### Task 2: Carry codebook metadata through the snapshot projection

**Files:**
- Modify:
  - `backend/app/services/exports/extraction_snapshot_reader.py:43-55,109-122`
  - `backend/app/services/extraction_export_service.py:114-135` (`FieldDescriptor`) and `:853-891` (`_load_sections`)
- Test:
  - `backend/tests/unit/test_extraction_export_snapshot_sections.py`
  - `backend/tests/unit/test_extraction_export_load_sections.py`

**Interfaces:**
- **Produces, on `SnapshotField`** (all defaulted): `allowed_units: tuple[str, ...] = ()`, `is_entity_key: bool = False`, `allowed_absent_codes: tuple[str, ...] = ()`.
- **Produces, on `FieldDescriptor`:** `code: str = ""` and the same three fields.

- [ ] **Step 1: Write the failing test.**
  ```python
  def test_field_view_carries_units_key_and_absent_codes() -> None:
      view = _container_view({"fields": [{
          "id": str(uuid4()), "name": "dose", "label": "Dose", "field_type": "number",
          "is_required": False, "sort_order": 0, "allowed_units": ["mg", "g", 3],
          "is_entity_key": True, "allows_not_applicable": True,
          "allows_not_evaluated": False, "allows_no_information": True}]})
      f = _section_from_view(view).fields[0]
      assert f.allowed_units == ("mg", "g")
      assert f.is_entity_key is True
      assert f.allowed_absent_codes == ("no_information", "not_applicable")
  ```
  Also extend `test_load_sections_maps_snapshot_metadata` (`test_extraction_export_load_sections.py:28`) to assert that the three fields are mapped onto the descriptor.
- [ ] **Step 2: Run it.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_export_snapshot_sections.py tests/unit/test_extraction_export_load_sections.py -q`
  - Expected: FAIL with `AttributeError: 'SnapshotField' object has no attribute 'allowed_units'`.
- [ ] **Step 3: Implement.**
  - `_field_from_view` keeps only the `str` items of a list-valued `allowed_units` (same filter as `_unit_strings`, `api/mcp/tools/templates.py:350-354`).
  - `allowed_absent_codes` follows `AbsentReason` order (`value_semantics.py:53-55`).
  - `_load_sections` copies the three fields.
  - `code` stays `""` until Task 8.
- [ ] **Step 4: Run it.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): project allowed units, entity key and absent codes into export descriptors`

### Task 3: Rule 2, one depth-first walk, and rule 1 `level_of`

**Files:**
- Modify:
  - `backend/app/services/exports/descriptors.py`:
    - add `walk_sections`, `level_of` and `instance_in_record`;
    - rename `_ancestry` (`:262`) to `ancestry`.
  - `backend/app/services/exports/extraction/matrix.py:174-176` (`build_matrix`): iterate `walk_sections(layout.sections)` and delete the `MANY and not fields` skip.
  - `backend/app/services/exports/extraction_scope_marking.py` (R10): `reader_instance_ids(section, article, sections)` (`:74-86`) returns `all_instances_of(article, section.entity_type_id)` when `section` is in `walk_sections(sections)`, else `()`; the `MANY and not section.fields` skip (`:84`) is deleted. The caller (`:145`) passes `sections`.
- Test:
  - `backend/tests/unit/test_extraction_export_entry_columns.py`
  - `backend/tests/unit/test_extraction_matrix_builder.py`
  - `backend/tests/unit/test_extraction_export_scope_marking.py`

**Interfaces:**
- **Produces:**
  - `def walk_sections(sections: Sequence[SectionDescriptor]) -> tuple[SectionDescriptor, ...]`
    - Preorder from the roots.
    - Children ordered by `(sort_order, str(entity_type_id))` (`_children_of`, `:94`).
    - A cycle guard.
    - Drops subtrees that have no field.
  - `def level_of(section: SectionDescriptor, sections: Sequence[SectionDescriptor]) -> UUID | None`
  - `def ancestry(section, sections) -> list[SectionDescriptor]`
  - `def instance_in_record(section: SectionDescriptor, article: ArticleDescriptor, record_id: UUID | None, sections: Sequence[SectionDescriptor]) -> UUID | None`
    - Walks the ONE steps from the level instance down to `section`, taking `entries[(step, parent)][0]` at each step.

- [ ] **Step 1: Write the failing tests.** `_fielded(s)` is `replace(s, fields=(FieldDescriptor(field_id=uuid4(), label="x", type=ExtractionFieldType.TEXT, allowed_values=()),))`.
  ```python
  def test_walk_is_depth_first_and_drops_only_fieldless_subtrees() -> None:
      g = _sec(uuid4(), many=True, order=0)
      items = _fielded(_sec(uuid4(), parent=g.entity_type_id, many=True, order=2))
      empty = _sec(uuid4(), order=1)
      flat = _fielded(_sec(uuid4(), order=3))
      assert [s.entity_type_id for s in walk_sections((flat, empty, items, g))] == [
          g.entity_type_id, items.entity_type_id, flat.entity_type_id]

  def test_walk_terminates_on_a_parent_cycle() -> None:
      a_id, b_id = uuid4(), uuid4()
      a = _fielded(_sec(a_id, parent=b_id, many=True)); b = _fielded(_sec(b_id, parent=a_id, many=True))
      assert walk_sections((a, b)) == ()

  def test_level_of_is_the_nearest_repeating_self_or_ancestor() -> None:
      g = _sec(uuid4(), many=True); child = _sec(uuid4(), parent=g.entity_type_id); root = _sec(uuid4())
      secs = (g, child, root)
      assert (level_of(g, secs), level_of(child, secs), level_of(root, secs)) == (
          g.entity_type_id, g.entity_type_id, None)

  def test_instance_in_record_walks_two_singleton_steps() -> None:      # Review Focus 2
      g = _sec(uuid4(), many=True); mid = _sec(uuid4(), parent=g.entity_type_id)
      leaf = _sec(uuid4(), parent=mid.entity_type_id)
      e1, m1, l1 = uuid4(), uuid4(), uuid4()
      art = _article({(g.entity_type_id, None): (e1,), (mid.entity_type_id, e1): (m1,),
                      (leaf.entity_type_id, m1): (l1,)})
      assert instance_in_record(leaf, art, e1, (g, mid, leaf)) == l1
      assert instance_in_record(g, art, e1, (g, mid, leaf)) == e1
  ```
  Add `test_matrix_bands_a_fieldless_group_that_owns_fields` to `test_extraction_matrix_builder.py`: a fieldless MANY "Groups" with a fielded MANY child "Items" gives column-A bands `["1. Groups", "2. Items"]`.
  In `test_extraction_export_scope_marking.py` (R10), using its `_section`/`_field` builders (`:88`, `:74`):
  ```python
  def test_reader_instance_ids_follows_the_walk() -> None:
      many = ExtractionCardinality.MANY
      g = _section(uuid4(), "groups", (), cardinality=many)               # fieldless MANY, owns items
      items = replace(_section(uuid4(), "items", (_field(uuid4(), "x"),), cardinality=many),
                      parent_entity_type_id=g.entity_type_id)
      empty = _section(uuid4(), "empty", (), cardinality=many)            # fieldless subtree
      e1, p1, p2, x1 = uuid4(), uuid4(), uuid4(), uuid4()
      art = ArticleDescriptor(article_id=uuid4(), header_label="A", run_id=uuid4(), version_id=None,
          entries={(g.entity_type_id, None): (e1,), (items.entity_type_id, e1): (p1, p2),
                   (empty.entity_type_id, None): (x1,)})
      secs = (g, items, empty)
      assert reader_instance_ids(g, art, secs) == (e1,)
      assert reader_instance_ids(items, art, secs) == (p1, p2)
      assert reader_instance_ids(empty, art, secs) == ()
  ```
  Expected red: `TypeError` (3 args). Task 5 renames `header_label` here.
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_export_entry_columns.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_export_scope_marking.py -q`
  - Expected: FAIL with `ImportError: cannot import name 'walk_sections'`.
- [ ] **Step 3: Implement.**
  - `level_of` returns the id of the last MANY in `ancestry(section, sections)`, or `None`.
  - `build_matrix` loops over `walk_sections(layout.sections)`.
  - `reader_instance_ids` as in Files. `grep -rn "not section.fields" backend/app/services/exports` then shows only the tidy skip at `extraction_export_service.py:1949`, which Task 7 deletes.
- [ ] **Step 4: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_export_entry_columns.py tests/unit/test_extraction_matrix_builder.py tests/unit/test_extraction_export_scope_marking.py tests/unit/test_extraction_export_golden_charms.py tests/unit/test_extraction_export_determinism.py -q`
  - Expected: PASS. Fieldless ONE leaves were already absent from the matrix bands, so the golden numbering holds. Any shift is rule 2: update the literal and name the section in the commit body.
- [ ] **Step 5: Commit.** `refactor(export): one depth-first walk replaces the matrix and scope-marking skip rules`

### Task 4: Rule 6 record labels through `iter_records`

**Files:**
- Modify:
  - `backend/app/services/exports/descriptors.py:252-313` (`_stem`, `_ancestry`, `iter_records`): add `record_label`, and `iter_records` returns label chains.
  - `backend/app/services/extraction_export_service.py:162-179`: `ArticleDescriptor.keyed_labels`.
  - `backend/app/services/extraction_export_service.py:1957-1963` (`_build_tidy_tables`): read the chain shape. Task 7 deletes this.
  - `backend/app/services/exports/extraction/summary.py:56,81-85`
- Test: `backend/tests/unit/test_extraction_export_entry_columns.py:242-302`. The three `iter_records` expectations are rewritten.

**Interfaces:**
- **Produces:**
  - `ArticleDescriptor.keyed_labels: Mapping[UUID, str] = field(default_factory=dict)`
  - `def record_label(section: SectionDescriptor, article: ArticleDescriptor, instance_id: UUID, position: int) -> str`
    - Returns `article.keyed_labels.get(instance_id) or f"{_stem(section)} {position}"`.
  - `def iter_records(section, article, sections) -> tuple[tuple[UUID, tuple[tuple[UUID, str], ...]], ...]`
    - Each record is `(instance_id, chain)`.
    - `chain` holds one `(instance_id, record_label)` per repeating level, root first.

- [ ] **Step 1: Write the failing tests.**
  ```python
  def test_record_label_prefers_the_trimmed_label_of_a_keyed_instance() -> None:
      g = _labelled(uuid4(), many=True, noun="model"); e1, e2 = uuid4(), uuid4()
      art = replace(_article({(g.entity_type_id, None): (e1, e2)}), keyed_labels={e1: "XGBoost"})
      assert record_label(g, art, e1, 1) == "XGBoost"
      assert record_label(g, art, e2, 2) == "Model 2"

  def test_blank_keyed_label_falls_back_to_position() -> None:           # Review Focus 3
      g = _labelled(uuid4(), many=True, noun="model"); e1 = uuid4()
      art = replace(_article({(g.entity_type_id, None): (e1,)}), keyed_labels={e1: ""})
      assert record_label(g, art, e1, 1) == "Model 1"
  ```
  Rewrite `test_records_for_a_nested_group_name_both_levels` (`:284`) to expect `((p1, ((e1, "Model 1"), (p1, "Predictor 1"))), …)`.
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_export_entry_columns.py -q`
  - Expected: FAIL with `ImportError: cannot import name 'record_label'`.
- [ ] **Step 3: Implement.**
  - `iter_records` calls `record_label(level, article, instance_id, i)` (`:304-309`).
  - Summary joins with `" · ".join(label for _, label in chain)`.
  - `_build_tidy_tables` uses `" — ".join((article.header_label, *(label for _, label in chain)))`.
- [ ] **Step 4: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_export_entry_columns.py tests/unit/test_extraction_summary_builder.py tests/unit/test_extraction_export_tidy_tables_projection.py tests/unit/test_extraction_export_tidy_model_section.py -q`
  - Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): label keyed records by their given name (rule 6)`

### Task 5: Article identity, "Surname Year" with a/b suffixes, project-scoped

**Files:**
- Modify `backend/app/services/extraction_export_service.py`:
  - Rename `ArticleDescriptor.header_label` (`:174`) to `article_label`. Add `doi`, `pmid` and `template_version`.
  - Replace `_load_article_headers` (`:1054-1074`) and `_build_header_label` (`:2099-2118`).
  - `_build_article_descriptors` (`:973-1005`; today it calls `_load_article_headers` itself, `:994`) takes `refs` and `version_numbers`, and fills `keyed_labels` from `entity_key.key_of` (`entity_key.py:117`).
  - Thread `refs` and `version_numbers` through the three resolvers (`:927`, `:1108`, `:1344`).
  - Rename the readers at `:769` (`AppraisalRow.record_label`) and `:1757` (`AIProposalRow.article_label`), plus `matrix.py:146` and `summary.py:71`.
- Modify tests:
  - `backend/tests/unit/test_extraction_export_header_label.py` (rewrite).
  - `backend/tests/unit/test_extraction_export_service.py`:
    - Delete the `_build_header_label` import (`:42`) and `TestBuildHeaderLabel` (`:1623-1676`).
    - Delete `TestLoadArticleHeaders` (`:2036-2058`, two tests).
    - Replace the `_load_article_headers` AsyncMocks (`:453`, `:486`, `:513`, `:545`, `:2171`, `:2344`; docstring `:417`) with a `refs={aid: ArticleRef("Smith 2020", None, None)}` argument on those resolver calls, since the resolvers now take `refs` instead of loading labels.
  - Rename in the remaining files from `grep -rlw header_label backend/tests`.
- Create: `backend/tests/integration/test_extraction_export_identity.py`

**Interfaces:**
- **Produces:**
  - `@dataclass(frozen=True, slots=True) class ArticleRef: label: str; doi: str | None; pmid: str | None`
  - `def _base_label(title: str | None, authors: list[str] | None, year: int | None, article_id: UUID) -> str`
    - Reuses `_extract_surname` (`:2069`).
  - `def _suffix_labels(rows: Sequence[tuple[UUID, str, datetime]]) -> dict[UUID, str]`
    - D2: in `(created_at, str(id))` order the first of a group keeps the bare label; the i-th later one (i ≥ 1) appends `_letter_for(i).lower()` (`:2125`), i.e. `b`, `c`, ….
  - `async def _load_article_refs(self, *, project_id: UUID) -> dict[UUID, ArticleRef]`
    - One `select(Article.id, title, authors, publication_year, created_at, doi, pmid).where(Article.project_id == project_id)`.
  - `ArticleDescriptor`: `article_label: str`, `doi: str | None = None`, `pmid: str | None = None`, `template_version: int | None = None`.

- [ ] **Step 1: Write the failing tests.**
  ```python
  @pytest.mark.parametrize("authors, year, expected", [
      (["Carlo De Feo"], 2012, "De Feo 2012"), (["van der Berg, Anna"], 2019, "van der Berg 2019"),
      (["Smith, John"], 2000, "Smith 2000"), (["De Feo, Carlo"], None, "De Feo")])
  def test_base_label_is_surname_space_year(authors, year, expected):
      assert _base_label(None, authors, year, uuid4()) == expected

  def test_title_only_articles_sharing_60_chars_get_suffixes():          # Review Focus 4
      a, b = uuid4(), uuid4(); t = "T" * 70
      base = _base_label(t, None, None, a)
      assert base == "T" * 60
      out = _suffix_labels([(b, base, datetime(2026, 1, 2, tzinfo=UTC)), (a, base, datetime(2026, 1, 1, tzinfo=UTC))])
      assert out == {a: "T" * 60, b: "T" * 60 + "b"}

  def test_no_title_no_author_falls_back_to_8_hex_short_id():
      aid = uuid4()
      assert _base_label(None, None, None, aid) == _short_id(aid) and len(_short_id(aid)) == 8
  ```
  The integration tests insert articles through `INSERT INTO public.articles (id, project_id, title, row_version, authors, publication_year, created_at)`, following the pattern at `conftest.py:366-371`.
  ```python
  async def test_smith_2020_labels_never_change_once_they_appear(db_session):   # D2
      # article a (t0) in SEED.secondary_project, authors ["Zyxsmith, A"], year 2020
      refs = await svc._load_article_refs(project_id=SEED.secondary_project)
      assert refs[a].label == "Zyxsmith 2020"
      # insert b at t1, then c at t2
      refs = await svc._load_article_refs(project_id=SEED.secondary_project)
      assert (refs[a].label, refs[b].label, refs[c].label) == (
          "Zyxsmith 2020", "Zyxsmith 2020b", "Zyxsmith 2020c")
      assert SEED.primary_article not in refs                     # project_id in WHERE

  async def test_resolved_article_carries_label_refs_version_and_keyed_label(db_session):
      ctx = await seeded_export_fixture(db_session, section_cardinality=ExtractionCardinality.MANY,
                                        instance_count=2)   # test_extraction_export_many_cardinality_fanout.py:44
      # UPDATE instance ctx.ordered_instance_ids[0]: label '  XGBoost ', metadata {"entity_key": "xgboost"}
      # UPDATE public.articles SET doi='10.1/x', pmid='123' WHERE id = ctx.article_id
      layout = await ctx.service.resolve_layout(project_id=ctx.project_id, template_id=ctx.template_id,
          mode=ExportMode.CONSENSUS, article_ids=[ctx.article_id],
          include_ai_metadata=False, anonymize_reviewer_names=False)
      art = layout.articles[0]
      assert art.keyed_labels == {ctx.ordered_instance_ids[0]: "XGBoost"}
      assert (art.doi, art.pmid) == ("10.1/x", "123")
      assert art.template_version == (await db_session.execute(text(
          "SELECT version FROM public.extraction_template_versions WHERE id = :v"),
          {"v": str(ctx.version_id)})).scalar_one()
  ```
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_export_header_label.py tests/integration/test_extraction_export_identity.py -q`
  - Expected: FAIL with `ImportError: cannot import name '_base_label'`.
- [ ] **Step 3: Implement.**
  - Load `refs` once in `resolve_layout`.
  - `version_numbers = {version.id: version.version}` until Task 8.
  - `article_label = refs[aid].label` if present, else `_short_id(aid)`.
  - `keyed_labels = {i.id: i.label.strip() for i in insts if entity_key.key_of(i) is not None}`.
  - Delete `_load_article_headers`, `_build_header_label` and their tests **first**.
  - Then rename with word boundaries: `rg -lw header_label backend | xargs perl -pi -e 's/\bheader_label\b/article_label/g'`.
  - Asserted header strings change from "Gaca, 2011" to "Gaca 2011".
- [ ] **Step 4: Run them.**
  - Command: same as Step 2, plus `tests/unit/test_extraction_export_service.py tests/unit/test_extraction_summary_builder.py tests/unit/test_extraction_matrix_builder.py`
  - Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): project-scoped "Surname Year" article labels with stable suffixes`

### Task 6: Codebook model, field codes (rule 3), pinned label chain, test layout helper

**Files:**
- Create:
  - `backend/app/services/exports/codebook_model.py`. It is pure and imports the service under `TYPE_CHECKING` only, as at `descriptors.py:33-39` and `values.py:28-30`.
  - `backend/tests/unit/helpers/export_layouts.py`
  - `backend/tests/unit/test_extraction_export_codebook_model.py`
- Modify:
  - `backend/app/services/exports/values.py` (PR3): `build_option_labels` gains the pinned union as a defaulted parameter, so PR3's one-argument callers keep working.
  - `backend/app/services/extraction_export_service.py`: add `ExportLayout.codebook: tuple[CodebookEntry, ...] = ()`, with a module-level import from `exports/codebook_model`.
- Test: `backend/tests/unit/test_export_values.py` (PR3's file for `values.py`, R20).

**Interfaces:**
- **Produces:**
  ```python
  @dataclass(frozen=True, slots=True)
  class VersionSections:                      # R14
      version_id: UUID; version_label: int    # ExtractionTemplateVersion.version
      sections: tuple[SectionDescriptor, ...]
      run_view_fields: Mapping[UUID, RunViewField]   # schemas/extraction_run.py:204
  @dataclass(frozen=True, slots=True)
  class CodebookOption: code: str; label: str; order: int; in_current_version: bool
  @dataclass(frozen=True, slots=True)
  class CodebookEntry:
      field_id: UUID; field_code: str; section_id: UUID | None; section_code: str
      section_label: str; parent_section_code: str | None; field_label: str
      type: ExtractionFieldType; unit: str | None; allowed_units: tuple[str, ...]
      required: bool; is_entity_key: bool; allowed_absent_codes: tuple[str, ...]
      allow_other: bool; description: str | None; in_current_version: bool
      versions: tuple[int, ...]; options: tuple[CodebookOption, ...]
  def assign_field_codes(candidates: Sequence[tuple[UUID, str, bool]]) -> dict[UUID, str]
  def build_codebook_entries(active: VersionSections, pinned_latest_first: Sequence[VersionSections],
                             labels: OptionLabels) -> tuple[CodebookEntry, ...]
  def apply_field_codes(sections: Sequence[SectionDescriptor], codes: Mapping[UUID, str]
                        ) -> tuple[SectionDescriptor, ...]
  def field_code_clashes(entries: Sequence[CodebookEntry]) -> tuple[tuple[str, tuple[str, ...]], ...]
  # exports/values.py (PR3 signature extended; default keeps PR3's build_option_labels(active) callers valid)
  def build_option_labels(active: Sequence[SectionDescriptor],
                          pinned_latest_first: Sequence[Sequence[SectionDescriptor]] = ()) -> OptionLabels
  ```
  `field_code_clashes` (D1, README input): groups entries by bare code, `e.field_code.removesuffix(f"__{str(e.field_id).split('-')[0]}")`, and returns `(bare, codes in entry order)` for each group of two or more, in entry order.
- **Code rule:**
  - The bare code is `f"{section.name}.{field.name}"`, from the field's metadata source.
  - The suffix is `f"{bare}__{str(field_id).split('-')[0]}"`.
  - Candidates are ordered as active fields in `walk_sections` order, then non-active fields latest-version-first.
  - An active field keeps the bare code unless an earlier active candidate holds it (D1).
  - A non-active field gets the bare code only when no other candidate shares it.
- **Entry rule:**
  - Metadata comes from the active version, else the highest `version_label` that contains the field.
  - `versions` is ascending.
  - `section_id` is the source section's id when that id is in the active tree, else `None`.
  - Options are the union of `(field_id, code)` over active, then pinned latest-first.
  - `order` is the 1-based position in the first version that has the pair.
  - `label` is `labels[(field_id, code)]`. Every pair is in `labels`, because `build_option_labels` covers the same union.
- **`export_layouts.py`** (R12: the one unit-test layout helper module; PR5/PR6 extend it):
  - `export_value(status="answered", **over) -> ExportValue`: every field defaults to `None`, `out_of_scope=False`.
  - `make_layout(*, sections=(), articles=(), value_map=None, mode=ExportMode.CONSENSUS, reviewers=(), **over) -> ExportLayout`:
    - Fills `notes=ExportNotes()` (all fields defaulted, `extraction_export_service.py:190-196`). Task 9 switches it to `generated_at=datetime(2026, 1, 1, tzinfo=UTC)`.
    - `labels = over.pop("option_labels", None) or build_option_labels(sections, [])`; fills `codebook=build_codebook_entries(VersionSections(uuid4(), 1, tuple(sections), {}), (), labels)`. `option_labels` is a `make_layout` kwarg only, not an `ExportLayout` field.
    - Fills `sections=apply_field_codes(sections, codes)`.
    - `over` wins (e.g. `reviewer_id=`, `raters_by_run=` once Task 7 adds it).

- [ ] **Step 1: Write the failing tests.**
  ```python
  def test_active_field_keeps_bare_code_and_clashing_removed_field_is_suffixed():
      sec_id = uuid4(); a, b = uuid4(), uuid4()
      active = VersionSections(uuid4(), 2, (_s(sec_id, "participants", _f(a, "age")),), {})
      v1 = VersionSections(uuid4(), 1, (_s(sec_id, "participants", _f(b, "age")),), {})
      codes = {e.field_id: e.field_code for e in build_codebook_entries(active, (v1,), {})}
      assert codes == {a: "participants.age", b: f"participants.age__{str(b).split('-')[0]}"}

  def test_two_active_fields_sharing_a_code_suffix_only_the_later_one():   # D1
      a, b = uuid4(), uuid4()
      assert assign_field_codes([(a, "dup.x", True), (b, "dup.x", True)]) == {
          a: "dup.x", b: f"dup.x__{str(b).split('-')[0]}"}

  def test_field_code_clashes_list_each_shared_bare_code():               # D1 README input
      a, b = uuid4(), uuid4()
      active = VersionSections(uuid4(), 1, (_s(uuid4(), "dup", _f(a, "x"), order=0), _s(uuid4(), "dup", _f(b, "x"), order=1)), {})
      entries = build_codebook_entries(active, (), {})
      assert field_code_clashes(entries) == (("dup.x", ("dup.x", f"dup.x__{str(b).split('-')[0]}")),)

  def test_removed_section_field_has_no_section_id_and_lists_its_versions():
      gone = uuid4(); active = VersionSections(uuid4(), 3, (), {})
      v1 = VersionSections(uuid4(), 1, (_s(uuid4(), "old", _f(gone, "x", label="Old")),), {})
      v2 = VersionSections(uuid4(), 2, (_s(uuid4(), "old", _f(gone, "x", label="Newer")),), {})
      (e,) = build_codebook_entries(active, (v2, v1), {})
      assert (e.section_id, e.in_current_version, e.versions, e.field_label) == (None, False, (1, 2), "Newer")

  def test_renamed_option_gives_one_row_labelled_from_active():
      fid, sid = uuid4(), uuid4()
      active = VersionSections(uuid4(), 2, (_s(sid, "s", _sel(fid, "smoking", ("None", "None reported"))),), {})
      v1 = VersionSections(uuid4(), 1, (_s(sid, "s", _sel(fid, "smoking", ("None", "No"))),), {})
      (e,) = build_codebook_entries(active, (v1,), build_option_labels(active.sections, [v1.sections]))
      assert e.options == (CodebookOption("None", "None reported", 1, True),)

  def test_option_dropped_from_active_keeps_a_non_current_row():
      fid, sid = uuid4(), uuid4()
      active = VersionSections(uuid4(), 2, (_s(sid, "s", _sel(fid, "c", ("A", "A"))),), {})
      v1 = VersionSections(uuid4(), 1, (_s(sid, "s", _sel(fid, "c", ("A", "A"), ("B", "Bee"))),), {})
      (e,) = build_codebook_entries(active, (v1,), build_option_labels(active.sections, [v1.sections]))
      assert e.options[1] == CodebookOption("B", "Bee", 2, False)
  ```
  In `test_export_values.py`:
  ```python
  def test_option_labels_fill_pinned_only_codes_latest_first():
      fid, sid = uuid4(), uuid4()
      active = (_s(sid, "s", _sel(fid, "c", ("A", "Alpha"))),)
      v2 = (_s(sid, "s", _sel(fid, "c", ("A", "a2"), ("B", "Bee v2"))),)
      v1 = (_s(sid, "s", _sel(fid, "c", ("B", "Bee v1"), ("C", "Cee"))),)
      labels = build_option_labels(active, [v2, v1])
      assert (labels[(fid, "A")], labels[(fid, "B")], labels[(fid, "C")]) == ("Alpha", "Bee v2", "Cee")
  ```
  `_s(sid, name, *fields, order=0)`, `_f` and `_sel` are local builders over `SectionDescriptor`, `FieldDescriptor` and `AllowedValue` (`extraction_snapshot_reader.py:37`).
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_export_codebook_model.py tests/unit/test_export_values.py -q`
  - Expected: FAIL with `ModuleNotFoundError: app.services.exports.codebook_model`. The values test fails with `TypeError` (PR3's `build_option_labels` takes one argument).
- [ ] **Step 3: Implement** the signatures and rules above, plus `ExportLayout.codebook`.
- [ ] **Step 4: Run them.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): version-spanning codebook model with stable field codes`

### Task 7: Level sheets replace tidy tables

**Files:**
- Rename: `git mv backend/app/services/exports/extraction/tidy_tables.py backend/app/services/exports/extraction/level_tables.py`, then rewrite it.
- Modify `backend/app/services/exports/extraction/workbook.py`:
  - `tidy_tables` becomes `level_tables` in `_SHAPE_BUILDERS` (`:101-116`), `_ARTICLE_BUILDERS` (`:123-125`), `_ROLE_ORDER` (`:156-165`) and `_ordered_specs` (`:232-267`). Today `allocate_titles` (`:196-229`) keys `levels` on `TidyTable.section_id`.
  - `allocate_titles` fills `levels` for the MANY sections of `walk_sections(layout.sections)` in **every** shape, after claiming `RESERVED_TITLES`. PUBLICATION uses `section.label`; the other shapes use `section.name`.
  - R8: `allocate_titles` adds the `articles` role (`fixed["articles"] = "Articles"`, present iff `"level_tables" in _SHAPE_BUILDERS[shape]`) and appends it and the level titles to `order` **only** in that case.
  - `SheetTitles` gains `level_by_section: Mapping[UUID, UUID | None]` (every walked section → `level_of`) and `sheet_for` (R8).
- Modify `backend/app/services/exports/descriptors.py`: add `count_level_records` and `record_keys` (R18).
- Modify `backend/app/services/extraction_export_service.py`:
  - R16: `_list_reviewers_for_runs` (`:1393-1451`) also selects `ExtractionReviewerState.run_id` under the same non-reject current-decision predicate (`:1426-1430`) and returns `(reviewers, raters_by_run)`. Add `ExportLayout.raters_by_run: Mapping[UUID, tuple[UUID, ...]] = field(default_factory=dict)`, filled in the all_users branch (`:502-519`; the call is at `:507`), empty otherwise.
  - Delete `TidyRow` (`:271`), `TidyTable` (`:286`), `_tidy_value` (`:1887`), `_tidy_row` (`:1900`), `_build_tidy_tables` (`:1928`), `ExportLayout.tidy_tables`, and the `tidy_tables` local in `resolve_layout` (`:545`).
  - `_build_front_matter` (`:1822`): the `tidy_tables` parameter becomes `record_count: int`. `resolve_layout` passes `count_level_records(sections, articles)`. Task 9 deletes this function.
- Delete:
  - `backend/tests/unit/test_extraction_tidy_tables_builder.py`
  - `backend/tests/unit/test_extraction_export_tidy_tables_projection.py`
  - `backend/tests/unit/test_extraction_export_tidy_model_section.py`
- Modify tests:
  - `backend/tests/unit/test_extraction_export_front_matter_projection.py`: `tidy_tables=` becomes `record_count=`.
  - `backend/tests/integration/test_extraction_export_new_sheets.py:150-162`: the `layout.tidy_tables` assert and the inventory asserts.
  - `backend/tests/unit/test_extraction_export_service.py::TestListReviewersForRuns` (`:2360`): rows become `(rid, run_id, name, email)`; results unpack `(reviewers, raters_by_run)`.
  - `backend/tests/unit/test_extraction_workbook_orchestrator.py` (R11): rewrite PR1's `test_sections_named_history_and_data_get_suffixed_titles` (`:129`) and `test_readme_contents_equal_sheetnames_for_every_shape` (`:148`) from `tidy_tables=(_table(...),)` to MANY sections (`_table`, `:72`, is deleted). `test_sheet_order_without_ai` (`:103`) and `test_sheet_order_with_ai` (`:114`) gain `"Articles"` after `"Matrix"`: `_one_field_layout` has a fielded root ONE section, which lands on Articles.
  - `backend/tests/unit/test_extraction_export_shape_filter.py`: the `TidyTable` fixture (`:121`), the `build_tidy_tables` spy (`:218`), the `tidy_tables` role sets (`:233`, `:242`) and `test_publication_keeps_readme_the_tidy_tables_and_the_appraisal` (`:181`) move to `level_tables`/MANY sections; `replace(..., tidy_tables=())` (`:260`) is dropped.
  - `backend/tests/unit/test_extraction_xlsx_builder.py` (`TidyTable` fixture `:608-637`, order test `:539`) and `backend/tests/unit/test_extraction_export_determinism.py` (`TidyRow`/`TidyTable` fixture `:142-175`): MANY sections replace the tidy fixtures.
- Test: create `backend/tests/unit/test_extraction_level_tables_builder.py`.

**Interfaces:**
- **Consumes:** `walk_sections`, `level_of`, `ancestry`, `instance_in_record`, `iter_records`, `value_key`, `primary_rater`, `display_value(v, field)`, `safe_sheet_title`, `make_layout`, `export_value`.
- **Produces:**
  - `def build_level_tables(layout: ExportLayout, titles: SheetTitles, shape: ExportShape) -> list[SheetSpec]`: Articles first, then `titles.levels` in walk order.
  - `SheetTitles.sheet_for(self, section_id: UUID | None) -> str | None` (R8): `"Articles"` for `None`; `None` when `section_id not in self.level_by_section`; else `"Articles"` if its level is `None`, otherwise `self.levels[level]`. Titles are allocated in every shape, so it answers in DICTIONARY too.
  - `def record_keys(article: ArticleDescriptor, instance_id: UUID, sections: Sequence[SectionDescriptor]) -> tuple[UUID, UUID | None, SectionDescriptor | None]` in `descriptors.py` (R18): `(record_id, parent_record_id, level section)`. `build_level_tables` calls it for every row; PR5 only consumes it.
    - Inverts `article.entries` to walk the instance's parent chain.
    - `record_id`: the first self-or-ancestor instance whose section is MANY, else `article_id`.
    - `parent_record_id`: the next MANY ancestor's instance, else `article_id`; `None` when `record_id == article_id`.
    - `section`: `None` when the instance's section is not in `sections`.
  - `async def _list_reviewers_for_runs(self, *, run_ids: list[UUID], anonymize: bool) -> tuple[tuple[ReviewerDescriptor, ...], dict[UUID, tuple[UUID, ...]]]` (R16): per-run tuples follow the `reviewers` order.
  - `def count_level_records(sections: Sequence[SectionDescriptor], articles: Sequence[ArticleDescriptor]) -> int`: the sum of `len(iter_records(s, a, sections))` over the MANY sections of `walk_sections`, for articles with `run_id`.
- **Pinned behaviour:**
  - **Raters (R1, R16):**
    - consensus and single_user: `(primary_rater(layout.mode, layout.reviewer_id),)`, with no rater column;
    - all_users: `(None, *layout.raters_by_run.get(article.run_id, ()))`.
    - The cell reads `"consensus"` for `None`, else `ReviewerDescriptor.display_label`.
  - **Keys:** `record_id`/`parent_record_id` come from `record_keys`; `record_label` and `<ancestor_code>.label` from the `iter_records` chain.
  - **Column order:**
    - Articles: keys, fields, `rater`.
    - Other level sheets: keys, ancestor labels, `rater`, fields.
  - **Machine cell:** blank unless `v.status in {"answered", "nonconforming"}` and `not v.out_of_scope`. Otherwise it is the first non-`None` of `value_num`, `value_bool`, `value_text`. The `.unit` cell is `v.unit`; the `.other` cell is `v.other_text`.
  - **Publication:**
    - Cells are `display_value(v, field)` (R2; PR6 adds `target`).
    - Key headers are `Article`, `DOI`, `PMID` on Articles. On level sheets they are `Article`, `<ancestor label>`…, `<section label>`.
    - No UUID columns and no `template_version`.
  - UUID cells are `str(uuid)`.

- [ ] **Step 1: Write the failing tests.**
  ```python
  def test_articles_sheet_key_columns_in_review_workbook():
      # root ONE "participants": age (unit "years"), sex
      sheets = build_level_tables(layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True),
                                  ExportShape.COMPLETE)
      assert sheets[0].title == "Articles"
      assert [c.value for c in sheets[0].rows[0]] == [
          "article_id", "article_label", "doi", "pmid", "template_version",
          "participants.age (years)", "participants.sex"]

  def test_level_sheet_keys_name_every_repeating_ancestor():
      # groups (MANY, fieldless) > items (MANY, field "name"); entries e1 > (p1, p2)
      items = sheets[2]
      assert [c.value for c in items.rows[0]] == [
          "article_id", "article_label", "record_id", "parent_record_id", "record_label",
          "groups.label", "items.name"]
      assert [r[3].value for r in items.rows[1:]] == [str(e1), str(e1)]
      assert [r[5].value for r in items.rows[1:]] == ["Group 1", "Group 1"]

  def test_unit_and_other_companions_hold_machine_values():
      # dose: allowed_units ("mg","g"); route: allow_other, answered as other
      assert header[-4:] == ["arm.dose", "arm.dose.unit", "arm.route", "arm.route.other"]
      assert row[-4:] == [5, "mg", None, "intrathecal"]

  def test_absent_and_out_of_scope_cells_are_blank():
      # export_value(status="absent", absent_code="no_information"); export_value(value_num=3, out_of_scope=True)
      assert row[-2:] == [None, None]

  def test_two_singletons_under_one_parent_show_the_first():
      # MANY m (entry e1) > ONE s (field "x"); entries[(s, e1)] = (i1, i2)
      # value_map: value_key(run, i1, fx) -> export_value(value_text="first"),
      #            value_key(run, i2, fx) -> export_value(value_text="second")
      m_sheet = sheets[1]
      assert len(m_sheet.rows) == 2                                   # header + one record
      hdr = [c.value for c in m_sheet.rows[0]]
      assert m_sheet.rows[1][hdr.index("s.x")].value == "first"

  def test_one_to_one_chain_below_a_record_reaches_the_leaf():            # Review Focus 2
      # MANY m > ONE mid (no fields) > ONE leaf (field "x"); value on leaf instance
      assert row[header.index("leaf.x")] == "v"

  def test_all_users_rows_unique_and_idle_reviewers_skipped():            # Review Focus 5
      # reviewers r1, r2; make_layout(mode=ALL_USERS, raters_by_run={runA: (r1,), runB: ()});
      # r2 also holds a value_map key on runB (a reject) but is not in raters_by_run
      hdr = [c.value for c in arts.rows[0]]
      assert hdr[-1] == "rater" and hdr.index("rater") > hdr.index("template_version")
      keys = [(r[0].value, r[hdr.index("rater")].value) for r in arts.rows[1:]]
      assert keys == [(str(A), "consensus"), (str(A), "Reviewer A"), (str(B), "consensus")]
      assert len(set(keys)) == len(keys)

  def test_publication_has_label_headers_and_no_uuid():                    # Review Focus 4
      for s in build_level_tables(layout, pub_titles, ExportShape.PUBLICATION):
          for row in s.rows:
              assert not any(_UUID_RE.search(str(c.value)) for c in row if c.value is not None)
      assert [c.value for c in pub[0].rows[0]][:3] == ["Article", "DOI", "PMID"]

  def test_single_user_rows_read_the_reviewer_slot():                       # Review Focus 6, R1
      # make_layout(mode=SINGLE_USER, reviewer_id=r1); root ONE "s" field "x"
      # value_map: value_key(run, i, fx, r1) -> export_value(value_text="mine"),
      #            value_key(run, i, fx)     -> export_value(value_text="stale")
      hdr = [c.value for c in arts.rows[0]]
      assert "rater" not in hdr and arts.rows[1][hdr.index("s.x")].value == "mine"

  def test_count_level_records_counts_many_rows_only():
      # groups (MANY, 2 entries) > items (MANY, 2 per group); root ONE with a field
      assert count_level_records(layout.sections, layout.articles) == 6

  def test_record_keys_resolve_record_and_parent_through_a_singleton():   # R18
      # MANY m (e1) > ONE mid (j1) > MANY leaf (l1); root ONE r (r1)
      assert record_keys(art, l1, secs) == (l1, e1, leaf)
      assert record_keys(art, j1, secs) == (e1, art.article_id, mid)
      assert record_keys(art, r1, secs) == (art.article_id, None, r)
      assert record_keys(art, uuid4(), secs)[2] is None

  def test_sheet_for_maps_sections_to_their_level_title():                # R8
      # root ONE study; MANY models > ONE perf; section gone_id not in the tree
      t = allocate_titles(layout, ExportShape.DICTIONARY, include_matrix=False)
      assert (t.sheet_for(None), t.sheet_for(study.entity_type_id), t.sheet_for(perf.entity_type_id),
              t.sheet_for(gone_id)) == ("Articles", "Articles", "models", None)
      assert "articles" not in t.fixed and "Articles" not in t.order
  ```
  In `test_extraction_workbook_orchestrator.py` (R11), MANY sections replace `_table`:
  ```python
  def test_sections_named_history_and_data_get_suffixed_titles() -> None:
      layout = make_layout(sections=(_many("history", order=0), _many("data", order=1)), articles=(_art(),))
      wb = load_workbook(io.BytesIO(build_workbook(layout, ExportShape.COMPLETE, include_matrix=True)))
      assert wb.sheetnames == ["README", "Summary", "Matrix", "Articles", "history (2)", "data (2)", "Data dictionary"]
  ```
  `_many(name, order)` is a fielded MANY `SectionDescriptor` (one text field). `test_readme_contents_equal_sheetnames_for_every_shape` keeps its assertions over `make_layout(sections=(_many("Sec", order=0),), ...)`. Task 8 changes `"Data dictionary"` to `"Codebook"` here.
  In `TestListReviewersForRuns` (R16; the non-reject predicate at `:1429` is unchanged; `_make_service`/`_rows_result` at `:55`/`:73`):
  ```python
  async def test_raters_by_run_groups_reviewers_per_run(self):
      svc = _make_service(); r1, r2, run_a, run_b = uuid4(), uuid4(), uuid4(), uuid4()
      svc.db.execute = AsyncMock(return_value=_rows_result(
          [(r1, run_a, "Bea", None), (r2, run_a, "Al", None), (r1, run_b, "Bea", None)]))
      reviewers, by_run = await svc._list_reviewers_for_runs(run_ids=[run_a, run_b], anonymize=False)
      assert [r.display_label for r in reviewers] == ["Al", "Bea"]
      assert by_run == {run_a: (r2, r1), run_b: (r1,)}
  ```
  `_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)`
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_level_tables_builder.py -q`
  - Expected: FAIL with `ModuleNotFoundError: ...extraction.level_tables`.
- [ ] **Step 3: Implement** the signatures above, then delete the tidy symbols and the tidy test files.
- [ ] **Step 4: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_level_tables_builder.py tests/unit/test_extraction_workbook_orchestrator.py tests/unit/test_extraction_export_shape_filter.py tests/unit/test_extraction_xlsx_builder.py tests/unit/test_extraction_export_determinism.py tests/unit/test_extraction_export_front_matter_projection.py tests/unit/test_extraction_front_matter_builder.py tests/unit/test_extraction_export_service.py tests/integration/test_extraction_export_new_sheets.py -q`
  - Expected: PASS, with the tidy assertions rewritten to level sheets.
- [ ] **Step 5: Commit.** `feat(export): one level sheet per repeating level with shape-aware keys`

### Task 8: Codebook and Options replace the Data dictionary and Dropdown lists; wire the pinned versions

**Files:**
- Rename: `git mv backend/app/services/exports/extraction/data_dictionary.py backend/app/services/exports/extraction/codebook.py`, then rewrite it.
- Delete:
  - `backend/app/services/exports/extraction/dropdown_lists.py`
  - `backend/tests/unit/test_extraction_dropdown_lists_builder.py`
  - `backend/tests/unit/test_extraction_data_dictionary_builder.py`
  - `backend/tests/unit/test_extraction_export_data_dictionary_projection.py`
- Modify `backend/app/services/extraction_export_service.py`:
  - Delete `FieldDictEntry` (`:248`), `_build_data_dictionary` (`:1857`), `ExportLayout.data_dictionary` and the `data_dictionary` local in `resolve_layout` (`:469`).
  - R14: replace `_load_sections` (`:853-891`) with `_pinned_version_rows`, `_load_pinned_versions` and the pure `_sections_from_views`; `resolve_layout` no longer calls `_load_sections` (`:467`). `load_export_sections` is then imported only by `_compute_obsolete_fields_per_article`, which Task 9 deletes; drop the import there.
  - Add `ExportLayout.versions: tuple[VersionSections, ...] = ()` (active first, so it carries the active version's `run_view_fields` as well as each pinned version's; PR5 reads both, R14) and `ExportLayout.narrow_pinned_versions: tuple[int, ...] = ()` (D5).
  - `resolve_layout` builds the label chain, the codebook and the coded sections before the mode branches.
- Modify `backend/app/services/exports/extraction_snapshot_reader.py`: `_section_from_view` (`:95`) becomes public `section_from_view`; `load_export_sections` (`:74`) maps through it.
- Modify `backend/app/services/exports/extraction/workbook.py`:
  - `data_dictionary`/`dropdown_lists` become `codebook`/`options` in `_SHAPE_BUILDERS`, `_FIXED_TITLES` (`:141-149`, titles `"Codebook"`/`"Options"`), `_ROLE_ORDER` and `_ordered_specs`; the `options` predicate in `_role_present` (`:184-193`) is `any(e.options for e in layout.codebook)`.
  - Delete `_NON_RESERVED_FIXED` (`:153`), so the initial `taken` (`:206`) is `RESERVED_TITLES` alone.
  - COMPLETE order follows §3 (spec line 72): README, Summary, [Matrix], Articles, levels, [AI proposals], [Appraisal], Codebook, Options. Today `_ROLE_ORDER` puts `ai_proposals` last and `appraisal_summary` before the dictionary; both `_ROLE_ORDER` and `_ordered_specs` move `ai_proposals` ahead of `appraisal_summary`.
  - DICTIONARY: `front_matter, codebook, options`.
- Modify tests:
  - `backend/tests/integration/test_extraction_export_golden_structure.py:38` (`_RESERVED` gets the reserved titles) and `test_workbook_has_the_expected_sheet_inventory` (`:165-183`). PR1's "Data dictionary" assertion becomes "Codebook"; the last-title assertion (`titles[-1] == "AI proposals"`) becomes `titles[-2:] == ["Codebook", "Options"]` and `titles.index("AI proposals") < titles.index("Codebook")` (R7 titles). `test_data_dictionary_header_is_canonical` (`:187`) is rewritten against `wb["Codebook"]` and the §4.4 header.
  - `backend/tests/integration/test_extraction_export_http.py:33`: `"Data dictionary"` becomes `"Codebook"`.
  - `backend/tests/unit/test_extraction_export_shape_filter.py`: the `FieldDictEntry` fixture (`:105`), the builder spies (`:212-213`), the role sets (`:228`, `:244-245`) and the dictionary-shape sheet list (`:266-270`) become `codebook`/`options`.
  - `backend/tests/unit/test_extraction_xlsx_builder.py` (`:133`, `:146`, `:597`, `:636`, `:647-648`) and `backend/tests/unit/test_extraction_export_determinism.py` (`:125`, `:174`, `:483-487`): "Data dictionary"/"Dropdown lists" become "Codebook"/"Options".
  - `backend/tests/unit/test_extraction_export_load_sections.py`: `svc._load_sections(uuid4())` calls (over `_StubDB`, `:19`) become `_load_pinned_versions(template_id=..., versions=(_StubVersion(...),))`; `_StubVersion` gains `id` and `version`. Assertions read `result[0].sections` and `result[0].run_view_fields`.
  - `backend/tests/unit/test_extraction_export_service.py:1923-1932` (`TestResolveLayoutAiTarget._stub_loaders`): `svc._load_sections = AsyncMock(...)` becomes `svc._pinned_version_rows = AsyncMock(return_value=())` and `svc._load_pinned_versions = AsyncMock(return_value=(VersionSections(version_id, 1, (), {}),))`.
  - `backend/tests/unit/test_extraction_workbook_orchestrator.py`: Task 7's `"Data dictionary"` becomes `"Codebook"`; in `test_sheet_order_with_ai` `"AI proposals"` now precedes `"Codebook"`.
- Test:
  - Create `backend/tests/unit/test_extraction_codebook_builder.py`.
  - Create `backend/tests/integration/test_extraction_export_codebook.py`.

**Interfaces:**
- **Produces:**
  - `async def _pinned_version_rows(self, *, project_id: UUID, template_id: UUID, active_version_id: UUID) -> tuple[ExtractionTemplateVersion, ...]`
    - `select(ExtractionTemplateVersion).join(ExtractionRun, ExtractionRun.version_id == ExtractionTemplateVersion.id).where(ExtractionRun.project_id == project_id, ExtractionRun.template_id == template_id, ExtractionTemplateVersion.id != active_version_id).distinct()`, highest `version` first.
  - `async def _load_pinned_versions(self, *, template_id: UUID, versions: Sequence[ExtractionTemplateVersion]) -> tuple[VersionSections, ...]` (R14)
    - Exactly one `entity_types_for_version(self.db, version_id=v.id, template_id=template_id)` call per version, input order kept.
    - `sections = _sections_from_views(views)`; `run_view_fields = {f.id: f for et in views for f in et.fields}`.
  - `@staticmethod def _sections_from_views(views: Sequence[RunViewEntityType]) -> tuple[SectionDescriptor, ...]`: the body of today's `_load_sections` over `section_from_view(view)`.
  - D5: `resolve_layout` passes `[active, *wide]` where `wide` drops the rows whose `schema_["entity_types"]` is `snapshot_is_narrow` (`extraction_snapshot.py:213`); otherwise `entity_types_for_version` (`extraction_snapshot.py:302`) falls back to the live tree (`:319-322`) and would claim today's fields. `narrow_pinned_versions` holds the dropped `version` numbers. The active version is never dropped (today's behaviour).
  - `def build_codebook(layout: ExportLayout, titles: SheetTitles) -> SheetSpec`
    - The header is the §4.4 list.
    - `sheet = None if e.section_id is None else titles.sheet_for(e.section_id)` (R8). The explicit guard matters: `sheet_for(None)` is `"Articles"`, and an entry whose section is absent from the active tree has `section_id is None`, so its `sheet` stays blank.
    - Lists are joined with `"; "`, and booleans are written as `bool`.
  - `def build_options(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None`
    - Header: `field_code, code, label, order, in_current_version`.
    - Returns `None` when the `options` role is absent from `titles.fixed` (PR1 sub-builder contract).
- **`resolve_layout` order:**
  1. `rows = await self._pinned_version_rows(...)`; split into `wide` and `narrow_pinned_versions` (D5).
  2. `active, *pinned = await self._load_pinned_versions(template_id=template_id, versions=(version, *wide))`; `sections = active.sections`.
  3. `labels = build_option_labels(sections, [v.sections for v in pinned])`
  4. `codebook = build_codebook_entries(active, pinned, labels)`
  5. `sections = apply_field_codes(sections, {e.field_id: e.field_code for e in codebook})`
  6. `version_numbers = {v.version_id: v.version_label for v in (active, *pinned)}`, passed into Task 5's descriptors; `layout.versions = (active, *pinned)`.
  7. The value maps use `labels`.

- [ ] **Step 1: Write the failing tests.**
  ```python
  def test_codebook_header_row():
      assert [c.value for c in build_codebook(layout, titles).rows[0]] == [
          "field_code", "field_id", "sheet", "section_code", "section_label", "parent_section_code",
          "field_label", "type", "unit", "allowed_units", "required", "is_entity_key",
          "allowed_absent_codes", "allow_other", "description", "in_current_version", "versions"]

  def test_codebook_sheet_is_the_review_title_even_in_dictionary_shape():
      titles = allocate_titles(layout, ExportShape.DICTIONARY, include_matrix=False)
      assert sheet_col == {"models.auc": "models", "study.design": "Articles", "old.x": None}

  def test_section_coded_like_a_reserved_title_is_suffixed_in_codebook():   # Review Focus 1
      # MANY section name "options" with field "x"
      t = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
      title = t.levels[sec.entity_type_id]
      assert title.casefold() not in {r.casefold() for r in RESERVED_TITLES}
      assert sheet_col["options.x"] == title

  def test_options_keep_the_none_code():
      assert row == ["study.smoking", "None", "None reported", 1, True]

  def test_dictionary_workbook_sheets():
      wb = load_workbook(io.BytesIO(build_workbook(layout, ExportShape.DICTIONARY, include_matrix=False)))
      assert wb.sheetnames == ["README", "Codebook", "Options"]
      t = allocate_titles(layout, ExportShape.DICTIONARY, include_matrix=False)
      assert t.order == tuple(wb.sheetnames)
  ```
  Integration test setup:
  - Insert `ExtractionTemplateVersion(version=9001, is_active=False, published_by=SEED.primary_profile, schema_=snapshot(entity_node(et, field_node(fid, name="dropped", label="Dropped"), name="s")))` on `SEED.primary_template`. The `published_by` value follows `conftest.py:413-421`, and the builders come from `tests/unit/helpers/snapshot_builders.py:21,48,71`.
  - Insert a second version 9002 with `schema_={"entity_types": []}`.
  - Insert runs pinned to each, using the SQL at `test_extraction_export_many_cardinality_fanout.py:139-157`.
  ```python
  async def test_codebook_covers_a_version_pinned_only_by_a_run(db_session):
      layout = await svc.resolve_layout(project_id=SEED.primary_project, template_id=SEED.primary_template,
          mode=ExportMode.CONSENSUS, article_ids=[], include_ai_metadata=False,
          anonymize_reviewer_names=False)
      e = next(e for e in layout.codebook if e.field_id == fid)
      assert (e.field_code, e.section_id, e.in_current_version, e.versions) == ("s.dropped", None, False, (9001,))
      assert all(9002 not in e.versions for e in layout.codebook)         # narrow snapshot skipped
      assert layout.narrow_pinned_versions == (9002,)                    # D5
      assert [v.version_label for v in layout.versions][1:] == [9001]
  ```
  In `test_extraction_export_load_sections.py` (R14):
  ```python
  async def test_load_pinned_versions_reads_each_version_once(monkeypatch):
      calls = AsyncMock(side_effect=lambda db, *, version_id, template_id: [_view(version_id)])
      monkeypatch.setattr(extraction_export_service, "entity_types_for_version", calls)
      v1, v2 = _StubVersion({}, version=1), _StubVersion({}, version=2)   # gains id=uuid4(), version kwarg
      out = await svc._load_pinned_versions(template_id=uuid4(), versions=(v2, v1))
      assert calls.await_count == 2 and [v.version_label for v in out] == [2, 1]
      assert set(out[0].run_view_fields) == {f.field_id for s in out[0].sections for f in s.fields}
  ```
  The service imports `entity_types_for_version` and `snapshot_is_narrow` at module level (beside `pinned_template_rules`, `:89`), which is this patch point (today the service reaches it only through `load_export_sections`); `_view(vid)` returns one `RunViewEntityType` with one field.
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_codebook_builder.py tests/unit/test_extraction_export_load_sections.py tests/integration/test_extraction_export_codebook.py -q`
  - Expected: FAIL with `ImportError: cannot import name 'build_codebook'`.
- [ ] **Step 3: Implement** the signatures above, then delete `_load_sections`, the dictionary and dropdown symbols and their tests.
- [ ] **Step 4: Run them.**
  - Command: same as Step 2, plus `tests/unit/test_extraction_export_load_sections.py tests/unit/test_extraction_export_snapshot_sections.py tests/unit/test_extraction_workbook_orchestrator.py tests/unit/test_extraction_export_service.py tests/integration/test_extraction_export_golden_structure.py`.
  - Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): Codebook and Options over every pinned version`

### Task 9: README and Summary (status counts, omitted articles, no UUIDs)

**Files:**
- Modify `backend/app/services/extraction_export_service.py`:
  - Delete `ExportNotes` (`:191`), `FrontMatter` (`:200`), `_build_front_matter` (`:1822`) and `_compute_obsolete_fields_per_article` (`:893`), and drop `ExportNotes` from `__all__`.
  - Delete `notes`, `front_matter` and `obsolete_fields` in `resolve_layout`.
  - Move `_ABSENT_REASON_DESCRIPTIONS`, `_FRONT_MATTER_LEGEND`, `_FRONT_MATTER_CAVEATS` and `_MODE_LABELS` (`:1794-1819`) to `front_matter.py`.
  - Add `OmittedArticle`, `ExportLayout.generated_at` and `ExportLayout.omitted`.
  - The resolvers return `list[tuple[UUID, str]]` omissions (today `dict[str, int]` stage counts, e.g. `:933`).
- Modify:
  - `backend/app/services/exports/extraction/front_matter.py` (rewrite)
  - `backend/app/services/exports/extraction/summary.py:93-97` (reads `layout.notes.omitted_articles_by_stage`)
  - The `layout.notes.generated_at` reader in `exports/extraction/run.py:113` (PR1).
  - `backend/tests/unit/helpers/export_layouts.py`: `notes=ExportNotes()` becomes `generated_at=datetime(2026, 1, 1, tzinfo=UTC)`.
- Delete:
  - `backend/tests/unit/test_extraction_export_front_matter_projection.py`
  - `backend/tests/unit/test_extraction_export_obsolete_fields.py`
  - `test_obsolete_field_reported_when_run_pinned_to_older_version` (`backend/tests/integration/test_extraction_export_snapshot_diff.py:70`). Task 8's codebook test replaces it.
- Modify tests:
  - `backend/tests/unit/test_extraction_front_matter_builder.py` (rewrite)
  - `backend/tests/unit/test_extraction_summary_builder.py:47-58` (`_layout(notes=)`) and `:193-195` (`test_summary_includes_omitted_by_stage`)
  - The files that construct `ExportLayout(... notes=ExportNotes(...))`: `notes=ExportNotes(generated_at=X)` becomes `generated_at=X`; `ExportNotes(omitted_articles_by_stage=...)` (in `test_extraction_appraisal_summary_builder.py`, `test_extraction_export_column_guard.py`, `test_extraction_export_run.py`, `test_extraction_summary_builder.py`, `test_extraction_xlsx_builder.py`) becomes `omitted=(OmittedArticle(...),)`; `FrontMatter(...)`/`front_matter=` fixtures (`test_extraction_xlsx_builder.py:585`, `test_extraction_export_determinism.py:111-173`) are dropped.
  - `test_extraction_export_service.py`: the omitted asserts in `TestResolveArticlesForConsensus` (`:412-562`), `TestResolveArticlesForSingleUser` (`:2066-2181`) and `TestResolveArticlesForAllUsers` (`:2298-2352`) become lists of `(article_id, reason)`.
  - `backend/tests/integration/test_extraction_export_new_sheets.py:150`: delete `assert layout.front_matter is not None`.
  - PR1's `assert layout.front_matter is None` lines are deleted (the field no longer exists): in `backend/tests/unit/test_extraction_workbook_orchestrator.py::test_readme_contents_equal_sheetnames_for_every_shape` (`:152`) and `backend/tests/unit/test_extraction_export_column_guard.py::test_oversized_matrix_is_omitted_with_a_readme_note` (`:97`).

**Interfaces:**
- **Produces:**
  - `@dataclass(frozen=True, slots=True) class OmittedArticle: article_id: UUID; article_label: str; reason: str`
  - `ExportLayout.generated_at: datetime` and `ExportLayout.omitted: tuple[OmittedArticle, ...] = ()`
  - `def build_front_matter(layout: ExportLayout, titles: SheetTitles) -> SheetSpec`. Rows:
    - identity;
    - `Generated at`;
    - `Records`, computed as `count_level_records(layout.sections, layout.articles)`;
    - contents from `titles.order`;
    - the Matrix-omitted note when `titles.matrix_omitted` (R6; PR1's text, kept verbatim);
    - legend;
    - **`Values by status`:** one row per status in the order `answered, absent, rejected, cleared, nonconforming`. It counts only the `value_map` keys with `k[3] == primary_rater(layout.mode, layout.reviewer_id)` (R1), so all_users never double-counts and single_user reads the reviewer slot.
    - **`Values outside any level sheet`** (R17, the only such row): the count of primary-slot keys whose field's codebook entry has `section_id is None`.
    - **`Pinned versions not in Codebook (legacy snapshot)`** (D5): `len(layout.narrow_pinned_versions)`, plus their numbers.
    - **`Field code clashes`** (D1): one row per `field_code_clashes(layout.codebook)` group, `(bare, "; ".join(codes))`.
    - **Notes:**
      - the rule-6 sentence: `"record_label is the name given at creation; the key field's column is authoritative."`
      - the rule-7 sentence: `"A field missing from a run's pinned version is blank; compare Articles.template_version with Codebook.versions."`
      - the D2 sentence: `"article_label suffixes (b, c, …) follow import order; deleting an article can shift later suffixes."`
      - then `layout.appraisal_notes` (Task 10).
    - **Caveats:** the spec's three, plus the existing best-effort caveat (PR5 deletes it).
    - The per-article obsolete block is removed, because it printed UUIDs.
  - `build_summary(layout, titles)` appends `Articles omitted` and one `(article_label, reason)` row per `layout.omitted`.

- [ ] **Step 1: Write the failing tests.**
  ```python
  def test_readme_counts_values_by_status():
      vm = {k1: export_value("answered"), k2: export_value("answered"), k3: export_value("absent", absent_code="no_information")}
      rows = _rows(build_front_matter(make_layout(..., value_map=vm), titles))
      assert ("answered", 2) in rows and ("absent", 1) in rows and ("rejected", 0) in rows

  def test_readme_status_counts_ignore_reviewer_slots_in_all_users():    # Review Focus 5
      vm = {value_key(run, i, f): export_value("answered"),
            value_key(run, i, f, r1): export_value("answered"),
            value_key(run, i, f, r2): export_value("absent", absent_code="not_applicable")}
      rows = _rows(build_front_matter(make_layout(..., mode=ExportMode.ALL_USERS, value_map=vm), titles))
      assert ("answered", 1) in rows and ("absent", 0) in rows

  def test_readme_status_counts_read_the_single_user_slot():             # Review Focus 6, R1
      vm = {value_key(run, i, f, r1): export_value("absent", absent_code="no_information"),
            value_key(run, i, f): export_value("answered")}
      rows = _rows(build_front_matter(make_layout(..., mode=ExportMode.SINGLE_USER, reviewer_id=r1,
                                                  value_map=vm), titles))
      assert ("absent", 1) in rows and ("answered", 0) in rows

  def test_readme_keeps_the_matrix_omitted_note():                       # R6
      titles = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=False)
      assert titles.matrix_omitted
      assert any(str(v).startswith("Matrix omitted") for r in _rows(build_front_matter(layout, titles)) for v in r)

  def test_readme_lists_field_code_clashes_and_skipped_versions():       # D1, D5
      layout = make_layout(sections=(_one("dup", "x", order=0), _one("dup", "x", order=1)),
                           narrow_pinned_versions=(3,))
      rows = _rows(build_front_matter(layout, titles))
      assert any(r[0] == "dup.x" for r in rows)
      assert any(r[0] == "Pinned versions not in Codebook (legacy snapshot)" and r[1] == 1 for r in rows)

  def test_readme_has_no_uuid():                                         # Review Focus 4
      assert not any(_UUID_RE.search(str(c.value)) for r in spec.rows for c in r if c.value is not None)

  def test_readme_counts_values_outside_level_sheets():
      # consensus layout (primary_rater is None): codebook entry with section_id=None
      # and one consensus-slot value_map key on that field
      assert ("Values outside any level sheet", 1) in rows

  def test_summary_lists_each_omitted_article():
      layout = make_layout(omitted=(OmittedArticle(aid, "Smith 2020b", "no_run"),))
      assert ("Smith 2020b", "no_run") in _rows(build_summary(layout, titles))
  ```
  `_rows(spec)` yields each row's non-blank cell values as a tuple; `_one(name, field, order)` is a root ONE section with one text field.
  Integration test in `tests/integration/test_extraction_export_codebook.py`:
  ```python
  async def test_an_article_without_a_run_is_omitted_with_its_label(db_session):
      # delete runs for (SEED.primary_project, SEED.primary_article, SEED.primary_template)
      layout = await svc.resolve_layout(..., article_ids=[SEED.primary_article], ...)
      assert layout.omitted == (OmittedArticle(SEED.primary_article, "Integration Test Article", "no_run"),)
  ```
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_front_matter_builder.py tests/unit/test_extraction_summary_builder.py tests/integration/test_extraction_export_codebook.py -q`
  - Expected: FAIL with `ImportError: cannot import name 'OmittedArticle'`.
- [ ] **Step 3: Implement** the signatures above, then delete the listed symbols and tests.
- [ ] **Step 4: Run them.**
  - Command: `cd backend && uv run pytest tests/unit tests/integration -k "extraction or export" -q`. This includes PR1's `tests/unit/test_extraction_export_column_guard.py::test_oversized_matrix_is_omitted_with_a_readme_note` (R6).
  - Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): README status counts and a Summary that names each omitted article`

### Task 10: Appraisal detection at the root, by vocabulary (rule 8)

**Files:**
- Modify `backend/app/services/extraction_export_service.py`:
  - Extract the nested `_is_verdict` (`:663-667`) to `_is_risk_verdict(field: FieldDescriptor) -> bool`.
  - `_build_appraisal_model` (`:618-678`; domain selection `:669-678`) keeps root domains only.
  - Delete the `template.kind` gate (`:583`).
  - Add `ExportLayout.appraisal_notes: tuple[str, ...] = ()`.
- Modify: `backend/tests/integration/test_extraction_export_appraisal_summary.py:449` (`test_qa_consensus_layout_emits_appraisal_and_extraction_does_not`). The extraction side asserts by vocabulary.
- Test: `backend/tests/unit/test_extraction_appraisal_model_resolution.py`

**Interfaces:**
- **Produces:** `@staticmethod def _appraisal_notes(sections: Sequence[SectionDescriptor], *, template_kind: str, appraisal: AppraisalModel | None) -> tuple[str, ...]`
  - One note per non-root section that has a risk verdict: `f"Appraisal: '{section.label}' is not at the root, so it is not an Appraisal domain."`
  - Plus, for a QUALITY_ASSESSMENT template with `appraisal is None`: `"Appraisal: no root section has a SELECT field whose labels all belong to the risk-of-bias vocabulary (PROBAST, QUADAS, RoB), so there is no Appraisal sheet."`

- [ ] **Step 1: Write the failing tests**, using `_field`, `_section` and `_pairs` (`:33`, `:63`, `:29`).
  ```python
  def test_nested_risk_verdict_is_not_a_domain_and_is_noted() -> None:
      root = _section("Participants", _field("RoB"), 0)
      nested = replace(_section("Per model", _field("RoB"), 1), parent_entity_type_id=uuid.uuid4())
      model = ExtractionExportService._build_appraisal_model(sections=(root, nested), articles=(),
          reviewers=(), value_map={}, mode=ExportMode.CONSENSUS, reviewer_id=None)
      assert model.domain_labels == ("Participants",)
      assert ExtractionExportService._appraisal_notes((root, nested), template_kind="extraction",
          appraisal=model) == ("Appraisal: 'Per model' is not at the root, so it is not an Appraisal domain.",)

  def test_custom_vocabulary_qa_template_has_no_appraisal_and_a_note() -> None:
      d = _section("Quality", _field("Grade", allowed_values=_pairs("Good", "Fair", "Poor")), 0)
      model = ExtractionExportService._build_appraisal_model(sections=(d,), articles=(), reviewers=(),
          value_map={}, mode=ExportMode.CONSENSUS, reviewer_id=None)
      assert model is None
      assert ExtractionExportService._appraisal_notes((d,), template_kind="quality_assessment",
          appraisal=None)[0].startswith("Appraisal: no root section")
  ```
  Also: a workbook built from `make_layout(appraisal=None, appraisal_notes=(note,))` has no `"Appraisal"` in `sheetnames`, and its README contains `note`.
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/unit/test_extraction_appraisal_model_resolution.py -q`
  - Expected: FAIL with `AttributeError: ... has no attribute '_appraisal_notes'`.
- [ ] **Step 3: Implement.** `resolve_layout` calls `_build_appraisal_model` unconditionally and stores `appraisal_notes=self._appraisal_notes(sections, template_kind=template.kind, appraisal=appraisal)`.
- [ ] **Step 4: Run them.**
  - Command: same as Step 2, plus `tests/integration/test_extraction_export_appraisal_summary.py`.
  - Expected: PASS.
- [ ] **Step 5: Commit.** `feat(export): detect appraisal domains at the root by vocabulary only`

### Task 11: The §11 row-4 acceptance tests on five templates

**Files:**
- Create:
  - `backend/tests/integration/test_extraction_export_level_fixtures.py` (CHARMS, CHARMS+MM, PROBAST+AI)
  - `backend/tests/unit/test_extraction_export_level_fixtures.py` (30-section flat; nested MANY under a fieldless MANY)

**Interfaces:**
- **Consumes:**
  - `clone_template` (`app/services/template_versioning/_clone.py:68`), which returns `TemplateClone` (`:51-58`).
  - `SEED` (`tests/integration/conftest.py:149`).
  - `resolve_layout`, `build_workbook` and `matrix_fits`.
- **Local helper:** `_materialize(db, svc, clone, *, kind: str) -> None`.
  - Walks `walk_sections(active.sections)`, where `(active,) = await svc._load_pinned_versions(template_id=clone.project_template_id, versions=(await db.get(ExtractionTemplateVersion, clone.version_id),))`.
  - Inserts 2 instances per parent instance for a MANY section, 1 for a ONE section, using the SQL at `test_extraction_export_many_cardinality_fanout.py:109-127`.
  - Inserts one `finalized` run (`:139-154`).

- [ ] **Step 1: Write the tests.**
  ```python
  @pytest.mark.parametrize("global_id, kind, expected", [
      (UUID("000c0000-0000-0000-0000-000000000001"), TemplateKind.EXTRACTION,
       ["README", "Summary", "Matrix", "Articles", "prediction_models", "final_predictors", "Codebook", "Options"]),
      (UUID("000e0000-0000-0000-0000-000000000001"), TemplateKind.EXTRACTION,
       ["README", "Summary", "Matrix", "Articles", "prediction_models", "numeric_performance", "Codebook", "Options"]),
      (UUID("00ba0000-0000-0000-0000-000000000002"), TemplateKind.QUALITY_ASSESSMENT,
       ["README", "Summary", "Matrix", "Articles", "Appraisal", "Codebook", "Options"]),
  ])
  async def test_real_templates_give_the_exact_sheet_set_unique_records_and_resolving_parents(
          db_session, global_id, kind, expected):
      clone = await clone_template(db_session, project_id=SEED.primary_project,
          global_template_id=global_id, user_id=SEED.primary_profile, kind=kind)
      await _materialize(db_session, svc, clone, kind=kind.value)
      layout = await svc.resolve_layout(project_id=SEED.primary_project,
          template_id=clone.project_template_id, mode=ExportMode.CONSENSUS,
          article_ids=[SEED.primary_article], include_ai_metadata=False, anonymize_reviewer_names=False)
      wb = load_workbook(io.BytesIO(build_workbook(layout, ExportShape.COMPLETE,
                                                   include_matrix=matrix_fits(layout))))
      assert wb.sheetnames == expected
      levels = [n for n in wb.sheetnames if n not in RESERVED_TITLES]
      ids = {str(SEED.primary_article)}
      for name in levels:
          hdr, *rows = list(wb[name].values)
          rid = [r[hdr.index("record_id")] for r in rows]
          assert len(rid) == len(set(rid))
          ids |= set(rid)
      for name in levels:
          hdr, *rows = list(wb[name].values)
          assert {r[hdr.index("parent_record_id")] for r in rows} <= ids
      hdr, *rows = list(wb["Codebook"].values)
      assert {r[hdr.index("sheet")] for r in rows} - {None} <= set(wb.sheetnames)
  ```
  The unit file runs the same assertions on `make_layout` fixtures:
  - **Flat:** 30 root ONE sections `s01`…`s30`, each with one text field. Expected `["README", "Summary", "Matrix", "Articles", "Codebook"]`.
  - **Nested:** fieldless MANY `groups` (2 entries) > fielded MANY `items` (2 per group). Expected `["README", "Summary", "Matrix", "Articles", "groups", "items", "Codebook"]`.
- [ ] **Step 2: Run them.**
  - Command: `cd backend && uv run pytest tests/integration/test_extraction_export_level_fixtures.py tests/unit/test_extraction_export_level_fixtures.py -q`
  - Expected: PASS.
  - A FAIL is a bug in the task that owns that sheet; fix it there.
  - `expected` changes only when a seeded section's subtree is fieldless (rule 2). Name the section in the commit body.
  - PR5 adds Data and Verification to these expected lists (R11).
- [ ] **Step 3: Commit.** `test(export): exact level-sheet set and key integrity on five templates`

### Task 12: Gates

- [ ] `make lint-backend`. Expected: clean.
- [ ] Backend tests. Expected: all pass.
  - `cd backend && uv run pytest tests/unit -q`
  - `cd backend && uv run pytest tests/integration -k "export or template_restore" -q` (needs the local Supabase stack)
- [ ] Vulture: `cd backend && uv run vulture > vulture.out || true && uv run python ../scripts/vulture_baseline.py --baseline .vulture_baseline --input vulture.out`.
  - Expected: no new findings.
  - Then run it with `--update` and commit the shrunk `backend/.vulture_baseline`, since `FieldDictEntry`, `TidyRow` and `FrontMatter` are gone.
- [ ] File size:
  - `python3 scripts/fitness/check_file_size.py --update-baseline backend/app/services/extraction_export_service.py`. Expected: below 2156.
  - Then `python3 scripts/fitness/check_file_size.py`. Expected: exit 0, and new files ≤ 800 lines.
- [ ] `python3 scripts/fitness/check_scope_guards.py`. Expected: exit 0. Then run `make quality-fitness`.
- [ ] No public schema change, so `npm run generate:api-types` is not needed. Run `npm run test:run`, `npm run lint`, `npx knip` and `npx knip --production` once. Expected: zero findings.
- [ ] Commit `chore(export): tighten file-size and vulture baselines after the levels rewrite`.

## Rulings applied

- **R1:** single-slot readers use `primary_rater(layout.mode, layout.reviewer_id)`; no reader keys single_user as `rater=None` (Review Focus 6, Tasks 7, 9). `_build_appraisal_model` calls pass `reviewer_id=None` (Task 10).
- **R2:** `display_value(v, field)`; no `target=` kwarg anywhere in PR4 (Task 7).
- **R6:** README keeps the Matrix-omitted note; PR1's test is in Task 9's run (Task 9).
- **R7/R8a:** PR1 sets "Matrix", "Appraisal", "AI proposals" and the `ai_proposals` role id; PR4 has no fallback for older titles and renames no fixed title (Depends on, Tasks 8, 11).
- **R8:** `articles` role and `SheetTitles.sheet_for(section_id)`, `"Articles"` for `None` (Task 7); Codebook guards `section_id is None` to a blank `sheet` (Task 8).
- **R10:** `reader_instance_ids` follows `walk_sections` (Task 3).
- **R11:** PR1's suffixed-titles test rewritten with MANY sections (Task 7); PR5 extends Task 11's lists.
- **R12:** `CodebookEntry.section_id` in `exports/codebook_model.py`; one helper module `tests/unit/helpers/export_layouts.py`, whose `make_layout` builds the codebook with `option_labels` or `build_option_labels(sections, [])` (Task 6).
- **R13/R14:** `_load_article_refs`; `_load_pinned_versions` → `VersionSections(version_id, version_label, sections, run_view_fields)`, one `entity_types_for_version` per version, exposed with the active version's `run_view_fields` too on `ExportLayout.versions` (Tasks 5, 8).
- **R16:** `ExportLayout.raters_by_run` from the non-reject current-decision predicate (Task 7).
- **R17:** "Values outside any level sheet" is the only out-of-sheet row (Task 9).
- **R18:** `record_keys(article, instance_id, sections) -> (record_id, parent_record_id, level section)` ships in `descriptors.py` with `test_record_keys_resolve_record_and_parent_through_a_singleton`; `level_tables` uses it (Task 7).
- **R19:** Task 4's `_build_tidy_tables` edit is transitional; Task 7 deletes it.
- **R20:** `tests/unit/test_export_values.py` (Task 6).
- **D1:** first active field in walk order keeps the bare code; README lists clashes (Tasks 1, 6, 9).
- **D2:** first label bare, later `b`, `c`; README note on deletes (Tasks 5, 9).
- **D5:** narrow pinned snapshots skipped in Codebook and counted in the README (Tasks 8, 9).
