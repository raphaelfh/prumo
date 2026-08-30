---
status: approved
last_reviewed: 2026-08-28
owner: '@raphaelfh'
---

# Sections/fields grid — density & type normalization

> **Status:** Approved · Date: 2026-08-28 · Deciders: @raphaelfh
> **Scope:** visual only — typography, spacing, hierarchy, and control
> treatment on the template-config grid (grid panel + outline rail +
> inspector). Structure and interactions unchanged, so the ~5,800 lines of
> existing tests over `TemplateConfigGridPanel` / `TemplateGrid` /
> `TemplateInspector` stay valid.
> **Slice:** D of four — the last. **Depends on:** slice B's scale (#723);
> stacks after slice C (#726), which touches sibling files.

## Problem — measured, not felt

All numbers taken live on the Configuration tab with the seeded CHARMS v1.1
template (14 sections, 82 field rows), on the B+C branch.

### 1. Six font sizes, five of them invented

| Size | Count | Where | Source |
|---|---|---|---|
| **9.5px** | 3 + inspector | Column headers (`LABEL·TYPE·REQ.`), inspector section labels | `TemplateGrid.tsx:589`, `inspectorShared.tsx:22` |
| **10px** | — | Mono llm-key placeholders | `TemplateGridFieldRow.tsx:251` |
| **10.5px** | **120** | Type chips, llm hints, nested rail entries, header counts | `TemplateGridFieldRow.tsx:84,233,325`, `TemplateOutlineRail.tsx:45`, `TemplateGridSectionHeaderRow.tsx:192,211` |
| 11px | 25 | Rail top-level entries | `TemplateOutlineRail.tsx:77` |
| 12px | **131** | The field labels — the most-read text on the screen | `TemplateGrid.tsx:582` (`text-xs` on the table) |
| 13–14px | 10 | Header chrome, pane titles | correct already |

The system (`frontend-ux`) prescribes **`text-[13px]` body** and uses
**11px** as its floor everywhere else (`text-[11px] uppercase tracking-wide`
is the established table-header idiom — see `ArticleExtractionTable`). This
grid invented a private micro-scale below that floor, and put its body one
step under the system's.

### 2. Every in-grid control is under the minimum target size

**386 of 386 buttons inside the table measure under 24px** in at least one
dimension (WCAG 2.5.8 target-size minimum):

| Control | Hit area | Count |
|---|---|---|
| Collapse chevrons (section headers) | **14×14** | 14 |
| Sparkle (AI instruction) + kebab (field actions) | **18×18** | ~170 |
| Field-label buttons (open the inspector) | width×**16** | 82 |
| `+ New field` / `Add` ghost buttons | width×**16** | ~30 |
| `Change type` chips | width×**22** | ~90 |

The row is 30px tall, so most of these could fill it — the hit areas are
small by construction (`h-[18px]`, `min-h-[18px]` at
`TemplateGridFieldRow.tsx:325,376`), not by necessity.

### 3. Six control heights on one screen

14 / 16 / 18 / 22 / 23 / 28px (measured earlier in the slice-B work). The
28px toolbar is B's scale; everything below it is this grid's raw elements.

## Decisions

### Type collapses to the system scale — three sizes

| Role | Today | Becomes |
|---|---|---|
| Field labels, section titles in grid rows | 12px | **13px** (`text-[13px]`) |
| Everything secondary — type chips, hints, mono keys, rail entries (both levels), counts, `+ New field` | 9.5–11px | **11px** (`text-[11px]`) |
| Uppercase micro-labels — column headers, inspector labels | 9.5px | **11px** `uppercase tracking-wide` (the house table-header idiom) |
| Pane titles | 14px | unchanged |

Rail hierarchy is expressed by **indent and color, not size** — the nested
10.5px entries take the same 11px as their parents and keep their `ml-3.5`
and muted color. Shrinking type to signal nesting is what produced the
120-element micro-text class.

### Every in-grid control reaches a 24px hit area — rows stay 30px

- **Sparkle + kebab row actions** become `size="icon-xs"` Buttons — slice
  B's 24×24 token with the 14px icon slot. This is the vocabulary B was
  built to provide; the raw `h-[18px]` buttons predate it.
- **Collapse chevrons**: 24×24 hit area via padding; the 14px glyph stays.
- **Field-label buttons** stretch to the full 30px row height
  (`h-full` on the button instead of `min-h-[18px]`) — the visible text
  does not move; only the clickable area grows.
- **`Change type` chips**: 22px → **24px** (`h-6`), aligning with `xs`.
- **`+ New field` / `Add`** ghost buttons: 16px → 24px hit area.
- **Row height stays 30px** and the grid gains no vertical size: a 24px
  target and 13px text both fit a 30px row with margin. Density survives
  the fix — `frontend-ux` §5, "Narrow ≠ bigger".
- Column-header row 26px → **28px** so 11px uppercase sits comfortably.

### Explicitly out of scope

- Any change to grid ↔ inspector ↔ rail responsibilities, keyboard model,
  drag & drop, or the cell-focus machinery (`gridCellModel`,
  `gridDomFocus`). Visual only, per the slice decision.
- The inspector's form controls (shadcn inputs) — already on the system
  scale.
- The `h-[26px]`→`h-[28px]` header is the only row-geometry change.

## Verification

| Claim | How it is proven |
|---|---|
| Three text sizes on the surface | Re-run the live font-size audit: expect `{11px, 13px, 14px}` inside the grid panes |
| No in-grid control under 24px | Re-run the target audit: expect **0 of N** under 24×24 (inline text-label buttons measured by hit area, not glyph box) |
| Structure untouched | `TemplateGrid` / `GridPanel` / `Inspector` / move/undo suites pass unmodified except class-string assertions |
| Density preserved | Field-row height still 30px in the live audit; total grid height within ~2% (header row +2px × section count) |
| It reads right | `design-review` loop on Configuration with the CHARMS template, light and dark, wide and narrow |
| Ratchet clean | `check_button_scale.py` — converting raw buttons to `icon-xs` adds no height overrides |

## Sequencing

| | Slice | State |
|---|---|---|
| B | Button & density scale | PR1 in prod · [#723](https://github.com/raphaelfh/prumo/pull/723) open |
| A | Template import flow | Spec [#724](https://github.com/raphaelfh/prumo/pull/724) |
| C | Model picker | Spec [#725](https://github.com/raphaelfh/prumo/pull/725) · impl [#726](https://github.com/raphaelfh/prumo/pull/726) stacked on #723 |
| **D** | **This spec** | Implementation starts after the B→C stack lands — it touches the same `template-config/` files |
