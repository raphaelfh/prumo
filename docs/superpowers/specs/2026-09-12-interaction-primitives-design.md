---
status: shipped
last_reviewed: 2026-09-13
owner: '@raphaelfh'
---

# Interaction primitives — cursor, tooltip, icon button, overlay frame

Sub-project 1 of 3 in the "less friction, fewer elements" train. This spec
fixes the *primitives* every screen is built from. Sub-project 2
(configuration as views instead of popups) and sub-project 3 (borderless
density pass on the article form and settings screens) build on it and
get their own specs.

## 1. Problem

The visual-language skill (`.claude/skills/frontend-ux/SKILL.md`) already
mandates tooltips on every icon button, one hairline per boundary and
silent hovers. The code does not follow it, and nothing makes it. Survey
of `frontend/` on `dev` at `926b12d4`:

| Area | State |
|---|---|
| Icon-only buttons | 72 (`size="icon"` 56, `icon-xs` 16). About 23 carry a tooltip or `aria-label`; ~50 are bare. |
| Tooltip delay | One root `TooltipProvider` in `App.tsx` with no delay, so Radix's 700 ms default applies. 13 nested providers override it with 0/200/300/400 ms. |
| Cursor | `Button` sets no cursor; `index.css` has no cursor rule. 38 ad-hoc `cursor-pointer` classes, 22 of them inside four dialogs. |
| Dialogs | 20 `DialogContent`, 15 `AlertDialogContent`, 4 `SheetContent`. `AppDialog` has a six-step size scale used by one caller; everyone else hand-rolls widths (six different ones on configuration dialogs alone). |
| Motion | Dialog 200 ms zoom+slide; sheet 500 ms in / 300 ms out; tooltip zoom+slide with no duration. No reduced-motion variant. |
| Enforcement | `check_button_scale.py` gates button heights. Nothing gates cursor, tooltip, overlay size or provider nesting. |

The result is what the screenshots show: elements that do not explain
themselves, a hand cursor in some dialogs and an arrow elsewhere, and
popups of six shapes.

## 2. Goals and non-goals

Goals:

1. Every icon-only control explains itself on hover and to screen readers,
   with its shortcut when it has one, enforced at compile time and by CI.
2. One tooltip timing and one tooltip look across the app.
3. One cursor rule, in one place.
4. Chrome buttons are borderless at rest and show a soft fill on hover.
5. Every modal, confirmation and sheet shares one frame: three widths, one
   footer contract, one motion, one narrow-width behaviour. Zero hand-rolled
   sizes, enforced by CI.
6. Motion is short and honours `prefers-reduced-motion`.

Non-goals (later sub-projects):

- Moving the six configuration dialogs to routes or sheets. They migrate
  onto the new frame *as dialogs* here; their surface changes in sub-project 2.
- Removing cards and borders from the article form and the settings pages.
- Any change to the sidebar, headers, tables or the PDF viewer chrome.

## 3. Decisions (settled in brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Tooltip delay | 400 ms first, 0 ms for peers (Radix `skipDelayDuration`) | Avoids flicker on a sweeping mouse; instant when scanning a toolbar (Geist rule). |
| Tooltip on text buttons | Only when it adds information the label lacks | Tooltips are the last resort after inline help. |
| Shortcut in tooltip | Yes, as a `KbdBadge` chip after the label | The Claude/Linear "Add files and more @" pattern. |
| Icon-button enforcement | An `IconButton` pattern component with a required `label`; a fitness gate bans raw icon-sized `Button`s | Type system forgets nothing; a heuristic gate lets the label drift away from the button. |
| Cursor | Arrow on all controls; hand only on navigating anchors | Linear, Raycast, Figma, Apple HIG and shadcn's 2025 default. Reads as "tool", not "website". |
| Dialog sizes | Three: 400 / 560 / 800 px | None of the reference systems publish a scale; consistency comes from one frame, one footer, one motion. Three covers every current caller. |
| Configuration dialogs | Migrate onto the scale now | The gate starts at zero exceptions; sub-project 2 changes their surface, not their content. |
| Popup boundary | Modal blocks a decision; sheet holds persistent context; anything with tabs, sections, lists or its own save lifecycle is a view | Geist boundary. Sub-project 2 applies it. |

