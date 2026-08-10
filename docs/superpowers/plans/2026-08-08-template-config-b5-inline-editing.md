---
status: draft
last_reviewed: 2026-08-08
owner: '@raphaelfh'
---

# Template config B-5 — inline cell editing; dialogs deleted

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans task-by-task.
>
> **Panel-reviewed 2026-08-08** (3 agents / 5 folded lenses:
> cell-contract fidelity, React-Compiler+focus feasibility,
> Enter-chain concurrency + write paths, test-coverage + capability
> regression, YAGNI). All 3 BLOCKINGs + MAJORs folded in below. The
> AI-dispatch re-point was SPLIT OUT (own slice, see Non-goals); the
> lazy-mount Radix perf item moved to B-6.

**Goal:** The Configuration grid implements the spec §2 Airtable cell
contract — click focuses/selects (never edits; control cells act on
FIRST click); second-click/Enter/F2/typing edits (typing replaces);
Enter commits, moves down, and chains into the ghost row; 3-rung Esc
ladder; Tab exits the grid (APG); arrows rove an ARIA grid — and the
field dialogs plus the dead pre-grid component island are deleted with
zero capability regression.

**Architecture:** A pure, table-driven cell state machine
(`gridCellModel.ts`, input = (cellKind, mode, event)) de-risks the whole
contract before DOM work. Focus moves to roving-tabIndex gridcells (the
invariant: EXACTLY ONE `tabIndex=0` at all times, defaulting to the
first cell). Text cells commit through `updateField`; the ghost row gets
an optimistic panel-local insert queue (five concurrency rules below).
The inspector absorbs EVERY dialog-only capability (dispositions,
allow_other, unit editing, option reorder) BEFORE the deletion task, and
gains visibility state + `⌘.` + a Sheet fallback below the container
breakpoint. Delete keeps the widened-but-advisory impact probe until
B-9; SQLSTATE 23503 mapping is the real invariant. NO new
`supabase.from(` call sites.

## Global Constraints

- Ceiling: **dev**.
- React Compiler `all_errors` (also in vitest): no try/finally or throw
  in component/hook bodies; ZERO `'use no memo'` opt-outs exist — keep
  it. The proven compiler-safe editor recipe: `autoFocus` +
  `onFocus={e => e.currentTarget.select()}` for focus-then-edit; seed
  the draft from the typed key + `preventDefault` for typing-replaces
  (zero refs/effects — the rename Input at `TemplateGrid.tsx:290-304`
  already compiles this pattern). Imperative `.focus()` ONLY inside
  event handlers, never in effects keyed on the roving coordinate
  (refetch re-renders would steal focus). The serialized insert queue
  lives at module scope, not in a hook body.
- IME/dead-key: branch on `isComposing`/`key === 'Dead'` — fall back to
  focus-then-edit without seeding (pt-BR accents).
- No NEW `supabase.from(` call sites (fitness regex is line-anchored;
  the Task 6 widening goes INSIDE existing service functions). State
  honestly in the PR: the proposal-records count is new architectural
  debt on a workflow table, parked at B-7 with the missing
  `(entity_type_id, name)` unique index.
- Visual contract: 30px rows (editors height-capped like the `h-6`
  rename input), ring on the whole `<td>` driven by MODEL STATE via
  className (`:focus-visible` misses mouse clicks), roles added to the
  EXISTING table elements (keep `table-fixed` + per-column `<td>`s — no
  colSpan editor rows — or the group accent rule breaks), ghost hidden
  while filtering stays (test pinned).
- Esc is ONE central dispatcher fed by the cell model (rung 1 cancel
  edit → rung 2 close inspector, focus returns to the cell → rung 3
  clear focus/search) — not per-editor stopPropagation discipline.
- Capability-regression checklist runs BEFORE the deletion task and at
  a NARROW container width (< 40rem): field add (top-level AND
  child-section) / edit label,type,required,options+REORDER,units,
  allow_other,dispositions,✨,description / delete-with-impact-block /
  section add,rename,delete. Empirical a11y: a
  `querySelectorAll('[tabindex="0"]').length === 1` regression test.
