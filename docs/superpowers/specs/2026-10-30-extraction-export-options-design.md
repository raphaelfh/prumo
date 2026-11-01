---
status: draft
last_reviewed: 2026-10-30
owner: '@raphaelfh'
---

# Extraction export options — design

> Reviewer feedback (Revisor F, 12 items) on the extraction xlsx export showed
> that one workbook tries to serve four readers and serves none of them well.
> Values are glued to units as text, there are no stable keys, AI lineage is
> labelled "best-effort", and the browser never sees the filename. This spec
> reshapes the export around those four readers. It works with **any**
> template, needs **no migration**, and keeps the API's wire values.

## 1. Intent

The export has four readers:

1. **Scripts (R/Python):** tidy rows, stable keys, numbers stored as numbers, a codebook.
2. **The researcher**, reading their own data.
3. **Verification:** reviewer vs reviewer vs AI vs consensus, and who decided and why.
4. **Publication:** characteristics tables with NI/NA codes, DOI, and no UUIDs.

**Constraints (owner ruling, 2026-10-30)**

- **Output and code.** Clean output and a robust structure. Code complexity is kept as low as possible, and the export code stays well organised.
- **No drastic migration.** No DDL and no data migration. Template changes ship only as a *next* template version; existing projects and their cloned templates are not touched.
- **Template-agnostic.** The export works with CHARMS, CHARMS + Multimodal, PROBAST+AI, custom flat templates, nested repeating groups, and templates that lack any given field. No export logic reads a field or section by name. The only exception is the appraisal vocabulary (§5 rule 8).
- **The zip analysis package is deferred.**
- **AI provenance is the simple variant (§7).** It reports facts, plus an origin taken from the current decision's link. It infers nothing from the decision history.

**Success** means:

- An R script reads `Data` and joins it to the level sheets by id, with no cleaning.
- The same build serves CHARMS, PROBAST+AI and a custom flat template, with no template-specific branch.
- A second reviewer can filter the disagreements.
- The Publication tables contain no UUID.

## 2. Evidence (dev @ 4ad80f98, 2026-10-30)

| Fact | Where |
| --- | --- |
| The unit is glued into the value as text ("7394 participants") | `backend/app/services/exports/value_envelope.py` `_apply_unit` |
| `writeValue` receives `params.proposalRecordId`, then overwrites it with `null`. `linkByKey` yields a link only when the head's value equals the draft, so a typed change never carries a link. The doc comment saying later edits keep the link is stale | `frontend/hooks/runs/useRunValues.ts:239`, `:169-174`; `useAutoSaveProposals.ts:72-75`, `:295` |
| Accepting is an `edit` linked to the proposal. Un-accept and undo write an unlinked edit holding the predecessor value. `LocalDecision` keeps `predecessorId` and the value, not the predecessor's link. Redo already re-sends its link | `useRunValues.ts:290-296`, `:339` |
| Rejecting a proposal only clears the value; no `reject` decision is written | `useRunValues.ts:307` |
| The API still accepts `accept_proposal` (stored `value=NULL`, resolved through its proposal) and an AI link on any decision kind | `extraction_review_service.py:104-122`; `value_semantics.py:134` `resolve_reviewer_value` |
| Approve-all writes `MANUAL_OVERRIDE` with a fixed rationale | `run_lifecycle_service.py:281-293` |
| Consensus decisions are append-only while a run is open, but `reopen_to_extract` deletes a run's consensus decisions and published states, and instance deletes cascade to both decision tables. The published state has no FK to the decision that produced it. `record_consensus` is its only live writer; the archived migration 0015 inserted published states with no consensus decision | `models/extraction_workflow.py:341-458`; `extraction_consensus_service.py:143-157`; `run_lifecycle_service.py:502-506`; `alembic/versions/archive/20260427_0015_synthetic_runs_for_extracted_values.py:78` |
| `reopen_run` seeds `source=system` proposals, and the link validator rejects only `source=human`, so an accepted carried-over value links a non-AI proposal | `run_lifecycle_service.py:633-644`; `extraction_review_service.py:117` |
| `section.name` has no unique constraint within a template version | `models/extraction.py:375-387`; `template_section_service.py:136-181` |
| pandas is only a transitive backend dependency (via docling) | `backend/uv.lock`; `backend/pyproject.toml` dev group |
| A scope rule overwrites **recorded** answers with Not applicable in every slot: consensus, single-user and each reviewer | `exports/extraction_scope_marking.py:140-151` |
| A dictionary-only export still requires ≥1 article id | `schemas/extraction_export.py:67-71` |
| CORS `expose_headers` lacks `Content-Disposition`. The endpoint's own expose header is overwritten. The browser falls back to `extraction_export.xlsx` | `main.py:170`, `endpoints/extraction_export.py:242-249`, `frontend/services/extractionExportService.ts:47` |
| The endpoint picks sync or async before any service call. Async returns 202, then the task builds | `endpoints/extraction_export.py:104-110`, `:198`, `:263`; `worker/tasks/extraction_export_tasks.py:78-94` |
| Only the Matrix width is checked, and for every shape, so a Codebook export can be refused because of a Matrix it does not contain | `exports/extraction/workbook.py:66`, `:109`, `:233` |
| A repeating group has at most one identity field (unique index, migration 0059), materialized and normalized into `metadata->>'entity_key'` | `entity_key.py:182-196`; `0059_entity_key_field.py`, `0090_entity_key_unique.py` |
| The seed early-returns on an existing template. Convergence passes touch only unreferenced globals. Project clones are never touched | `seed.py:319-323`, `:2096-2099`; `template_clone_service.py` |
| `numeric_performance` is keyed by `pnum_validation_type`, so one model cannot hold two external validations | `seed.py:148`; `entry_hierarchy_service.py:139-151` |
| Headers are loaded only for articles with a current run of this template in this project, so foreign ids do not leak **today** | `current_run.py:55-65`; `extraction_export_service.py:953-1003` |
| openpyxl stores a string starting with `=` as a formula; `pd.read_excel` returns NaN for it | verified in the backend venv during design review |
| pandas' default `na_values` include `NA`, `N/A`, `None`, `NULL`, `nan`, and CHARMS seeds an option code `None` | pandas defaults; `seed.py:1254`, `:1318` |

