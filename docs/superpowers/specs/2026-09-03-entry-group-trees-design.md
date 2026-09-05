---
status: in_progress
last_reviewed: 2026-09-05
owner: '@raphaelfh'
---

# Entry-group trees — design

> Brainstormed and approved 2026-09-03. Grows item 2 of the identity
> follow-ups (parent scope for nested singletons) into the structural end
> state the identity train pointed at: a template is a tree of sections in
> which any repeating section is an entry group that may own per-entry
> children at any depth, a template may hold several root groups, and
> nothing in the schema, the pipeline, the run form, the editor or the
> exports is model-shaped. "Model" becomes one noun a group may carry.
>
> Builds on
> [`2026-08-23-repeating-group-instance-identity-design.md`](2026-08-23-repeating-group-instance-identity-design.md)
> (identity per group, unchanged) and follows
> [`2026-09-03-entry-group-followup-train-design.md`](2026-09-03-entry-group-followup-train-design.md)
> (the small PRs that ship first). Executed as six `/ship-spec <this file>
> --to dev` slices (§13). Prod projects are test data and are recreated
> after the schema slice (§14), so nothing here carries an old dependency
> for compatibility.

## 1. Problem

Two limits and one gap, all verified in the code on 2026-09-03:

- **Structure is model-shaped.** Migration 0016 gave every section a
  `role`: `model_container` (root, repeating, at most one per template by
  two partial unique indexes, the only section allowed to own children),
  `model_section` (a child, whose parent must be the container by a
  deferred trigger) and `study_section` (any other root, childless).
  Depth is capped at two. The run form mirrors it (`ModelSection`,
  `ModelSelector`), the editor mirrors it (`ROLE_BY_MODE`, a ghost row
  only under the container), the exports mirror it (fan-out by "model
  instances"), and the identify pipeline mirrors it (`ModelExtractionService`
  looks the container up by role). A review of trial arms or diagnostic
  index tests can already name its container "arm" or "index test", but
  it cannot hold two independent groups, and no group below the root can
  own sections.
- **Nested singletons are unscoped.** `_extract_singleton` sends the LLM a
  prompt that never names the entry it belongs to, so "Model Development"
  for model B is extracted from a prompt that does not mention model B.
  The nested-group path scopes to one parent label; deeper nesting would
  lose the chain.
- **Two creation paths.** The container has a transactional manual
  endpoint that also creates its singleton children; every other group
  is created from the browser through a PostgREST insert with a
  cardinality RPC, and no children are created.

## 2. Decisions

| Axis | Decision |
| --- | --- |
| Nesting | Any repeating section may own children, at any depth. Rule: a section may name a parent only if the parent repeats. |
| Root groups | A template may hold several root groups. |
| Run form | One recursive `EntrySection`: a group that owns children renders a selector of its entries and its children against the active entry; a group without children keeps the instance-card list. |
| Structure | Derived from `parent_entity_type_id` plus `cardinality`. The `role` column, its enum, its CHECK, its trigger and the one-container indexes are dropped. |
| Scope | One ancestry resolver feeds the section prompt, the QA prompt and the identification prompt; #802's single parent label goes. |
| Pipeline | The model identification service, its endpoint, its worker branch and its hook retire; identifying a group's entries is "extract this section". |
| Creation | One endpoint creates an entry for any group with its singleton descendants in one transaction; the model-only manual endpoint and the browser insert retire. |
| Legacy | Every old dependency is mapped (§11) and deleted by a named slice. Prod projects are recreated after the schema slice. |
| Exports | Tree-derived descriptors; one primary matrix axis from the first root group, one extra sheet per additional root group; single-group templates export byte-for-byte as today. |

## 3. Vocabulary and invariants

A **section** is a row of `extraction_entity_types`. A **repeating
section** (`cardinality='many'`) is an **entry group**; an **entry** is
one instance of it. A group's **children** are the sections whose
`parent_entity_type_id` is the group; they are filled once per entry, and
their instances carry that entry as `parent_instance_id`. A **root** has
no parent. **Depth** is the number of ancestors. The **noun**
(`entry_label`) is the word for one entry.

1. A section may name a parent only if the parent repeats. Enforced by
   the service and by a deferred trigger.