## 4. Design

### 4.1 Cursor rule

One block in `frontend/index.css`, `@layer base`:

```css
button, [role="button"], [role="tab"], [role="menuitem"],
[role="option"], [role="checkbox"], [role="radio"], [role="switch"],
summary, select { cursor: default; }
a[href] { cursor: pointer; }
:disabled, [aria-disabled="true"] { cursor: not-allowed; }
[data-drag-handle] { cursor: grab; }
[data-drag-handle]:active { cursor: grabbing; }
[role="separator"][aria-orientation="vertical"] { cursor: col-resize; }
[role="separator"][aria-orientation="horizontal"] { cursor: row-resize; }
```

Consequences:

- Every `cursor-pointer` class in `frontend/` is removed (38 today). A row
  or card that opens something on click gets `role="button"` (which it
  needs for keyboard access anyway), not a cursor class.
- Existing `cursor-grab` classes on drag handles become `data-drag-handle`.
  `cursor-not-allowed` and `cursor-default` classes are removed; the rule
  covers them.
- `disabled:pointer-events-none` on `Button` stays: a disabled button that
  swallows pointer events cannot show `not-allowed`, and that is the
  intended shadcn behaviour. The `not-allowed` rule serves non-button
  controls (`aria-disabled` rows, disabled selects).
- Inputs and textareas keep the browser's `text` cursor; nothing to add.

### 4.2 Tooltip

`frontend/App.tsx` root provider becomes:

```tsx
<TooltipProvider delayDuration={400} skipDelayDuration={300}>
```

All 13 nested `TooltipProvider`s in product code are deleted. Test files
keep their `delayDuration={0}` wrappers; they are the only place a
provider may appear outside `App.tsx`.

`TooltipContent` look (`components/ui/tooltip.tsx`): dark pill, no border,
12 px text, `rounded-md`, `px-2 py-1`, `bg-foreground text-background`
(inverts per theme, which is what Linear and the Claude app do), soft
shadow in light mode only, `max-w-xs`, wraps. Motion: opacity only,
`duration-100`, no zoom, no slide. `sideOffset` 6.

Content rule (goes into `frontend-ux` § 4.4): one fragment, sentence case,
no trailing period, verb first ("Add author", "Copy citation"). Shortcut
rendered as `<KbdBadge>` after the label with a 6 px gap, using the
existing `chord`/`sequence` variants.

### 4.3 `IconButton` pattern component

New file `frontend/components/patterns/IconButton.tsx`:

```tsx
interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children' | 'aria-label'> {
  /** What the button does. Tooltip text and accessible name. Copy through lib/copy. */
  label: string;
  icon: React.ReactNode;
  /** Rendered as a KbdBadge chip after the label; also sets aria-keyshortcuts. */
  shortcut?: readonly KbdKey[];
  shortcutVariant?: 'chord' | 'sequence';
  size?: 'icon' | 'icon-xs';
  /** Suppress the tooltip when the button sits inside a control that already
   *  shows the label (a tab, a labelled menu row). aria-label still applies. */
  tooltip?: boolean;
}
```

Renders `Tooltip > TooltipTrigger asChild > Button variant="ghost"` with
`aria-label={label}` and `aria-keyshortcuts={ariaKeyShortcuts(shortcut)}`
when a shortcut is given. `variant` defaults to `ghost` and can be
overridden (a destructive icon action stays `ghost` and colours its icon;
`destructive` fill is for text buttons). `asChild` is not supported: no
current icon button is a link, so the escape hatch is not built (YAGNI;
add it with the first caller).