- Inherited BLOCKINGs: impact probe stays until B-9, widened to
  `extraction_proposal_records` — but it is ADVISORY (reject-only
  decisions and consensus/published rows RESTRICT yet count 0); the
  23503→friendly mapping is the invariant (PgError precedent:
  `lib/error-utils.ts:41-46`, `projectSettingsService.ts:149-153`).

## Enter-chain concurrency rules (Task 4 — all five are load-bearing)

1. Optimistic rows live in PANEL-LOCAL pending state merged into the
   tree BEFORE `buildTemplateTree` — never `setQueryData` on the shared
   `templateEntityTypesKeys` cache (the worklist/dashboard read it).
   Reconcile by client key → returned server id.
2. Suppress `invalidateStructure` while the queue is non-empty;
   invalidate ONCE on drain (a 5-field chain is otherwise 10 refetches
   racing the pending rows).
3. `sort_order` computed at DEQUEUE time, counting prior queued +
   committed inserts in the section.
4. Collision suffix must include IN-QUEUE pending names — there is NO
   unique constraint on `(entity_type_id, name)` (verified: model,
   baseline, all migrations); a stale-list suffix inserts duplicates
   SILENTLY (field keys feed prompt/value mapping). Never a dead-end
   toast mid-chain.
5. Updates-behind-inserts: an edit on a still-pending row queues behind
   its insert by client key, and the cell model's focus coordinate
   remaps client key → server id on confirm.

Plus: hoist the permission probe once per queue session (not per
insert); Enter on an EMPTY ghost exits the chain (model transition, with
a test); never-typed ghost auto-discards on blur.

## Key map anchors

- Grid: `TemplateGrid.tsx` — FieldRow :120-243 (label button :159-178,
  ring classes :166-167), SectionHeaderRow :245-363 (rename :289-304,
  commit-on-blur :302), GhostRow :365-394 (SECTION-OWN fields only —
  child sections at :494-511 have NO ghost today), `＋ ▾` onAddField
  :343 → `TemplateConfigEditor.tsx:191-199` (opens the dialog B-5
  deletes), INDENT :89-94, table-fixed :432, accent :464-467.
- Shell: `TemplateConfigGridPanel.tsx` — selection :71, 2-rung Esc
  :103-109, withRawField :96-101, inspector always-mounted (hidden
  below `@[40rem]`) :233-240.
- Writes: `extractionFieldService.ts` — insertField :144, updateField
  :162, deleteField :182 (raw error → toast today), validateFieldImpact
  :97-135 (counts ONLY reviewer_decisions, `.neq('decision','reject')`).
- Ghost ingredients in `useFieldManagement.addField` :154-212 (Zod
  :165, collision dead-end :174-178, sort_order :181-184, insert shape
  :186-198). Slug util: `AddFieldDialog.tsx:51` — extract it for the
  insert hook + `AddSectionDialog.tsx:77`; let AddFieldDialog's copy die
  with the file.
- Inspector: `TemplateInspector.tsx` — escape hatch comment :23-27
  (type/key/DISPOSITIONS parked in the dialog), `showReorder={false}`
  :266 (the dialog passes true — flip it), AllowedValuesList already
  imported :14; AllowedUnitsList/UnitEditor re-host from the dialogs.
- Dialog-only capabilities inventory: dispositions
  `EditFieldDialog.tsx:340,361`; allow_other + other_label/placeholder
  :456/:85; other-specify plumbing `TemplateFieldDialogs.tsx:102-103`;
  DeleteFieldConfirm host + data `TemplateFieldDialogs.tsx:108-118`.
- Orphan island (6 files): FieldsManager, FieldsTable, FieldsHeader,
  EmptyFieldsState, FieldsManagerWithDragDrop (602 ln),
  useFieldsManagerState; dead copy keys `lib/copy/extraction.ts:619,784`.
- 5 RESTRICT FKs (verified exact): extraction_workflow.py —
  proposal_records :89, reviewer_decisions :140, reviewer_states :220,
  consensus_decisions :326, published_states :412.