## 3. Export options

The `shape` wire values are unchanged, so there is no API break. Only the UI labels change.

| `shape` | UI label | Readers | Sheets |
| --- | --- | --- | --- |
| `complete` | **Review workbook** | scripts, researcher, verification | README · Summary · [Matrix] · Articles · one sheet per repeating level · Data · [Verification] · [AI proposals] · [Appraisal] · Codebook · Options |
| `publication` | **Publication tables** | publication | README · Articles · level sheets · [Appraisal] |
| `dictionary` | **Codebook** | scripts, before any run is finalized | README · Codebook · Options |

- **`mode`** (`consensus` | `single_user` | `all_users`) is unchanged.
  - `all_users` adds Verification and stays manager-only, as today.
- **`include_ai_metadata`** is relabelled "Include AI detail". It adds:
  - the AI proposals sheet;
  - the AI column in Verification.

  It still routes the export to the async path.
- **`anonymize_reviewer_names`** applies in every mode, through one pseudonym map (§6).
- **`article_ids`**: `shape=dictionary` is exempt from two checks:
  - `min_length=1` becomes a validator that exempts it;
  - the endpoint's `selected_only` 400 is deleted: `min_length` already answers 422 before it runs, so it is unreachable today, and after the validator every empty request that reaches the endpoint is a dictionary request.

## 4. Output spec

### 4.1 Data: the machine contract

One row per (`article_id`, `instance_id`, `field_id`, `rater`). The sheet is sparse: only recorded values and scope-rule stamps appear.

| Group | Columns |
| --- | --- |
| Keys | `article_id, article_label, sheet, record_id, parent_record_id, instance_id, record_label, field_id, field_code, rater` |
| Value | `status, value_num, value_text, value_bool, value_label, unit, other_text, absent_code, out_of_scope` |
| Lineage | `origin, ai_proposed, ai_proposal_id, decided_by, decided_at, rationale` |
| Consensus rows only | `consensus_method, n_raters_with_value` |

**Key columns**

- `sheet` is the exact title of the record's Review-workbook level sheet. It joins to Codebook `sheet`.
- `record_id` is the nearest repeating instance; it equals `article_id` at the root. It is the join key to the level sheets.
- `instance_id` is the stored coordinate, so two single (ONE) instances under one parent stay distinct.
- `rater`:
  - a reviewer's label (§6) on reviewer rows;
  - the reserved literal `consensus` on consensus rows, in every mode.

  `all_users` carries one consensus row per coordinate next to the reviewer rows.

**Closed value sets**