All 72 icon-sized `Button` call sites migrate. Labels come from
`frontend/lib/copy/*` (new keys where none exist; existing tooltip copy is
reused). The migration is mechanical and is the bulk of the work.

`PanelToggleButton.tsx` and `resizable-panel.tsx` already implement this
shape by hand; they become `IconButton` callers.

### 4.4 Button variants

In `components/ui/button.tsx`:

- `ghost` gains an active state: `active:bg-accent/80`. Hover stays
  `hover:bg-accent`. No border ever.
- `outline` keeps its border but is documented as *the secondary action
  beside a primary in a footer*, nothing else. Toolbar and row actions use
  `ghost`. The skill's Buttons table gets a "Variant" column saying so.
- `transition-colors` gets `duration-75` (the skill's "silent hover").
- Focus ring: `focus-visible:ring-2 ring-ring ring-offset-2` stays as is.

No variant is added or removed. Migrating existing `outline` toolbar
buttons to `ghost` is in scope only where a file is already being touched
for the icon-button migration; a sweep of the rest belongs to sub-project 3.

### 4.5 Overlay frame

One frame shared by `Dialog`, `AlertDialog` and `Sheet`, expressed as
three `cva` size variants and shared class constants in a new
`components/ui/overlay-frame.ts` (classes only, no React) that all three
primitives import.

**Dialog and AlertDialog** (`DialogContent` / `AlertDialogContent` gain a
`size` prop):

| Size | Width | Height | Use |
|---|---|---|---|
| `sm` | `max-w-[400px]` | content | confirmations, one-field forms (default for `AlertDialogContent`) |
| `md` | `max-w-[560px]` | content, `max-h-[85dvh]`, body scrolls | standard forms (default for `DialogContent`) |
| `lg` | `max-w-[800px]` | `h-[85dvh]` fixed, body scrolls | pickers, imports, anything with its own list |

Shared frame: `rounded-lg`, `p-0` on the content with `px-5 py-4` on
header, body and footer so a `lg` body can scroll under a fixed header
and footer; `gap-0`; a `border-border/40` hairline; light-mode shadow
`shadow-[0_1px_2px_rgb(0_0_0/0.04),0_16px_48px_rgb(0_0_0/0.12)]`,
dark-mode `dark:shadow-none dark:bg-popover` (one surface step up, no
elevation, per Linear). Title `text-[15px] font-medium`, description
`text-[13px] text-muted-foreground`. Close control is a ghost `icon-xs`
button with `aria-label` "Close" and the same tooltip, composed inside
the primitive (a `ui/` file must not import from `patterns/`, which is
where `IconButton` lives), at `right-3 top-3`.

Footer contract (`DialogFooter` / `AlertDialogFooter`): actions right-
aligned, Cancel (`outline`, `size="sm"`) immediately left of the primary
(`default` or `destructive`, `size="sm"`), `gap-2`. A tertiary action, when
one exists, sits at the far left (`ghost`). On `AlertDialog` with a
`destructive` action, initial focus goes to Cancel (`AlertDialogCancel`
gets `autoFocus`), so Enter never fires the destructive action; the
primitive sets this by default when `variant="destructive"` is passed to
`AlertDialogAction`.

Overlay: `bg-black/60`, fade `duration-150`. (Today 80 %; Linear uses
85 % on a dark UI, Geist about 50 %. 60 % keeps the page legible behind a
`md` dialog without the "lights out" feel.)

Motion: content `data-[state=open]:duration-150 data-[state=closed]:duration-100`,
ease-out, `fade-in-0 zoom-in-[0.98]` in and the mirror out; no slide. Under
`motion-reduce:` the zoom is dropped, fade stays.

Narrow width (`< sm`, 640 px): all sizes become a bottom sheet:
`inset-x-0 bottom-0 top-auto translate-x-0 translate-y-0 w-full max-w-none
rounded-b-none rounded-t-xl max-h-[92dvh]`, slide-in from bottom. This
replaces the current centred-with-16 px-gutter behaviour, which clips tall
forms on phones.

**Sheet** (`SheetContent`): one width per side. `right`/`left`:
`w-[420px] max-w-[calc(100vw-2rem)]`; `bottom`/`top` full width. Same
header/body/footer padding and typography as the dialog, same hairline
and shadow rule, motion `duration-200` in / `duration-150` out (a sheet
travels farther than a dialog scales, so it gets a little more time; 500
ms today is the single slowest interaction in the app). `MobileSidebar`
(280 px) and the template inspector (320 px) keep a `size="narrow"`
variant at `w-[320px]`, because a navigation rail is not a content sheet.

`AppDialog` (`components/patterns/AppDialog.tsx`) is rewritten on the new
frame with `size: 'sm' | 'md' | 'lg'` and the footer contract, and is the
recommended way to build a form dialog. It is not mandatory: a dialog
with a non-standard body composes the primitives directly, and the gate
below keeps it on the frame either way.

### 4.6 Migration of existing overlays

| Caller | Today | Size |
|---|---|---|
| All 15 `AlertDialogContent` | default | `sm` (no change needed beyond the primitive) |
| `AddEntryDialog` ×2, `MoveToSectionDialog`, `RISImportDialog`, `ArticlesExportDialog`, `HITLExportDialog`, `FeedbackDialog`, `AddProjectDialog`, `runs/header/Help` | five widths | `sm` or `md` per content; `Help` is `sm` |
| `AddSectionDialog`, `CreateCustomTemplateDialog`, `LlmEngineSettingsDialog`, `LlmEndpointsDialog`, `AiConfigDialog`, `GenerationDetailsDialog` | six widths | `md` |
| `ImportTemplateDialog`, `ZoteroImportDialog`, `ArticleFileUploadDialogNew` | fixed heights / 4xl | `lg` |
| `TemplateConfigDiffSheet`, `TemplateVersionHistorySheet` | `sm:max-w-[26rem]` | default sheet width |
| `MobileSidebar`, template inspector | 280 / 320 px | `size="narrow"` |

Every `className` carrying `w-`, `max-w-`, `h-`, `max-h-` or `p-0` on
these contents is removed. Layout that a caller genuinely needs inside
the body (a two-pane import, a flex column with its own scroll region)
moves to a wrapper `div` inside the body, not onto the content element.

### 4.7 Enforcement

New fitness gate `scripts/fitness/check_ui_primitives.py`, registered in
`scripts/fitness/run_all.sh` (and therefore in `verify_all.sh`'s
`fitness:run_all`; the gate roster test in
`backend/tests/unit/scripts/test_verify_all_gates.py` is unaffected
because the roster entry is `run_all.sh`, not the individual check).
Same JSX tag-walking approach as `check_button_scale.py`, so an
`onClick={() => …}` before `className` cannot hide a violation. Four rules,
one baseline file, shrink-only ratchet at **zero** from day one:

1. `<Button` with `size="icon"` or `size="icon-xs"` outside
   `components/patterns/IconButton.tsx`.
2. `<TooltipProvider` outside `App.tsx` and `*.test.tsx`.
3. `cursor-pointer`, `cursor-default`, `cursor-not-allowed`, `cursor-grab`
   anywhere in `frontend/` outside `index.css`.
4. `<DialogContent`, `<AlertDialogContent`, `<SheetContent` whose
   `className` contains a `w-`, `max-w-`, `h-`, `max-h-` or `p-` utility.

`frontend-ux` SKILL.md gains: the cursor rule (§ 4), the tooltip content
rule (§ 4.4 rewritten to name `IconButton`), the button variant column,
and a new § 8 "Overlays" with the size table, the footer contract, the
popup boundary from § 3 and the narrow-width behaviour. `ui-styling`
gains the class-level mechanics (`size` prop, `data-drag-handle`,
`overlay-frame.ts`). The Implementation Checklist gains four lines
mirroring the gate.

## 5. Testing

Unit (vitest + RTL), in `frontend/components/ui/*.test.tsx` and
`frontend/test/`:

- `IconButton`: renders `aria-label`; tooltip appears on hover and on
  focus with the label; shortcut renders a `KbdBadge` and sets
  `aria-keyshortcuts`; `tooltip={false}` keeps the `aria-label`.
- `DialogContent` / `AlertDialogContent` / `SheetContent`: each `size`
  applies its width class and nothing else applies one (assert the class
  list, the way `overlay-frosted.test.tsx` does); `AlertDialogAction
  variant="destructive"` puts initial focus on Cancel; the narrow-width
  classes are present.
- `tooltip.tsx`: content has no border and no zoom class.
- Existing dialog tests (`AiConfigDialog`, `LlmEngineSettingsDialog`,
  `feedback-dialog`, `ReopenExtractionDialog`,
  `CreateCustomTemplateDialog.validation`, `TemplateConfigDiffSheet`) keep
  passing unchanged; they assert by role and text, not by class.
- Fitness gate: `scripts/fitness/tests/test_check_ui_primitives.py` with
  one fixture per rule, positive and negative, including the
  `onClick`-before-`className` case.

Visual (`design-review` skill, one session, before and after, per the
density recipe in memory): the article split view, the run header, the
LLM endpoints dialog, a delete confirmation, and the template import
dialog at 1280 px and at 375 px. Screenshots go in the PR.

Playwright: no new flows. The three existing `*.ui.e2e.ts` flows open
dialogs and must stay green; that is the regression net for the frame
change.

## 6. Delivery

One train, one worktree, PRs to `dev` in this order, each independently
green and each small enough to review in one sitting:

1. **Base**: cursor rule, root tooltip provider, tooltip look, button
   `ghost` active state and `duration-75`, `overlay-frame.ts`, the three
   primitives on the new frame, rewritten `AppDialog`, `IconButton`, the
   gate with a baseline that *lists* current violations (ratchet armed,
   count non-zero), skill updates. Nothing in product code changes yet
   except through the primitives.
2. **Icon buttons**: the 72 call sites, by area (articles, extraction,
   runs, layout, pdf-viewer). Nested providers deleted. Baseline shrinks
   to zero for rules 1 and 2.
3. **Overlays**: the 39 contents per § 4.6. Baseline shrinks to zero for
   rule 4.
4. **Cursor**: the 38 classes. Baseline shrinks to zero for rule 3 and
   the baseline file is deleted; the gate becomes a hard zero.

Steps 2 to 4 can be split further by area if a PR passes ~400 changed
lines. Steps 2, 3 and 4 touch disjoint lines in most files but the same
files, so they stay sequential on one branch rather than parallel
worktrees.

## 7. Risks

- **Radix `skipDelayDuration` scope.** Peers share the skip window only
  under the same provider. With one root provider that is the whole app,
  which is the intent; a tooltip in a portal (dropdown item) still counts.
- **Bottom-sheet dialogs and focus trap.** Radix keeps the trap; the
  change is CSS only. Verified at 375 px in the visual pass.
- **`h-[85dvh]` on `lg` with a short body** leaves empty space under a
  small import result. Accepted: a fixed height is what stops the frame
  jumping as the list loads, and `lg` callers all have lists.
- **Copy keys.** ~50 new tooltip labels go through `lib/copy`; the copy
  ratchet (`check_copy_keys.py`) needs its baseline bumped in the same PR.
- **Arrow cursor loses affordance on rows.** Rows that open something must
  have a hover fill (`hover:bg-muted/50`, already the skill rule). The
  visual pass checks the article list and the projects hub.

## 8. Out of scope, recorded for sub-projects 2 and 3

- Which of the six configuration dialogs become a route and which a sheet
  (sub-project 2 decides per dialog under the § 3 boundary).
- Card and border removal on `ArticleAuthorsField`, `BasicInfoSection`,
  `ApiKeysSection`, `IntegrationsSection`; the "no card unless it separates
  unlike things" rule (sub-project 3).
- Field label weight and the `ArticleFieldRow` grid (sub-project 3).

## 9. Amendments from planning

Recorded while writing `docs/superpowers/plans/2026-09-12-interaction-primitives.md`,
after reading the code this spec only surveyed. Where they disagree, this
section wins.

1. **Nested providers are 38, not 13.** 13 was the count that set a delay.
   Radix throws when a `Tooltip` has no provider, so `Tooltip` now renders
   its own provider when none is mounted. That is what makes deleting the 38
   safe for components rendered alone in unit tests. The defaults (400/300)
   live in the `TooltipProvider` wrapper, so `App.tsx` passes no props.
2. **Cancel focus is already Radix behaviour.** `AlertDialogContent` focuses
   `AlertDialogCancel` on open. The plan pins it with a test and implements
   nothing.
3. **`IconButton` absorbs the two existing wrappers.** `HeaderIconButton`
   (13 usages) and `ToolbarIconButton` (6) are deleted. `IconButton` takes
   their look (muted glyph, `hover:bg-muted/60`), and gains `tooltip`
   (override text, or `false`), `hint` (second line) and `side`. A disabled
   `IconButton` hangs its tooltip on a wrapping span, so the reason it is
   disabled still shows.
4. **Cursor block is smaller.** The separator and drag-handle rules are
   dropped: `cursor-col-resize` and `cursor-grabbing` classes stay, because
   base CSS cannot see drag state. The gate bans only `cursor-pointer`,
   `cursor-default` and `cursor-not-allowed`, and allows `peer-*`/`group-*`
   relational variants. No element gains a `role` in this sub-project.
5. **Overlay frame mechanics.** Centring uses `inset-0 m-auto` instead of
   translate, so Tailwind v4's `translate` property and the animate plugin's
   keyframe `transform` never fight. `DialogBody` and `AlertDialogBody` are
   exported. A `<form>` wrapping header, body and footer takes
   `className="contents"`. `DialogContent` gains `showCloseButton` (the two
   command palettes pass `false`). The close button keeps its `aria-label`
   but gets no tooltip, because autofocus would pop it on open.
6. **Reduced motion removes the animation**, not only the zoom.
7. **`SheetContent` drops the unused `top`/`bottom` sides.**
8. **Four PRs, not four steps on one branch:** foundations, icon buttons,
   cursor, overlay frame. The overlay primitives and their 39 callers ship
   together, so `dev` never shows a half-migrated frame.
9. **Shortcuts shown only where bound.** List filter buttons get an `F` chip
   (`useListKeyboardShortcuts` binds it on all three list screens). The PDF
   search button keeps its hint text: no ⌘F binding exists in the viewer.
10. **Click targets without a role get real semantics.** The arrow-cursor
   rule matches roles, labels and `summary`; an element with only `onClick`
   falls through to the text I-beam. Task 10's review found four: the
   articles list title cell and PDF chip, the notification item, and the
   import-template card. Each becomes a native `<button>` or a stretched
   overlay control (`absolute inset-0`) above its content, so it gains the
   arrow and keyboard access without nesting interactive elements. This
   replaces § 9.4's "no element gains a role" for real click targets only.
11. **Two deliberate deviations from § 4.5–4.6, kept after the final review.**
   Sheets export no `SheetBody`/`SheetFooter`: only
   `TemplateConfigDiffSheet` and `TemplateVersionHistorySheet` have a footer,
   and both hand-roll a bordered header and footer at `px-5 py-4`. A shared
   helper for two callers is not worth re-adding the `SheetFooter` that was
   deleted as dead. And `TemplateDiscardDialog` is the one `md` alert dialog,
   not `sm`: its body has confirm, acknowledge (with the orphan list), refused
   and result phases, and the list does not fit the 400 px frame.
