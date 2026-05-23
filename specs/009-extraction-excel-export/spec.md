# Feature Specification: Extraction Excel Export

**Feature Branch**: `009-extraction-excel-export`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description: "na página Data Extraction, precisamos fazer uma aba de download de excel dos dados extraidos do template usado no projeto. Deve ser flexivel para aceitar os diferentes templates. Por exemplo, no caso do CHARMS (podendo ter sido alterado com campos adicionados ou alterados ou retirados, por exemplo), temos um excel exemplo, mostrando que deve ser extraido em um formato que os campos ficam na primeira coluna. No caso de ter secoes, fica como uma linha e as variaveis dessa secao abixo dessa linha. As colunas ficam com cada artigo sendo uma coluna e se tiver a secao multiple section, como de um modelo de machine learning no caso do CHARMS por exemplo, deve aparecer uma coluna por cada secao de multipla secao do mesmo artigo. Importante ter a opcao de exportar a resposta do usuario ou dos usuarios ou o consenso (default)."

## Clarifications

### Session 2026-05-22

- Q: In Consensus mode, should non-finalized articles appear as blank columns or be excluded? → A: Exclude non-finalized articles entirely; note the skipped count in the Notes sheet.
- Q: Should the user be able to filter the articles before export? → A: Yes — mirror the Articles-page Export dialog UX (`Current list (N)` vs `Selected only (M)` radio group); the broader Data Extraction Export UI MUST adopt the same dialog pattern used on the Articles page (button-triggered modal with grouped option sections) to keep cross-page UX consistent. Evaluate modern UX improvements on top of that baseline.
- Q: In multi-instance (model_container) layouts, should study-section field values be merged or repeated across the article's model sub-columns? → A: Repeat the value identically in every model sub-column so each row remains a complete record (Excel filter/sort/pivot work without manual intervention).
- Q: In "All users" mode, should reviewer columns default to real names or anonymized labels? → A: Default to real names; provide an "Anonymize reviewer names" toggle in the dialog (audit-logged when flipped) for external-sharing scenarios.
- Q: Should AI proposals be exposed in the export, and if so, how? → A: Add an **optional** "AI metadata" sheet to the workbook (toggled by an "Include AI metadata" checkbox in the dialog, default off). The main sheet keeps the three source modes (Consensus / Single user / All users) unchanged. The AI metadata sheet lists every AI proposal with value, confidence, rationale, evidence, and best-effort reviewer outcome — separating "what the AI thought" from "what was actually used" so the two perspectives can coexist without contaminating each other. Available to any project member who can already see AI suggestions in the extraction UI (no role gate).

## Background — extraction data scenarios

This feature operates on top of Prumo's extraction-HITL stack (see
`docs/architecture/extraction-hitl-architecture.md`). Before defining
the user-facing behaviour, the scenarios below are catalogued so the
specification can be evaluated against real data shapes.

### Per-template scenarios (what the template can look like)

| Scenario | Description | Implication for export |
|---|---|---|
| **Stock global template (e.g. CHARMS as seeded)** | Project imported a global template unchanged. | Section/field layout is well-known but cannot be hard-coded; export reads the project's active **TemplateVersion snapshot**. |
| **Customised template** | Manager added/edited/removed fields or sections after import. | The active TemplateVersion at the time of each Run differs from the stock template. Export must follow the snapshot frozen on each Run, not the live template. |
| **Bespoke template** | Manager created a template from scratch (no global parent), with arbitrary sections and fields. | Same as customised: drive the layout from the snapshot, not from any framework-specific assumption. |
| **Template with a multi-instance section (`model_container` + `model_section` role)** | E.g. CHARMS's "Prediction Models" group, where each article can have N models. | Article occupies a variable number of spreadsheet columns (one per model instance); model_section fields are filled per model. |
| **Template without a multi-instance section** | E.g. PROBAST, QUADAS-2, or a CHARMS clone with `prediction_models` removed. | Every article occupies exactly one spreadsheet column. |
| **Template edited mid-project** | Manager activates a new version after some Runs have already finalised on the previous version. | Older Runs reference the older version snapshot; newer Runs reference the new one. Export uses each Run's snapshot. The exported sheet uses the **currently active** template version as the column-layout anchor; values from Runs on older versions populate fields that still exist by `field_id`; obsolete fields are reported in a "Notes" sheet rather than silently dropped. |

### Per-article scenarios (what state an article can be in)

