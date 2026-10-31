---
status: draft
last_reviewed: 2026-10-31
owner: '@raphaelfh'
---

# Extraction export options — plan index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute ONE PR plan at a time, in order; each is its own branch off `dev` and its own PR.

**Goal:** Implement the extraction export redesign in six sequential PRs. Every PR opens with a test that fails today.

**Spec:** `docs/superpowers/specs/2026-10-30-extraction-export-options-design.md`

**Evidence base:** `dev` @ 4ad80f98. Re-check cited line numbers after each earlier PR lands.

## PR order

| # | Plan | Depends on | Ships |
| --- | --- | --- | --- |
| 1 | [pr1-delivery](2026-10-31-extraction-export-pr1-delivery.md) | — | `run.py` (`authorize_export` before the sync/async split, `build_export`), CORS filename, title pre-pass, writer hygiene, Matrix include-or-omit, dictionary `[]`, fixed titles |
| 2 | [pr2-write-path](2026-10-31-extraction-export-pr2-write-path.md) | — (frontend only; ship early) | AI link on typed edits, un-accept, undo; records the prod date for `LINEAGE_EXACT_SINCE` |
| 3 | [pr3-values](2026-10-31-extraction-export-pr3-values.md) | 1 | `values.py`, `value_envelope.py` deleted, scope-marking fix, per-reviewer slot keys |
| 4 | [pr4-levels](2026-10-31-extraction-export-pr4-levels.md) | 1, 3 | level sheets, `record_keys`, Codebook / Options, labels, README / Summary, appraisal detection |
| 5 | [pr5-data-provenance](2026-10-31-extraction-export-pr5-data-provenance.md) | 1, 3, 4; constant from 2 | Data, Verification, provenance, AI proposals sheet, cell budget, pseudonym map |
| 6 | [pr6-publication](2026-10-31-extraction-export-pr6-publication.md) | 1, 3, 4, 5 | Publication display, NI/NA/NE, UI relabel and dialog, README pandas snippet |

PR2 can run in parallel with PR1. PR3 through PR6 are strictly sequential.

## Review history

1. One agent drafted the cross-PR contract. Six planners each wrote one PR plan, a reviewer checked each plan against the tree, and the planner revised it. 71 findings.
2. A completeness critic found 24 cross-plan defects. They were resolved by the rulings below, and every plan was reconciled to them.
3. Two verify and fix rounds followed. The last round returned NO FINDINGS.

## Owner defaults to confirm (D1–D10 below; each is applied in the plans and the spec)

- **D4 (privacy).** Non-managers always see pseudonyms for other people in `decided_by` and `consensus_by`.
- **D3.** Data gets a `value_bool` column.
- **D2.** Article label suffixes keep the first label bare.
- **D1.** On an active–active `field_code` clash, the first field in walk order keeps the bare code and later ones get a suffix.
- **D6.** The AI sheet `value` holds the machine scalar.
- **D7.** Publication footnotes go below the table, and the scope marker is `NA*`.
- **D8 (PR2).** Un-accept restores the predecessor's link, which can ping-pong between two proposals. This is accepted.
- **Open.** The Railway worker memory limit that feeds `EXPORT_CELL_BUDGET`. PR5 Task 11 measures it, with a 1 GiB fallback.

---

## Cross-PR rulings (binding for every PR plan)

These rulings resolve the cross-plan critique (`critic.md`) and the planners' open questions. Each line names the PRs it affects. Where a ruling contradicts the contract (`contract.md`), the ruling wins.

### Keys and rater slots

**R1 (PR3, PR4, PR5): rater slots.**
- `value_key(run, instance, field, rater)` uses `rater=reviewer_id` for every reviewer slot, single_user included.
- `rater=None` means consensus only.
- PR3 adds `primary_rater(mode: ExportMode, reviewer_id: UUID | None) -> UUID | None` to `exports/descriptors.py`. It returns None for consensus and all_users, and `reviewer_id` for single_user.
- Every single-slot reader in PR3–PR5 (matrix, summary, scope marking, appraisal, level sheets, README counts) reads `primary_rater(...)`, never a literal None.
- PR5 adds no re-keying.

### Value rendering

**R2 (PR3–PR6): `display_value` signature.**
- PR3 ships `display_value(v, field)`.
- PR4 and PR5 call it without `target`.
- PR6 adds `*, target: Literal["matrix", "publication"]` and updates every caller in the same PR.

**R3 (PR3, PR6): appraisal verdicts stay `ExportValue`.**
- PR3 types `AppraisalRow.domain_verdicts` as `tuple[ExportValue | None, ...]`.
- PR3 adds `AppraisalModel.domain_fields: tuple[FieldDescriptor, ...]`.
- PR3 renders through `display_value` inside the appraisal builder.
- PR6 only adds the shape and target handling.

### Ownership of shared pieces

**R4 (PR5, PR6): export test helpers.**
- PR5 moves `_make_run`, `_record_decision` and `_service` out of `test_extraction_export_ai_outcome.py` into one shared helper module under `backend/tests/integration/`. PR5 picks the location: follow an existing helpers pattern if one exists, else `conftest.py` fixtures.
- PR6 imports from that module.

