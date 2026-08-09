---
status: draft
last_reviewed: 2026-08-08
owner: '@raphaelfh'
---

# Template config B-8 — repeating group with data-driven entry noun

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> full structural map (Explore agent, 2026-08-08) + 3-lens adversarial
> panel (14 findings folded in below). Anchors reference the worktree
> tree at B-7 head `1c872d5a`; the #587 squash landed as `1de1ae23`
> with an **identical tree** (`git diff 1c872d5a 1de1ae23` empty,
> verified 2026-08-08) — anchors are valid as written; re-verify only
> if further commits land on dev before execution (and at T1 time,
> chain 0051 from whatever `alembic heads` reports, not blindly 0050).
> Spec: §3 of
> `docs/superpowers/specs/2026-08-05-template-config-ux-redesign-design.md`.

## Goal

The "prediction models" container becomes a generic **repeating
group** whose entry noun is data: new column `entry_label` on
`extraction_entity_types` (seeded `"model"` for existing containers)
interpolates config-editor and run-view copy; the grid tells the
schema's truth (role-aware `＋▾` menus, per-group *New per-model
section* ghost, bottom ghost gains *Add repeating group…*); the
section inspector gains the spec's edit affordances. Generic section
nesting stays deferred (spec §3 ground truth).

## Load-bearing map facts (verified 2026-08-08)

- **`_backfill_child_singletons` ALREADY EXISTS** —
  `backend/app/services/hitl_session_service.py:275`, invoked from
  `ensure_instances` (`:264`) on session open AND from
  `TemplateVersionService._materialize_singleton_instances`
  (`template_version_service.py:284`) on publish. Both only CREATE
  missing instances (skip logic `:231`, `:336`) — they never delete.
  B-8 asserts coverage, builds nothing here.
- **Bounded-block rendering ~70 % landed** — `TemplateGrid.tsx:696-704`
  one `<tbody>` per group with 2 px `border-l-primary` accent;
  indentation ladder at `:146-151` (identity 22 / sub-header 14 /
  child fields 36). Missing: per-group ghost + role-aware menus.
- **Two shipped comments promise a DIFFERENT B-8** — inline section
  creation retiring AddSectionDialog (`TemplateGridGhostRow.tsx:85-86`,
  `TemplateConfigEditor.tsx:246-248`). This plan deviates: the dialog
  stays as the permanent create surface and the bottom ghost becomes a
  `＋▾` menu. Both comments must be rewritten (T5).
- **The `＋▾` menu is role-blind today** —
  `TemplateGridSectionHeaderRow.tsx:186-245` renders New field / Edit
  label / Remove identically for every role; `section.kind` never
  read. Menu-item selection uses the `menuClaimedFocus` +
  `onCloseAutoFocus` claim protocol (`:61-69`, `:208-218`).
- **AddSectionDialog has no role chooser** — role hardcoded
  `study_section` (`AddSectionDialog.tsx:120-122`); cardinality select
  at `:241-282` with pre-existing hardcoded English literals.
- **Section inspector is entirely read-only** —
  `TemplateInspector.tsx:594-621`. TWO commit patterns exist to copy
  from: the field pane's draft+baseline+explicit-Save form (content-
  keyed remount at `:218-235` against two-editor races) vs. the
  Section-move combobox's IMMEDIATE commit (`:334-350`, structural,
  never joins a draft). Field inspector's Section combobox: `:329-353`.
- **Cell model auto-enters EDIT on ghosts with non-empty sectionId** —
  `gridCellModel.ts:193-195` (`next.kind === 'ghost' &&
  next.sectionId !== ''` → `mode:'edit'`); the empty-sectionId
  exception exists solely for `ADD_SECTION_ROW_ID`. A per-group ghost
  with `sectionId = groupId` would Enter-chain into edit mode on a row
  with no inline editor (soft-locks roving focus).
- **Row-shape mirror contract** — `gridRowShapes.ts:5-8` "must mirror
  TemplateGrid's JSX exactly"; per-group ghost row must be added there
  (`:33-42`). `ADD_SECTION_ROW_ID` at `:14`.