| Column | Values |
| --- | --- |
| `status` | `answered`, `absent` (an absent marker), `rejected` (a real `reject` decision), `cleared` (an edit to null), `nonconforming` (legacy text that does not fit the field type; raw text kept in `value_text`) |
| `origin` | `ai_accepted`, `ai_edited`, `human`, `rule`; `mixed` on consensus rows only (§7) |
| `consensus_method` | `select_existing`, `no_conflict`, `override` |
| `absent_code` | the stored codes (`no_information`, `not_applicable`, `not_evaluated`) |

A scope-rule stamp is `status=absent`, `absent_code=not_applicable`, `out_of_scope=true`, `origin=rule`.

### 4.2 Level sheets

- **One sheet per level.**
  - The root sheet is `Articles`.
  - Each repeating section gets its own sheet. Titles come from §5 rule 4: the section code in the Review workbook, the section label in Publication.
  - Level sheets carry **active-version fields only**. Values of removed fields live in Data.
- **`Articles`** columns:
  - `article_id, article_label, doi, pmid, template_version`;
  - then root-level fields;
  - then `rater` in `all_users`.
- **Other level sheets** have these key columns:
  - `article_id, article_label, record_id, parent_record_id, record_label`;
  - one `<ancestor_code>.label` column per repeating ancestor;
  - `rater` in `all_users`, with one consensus row per record next to the reviewer rows.
- **Review workbook cells** hold the machine value (§4.6):
  - one column per `field_code`;
  - a `.unit` companion when the field has `allowed_units`, otherwise the header reads "code (unit)" from the field's fixed unit;
  - an `.other` companion when `allow_other` is set;
  - absent markers and out-of-scope recorded values are blank (both stay in Data);
  - if two ONE instances share a parent, the sheet shows the first and Data keeps both.
- **Publication cells** hold the display value (§4.6):
  - headers are field labels; the unit sits in the header ("Label (unit)") or, for `allowed_units` fields, in each cell;
  - there are no `.unit` or `.other` companions, and no UUID columns.

### 4.3 Verification (`all_users`)

**Columns:** `article_label, record_label, field_code, field_label`, then one column per reviewer, then [AI], `Consensus`, `match`, `n_raters`, `n_raters_with_value`, `consensus_method`, `consensus_by`, `consensus_rationale`.

**Rater set.** It is defined per article: the reviewers with at least one non-reject current decision on that article's run. This is the same predicate as `_list_reviewers_for_runs`, applied per run.
- `n_raters` is the size of that set.
- Reviewer columns outside the set show `—` (not assigned).
- AI and Consensus are shown, but never take part in `match`.

**Rows** are the coordinates where at least one rater has a current decision.

**`match`** compares values with `values.canonical_key`. An absent marker compares by its code.
- `all_equal`: every rater has a value, `n_raters ≥ 2`, and there is one distinct value.
- `conflict`: two or more distinct values.
- `incomplete`: anything else.

**Percent agreement** is `all_equal` rows divided by rows with `n_raters ≥ 2`. The README states this denominator. Cohen's kappa is deferred.

### 4.4 Codebook and Options

**Scope.** Both cover every version pinned by any run of this template in this project, plus the active version. This does not depend on `article_ids`, so `shape=dictionary` with no articles works.

**Codebook:** one row per `field_id`.
- Columns:
  - `field_code, field_id, sheet, section_code, section_label, parent_section_code`;
  - `field_label, type, unit, allowed_units, required, is_entity_key`;
  - `allowed_absent_codes` (joined with `"; "`), `allow_other`, `description`;
  - `in_current_version`, `versions`.
- Metadata comes from the active version, otherwise the latest pinned version.
- `sheet` is the Review-workbook title from `safe_sheet_title`. It is filled in every shape, including dictionary. It is blank only when the field's section is absent from the active tree; those values appear only in Data.

**Options:** one row per (`field_code`, `code`).
- Columns: `label, order, in_current_version`.
- The label comes from the same chain as the Codebook (active, else latest pinned).
- `value_label` in Data uses the same chain.
- Options replaces the Dropdown lists sheet.

### 4.5 README and Summary

**README contents:**
- Contents, built from the pre-allocated titles (§5 rule 4).
- Legends, and counts by `status` and `origin`.
- An AI-tools table: provider, model and prompt version, with proposal counts, from `serialize_proposal_generation` (`proposal_generation_read.py:115`; generation_snapshot, else provenance). Where the prompt version is missing, it says "not recorded".
- What each `origin` can and cannot tell (§7), with `LINEAGE_EXACT_SINCE`.
- Caveats:
  - `article_id` is a report, not a study, so companion reports must be collated by hand.
  - Stored numbers drop trailing zeros.
  - Domain detection uses an appraisal vocabulary (§5 rule 8).