**R5 (PR5, PR6): PR6 owns all UI and schema-description work for `anonymize_reviewer_names` and `include_ai_metadata`.**
- This covers the dialog gate at `HITLExportDialog.tsx:605`, the copy, the schema descriptions and `generate:api-types`.
- PR5 drops those steps.
- PR5 still applies the label map in every mode on the backend.

### Sheet titles

**R6 (PR4): Matrix-omitted note.** PR4's README rewrite keeps the Matrix-omitted note from `SheetTitles.matrix_omitted`. PR4 keeps PR1's test in its run list.

**R7 (PR1): fixed titles.** PR1 owns every fixed title. In `SheetTitles.fixed`, PR1 sets:
- "Matrix" (was the template name);
- "Appraisal" (was "Appraisal summary");
- "AI proposals" (was "AI metadata").

Later PRs assume these titles.

**R8 (PR4, PR5): title roles.**
- PR4 adds the `articles` role to `allocate_titles`, and `SheetTitles.sheet_for(section_id: UUID | None) -> str | None`, where None means the root, "Articles".
- PR5 adds the `data` role (COMPLETE) and the `verification` role (COMPLETE and ALL_USERS), each with its predicate in `allocate_titles`.
- The `ai_proposals` predicate (`include_ai_metadata`) already exists from PR1.

### Budget and sizing

**R9 (PR5): cell budget arithmetic.**
- Options: `(rows + 1) × 5`.
- Level sheets: `(rows + 1) × (5 + n_repeating_ancestors + 1 + 3 × n_fields)`.
- Articles: `5 + 1 + 3 × n_fields`.
- The `estimate_cells` test bounds every sheet.

### Section walk and level structure

**R10 (PR4): one walk.** PR4 makes `extraction_scope_marking.reader_instance_ids` use `walk_sections`, with a test. All three skip rules are then gone in PR4.

**R11 (PR4, PR5): rewritten sheet-list tests.**
- PR4 rewrites PR1's `test_sections_named_history_and_data_get_suffixed_titles` with MANY sections.
- PR5 updates PR4's level-fixture expected sheet lists to add Data and Verification.

**R12 (PR4–PR6): Codebook model and test helpers.**
- `CodebookEntry` lives in `exports/codebook_model.py` with `section_id` (no `sheet`).
- One unit-test helper module, `tests/unit/helpers/export_layouts.py` (PR4: `export_value`, `make_layout`). PR5 and PR6 extend it and create no new helper modules or file-local layout builders.

**R13 (PR5): dependency names.** PR5's dependency list uses PR4's names: `_load_article_refs`, `_load_pinned_versions`, `VersionSections`.

**R14 (PR4, PR5): one pinned-version load.**
- PR4's `_load_pinned_versions` returns `VersionSections(version_id, version_label, sections: tuple[SectionDescriptor, ...], run_view_fields: Mapping[UUID, RunViewField])`.
- This is one `entity_types_for_version` call per version.
- PR5 reuses it, with no second or third load.

**R15 (PR5): `_untyped_field`.** PR5 deletes `_untyped_field` and its PR3 test along with the AI-loader rewrite.

**R16 (PR4, PR5): rater set.**
- One predicate: the reviewers with ≥1 non-reject current decision on the run.
- PR4 builds `layout.raters_by_run: Mapping[UUID, tuple[UUID, ...]]` with it, and uses it for level-sheet raters.
- PR5's Verification uses the same mapping.

**R17 (PR4, PR5): out-of-sheet count.** PR4's README row "Values outside any level sheet" is the only such count. PR5 rewords it to "values only in Data" and adds no second row.

**R18 (PR4, PR5): `record_keys`.** `record_keys` (record_id, parent_record_id, instance resolution) ships in PR4 inside `level_tables`/`descriptors`. PR5 only consumes it.

**R19 (PR3–PR5): transitional rewrites.** Accept transitional rewrites that a later PR deletes. Keep them minimal.

**R20 (PR3, PR4): unit test file name.** The unit test file for `values.py` is `tests/unit/test_export_values.py`.

### Lineage

**R21 (PR2, PR5): `LINEAGE_EXACT_SINCE`.**
- It is the prod promotion date of PR2.
- PR2's plan ends with a step to record that date in the PR body.
- PR5 sets the constant from it.

### Endpoint and API

**R22 (PR1): `selected_only` empty-ids check.** PR1 deletes the unreachable check. Today `[]` already returns 422 through `min_length`, so the behaviour is unchanged for non-dictionary requests. The plan says so.

**R23 (PR6): dialog work.** PR6 adds:
- dialog handling and copy for the `EXPORT_TOO_LARGE` async error;
- relaxing the dialog gate so `shape=dictionary` submits with zero articles.

**R24 (PR1, PR6): pandas.** PR1 adds pandas as a dev dependency. PR6 has no pandas step.

### Owner defaults (adopt; listed in the index for the owner to overrule)

**D1 (PR4): field_code clash.**
- On an active–active `field_code` clash, the first field in walk order keeps the bare code and later fields get `__<8hex>`.
- The README lists the clashes.

**D2 (PR4): article label suffixes.**
- The first "Smith 2020" keeps its bare label; later ones get b, c, … in `(created_at, id)` order. A label is therefore stable once it appears.
- Deleting an article can shift labels; the README says so.