- **Copy mechanism is `{{placeholder}}` strings + `.replace()` at call
  sites** (~134 existing call sites, e.g. `frontend/lib/error-utils.ts`);
  `t()` at `frontend/lib/copy/index.ts:72-75` types namespaces as
  `Record<string, string>` — **function-valued keys silently render
  their source text**. NO function-valued keys exist anywhere.
- **Copy nouns**: config-side interpolation targets
  `sectionMetaRepeatsPerModel` (`extraction.ts:754`),
  `inspectorKindGroupChild` (`:781`), `sectionMetaRepeatingGroup`
  (`:752`), `inspectorKindGroup` (`:780`); `metaKeysFor`
  (`templateTree.ts:204-215`) returns copy KEYS consumed only by
  `TemplateGridSectionHeaderRow.tsx:110`. Run-view: ~40 keys consumed
  by `hierarchy/ModelSelector.tsx`, `AddModelDialog.tsx`,
  `RemoveModelDialog.tsx`, AI toasts (full table in the map, task 6).
  **`shared.ts:24-36` model keys are DEAD (zero consumers) — delete,
  don't interpolate.**
- **Run-view pinned tree reaches components through TWO hand-written
  files the noun must traverse**: `frontend/hooks/runs/types.ts:164`
  (`RunViewEntityType` — hand-written mirror of
  `backend/app/schemas/extraction_run.py`, per its header comment) and
  `frontend/lib/extraction/runViewAdapters.ts:69-80`
  (`entityTypesFromRunView` — explicit per-field map; omission is a
  silent drop). `ExtractionFullScreen.tsx:190` builds entityTypes
  exclusively from it. `ModelSection.tsx:142` mounts ModelSelector.
- **Run view renders only `instances[0]` for cardinality-one
  sections** (`SectionAccordion.tsx:67` isMultiple gate, `:84`), while
  the completion gate counts required fields per EVERY existing
  instance with no cardinality filter
  (`run_lifecycle_service.py:495-514`). Instances are per
  (article, template), shared across runs.
- **Snapshot plumbing**: `SNAPSHOT_SQL` entity keys
  `extraction_snapshot.py:47-55`. The WARNING at `:36-39` (mirror new
  keys into 0026) **must NOT be followed for entry_label** — the
  column post-dates 0026's slot; a fresh-DB upgrade would fail with
  UndefinedColumn (exemption precedent: `llm_template_instruction`,
  docstring `:15-21`). Narrowness probe `:139-167` does not trip on a
  missing ET key. Typed read model `RunViewEntityType`
  `backend/app/schemas/extraction_run.py:210-226`. Republish compares
  `current.schema_ == snapshot` byte-wise
  (`template_version_service.py:140`).
- **Copy-carrier column lists**: clone
  `template_clone_service.py:352-369`; seed `_EntitySpec` +
  `_entity_type_from_spec` `seed.py:95-109`; the two container specs
  `seed.py:334-343` (CHARMS) and `:2136-2149` (multimodal); typed
  create `template_section_service.py:151-162`.
- **`rename_section` skips no-op writes deliberately**
  (`template_section_service.py:190-192`) so the 0048 AFTER-row
  trigger doesn't stamp `config_draft_since` on unchanged saves.
- **Live grid read** `useTemplateEntityTypes.ts:52` (explicit select —
  must add `entry_label`); pinned tree
  `useActiveTemplateStructure.ts:42-53` (explicit map — must add);
  `loadTemplateEntityTypes` uses `*` (no change).
  `CreateSectionParams` + body `templateService.ts:366-401` sends
  neither `parent_entity_type_id` nor `entry_label` today.
- `templateTree.ts`: `GridSection` `:118-131` and
  `TemplateEntityTypeInput` `:54-63` lack the field;
  `deriveMoveTargets` `:161-171`.
