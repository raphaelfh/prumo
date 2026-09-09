---
status: draft
last_reviewed: 2026-09-09
owner: '@raphaelfh'
---

> **Status:** Draft · Last reviewed: 2026-09-09 · Owner: @raphaelfh

# Article Editing — Zotero-lean Rework

**Date:** 2026-09-09
**Status:** Draft for review

## 1. Problem

The article editor is a form when it should be a record. Verified in the
browser and in `ArticleForm.tsx` on 2026-09-09:

**Three layers of chrome wrap every field.** A section heading with a
description ("Basic information / Title, abstract and authors"), then a
bordered card with *its own* heading and description ("Article details /
Title, abstract and author information"), then labelled inputs several of
which carry helper text restating their own placeholder. Most of the panel's
width is spent on chrome rather than values.

**Fields sit in columns inside a narrow panel.** `ArticleForm.tsx:825` wraps
Publication and Identifiers in `xl:grid-cols-2`, and inner grids add
`sm:grid-cols-2` and `sm:grid-cols-3` (`:846`, `:908`, `:937`, `:993`,
`:1013`, `:1083`).

**That wrapper also breaks the section order.** Because Publication and
Identifiers are side by side, the rail's linear order (basic → publication →
identifiers → additional → files) does not match what the eye sees: choosing
"Identifiers" scrolls to something *beside* Publication, not below it. The
reported "order seems wrong" is this, not a wrong list.

**Every value is an always-on input**, so a record you are mostly *reading*
presents fifty editable boxes.

Reference: Zotero's item pane — one flat list of label→value rows, no cards,
no per-section descriptions, values that become inputs only when clicked.

## 2. Goal

Read-first, edit-on-click. The panel shows a dense, single-column list of
label→value rows. A value renders as text; clicking (or focusing and pressing
Enter) turns that one row into an input. Section headings are plain text with
no card and no description.

## 3. Design

### 3.1 The row primitive

A new `ArticleFieldRow` owns one field:

- **Read state:** label on the left (fixed width, right-aligned, muted), value
  on the right as text. Empty values render a muted placeholder that is part
  of the click target, so an empty field is still reachable.
- **Edit state:** the value area becomes the appropriate control (input,
  textarea, select, switch). Enter or blur commits to local form state; Esc
  reverts that row and returns to read state. Only one row is in edit state at
  a time.
- **Commit ≠ persist.** Committing a row updates `formData` exactly as typing
  does today. Nothing reaches the server until Save. The existing dirty
  tracking, guard and save flow are unchanged — this changes how a value is
  *entered*, not when it is stored.

**Accessibility.** The read state is a `button` (or a control with
`role="button"` and `tabIndex=0`), so it is reachable by keyboard and
announces itself; Enter and Space enter edit mode. On entering edit the input
takes focus; on Esc or commit, focus returns to the row. The label is
associated with the control by `id`/`htmlFor` so the accessible name survives
the swap. Rows never fold their label to `hidden`.

### 3.2 Chrome removal

- Delete the nested card wrapper and its heading/description from every
  section. A section is a plain heading plus its rows.
- Delete helper text that restates a placeholder. Keep helper text that says
  something the field cannot (format constraints, consequences).
- Remove `xl:grid-cols-2` at `:825` and every inner `sm:grid-cols-*`. One
  column, top to bottom, so the visual order matches the rail order.

### 3.3 Section order

Linear and unchanged as a list: Basic information → Publication → Identifiers
→ Additional information → Files. Removing the two-column wrapper is what
makes the rendered order match it.

### 3.4 Panel chrome

- Save/Cancel move into the same row as the section icons, right-aligned. In
  the stacked layout this removes one of three stacked bars from a pane that
  has little vertical room. (Carried over from the previous plan, where it was
  deferred into this rework; a WIP test exists at
  `.superpowers/sdd/2026-09-09-articles-panel-density/fix3-wip-test.patch`.)
- The panel-toggle control moves into the global header, to the right of the
  notification icon.
- In the stacked layout the toggle uses a glyph that reads as a
  bottom-opening panel rather than a right-opening one.

### 3.5 Decomposition (required, not optional)

`ArticleForm.tsx` is at **exactly 1213 lines against its shrink-only cap of
1213**. It cannot grow by one line. Each section moves into its own component
under `frontend/components/articles/sections/`, leaving `ArticleForm` owning
state, save and the section anchors. This is a precondition of the work, not a
tidy-up after it.

## 4. What does not change

- The save flow, `handleSave`, and the two-phase staged-file upload.
- Dirty tracking (`onDirtyChange`) and the row-swap guard.
- The URL contract (`articleEditor`, `articleId`, `articleView`).
- Field validation rules and the required-title behaviour.

## 5. Testing

- `ArticleFieldRow` unit tests: read→edit→commit, Esc reverts, keyboard entry
  (Enter/Space), empty value still reachable, label stays associated across the
  swap.
- A test that the form reports dirty after a row commit, and clean after Esc —
  this is where an editing-model change could silently break the guard.
- A test that no section renders a nested card heading, so the chrome cannot
  quietly come back.
- Section-order test asserting the anchors appear in DOM order.
- `check_file_size.py` must pass **without** a baseline bump, proving the
  decomposition actually happened.
- Design review at 1600px and 900px before "done": both layouts, read and edit
  states.

## 6. Non-goals

- No change to how articles are saved or validated.
- No change to `ArticlesList`, the table, or its column persistence.
- No autosave — Save stays explicit.
- `variant="page"` IS deleted here. Verified 2026-09-09: `ArticleSidePanel`
  is the only production consumer of `ArticleForm` and hardcodes
  `variant="panel"`, so the page path is unreachable, and
  `.claude/rules/frontend.md` prescribes deleting orphaned code with its test.
- No inline editing in the table itself.
