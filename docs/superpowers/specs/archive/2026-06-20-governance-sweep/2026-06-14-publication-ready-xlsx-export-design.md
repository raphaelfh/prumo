---
status: shipped
last_reviewed: 2026-06-14
owner: '@raphaelfh'
supersedes: '009-extraction-excel-export'
---

> **Status:** Draft — design under review. Supersedes the shipped
> `009-extraction-excel-export` feature (archived).

# Publication-Ready Extraction `.xlsx` Export — Redesign

**Created:** 2026-06-14 · **Owner:** @raphaelfh

## 1. Problem

The extraction `.xlsx` export ships today (feature 009) but is "broken
and not working well." The user named three concrete failures, none of
which is a crash:

1. **Data is wrong/incomplete** — values come out mangled or missing.
2. **Format is not publishable** — a bare static skeleton; the builder's
   own comment admits it is a "structural skeleton" with styling "kept
   small." It cannot be attached to a paper as supplemental material.
3. **Confusing / duplicate UI** — two export entry points (a legacy
   "CSV / JSON / Excel" card and the newer dialog).

The **objective** is a workbook that a researcher can send, unedited, as
**supplemental material** alongside a systematic-review / prediction-model
publication — and that works for **any** project template (not just the
seeded CHARMS/PROBAST), per the project's template-flexibility promise.

This redesign is a **consolidation, not a patch**: per the project's
"clean architecture over minimal patch" principle and the explicit user
constraint, **no legacy code may remain**.

### Research provenance

The findings below were produced by a verified multi-agent
investigation (workflow `wf_2c551dd4-0a9`, 23 agents): six parallel
readers (legacy audit, reference-workbook spec, bug hunt, backend
architecture, frontend surface, template-flexibility) followed by an
**adversarial verification pass** on every claimed bug and every
legacy-removal claim. The adversarial pass refuted three plausible
"bugs" — they are recorded in §11 so we do not chase them.

## 2. Goals / Non-goals

**Goals**

- Correct, complete extracted values for every supported field shape.
- A multi-sheet, paper-ready workbook derived **generically** from the
  template's own structure.
- A single, unambiguous export entry point.
- Reproducibility: the workbook reflects the **frozen template version**
  each Run was finalized on.
- Zero legacy code left behind in the export surface.

**Non-goals**

- Reproducing the reference workbook's **live Excel formulas**. prumo
  already knows every resolved value, so every projection is **baked to a
  static literal** (§5).
- Conditional formatting / colour-coding (explicitly descoped — §9).
- CSV / JSON export formats (retired — §8).
- Changing the extraction-HITL data model (read-only consumer).

## 3. Core idea — two orientations of one dataset (a baked star schema)

The reference workbook (`docs/reference/templates/example-charms-probast-template.xlsx`,
8 sheets) is a **star schema around one data-entry matrix**: the `CHARMS`
sheet is the single fact source, and every other sheet (`SUMMARY`,
`PROBAST`, `Study Characteristics`, `Model characteristics`, `PROBAST
summary`, dropdown lists) is a **projection** of it via `HLOOKUP` /
`COUNTIF` / `IF`. The same data appears in two orientations:

- **Data-entry / matrix orientation** — *fields are rows, records are
  columns.* Dense, good for side-by-side QA. (prumo's current main sheet.)
- **Analysis / "tidy" orientation** — *records are rows, fields are
  columns.* The "Table 1" form journals want pasted into a manuscript.

The reference **hard-codes** which fields feed which table. We make this
**template-agnostic** with one rule, using only the template structure
prumo already loads:

> **For each section in the template, emit one tidy table at the grain
> its cardinality implies.** A section with `cardinality='many'` fans out
> one row per instance; a `cardinality='one'` section is one row per
> article. Risk-of-bias / appraisal sections are just ordinary sections.

Because prumo knows every resolved value, **every reference formula is
computed in Python and written as a static literal** — no live formulas
ship. The deliverable is `(template structure) × (resolved per-record
values)` rendered as a fixed, formula-free, reviewer-facing workbook,
reproducible for any template.

## 4. Workbook composition (final)

Sheets, in order. Every sheet is derived generically from the template
snapshot + resolved values; none contains framework-specific prose.

| # | Sheet | Orientation | Derived from |
|---|---|---|---|
| 1 | **README / Methods** | front-matter | template name + version, project, export mode, `generated_at`, article/record counts, a generated contents list, a generic glyph/sentinel legend, and provenance caveats (absorbs today's `Notes`). |
| 2 | **Summary** | records-as-rows | one row per record (article, or article × model when a `MODEL_CONTAINER` exists): identity columns + per-record completeness + omitted-by-stage counts. |
| 3 | **Extraction matrix** | fields-as-rows | the data-entry orientation: section/field rows × record columns. Restyled + corrected. Sheet named after the template. |
| 4..k | **One tidy table per section** | records-as-rows | the publication tables (Study-Characteristics-style, Model-characteristics-style). Grain = section cardinality. **These are what authors paste into the paper.** |
| k+1 | **Appraisal summary** *(conditional)* | records-as-rows | computed roll-up for appraisal sections: per-domain verdict + derived **Overall**, mode-aware (§7). Emitted only when the template carries an appraisal layer. |
| k+2 | **Data dictionary** | reference | one column-group per field: label · type · unit · description / `llm_description` · `allowed_values` (value+label) · `is_required` · `allow_other`. Doubles as the dropdown catalogue. |
| last | **AI metadata** *(optional)* | flat | gated by the dialog toggle; **corrected** for the shipped bugs (§6.2). |

## 5. Generic table model (the algorithm)

**5.1 Layout source — snapshot-driven (foundational).** Column layout is
read from the **immutable per-Run version snapshot**
(`extraction_template_versions.schema_` via `Run.version_id`), **not** the
live `extraction_entity_types` / `extraction_fields` tables. The snapshot
already carries `role`, `cardinality`, `parent_entity_type_id`, and full
fields incl. `allow_other` / `allowed_values` / `unit`
(`backend/app/services/extraction_snapshot.py`).

- The **active version** snapshot is the column anchor.
- Each Run's own snapshot is **diffed by `field_id`** against the anchor:
  surviving fields are filled; fields that existed on an older Run but were
  removed from the anchor are **recorded in README/Notes**
  (`obsolete_fields_per_article`, which is declared and rendered today but
  **never populated** — this activates it).

This single change fixes the dominant "data is wrong/incomplete" cause for
the flexibility dimension: mid-project template edits, silent removed-field
data loss, and weak reproducibility. It is a read-*source* swap, not new
plumbing.

**5.2 Grain by cardinality (not by role).** The fan-out key is
`cardinality=='many'` from the snapshot, for **any** role — not a
`role==MODEL_SECTION` allow-list. This is what makes QUADAS-2
(per-index-test), multi-cohort, and multi-outcome templates work.

**5.3 Tidy-table recipe (per section).**
- Rows = one per record at the section's grain (article, or article ×
  instance for `many`).
- Columns = that section's fields, ordered by `sort_order`; header =
  `field.label`.
- Values baked from the resolved value map (§6).
- Section ordering follows snapshot `sort_order`; nested entity types
  (`parent_entity_type_id`) render as visual grouping/indentation.

**5.4 Matrix recipe.** Rows = fields grouped under a section-header row per
entity_type (snapshot order, generic hierarchical numbering
`section.field`); columns = one per record at the export grain; merged
record headers span an article's instance sub-columns; **study-section
field values are repeated (never merged) across instance sub-columns** so
each row is a complete record (preserved from 009 FR-010).

**5.5 Column guard.** A pre-build assertion rejects layouts exceeding
Excel's hard 16,384-column limit (reachable in all-users mode with many
articles × models × reviewers) with a clear error rather than an openpyxl
mid-build crash.

## 6. Value resolution & correctness (incl. AI-metadata, per-reviewer)

A single **envelope-aware resolver** replaces the too-narrow
`_unwrap_value`, is shared with the run-read path's semantics, and feeds
**every** value map (consensus, single-user, all-users) **and** the
AI-metadata value columns. This dict-leak is the **single root cause** of
both reported failures: the AI-metadata sheet bug *and* the broken
per-reviewer values.

**Confirmed bugs (adversarially verified + empirically reproduced — fix all three):**