| Run stage | What exists in the database | Consensus value (`extraction_published_states`) | Per-user value (`extraction_reviewer_states.current_decision_id`) |
|---|---|---|---|
| **No Run yet** | Nothing | Empty | Empty |
| **`pending`** | Run row exists | Empty | Empty |
| **`proposal`** | ProposalRecords being created (AI or human) | Empty | Empty (reviewer decisions only enter from `review`) |
| **`review`** | Reviewers have started deciding | Empty | Latest non-reject ReviewerDecision per (instance, field, reviewer) |
| **`consensus`** | Reviewers diverged → arbitrator pending | Empty | Same as review |
| **`finalized`** | PublishedState rows materialised | The canonical value | The reviewer's last decision (which produced the consensus) |
| **`cancelled`** | Terminal | Empty | Treated as if no Run for export purposes |

### Per-export-mode scenarios (what the user wants to see)

| Mode | Source of values | Auth scope | Default? |
|---|---|---|---|
| **Consensus** | `extraction_published_states` per `(run, instance, field)` | Any project member | Default |
| **Single user** | Latest non-reject `extraction_reviewer_decisions` per `(run, reviewer, instance, field)` for one selected reviewer | Self always allowed; other reviewers require manager role (or RLS-allowed read) | No |
| **All users (side-by-side)** | One sub-column per reviewer, value as in "Single user" | Manager only | No |

### Per-cell scenarios (what a single cell can be)

| Field type | Stored shape | Export representation |
|---|---|---|
| `text` / `number` / `date` | Scalar | The scalar |
| `select` | Enum string | Display label of the selected option |
| `multiselect` | Array of enum strings | Display labels joined with `; ` |
| `boolean` | True/false | Yes / No (in project locale; default English) |
| Reviewer decision is `reject` | The reviewer explicitly rejected | Blank cell (semantically: "no value from this reviewer") |
| No proposal exists | Nothing recorded | Blank cell |
| Value is the literal string `"No information"` | Author-entered text | Exported as-is (this is what the reference CHARMS sheet does) |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Export consensus values for the whole project (Priority: P1)

A reviewer or manager has finished extracting data for several articles
in a systematic review using the project's CHARMS (or other) template.
They click the **Export** button in the Data Extraction page top bar, the
Export dialog opens with "Consensus" as the default source and
"Current list" preselected as the article scope, and they confirm to
download a single `.xlsx` file. The spreadsheet matches the structure
the team is used to from manual CHARMS extractions: sections grouped
as title rows, fields listed in the first column, one article per
column, model-level fields fanning out into multiple columns when an
article has more than one model.

**Why this priority**: This is the canonical "I'm writing my
systematic-review paper and I need my data" use case. It must work for
the default template (CHARMS) and any customised or bespoke template,
or the project's extraction work is not usable outside the app.

**Independent Test**: With a project containing one finalised Run on a
CHARMS-like template, clicking the Export button, accepting the
defaults, and confirming produces an `.xlsx` whose CHARMS sheet
matches the column-per-article + section-as-row layout from the
reference workbook `12874_2023_1849_MOESM2_ESM.xlsx`.

**Acceptance Scenarios**:

1. **Given** a project with the stock CHARMS template and 3 articles, all in `finalized`, none with multiple models, **When** the user opens the Export dialog and confirms with defaults, **Then** the spreadsheet has one column per article, sections appear as header rows, and every PublishedState value is in the correct cell.
2. **Given** an article with 2 model instances under `prediction_models`, **When** the user confirms the export, **Then** that article occupies 2 adjacent data columns sharing one merged article header; study-section field values are **repeated** identically in both sub-columns (not merged); model_section field values differ per sub-column.
3. **Given** the manager customised the template (removed two fields, added one), **When** the user confirms the export, **Then** the removed fields do not appear, the new field appears in the right section, and rows already finalised on the previous version still populate the fields that survived the edit.
4. **Given** a project with no finalised Runs, **When** the user opens the Export dialog with "Consensus" selected, **Then** the dialog shows an inline empty state ("No finalized data to export yet") and the `Export` button is disabled.
5. **Given** the user has 4 of 10 articles ticked in the Article-Extraction table, **When** they open the Export dialog, **Then** "Articles to export" defaults to `Selected only (4)` and the live preview line reflects the 4-article slice.
6. **Given** a project where the AI extracted values that were later accepted, edited, and rejected across different articles, **When** the user ticks "Include AI metadata sheet" and confirms the export, **Then** the workbook contains both the main sheet (Consensus values) and a flat `AI metadata` sheet with one row per AI proposal, each row carrying value / confidence / rationale / evidence / inferred reviewer outcome / final used value.
7. **Given** the same project but **no AI extraction was ever run**, **When** the user ticks "Include AI metadata sheet" and confirms, **Then** the `AI metadata` sheet is still added with the standard headers and a single placeholder row "(No AI proposals recorded for the selected articles.)".

---

