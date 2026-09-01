---
status: draft
last_reviewed: 2026-09-01
owner: '@raphaelfh'
---

# Quality-assessment Excel export

The QA surfaces get the same export button and flow that Data Extraction
has, reusing one dialog and one endpoint. Three shapes of workbook —
complete, dictionary only, publication — reach both surfaces. One or
several QA tools can be exported in a single gesture.

## 1. Starting position

The backend export is already kind-agnostic and already tested against a
quality-assessment template. This design does **not** build a QA export
path; it removes the three things that stop the existing one from being
reachable and correct on the QA surface.

What already works, verified in the code:

* `ExtractionExportService.resolve_layout` threads `run_kind=template.kind`
  into all three mode branches (consensus / single-user / all-users), so
  QA runs resolve exactly as extraction runs do.
* When `template.kind == TemplateKind.QUALITY_ASSESSMENT`, `resolve_layout`
  builds an `AppraisalModel`: one column per domain verdict, plus the
  computed overalls declared by the template's `derived_judgments`.
  `_ordered_specs` emits it as the `Appraisal summary` sheet.
* `_load_active_template_version` looks a template up by `(id, project_id)`
  with **no** `is_active` filter, so QA's several-enabled-tools model
  resolves without change.
* The endpoint never inspects kind.
* `backend/tests/integration/test_extraction_export_appraisal_summary.py`
  drives a real PROBAST run to FINALIZED and asserts the consensus,
  all-users and single-user rollups render into the workbook.

Three gaps remain.

**No button.** `ExtractionInterface` hands `toolbarActions` to
`ArticleExtractionTable`. `HITLArticleTable` — the table the QA surface
renders — has no such prop, so nothing can open the dialog.

**One template per request.** QA enables several tools per project
independently (`QualityAssessmentConfiguration`), switched via
`HITLActiveTemplateBar`. `ExtractionExportRequest` carries a single
`template_id`.

**The workbook is all-or-nothing.** `_ordered_specs` always emits every
sheet. The three shapes the user wants are subsets of sheets that already
exist.

And one correctness defect, in scope here: `template.schema_` reaches
exactly one call site, `_build_appraisal_model`. The matrix and tidy-table
builders receive no schema, so a section the article's study type takes out
of play exports as a blank cell while the run view shows a
"Not applicable" badge.

## 2. One dialog, two surfaces

`ExtractionExportDialog` moves to
`frontend/components/hitl/HITLExportDialog.tsx`. That is where
`HITLArticleTable` already lives, and it is the established home for a
surface both HITL flows share.

Copy stays in the `extraction` namespace. `HITLArticleTable` already calls
`t("extraction", …)` for every shared string, so following it costs no key
migration and no ratchet churn.

One prop change carries the multi-tool feature:

| before | after |
| --- | --- |
| `templateId: string` | `templates: ExportTemplateOption[]` |

`ExportTemplateOption` is `{id: string; name: string}`.

When `templates.length === 1` the picker does not render and the extraction
surface is visually unchanged. When it is greater, a checkbox list renders.
One component, one code path, no `kind` conditional anywhere in the dialog.

`HITLArticleTable` gains `toolbarActions?: ReactNode`, rendered in the
existing `ml-auto` toolbar group beside `ListCount` — the same prop name and
placement `ArticleExtractionTable` uses.

`QualityAssessmentInterface` mounts the dialog on the `assessment` tab. It
feeds `templates` from the `useProjectTemplates({kind: "quality_assessment"})`
call it already makes, and takes `isManager` from `useProjectMemberRole`,
the hook `ExtractionInterface` uses for the same purpose.

Default selection is the tool currently active in the template bar: one
click for the common case, tick more for the rest.

## 3. Output shapes

Three shapes, filtered in `_ordered_specs` — the single place that knows
which *builder* produced which spec.

| shape | sheets |
| --- | --- |
| `complete` | every sheet — today's behaviour, and the default |
| `dictionary` | README · Data dictionary · Dropdown lists |
| `publication` | README · tidy tables · Appraisal summary |

README is in all three: it carries the template identity, the export
provenance and the glyph legend, without which no sheet can be read
correctly.

Filtering on builder identity rather than on sheet title is what keeps this
flexible. `SheetSpec` carries only a `title`, and a title-matching filter
would misfire on a future instrument with a section named "Data dictionary".
`_ordered_specs` knows the provenance of every spec it appends, so the
filter belongs there — and a skipped builder is never called.

`ExportShape` is a `StrEnum` beside `ExportMode`. `shape` lands on
`ExportLayout` next to `mode` and `include_ai_metadata`, is set by
`resolve_layout`, and is read by `build_workbook` — the threading path every
other option already takes. `ExtractionExportRequest` gains a defaulted
`shape` field, so every existing caller is unaffected.

`resolve_layout` is **not** made shape-aware. A dictionary-only export still
resolves the value map it will not print. That is wasted work on a large
project and a deliberate non-goal: one concept, one filter, no second branch
through the resolver. Revisit only if a real export gets slow.

## 4. One or several tools

