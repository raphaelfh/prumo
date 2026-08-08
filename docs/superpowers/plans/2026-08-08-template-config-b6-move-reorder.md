---
status: draft
last_reviewed: 2026-08-08
owner: '@raphaelfh'
---

# Template config B-6 — move + reorder + lazy Radix

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development task-by-task. Built from a
> full structural map (Explore agent, 2026-08-08) with exact file:line
> anchors — anchors reference the tree at `b441abe5` (dev + B-5b).

**Goal:** Fields move and reorder — dnd-kit drag (edge auto-scroll,
drop-on-collapsed-header = end of that section), `⌘⇧↑/↓` keyboard move
re-parenting across boundaries (announced), `⌘⇧M` "Move to section…"
command menu, the inspector Section combobox as the accessible move
mechanism — with a single draft-session Undo stack (6s toast) on
structural mutations, plus the lazy-mount Radix perf item deferred from
B-5.

## HARD GATE (do T0 first — the slice is physically un-landable without it)

The file-size ratchet freezes: `TemplateGrid.tsx` (baselined 1566,
actual 1566 — CANNOT grow by one line), `lib/copy/extraction.ts` (958),
`TemplateConfigGridPanel.test.tsx` (1027). Near ceiling (800):
`TemplateConfigGridPanel.tsx` 743, `TemplateGrid.test.tsx` 736.

## Load-bearing map facts

- **`reorderFields` was DELETED in B-5 Task 8** (recover the
  resolve-don't-reject inspection from commit `628eb331`: PostgREST
  builders RESOLVE with `{error}` payloads — a bare Promise.all
  throw-check silently swallows RLS refusals).
- **`ExtractionFieldUpdate` cannot express a move** — no
  `entity_type_id` in `ExtractionFieldSchema`
  (frontend/types/extraction.ts:325-421); `updateField` would accept it
  at runtime. Prefer a dedicated `moveField(fieldId, entityTypeId,
  sortOrder)` service fn over widening the shared schema.
- **🔴 RLS does NOT block cross-template/cross-project moves**
  (baseline_v1.sql:2501-2528 — no WITH CHECK, so USING re-checks the
  NEW row: any template in any project the user is a member of
  qualifies). Constrain destinations CLIENT-SIDE to the current
  template's sections; state the hole honestly in the PR; B-7's typed
  endpoints own the server-side fix. Write policies are
  `is_project_member` (known debt, spec:428-430).
- **Fields have ZERO placement constraints in the DB** (no
  __table_args__ on ExtractionField; FK is CASCADE) — the combobox may
  offer every section (roots, group, child sections). The
  ck/role/parent constraints govern SECTIONS only (B-8 territory).
- **sort_order**: per-section for fields (a RENDERING convention, not a
  DB invariant — no unique/scoping/CHECK); template-flat for sections.
  `GridField` does NOT carry sortOrder (templateTree.ts:85-172) — add
  it. Reorder writes should renumber the whole affected section(s),
  not just the moved row (ties tolerated but gaps/dupes accumulate).
- **dnd-kit**: core/sortable/utilities installed; `@dnd-kit/modifiers`
  NOT installed. Working precedents are flat div lists only
  (AllowedValuesList.tsx:24-241; ArticleAuthorsField.tsx:189-192 has
  the `activationConstraint: {distance: 6}` pattern). Edge auto-scroll
  is DndContext-default against the panel's overflow container
  (TemplateConfigGridPanel.tsx:663).
- **Grab handle is decorative** (TemplateGrid.tsx:541-543 field,
  :860-862 header — no data-cell attrs, not in the roving axis).
  Deliberate choice: keep it NON-roving; the WCAG 2.5.7 keyboard
  alternative is ⌘⇧↑/↓ + ⌘⇧M + the combobox (what the spec promises).
  The group accent rule paints on the grab `<td>`
  (`[&>tr>td:first-child]:border-l-2`, :1470-1473) — preserve.
- **Modifier gate**: `ROVING_KEYS` (TemplateGrid.tsx:201-208) is
  modifier-blind — `⌘⇧↑` currently falls through to a plain rove; the
  meta/ctrl+shift branch must land BEFORE the gate at :1183.
  `moveVertical`'s naive rows[idx±1] is WRONG for moves (lands on
  headers/ghosts) — a boundary-aware next-slot helper that SKIPS
  section/ghost rows is needed.
- **Pending rows: DISABLE move** (precedent: deleteDisabled,
  TemplateGrid.tsx:141-145/:521-522/:1414). Teaching the insert
  queue's takenNames/sortBase/committedCount maps
  (useInsertTemplateField.ts:96-104) to re-key mid-session is not worth
  it; also a pending move via overrides would be overwritten by
  `p.sortOrder` in mergedFields (TemplateConfigGridPanel.tsx:228-249).
- **Inspector combobox** replaces the read-only section row
  (TemplateInspector.tsx:299-305); needs a `sections` prop threaded to
  BOTH hosts (panel :717-738); FieldDraft/draftFromField/draftsEqual/
  fieldContentKey/updates-payload (:127-271) all grow `entityTypeId` —
  **fieldContentKey especially** (:196-212, the remount key): without
  it the inspector goes stale after a grid-side move. Combobox move =
  end-of-destination sort_order (panel computes max, :511-516 pattern).