2. Depth is unbounded in the schema. The editor offers nesting under
   every repeating section. Portable import refuses more than five nested
   levels below a root (`MAX_DEPTH = 5`) to bound recursion.
3. No `role`. Structure derives from parent links plus cardinality;
   rendering derives from "repeats" and "owns children".
4. A template may hold several root groups.
5. A repeating section always carries a noun (CHECK).
6. Identity is the identity spec's, per group, unchanged: AI
   identification needs the group's key; manual creation of an entry
   works keyless with a label only.
7. Instances mirror the tree: a singleton child has exactly one instance
   per parent entry; the instance coordinate stays
   `(article, entity type, parent instance)`.

## 4. Schema and migration `0069_entry_group_trees`

Upgrade, in order:

1. `UPDATE extraction_entity_types SET entry_label = 'entry' WHERE
   cardinality = 'many' AND entry_label IS NULL` (global rows and clones;
   snapshots untouched, see the note below).
2. `ALTER TABLE ... ADD CONSTRAINT ck_extraction_entity_types_noun_on_repeating
   CHECK (cardinality <> 'many' OR entry_label IS NOT NULL)`.
3. Drop trigger `trg_check_model_section_parent_role` and function
   `check_model_section_parent_role`.
4. Drop indexes `uq_extraction_entity_types_one_container_per_global` and
   `uq_extraction_entity_types_one_container_per_project`.
5. Drop CHECK `ck_extraction_entity_types_role_parent`.
6. Drop column `role`; drop type `public.extraction_entity_role`.
7. Create function `check_section_parent_repeats` and the deferred
   constraint trigger `trg_check_section_parent_repeats` on INSERT and on
   UPDATE OF `parent_entity_type_id, cardinality`: a row with a parent
   requires the parent's cardinality to be `many`; a row whose
   cardinality becomes `one` requires no children. Deferred, so a clone
   or a restore may insert parent and child in any order inside one
   transaction, as 0016's trigger allowed.

Downgrade recreates `role` by derivation (root and `one` →
`study_section`; root and `many` → `model_container`; nested →
`model_section`), then the CHECK, the two indexes and the old trigger,
drops the new trigger and the noun CHECK, and fails loudly when the data
no longer fits (several root groups, or depth above two). That is the
honest undo.

Snapshots: template-version JSON keeps whatever keys it was written
with. The snapshot writer stops emitting `role`; readers ignore it; the
diff engine drops `role` from its compared attributes and drops the
pre-B-8 noun rule. A clone whose published snapshot predates the noun
shows the backfilled noun as an unpublished change until it is
re-published; prod projects are recreated (§14) and local databases are
`make db-fresh`, so no reader is written for that era.

ORM and wire: `ExtractionEntityType.role` and `ExtractionEntityRole` are
deleted; `RunViewEntityType.role` leaves the run view, which keeps
`parent_entity_type_id`, `cardinality` and `entry_label`;
`app.models.extraction.DEFAULT_ENTRY_LABEL` and
`template_diff._DEFAULT_ENTRY_LABEL` are deleted; one constant,
`entry_group_extraction.DEFAULT_ENTRY_NOUN = "entry"`, remains for
snapshot objects that predate the noun. The migration roundtrip head-pin
is bumped in the same change.

## 5. Template write side

- **Create.** `SectionCreateRequest` loses `role`. `parent_entity_type_id`
  is optional; when present the service resolves it through
  `owned_section` (it must belong to this template) and refuses a parent
  that does not repeat with `SectionParentMustRepeatError` (422).
  `entry_label` is required non-blank when `cardinality='many'` and
  refused otherwise. `OneContainerError` and `SectionParentRoleError` are
  deleted.
- **Patch.** `cardinality` is editable on any section. `many` → `one` is
  refused while any parent instance holds two or more entries (for a
  root, while any article holds two or more instances): the existing
  `has_multi_entry_parent` predicate with its role filter removed and a
  null-parent branch added. It is also refused while the section owns
  children (`SectionOwnsChildrenError`). `one` → `many` is allowed; the
  section's existing instance becomes its first entry with no key, and a
  reviewer may key it through the rename dialog. A PATCH that turns a
  section into `many` must carry a noun unless the row already has one.
  `SectionCardinalityRoleError` is deleted;
  `SectionEntryLabelRoleError` becomes
  `SectionEntryLabelCardinalityError` (noun only on a repeating section).