- A reading snippet. Blank is the only missing marker:
  - R: `readxl::read_excel(path, "Data", guess_max = Inf)`
  - pandas: `pd.read_excel(path, "Data", keep_default_na=False, na_values=[""], dtype={<text columns>: str})`
- A note when the Matrix was left out.
- No UUIDs anywhere in the README.

**Summary:**
- Per-record completeness.
- Every omitted article, with its label and a reason. Reasons are the run-stage values (`pending`, `extract`, `consensus`, `cancelled`) plus `no_run` and `no_decisions_from_reviewer`, the current code keys.

### 4.6 How values are written (`values.to_export_value`)

| Type | Machine (Data, Review level sheets) | Display (Matrix, Publication level sheets, `value_label`) |
| --- | --- | --- |
| number | `value_num`, unit in `unit`. Text that does not parse → `nonconforming` | Matrix: "7394 participants". Publication: the number. `value_label` is blank |
| text | `value_text` | the text |
| select | the code in `value_text` | the label (§4.4 chain), else the raw code |
| multiselect | codes joined with `"; "` | labels joined with `"; "` |
| other | `other_text`; `other_texts[]` joined with `"; "` | "Other: …" |
| boolean | Excel boolean in `value_bool` | Yes / No |
| date | ISO text | ISO text |
| absent marker | blank value plus `absent_code` | Matrix: the full label. Publication: NI / NA / NE, with a footnote |
| out-of-scope recorded value | the value plus `out_of_scope=true` | the scope marker, with a footnote |
| rejected / cleared | blank plus `status` | blank |

**Writer hygiene** is applied once, in the single writer `_render_sheet_spec`:
- `ILLEGAL_CHARACTERS_RE` is stripped from every string, so `"a\x0cb"` is written as `"ab"`;
- a string starting with `=` is written as text (`data_type="s"`, quote prefix).

## 5. Template-agnostic rules

1. **Levels.** The root is Articles. Each `cardinality='many'` section is a level. Each `one` section joins its nearest repeating ancestor, or the root.

2. **Walk and skip.** Sections are walked depth-first. A section is skipped only when neither it nor any descendant has fields. This one rule replaces the three skip rules in `matrix.py`, `extraction_export_service.py` and `extraction_scope_marking.py`.

3. **`field_code` = `<section.name>.<field.name>`.**
   - Active-version fields get the bare code.
   - On a name clash, non-active fields get a deterministic short-id suffix (`__<8hex>`), so active headers stay stable between exports.
   - `section.name` is not unique, so two active fields can clash: the first in walk order keeps the bare code, later ones get the suffix, and the README lists the clash.

4. **Titles.** One pre-pass allocates every sheet title before any builder runs. It uses `safe_sheet_title`.
   - Reserved titles are claimed first, compared case-insensitively: `README`, `Summary`, `Matrix`, `Articles`, `Data`, `Verification`, `AI proposals`, `Appraisal`, `Codebook`, `Options`, and Excel's `History`.
   - Titles are at most 31 characters, with a deterministic suffix when needed.
   - `safe_sheet_title` replaces `workbook._unique_title` and `tidy_tables._safe_sheet_name`.

5. **Nothing is read by name.** Template behaviour comes from the frozen snapshot's `scope_rules`, whose stamps reach Data with `origin=rule`, and from `derived_judgments`, which have no `field_id` and appear only in Appraisal.

6. **Record labels.**
   - `record_label` is `instance.label`, trimmed, for a keyed section that has a stored key.
   - Otherwise it is today's positional "{stem} {i}" from `descriptors.iter_records`. That covers unkeyed sections and keyed instances created before 0059.
   - The label has no article prefix.
   - The same rule fills every `<ancestor_code>.label` column.
   - The README says the label is the name given at creation, and the key field's column is authoritative.

7. **Mixed versions.**
   - A field missing from a run's pinned version produces no Data row and a blank level-sheet cell. Scripts derive this from `Articles.template_version` and `Codebook.versions`.
   - Values of removed fields stay in Data.
   - Moved fields keep their `field_id`.
   - A value whose section has no active level sheet appears only in Data, with `sheet` blank and a count in the README.

8. **Appraisal is the one documented exception.**
   - **Detection** uses a fixed risk-of-bias vocabulary (PROBAST, QUADAS, RoB labels). The Appraisal sheet appears when a root section has a SELECT field whose labels all belong to that vocabulary. A custom appraisal template with other labels gets no Appraisal sheet and a README note.
   - **Ranking** is by option label, read from raw envelopes.
   - **"Overall (worst domain)"** appears only in the Review workbook and ignores out-of-scope values.
   - **Domains not at the root** are skipped, with a README note.