Selecting N tools starts N exports and produces N workbooks, each byte-for-byte
what a single-tool export produces today. Filenames already disambiguate:
`format_filename` includes the template name.

The dialog loops the selected tools, awaiting each `startExport` in turn.
Sequential, not parallel — it stays inside the endpoint's `10/minute` limit
and avoids N browser downloads racing each other.

Per-tool outcomes are collected, not merged. A tool with no finalized
assessments returns `422 EMPTY_ELIGIBLE_ARTICLES`, and that must not swallow
the two that succeeded. If any tool fails the dialog stays open and names
which failed and why; the successful downloads have already been triggered.
Sync and async results may mix across tools — each is handled as it is today
(`triggerDownload` or a `BackgroundJob`).

Single-user mode needs the reviewer picker to cover every selected tool.
`useEligibleReviewers` is per-template; `useQueries` over the selected ids
and union the results. No backend change.

## 5. Scope fidelity

The marking happens once, on `value_map`, inside `resolve_layout` — after
the map is built and before the tidy and appraisal builders read it. No
sub-builder receives the schema and no builder signature changes: the matrix
and the tidy tables are pure over `layout` and inherit the correction for
free.

Per article: build the `{(section.name, field.name): value}` projection, ask
`out_of_scope_sections` for the excluded section names, collect the field ids
those sections own, then overwrite every `value_map` entry whose key carries
that article's `run_id` and one of those field ids with
`ABSENT_REASON_LABELS[AbsentReason.NOT_APPLICABLE.value]`. Keying on
`(run_id, field_id)` makes it mode-agnostic — it covers the three-tuple
consensus and single-user keys and the four-tuple all-users keys, including
every reviewer sub-column, without knowing which mode it is in.

`_build_appraisal_model` already builds that same per-article projection
inline. It is extracted to a helper and both call it, so the appraisal code
gets shorter rather than longer, and the two callers cannot disagree about
which sections an article excludes.

**This cannot double-apply.** `scope_filtered_values` drops entries by
section name (`c[0] not in out_of_scope`), never by value, so the derived
overalls discard those coordinates whatever the map now holds for them. And
`out_of_scope_sections` reads only the classifier coordinate, which is the
field that decides scope and is therefore never itself excluded. The derived
column's behaviour is unchanged; a regression test pins that.

The written constant is `"Not applicable"` — the same string the frontend's
`qa.outOfScopeValue` copy key holds, with an FE/BE parity test over these
labels already documented in `value_semantics.py`. Same helper and same
string is what makes the invariant hold: the workbook cannot report something
the run view contradicts.

## 6. The dead scope radio

`ExtractionInterface` is the only mount site and passes `selectedIds={[]}`,
so the dialog's "Selected only" radio has always rendered disabled as
"Selected only (0)". It is deleted rather than carried into a component two
surfaces will render.

Removed: the "Articles to export" radio group, the `articleScope` state, the
`selectedIds` and `defaultArticleScope` props, and the three copy keys
`exportScopeLabel`, `exportScopeCurrentList`, `exportScopeSelectedOnly`. The
article count the group displayed is already in the preview line
("Will export 48 articles × 32 fields → inline download"), so nothing is
lost.

`buildRequest` keeps sending `article_scope: "current_list"`. The field is a
real part of the API contract, the backend still validates it, and holding it
constant keeps the four E2E payload assertions green. The frontend simply no
longer offers a choice.

The backend `SELECTED_ONLY` branch stays. It is a valid API guard, and
unrelated code is not in scope.

## 7. Flexibility for instruments that do not exist yet

Nothing in this design keys on PROBAST, QUADAS-2, or any named instrument.
The properties that make a new QA form work without code changes are already
in place, and this design preserves each:

* The appraisal builder selects a domain's verdict field by its **risk-label
  allowed-value set**, not by field name or position.
* `derived_judgments` and `scope_rules` are data on the template's `schema`
  JSONB.
* Template lookup is by id, never by "the active one".
* The shape filter keys on builder identity, never on a sheet title.

## 8. Testing

Backend unit — the shape filter: three shapes against their expected sheet
sets, asserting the skipped builders are not invoked.

Backend integration — extend the existing QA appraisal fixture with an
article whose study type excludes a domain, and assert three things: that
domain's cells read `Not applicable` on the matrix, the same on its tidy
table, and the derived-overall column unchanged from before the marking (the
regression that would catch a double-application).

Frontend — picker hidden at one template and rendered above it; the shape
radio reaching the request; the N-tool loop issuing N sequential requests;
the partial-failure banner naming the failed tool while the successes still
download.

E2E — a QA export flow mirroring `extraction-export.e2e.ts`.

Gates — `npx knip` and `npx knip --production` at zero, and the copy-key
ratchet, which shrinks by three keys here.

## 9. Non-goals

* Combining several tools into one workbook.
* Making `resolve_layout` shape-aware.
* Giving `HITLArticleTable` a multi-select.
* Consolidating `ArticlesExportDialog`, which serves a different feature.
* Any change to the backend's `SELECTED_ONLY` handling.