- **Publish.** The multi-entry refusal keeps its predicate and drops its
  role filter: every nested `cardinality='one'` section whose parent
  entries hold two or more instances is named.
- **Discard.** The subtree walk becomes a fixpoint over descendants, as
  the code's own comment anticipates.
- **Restore.** `ContainerSwapUnsupportedError` is deleted with the index
  that caused it. The create pass runs parents before children
  (Kahn order, as the clone does); the delete pass runs children first.
- **Diff.** `role` leaves the attribute list; the pre-B-8 noun rule
  leaves with it.
- **Clone.** Unchanged: it already copies every column by default and
  sorts topologically at any depth.
- **Portable.** `PortableSection.sections` is allowed under any section
  with `repeats` or `group`, recursively, with `MAX_DEPTH` enforced by
  the validator. On export, `repeats` is written for every repeating
  section and `group` for a repeating section that owns sections, at any
  depth; on import, `group` implies `repeats`. Several roots may be
  groups. A repeating section without a noun defaults to `entry` on
  import. The format stays `prumo-template@1`; the change is additive.

## 6. Extraction pipeline

- **Ancestry.** New module `backend/app/services/entry_ancestry.py`:
  `ancestry_of(service, run, instance_id) -> tuple[Ancestor, ...]` with
  `Ancestor(noun, label)`, outermost first. It walks `parent_instance_id`
  through the repository's run-scoped getter and takes the noun from the
  pinned tree (live row fallback, `DEFAULT_ENTRY_NOUN` if unset), caching
  per run inside the service so a batch does not re-walk.
- **Scope block.** `EntryScope` becomes `Scope(entry_label, key_label,
  key_value, ancestors)` with the key pair optional. One renderer serves
  the section prompt and the QA prompt:
  - a group entry: "This section repeats once per {noun}. Extract ONLY
    the values that describe the {noun} identified below; ignore values
    that describe a different {noun}." then `- {key label}: "{value}"`;
  - a singleton under an entry: "This section belongs to the {parent
    noun} identified below. Extract ONLY the values that describe that
    {parent noun}; ignore values that describe a different {parent
    noun}.";
  - both, when ancestors exist: `- Within: {noun} "{label}" › {noun}
    "{label}"`.
  The identification prompt's parent clause takes the same chain ("Only
  the {noun} entries that belong to {chain} count here"). The three
  `VERSION` lists gain the singleton render and a chained render, so all
  three bump once.
- **Recursion.** `extract_into_instances` descends after each write:
  once an entry is resolved and extracted, the section's children are
  extracted with that entry as parent; once a singleton is extracted and
  its instance materialized, its children follow the same way. The full
  run calls it on roots only and drops any per-container loop. The
  per-entry batch ("extract all sections for this entry") calls it on
  the entry's children through the existing per-parent kickoff. A
  keyless group refuses with `MISSING_ENTITY_KEY` at any level.
- **Retirement.** `ModelExtractionService`, `POST /api/v1/extraction/models`,
  the worker task's model branch, `ModelExtractionRequest` and
  `ModelExtractionResult`, `SectionExtractionService.extractModels` and
  `useModelExtraction` are deleted. "Identify {noun}s with AI" on a group
  calls `POST /api/v1/extraction/sections` for the group's entity type
  (with the parent instance for a nested group), which identifies,
  resolves, extracts per entry and recurses. `metadata.model_type` is no
  longer written; `ai_extracted` and `ai_run_id` stay.

## 7. Entry creation endpoint

`POST /api/v1/extraction/instances`, request `EntryCreateRequest`
(`projectId`, `articleId`, `templateId`, `entityTypeId`,
`parentInstanceId` optional, `label`, `entityKey` optional), response
`EntryCreateResponse` (`instance`, `descendants`, `proposalRunId`
optional), served by a new `entry_hierarchy_service.py` that replaces
`model_hierarchy_service.py`:

1. Scope through the one ownership predicate the kickoff endpoints share
   (project member, then the reviewer gate, because a key value is
   recorded as a reviewer decision).
2. The entity type belongs to the template's pinned tree (live row
   fallback) and repeats; singletons are never created here, they
   materialize under their parent.
3. A nested group requires `parentInstanceId`, which must be an instance
   of the entity type's parent on this coordinate; a root group refuses
   one.