- **Export noun leak**: `extraction_export_service.py:2078-2080`
  `stem = "Model"` on the MODEL_SECTION branch — but the tidy builder
  consumes `SnapshotSection` objects from
  `exports/extraction_snapshot_reader.py` (`_section_from_view` `:91`)
  which do NOT carry the container's entry_label; the noun needs a
  data path through the PINNED snapshot, never live rows. Backend
  instance-label fallback leak: `model_extraction_service.py:543`
  `f"Model {idx + 1}"`.
- **Prompt stays untouched end-to-end** — `model_identification.py`
  user template interpolates `container_label` from
  `model_entity.label` (`model_extraction_service.py:373`); switching
  it to entry_label would be a silent fleet-wide prompt regression
  (VERSION canary `:43` hashes only template text) and spec §3
  defers prompt generalization to C-track.
- **QA never mounts the grid** — `TemplateConfigEditor` only mounted
  from `ExtractionInterface.tsx:361-364` (list filtered
  `kind: 'extraction'` at `:136`). "Hidden for QA" holds by
  construction; do NOT thread `kind` down four levels (YAGNI). Assert
  with a comment on the bottom-ghost menu.
- Completion gate reads the **run-pinned snapshot**
  (`run_lifecycle_service.py:473-514`); republish re-pins editable
  stages only (`template_version_service.py:238-252`).
- One-container enforcement: partial unique indexes
  (`0016_entity_role_column.py:126,133`), deferred trigger
  `trg_check_model_section_parent_role` (`0016:161-199`, NOT in
  `__table_args__` — model comment `extraction.py:323-328`).
- Migration head = `0050_field_name_unique_heal`; arch-doc head line
  `docs/reference/extraction-hitl-architecture.md:138` +
  `last_reviewed` `:3`.
- B-7 surface being extended: `SectionCreateRequest`
  `template_structure.py:255-287` (role required, `_enforce_role_parent`
  validator), `SectionRead` `:299-320`, `SectionRenameRequest`
  `:290-297` (label-only), `create_section`/`rename_section`/
  `delete_section` in `template_section_service.py`, endpoints
  `template_structure.py:246-279` (+ rename/delete), generated
  `frontend/types/api/schema.d.ts` (`npm run generate:api-types`).

## Decisions (panel-ratified 2026-08-08)

- **D1 — Column**: `entry_label: String | None` after `description`
  (`extraction.py:273`), no CHECK (YAGNI). Migration `0051` backfills
  `'model'` where `role='model_container'` (both lineages), no
  server_default. Downgrade drops the column.