## 6. Keys and grain

- **Grain** is (article, instance, field, rater). One `value_key()` replaces the per-mode key builders and the 3-tuple vs 4-tuple `value_map` keys.
- **`article_label`** is "Surname Year".
  - Fallback chain: surname, then `title[:60]`, then the short id.
  - When several project articles share a label, the first in `(created_at, id)` order keeps the bare label and later ones get b, c, …, so a label does not change when another article is imported. Deleting an article can shift later suffixes; the README says so.
  - It takes one query, with `project_id` in the WHERE clause.
- **Reviewer labels and pseudonyms** come from one label map per project. It feeds `rater`, `decided_by` and `consensus_by`.
  - **Anonymised:** "Member A, B, …", ordered by each person's earliest reviewer or consensus decision in the project, ties broken by id. Adjudicators are covered without a membership query. A run reopen or an entry delete removes decisions, so letters can shift; the README says so.
  - **Not anonymised:** the display name. On a collision with another name or with `consensus`, append `_short_id(reviewer_id)`.
  - **Non-managers** always see pseudonyms for other people in `decided_by` and `consensus_by`, whatever `anonymize_reviewer_names` says. Names stay visible only where they are today: to managers.
- **Field-code headers are the script contract**, because labels are freely editable. `field_id` is the durable join key. Each sheet has one header row.

## 7. AI provenance (simple variant)

### Loaders

Both loaders return `CellRecord(envelope, decision, linked_proposal)`.

- **Reviewer loader** (used in every mode, including consensus):
  - Reads each reviewer's **current** decision and LEFT JOINs the proposal it links to.
  - `envelope` is `resolve_reviewer_value(decision, value, linked.proposed_value)`. So a legacy `accept_proposal` decision, whose stored value is NULL, resolves to its proposal's value.
- **Consensus loader:**
  - Reads the published state, LEFT JOINed to the latest `ExtractionConsensusDecision` per (run, instance, field) (`DISTINCT ON … ORDER BY created_at DESC, id DESC`). A published state with no decision (legacy migration 0015) reads as `override` / `human`.
  - Consensus decisions carry no proposal link. Their AI lineage comes through `selected_decision_id`, whose own proposal link is joined (the selected decision need not be current).
  - The Verification AI column is the second "latest" read: the latest `source=ai` proposal of the current run per coordinate.

### Origin

`data_sheet.origin_of()` gives the origin of a filled reviewer value:

| `origin` | Rule |
| --- | --- |
| `ai_accepted` | Linked to a `source=ai` proposal, and canonically equal to it. This includes a legacy `accept_proposal` |
| `ai_edited` | Linked to a `source=ai` proposal, but different from it |
| `human` | Not linked, or linked to a non-AI proposal (e.g. an accepted `source=system` carry-over after a reopen) |
| `rule` | Stamped at export time by a scope rule |

### Consensus rows

- **`select_existing`:** takes the origin of the reviewer `CellRecord` whose decision id equals `selected_decision_id`.
- **`no_conflict`:** a `manual_override` whose rationale equals `APPROVE_ALL_RATIONALE`.
  - The constant is extracted from `run_lifecycle_service.py:289`. Its docstring marks it frozen: editing the text would reclassify past rows.
  - The origin is the reviewers' shared origin, or `mixed`.
- **`override`:** any other `manual_override`, with origin `human`.
- **`n_raters_with_value`:** always filled, from the reviewer cells of the same coordinate.

### Fact columns

- **`ai_proposed`:** true when a `source=ai` proposal exists for (`instance_id`, `field_id`) in any run of the article, or when the linked proposal is AI.
- **`ai_proposal_id`:** the linked proposal, filled only when it is `source=ai`.

### Canonical equality

`values.canonical_key(raw, pinned_field)` works like this:
- It calls `value_contract.canonicalize_value` against the run's **pinned** field. That field is a `RunViewField` from `entity_types_for_version`, so the comparison follows the version the run was written against.
- It strips `verification` and compares multiselects as sets.
- If canonicalization raises `ValueContractError` on either side, both sides are compared as peeled raw values. So the API is over a set of values (`canonical_keys(raws, field) -> tuple[str, ...]`, `canonical_equal(a, b, field)`), not a unary key.

### What the README states

