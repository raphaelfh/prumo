---
status: draft
last_reviewed: 2026-08-07
owner: '@raphaelfh'
---

# Template config — track B re-slicing + B-1 (grid shell) plan

> **Supersedes the phase order in the umbrella spec's Delivery note** for
> track B only (`docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`).
> The spec's B1/B2/B3 are re-cut into nine PR-sized slices after a
> nine-agent mapping + three-lens adversarial review (2026-08-07). The
> spec's *design* is unchanged; only the delivery order moves.

## Why re-slice

Phase A shipped (PR #576) and the Configuration screen still shows the old
accordion — phase A only added row zero. Reading the spec literally, the
next slice (B1: snapshot-only readers + draft backbone) is entirely
invisible, so the redesigned editor would land on the *fourth* merge.

The mapping found that the grid **has no backend dependency at all**: it
renders from `loadTemplateEntityTypes` (`frontend/services/templateService.ts:81`)
and `loadEntityTypeFields` (`frontend/services/extractionFieldService.ts:69`),
both of which already exist. The visual can therefore land first.

The load-bearing constraint is narrower than "the grid needs the draft":

- **Before the draft backbone** (draft table, editor lock, tiered diff,
  History, per-change revert): the grid ships fine. That is slice B-9.
- **Before de-republishing**: it must not. One republish is ~8 fixed
  statements + one advisory lock per article + one `ensure_instances` pass
  per article, all under a `FOR UPDATE` that serializes the template row
  (`backend/app/services/template_version_service.py:76-215`). Enter-chaining
  ten cells on a project with 200 articles in extract stage is ten
  versions, ~2 000 advisory locks and 2 000 materialization passes — and
  those are the *same* `(article, template)` locks
  `HITLSessionService.open_or_resume` takes, so reviewers opening articles
  queue behind the manager's typing.

Hence the split: **B-1 ships the grid with editing still bridged to the
existing dialog** (one click instead of five), and inline cell editing
waits for B-4, which stops the per-edit republish.

## Slice order

| Slice | Title | Visible? | Depends on |
| --- | --- | --- | --- |
| **B-1** | Grid + rail + inspector shell (read-only re-skin, zero backend) | **Yes — the redesign appears** | — |
| B-2 | AI prompt path reads the run-pinned snapshot | No (inert) | — |
| B-3a | Worklist/export snapshot re-point (same projection) | No (inert) | — |
| B-3b | Widen the projection with `is_required` | Yes (progress numbers move) | B-3a |
| B-4 | Edits stop republishing; explicit Publish appears | Yes (biggest semantic change) | B-2, B-3a |
| B-5 | Inline cell editing; dialogs deleted | Yes | B-1, B-4 |
| B-6 | Move + reorder (capabilities that exist at no layer today) | Yes | B-5 |
| B-7 | Writes onto typed endpoints + RLS + fitness-gate fix | No | B-5 |
| B-8 | Repeating group with data-driven entry noun (spec §3) | Yes | B-6, B-7 |
| B-9 | Real draft backbone — persisted draft, lock, tiered diff, History | Yes | B-4, B-5 |

B-1, B-2 and B-3a are mutually independent and can run concurrently on
non-overlapping paths (`frontend/components/extraction/template-config/**`
vs `backend/app/services/**`).

## Adversarial findings folded in

All three lenses cleared **B-1** explicitly (no new read, no new write, no
commit point, no migration). Their blocking findings land on later slices
and are recorded here so those plans inherit them:

- **B-1 (MAJOR, invariants):** shipping the grid before B-4 raises edit
  *rate* against an unchanged republish cost, and the contended advisory
  locks are shared with reviewers opening articles. **Resolution: B-4 is a
  prod-promotion gate for B-1.** Merging B-1 to `dev` is fine; promoting
  it to `main` waits for B-4, or ships behind a flag. Encoded here rather
  than left in prose.
- **B-4 (BLOCKING):** a pending-draft 409 must key off an explicit draft
  marker, never off `snapshot(live) != active.schema_` — snapshot
  inequality cannot distinguish "manager mid-edit" from "a republish was
  lost", and the second case must still self-heal. Reachable from QA
  session-open, so getting this wrong locks reviewers out of articles.
- **B-5 (BLOCKING):** deleting a field carrying reviewer decisions is
  blocked by five RESTRICT FKs, not by the client gate. Keep
  `validateFieldImpact`'s block until B-9, widen it to count
  `extraction_proposal_records`, and map the RESTRICT violation to a typed
  409 — otherwise the user gets a raw foreign-key error.
- **B-2/B-3 (BLOCKING, regression):** an empty entity-type tree does not
  fail — it *succeeds wrongly*. `section_extraction_service.py:538`
  short-circuits its all-sections-failed guard on an empty list (green run,
  zero extraction, no log), and the worklist computes an empty tree as
  100% complete. Every re-pointed reader keeps a narrow/empty → live
  fallback, chained rather than swapped, and the new active-version
  endpoint returns a typed 404/409 for "no active version" — never an
  empty tree.

## Open questions carried forward (not blocking B-1)

1. **Phase-A contradiction, blocks B-4:** `PUT /llm-instruction`
   (`template_instruction_service.py:69-74`) republishes the *whole* live
   tree. Once pending edits are normal, typing in row zero would silently
   publish everything else. B-4 must scope that publish or move row zero
   into the draft.
2. `derived_judgments` is in no snapshot — the QA Appraisal-summary sheet
   reads live `schema_` JSONB (`extraction_export_service.py:557`).
3. The QA assessment form renders from live rows
   (`qaTemplateService.ts:126`), not its run snapshot — QA is not
   insulated by B-2/B-3.
4. `_snapshot_is_narrow` treats an empty array as narrow in three
   independent copies; a heterogeneous 0017-patched snapshot defeats it
   (needs a per-element check).
5. `run_lifecycle_service._snapshot_initial_version:798-833` lazily
   auto-publishes v1 from live rows, which conflicts with the spec's
   "Unpublished regime".

## B-1 scope (this PR)

**Goal:** the Configuration tab renders the approved grid, and every
number and label on it matches what the accordion showed.

**Non-goals (deliberate, deferred):** inline cell editing (B-5), drag
reorder / move (B-6), typed write endpoints (B-7), `entry_label` and
per-model section creation (B-8), draft/publish (B-4, B-9).

Editing bridges to the existing `EditFieldDialog`; `void republish()` stays
wired exactly as today, so the republish cadence per user action is
unchanged.

### Visual contract (from the approved mock `manager-grid-v3-polish.html`)

Field rows 30 px, body 12 px, hairline bottom border at 50 % border
opacity. Column header row 26 px, 9.5 px uppercase, tracking .04em.
Section header rows 32 px on the muted surface, single line, fixed height,
meta truncates and never wraps. Columns: grab (14 px) · Label · Type
(110 px) · Required (40 px) · ✨ (26 px) · trailing (48 px, right).
Type renders as a pill (`Selection · 5`, `Text`). Required renders as a
compact 14 px checkbox — switches live only in the inspector. Focus is a
2 px ring inset on the **whole cell**; the selected row takes the muted
selection surface. The repeating group is one bounded block with a
**single 2 px accent rule on its left edge** and no interior verticals;
indentation carries the hierarchy (identity 22 px, sub-header 14 px, child
fields 36 px). Metadata labels only the non-default: "one per article" is
silent; "Repeating group", "repeats per model", "repeats" are shown. Rail
is 200 px, 11 px, scroll-spy, per-section counts, nested entries indented
14 px. Inspector is 300 px, docked, read-only in this slice.

### Tasks

1. **Tree + labels + search (pure, unit-tested first)** —
   `frontend/components/extraction/template-config/templateTree.ts`:
   build the ordered section/field tree from `EntityTypeWithCount[]` +
   fields, detect the repeating group by `role`, derive non-default
   metadata labels, and implement the search predicate (case- and
   diacritic-insensitive both sides, whitespace terms AND-ed, matching
   label / key / section title / description / AI instruction / option
   values).
2. **Components** — `TemplateGrid`, `TemplateOutlineRail`,
   `TemplateInspector`, `TemplateGridToolbar` (search + Display menu).
3. **Mount** — replace the accordion in `TemplateConfigEditor`, keep row
   zero on top, bridge editing to `EditFieldDialog`.

### Post-ship review (2026-08-07)

A four-lens adversarial review of the merged B-1 commit returned 27
verdicts — 18 confirmed, 9 refuted. All confirmed findings were fixed in
the follow-up PR: field deletion (reachable again via a per-row actions
menu wired to the existing impact check), keyboard entry (the grid had
zero focusable rows; every actionable element is now a real button),
`role="grid"` dropped as an unbacked promise, a text alternative for the
Required column, a toast for partial field-load failures, a distinct
empty-template state, tooltips on icon-only triggers, the unit restored
in the inspector, and container queries so the rail and inspector
collapse on a narrow card.

**Orphan marker for B-5:** `FieldsManager.tsx`, `FieldsTable.tsx`,
`FieldsHeader.tsx` and `EmptyFieldsState.tsx` are no longer mounted
anywhere — the grid replaced them and only their dialogs are reused via
`TemplateFieldDialogs`. They stay on disk until B-5 deletes them; a
`git grep` for field-management code will land on them misleadingly
until then.

### Simplify pass (2026-08-07)

Four cleanup lenses (reuse, simplification, efficiency, altitude) over the
slice. The deep finding: `useTemplateEntityTypes`
(`frontend/hooks/extraction/useTemplateEntityTypes.ts`) already read the
whole structure — entity types **with nested fields** — in ONE request,
TanStack-cached on the key `useTemplateRepublish` already invalidates
after every config mutation. The panel's per-section fan-out and its
hand-rolled `refreshToken` protocol were reinventing it. Widening that
hook's select with the entity-type metadata (additive; its three other
consumers read only `fields`) and consuming it deleted both.

