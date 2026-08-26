---
status: approved
last_reviewed: 2026-08-26
owner: '@raphaelfh'
---

# Button & density scale — design

> **Status:** Approved · Date: 2026-08-26 · Deciders: @raphaelfh
> **Scope:** retune the `buttonVariants` scale so the dense heights the
> `frontend-ux` language demands are first-class named sizes; migrate the
> call sites in `frontend/components/extraction/`; add a shrink-only
> fitness gate so the drift cannot return; amend the `frontend-ux` skill
> so the scale is written where the next agent reads it.
> **Slice:** B of four (see [Sequencing](#sequencing)).

## Problem

Buttons across the extraction views carry no consistent height. Measured on
`frontend/components/extraction/**/*.tsx` (production files, tests excluded):

> **Measurement correction (2026-08-26).** The first draft of this spec
> reported 53 overrides / 22 files in `extraction/` and 120 / 50 repo-wide.
> Those came from a naive `<Button\b(.*?)>` + `className="([^"]*)"` regex that
> an adversarial review proved blind to ~20% of the drift: the non-greedy tag
> match stops at the first `>`, which `onClick={() => …}` and
> `disabled={a >= b}` supply *before* `className`, and a quoted-literal
> pattern cannot see `className={cn("h-8")}` — the house idiom. The numbers
> below are from the depth-aware parser that shipped as
> `scripts/fitness/check_button_scale.py`, independently reproducing the
> review's count.

| Metric | Value |
|---|---|
| Overrides in `frontend/components/extraction/` | **60 across 23 files** |
| Overrides repo-wide | **151 across 62 files** |
| Distinct override heights | `h-8`, `h-7`, `h-6`, `h-5`, `h-4` |

`frontend/components/extraction/FieldInput.tsx` carries two overrides and was
absent from the original migration list entirely. `ArticleExtractionTable.tsx`
has 5, not 1. `frontend/pdf-viewer/` — a separate package under its own knip
entry point — holds 10 more that the first draft never mentioned.

Variant use is similarly unanchored — `ghost`×51, `outline`×43,
`secondary`×8, `destructive`×6, `default`×3 — but variant choice is a
per-surface judgement, not a scale defect. This spec fixes the scale; variant
discipline follows in slices C and D, which get rebuilt in this vocabulary.

## Root cause

`frontend/components/ui/button.tsx`:

```
size: {
  default:       "h-10 px-4 py-2",
  sm:            "h-9 rounded-md px-3",
  lg:            "h-11 rounded-md px-8",
  icon:          "h-10 w-10",
  header:        "h-8 rounded-md px-2 text-header-meta [@media(pointer:coarse)]:h-11",
  "header-icon": "h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
}
```

The `frontend-ux` language is density-first: `text-[13px]` body, `py-1`/`py-2`
rows, `h-12` header. **No size in this scale fits it.** `sm` is `h-9` (36px) —
too tall for a toolbar in a 48px header. So every author writes
`size="sm" className="h-8"`, or `h-7`, or `h-6`, each picking a private answer.

The scale does not offer the height the design language demands, so half the
call sites override it. This is a broken primitive, not sloppy authorship — and
nothing downstream stays consistent until it is fixed at the source.

`header` and `header-icon` are the proof the correct pattern already exists:
dense height **plus** a coarse-pointer bump. They are named after a *location*,
so nobody uses them outside a header — each is used in exactly one file
(`components/layout/HeaderIconButton.tsx`, `components/navigation/SectionViewSwitcher.tsx`).

## Decision

Name sizes by **role**, and set the chrome default to **`h-7`** — the most
common override today (20 sites in extraction, 36 repo-wide), i.e. the height
authors independently converged on when the primitive did not serve them.

| Token | Classes | When |
|---|---|---|
| `default` | `h-10 px-4 py-2 text-sm` | Empty-state / auth / marketing CTAs only |
| `sm` | `h-7 rounded-md px-2.5 text-[13px]` | **The default for product chrome** — toolbars, dialog footers, row actions, cards |
| `xs` *(new)* | `h-6 rounded-md px-2 text-xs [&_svg]:size-3.5` | Nested density only — inside a popover, inline chips, alternates rows |
| `icon` | `h-7 w-7` | Icon-only at chrome density |
| `icon-lg` *(new)* | `h-10 w-10` | The rare large icon button |
| `lg` | `h-11 rounded-md px-8` | Unchanged; retained for compatibility |

Three deliberate consequences.

### 1. Text size moves into the size variants

The base class sets `text-sm` (14px) while the body scale is `text-[13px]`, so
dense call sites override that too. Text size becomes per-size (table above)
rather than a base rule a caller has to fight. `default` keeps `text-sm`.

### 2. Touch targets get fixed for every dense button at once

Every dense size gains the coarse-pointer bump `header` already has:

```
[@media(pointer:coarse)]:h-11
```

The frontend currently contains **3** coarse-pointer declarations in total, so
roughly 250 of 254 buttons sit below the touch-target minimum. `frontend-ux` §5
requires a touch fallback; putting it in the primitive delivers it for all of
them in one line instead of 254.

`xs` (24px) is deliberately *not* offered a smaller coarse bump — it takes the
same `h-11`, because a 24px control is never an acceptable touch target.

### 3. `header` / `header-icon` collapse into `sm` / `icon`

Same thing under a location-scoped name; two call sites to migrate. `sm` moves
from the 12px `text-header-meta` to `text-[13px]`, a deliberate 1px increase
that aligns header buttons with the body scale.

### Icon sizing inside buttons

The base class carries `[&_svg]:size-4`, which compiles to a descendant
selector — specificity (0,1,1) — while a call site's own `h-3.5 w-3.5` on the
icon is (0,1,0). **The descendant rule wins regardless of source order**, so
every icon inside a `<Button>` already renders at 16px today and the per-icon
height classes at those call sites are inert. Migration therefore does not
change icon size in `sm`, and those dead classes get removed in the files
touched (per CLAUDE.md: clean in code you touch).

`xs` overrides to `size-3.5` — a 16px icon inside a 24px control leaves 4px of
breathing room, which is too tight.

## Shipping order: two PRs, not one

An adversarial panel blocked the single-PR plan. Its decisive finding: the
touch-target fix and the height retune are **separable**, and welding them
together is what made the change unreviewable.

**PR1 — invisible (shipped first).** The fitness gate, its two pytest suites,
the characterization test over the *current* scale, and the docs. **Zero
runtime change**, so it is reviewable by reading the diff and carries no
visual risk. The ratchet lands immediately and starts freezing all 151
overrides.

**PR2 — visual (needs eyes).** `sm` h-9→h-7, `icon` h-10→h-7, add `xs` and
`icon-xs`, the coarse-pointer bumps, collapse `header`/`header-icon`, migrate
the 60 extraction sites, ratchet the baseline down.

The coarse-pointer bump moved from PR1 to PR2 deliberately: it changes
rendering on every touch device, and `twMerge` keeps it alongside a call-site
override (different modifier group), so 10 square `h-N w-N` buttons would
render 44px tall × 24–32px wide. That is a visible regression, so it belongs
with the reviewed half.

## Migration scope

Per the surgical-on-unrelated-code rule:

- **The primitive is retuned globally.** It is one file, and the touch-target
  fix has to reach everywhere to be worth having.
- **Override cleanup happens in `frontend/components/extraction/` only** — the
  53 overrides across 22 files, which are the views under complaint.
- The remaining ~67 overrides elsewhere are **seeded into the fitness baseline**
  and ratchet down as those areas are touched.

### The retune reaches further than the cleanup — PR2's real blast radius

Retuning changes every button that carries no override, not only the ones
being cleaned up:

| Group | Count | Effect |
|---|---|---|
| Bare `size="sm"` outside `extraction/` | 25 across 19 files | 36px → 28px |
| `size="icon"` repo-wide | 50 (32 outside `extraction/`) | **40px → 28px** |
| `HeaderIconButton` render sites | 11 across 10 files | 32px → 28px |
| No `size` prop at all | 68 | Unaffected — stay `h-10` |

`HeaderIconButton` is the correction that matters most: the *string*
`size="header-icon"` appears in one file, but the component renders 11 times —
including `navigation/Topbar.tsx`, which is global chrome on **every**
authenticated route. Its 32px was a deliberate decision in the shipped
2026-06-21 header plan. Collapsing it is not "same thing under another name".

### Carried into PR2 (found by the panel, must not be re-discovered)

- **Icon buttons need width handling.** 32 of the 60 extraction overrides
  carry a paired `w-N`. Dropping only `h-6` leaves `w-6` fighting the scale.
  Icon sites map to `size="icon"` and drop `h-N w-N` **together**.
- **A 24px square token is missing.** Nine sites are `h-6 w-6`; `xs` (h-6 with
  `px-2`, no width) renders them ~32×24. PR2 needs `icon-xs`.
- **Drop `icon-lg`** — zero call sites; knip cannot see cva variant keys, so
  nothing would ever flag it as dead.
- **`icon`/`icon-lg` must keep a `text-` class.** Moving `text-sm` out of the
  cva base leaves them inheriting ambient font-size; `AllowedUnitsList.tsx`
  renders literal `↑`/`↓`/`×` glyphs as button text children.
- **`npx tsc --noEmit` is a no-op here** — the root tsconfig is solution-style
  (`"files": []` + references), as `scripts/verify_all.sh:187` documents. Use
  `npm run typecheck`.
- **`pointer: coarse` is not a width query.** Narrowing a desktop browser to
  375px still reports `pointer: fine`; verifying the touch bump needs device
  emulation (`resize_window` preset `mobile`, then reload).
- **`ui-styling/SKILL.md:92` says keep `ui/*` close to upstream shadcn** so
  `shadcn add` diffs stay clean. PR2 edits upstream `sm`'s value and adds
  non-upstream tokens, so it must reconcile that skill too — not only
  `frontend-ux`.
- **`frontend-ux` §5 does not mandate 44px.** The earlier draft cited it for
  the touch bump; §5 actually says hover-only affordances need a touch
  fallback, and separately that density survives the shrink — which is in
  tension with an `h-11` bump inside an `h-12` header. PR2 owns that call
  explicitly rather than citing a rule that does not say it.

`h-8` sites (14 in extraction) drop 4px to `h-7`; `h-6` sites (15) become `xs`
rather than being flattened up to `sm` — some are deliberately tiny and
flattening them would be a regression, not a fix. `h-5`/`h-4` sites (4) are
inspected individually.

**This is the main regression risk in the slice** and it is visual, so it is
verified with the `design-review` loop (render → screenshot → compare →
fix → re-screenshot) on the extraction routes, not by reading the diff.

## The gate

Without a gate this reverts within a month. `scripts/fitness/` already runs
baseline-driven checkers wired into `scripts/verify_all.sh` and CI
(`check_file_size.py` + `.baseline`, `check_layered_arch.py` + `.baseline`).

Add **`scripts/fitness/check_button_scale.py` + `check_button_scale.baseline`**
following that pattern exactly:

- **Fails** when a `<Button>` opening tag's `className` contains an `h-<n>`
  utility.
- **Shrink-only baseline**, seeded post-migration with the surviving
  non-extraction sites. A count that grows fails; a count that shrinks requires
  the baseline be tightened in the same PR — the same ratchet as the vulture
  baseline.
- Registered in `scripts/fitness/run_all.sh`.

## Skill amendment

`.claude/skills/frontend-ux/SKILL.md` §3 currently specifies buttons only by
variant ("Primary: high contrast / Secondary: transparent / Ghost: toolbar
items") with no height. That silence is what let 5 heights coexist. It gains
the scale table above, a one-line rule — **`sm` (h-7) is the default for all
product chrome; `default` (h-10) is for CTAs only; never override a button's
height in `className`** — and a pointer to the fitness gate. The §6
implementation checklist gains: *Buttons use a named size; no `h-<n>` in a
Button className.*

## Verification

| Claim | How it is proven |
|---|---|
| The scale is applied | `check_button_scale.py` at baseline; `npm run lint`, `npx tsc` |
| Nothing regressed functionally | `npm run test:run` — existing Vitest suites over extraction components |
| Nothing regressed visually — extraction | `design-review` loop: Configuration (with and without an active template), the sections/fields grid, the model picker popover |
| Nothing regressed visually — the other 35 | `design-review` loop on the routes hosting them: runs, articles, project, settings, feedback, dashboard |
| Touch targets hold | Same loop at a narrow width, per `frontend-ux` §5 |
| Dead icon classes are gone | Removed in the 22 touched files; knip + vulture gates stay at zero |

## Sequencing

This is slice **B** of four. Ordered so that B settles the vocabulary C and D
are rebuilt in — otherwise C and D get done twice.

| | Slice | Size | State |
|---|---|---|---|
| **B** | Button & density scale | Small–medium | **This spec** |
| **A** | Template import flow | Small | Designed (appendix below), not yet specced |
| **C** | Model picker (`LlmEngineChip`) | Medium | Not yet designed |
| **D** | Sections/fields view — visual only | Medium | Not yet designed |

**C** is overloaded: one 22rem popover carries the Fast/Verified toggle, a
retired-model alert, an attribution line, alternates management (which flips
the same list into an inline multi-select), the searchable catalogue grouped by
provider, custom endpoint groups, and a manage-endpoints footer — seven
concerns.

**D** is scoped to **visual only** — density, spacing, section/field hierarchy,
button treatment, empty states. Structure and interactions are unchanged, so
the ~5,800 lines of existing test coverage over
`TemplateConfigGridPanel` / `TemplateGrid` / `TemplateInspector` stay valid.
Re-organising grid ↔ inspector ↔ outline-rail responsibilities is explicitly
**not** in scope.

## Appendix — slice A design (carried forward, not in this plan)

Recorded so the decided design is not lost between sessions. Gets its own spec
when it becomes the active slice.

**Entry point.** On the Configuration page with no active template, the "Import
template" section (heading + the full catalogue table) is replaced by a card
sibling to *Create Custom Template*, with one generic **Import template**
button. The catalogue then lives in exactly one place — inside the dialog. This
removes the per-row Import buttons, which are `initialTemplateId`'s only
caller, so that prop and the render-phase `prevSyncKey` sync block in
`ImportTemplateDialog` are deleted with it; `globalTemplates` leaves
`ExtractionInterface` too.

**Dialog.** Retitled *Add a template* (today it reads *Switch template* even
though the user pressed *Import*). Three tabs — **Catalogue** (default) /
**JSON file** / **This project**. Each tab owns its primary button at the foot
of its own pane and the footer holds only *Close*: since one tab renders at a
time, the two-competing-submits problem dissolves by construction and no state
has to be lifted out of the file pane.

**JSON guidance** (the gap that prompted the slice — users generate these files
with AI agents and have no format reference): a collapsible *How to build this
file*, a **Download example** button serving a valid minimal
`exampleTemplate.json`, and a **Copy AI prompt** button that copies the format
rules + example + "output only JSON" for pasting into an assistant. Content in
a new `frontend/lib/templateImport/` module.

**Drift guard.** A hand-written example rots the next time
`backend/app/schemas/template_portable.py` tightens. A backend pytest reads
`frontend/lib/templateImport/exampleTemplate.json` and validates it against
`PortableTemplate` — precedent exists for repo-root-relative backend tests
(`tests/unit/test_celery_routes_drift.py`,
`tests/unit/scripts/test_check_api_response_envelope.py`).

**Not doing:** a docs page and a published machine-readable JSON Schema
endpoint. Clean follow-up if agents later need to *fetch* the schema rather
than receive it in a pasted prompt.

**Open:** both E2E specs (`frontend/e2e/flows/template-import.ui.e2e.ts`,
`template-portable.ui.e2e.ts`) drive `extraction-import-global-*` and need
repointing at the new entry.