### User Story 2 — Export a single reviewer's own work-in-progress (Priority: P2)

A reviewer wants to see their own decisions outside the app, including
articles still in `review` (not yet finalised). They click the **Export**
button, switch the source-of-values radio to "Single user" (the
reviewer picker auto-fills with their name), and confirm. The result
mirrors the consensus layout but the values come from that reviewer's
latest non-reject decisions; cells without a decision are blank.

**Why this priority**: Reviewers commonly audit their own extractions
in Excel before consensus. Allows progress checking without waiting
for finalisation.

**Independent Test**: With a project where the current user has made
decisions on 2 articles still in `review`, switching to "Single user"
mode and downloading produces an `.xlsx` containing those values.

**Acceptance Scenarios**:

1. **Given** the current user has reviewer decisions on 2 articles in `review`, **When** they download in "Single user → Me" mode, **Then** the spreadsheet has 2 article columns and the user's latest non-reject decision per field.
2. **Given** the current user is a project manager and selects another reviewer from a dropdown, **When** they download, **Then** the spreadsheet contains that reviewer's latest non-reject decisions.
3. **Given** the current user is **not** a manager and has the "Single user" mode selected, **When** they look at the reviewer picker, **Then** only their own name is shown (the picker is effectively read-only).
4. **Given** a reviewer rejected a field on an article, **When** the user downloads in "Single user" mode targeting that reviewer, **Then** that cell is blank (rejection is not exported as text).

---

### User Story 3 — Export all reviewers side-by-side for audit (Priority: P3)

A project manager preparing a quality-audit or a divergence analysis
selects "All users" mode. Each article column splits into one
sub-column per reviewer (Reviewer A, Reviewer B, …) so disagreements
are visible at a glance. The first sub-column under each article
header is the **consensus** column (so consensus and reviewer values
sit next to each other), followed by one sub-column per reviewer who
participated.

**Why this priority**: Useful but lower frequency — managers run this
when they need to discuss disagreements. P1/P2 cover daily use.

**Independent Test**: With a project where 2 reviewers reviewed the
same article and a consensus was recorded, switching to "All users"
mode and downloading produces an `.xlsx` where the article header
spans 3 sub-columns (Consensus, Reviewer A, Reviewer B) for every
field.

**Acceptance Scenarios**:

1. **Given** an article with consensus + 2 reviewers, **When** the manager downloads in "All users" mode, **Then** the article column splits into 3 sub-columns labelled "Consensus", "Reviewer A", "Reviewer B".
2. **Given** an article with consensus + 2 reviewers + 2 model instances, **When** the manager downloads, **Then** the article occupies 2 × 3 = 6 sub-columns (2 model sub-columns × 3 reviewer/consensus sub-columns), in a stable, documented order (Model 1 / Consensus → Model 1 / Reviewer A → Model 1 / Reviewer B → Model 2 / Consensus → …).
3. **Given** a non-manager opens the Export dialog, **When** they look at the source-of-values radio, **Then** "All users" is disabled with a tooltip explaining the permission requirement.

---

### Edge Cases

- **Run on an older template version**: Article was finalised before a manager added a new field. The new field's row exists in the layout but the article's column is blank for that row; this is documented in the "Notes" sheet as "Field X not present in template version vN used for this Run".
- **Article has the `model_container` entity type but zero model instances**: Article occupies a single column; model_section field rows are blank for that article.
- **Article with extreme model count** (e.g. 10 models): All 10 model sub-columns are emitted; no truncation. UI warns the user if total column count > 200.
- **Project with 0 articles or 0 Runs**: The Export button on the page top bar is disabled with a tooltip ("No data to export — start an extraction first") rather than opening an empty dialog.
- **Reviewer leaves the project mid-extraction**: Their past decisions remain (append-only tables). They still appear in "All users" mode by display name captured at decision time.
- **Concurrent finalization while downloading**: The export captures a consistent snapshot — values are read inside a single read transaction; new finalizations during the export are not retro-actively included.
- **Very large project** (e.g. 200 articles × 50 fields × consensus): Build must remain responsive — see SC-002 below. Export runs server-side and the client receives a downloadable file or a signed URL.
- **Field type `multiselect` with comma-containing labels**: Joined with `; ` (semicolon-space) to disambiguate from a comma-bearing label.
- **Project locale**: Section/field labels appear in the template's stored language; "Yes/No" for booleans and the "Consensus" / "Reviewer N" sub-column labels follow the application's UI locale.
- **Reviewer-name display in "All users" mode**: Reviewer columns show real names by default. The dialog exposes an "Anonymize reviewer names" toggle (manager-controlled, audit-logged) that replaces real names with stable "Reviewer A" / "Reviewer B" / … labels in the exported file — useful when sharing externally (co-authors, OSF supplementary material).