Opening the Configuration tab went from **29 requests to 2**: the panel's
14 field reads collapsed into the shared query, and
`loadTemplateEntityTypes` stopped firing one HEAD count per section for a
count its own `extraction_fields(count)` select already returned.

Also fixed: a real bug the altitude lens caught with a probe —
double-clicking the row `⋯` menu opened the edit dialog, because
`stopPropagation` on `click` does not stop `dblclick`; the row no longer
duplicates the handlers its own cells carry. Plus copy-key reuse
(`deleteField`, `actionsForFieldAria` already existed), the shared `Check`
glyph instead of a hand-drawn path, container queries moved onto the
component roots instead of `display:contents` wrappers, tree walkers moved
into `templateTree.ts`, the delete pre-flight's first frame (it flashed
"impossible to delete") and its missing failure fallback.

**Deferred, with measurements:** the per-row Radix `DropdownMenu` +
`Tooltip` pair costs ~2.2 ms per grid mount (82 rows, measured). Mounting
it lazily on hover/focus is a B-5 concern — it adds machinery this slice
does not need. `sectionActions` relocating a text input's state three
layers up is real; `SectionHeaderRow` should own its rename draft when
B-5 rewrites the cell model.

### Verify

`npm run test:run`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`,
`make quality-scan`, plus a browser pass on the seeded CHARMS template in
light and dark comparing against the mock.