- **D2 — Snapshot compatibility**: add `'entry_label'` to
  `SNAPSHOT_SQL`; `RunViewEntityType.entry_label: str | None = None`;
  do NOT extend the narrow probe; **do NOT touch migration 0026**
  (column post-dates its slot — fresh-DB upgrade would break; amend
  the WARNING comment at `extraction_snapshot.py:36-39` to scope it to
  keys that existed at 0026's revision). Consumers use
  `entry_label or "model"` (backend) / `{{noun}}` fallback `'model'`
  (frontend). **Accepted side-effect**: pre-B-8 snapshots are never
  byte-identical to the new builder output, so each template's first
  post-deploy publish yields one phantom v+1 even for previously
  no-op edit chains (`template_version_service.py:140`) — one-time per
  template, semantically inert (re-pin only); do NOT conditionally
  omit the key (nullable entity keys are already emitted
  unconditionally).
- **D3 — Container create contract**: `SectionCreateRequest` accepts
  `entry_label` **only** when `role='model_container'` (else 422 via
  validator, same style as `_enforce_role_parent`); for containers,
  `cardinality` must be `'many'` (422 otherwise) and `entry_label`
  defaults to `'model'` when omitted/blank. Dialog asks Label + entry
  label, never cardinality.
- **D4 — Group delete semantics**: spec says "Delete repeating
  group… (cascade warning: children + run entries)". DB reality:
  instances FK is RESTRICT → `SectionInUseError` 409
  (`template_section_service.py:196-228`). **Keep RESTRICT for v1.**
  The group menu item opens the confirm dialog with the cascade
  warning for *children + fields*; when run entries exist the endpoint
  409s and the dialog surfaces the friendly "remove entries first"
  error (existing `PgError` 23503 path). Destroying run data from the
  config editor is a bigger product decision than a slice footnote;
  deviation from spec wording recorded here.
- **D5 — Section PATCH widening**: replace label-only
  `SectionRenameRequest` with `SectionUpdateRequest`
  (`label?`, `entry_label?`, `cardinality?`, all optional,
  `extra="forbid"`). Rules: `entry_label` editable only on
  `model_container` (422 otherwise); **`cardinality` editable ONLY on
  `model_section`** (422 on `study_section` AND `model_container` —
  spec §3 marks "Repeats editable" solely for the per-model section);
  **many→one is REFUSED (409, typed `SectionCardinalityInUseError`)
  when any parent instance has ≥2 child instances of the section**
  (one GROUP BY on `extraction_instances`) — otherwise the completion
  gate counts instances the run view no longer renders
  (`SectionAccordion.tsx:67/84` vs `run_lifecycle_service.py:495-514`)
  and runs become un-completable; many→one with ≤1 everywhere, and
  one→many, are free. **The update service applies each provided field
  only when it differs and skips the flush entirely when nothing
  changed** (extends the `rename_section` no-op contract
  `template_section_service.py:190-192` that keeps the 0048
  draft-marker trigger quiet).
- **D6 — Noun interpolation scope**: config editor meta/kind copy,
  run-view ModelSelector/AddModelDialog/RemoveModelDialog + AI
  progress/toast keys, export stem (`:2080`, via the pinned-snapshot
  data path), instance-label fallback (`:543`). **The identification
  prompt is untouched end-to-end** (SYSTEM and user template;
  `model_extraction_service.py:373` keeps `model_entity.label`) — spec
  defers prompt generalization to C-track. Dead `shared.ts` keys
  deleted, not interpolated.
- **D7 — Copy mechanism**: interpolated keys keep the existing
  `{{placeholder}}` string convention
  (`sectionMetaRepeatsPerModel: 'repeats per {{noun}}'`) resolved at
  call sites with `.replace('{{noun}}', …)` — matching the ~134
  existing call sites; **no function-valued keys** (`t()` types
  namespaces as `Record<string,string>` and would render the function
  source). The grid meta channel threads the noun as
  `GridSection.entryNoun` — the group's own `entry_label`, inherited
  by `groupChild` sections from the PARENT group in
  `buildTemplateTree` — so `TemplateGridSectionHeaderRow.tsx:110` does
  `t('extraction', key).replace('{{noun}}', section.entryNoun ??
  'model')`. Key-signature flips land WITH their consumers (T5 for
  grid copy, T6 for inspector/run-view copy). Fix pre-existing inline
  literals ONLY in lines a task already rewrites (surgical rule).
- **D8 — Menus (schema truth)**:
  - root section `＋▾`: New field / Edit label / Remove (unchanged —
    roots never offer sub-sections);
  - group `＋▾`: New field (identity) / New per-model section /
    Edit label / Delete repeating group…;
  - per-model section `＋▾`: unchanged root set;
  - bottom ghost becomes a `＋▾` menu: New section /
    Add repeating group… — the latter disabled with tooltip when a
    container exists in the tree (derive from `buildTemplateTree`
    output; no kind-threading), reason copy names the existing group.
  - New items join the existing `menuClaimedFocus`/`onCloseAutoFocus`
    claim protocol where they mount editors; dialog-opening items
    (delete, add-group) fire directly on select.
- **D9 — Per-group ghost**: "＋ New per-model section" row closes each
  group block (TemplateGrid children loop end) AND is mirrored in
  `gridRowShapes.ts` with rowId `ghost:group-child:<groupId>`. It is a
  **dialog-opening ghost like `ADD_SECTION_ROW_ID`, not an inline-edit
  ghost**: add a discriminator to `GridRowShape`
  (`inlineEditor: boolean`, default `true`) and change
  `commitAndAdvance`'s condition (`gridCellModel.ts:193-195`) to
  require it — keeping `sectionId = groupId` for attribution.
  `gridCellModel.test.ts` covers Enter-chaining from the last child
  field ghost into the per-group ghost staying in focus mode.
- **D10 — Inspector**:
  - group: Kind line "Repeating group — reviewers add one entry per
    {noun}", Repeats row LOCKED ("A group always repeats"),
    entry-label text input, no Section combobox (sections never had
    one);
  - per-model section: Placement line locked to the group, Repeats
    select `Once per model / Repeats per model` (cardinality PATCH;
    the D5 409 surfaces as a friendly error, same pattern as D4);
  - root section: Repeats line READ-ONLY ("One per article" /
    "Repeats per article" — existing meta copy); cardinality for
    roots stays a create-time choice (spec's last §3 bullet describes
    the existing mechanism, not an inspector affordance);
  - **Commit semantics: IMMEDIATE per control** through T4's
    `updateSection` (the Section-move-combobox pattern — structural,
    no draft/Save row; entry-label commits on blur/Enter, unchanged or
    emptied value is a no-op mirroring the header rename revert rule);
    the entry-label Input remounts on a section content key
    (id + label + entryLabel + cardinality, analogous to
    `fieldContentKey` at `TemplateInspector.tsx:218`);
  - field inspector: unchanged.
- **D11 — Backfill**: no new code; add ONE integration test asserting
  a cardinality-one child section created after session open gets its
  instances on the next `ensure_instances` (session open) and on
  republish materialization.
- **D12 — QA**: no kind-threading; comment at the bottom-ghost menu
  citing `ExtractionInterface.tsx:136`.

## Tasks (subagent-driven, TDD per task)

**T1 — Migration 0051 + model + seed (backend)**
`entry_label` column (D1), backfill both lineages, arch-doc head bump
(+ `last_reviewed`), `_EntitySpec.entry_label` + the two container
specs get `"model"` explicitly, roundtrip test (RED first; remember
`migration_session.rollback()` before every `_run_alembic`), seed
smoke re-run. Autogenerate probe must be zero-ops after the model
edit. Chain from `alembic heads` output, not blindly 0050.

**T2 — Propagation + typed API surface (backend)**
Clone column list, `SNAPSHOT_SQL` + `RunViewEntityType` (D2 — do NOT
touch 0026; amend its WARNING comment), `SectionCreateRequest`
container rules (D3), `SectionUpdateRequest` (D5) + service + endpoint
(PATCH route reuses `/sections/{id}`), `SectionRead.entry_label`,
`create_section` carries it. Integration tests: container create
forces many + defaults noun; entry_label 422 matrix; cardinality-edit
matrix (only model_section editable — 422 for root/container);
**many→one 409 when a parent instance has 2 children (error names the
section) / 200 when at most singletons exist**; **no-op PATCH leaves
`config_draft_since` NULL**; clone carries entry_label; snapshot shape
extends `test_template_version_snapshot_shape.py` (entry_label
present: null for non-containers, 'model' for the seeded container);
old-snapshot fallback (entity without key →
`RunViewEntityType.entry_label is None`). Regenerate
`frontend/types/api/{openapi.json,schema.d.ts}`.

**T3 — Backend noun consumers (backend)**
Two consumers only (D6): (a) export stem — the container's
entry_label must travel through the exports snapshot reader (add it to
`SnapshotSection` or resolve the container view from the same
`entity_types_for_version` result in
`exports/extraction_snapshot_reader.py`) so
`extraction_export_service.py:2080` reads the PINNED container's
`entry_label or "model"`, title-cased — never live rows; (b) instance-
label fallback `model_extraction_service.py:543` → noun-based. The
identification prompt is untouched. Unit tests via existing export/
model-extraction suites; D11's backfill-assertion integration test
lands here too.

**T4 — Frontend data plumbing**
`useTemplateEntityTypes.ts:52` select + `useActiveTemplateStructure`
map + `frontend/types/extraction.ts`; **`frontend/hooks/runs/types.ts`
`RunViewEntityType` gains `entry_label: string | null` (hand-written
backend mirror) and `runViewAdapters.ts` `entityTypesFromRunView` maps
it through (explicit map — omission is a silent drop)**;
`templateTree.ts` scope: `TemplateEntityTypeInput.entry_label`,
`GridSection.entryNoun` (group's own value; groupChild inherits the
parent group's) threaded in `buildTemplateTree` — **no copy-signature
changes here** (they land with consumers, D7);
`templateService.createSection` grows
`role`/`parent_entity_type_id`/`entry_label` params + `updateSection`
(PATCH wrapper for D5); regenerate `schema.d.ts`. Vitest:
templateTree tests (entryNoun derivation incl. inheritance); service
tests mock apiClient.

**T5 — Grid + dialogs (frontend)**
D8 menus in `TemplateGridSectionHeaderRow.tsx` (role-aware via
`section.kind`, claim-protocol respected), **metaKeys/`{{noun}}`
interpolation at the `:110` call site (D7)**, D9 per-group ghost
(TemplateGrid JSX + gridRowShapes mirror + `inlineEditor`
discriminator + gridCellModel change + tests), bottom ghost → `＋▾`
menu (D8, D12 comment), AddSectionDialog variants (D3: group mode =
Label + entry label, no cardinality; per-model mode = parent preset
from the invoking group; root mode unchanged), cascade-warning dialog
for group delete (D4 wording), **rewrite the two stale B-8-promise
comments (`TemplateGridGhostRow.tsx:85-86`,
`TemplateConfigEditor.tsx:246-248`) to the dialog-stays reality**.
Vitest: TemplateGrid/MoveMenu/GridPanel suites extended; every new
string through the copy module (D7).

**T6 — Inspector + run-view noun (frontend)**
D10 inspector variants (immediate-commit via T4's `updateSection`;
D5's 409 surfaced friendly), run-view interpolation (D6):
**ModelSelector/AddModelDialog/RemoveModelDialog gain an `entryLabel`
prop threaded from `ModelSection.modelContainer`
(`ModelSection.tsx:142`)**, AI toasts read the noun from the pinned
tree (fallback "model"), `{{noun}}` copy keys flip WITH these
consumers, delete dead `shared.ts` keys. Vitest: TemplateInspector
suite + affected hierarchy suites; **one test renders a non-"model"
noun end-to-end (guards the silent-fallback failure mode)**.

**T7 — Slice close**
Adversarial 5-lens review of the full diff (pinned to commits) →
fixer → `make quality-scan` + `make test-backend` (serial) → browser
pass (magiclink auth; prove: create group via dialog → POST /sections
201 with entry_label; noun renders in grid meta + inspector; per-model
section via group menu; Repeats edit → PATCH 200 and the many→one 409
friendly path; group delete 409 path with friendly error; run view
shows interpolated noun; Publish → republish 200) → PR to dev +
auto-merge + watcher + memory.

## Verification gates

Every task: RED evidence before GREEN, `ruff`/`eslint`/`tsc` clean,
no new fitness offenders (file-size ratchet: `--update-baseline` only
with justification in the commit). Backend suites never run
concurrently with anything. Every commit passes the full gate
independently (key-signature flips land with their consumers).
Browser pass follows the B-7 evidence protocol (network tab: all
writes `/api/v1`; PostgREST reads only).

## Non-goals

Generic nesting; prompt generalization (C-track); QA grid;
post-create cardinality editing on root sections (spec §3's last
bullet describes the existing create-time mechanism, not an inspector
affordance); draft backbone (B-9); `REVOKE`/SELECT-tightening
follow-ups; migrating the impact-probe reads; inline section creation
(dropped — AddSectionDialog is the permanent create surface).