- **Undo: nothing exists** (zero hits repo-wide; no toast action call
  sites). Sonner 2.x supports `toast(msg, {action, duration: 6000})`
  natively. Design: panel-local `StructuralUndo = {label, invert}`
  stack next to pendingInserts (:165); push the inverse in onSuccess
  (never before the call — the failed-write double-toast trap); undo
  re-enters through `saveFieldUpdates` (:367) so pending routing +
  probe + invalidation are inherited; NEVER setQueryData on
  templateEntityTypesKeys (shared with worklist/dashboard). B-6 scope =
  moves/reorders only; deletes-never-confirm stays B-9 (two structural
  idioms for one slice — intentional, state in the PR).
- **Lazy Radix breakage inventory**: trigger-button laziness breaks 10+
  named tests (TemplateGrid.test.tsx :134-169, :207-223, :544-617,
  :653-735; panel test :354-609) AND the roving invariant
  (findFocusTarget queries `[data-cell-row]` — an unmounted actions
  trigger strands arrow-right focus). The ONLY compatible pattern:
  **always-mount the trigger button** (identical aria-label/data-cell-*/
  tabIndex), lazy-mount only the Radix DropdownMenu/Tooltip WRAPPER on
  warm (hovered || focus-within || open); never un-warm while open or
  focus-within; keyboard entry needs controlled `open` (warm + open in
  one keypress — test :162-169 pins it); warm state row-local (lifting
  re-renders 82 rows per mousemove); warm-up must not preventDefault
  (kills T6 drag activation). RE-MEASURE the 2.2ms with the trigger
  always mounted — if saving < ~1ms, DROP the item (report, don't ship
  risk).
- **E2E**: no template-config E2E exists; the spec asks for
  drag-between-sections Playwright (spec:417-419) — the harness is new
  work; keep it a stated known gap unless T6 proves unstable.

## Tasks

- **T0 — Split TemplateGrid.tsx + copy headroom (mechanical, zero
  behavior).** Extract FieldRow (:495-771), SectionHeaderRow
  (:773-981), Ghost rows/editors (:992-1101), cell editors (:402-493)
  into sibling modules; new copy namespace
  `frontend/lib/copy/templateConfig.ts` (wire into lib/copy/index.ts)
  for ALL new B-6 strings; `--update-baseline` to TIGHTEN (files
  shrink). All existing tests stay green untouched.
- **T1 — Write layer**: re-introduce `reorderFields` (with the
  resolve-don't-reject inspection) + new `moveField`; `sortOrder` onto
  GridField; service unit tests (partial failure → ErrorResult).
  Multi-line `await supabase\n.from(` house style keeps the fitness
  regex quiet — state the debt honestly.
- **T2 — Cell model**: `moveRow` effect + boundary-aware next-slot
  helper (skips section/ghost rows); modifier-aware key event; full
  unit coverage BEFORE DOM work.
- **T3 — Keyboard move wired**: modifier branch before the :1183 gate;
  interpret moveRow in the effects loop; write through the panel;
  focusCellSoon refocus; first `role="status"` live region (precedent
  SaveSlot.tsx:54-55); verify ⌘⇧-arrow chords in a REAL browser
  (macOS may claim them — have Ctrl⇧ fallback).
- **T4 — Inspector Section combobox** (ships BEFORE dnd so the
  accessible path exists independently): all the FieldDraft plumbing
  incl. fieldContentKey; destination list = current template only;
  end-of-destination sort_order; disabled on pending rows.
- **T5 — Undo stack + 6s toast** retrofitted onto T3/T4 mutations (and
  T6 when it lands): per the design above; new panel test FILE (the
  old one is frozen).
- **T6 — dnd-kit drag**: DndContext around the table; per-section
  SortableContext; handle on the existing ⠿ tds (preserve the accent
  selector); PointerSensor distance-6; collapsed-header drop = append;
  drag disabled while filtering ("Clear search to reorder", spec
  :179-180); coarse-pointer long-press; DISABLE dnd-kit's
  KeyboardSensor (the grid's roving handler owns keyboard; ⌘⇧ paths
  are the a11y story). Decide @dnd-kit/modifiers add-dep vs hand-rolled
  vertical constraint. HIGHEST RISK: dnd-kit in a multi-tbody table
  with colSpan rows + roving tabindex is unproven — timebox a spike;
  if the table fights, fall back to reorder-within-section only via
  drag + full move via T3/T4/T7, and report.
- **T7 — `⌘⇧M` command menu**: CommandDialog (precedent
  CommandPalette.tsx:25-70); row `⋯` menu entry MUST use the
  menuClaimedFocus + onCloseAutoFocus hand-off (TemplateGrid.tsx:811,
  :940-950 — opening a focus-trapping dialog from onSelect is the
  documented failure); panel-scoped keybinding next to ⌘.
- **T8 — Lazy Radix (LAST)**: the always-mounted-trigger pattern above;
  re-measure; drop if <1ms.

### Verify (slice gate)

Full suites + tsc + lint per task; `make quality-scan` before PR;
REAL-browser pass: drag within/between sections, drop on collapsed
header, ⌘⇧↑/↓ move with announcement, ⌘⇧M, combobox move, Undo toast
(6s) reverting a move, drag-disabled-while-filtering, pending-row move
disabled. State the E2E gap.

## Non-goals

Section move/reorder beyond what exists (B-8 owns sections-born-inline
+ per-model creation + the section-inspector Placement rules);
deletes-never-confirm + full draft machinery (B-9); server-side move
validation (B-7); gutter inserter (spec's fine-pointer insert — defer
with dnd polish if T6 timeboxes out).