## Requirements *(mandatory)*

### Functional Requirements

#### Discovery & access

- **FR-001**: The Data Extraction page MUST expose a top-bar action button labelled "Export" (with the standard download icon), placed analogously to the Articles page's "Export" button so users find it in the same visual location across the app. Clicking it MUST open an **Export dialog modal**, not navigate to a separate tab.
- **FR-002**: The Export dialog MUST mirror the section/widget structure of the Articles-page Export dialog:
  1. **Source of values** (radio group): `Consensus (default)` / `Single user` / `All users`. When `Single user` is chosen, a reviewer-picker control appears below the radio group (defaulted to the current user).
  2. **Articles to export** (radio group, mirroring the Articles dialog): `Current list (N)` (all articles currently visible / matching active filters on the Data Extraction page) and `Selected only (M)` (articles ticked via the checkbox column in the Article-Extraction table). Both labels MUST show live counts; `Selected only` is disabled when M = 0.
  3. **Additional content** (checkbox group, off by default): `Include AI metadata sheet` — adds a secondary sheet to the workbook listing every AI proposal with value, confidence, rationale, evidence, and inferred reviewer outcome (see FR-036–FR-040). The checkbox is independent of the source-of-values radio; it can be enabled in any of the three modes.
  4. **Footer actions**: `Cancel` and `Export` (primary). The dialog title is "Export extraction data" with a one-line subtitle "Export extracted data from the active template as an Excel workbook (.xlsx)."
- **FR-003**: Any authenticated project member MUST be able to open the Export dialog and trigger an export in **Consensus** mode and **Single user → Me** mode.
- **FR-004**: Only project members with manager role MUST be able to (a) select a reviewer other than themselves in "Single user" mode, and (b) use "All users" mode. The radio options the current user cannot use MUST be disabled with a tooltip explaining the permission requirement (no silent hiding — keep the UI consistent for all roles).
- **FR-005**: The `Export` button MUST be disabled with an inline reason when there is no exportable data for the selected configuration (e.g. Consensus mode with zero finalized Runs; Single-user mode targeting a reviewer with no non-reject decisions). Switching the mode MUST re-enable the button when its source has data.
- **FR-006**: The Export dialog MUST adopt the project's standard modal behaviours: focus trapped within the dialog, `Esc` to cancel, `Cmd/Ctrl + Enter` to confirm, focus restored to the trigger button on close (delivered by the existing Radix Dialog primitive — no bespoke handling).

#### Format & layout