| Sev | Bug | Fix |
|---|---|---|
| **High** | **Number+unit and "Other" values leak as Python-repr dict strings** (`{'value': 5, 'unit': 'mg'}`, `{'selected':'other','other_text':…}`). `_unwrap_value` (`extraction_export_service.py:1459`) only unwraps single-key `{value}`; real persisted envelopes are `{value, unit}`, the single/multi "other" shapes, and **double-wrapped** `{value:{value,unit}}` from the decisions/proposals write path. Empirically **5 of 6 real value shapes leak**. The same gap corrupts the matrix (all 3 modes incl. per-reviewer sub-columns) **and** the AI-metadata sheet's *AI proposed value* / *Final value used* (the AI sheet is more exposed: `astuple→_xlsx_safe` skips field-type context). | Recursively unwrap nested `{value}`; surface `unit` (append to numeric cells, e.g. `5 mg`, honouring `field.unit`); resolve `{selected, other_text}` → the free text, `{selected:[…], other_texts:[…]}` → labels + other texts. Feed it into every value map + the AI value columns, and **remove the silent `str(dict)` fallback in `_xlsx_safe`** so a missed shape fails loud in tests, not silently in the workbook. |
| **Med** | **Many-cardinality `STUDY_SECTION` collapses to one instance** — `study_instances.setdefault(...)` (`:542`, `:770`, `:989`) keeps only the first; N−1 instances are silently lost. | Per-`entity_type` **ordered instance list**; fan out sub-columns per instance (per §5.2). |
| **Low** | **Compound surnames mangled** ("De Feo" → "Feo") in column headers (`_build_header_label:1471`). | Particle-aware surname heuristic (`van`/`de`/`der`/`von`/`da`…); prefer structured author fields when present. |

**Field-type rendering** (typed cells, openpyxl-native): `text`/`number`/
`date` → typed scalar; `number` with `unit` → scalar + unit; `select` →
option label (value == label in prumo — confirmed, see §11); `multiselect`
→ labels joined `"; "`; `boolean` → `Yes`/`No`; reject / no-value → blank;
`"No information"` sentinel preserved verbatim.

### 6.1 Per-reviewer export (single-user / all-users) — correctness

Verified by an empirical workbook build: the reviewer-axis fan-out is
**structurally correct** — column slots, header-row labels, and the
4-tuple value-map keys (`run, instance, field, reviewer_id|None`) line up;
`reject` correctly blanks; eligibility and anonymize ordering are stable.
**The only defect is the shared envelope dict-leak (§6)**, which corrupts
per-reviewer *values* (unit/"other" cells render as dict strings). Fixing
the resolver makes per-reviewer export correct — **no re-architecture of
the fan-out is needed** (do not over-engineer this).

### 6.2 AI-metadata sheet — correctness recheck (the reported bug)

The sheet stays **optional** (dialog toggle), but it shipped buggy and is
rebuilt for correctness. Six confirmed defects; **A1 is the shared §6
resolver, A2–A6 are AI-sheet-specific** (`_load_ai_proposal_rows` /
`_infer_reviewer_outcome`) and are *not* covered by the resolver:

| # | Sev | Defect | Fix |
|---|---|---|---|
| A1 | High | *AI proposed value* / *Final value used* leak envelope dicts (`astuple→_xlsx_safe` bypasses field-type context). | §6 resolver + route both AI value columns through the shared format helper. |
| A2 | High | `_infer_reviewer_outcome` conflates **all** reviewers for one `(run,instance,field)` — the decision query (`:1245`) has no reviewer filter — and any `reject` masks a real `superseded`/`edited`. | Scope decisions by coordinate **and** reviewer; reorder precedence (`superseded` before blanket `reject`); ideally derive outcome from the consensus / published-state lineage. |
| A3 | Med | Single-user mode: *Reviewer outcome* reflects all reviewers while *Final value used* reflects only the target reviewer → contradictory rows. | Pass `mode` + `reviewer_id` into `_load_ai_proposal_rows`; scope the decision query by the target reviewer. |
| A4 | Med | A reviewed-but-not-selected latest proposal reports `pending` (indistinguishable from never-reviewed). | Label `not selected` / `superseded` when any terminal decision exists on the key. |
| A5 | Low | Evidence text vs pages collected in separate guards with no `ORDER BY` → desync, dupes, unsorted pages. | Build one ordered `(text, page)` list per proposal; dedupe + numeric-sort. |
| A6 | Low | Superseded "latest" uses `created_at`-only ordering → nondeterministic on ties; and `where((False,))` raises `ArgumentError` when `instance_meta` is empty (latent export abort). | Add an `id` tiebreak; use `sqlalchemy.false()` / skip the query when empty. |

