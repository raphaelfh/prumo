---
status: in_progress
last_reviewed: 2026-09-06
owner: '@raphaelfh'
---

# Trees B5b — the Config tab renders the tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The template Configuration tab renders, and lets a manager
build, a section tree of **any** depth — the read side that B5's schema
half left two levels deep.

**Architecture:** `templateTree.ts` stops carrying the three-way
`TemplateSectionKind` and carries `depth`, `repeats` and `ownsChildren`
instead; `buildTemplateTree` and `deriveMoveTargets` recurse.
`gridRowShapes.buildRowShapes` and `TemplateGrid`'s JSX — which must
mirror each other row for row — both recurse, with indentation read from
a static ladder keyed by depth. The per-group ghost row moves from "the
section is a group" to "the section repeats", which is what makes the
FIRST child of a childless repeating section creatable at all.

**Tech Stack:** TypeScript strict, React 19 (React Compiler),
Tailwind v4, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-entry-group-trees-design.md`
§9 (Config tab), §3–§5 (the invariants the grid now has to express), §13
item 5 (B5's verify list: "a manager creates a nested group under a
nested group and a second root group through the UI").

## Why this is a slice of its own

B5 (#827) retired `role` from the schema, the services, the exports and
the run form. Its spec goal also covers the Config tab, and that half did
not ship: `buildTemplateTree` still maps `roots.map(...)` with a single
`children` level, so a grandchild renders **nowhere** — it is neither a
root (it has a parent in the input) nor reachable from one. Everything
that WRITES the tree is already depth-agnostic, so 0069 makes a tree the
Config tab cannot display. Splitting keeps #827 reviewable and puts the
whole ~18-file `template-config/` surface in one diff; one promotion at
the end means prod never sees the intermediate state.

## Global Constraints

- **React Compiler**: no `try`/`finally`/`throw` in component bodies; IO
  errors go through `ErrorResult`/`toResult`.
- **All UI copy through `frontend/lib/copy/`.** A deleted key must leave
  the copy-key fitness ratchet no larger (`scripts/fitness/check_copy_keys.py`).
- **Tailwind class names must be static literals.** A computed
  `` `pl-[${n}px]` `` is never compiled — the depth ladder is an array of
  literals, clamped at its last entry.
- **`buildRowShapes` mirrors `TemplateGrid`'s JSX exactly.** It is the
  roving-focus model's vertical axis; a row rendered but not shaped (or
  the reverse) breaks keyboard navigation silently.
- Dead code at zero in both knip modes; `npm run typecheck` (NOT
  `npx tsc --noEmit`, which type-checks nothing at the root).

## File Structure

| File | Responsibility after this slice |
| --- | --- |
| `templateTree.ts` | Recursive builder; `GridSection` carries `depth`/`repeats`/`ownsChildren`, no `kind`. `deriveMoveTargets` flattens at any depth. |
| `gridRowShapes.ts` | Recursive `buildRowShapes`; the per-group ghost becomes a per-**repeating-section** ghost. |
| `TemplateGrid.tsx` | `renderSection` recurses; indentation from the static depth ladder. |
| `TemplateGridSectionHeaderRow.tsx` | Reads `repeats`/`ownsChildren` instead of `kind`. |
| `TemplateInspector*.tsx`, `TemplateOutlineRail.tsx`, `dropSlot.ts`, `fieldMove.ts`, `gridDrag.tsx`, `revealSectionRow.ts`, `filterRetention.ts`, `useStructuralUndo.ts`, `useMoveFieldTo.ts` | Follow the `kind` removal; any two-level walk becomes recursive. |
| `AddSectionDialog.tsx` | `perModel` mode → `perGroup` (parent preset at any depth, cardinality select, noun field when `many`). |
| `frontend/lib/copy/templateConfig.ts` | `perModel*` keys → `perGroup*`; `newPerModelSection` → `newPerGroupSection`. |

## Tasks

### Task 1: `templateTree` builds a tree of any depth

**Files:** `templateTree.ts`, `templateTree.test.ts`

- [ ] **Step 1: failing test** — a three-level input (root group → nested
  group → leaf) returns a root whose `children[0].children[0]` is the
  leaf, with `depth` 0/1/2; and a self-referential parent chain does not
  hang.
- [ ] **Step 2: run it** — `npx vitest run templateTree`; expect the
  grandchild to be missing.
- [ ] **Step 3: implement** — recursive `build(entityType, depth)` over a
  `childrenByParent` index, with a `seen` set so a cycle in the data
  terminates. Drop `TemplateSectionKind`; add `depth`, `repeats`
  (`cardinality === 'many'`), `ownsChildren` (`children.length > 0`).
  `metaKeysFor` reads those three. `deriveMoveTargets` flattens
  recursively.
- [ ] **Step 4: run it** — green, and the existing two-level cases
  unchanged.
- [ ] **Step 5: commit.**

### Task 2: the row shapes recurse

**Files:** `gridRowShapes.ts`, `gridRowShapes` tests

- [ ] **Step 1: failing test** — a three-level tree yields the
  grandchild's section row, its field rows and its field ghost, in DOM
  order; a childless repeating section yields a per-group ghost.
- [ ] **Step 2: run it** — expect both missing.
- [ ] **Step 3: implement** — one `pushSection` recursion; the closing
  ghost fires on `section.repeats`.
- [ ] **Step 4: run it** — green.
- [ ] **Step 5: commit.**

### Task 3: the grid renders it

**Files:** `TemplateGrid.tsx`, `TemplateGridSectionHeaderRow.tsx`,
`TemplateGrid.test.tsx`

- [ ] **Step 1: failing test** — render a three-level tree; assert the
  grandchild's header row and its add-field ghost are in the document,
  and that a childless repeating section shows its "New per-{noun}
  section" ghost.
- [ ] **Step 2: run it** — expect absent.
- [ ] **Step 3: implement** — extract `renderSection(section)` and
  recurse; indentation from `HEADER_INDENT[Math.min(depth, last)]` /
  `FIELD_INDENT[...]`, both arrays of literal Tailwind classes.
- [ ] **Step 4: run it** — green; `buildRowShapes` and the JSX still
  agree (the roving test covers it).
- [ ] **Step 5: commit.**

### Task 4: the dialog speaks groups, not models

**Files:** `AddSectionDialog.tsx` + test, `lib/copy/templateConfig.ts`,
call sites

- [ ] **Step 1: failing test** — `perGroup` mode with a depth-2 parent
  posts `parentEntityTypeId` = that parent and, with cardinality `many`,
  an `entryLabel`.
- [ ] **Step 2: run it.**
- [ ] **Step 3: implement** — rename the mode and its copy keys; the
  ghost's `onAddPerModelSection` becomes `onAddPerGroupSection`.
- [ ] **Step 4: run it**, plus `check_copy_keys.py`.
- [ ] **Step 5: commit.**

### Task 5: prove it end to end

**Files:** `frontend/e2e/flows/extraction-entry-identity.ui.e2e.ts` (or a
sibling on the Spec A fixture project)

- [ ] **Step 1** — a manager creates a nested group under a nested group
  and a second root group through the UI, and both render.
- [ ] **Step 2** — run it against the local stack.
- [ ] **Step 3: commit.**

## Verify

- `npm run typecheck`, `npm run lint`, `npm run test:run`
- `npx knip` and `npx knip --production` at zero
- every `scripts/fitness/*.py` gate
- the Playwright flow above
- `grep -rn "TemplateSectionKind\|groupChild\|perModel" frontend/` at zero