- Tests touched per task (the panel's blast-radius map):
  `TemplateGrid.test.tsx` breaks at Tasks 2 (:78 inversion), 3
  (:134-137 sr-only), 4 (:139-142 ghost testids), 5 (:42-51
  sectionActions compile), 8 (:123-132 menu reachability if any mount
  change); `TemplateInspector.test.tsx:205-210` (escape hatch) inverts
  when type absorption lands; `useFieldManagement.republish.test.tsx`'s
  never-republish invariant MIGRATES to the new insert/delete hooks
  before the island dies; `AddFieldDialog.test.tsx:52-68` schema tests
  RELOCATE to `frontend/test/extraction-field-other.test.ts`; NEW test
  files: gridCellModel, useInsertTemplateField, TemplateConfigGridPanel
  (first ever — the Esc ladder), extractionFieldService (first ever —
  widened probe + 23503 mapping), inspector capability absorption.

## Tasks (each TDD; suite + tsc + lint before each commit)

1. **Pure cell model** — `gridCellModel.ts` + test. Input =
   (cellKind: text|type|required|sparkle|options|actions, mode, event).
   Transitions: click-focus vs control-first-click, second-click/Enter/
   F2/typing→edit, Enter-commit-move-down, ghost-chain (incl. EMPTY-
   ghost-Enter exits), Esc rungs, Tab EXITS the grid (APG; arrows are
   the in-grid movement), focus-recovery rule when the focused
   coordinate unmounts (filter change, delete): nearest surviving cell.
2. **ARIA grid + roving tabIndex** — roles on existing table elements;
   ONE tab stop (invariant test: exactly one `tabindex="0"`, default
   first cell — the B-1 regression); ring from model state via
   className on the `<td>`; grid-level `focusin` listener syncs the
   roving coordinate (Radix menu close refocuses its trigger — the
   coordinate must follow); central Esc dispatcher skeleton. Invert
   `TemplateGrid.test.tsx:78`; rewrite :84-141 against cells.
3. **Text cell editors** (Label; Key when shown) — the compiler-safe
   recipe; commit on Enter advances focus DOWN; blur commits; Esc
   reverts; IME branch; edited-away rows STAY VISIBLE until the query
   changes (retention in the panel filter, not the tree build); editors
   height-capped. Tests: cell editors + useUpdateTemplateField
   extension + TemplateGrid.test.tsx sr-only case moves here if touched.
4. **Ghost-row Enter-chain** — `useInsertTemplateField` implementing
   the FIVE concurrency rules + shared slug util + collision suffix;
   ghost rows for CHILD sections too; `＋ ▾` New-field re-points to
   focusing the section's ghost row; keep the isFiltering gate + test;
   never-republish invariant test lands HERE. (Formerly Task 5 —
   ordered before control cells so the inspector work in 5 can edit
   pending rows' full properties.)
5. **Control cells + inspector absorption** — Type menu (impact probe
   on type change), Required real-checkbox (14px look, drop sr-only +
   its test), ✨/Options deep-link; inspector ABSORBS: dispositions
   (ADR-0016 flags), allow_other + other_label/placeholder (+ the
   other-specify create/remove plumbing), AllowedUnitsList/UnitEditor
   re-host, option REORDER (`showReorder` flip). Inspector gains
   visibility state + `⌘.` toggle + Sheet fallback below `@[40rem]`.
   Tests: inspector capability suite; the :205-210 escape-hatch test
   inverts here (type edits inline now), NOT at deletion time.
6. **Section rename ownership + Esc ladder** — SectionHeaderRow owns
   its draft (sectionActions loses renamingId/renameValue — fix the
   test construction at :42-51); 3-rung Esc through the central
   dispatcher with focus-return; resolve commit-on-blur vs Esc-cancel.
   Tests: first TemplateConfigGridPanel test file (the ladder).
7. **Delete safety** — widen `validateFieldImpact` (Promise.all +
   `head:true` count on proposal_records, INSIDE the service; advisory
   — reject-only test case); `deleteField` maps 23503 → typed PgError →
   friendly copy; DeleteFieldConfirm's NEW HOST is TemplateConfigEditor
   directly (named!), fed by a small delete mutation (not
   useFieldManagement), `onValidate` folded in. Tests: first
   extractionFieldService test file.
8. **Deletions (purely subtractive) + checklist** — delete
   TemplateFieldDialogs/EditFieldDialog/AddFieldDialog (+ relocate its
   :52-68 schema tests first), the 6-file orphan island,
   useFieldManagement + its republish test (invariant already migrated
   in Task 4), withRawField/fieldDialog/onEditField plumbing, dead copy
   keys. AddSectionDialog SURVIVES until B-8 (stated). Run the full
   capability checklist (incl. NARROW width) + the tab-stop sweep.

### Verify (slice gate)

`npm run test:run` + `npx tsc -p tsconfig.app.json --noEmit` +
`npm run lint` + `make quality-scan`; browser pass on seeded CHARMS in
light+dark: cell contract by hand (click/2nd-click/Enter/F2/typing/Esc
ladder/Tab-exit/arrows), Enter-chain 5 fields incl. a name collision +
a child section, delete-blocked field shows the friendly message,
narrow-container Sheet editing, `⌘.`. Known gap (stated in PR): no E2E
of the cell contract — B-9 candidate with the publish sheet.

## Non-goals

- **AI-dispatch re-point → its OWN slice** (B-5b, next on the train):
  run-form path threads the section list from `runDetail` →
  `entityTypesFromRunView` (`ExtractionFullScreen.tsx:187-191` — NOT
  useExtractionData, which holds no entity reads) into the two batch
  hooks as an optional `sections` param; the worklist Full-AI path KEEPS
  the chained live fallback (it dispatches with no run view);
  `getModelChildSections` is NOT deleted. Blast radius: 4 test files
  (extractionPartialFailure, useExtractionFormAIActions, spinner-fix,
  ExtractionFormView mocks).
- Lazy-mount per-row Radix (2.2ms) → B-6 (it re-breaks menu
  reachability tests and interacts with roving focus; B-6 owns the row
  interaction rework anyway). Must keep the pair mounted while
  open/focus-within when it lands.
- Drag/move/reorder, gutter inserter, `⌘⇧` moves → B-6. Typed
  endpoints + RLS + the `(entity_type_id, name)` unique index → B-7.
  `entry_label`, per-model section creation, sections-born-inline,
  header-menu Duplicate, no-match `＋ New field "<query>"` → B-8.
  Draft diff/lock/History/Discard; deletes-never-confirm → B-9.

## B-5b (follow-up slice) — SHIPPED

The AI-dispatch re-point sketched above, as landed. The bug: the
backend extracts from the run's pinned snapshot, but the run form
decided WHICH sections to loop over from LIVE
`extraction_entity_types` rows (`getModelChildSections` →
`queryEntityTypesWithFallback`) — post-B-4 a manager's unpublished
draft section got dispatched (the backend cannot extract it) and a
published-but-since-deleted one was skipped. The loop and the prompt
disagreed.

What shipped:

- Optional `sections` param on both batch entry points:
  `useBatchSectionExtractionChunked.extractAllSections`
  (`BatchSectionExtractionParams`; the list is stripped off before the
  request reaches the service) and
  `useBatchAllModelsSectionsExtraction.extractAllSectionsForAllModels`
  (`AllModelsSectionsParams`; sections are entity-type-level, so one
  list serves every model — including the freshly-created-models
  chain).
- The run form threads the run-pinned list: `runDetail` →
  `entityTypesFromRunView` → `useEntityTypePartition.modelChildren` →
  `ExtractionFormView` → new `sections` prop on
  `useExtractionFormAIActions` → all three dispatch paths (per-model,
  cross-model, created-models chain).
- The worklist Full-AI path (`ArticleExtractionTable` →
  `useFullAIExtraction`) KEEPS the live fallback — it dispatches with
  no run view loaded. The fallback is CHAINED, never swapped: a
  missing OR EMPTY provided list falls through to
  `getModelChildSections` (an empty list must not "succeed" against an
  empty tree). `getModelChildSections` is NOT deleted.

Tests: `frontend/test/hooks/batchExtractionSectionSource.test.tsx`
(provided-list / fallback / empty-is-absent / no-leak-into-request for
both hooks) + threading specs in `useExtractionFormAIActions.test.tsx`
and `ExtractionFormView.test.tsx` (spy-mock pins the view →
hook prop). The existing partial-failure / spinner / form-view mocks
needed no changes — the fallback path is byte-identical.