## 7. Appraisal summary — final score **and** per-reviewer

Included in this effort. The appraisal sections (risk-of-bias /
quality-assessment) get a computed summary sheet:

- Rows = one per record at the appraisal grain.
- Columns = one per appraisal **domain** (the baked domain verdict) + a
  derived **Overall** column. `Overall` = **worst-case rollup** over the
  record's domain verdicts (e.g. any `High` ⇒ `High`).
- **Mode-aware Overall (explicit requirement):**
  - **Consensus mode** → the **final score**: one consensus Overall per
    record.
  - **All-users mode** → the consensus Overall **plus one Overall column
    per reviewer**, mirroring the matrix's reviewer-axis fan-out.
  - **Single-user mode** → that reviewer's Overall.

So both the final (consensus) score and the per-reviewer breakdown are
available, selected by the existing export mode.

> **Plan-time detail:** how an "appraisal section" is identified
> (dedicated entity role, template kind, or a flag) must be confirmed
> against the model during planning. If the template carries no appraisal
> layer, sheet #k+1 is simply omitted and a PROBAST-style section still
> appears as an ordinary tidy table (§5.3).

## 8. Export modes (recap) & UI

Three value-source modes are kept, unchanged in meaning: **Consensus**
(default; `extraction_published_states`), **Single user**, **All users**
(manager-gated; per-reviewer columns; anonymize toggle). Modes drive both
the matrix sub-columns and the appraisal Overall (§7).

**Single entry point:** the `ExtractionExportDialog`. Format is
**`.xlsx` only** — CSV/JSON are retired (§9 lists removals). The dialog's
delivery (sync inline blob vs. async Celery job + signed URL) and
sync/async cutover are retained; the richer multi-sheet workbook is still
CPU-bound openpyxl run off the event loop, and the column guard (§5.5)
bounds worst-case size.

## 9. Backend architecture

Split the monolithic builder into **pure, no-IO sub-builders** under
`backend/app/services/exports/extraction/`, each
`build_<sheet>(layout) -> SheetSpec` (testable without an openpyxl
workbook). All remain layer-legal (`services`, no DB/storage/network) under
`scripts/fitness/check_layered_arch.py`.

- `workbook.py` — orchestrates sheet order; keeps the existing public
  `build_workbook(layout)` signature so endpoint/worker/tests are
  untouched.
- `front_matter.py` · `summary.py` · `matrix.py` · `tidy_tables.py` ·
  `appraisal_summary.py` · `data_dictionary.py` · `dropdown_lists.py`.

`ExportLayout` grows to carry: snapshot-resolved sections (with role +
cardinality + field metadata: `description`/`llm_description`/`unit`/
`allowed_values`/`is_required`/`allow_other`), per-section tidy
projections, the appraisal model, and front-matter — **no ORM/HTTP types
cross the boundary.** Storage path/bucket, signed-URL TTL, rate limits,
membership/RLS gates, and audit logging are retained as-is. Reusable
upload / signed-URL / background-job patterns are shared with
`articles_export` where they already align.

**Styling (structural only — per decision):** freeze panes (lock label
block + header row), merged/grouped headers + title banners, bold filled
section-header rows, thin table borders, tab colours, sensible per-column
widths, typed cells, numbered hierarchical field labels. **No conditional
formatting** — no blank-cell tint, no verdict traffic-lights, no
icon-set glyphs. (Completeness, if shown, is a literal value, not a
conditional format.)

## 10. Frontend consolidation + legacy removal (the cascade)

Verified: the legacy card is reachable through exactly **one** mount, so
removal is a safe dependency cascade.

1. **Cut the mount** — remove the "Export Data" menu item + Dialog block +
   import in `frontend/components/extraction/header/HeaderMoreMenu.tsx`
   (lines 23, 233–266).
2. → delete `frontend/components/extraction/ExtractionExport.tsx` (the
   whole 295-line legacy card).
3. → drop the now-dead `template`/`instances`/`values` props +
   pass-through in `frontend/components/extraction/ExtractionHeader.tsx`.
4. → delete the **29 orphaned legacy copy keys** + the 3 `moreExport*`
   keys in `frontend/lib/copy/extraction.ts`.
5. **Backend dead text** — strip the stale `NotImplementedError until
   US2/US3` docstrings + the dead `else` branch in
   `extraction_export_service.py`, and the `US1/US2/US3 / T042 / SC-003`
   scaffolding comments in the builder (all three modes are fully
   implemented).