4. The key is normalized as the identity spec prescribes; a duplicate on
   `(article, entity type, parent instance)` is refused with the typed
   409 `ENTRY_KEY_DUPLICATE`.
5. The entry is written with `metadata.entity_key` and `created_via`,
   then its singleton descendants recursively, depth first, in the same
   transaction; nested groups get no entries.
6. When a live extract-stage run exists, the key value is recorded as
   the reviewer's decision on the key field, as the manual model path
   does today.

`extractionInstanceService.createInstance` becomes a typed API call; the
PostgREST insert and its cardinality RPC are deleted. `useAddEntry` calls
it for every group. Delete stays the PostgREST cascade it is today.

## 8. Run form

`frontend/components/extraction/entries/EntrySection.tsx` is recursive.
Props: the group, its parent instance (null at root), the shared form
plumbing. It renders the group label; `EntrySelector` (from
`ModelSelector`) with the entries as tabs, the actions "Add {noun}",
"Rename", "Remove", "Identify {noun}s with AI", "Extract all sections
for this {noun}" and "for every {noun}", each with a shadcn `Tooltip`
and an `aria-label` on icon-only buttons; the group's own fields bound to
the active entry; then each child: a singleton as today's
`SectionAccordion` bound to the child's instance under the active entry,
a group as a nested `EntrySection` whose parent is the active entry. A
group without children keeps the instance-card list.

State: `hooks/extraction/useEntryGroup.ts` (from `useModelManagement`),
one per rendered group: entries derived from the run view instances
filtered by entity type and parent, the active entry persisted in
`localStorage` under `active-entry-{articleId}-{groupId}-{parentInstanceId|root}`
and applied only when it exists in the list, create through §7, rename
through the identity PATCH, remove through `RemoveEntryDialog` (from
`RemoveModelDialog`) gating on the subtree's data. `useAddEntry` takes the
parent from the enclosing `EntrySection` (its active entry) instead of
the first instance of the parent type.

`ExtractionFormView` partitions roots: singletons to `SectionAccordion`,
groups to `EntrySection`. The nav rail registers roots and groups.
`ExtractionFullScreen.tsx` sheds `activeModelId`, `modelParentEntityType`,
`useModelManagement` and the model dialog plumbing, which takes it below
the file-size ceiling. `ModelSection`, `ModelSelector`, `AddModelDialog`,
`RemoveModelDialog`, `useModelManagement`, `entityTypeRoles.ts` and the
`role` field in `runViewAdapters.ts` are deleted. `getTopLevelSections`
and `useFullAIExtraction` filter by `parent_entity_type_id is null` and
cardinality instead of role. Copy keys move from the model vocabulary to
`entry*` keys with `{{noun}}` interpolation. The QA shell is untouched.

## 9. Config tab

`templateTree.ts` builds recursive nodes carrying `repeats`,
`ownsChildren`, `depth` and `children`, replacing the three kinds.
`TemplateGrid` renders rows recursively, indented per depth, with a ghost
row under every repeating section ("New per-{noun} section") that opens
`AddSectionDialog` in a `perGroup` mode (parent preset, cardinality
select, the noun field when `many`); a nested group is a per-group
section created with cardinality `many`. "Add repeating group…" is
always enabled. Ghost-row ids and move destinations are keyed by parent
id at any depth. The inspector already edits the noun and the
description; cardinality becomes editable anywhere, with §5's two
refusals shown inline. The diff sheet drops the `role` attribute.

## 10. Exports

Descriptors become tree-derived: `SectionDescriptor` gains
`parent_entity_type_id` and `repeats` and loses `role`;
`ArticleDescriptor.model_instances` becomes `entries`, ordered instance
ids keyed by `(entity_type_id, parent_instance_id)`. The snapshot reader
derives `repeats` from cardinality and reads the noun from the snapshot
(`DEFAULT_ENTRY_NOUN` when absent).

- **Matrix.** The primary sheet keeps today's geometry: one instance axis
  per article, taken from the first root group by sort order, study
  sections repeated across it (repeat-not-merge). Each additional root
  group gets its own sheet with the same geometry over that group's
  entries and only that group's fields and descendants as rows. Inside
  any entry, a nested group repeats-not-merges within the entry's
  columns, today's rule for a non-model repeating section applied one
  level down; the fan-out width under an entry is the largest nested
  entry count.
