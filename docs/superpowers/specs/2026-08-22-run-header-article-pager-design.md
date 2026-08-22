---
status: approved
last_reviewed: 2026-08-22
owner: '@raphaelfh'
---

# Centered article pager for the run headers — design

> Brainstormed and approved 2026-08-22. Applies to the shared `RunHeader`
> compound consumed by both run screens (`ExtractionFullScreen` via
> `ExtractionHeader`, and `QualityAssessmentFullScreen` composing `RunHeader`
> directly). Presentation + client-side navigation only: no migration, no
> backend change, no ADR-0015 transition semantics touched.
>
> Continues `2026-07-02-run-header-declutter-design.md` (which moved stage +
> reviewers into `RunHeader.RunStatus`) and the responsive cascade established
> in `2026-06-30`/#450. Those two specs remain the authority for everything
> this one does not restate.

## 1. Problem

Moving to the previous/next article is the single most repeated action on both
run screens, and today it is unequal and half-hidden:

- **Extraction** has a pager (`RunHeader.Worklist`: `‹ N/M ›`, where `N/M` is a
  popover with a searchable article list) but it is welded to the left cluster,
  immediately after the breadcrumb. Its horizontal position drifts with the
  article title's length, and it reads as part of the identity block rather
  than as navigation.
- **Quality Assessment** has **no pager at all**. `useQAWorklist(projectId)`
  exists but is consumed only by `goToNextArticle()` on finish (#657), and the
  hook throws the article titles away (`{ id }[]`) even though
  `fetchProjectArticles` already selects `title`.
- **Shortcuts are inconsistent and the help panel lies.** `ExtractionHeader`
  hand-rolls a `keydown` effect with `⌘K` / `\` / `J` / `K` / `Esc`;
  `QualityAssessmentFullScreen` hand-rolls a different one with only `\`. The
  shared `Help` panel renders a hard-coded `SHORTCUTS` list that advertises
  `J / K — Next / previous article` on **both** screens, so on QA the help
  promises a binding that does not exist. QA also has no `⌘K` palette mounted,
  so it has no jump-to-article surface of any kind.

Two parallel implementations of the same concept is the root cause; the visual
fix and the consolidation are the same piece of work.

## 2. Goals

1. One centered, minimal previous/next control, identical on both run screens.
2. One keyboard binding for it, identical on both screens, discoverable from
   the control itself.
3. One implementation: a single pager component, a single shortcut owner, a
   single article-jump surface — so behaviour cannot drift again.
4. No overlap and no clipped primary action at any header width, proven by
   measurement rather than assertion.
5. Leave the touched files clean: remove the dead code this change creates and
   the dead code already sitting in them (§10).

## 3. Non-goals

- Per-article status inside the jump list. The existing
  `TODO(plan-future)` in `Worklist.tsx` (needs a batch runs endpoint) stays
  open and untouched.
- Changing the worklist *order* (`created_at` desc, mirroring the article
  tables) on either screen.
- Reworking `RunStatus` internals. It moves tracks; its content, popover and
  internal folds are unchanged.
- Adding an explicit autosave flush before navigating. §8 requires a test that
  characterises the current behaviour; changing it is separate work.

## 4. Decisions taken during brainstorming

| # | Decision | Rejected alternative and why |
|---|---|---|
| D1 | Pager = two arrow buttons + an **inert** `N / M` label. | Arrows only: loses at-a-glance orientation, and on touch the tooltip that would carry it barely exists. Keeping `N/M` clickable: it is then three targets, not "two buttons". |
| D2 | The searchable article picker moves to the `⌘K` command palette, and **the palette is mounted on QA too**. | Dropping the picker outright: QA would have no way to jump to a specific article, since it has no palette today. |
| D3 | Centering by **free-space split in flex** (§6). | Absolute overlay gated by width: pixel-exact but two positioning modes and real overlap risk in the packed consensus config that #475 already measured as crushing the title at 900px. Content swap in the existing `Center` slot: minimal diff, but does not actually centre — the position still drifts with the title. |
| D4 | Keep `J` (next) / `K` (previous), now honoured on both screens. | `Alt+←/→`, `[`/`]`, or dual bindings: all break existing muscle memory and the already-published help text, and `[`/`]` moves on ABNT2 keyboards. `J/K` is already documented for both screens — the fix is making QA keep that promise. |
| D5 | The `N / M` label survives at phone widths. | Folding it below ~30rem: it costs ~30px and it is what gives the arrows meaning. The article title is the designated flex cushion and truncates instead. |

## 5. Shared surface

Three pieces replace the duplicated logic. Each is consumed by **both** screens.

### 5.1 `RunHeader.Worklist` (existing component, restyled)

Props are unchanged (`articles: { id; title }[]`, `currentId`, `onNavigate`),
so Extraction's call site keeps working; QA becomes a second caller.

- Structure: `<nav aria-label>` wrapping `‹` button, inert `<span>` counter,
  `›` button.
- The counter is a `<span>`, not a `PopoverTrigger`: `tabular-nums`,
  `text-[11px]`, `text-muted-foreground`, `aria-hidden`, so it cannot change
  width between `9` and `10` and shift the centre. The position is carried
  for assistive tech by the wrapping `<nav aria-label>` (§7) instead, which
  keeps the two arrows' existing accessible names untouched.
- The leading `|` divider is removed. It existed to separate the pager from
  the breadcrumb; in the centre track it is noise.
- End arrows are **`disabled`, never hidden** — hiding one changes the block's
  width and displaces the centre by half an arrow.
- Each arrow gets a `Tooltip` showing its label plus a `KbdBadge` with its
  key. This is the discoverability path for D4: the shortcut is announced by
  the control it drives, not only by the `?` panel.
- The `[@media(pointer:coarse)]:h-11 w-11` 44px targets already in the file
  are preserved.
- The whole component renders `null` when `articles.length <= 1` (the guard
  moves from the call site into the component, so both screens inherit it).

### 5.2 `useRunShortcuts` (new hook)

One owner for the run-screen key handling, replacing the two hand-rolled
`useEffect`s in `ExtractionHeader` and `QualityAssessmentFullScreen`.

- Handles `⌘K`/`Ctrl+K` (toggle palette), `Esc` (close palette), `\` (toggle
  source panel), `J` (next article), `K` (previous article).
- Keeps the existing guards verbatim: never fires while the event target is an
  `input`, `textarea` or `contentEditable`; the single-key bindings additionally
  bail on any `meta`/`ctrl`/`alt` modifier.
- Keeps the existing `ref`-indirection pattern so the listener registers once
  with empty deps, and cleans up via `return` — **not** `try/finally`, which
  the React Compiler bans in components (see `.claude/rules/frontend.md`).
- Article navigation is a no-op when the caller passes fewer than two
  articles, so QA behaves correctly on a single-article project.

`Help.tsx`'s `SHORTCUTS` array is re-pointed at the same exported constant the
hook binds from, so a binding cannot exist in one place and be advertised
differently in the other.

### 5.3 `RunHeader.CommandPalette` on QA

Already accepts `articles` and `onNavigate`; QA simply mounts it and passes
them, plus its own actions. This is what makes D2 safe.

### 5.4 `useQAWorklist` widening

Return type goes from `{ id: string }[]` to `{ id: string; title: string }[]`.
`fetchProjectArticles` already selects `title`; the hook currently discards it.
`nextArticleTarget(worklist, articleId)` is structurally typed on `id` and is
unaffected.

QA navigation targets
`/projects/:projectId/articles/:articleId/quality-assessment/:templateId`,
carrying `:templateId` through verbatim — the same rule `goToNextArticle()`
already follows (the segment may name a project **or** a global template).

## 6. Layout

### 6.1 The change

`HeaderShell`'s row keeps `flex h-12 items-center`. The three tracks change:

| Track | Before | After |
|---|---|---|
| `Left` (identity) | `min-w-0 shrink overflow-hidden` | `flex-1 min-w-0 overflow-hidden` |
| `Center` | `shrink-0`, held `RunStatus` | `shrink-0`, **holds the pager** |
| pager | own `shrink-0` slot, after `Left` | slot removed; it lives in `Center` |
| `Right` (controls) | `ml-auto shrink-0` | `flex-1 justify-end`, inner items `shrink-0` |

`RunHeader.Center` is kept as a compound member and repurposed rather than
deleted: it is referenced by both screens and by `RunStatus.test.tsx`, and the
pager needs exactly the `shrink-0` track it already provides. The separate
protected pager slot introduced by #450 is what goes away — its whole purpose
was to keep the pager out of a clippable track, and `Center` is already
unclippable.

Both side tracks grow from a `0` basis with weight `1`, so the free space
splits evenly and the pager lands on the geometric centre.

`Right` deliberately does **not** get `min-w-0`. Its automatic
`min-width: auto` floors it at `min-content`, which is what guarantees
`PrimaryAction` is never clipped. The consequence is the intended graceful
degradation: once the right cluster genuinely needs more than half the free
space, it pushes and the pager **slides left rather than overlapping**.
Overlap is impossible by construction — there is no absolute positioning
anywhere in this design.

`RunStatus` moves into the right cluster, immediately before `CompareToggle`.
The header's mental model becomes **Identity | Navigation | Controls & Status**.

### 6.2 Regression risk to respect

#450 fixed a starvation bug in exactly these classes: `Left` was
`flex-1 min-w-0 overflow-hidden` and received only 270px at 1280px, clipping
the pager, the title and the stage rail. The fix at that time was `ml-auto` on
`Right` and `shrink` on `Left` — which this spec partially reverts.

Two things differ now, and only the first is a real safety argument:

1. **The tracks are far lighter than they were.** #475 deleted `StageRail`,
   `Reviewers`, `RoleChip` and the project crumb, folding all of them into one
   `RunStatus` chip. The 1010px that the non-`Left` tracks consumed at 1280px
   in the #450 era no longer has anything to be spent on.
2. `Right` now has a `min-content` floor and grows symmetrically with `Left`,
   so the deficit is shared rather than dumped entirely on the identity track.

What this does **not** prove is that the starvation cannot recur — the #450
failure was that the other tracks legitimately consumed the width, and a
config-blind flex split cannot sense per-config crowding (the standing
limitation recorded in #450). Do not treat the reasoning above as the check.
§8 makes measured verification the gate, and if the harness shows the title
crushed at a real width, the fallback is approach B from the brainstorm
(absolute centring above `@[64rem]`, flow below) rather than tuning magic
numbers.

### 6.3 Responsive scenarios

The cascade in `RunHeader.tsx`'s header comment is updated to match. Rows
marked *(existing)* are unchanged behaviour, restated so the table is a
complete picture.

| Header container width | Behaviour |
|---|---|
| ≥ 64rem | Everything visible; pager on the exact centre. |
| 48–64rem | `RunStatus` reviewer avatars drop *(existing)*. Pager intact and centred. |
| 42–48rem | Breadcrumb back arrow drops *(existing)*. Pager intact. |
| < 42rem | Pager still intact — it is the highest-priority navigation (#450). The article title truncates; it is the designated flex cushion. |
| < 30rem (~480px) | Unchanged from the row above: counter stays (D5), title keeps truncating. |
| `pointer: coarse` | Arrows render at 44px *(existing)*. |
| Single-article project | Pager renders `null`; the centre is simply empty. |

Non-width scenarios that must also be checked: QA in `compare` view, QA in the
consensus stage (where `CompareToggle` is deliberately absent), a finalized run
(where `Save` is hidden), and the packed consensus config with a long article
title — the configuration #475 measured as the worst case.

## 7. Copy

Existing keys are reused unchanged: `runs.articlePrevious`,
`runs.articleNext`, `runs.worklistPosition` (`{{n}} of {{m}}`),
`runs.shortcutNextPrev`.

Two keys change:

- `runs.worklistPositionLabel` ("Article {{n}} of {{m}}, open list") drops the
  "open list" clause and becomes the `<nav>` aria-label, since the counter is
  no longer a trigger.
- `runs.worklistSearch` ("Go to article…") becomes dead: it was the placeholder
  of the popover's `CommandInput`, and the palette already ships its own
  (`runs.commandPlaceholder`) plus a `runs.commandGoToArticle` group heading.
  It is deleted rather than left behind — it is dead *because of this change*,
  so it is not the unrelated dead code the project rule says to flag and leave.

English only, per the project hard rule.

## 8. Verification

Unit tests (Vitest, from the repo root — never `cd frontend`):

- `Worklist`: renders two buttons plus an inert counter; the counter is not a
  button; first/last article disables the corresponding arrow without changing
  the rendered width; returns `null` for `articles.length <= 1`; each arrow's
  tooltip names its key.
- `useRunShortcuts`: `J`/`K` navigate on both screens; both are ignored while
  the target is an input/textarea/contentEditable and when any modifier is
  held; `⌘K` toggles and `Esc` closes the palette; article keys are inert with
  fewer than two articles.
- `Help`: the rendered shortcut list is derived from the same constant the hook
  binds, so QA's help no longer advertises an absent binding.
- QA header: renders the pager and mounts the palette; navigation targets
  preserve the `:templateId` segment.

Measured verification — **this is the gate, not the unit tests**. Per
`reference_run_view_visual_verification_harness` and the #450 postmortem, mount
the real header in a throwaway `import.meta.env.DEV` route at fixed *container*
widths (the header keys off its own `@container/headerbar`, so fixed-width
wrappers exercise the whole cascade without auth or viewport resizing) and read
`getBoundingClientRect` at 1280 / 1024 / 900 / 768 / 700 / 560 / 480 / 375.
Assert, at every width: (a) the pager's centre is within a small tolerance of
the header's centre while the right cluster fits in its share, (b) no two track
rects overlap, (c) the `PrimaryAction` rect is never clipped. Delete the
harness route and file afterwards — they are never committed.

E2E: edit a field, press `J`, and assert the pending value persisted. Article
navigation is a **route-param** change on the same route element, so the
`useAutoSaveProposals` unmount flush does not obviously fire; making navigation
keyboard-cheap on a second screen widens the exposure. This test characterises
the real behaviour. If it fails, that is a pre-existing defect to report and
schedule — fixing it is out of scope per §3.

Gate before "done": `npm run lint`, `npm run typecheck`
(`tsc -p tsconfig.app.json` — Vitest does **not** typecheck), `npm run test:run`.

## 9. Files

Changed:

- `frontend/components/runs/header/Worklist.tsx` — restyle per §5.1.
- `frontend/components/runs/header/RunHeader.tsx` — track classes per §6.1;
  update the responsive-cascade comment to §6.3.
- `frontend/components/runs/header/Help.tsx` — derive `SHORTCUTS` from the
  shared constant.
- `frontend/components/extraction/ExtractionHeader.tsx` — drop the hand-rolled
  `keydown` effect for `useRunShortcuts`; `RunStatus` moves to the right
  cluster.
- `frontend/pages/QualityAssessmentFullScreen.tsx` — mount the pager and the
  palette; adopt `useRunShortcuts`; `RunStatus` moves to the right cluster.
- `frontend/hooks/qa/useQAWorklist.ts` — carry `title`.
- `frontend/lib/copy/runs.ts` — reword `worklistPositionLabel`, delete
  `worklistSearch`.

Added:

- `frontend/hooks/runs/useRunShortcuts.ts` and its test.
- Tests alongside the changed header components.

Additionally touched by the §10 cleanup pass, in its own commit:
`frontend/pages/ExtractionFullScreen.tsx`,
`frontend/components/runs/header/CommandPalette.tsx` (receives the relocated
`TODO(plan-future)`), `frontend/test/extractionReveal.test.tsx`,
`frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx`.

No backend, no migration, no seed.

## 10. Dead-code cleanup

A closing pass, run **after** §8 is green and committed **separately** so it can
be reverted on its own without losing the feature. Scoped to the files §9
already touches — this is the project's "clean in the code you touch" rule, not
a repo-wide hunt.

### 10.1 Dead *because of* this change

These do not exist as dead code today; the change creates them, so leaving them
would be new legacy:

- `runs.worklistSearch` — placeholder of the removed popover's `CommandInput`.
  The palette already ships `runs.commandPlaceholder` and a
  `runs.commandGoToArticle` heading.
- `runs.worklistPosition` (`{{n}} of {{m}}`) — its only consumer was the
  popover's position line. The visible counter renders the numerals directly
  (as it does today) and the accessible name comes from
  `runs.worklistPositionLabel` on the `<nav>`.
- The `Popover` / `Command` imports and the `open` state in `Worklist.tsx`.
- The two hand-rolled `keydown` effects and their `kbdRef` / `togglePdfRef`
  indirection, in `ExtractionHeader.tsx` and `QualityAssessmentFullScreen.tsx`,
  replaced by `useRunShortcuts`.
- The popover assertions in `Worklist.test.tsx`.
- The `TODO(plan-future)` in `Worklist.tsx` about per-article status needing a
  batch runs endpoint. The list it referred to now lives in the palette — the
  TODO **moves** to `CommandPalette.tsx` verbatim. It is a real open item
  (§3 keeps it out of scope); it must not be lost in the move.

### 10.2 Already dead in the files being touched

Verified by grep on 2026-08-22, counts stated so they can be re-checked:

- **`ExtractionHeaderProps`: 11 of 49 declared props are never referenced in
  the component body** — `onFinalize`, `finalizeLabel`, `isComplete`,
  `hasUnsavedChanges`, `templateId`, `templateName`, `runId`, `aiSuggestions`,
  `onExtractionComplete`, `onRefreshInstances`, `onExtractionStateChange`.
  Ten of them are still *passed* from `ExtractionFullScreen.tsx`, so the wiring
  is live and the consumption is not. Delete the declarations, the call-site
  attributes, and the corresponding keys in the two test fixtures
  (`frontend/test/extractionReveal.test.tsx`,
  `frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx`).

  This includes the pair carrying `@deprecated … full removal is HITL Phase 3`
  (`onFinalize`, `finalizeLabel`). Removing them from this header **is** that
  removal for this surface; it does not touch the unrelated live `onFinalize`
  on `ConsensusResolutionPanel`.

- `runs.keyboardShortcuts` — defined in `frontend/lib/copy/runs.ts` and
  referenced from nowhere in `frontend/`. Dead before this change; deleted
  because the same file is being edited for §7.

- Two comments that are now false, which is worse than dead code because they
  actively mislead:
  - `QualityAssessmentFullScreen.tsx`: `// "\" toggles the source (PDF) panel.
    No J/K — QA has a single article.` Already stale since #657 gave QA a
    worklist; this change makes it the opposite of true.
  - `RunHeader.tsx`: the responsive-cascade block describing the pager's "own
    protected `shrink-0` slot". §6.3 replaces that text.

### 10.3 Why this accumulated, and the stop rule

`noUnusedLocals` and `noUnusedParameters` are both on in `tsconfig.app.json`,
which is why unused *locals* and *imports* cannot survive — and exactly why
unused **interface members** did: the compiler does not check them. So §10.2
needs a manual sweep, while everything downstream of it does not.

That gives the cleanup a deterministic termination rule: after deleting the
props and their call-site attributes, run `npm run typecheck`
(`tsc -p tsconfig.app.json`) and delete whatever it reports as newly unused in
`ExtractionFullScreen.tsx`, repeating until it is quiet. **Stop there.** Do not
follow a symbol out into unrelated page logic by hand; if something looks dead
but the compiler does not say so, flag it and leave it (project rule:
*flag unrelated dead code, don't delete it*).

### 10.4 Explicitly not deleted

- Per-article status in the jump list (§3) — a real open item, tracked by the
  relocated `TODO(plan-future)`.
- Any dead code outside the §9 file list. If the sweep surfaces some, it is
  reported, not removed.

### 10.5 Gate

The cleanup commit must be green on `npm run lint`, `npm run typecheck` and
`npm run test:run` on its own, and the §8 harness measurement does **not** need
re-running: nothing in §10 changes rendered geometry. If any deletion turns out
to change behaviour, that is proof it was not dead — revert that deletion and
keep the rest.