- `ai_accepted` is exact in every period.
- Before `LINEAGE_EXACT_SINCE` (the PR2 release date, a constant in `data_sheet.py`), a value typed over an AI suggestion was saved unlinked. It therefore reads `human` with `ai_proposed=true`.
- An unlinked re-save of the AI value also reads `human`.
- After a run reopen, the AI chain of the earlier run is not traced.

### AI proposals sheet (with "Include AI detail")

- **Rows:** `source=ai` proposals of the current runs, plus any `source=ai` proposal referenced by an in-scope decision. Links may cross runs (`extraction_review_service.py:104-111`).
- **Columns:** `article_id, instance_id, field_id, field_code, ai_proposal_id`, provider, model, prompt version, value, confidence, rationale, evidence quote, page.

### Deleted

- `_infer_reviewer_outcome` and its latest-per-key ordering (`extraction_export_service.py:1997`).
- The "best-effort" lineage caveat (`:1815`).

## 8. Code layout

`exports/extraction/run.py` is the single entry module (about 120 LOC). It holds two functions.

**`authorize_export(db, req, user)`.** The endpoint calls it **before** choosing sync or async, so its 404s are real on both paths. It:
1. runs the existing membership and role gates: manager for `all_users` and for another reviewer's `single_user`, plus the `reviewer_id` requirement;
2. checks `article_ids` with `article_read_service.owned_articles`;
3. checks the template with `owned_template`, which replaces the inline query at `extraction_export_service.py:843-852`;
4. maps `ArticleNotFoundError` and `project_template_active_service.ProjectTemplateNotFoundError` to `NotFoundError`.