- **Summary.** One row per article, then one row per entry per root
  group, labelled with the noun.
- **Tidy tables.** One per section; the stem is the section's root
  group noun; a nested group's rows read `{article} · {root entry} ·
  {nested entry}`.

Characterization first: a golden CHARMS workbook (single root group)
must be byte-identical before and after the generalization.

## 11. Legacy map

| Old dependency | Where | Slice |
| --- | --- | --- |
| `role` column, `extraction_entity_role` type, `ck_..._role_parent`, parent-role trigger, one-container indexes | `models/extraction.py`, migration 0016 | B5 |
| `ExtractionEntityRole` readers | `exports/extraction/{matrix,summary}.py`, `extraction_scope_marking.py`, `extraction_snapshot_reader.py`, `extraction_export_service.py`, `template_section_service.py`, `template_discard_service.py`, `template_version_service.py`, `template_restore_service.py`, `template_diff.py`, `template_portable_service.py`, `entity_key.py`, `extraction_repository.py` (`get_by_role`), `api/v1/endpoints/template_structure.py`, `schemas/{extraction,template_structure,template_portable}.py` | B4 (exports), B5 (rest) |
| `role` on the frontend | `entityTypeRoles.ts`, `runViewAdapters.ts`, `getTopLevelSections.ts`, `useFullAIExtraction.ts`, `templateTree.ts`, `ROLE_BY_MODE` in `AddSectionDialog.tsx` | B3, B5 |
| Model identification pipeline | `model_extraction_service.py`, `endpoints/model_extraction.py` (`POST ""`), `worker/tasks/extraction_tasks.py` model branch, `ModelExtractionRequest`/`Result`, `useModelExtraction.ts`, `SectionExtractionService.extractModels` | B6 |
| Model-only manual creation | `model_hierarchy_service.py`, `POST /extraction/models/manual`, `CreateModelHierarchyRequest`/`Response` | B2 |
| Browser-side instance insert and cardinality RPC | `extractionInstanceService.createInstance` | B2 |
| Model-named components and hooks | `ModelSection`, `ModelSelector`, `AddModelDialog`, `RemoveModelDialog`, `useModelManagement`, `model*` copy keys | B3 |
| `DEFAULT_ENTRY_LABEL`, `_DEFAULT_ENTRY_LABEL`, pre-B-8 diff rule, pre-0051 reader fallback | `models/extraction.py`, `template_diff.py`, `extraction_export_service.py`, `extraction_snapshot_reader.py` | B4, B5 |
| `metadata.model_type` | `model_extraction_service.py`, worker task | B6 |
| Single `parent_label` | `EntryScope`, `entry_identification.render`, `_identify_entries` | B1 |
| Role-shaped errors | `SectionParentRoleError`, `OneContainerError`, `SectionCardinalityRoleError`, `SectionEntryLabelRoleError`, `ContainerSwapUnsupportedError` | B5 |
| Seed roles | `_EntitySpec.role` and the `_container`/`_section` aliases in `seed.py`; `ExtractionEntityRole.STUDY_SECTION` in `seed_probast_ai.py` | B5 |
| "Study/model partition" wording | `ExtractionFormView.tsx`, `RunViewEntityType` docstring, architecture reference | B3, B5 |

## 12. Cleanup gate (every slice)

On top of the ship-spec hardening (`/simplify`, the architectural
quality loop, `code-review`, `/security-review` on the endpoint slices,
`make quality-scan`):

- `npx knip --no-tag-hints` and `npx knip --production --no-tag-hints`
  at zero; no new `knip.jsonc` exception.
- The vulture baseline strictly smaller whenever backend code is
  deleted, never larger, no new ignore. The mypy ratchet green.
- `python3 scripts/fitness/check_copy_keys.py` green; renamed keys
  carry their references, deleted keys leave the file.
- `bash scripts/generate_api_types.sh` on every schema change, committed.
- The PR body pastes `grep -rn` output proving zero occurrences of the
  names §11 assigns to that slice. B6 adds those names to a fitness
  check (`scripts/fitness/check_retired_symbols.py`) so they cannot
  return.
- `docs/reference/extraction-hitl-architecture.md` rows and
  `last_reviewed` on every slice that changes a table or an endpoint.

## 13. Slices

Each slice is one `/ship-spec` run with a checkable goal and a verify
step, ordered so the app can render every shape before the schema allows
it, and so the section endpoint carries identification before the model
endpoint disappears.

1. **B1 — ancestry on the three prompts.** Goal: a singleton under an
   entry, and any section at depth three, receives the scope block with
   the full chain; three prompt versions bump. Verify: prompt unit tests
   for the three renders; a depth-three integration fixture asserts the
   rendered chain; the QA prompt test; version constants differ from
   `dev`.
2. **B2 — one entry-creation endpoint.** Goal: any group's entry is
   created with its singleton descendants in one transaction through the
   API; the manual endpoint and the browser insert are gone. Verify:
   integration tests (root group, nested group, duplicate key 409,
   foreign parent 404, keyless group with label only); direct
   endpoint-coroutine unit tests; the Spec A e2e add flow passes
   unchanged.
3. **B3 — recursive run form.** Goal: `EntrySection` renders today's
   CHARMS tree identically, and a depth-three fixture with two root
   groups renders every level with working add, rename, remove and
   identify actions; the model components are deleted. Verify: component
   tests for the recursion and the per-group state; `/design-review` on
   the run form; the Spec A e2e spec; `ExtractionFullScreen.tsx` below
   the ceiling.
4. **B4 — tree-derived exports.** Goal: the golden CHARMS workbook is
   byte-identical; a two-group depth-three template exports the extra
   sheet, the summary rows and the tidy stems described in §10. Verify:
   the golden test, the new export tests, `ExtractionEntityRole` gone
   from the export package.
5. **B5 — schema and editor.** Goal: migration 0069 applied and rolled
   back on the roundtrip test; the section service, the Config tree, the
   ghost rows, the portable format and the seeds work without `role`; a
   manager creates a nested group under a nested group and a second root
   group through the UI. Verify: migration roundtrip; service, grid and
   portable tests; e2e nested creation on the Spec A fixture project;
   `grep` for `role` in the touched packages at zero.
6. **B6 — retirement sweep.** Goal: the model pipeline and every row of
   §11 are gone and cannot return. Verify: the retired-symbols fitness
   check green; both knip modes; the vulture baseline at its new floor;
   `make quality-scan`.

## 14. Rollout

After B5 merges to `dev` and promotes, every prod project is recreated:
delete the projects, re-import CHARMS, Multimodal and PROBAST+AI from the
global catalogue, re-run the extractions the tests need. Local databases
run `make db-fresh`. The memory file for the train and the architecture
reference are updated in the same slice (dropped column, removed and
added endpoints, `last_reviewed`); the roadmap line in `CLAUDE.md` names
the trees spec as the current focus while it runs.

## 15. Testing

- Backend unit: scope renderers, ancestry walk, the section service
  rules (parent must repeat, the two cardinality refusals, noun rules),
  portable recursion and `MAX_DEPTH`, the migration derivation in
  `downgrade`.
- Backend integration: depth-three fixtures for the pipeline (identify
  per level, singletons materialized under the right entry, recursion
  stops at leaves), the entry endpoint (§13 B2), publish and discard on
  nested trees, exports (§13 B4), the roundtrip migration.
- Frontend: `EntrySection` recursion and state, the grid recursion, the
  dialog's `perGroup` mode, the copy keys.
- E2E: the Spec A fixture project gains a nested group and a second root
  group in B5; the identity spec covers the add, rename and description
  flows across them.
- Every claim of green quotes the command's output.

## 16. Risks

- The export geometry is the widest blast radius; the golden workbook
  gates B4 before any generalization.
- Prompt chains grow with depth; `MAX_DEPTH` on import and the editor's
  natural limits keep the block short.
- Three prompt versions bump in B1; provenance records the new versions,
  nothing recorded is invalidated.
- `section_extraction_service.py` and `ExtractionFullScreen.tsx` sit on
  the file-size ratchet: new logic goes to the new modules named above,
  and both files shrink.
- `dev` moves under a long train: every slice rebases on `dev` before
  its run, and only one auto-merge is armed at a time.
- B5's downgrade cannot represent several root groups; the spec says so
  rather than pretending.

## 17. Out of scope

- Reparenting a section (moving it under another parent).
- References between groups (an entry citing another group's entry).
- A reader for `entity_key_history`.
- Several extraction templates per project.