**D3 (PR5): booleans in Data.** Booleans go in a `value_bool` column after `value_text`, as an Excel boolean.

**D4 (PR5): reviewer names in exports.**
- A non-manager exporting consensus or single_user gets pseudonyms in `decided_by`/`consensus_by` for other people, whatever `anonymize_reviewer_names` says.
- Managers get names unless they anonymise.
- This keeps today's exposure: names were visible only in manager-only all_users.

**D5 (PR4): Codebook coverage for narrow snapshots.** Narrow legacy pinned snapshots are skipped in Codebook `versions`, and the README counts them.

**D6 (PR5): AI sheet `value`.** The AI sheet's `value` is the machine scalar, joinable to Data. Its unit goes in a `unit` column.

**D7 (PR6): Publication footnotes and markers.**
- Footnotes are rows below each Publication table.
- A scope marker is `NA*`.
- Derived overalls keep their full text.

**D8 (PR2): accept and un-accept.**
- Follow the spec: un-accept restores the predecessor's link, and the documented ping-pong is accepted.
- A no-information marker typed over accepted AI keeps the link.
- A canonicalization-gap UI is accepted.

**D9 (PR3): `other` answers and units.**
- A single `other` answer leaves `value_text` blank; the text goes in `other_text`.
- Data's `unit` is the envelope unit only.
- Derived overalls stay code-based, as today.

**D10 (PR5): consensus loader joins.**
- The consensus loader LEFT JOINs the latest consensus decision; a missing one gives `override`/`human`.
- The selected decision's own link is used.
- An orphan field gets a minimal descriptor and a blank `sheet`.

**R8a (settled after reconcile, PR1/PR5):** PR1 names the AI role id `ai_proposals` immediately (title "AI proposals"); PR5 renames only the module file.

---

## Appendix: cross-PR interface contract (first pass)

> Superseded where the rulings above or a plan's own **Interfaces** block differ. Plans are authoritative.


All facts below were checked against dev @ 4ad80f98 on 2026-10-31.

**House style**
- Value objects are plain `@dataclass(frozen=True)` in 47 places. That covers every export layout type: `extraction_export_service.py:102-331`, `sheet_spec.py:21-56` and `descriptors.py:64`.
- `@dataclass(frozen=True, slots=True)` appears in 28 places, including `exports/value_envelope.py:46` (`PeeledValue`).
- **Rule used here:**
  - New pure value types (`ExportValue`, `CellRecord`, `ExportFile`, `SheetTitles`) use `frozen=True, slots=True`.
  - Types that extend `ExportLayout` stay `frozen=True`.
- Async loaders are `async def f(db: AsyncSession, *, ...)` (see `article_read_service.owned_articles:38`) or a method on `ExtractionExportService`.
- Errors subclass `AppError(code, message, status_code)` (`core/error_handler.py:22-40`).

**Import cycle (hard constraint).** `exports/extraction/__init__.py:12` imports `workbook`, `workbook` imports the service, and the service imports at module level from top-level `exports/*` only (`descriptors.py:3-8`).
- So `values.py` and `CellRecord` must sit under `exports/`, never under `exports/extraction/`.
- `run.py` may import the service.

### 1. Shared symbols