**`build_export(db, req, user) -> ExportFile`.** The sync endpoint and the Celery task both call it. It:
1. runs the per-shape empty check (today's async path has none);
2. checks the cell budget, `EXPORT_CELL_BUDGET` (initially 5,000,000 cells, tuned from a measured build in PR5);
3. decides whether the Matrix fits;
4. builds the file and names it.

Domain errors (`EmptyExportError`, `ExportTooLargeError`) behave as follows:
- On the sync path they map to 422.
- On the async path the task fails without retry, and the existing status `error` field carries a message that starts with a stable code (`EXPORT_TOO_LARGE: …`). There is no status schema change.

| File | Change |
| --- | --- |
| `exports/values.py` | **new**, about 170 LOC: `ExportValue`, `to_export_value`, `canonical_key`, the label chain, plus `peel_envelope` moved from `value_envelope.py` |
| `exports/value_envelope.py` | **deleted**. Importers repointed: `mcp_value_render.py`, `extraction_export_service.py` (`resolve_value`), `matrix.py` and `ai_metadata.py` (`format_export_scalar`), their tests, and the `.mypy_baseline` entry |
| `exports/descriptors.py` | `level_of`, `value_key`, depth-first order, the skip rule, `record_label` |
| `exports/extraction_scope_marking.py` | each slot uses its own classifier; stamp only empty cells; set `out_of_scope` |
| `derived_judgment_service.py` | takes raw envelopes; delete `_LABEL_TO_ABSENT_REASON` |
| `extraction/tidy_tables.py` → `level_tables.py` | renders level sheets with a shape-aware key-column set |
| `extraction/data_sheet.py` | **new**, about 150 LOC: Data rows, `origin_of`, `LINEAGE_EXACT_SINCE` |
| `extraction/verification.py` | **new**, about 80 LOC |
| `extraction/ai_metadata.py` | becomes the AI proposals sheet: keys and generation columns, outcome column removed, `source=ai` union loader |
| `extraction/data_dictionary.py` → `codebook.py` | Codebook and Options; delete `dropdown_lists.py` |
| `extraction/front_matter.py`, `summary.py` | contents from the title pre-pass, AI-tools table, omitted-articles list, reading snippet |
| `extraction/matrix.py`, `appraisal_summary.py` | use display values; rank by label |
| `extraction/workbook.py`, `sheet_spec.py` | title pre-pass with `safe_sheet_title`; writer hygiene; Matrix include-or-omit. Delete `_assert_within_column_limit`, `ExportColumnLimitError` and `_unique_title` |
| `extraction_export_service.py` | reviewer and consensus loaders return `CellRecord`; merge the duplicated consensus query; add doi/pmid to `ArticleDescriptor` and `_load_article_headers`; project label and pseudonym map. Delete `ExportNotes`, `FieldDictEntry`, `_tidy_value`, `_build_tidy_tables`, `TidyRow`, `TidyTable`, `_tidy_row`, the heuristic and the hand-built contents. Stay under its file-size cap |
| `run_lifecycle_service.py` | export the frozen `APPROVE_ALL_RATIONALE` |
| `schemas/extraction_export.py` | the `article_ids` validator; description text |
| `main.py:170`, endpoint, task | expose `Content-Disposition`; delete the per-route header; call `authorize_export` before the split; async key `exports/extraction/{user_id}/{task_id}/{filename}` |
| frontend | regenerated API types; copy relabel; E2E selectors; the PR2 write path |

**Estimate:** about +850 / −1,200 LOC. The export package shrinks.

## 9. Migration impact (PR1–PR6)

- **No DDL, no data migration.** PR1–PR6 make no change to the seed, the global catalogue or project template copies. PR8 (§10) changes the seed and catalogue by design. The write-path fix only appends decision rows that the schema already allows.
- **API.** Wire values and field names are kept. Visible behaviour changes:
  - a foreign or missing article id returns 404 on both paths, instead of a silent `no_run` count;
  - a dictionary export accepts an empty `article_ids`;
  - an async build that is too large fails with `EXPORT_TOO_LARGE`.

  The API types are regenerated because description text changes.
- **Celery** task kwargs are unchanged and pinned by a test.

## 10. Template next version (CHARMS + Multimodal v2), optional PR8

v2 is for new projects only. The export needs **no code** for it: the new fields are ordinary fields, and the dataset label is the key field's own column.

1. **Split first.** Move the v1 spec (`seed.py:2084-3166`) out into files of 800 lines or fewer, for example study-level and model-level sections, exposing `charms_mm_spec(ids, key_fields)`.
   - A golden test shows the v1 rows are identical before and after.
   - Run `check_file_size --update-baseline backend/app/seed.py`.
2. **v2** lives in `seed_charms_mm_v2.py`: the v1 spec plus a delta.
   - Ids are uuid5 over the v1 ids, with a fixed template UUID.
   - Its LLM instruction and its `retired` entry land together.
3. **Keys.** `_apply_entity_keys` takes the key set as a parameter. The v1 `ENTITY_KEY_FIELDS` and its test are untouched.
4. **Fields.**
   - `pnum_dataset_label` becomes the key; `pnum_validation_type` becomes a plain field.
   - New fields: `pnum_oe_ratio` with its CI, `pnum_expected_events`, `pnum_derived_measures`.
   - Options are declared as `{value, label}`.
5. **Existing projects** stay on v1.
6. **Export dialog.** Switching a project to v2 deactivates v1, so the dialog lists inactive templates that have runs.

## 11. PR phasing (each PR opens with a test that fails today)

| PR | Scope | Failing test first |
| --- | --- | --- |
| 1 Delivery and safety | `run.py` (`authorize_export`, `build_export`), CORS, async filename and key, async empty check, Matrix include-or-omit, `safe_sheet_title` with title pre-pass, writer hygiene, dictionary validator and endpoint exemption, Celery kwargs pin | An `Origin` request exposes `content-disposition`; a foreign article id → 404 on an **async** request, and its title appears nowhere; a foreign template → 404 on an async request; `"=> see table 2"` reads back intact and `"a\x0cb"` reads back `"ab"` via `pd.read_excel`; a Matrix over the limit → 200 without a Matrix, and a dictionary export is never refused for Matrix width; dictionary with `[]` → 200; a section **named** `history` or `data` gets a suffixed title in `shape=complete` |
| 2 Write path | `writeValue` (`:239`): send `history.at(-1)?.proposal_record_id` when the draft is non-null and that proposal is `source=ai` (looked up in the run's proposals). Un-accept (`:290-296`) and undo (`:339`) carry the predecessor's link (`LocalDecision.predecessorLink`, filled in `record()`). Fix the stale comment in `useAutoSaveProposals.ts:72-75` | Vitest: a typed edit over an accepted AI value sends its id in exactly one write; accept, clear, then type → `null`; undo of a typed edit made over an accepted AI value restores the AI link; accept p1, accept p2, un-accept → p1's link |
| 3 Values and rule inputs | `values.py`; delete `value_envelope.py`; raw envelopes into rules and appraisal; scope fix | 7394 with "participants" → `value_num=7394` and `unit="participants"`; code ≠ label shows the label; L/H/U ranking; a `development_only` scope rule still stamps an empty cell and keeps a recorded answer with `out_of_scope=True` on the `ExportValue`. Parity tests are rewritten to feed raw envelopes to the screen path and the workbook path, including the `value_map=` call sites in tests |
| 4 Levels, identity, Codebook | level sheets with shape-aware key columns, `record_label`, Codebook, Options, README status counts, Summary | Five fixtures (CHARMS, CHARMS+MM, PROBAST+AI, a 30-section flat template, nested MANY under a fieldless MANY) give the exact sheet set, unique `(record_id, rater)` rows and every parent resolving; every non-blank Codebook `sheet` is in `wb.sheetnames`; a removed section's fields have a blank `sheet`; no UUID pattern in Publication; two "Smith 2020" articles keep their suffixes after a third is imported; a renamed option gives one Options row; a custom QA template with other labels → no Appraisal, plus the note |
| 5 Data, Verification, provenance | `data_sheet.py`, `verification.py`, AI proposals sheet, cell budget, label and pseudonym map, README origin counts | Linked equal → `ai_accepted`; legacy `accept_proposal` → `ai_accepted`, `answered`; linked different → `ai_edited`; unlinked with an AI proposal → `human`, `ai_proposed=true`; run pinned to v1 with options changed in v2 → still `ai_accepted`; A filled and B blank → `incomplete`; approve-all with agreeing origins → `no_conflict`, and with differing origins → `mixed`; a typed override → `override`; `select_existing` takes the selected decision's origin; reject vs clear; one `rater=consensus` row per coordinate in all_users; two reviewers with the same name get distinct `rater`; a removed-field value is present in Data, and a field missing from the pinned version gives no row; a cross-run AI proposal appears in the AI sheet with its keys; a pre-0075 proposal names its model; an oversized build → 422 sync, `EXPORT_TOO_LARGE` async |
| 6 Publication | display cells, NI/NA/NE, UI relabel, E2E selectors | NI/NA/NE appear only in Publication; an adjudicator gets a Member letter; `"None"` and `"N/A"` codes read back intact with the README pandas snippet |
| 7 (optional) | write `reject` as a decision | An AI re-run skips a rejected field |
| 8 (optional) | spec split, then v2 (§10) | The v1 golden test is equal; v2 has one key on `numeric_performance` |

PR2 ships early: every day without it adds unlinked data.

## 12. Decisions

**Ruled by the owner (2026-10-30):**
- no migration;
- template changes only as a next version;
- template-agnostic;
- zip deferred;
- simple provenance.

**Defaults that stand unless overruled:**
1. **Writing `reject` as a decision (PR7): not now.** It changes live review and AI re-run behaviour (`useReviewerSummary.ts:74-75`, `_pipeline.py:53-56`).
2. **v2 is for new projects only.**
3. **"Overall (worst domain)" appears only in the Review workbook.**
4. **The root sheet is named "Articles".**
5. **Field codes in the Review workbook, labels in Publication.**
6. **Verification stays manager-only.**

## 13. Deferred and unverified

**Deferred:**
- the zip, with datapackage and hashes;
- Cohen's kappa;
- one column per multiselect option;
- decimal formatting and composed "estimate (CI)" cells;
- separating unrelated root groups in the Matrix;
- a valmeta column mapping;
- RFC 5987 filenames;
- cleanup of stored export files;
- streaming output;
- tracing a reopened run's ancestry;
- appraisal rows for nested domains;
- a configurable appraisal vocabulary.

**Verified in PR4:**
- `section.name` is NOT unique within a template: no unique index or CHECK on it, `create_section` does no name check, and the name is immutable after create. Pinned by `test_two_sections_in_one_template_may_share_a_name`; §5 rule 3 applies D1.
- A restored field gets its old id back (`template_versioning/_restore.py`), pinned by `test_draft_deleted_field_is_recreated`; rule 7's "moved fields keep their `field_id`" holds.

**Unverified (each is checked in the PR that needs it):**
- the cost of the provenance join and the cell-budget value (PR5).

## 14. Review log

The first draft went through an adversarial builder check with three lenses: builder readiness, code claims, and simplicity and flexibility. It raised 56 findings, 0 refuted. Every serious finding was confirmed by a refuter. All are folded in above. The main changes:

- `run_export` was split, so 404s are real on the async path.
- The consensus loader is specified.
- `rater=consensus` is defined.
- `record_key`, `not_in_version`, `carried_over`, the shared-unit rule, `ai_value` in Data, `value_envelope.py` and the dead column guard were cut.
- The PR2 rule is moved to the head link of `source=ai` only, with red-first tests.
- Canonicalization is pinned to the run's version.
- The pandas reading contract is corrected.
- PR test ordering is fixed.