6. **Architecture-debt cleanup (no-legacy)** — route
   `frontend/services/extractionExportService.ts` through the typed API
   client `frontend/integrations/api/client.ts`; it currently bypasses it
   with raw `fetch` + `import.meta.env.VITE_API_URL` + `supabase.auth`,
   violating the frontend data-access rule.

**Not touched:** `backend/app/worker/tasks/export_tasks.py::export_articles_task`
(belongs to the separate Articles export); the `(best-effort)`
reviewer-outcome heuristic (live, used by the AI-metadata sheet).

## 11. Refuted findings — intentionally NOT changed

The adversarial pass disproved these; acting on them would be wrong:

- **"select/multiselect exports coded value, not label."** Refuted: prumo's
  option editor stores plain strings, so value == label always; the API
  schema rejects `{value,label}` payloads. Unreachable precondition.
- **"Finalized-then-reopened article dropped from consensus."** Refuted:
  this is the **specified** reopen behaviour — published states are
  preserved on the parent run; export run-selection is intentional.
- **"AI-metadata 'Final value used' *keying* is wrong."** Only the keying
  is fine: the mode keying (3-tuple vs 4-tuple for all-users) **is**
  correct. **But the deeper recheck overturned the "sheet is fine"
  conclusion** — the AI-metadata sheet has six confirmed defects (envelope
  leak + outcome inference), now owned by §6.2 and fixed.

## 12. Testing strategy (interleaved per the project rule)

- **Pure unit tests** per sub-builder (matrix, each tidy table, appraisal
  summary, dictionary, front-matter) — no DB fixtures.
- **Value-resolution unit tests** for the envelope-aware resolver:
  `{value,unit}`, double-wrapped, single/multi "other", `boolean`,
  `multiselect`, blank/reject, `"No information"` — asserted on **both** the
  matrix cells and the AI-metadata value columns.
- **Per-reviewer value tests** (single-user + all-users) with unit/"other"
  shapes, asserting correct cells per reviewer sub-column (regression for
  §6.1).
- **AI-metadata outcome tests**: `accepted` / `rejected` / `superseded` /
  `edited` / `not selected` / `pending`, incl. multi-reviewer disagreement
  (A2), single-user reviewer scoping (A3), evidence text↔page pairing (A5),
  deterministic latest-proposal tiebreak (A6), and the empty-`instance_meta`
  no-crash case (A6).
- **Integration tests** (real local Supabase) for the snapshot-diff +
  obsolete-field path and the many-cardinality study-section fan-out;
  setup helpers scope queries by `project_id`.
- **Golden-structure assertions** per sheet against a seeded CHARMS
  project; extend the existing determinism test to the new sheets + a
  500×100 column-guard case.
- **E2E** flow updated for the single consolidated dialog.

## 13. Implementation phasing (vertical slices, each shippable + green)

1. **Snapshot-driven layout + envelope-aware value resolver** (§5.1, §6) —
   the correctness foundation; fixes the shared dict-leak (so the
   AI-metadata A1 + per-reviewer values, §6.1/§6.2, render correctly) and
   activates obsolete-field Notes.
2. **Many-cardinality fan-out** generalized to any role (§5.2) + header
   surname fix.
3. **Builder split into pure sub-builders** (§9) — lift current matrix
   verbatim, then restyle (structural only).
4. **Tidy tables + Summary + Data dictionary + README/Methods** (§4, §5.3).
5. **Appraisal summary** with mode-aware Overall (§7).
6. **AI-metadata correctness** — outcome-inference rewrite (A2), single-user
   reviewer scoping (A3), `not selected`/`pending` fix (A4), evidence
   pairing (A5), deterministic tiebreak + empty-`instance_meta` crash (A6)
   (§6.2).
7. **Frontend consolidation + full legacy cascade** (§10).
8. **Column guard, determinism + golden tests, e2e** (§12).

## 14. Open decisions

- **Resolved:** Tier-B composition; template-agnostic per-section tidy
  tables; snapshot-driven layout; structural-only styling; appraisal
  roll-up included now with final + per-reviewer Overall; retire CSV/JSON;
  no legacy left.
- **To confirm in the plan:** the exact mechanism that marks an
  "appraisal section" (role / template-kind / flag), used to decide whether
  sheet #k+1 is emitted (§7).