| symbol | module | signature / fields | PR in | consumed by |
|---|---|---|---|---|
| `ExportRequest` (new; see §3 F1) | `exports/extraction/run.py` | `@dataclass(frozen=True, slots=True)`: `project_id: UUID; template_id: UUID; mode: ExportMode; article_ids: tuple[UUID, ...]; reviewer_id: UUID \| None; include_ai_metadata: bool; anonymize_reviewer_names: bool; shape: ExportShape` | 1 | 1 (endpoint, task), 5 |
| `authorize_export` | `exports/extraction/run.py` | `async def authorize_export(db: AsyncSession, req: ExportRequest, *, user_id: str) -> None`. Raises `AuthorizationError` (403) or `NotFoundError` (404) | 1 | 1 |
| `build_export` | `exports/extraction/run.py` | `async def build_export(db: AsyncSession, req: ExportRequest, *, user_id: str, trace_id: str \| None = None) -> ExportFile` | 1 | 1 (endpoint sync path, Celery task), 5 (budget) |
| `ExportFile` | `exports/extraction/run.py` | `content: bytes; filename: str; media_type: str = XLSX_MIME` | 1 | 1 |
| `EmptyExportError` | `exports/extraction/run.py` | `class EmptyExportError(AppError)`; `__init__(self, message: str = ...)`, code `"EMPTY_ELIGIBLE_ARTICLES"`, status 422; `message` starts with `"EMPTY_ELIGIBLE_ARTICLES: "` | 1 | 1, 6 (frontend) |
| `ExportTooLargeError` | `exports/extraction/run.py` | `class ExportTooLargeError(AppError)`; `__init__(self, message: str)`, code `"EXPORT_TOO_LARGE"`, status 422; message starts with `"EXPORT_TOO_LARGE: "` | 5 | 5 |
| `EXPORT_CELL_BUDGET` | `exports/extraction/run.py` | `Final[int] = 5_000_000` | 5 | 5 |
| `estimate_cells` | `exports/extraction/workbook.py` | `def estimate_cells(layout: ExportLayout, shape: ExportShape) -> int` | 5 | 5 |
| `matrix_fits` | `exports/extraction/workbook.py` | `def matrix_fits(layout: ExportLayout) -> bool`; reuses `_matrix_column_count` (`workbook.py:89`) | 1 | 1 |
| `safe_sheet_title` | `exports/extraction/sheet_spec.py` (openpyxl-only, no service import) | `def safe_sheet_title(raw: str, taken: Collection[str], *, fallback: str) -> str`. Strips `[]:*?/\`, max 31 chars, case-insensitive against `taken`, deterministic `" (n)"` suffix | 1 | 1, 4 |
| `RESERVED_TITLES` | `sheet_spec.py` | `Final[tuple[str, ...]] = ("README","Summary","Matrix","Articles","Data","Verification","AI proposals","Appraisal","Codebook","Options","History")` | 1 | 1, 4, 5 |
| `SheetTitles` | `exports/extraction/workbook.py` | `fixed: Mapping[str, str]` (role → title; role keys = builder ids), `levels: Mapping[UUID, str]` (entity_type_id → title; PR1 holds per-section tidy titles), `order: tuple[str, ...]` (README contents), `matrix_omitted: bool` | 1 | 1 (front_matter), 4 (level_tables, codebook `sheet`), 5 (data_sheet `sheet`) |
| `allocate_titles` | `exports/extraction/workbook.py` | `def allocate_titles(layout: ExportLayout, shape: ExportShape, *, include_matrix: bool) -> SheetTitles` | 1 (extended in 4) | 1, 4, 5 |
| `build_workbook` | `exports/extraction/workbook.py` (exists :224) | becomes `def build_workbook(layout: ExportLayout, shape: ExportShape, *, include_matrix: bool) -> bytes`; calls `allocate_titles` and writes through `_render_sheet_spec` | 1 | 1, 3–6 |
| sub-builder contract | `exports/extraction/*.py` | every builder is `def build_<x>(layout: ExportLayout, titles: SheetTitles) -> SheetSpec \| None`; `build_level_tables(layout, titles, shape) -> list[SheetSpec]` | 1 | all |
| `_render_sheet_spec` hygiene | `sheet_spec.py:74` | strips `openpyxl.cell.cell.ILLEGAL_CHARACTERS_RE` from every `str`; a `str` starting with `=` is written with `data_type="s"` | 1 | all |
| `PeeledValue`, `peel_envelope` | moved from `value_envelope.py:46,56` to `exports/values.py` | unchanged: `value: Any; unit: str \| None; absent_reason: str \| None`; `def peel_envelope(raw: Any) -> PeeledValue` | 3 | 3 (`mcp_value_render.py:20`, `test_mcp_value_render.py:11`) |
| `ExportValue` | `exports/values.py` | `raw: Any` (stored envelope, for rules and appraisal); `status: Literal["answered","absent","rejected","cleared","nonconforming"]`; `value_num: int \| float \| None`; `value_text: str \| None`; `value_bool: bool \| None` (see F9); `value_label: str \| None`; `unit: str \| None`; `other_text: str \| None`; `absent_code: str \| None`; `out_of_scope: bool = False` | 3 | 3 (scope marking, appraisal, matrix), 4, 5, 6 |
| `OptionLabels` | `exports/values.py` | type alias `Mapping[tuple[UUID, str], str]` ((field_id, code) → label) | 3 | 3, 4, 5, 6 |
| label chain | `exports/values.py` | `def build_option_labels(active: Sequence[SectionDescriptor], pinned_latest_first: Sequence[Sequence[SectionDescriptor]]) -> OptionLabels` | 3 (active only), 4 (pinned union) | 3, 4 (Options), 5 (`value_label`) |
| `to_export_value` | `exports/values.py` | `def to_export_value(raw: Any, field: FieldDescriptor, labels: OptionLabels, *, rejected: bool = False) -> ExportValue` | 3 | 3–6 |
| display projection | `exports/values.py` | `def display_value(v: ExportValue, field: FieldDescriptor, *, target: Literal["matrix","publication"]) -> CellValue` | 3 (matrix), 6 (publication) | 3, 6 |
| `canonical_key` | `exports/values.py` | `def canonical_key(raw: Any, pinned_field: RunViewField \| None) -> str`. Strips verification first (`canonicalize_value` refuses non-envelope keys, `value_contract.py:72-89`), sorts multiselect codes, uses `json.dumps(sort_keys=True)`; on `ValueContractError` falls back to the peeled raw value | 5 | 5 (`origin_of`, Verification `match`) |
| `ValueKey`, `value_key` | `exports/descriptors.py` | `ValueKey = tuple[UUID, UUID, UUID, UUID \| None]`; `def value_key(run_id: UUID, instance_id: UUID, field_id: UUID, rater: UUID \| None = None) -> ValueKey` (`None` = consensus) | 3 (see F26) | 3–6 |
| `level_of` | `exports/descriptors.py` | `def level_of(section: SectionDescriptor, sections: Sequence[SectionDescriptor]) -> UUID \| None` (nearest MANY self-or-ancestor; `None` = Articles) | 4 | 4, 5 |
| walk / skip | `exports/descriptors.py` | `def walk_sections(sections: Sequence[SectionDescriptor]) -> tuple[SectionDescriptor, ...]` (depth-first; drops a subtree with no fields) | 4 | 4, 5 (replaces `scope_marking.reader_instance_ids:75`) |
| `record_label` | `exports/descriptors.py` | `def record_label(section: SectionDescriptor, article: ArticleDescriptor, instance_id: UUID, position: int) -> str`; uses `article.keyed_labels`, else `f"{_stem(section)} {position}"` (`descriptors.py:235`) | 4 | 4, 5 |
| `ArticleDescriptor` additions | `extraction_export_service.py:151` | `article_label: str = ""`, `doi: str \| None = None`, `pmid: str \| None = None`, `template_version: int \| None = None`, `keyed_labels: Mapping[UUID, str] = field(default_factory=dict)` (instance_id → `label.strip()` when `entity_key.key_of(inst)` (:117) is set) | 4 | 4, 5, 6 |
| `FieldDescriptor` additions | `extraction_export_service.py:103` | `code: str = ""`, `allowed_units: tuple[str, ...] = ()`, `is_entity_key: bool = False`, `allowed_absent_codes: tuple[str, ...] = ()` (needs `SnapshotField` widened, `extraction_snapshot_reader.py:43`) | 4 | 4, 5, 6 |
| field codes | `exports/extraction/codebook.py` | `def assign_field_codes(entries: Sequence[CodebookEntry]) -> Mapping[UUID, str]` (rule 3) | 4 | 4, 5 |
| `CodebookEntry` | `codebook.py` | `field_id: UUID; field_code: str; sheet: str \| None; section_code: str; section_label: str; parent_section_code: str \| None; field_label: str; type: ExtractionFieldType; unit: str \| None; allowed_units: tuple[str, ...]; required: bool; is_entity_key: bool; allowed_absent_codes: tuple[str, ...]; allow_other: bool; description: str \| None; in_current_version: bool; versions: tuple[int, ...]` | 4 | 4, 5 |
| codebook loader | `extraction_export_service.py` | `async def _load_codebook(self, *, project_id: UUID, template_id: UUID, active_version_id: UUID) -> tuple[CodebookEntry, ...]` (distinct `ExtractionRun.version_id` for project and template, plus the active version) | 4 | 4, 5 |
| `build_level_tables` | `exports/extraction/level_tables.py` (renamed `tidy_tables.py`) | `(layout, titles, shape) -> list[SheetSpec]` | 4 | 4, 6 |
| `build_codebook` / `build_options` | `codebook.py` | `(layout, titles) -> SheetSpec` / `-> SheetSpec \| None` | 4 | 4 |
| `OmittedArticle` | `extraction_export_service.py` | `article_id: UUID; article_label: str; reason: str` (run stage or `no_run` / `no_decisions_from_reviewer`) | 4 | 4 (Summary) |
| `ExportLayout` changes | `extraction_export_service.py:332` | PR3: `value_map: dict[ValueKey, ExportValue]`, `option_labels: OptionLabels`. PR4: drop `notes`/`data_dictionary`/`tidy_tables`; add `generated_at: datetime`, `omitted: tuple[OmittedArticle, ...]`, `codebook: tuple[CodebookEntry, ...]`. PR5: `cells: Mapping[ValueKey, CellRecord]`, `rater_labels: Mapping[UUID, str]`, `pinned_fields: Mapping[UUID, Mapping[UUID, RunViewField]]` (version_id → field_id → field), `ai_proposed: frozenset[tuple[UUID, UUID, UUID]]` (article, instance, field) | 3/4/5 | 3–6 |
| `article label map` | `extraction_export_service.py` | `async def _load_article_labels(self, *, project_id: UUID) -> dict[UUID, str]`; "Surname Year", a/b suffixes by `(created_at, id)`, `project_id` in WHERE | 4 | 4, 5, 6 |
| `DecisionFact` | `exports/cell_record.py` (new) | `id: UUID; kind: Literal["accept_proposal","edit","reject","select_existing","manual_override"]; actor_id: UUID; created_at: datetime; rationale: str \| None; selected_decision_id: UUID \| None` | 5 | 5 |
| `LinkedProposal` | `exports/cell_record.py` | `id: UUID; run_id: UUID; source: str; proposed_value: Any` | 5 | 5 |
| `CellRecord` | `exports/cell_record.py` | `envelope: Any; decision: DecisionFact; linked_proposal: LinkedProposal \| None` | 5 | 5 (loaders, data_sheet, verification) |
| reviewer / consensus loaders | `extraction_export_service.py` | `async def _load_reviewer_cells(self, *, run_ids: list[UUID], reviewer_ids: Sequence[UUID] \| None) -> dict[ValueKey, CellRecord]`; `async def _load_consensus_cells(self, *, run_ids: list[UUID]) -> dict[ValueKey, CellRecord]` (`DISTINCT ON` latest) | 5 | 5 |
| `Origin` | `exports/extraction/data_sheet.py` | `Literal["ai_accepted","ai_edited","human","rule","mixed"]` | 5 | 5, 6 (README) |
| `origin_of` | `data_sheet.py` | `def origin_of(cell: CellRecord, pinned_field: RunViewField \| None) -> Origin` | 5 | 5 |
| consensus origin | `data_sheet.py` | `def consensus_origin_of(cell: CellRecord, reviewers: Sequence[CellRecord], selected: CellRecord \| None, pinned_field: RunViewField \| None) -> tuple[Origin, Literal["select_existing","no_conflict","override"]]` | 5 | 5 |
| `LINEAGE_EXACT_SINCE` | `data_sheet.py` | `Final[date]` (PR2 merge date) | 5 | 5 (front_matter README) |
| `APPROVE_ALL_RATIONALE` | `run_lifecycle_service.py` (module level; replaces literal at :289) | `Final[str] = "Approved: reviewers agree (Phase 2 approve-all)."` | 5 | 5 |
| `build_data_sheet` / `build_verification` / `build_ai_proposals` | `data_sheet.py` / `verification.py` / `ai_metadata.py` | `(layout, titles) -> SheetSpec`; verification returns `None` unless `ALL_USERS`; AI sheet returns `None` unless `include_ai_metadata` | 5 | 5 |
| pseudonym map | `extraction_export_service.py` | `async def _load_rater_labels(self, *, project_id: UUID, anonymize: bool) -> dict[UUID, str]` ("Member A…" ordered by earliest reviewer or consensus decision, then id; collisions get `_short_id`) | 5 | 5, 6 |

### 2. Existing symbols the spec deletes

| symbol | path:line now | PR | current callers (grep-verified) |
|---|---|---|---|
| `ExportColumnLimitError` | `workbook.py:66` | 1 | `workbook.py:112`; tests `unit/test_extraction_export_column_guard.py:26,98,111`, `unit/test_extraction_export_determinism.py:37,527`. Comment-only mentions at `api/v1/endpoints/project_templates.py:548` and `template_versioning/_discard.py:133` (reword them) |
| `_assert_within_column_limit` | `workbook.py:109` | 1 | `workbook.py:233` |
| `_unique_title` | `workbook.py:119` | 1 | `workbook.py:245` |
| `tidy_tables._safe_sheet_name` | `tidy_tables.py:20` | 1 | `tidy_tables.py:39` |
| `matrix._safe_sheet_name` (**not listed in spec**) | `matrix.py:55` | 1 | `matrix.py:168` (Matrix title = template name) |
| per-route expose header | `endpoints/extraction_export.py:247` | 1 | – |
| inline template query in `_load_active_template_version` | `extraction_export_service.py:843-852` | 1 | `resolve_layout:456`; `integration/test_extraction_export_template_bola.py:39,53`. Also drop `check_scope_guards.baseline:7` |
| hand-built contents (`_build_front_matter`) | `extraction_export_service.py:1827` | 1 (contents) / 4 (rest) | `:496`; `unit/test_extraction_export_front_matter_projection.py` |
| `value_envelope.py` (`resolve_value`, `format_export_scalar`, `_apply_unit`) | `exports/value_envelope.py:1-192` | 3 | `mcp_value_render.py:20`; `extraction_export_service.py:80` (5 call sites in value maps); `matrix.py:31`; `ai_metadata.py:21`; tests `test_value_envelope.py`, `test_mcp_value_render.py:11`, `test_extraction_matrix_builder.py:382`, `test_extraction_front_matter_builder.py:85`, `test_derived_overall_screen_workbook_parity.py:23` |
| `_LABEL_TO_ABSENT_REASON` | `derived_judgment_service.py:71` | 3 | `derived_judgment_service.py:187` (`_absent_reason`) |
| `NOT_APPLICABLE` overwrite of recorded cells | `extraction_scope_marking.py:140-151` | 3 | `extraction_export_service.py:476` |
| `ExportNotes` | `extraction_export_service.py:178` | 4 | `:478`; endpoint `:239` (`layout.notes.generated_at`); 15 unit tests (e.g. `test_extraction_workbook_orchestrator.py`, `test_extraction_export_golden_charms.py`) |
| `FieldDictEntry` + `_build_data_dictionary` | `:236`, `:1866` | 4 | `data_dictionary.py:10`; `:457`; tests `test_extraction_data_dictionary_builder.py`, `test_extraction_dropdown_lists_builder.py`, `test_extraction_export_data_dictionary_projection.py`, `test_extraction_export_shape_filter.py`, `test_extraction_xlsx_builder.py`, `test_extraction_export_determinism.py` |
| `TidyRow`, `TidyTable`, `_tidy_value`, `_tidy_row`, `_build_tidy_tables` | `:259`, `:274`, `:1896`, `:1916`, `:1944` | 4 | `tidy_tables.py:12`; `:472`; tests `test_extraction_export_tidy_tables_projection.py`, `test_extraction_export_tidy_model_section.py`, `test_extraction_tidy_tables_builder.py`, `test_extraction_export_front_matter_projection.py` |
| `dropdown_lists.py` (`build_dropdown_lists`) | `exports/extraction/dropdown_lists.py:17` | 4 | `workbook.py:28,214`; `test_extraction_dropdown_lists_builder.py` |
| `_infer_reviewer_outcome` | `:1997` | 5 | `:1758` (`_load_ai_proposal_rows`); `unit/test_extraction_export_service.py`; outcome assertions in `integration/test_extraction_export_ai_outcome.py`, `..._ai_outcome_ordering.py` |
| "best-effort" caveat | `:1814-1815` | 5 | `_FRONT_MATTER_CAVEATS` (:1811) used in `_build_front_matter` |
| `AIProposalRow.reviewer_outcome` / `final_value_used` | `:232-233` | 5 | `ai_metadata.py`; `backend/.vulture_baseline:33-39` (shrink in the same PR) |
| duplicated consensus query | `:1101-1112` and `:1484-1494` | 5 | `resolve_layout:470,500` |
| "Reviewer X" anonymisation | `_list_reviewers_for_runs:1446-1455` | 5 | `:494` |

### 3. Facts the planner needs (spec errors, gaps, evidence)

- **F1 SPEC_CONFLICT.** `authorize_export(db, req, user)` / `build_export(db, req, user)` cannot work as written:
  - `project_id` is a path parameter, not part of `ExtractionExportRequest` (`schemas/extraction_export.py:44-84`).
  - The Celery task has only kwargs and `user_id: str` (`extraction_export_tasks.py:40-52`), not a `TokenPayload`.
  - Hence the `ExportRequest` dataclass and `user_id: str` in §1.
- **F2 SPEC_CONFLICT.** "Its one outside import (`mcp_value_render.py`)" is false.
  - `extraction_export_service.py:80` also imports `resolve_value`, and `matrix.py:31` / `ai_metadata.py:21` import `format_export_scalar`.
  - `PeeledValue` must move as well (`test_mcp_value_render.py:11`).
- **F3 SPEC_CONFLICT.** "Consensus decisions are append-only" is false.
  - `reopen_to_extract` deletes `ExtractionConsensusDecision` and `ExtractionPublishedState` (`run_lifecycle_service.py:502-506`).
  - Instance deletes cascade both reviewer and consensus decisions (`models/extraction_workflow.py:167,353`, `ondelete="CASCADE"`).
  - So Member letters can shift after a reopen or entry delete. Article a/b suffixes shift after an article delete.
  - The "latest" consensus read stays safe because both tables are deleted together.
- **F4 OPEN.** `selected_decision_id` only has to match the coordinate and not be a reject (`extraction_consensus_service.py:96-108`). It need not be the reviewer's current decision.
  - So "take the origin of the reviewer CellRecord whose id equals `selected_decision_id`" can miss.
  - The consensus loader must load the selected decision and its linked proposal directly.
- **F5 SPEC_CONFLICT / OPEN.** No sheet is called "Matrix" today: its title is the template name (`matrix.py:168`). PR1 must decide whether to rename it to "Matrix" (it is reserved).
  - Current titles are "Appraisal summary" (`appraisal_summary.py:156`), "AI metadata" (`ai_metadata.py:75`), "Data dictionary" (`data_dictionary.py:53`) and "Dropdown lists" (`dropdown_lists.py:36`).
  - The golden test asserts them: `integration/test_extraction_export_golden_structure.py:168-172`.
- **F6 OPEN.** The PR1 test "a section **named** `history`/`data` gets a suffix" is ambiguous. Until PR4, tidy sheet titles come from `section.label` (`TidyTable.title`, `tidy_tables.py:39`); section codes arrive only in PR4. The PR1 test has to collide on the label.
- **F7 gap.** The export field projection drops `allowed_units`, `is_entity_key`, `allows_not_applicable` / `allows_not_evaluated` / `allows_no_information` and `other_label` (`extraction_snapshot_reader.py:43-55`; `FieldDescriptor:103-124`).
  - `RunViewField` has them (`schemas/extraction_run.py:204-247`).
  - Codebook (PR4) and `canonical_key` (PR5, which needs a `RunViewField` from `extraction_snapshot.entity_types_for_version:302`) need them.
- **F8 gap.**
  - `ArticleDescriptor.entries` holds ids only (`:166`), so `record_label` needs instance `label` plus `entity_key.key_of(inst)` (`entity_key.py:117`) loaded in `_load_instances_for_runs:1016`.
  - The header is "Surname, Year" with a comma (`:2129`); the spec wants "Surname Year".
  - `_load_article_headers` has no `project_id` predicate (`:1072-1078`).
- **F9 OPEN.** §4.6 writes booleans as an Excel boolean, but the §4.1 Data columns have no boolean slot (`value_num` / `value_text` only). Pick `value_text` = `TRUE`/`FALSE`, or add `value_bool`.
- **F10.** Appraisal today is gated on `template.kind == QUALITY_ASSESSMENT` (`:575`) **and** on the vocabulary (`_RISK_LABELS`, `appraisal_summary.py:39`). The spec's vocabulary-only detection on root SELECT fields drops the kind gate, so an extraction template can gain an Appraisal sheet.
- **F11.** `EmptyExportError` must keep the code `EMPTY_ELIGIBLE_ARTICLES`, which the frontend relies on (`HITLExportDialog.tsx:297`, `HITLExportDialog.test.tsx:401`, `e2e/flows/extraction-export.e2e.ts:191`).
  - Async status `error` is `str(result.result)` (`endpoint:404`), which is `AppError.message` (`error_handler.py:40`). So the message itself must start with `CODE: `.
  - Celery's JSON backend rebuilds the exception with `cls(*args)` inside a try (`.venv/.../celery/backends/base.py:495-498`). Keep a single positional `__init__(message)`.
- **F12.** The task never retries today: there is no `self.retry`, and `max_retries=1` is unused (`extraction_export_tasks.py:35-39`). "Fails without retry" only means "do not add autoretry".
- **F13.** A Celery kwargs pin already exists: `integration/test_worker_eager_mode.py:84-140`.
  - It omits `shape` and patches `app.services.extraction_export_service.ExtractionExportService` and `...workbook.build_workbook`, so PR1 must add `shape` and retarget it to `build_export`.
  - The endpoint unit harness `unit/test_extraction_export_start_endpoint.py` (`_call_sync:58`, `_call_async:86`, shape kwarg `:123`) patches `_EP.ExtractionExportService` and `_EP.build_workbook`, which must also be retargeted.
  - No CORS or export integration HTTP test exists; `integration/test_extraction_export_endpoint.py:22` only checks routes.
- **F14.** `ExtractionExportService.storage` is assigned (`:387`) and never read. `build_export` / `authorize_export` need no storage. This is dead code (sibling refactor commit).
- **F15. Gates.**
  - `extraction_export_service.py` file-size baseline is 2194 (`scripts/fitness/check_file_size.baseline:4`); it is 2166 lines now.
  - New files are capped at 800 lines (`check_file_size.py:34`).
  - Scope-guard baseline `:7` goes in PR1 once `owned_template` is used; `:8` (`list_eligible_reviewers_for_picker`) can collapse onto `owned_template` too.
  - The vulture baseline only shrinks (`scripts/vulture_baseline.py:9`).
- **F16. Test helpers (real ones only).**
  - `tests/integration/conftest.py`: `SEED` (:146), `purge_templates` (:166), `clone_charms` (:547), `open_session` (:601), `make_proposal` (:630), `make_ai_proposal` (:662), `land_ai_proposal` (:701), `auth_as_profile` fixture (:789); `db_session` (`tests/conftest.py:133`).
  - There is no shared export fixture. Per-file helpers: `_seed_finalized_charms_run` (`test_extraction_export_golden_structure.py:53`, duplicated in `test_extraction_export_new_sheets.py:49`); `_seed_finalized_qa_run` (`test_extraction_export_appraisal_summary.py:102`, imported by `test_extraction_export_reviewer_picker.py:23`); `_make_run` / `_record_decision` (`test_extraction_export_ai_outcome.py:126,192`).
  - 21 test files pass `value_map=` (the PR3 rewrite).
- **F17. Frontend (PR2).**
  - Tests live in `frontend/test/hooks/useRunValues.test.tsx` and `useAutoSaveProposals.test.tsx`, not next to the hooks.
  - `RunValueProposal` (`useRunValues.ts:47`) has no `source`; read it from `runDetail.proposals` (`ProposalRecordResponse`).
  - Cited lines check out: `:239`, `:295` (un-accept), `:339` (undo), `LocalDecision:66`, `record():193`, `useAutoSaveProposals.ts:72-75` and `:295`.
- **F18.** The link validator rejects only `source == "human"` (`extraction_review_service.py:117`), so a `system`-source link is reachable through the API. `origin_of` must treat non-`ai` sources as `human`, so the spec's "no current write path" is inaccurate.
- **F19.**
  - Anonymisation today: "Reviewer A…" by `str(id)`, all_users only (`:1446-1450`). The schema description says all_users only (`schemas/extraction_export.py:79`). Its text changes, so API types are regenerated in the PR that changes it (PR5).
  - Omitted articles are counts only, `dict[str, int]` (`:936-1006`). The per-article Summary list needs `OmittedArticle` (PR4).
  - The copy key to relabel is `exportIncludeAiMetadata` (`frontend/lib/copy/extraction.ts:431`). The dialog is `components/hitl/HITLExportDialog.tsx`.
- **F20. Phasing.**
  - `EXPORT_CELL_BUDGET` / `ExportTooLargeError` are listed in `build_export` (§8) but tested in PR5 (§11). Introduce them in PR5; PR1's `build_export` does the empty check, Matrix include-or-omit and naming.
  - `APPROVE_ALL_RATIONALE` has no PR in §8; it belongs to PR5.
- **F21 / F26 (planner call).** `value_key` has no PR in the spec. PR3 already changes the `value_map` payload to `ExportValue` (the spec's PR3 test asserts `out_of_scope` on the `ExportValue`). Collapsing the 3-/4-tuple keys there avoids a second churn of the same 21 test files.
- **Verified spec cites:**
  - `run_lifecycle_service.py:289`, `value_semantics.py:134`, `entity_key.py:182-196`, `current_run.py:55-65`, `proposal_generation_read.py:115`. `prompt_version` exists only in `generation_snapshot`, not in `provenance` (`proposal_generation_read.py:18-26,53`).
  - `seed.py:148,319-323,1254,1318`, `main.py:170`, `schemas:67-71`, endpoint `:104-110,198,242-249,263`, task `:78-94`, `workbook.py:66,109,233`.