- **FR-007**: The exported file MUST be a Microsoft Excel workbook (`.xlsx`) containing, in tab order:
  1. The **main sheet**, named after the active project template (e.g. `CHARMS`, `PROBAST`, or the manager's custom name) — the column-per-article layout from FR-008–FR-012.
  2. An optional **`AI metadata` sheet** (present only when the user ticked "Include AI metadata sheet" in the dialog — FR-002 §3) — content shape in FR-036–FR-040.
  3. A **`Notes` sheet** (always present) documenting data caveats: older-version Runs, omitted obsolete fields, export mode, timestamp, count of articles skipped by Run stage, and the AI-metadata toggle state.
- **FR-008**: The main sheet MUST follow this column layout, derived from the active project template's currently active TemplateVersion snapshot:
  - Column A: field section header (e.g. `1. Source of data`) on section rows, blank on field rows.
  - Column B: field label (e.g. `1.1 Source of data`); for the multi-value pattern (e.g. CHARMS `2.8 Participant description` with characteristic + value + measure sub-rows), one row per sub-field.
  - Columns C+: one column per article in Consensus / Single-user mode; one column per `(article, model_instance, reviewer-or-consensus)` cell in All-users mode (see FR-011).
- **FR-009**: Section names MUST appear as their own row spanning all article columns, with a visually distinct format (bold + light background fill). Field rows follow underneath in the order defined by the template snapshot.
- **FR-010**: For a template that has a multi-instance section (entity role `model_container` with child `model_section`s), an article with N model instances MUST occupy exactly N columns under the article header. Study-level fields (entity role `study_section`) MUST be **repeated identically** in every one of the N sub-columns — never merged via Excel `mergedCells` — so each row stays a complete record that downstream Excel operations (filter / sort / pivot) handle correctly without the user having to unmerge cells. The visual article header (article identifier in the top header row) MAY still be `mergedCells`-merged across the N sub-columns, because it is metadata, not analytical data. An article with 0 model instances occupies 1 column.
- **FR-011**: In **All users** mode, each article-model sub-column from FR-010 MUST further split into one sub-column per data source in this exact order: `Consensus`, `Reviewer 1`, `Reviewer 2`, ..., `Reviewer N`, where N is the number of reviewers who recorded at least one non-reject decision on that Run. Reviewer sub-columns MUST be ordered stably and consistently across all articles: alphabetical by reviewer display name (default), or by reviewer id when the "Anonymize reviewer names" toggle is on (so the sort order does not leak the underlying names by being byte-by-byte stable across exports).
- **FR-012**: Article column headers MUST contain a human-readable identifier derived from the article's metadata (preferred order: `First-author surname, year` from extracted study-info fields if present and finalized, else `article.title` truncated to 60 chars, else `article.id` short form). When an article occupies more than one sub-column, the header MUST be merged across all of them.

#### Data selection

- **FR-013**: In **Consensus** mode, cell values MUST come from `extraction_published_states` for Runs in stage `finalized`. Articles whose Run on the active template is **not** in `finalized` stage (i.e. `pending` / `proposal` / `review` / `consensus` / `cancelled`, or no Run yet) MUST be **omitted from the spreadsheet entirely** — they do not appear as columns. The Notes sheet MUST record the count of omitted articles grouped by current Run stage (e.g. "4 in review, 1 cancelled, 2 with no Run yet") so the user knows what was skipped and why.
- **FR-014**: In **Single user** mode, cell values MUST come from the latest non-reject `extraction_reviewer_decisions` per `(run, reviewer, instance, field)` for the selected reviewer, resolved via `extraction_reviewer_states.current_decision_id`. `reject` decisions MUST produce blank cells.
- **FR-015**: In **All users** mode, the `Consensus` sub-column MUST follow FR-013 and each `Reviewer N` sub-column MUST follow FR-014 for that reviewer.
- **FR-016**: The export MUST honour the active project template selection at the time of export — i.e. only data from Runs whose `template_id` matches the currently active project template; other templates are ignored.
- **FR-017**: For each Run, the column layout MUST follow the template's currently active TemplateVersion. When a Run was finalized on a previous version, surviving fields (matched by `field_id`) are filled; obsolete fields are listed in the Notes sheet under that article.
- **FR-018**: The "Articles to export" selector defines the universe of candidate articles. `Current list` resolves to the articles visible on the Data Extraction page given the user's current filters/search; when the Data Extraction page has no filter/search bar (V1 state — the page renders all project articles for the template), `Current list` simply equals **all project articles assigned to the active template**. `Selected only` resolves to articles whose checkbox is ticked in the Article-Extraction table. The selected universe is THEN intersected with the mode's stage-eligibility rule (FR-013 / FR-014 / FR-015). If the intersection is empty, the Export button is disabled with the inline reason.

#### Value formatting

- **FR-019**: Field values MUST be formatted by type: `text/number/date` as-is; `select` as the display label; `multiselect` as labels joined with `"; "`; `boolean` as `Yes`/`No` (localised to the UI language).
- **FR-020**: When a multi-value field is implemented as multiple sub-fields (e.g. CHARMS 2.8 Participants — Characteristic / Values / Measures), each sub-field MUST occupy its own row in column B with a 3-level numbering scheme inherited from the template (e.g. `2.8.1 Age of participants`).
- **FR-021**: Evidence (PDF page citations, position, snippets) MUST NOT be embedded in the main sheet. (V1 scope: out of scope. May be added in a v2 as a third "Evidence" sheet.)

#### Generation & delivery

- **FR-022**: Generation MUST happen server-side, reading from the database with project-membership authorisation. The endpoint chooses between sync inline delivery and async background delivery using **article count** as the primary input — `≤ 50 articles AND mode ∈ {consensus, single_user} AND include_ai_metadata = false` → sync inline `.xlsx` bytes; otherwise → async Celery job + signed Storage URL. The threshold is chosen so the sync path comfortably fits within 5 MB / 10 s for representative payload shapes (research.md §3). The async pattern mirrors `articles_export_service.run_export_async`.
- **FR-023**: When the export runs in async mode, the dialog MUST close after the job is dispatched and the result MUST be delivered through the in-app notification center / toast ("Your extraction export is ready — Download" with a link). The notification entry MUST be **persistent** (the in-app notification center keeps it until the user clicks it) and the embedded signed URL remains valid for the full TTL window, so the user can navigate away from the Data Extraction page and return later without losing the link. This mirrors the existing async export pattern used for articles and keeps the user unblocked.
- **FR-024**: The downloaded filename MUST follow the pattern `{project_name}_{template_name}_{mode}_{YYYYMMDD-HHMMSS}.xlsx`, sanitised for filesystem-safe characters.
- **FR-025**: The export operation MUST be logged via the project's structured logging pipeline (structlog) under logger name `app.audit.extraction_export` with: actor, project_id, mode, target reviewer (if applicable), template_id, article count, generated_at, the "Anonymize reviewer names" toggle state (default: off / names visible), the "Include AI metadata sheet" toggle state (default: off), the chosen article-scope (`Current list` vs `Selected only` with the count), and the request `trace_id`. There is **no dedicated database audit table** in V1 — persistent audit storage is downstream of the log pipeline (the same approach used by every other export and extraction event in the codebase today).
- **FR-026**: Triggering an export MUST be idempotent from the user's perspective — running it twice produces equivalent files (modulo timestamp). No database state changes as a side effect of the export.

#### UI affordances

- **FR-027**: Inside the Export dialog, a **live preview line** below the action buttons MUST summarise what will be exported, updating reactively as the user toggles controls. Example: `Will export 16 articles × 47 fields (1 multi-instance section, avg 1.4 models/article) → ~110 KB, inline download`. The line MUST also show the final filename, with the timestamp displayed in the user's local timezone. **Rationale**: this recap is the strongest defence against "I downloaded the wrong slice" errors — the user sees a verifiable summary of mode, scope, AI-metadata, and reviewer choice before committing, which the current Articles-page Export dialog does not provide.
- **FR-028**: When the source-of-values radio is set to "Single user", the reviewer picker MUST default to the current user. For managers, the picker MUST be an alphabetised dropdown of reviewers who have at least one non-reject decision on this template's Runs (no empty entries). The "Anonymize reviewer names" toggle (FR-011 reviewer ordering / privacy) is co-located in the dialog and visible only in "All users" mode, defaulting to **off** (names visible) with a helper sentence under it: "Replace reviewer names with Reviewer A / B / … in the exported file. Useful when sharing the file outside your team."
- **FR-029**: When the user has articles ticked in the Article-Extraction table at the moment they open the Export dialog, the "Articles to export" radio MUST default to `Selected only ({count})`; otherwise it MUST default to `Current list ({count})`. This honours pre-existing context the user already established, mirroring the Articles-page Export dialog behaviour.
- **FR-030**: While the file is being generated synchronously (small payload), the `Export` button MUST show an inline spinner with the label "Generating…" and the dialog controls MUST be disabled to prevent duplicate submissions. The client MUST surface a cancel option (Esc, "Cancel" button) that aborts the request; server-side cancellation is best-effort.
- **FR-031**: On failure (network, server, permission), the UI MUST surface a human-readable error from the API envelope's `error.message` (not the HTTP `detail` field) inline inside the dialog (not as a navigated-away page) and offer a retry button. Errors MUST be logged client-side via the existing logger.

#### Modern UX improvements (informed by user request to evaluate against modern patterns)

These build on the Articles-Export dialog baseline; each is in V1 scope unless flagged. Note: the previously-listed FR-032 (live-preview recap) and FR-033 (persistent async notifications) were merged into FR-027 and FR-023 respectively after the duplication audit — the canonical requirements are now in those locations, and the FR-032 / FR-033 identifiers are intentionally retired (no renumbering) to keep cross-references stable.

- **FR-034 (V2)**: A "Recent exports" section (last 5 exports per project per user) with a one-click "Re-export with same settings" action. Out of V1 scope but explicitly named here so V1 implementation does not paint into a corner (audit-trail rows from FR-025 already provide the data for this).
- **FR-035 (V1)**: The dialog MUST be fully usable from the keyboard alone (focus order: source-of-values → reviewer-picker (when visible) → articles-to-export → anonymize-names toggle (when visible) → include-AI-metadata toggle → Cancel → Export); screen-reader labels MUST be present on every control (delivered by the existing shadcn/Radix primitives — no bespoke handling). This raises the baseline above the current Articles dialog, which has minor focus-order issues to also fix as a follow-up.

#### AI metadata sheet (optional — included only when toggled in the dialog)

- **FR-036**: When the user enables "Include AI metadata sheet", the workbook MUST contain a sheet named `AI metadata`, placed in tab order between the main sheet and the `Notes` sheet. The sheet is **flat-tabular**, not column-per-article — one row per AI proposal record. This shape is easier to filter/pivot in Excel and avoids polluting the main sheet's column structure.
- **FR-037**: The `AI metadata` sheet MUST have exactly the following columns, in order:
  1. `Article` — human-readable article identifier (same derivation as FR-012).
  2. `Section` — entity_type label from the template snapshot (e.g. `2. Participants`).
  3. `Instance #` — `1` for cardinality=one entities; `1..N` for model_section instances (matching the order used in the main sheet).
  4. `Field` — field label (e.g. `2.1 Recruitment method`).
  5. `AI proposed value` — `proposed_value` formatted per FR-019.
  6. `Confidence` — `confidence_score` if not null, formatted as a 0.00–1.00 decimal; blank when null.
  7. `Rationale` — `rationale` text if not null; blank when null.
  8. `Evidence text` — concatenated `text_content` from linked `extraction_evidence` rows (joined with ` | ` when multiple); blank when none.
  9. `Evidence page(s)` — concatenated `page_number` from linked evidence rows (e.g. `4, 7`); blank when none.
  10. `Proposed at` — `created_at` of the proposal in the user's local timezone.
  11. `Reviewer outcome` — one of: `accepted`, `rejected`, `edited (best-effort)`, `pending`, `superseded`, where:
      - `accepted` means a `reviewer_decision(decision='accept_proposal', proposal_record_id=<this row>)` exists.
      - `rejected` means a `reviewer_decision(decision='reject')` exists for the same `(run, instance, field)` AND the rejected decision either has `proposal_record_id=<this row>` OR (best-effort fallback) no other AI proposal is more recent for that key.
      - `edited (best-effort)` means a `reviewer_decision(decision='edit')` exists for the same `(run, instance, field)` AND no `accept_proposal` exists referencing this proposal. Marked "best-effort" because the schema currently does not store the FK back from edited decisions to the proposal they originated from.
      - `pending` means the Run is in `proposal`/`review` and no reviewer_state row exists yet for that `(run, reviewer, instance, field)`.
      - `superseded` means a newer AI proposal exists for the same `(run, instance, field)` AND this row's `created_at` is not the maximum.
  12. `Final value used` — the canonical value from `extraction_published_states` for the same `(run, instance, field)` if finalized; blank otherwise. Lets the reader compare "AI said" vs "what we used" in one glance.
- **FR-038**: The `AI metadata` sheet MUST be populated for **all AI proposals** belonging to Runs included in the export (per the article-scope intersection in FR-018) — including superseded and rejected ones — so the export is a faithful audit log, not a filtered view. The `Reviewer outcome` column lets the reader filter to "accepted only" or "rejected only" in Excel.
- **FR-039**: When **no AI proposals exist** in the export's article scope, the `AI metadata` sheet MUST still be included (when toggled) with the header row and a single body row reading `(No AI proposals recorded for the selected articles.)` in column A, all other columns blank. This is more discoverable than silently omitting the sheet.
- **FR-040**: Note about lineage fidelity — the `Reviewer outcome=edited (best-effort)` value is an inference, not a guaranteed truth, because `extraction_reviewer_decisions` does not currently carry a back-link to the AI proposal that was edited from. The `Notes` sheet MUST include a sentence: "Reviewer outcomes labelled '(best-effort)' rely on heuristics; the underlying data model does not preserve the exact AI-proposal → edited-value lineage. A future schema change (`edited_from_proposal_id` on reviewer decisions) would make these labels exact." This sets expectations for downstream audit consumers without blocking V1.

### Key Entities

- **TemplateVersion snapshot** — Immutable JSONB tree of `extraction_entity_types` + `extraction_fields` frozen on every Run at creation. Drives the column layout: section order, field order, types, allowed_values, and the entity-type **role** (`study_section` / `model_container` / `model_section`).
- **ExtractionRun** — A `(article × project_template × kind=extraction)` HITL session. Carries the version snapshot. Its `stage` determines which data sources are populated (see Background §Per-article scenarios).
- **ExtractionInstance** — Concrete realization of an entity type for one article: 1 for `cardinality=one`, N for `cardinality=many`. Drives the number of sub-columns per article in the multi-instance case.
- **ExtractionPublishedState** — Canonical post-consensus value per `(run, instance, field)`. The default ("Consensus") mode reads from here.
- **ExtractionReviewerState** + **ExtractionReviewerDecision** — Per-user latest decision pointer + the immutable decision rows. The "Single user" and "All users" modes resolve values through here. **Note for the AI metadata sheet**: `reviewer_decision(decision='edit')` rows do **not** carry a back-link to the AI proposal they originated from (`proposal_record_id` is NULL for `edit`), so the export must use heuristics to infer "edited from AI" — see FR-037.
- **ExtractionProposalRecord (source='ai')** — Append-only row written by the LLM extraction services, carrying `proposed_value`, `confidence_score`, `rationale`, and linked `ExtractionEvidence` rows. Multiple rows can exist for the same `(run, instance, field)` (AI re-runs); the latest is identified by `created_at DESC`. Surfaced only in the optional AI metadata sheet.
- **Project member roles** — `manager` / `reviewer` / `consensus`. Used to gate cross-reviewer reads in "Single user (other)" and "All users" modes. The AI metadata sheet is **not** gated by role — any project member who can already see AI suggestions in the extraction UI can include it.

### Assumptions & Dependencies *(mandatory)*

- The export reads from existing schemas only — **no database schema changes** are required for V1. (If a future iteration adds an `export_jobs` audit table, that change is in scope only for that follow-up and must use Alembic per the project's hybrid migration rule.)
- Database consistency verification is therefore reduced to read-path checks: project-membership RLS is honoured on every read, and the workflow tables are queried via existing repository methods.
- The application reuses the `articles_export` pattern for large-payload delivery (signed Storage URL via the existing `articles` bucket or a new `extraction-exports` bucket); a Supabase Storage migration is required only if a new bucket is chosen.
- Excel generation uses a Python library already permissible in `backend/` (e.g. `openpyxl` or `xlsxwriter`); the choice is a planning concern, not a spec concern.
- Section/field display labels and ordering come from the project template's snapshot; multi-language label support is not in scope for V1.
- Evidence embedding on the main sheet is out of scope for V1. (The optional AI metadata sheet, however, **does** include evidence text and page numbers — see FR-037 — because the audit context warrants it and the data model already links proposals to evidence rows.)
- Bulk re-export (multiple templates at once) is out of scope for V1; the user explicitly mentioned a single Excel of the active template.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a project with ≤ 100 articles, ≤ 80 fields, and ≤ 5 model instances per article, the user receives the `.xlsx` file within **10 seconds** of clicking the Download button (P50) and **30 seconds** at P95.
- **SC-002**: For a project with 500 articles × 100 fields × 3 average model instances (≈ 150,000 cells), generation completes within **60 seconds** at P95 and the resulting file opens in Microsoft Excel and LibreOffice Calc without warning dialogs.
- **SC-003**: At least **95 %** of exported sheets in a sample audit of 20 real projects reproduce the team's expected layout (section as row header → fields below → article columns), as validated against the reference workbook `12874_2023_1849_MOESM2_ESM.xlsx` for CHARMS projects and the manual benchmark for PROBAST/QUADAS-2.
- **SC-004**: A reviewer can locate and use the Export feature on the Data Extraction page with **zero training** — measured by ≥ 90 % task-completion rate in an internal usability test with 5 reviewers who have used the extraction flow but never opened the new Export dialog.
- **SC-005**: No project member can export another reviewer's data unless they hold the `manager` role — verified by an integration test attempting cross-reviewer "Single user" exports as `reviewer` and `consensus` roles and confirming the response is 403 with the standard `error.message` envelope.
- **SC-006**: Re-running the same export within the same project state (no DB writes between invocations) produces files that are byte-identical except for the trailing timestamp metadata and the Notes sheet's `generated_at` line — verified by automated test.
- **SC-007**: For a project where the AI extracted values on ≥ 30 % of fields, enabling "Include AI metadata sheet" adds ≤ 20 % to total generation time at P95 versus the same export without the toggle — verified by a benchmark test. Rationale: the AI metadata path is a single additional read from `extraction_proposal_records` joined to `extraction_evidence`, not a per-cell N+1.

## Assumptions

- Reviewers and managers prefer a single `.xlsx` file over CSV bundles or JSON for this use case (the user description explicitly asked for Excel; CSV/JSON remain available via the existing placeholder export but are not affected by this feature).
- The reference layout from `12874_2023_1849_MOESM2_ESM.xlsx` (and the screenshot of the CHARMS tab) is the canonical visual target. The export should match it closely but does not need to reproduce decorative elements (cell shading, borders, conditional formatting), only the structural skeleton.
- When the template snapshot's labels are non-English (e.g. translated CHARMS), labels are exported as stored; the "Notes" sheet's metadata and the boolean Yes/No labels follow the user's UI locale.
- "Single user → Me" is the most-used non-default mode; making it the primary alternative (not buried under a sub-menu) reduces friction.
- Reviewer-name privacy in "All users" mode defaults to **names visible** (manager-friendly for internal audits); the explicit "Anonymize reviewer names" toggle handles the less-common external-sharing case and is audit-logged when used.
- Multi-instance entities other than `prediction_models` (rare today, but the schema allows them) follow the same layout rule as `model_container` / `model_section`: one data column per instance, with study-section values repeated per FR-010.
- Existing extraction services (e.g. `ExtractionValueService` on the frontend, `extraction_*_service.py` on the backend) provide the read-side primitives needed; no new domain logic is required, only an export-specific composer.
- "Show reviewer names" is an explicit UI toggle, not a per-organisation setting; this avoids dependency on a global preference store for V1.
