---
status: approved
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

> **Status:** Approved · Last reviewed: 2026-06-21 · Owner: @raphaelfh

# Sidebar SOTA polish — design

Modernise the project sidebar to the Linear/Plane/WorkOS bar the brief
targets, fix the collapse/expand animation asymmetry, and make the
per-article extraction/QA workspaces collapse the sidebar by default
without fighting the user's saved preference.

Grounded in the `sidebar-sota-brainstorm` audit + SOTA research pass
(2026-06-21). Canonical design-system reference:
[`sidebar-and-panels.md`](../design-system/sidebar-and-panels.md).

## Problem

1. **Shortcut chips read as toolbar-era.** Nav items render the kbd
   badge with `opacity-60 group-hover:opacity-100` — present-but-dimmed
   at rest, which is neither the spec's "always visible" nor the
   modern hover-reveal. SOTA ranks always-visible inline chips lowest
   for a primary rail and hover-reveal highest (Linear/Notion/Vercel).
2. **Hover/active vocabulary is inconsistent** across the rail vs
   `UserMenu`/`SidebarHeader` (full-opacity chips) and two hand-rolled
   `<kbd>` sites (`Help.tsx`, `AllowedValuesList.tsx`). Icon-control
   tooltips mix native `title=` with Radix `Tooltip`.
3. **Collapse/expand is asymmetric.** `ResizablePanel` animates the
   *collapse* (width + opacity → 0) but the *expand* re-mounts from
   `return null` at full width, so it pops in with no transition. The
   animation also fades opacity, which the design system spec (§3)
   does not call for (`transition-[width]` only).
4. **Per-article focus views don't reliably collapse.**
   `RunWorkspaceShell` passes `defaultCollapsed`, but
   `readInitialCollapsed` lets the persisted shared key win, so after
   any prior toggle the focus views open expanded. The run shell and
   project shell also share one localStorage key, so each clobbers the
   other.

## Decisions (approved)

- **Direction A — "Quiet Linear"** for the nav rail: clean labels at
  rest; the shortcut chip reveals on hover **and keyboard focus**;
  active stays `bg-muted` + `font-medium` (two channels).
- **Collapse default scoped to the per-article extraction/QA
  workspaces** (the `RunWorkspaceShell` routes), not the project-level
  tabs. Implemented as a **non-destructive, view-scoped** behaviour.
- **Amend spec §6** (always-visible → reveal-on-hover-and-focus in the
  rail, command palette as the always-on learning surface).

## Detailed design

### 1. Nav-item shortcut reveal (Direction A)

`SidebarNavItem.tsx` — change only the `KbdBadge` className:

- from: `opacity-60 group-hover:opacity-100`
- to: `opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-75`

The row is already a `group` `Button`, so `group-focus-visible:`
reveals the chip when the item is tab-focused (focus parity is
mandatory — bare `:hover` strands keyboard users; `aria-keyshortcuts`
already carries the binding for AT). Rest/hover/active row classes are
unchanged (they are already Direction A). The active row's chip follows
the same reveal so the selected row is equally clean at rest.

### 2. Tooltip + chip standardisation (icon-only controls)

- One shared icon-control tooltip: Radix `Tooltip`, `delayDuration`
  ~400ms + `skipDelayDuration` for in-group instant re-show, placed to
  the side of a left rail, **fires on focus too**.
- One key per chip; platform glyph auto-swap `⌘ ↔ Ctrl` via
  `lib/platform.ts#isMac()` (never hardcode the glyph).
- Replace the native `title=` on the `ResizablePanel` drag handle with
  the shared tooltip and route its text through `frontend/lib/copy/`
  (currently hardcoded English — convention violation), including the
  ⌘B shortcut the spec's tooltip calls for.

### 3. Collapse default on per-article extraction/QA (non-destructive)

Add a `persist` option to `SidebarProvider` (default `true`).
View-scoped shells opt out of the shared baseline:

```
SidebarProvider({ children, defaultCollapsed = false, persist = true })
```

When `persist === false`:
- `readInitialCollapsed` is bypassed — initial state is exactly
  `defaultCollapsed` (the focus view always starts collapsed,
  regardless of the saved baseline).
- the localStorage write effect is skipped (toggles stay in memory).
- the cross-tab `storage` listener is skipped (a focus view is
  view-scoped, not a global preference).

`RunWorkspaceShell` becomes `<SidebarProvider defaultCollapsed
persist={false}>`. Result:

- Per-article extraction (`/projects/:id/extraction/:articleId`) and
  QA (`/projects/:id/articles/:id/quality-assessment/:templateId`)
  always open collapsed.
- ⌘B / `RunHeader.SidebarToggle` open it **in memory** for the visit —
  the project-view baseline (`prumo:sidebar:collapsed`) is never
  touched.
- Leaving the view unmounts the run provider; the project shell reads
  its untouched baseline → prior state restored automatically.

This is the minimal expression of the audit's "baseline + view
override" model, exploiting the existing two-provider topology
(separate `SidebarProvider` per run page), and it removes the
defaultCollapsed-ignored-once-key-exists bug.

### 4. Collapse/expand animation — symmetric and on-trend (`ResizablePanel`)

Today the collapse animates but the expand re-mounts from `return null`
at full width and pops in with no transition. Goal: the **same polished
motion plays on BOTH expand and collapse**, aligned with the current
trend (Linear/Arc/ChatGPT-style coordinated slide) — not stripped back
to a flat width-only snap.

- **Symmetry first.** Add an enter animation mirroring the existing
  `isClosing` close: on expand, mount at width 0, then move to the
  target width on the next animation frame so the transition has a
  "from" value. Net: expand and collapse run the identical motion in
  reverse — no instant pop on either side.
- **Motion = width-led slide + coordinated content fade.** Width is
  the primary driver (~200ms, ease-out / gentle decelerate); content
  opacity rides along (fade in on expand, fade out on collapse). On
  expand let the content fade trail the width slightly (~150ms fade vs
  ~200ms width) for the premium staggered feel; on collapse the content
  leaves first. This keeps the modern look the brief asks for rather
  than a flat snap.
- **No squish.** Give the inner content a fixed width (= open width)
  with `overflow-hidden` so the rows slide/clip behind the edge instead
  of reflowing as the container narrows. This is what makes the fade
  read as polished rather than muddy — the current crude *simultaneous*
  width+opacity blend on a fluid-width child is exactly why it looks
  like "a fade" today.
- **Reduced motion / first paint.** Keep `motion-reduce:duration-0`
  (instant both ways); no entry animation on first mount or when the
  panel starts `collapsed=true`.
- Update design-system spec §3 to describe this symmetric width-led
  slide + coordinated fade (replacing the current width-only line).

### 5. Spec §6 amendment

Rewrite §6 of `sidebar-and-panels.md`: keep the goal (shortcuts
discoverable for passive learning); change the mechanism to —
shortcuts are **revealed on hover and keyboard focus** in the primary
rail (never hidden from AT), and **always visible right-aligned in the
command palette** (the canonical always-on learning surface). Add the
focus-parity requirement explicitly. Apply one chip-visibility rule
across `SidebarNavItem`, `UserMenu`, `SidebarHeader`.

### 6. Consistency sweep (optional, same PR or follow-up)

- Unify `UserMenu`/`SidebarHeader` chips onto the §6 rule.
- Retire the hand-rolled `<kbd>` in `Help.tsx` / `AllowedValuesList.tsx`
  onto `KbdBadge`.
- Standardise stray `transition-colors` (150ms default) onto
  `duration-75` in the touched components.

## Testing

- `SidebarContext`: `persist={false}` ignores the stored key, starts
  at `defaultCollapsed`, does not write localStorage on toggle, and a
  persisted (`persist` default) provider is unaffected. (Extends
  `SidebarContext.test.tsx`.)
- `SidebarNavItem`: chip hidden at rest, revealed on hover and on
  `focus-visible`; `aria-keyshortcuts` present. (Extends
  `SidebarNavItem.test.tsx`.)
- `ResizablePanel`: expand mounts then transitions (not instant —
  symmetric with collapse); inner content has a fixed width (no reflow
  during the slide); reduced-motion → instant both ways.
- E2E sanity: entering a per-article extraction/QA route opens
  collapsed even when the project baseline is expanded; toggling there
  does not change the project view on return.

## Out of scope

- Mini/icon-rail "hover-peek" collapsed mode (SOTA P2) — delivered as a
  follow-up, see below.
- Re-baselining the run-page `SectionNavRail` active idiom (only
  required if Direction C were chosen; A leaves it alone).
- Any backend / data-path change.

## Follow-up: hover-peek mini-rail (approved 2026-06-21)

Approved decisions (mockup + selection): **transient overlay** (not a
state-model change), **main sidebar only**, **explicit ⌘B/click pin**.

- **State model.** `sidebarCollapsed` stays binary; the rail is a third
  *visual* state shown only while collapsed. No tri-state enum, no storage
  migration — the persist invariant (and the focus-shell width-0 path)
  are untouched.
- **Components.** `SidebarRail` (56 px in-flow slot + an absolute overlay
  that widens to 256 px on peek, clipping a fixed-256 inner) hosts the
  shared `SidebarContent` (extracted from `ProjectSidebar`). `useSidebarPeek`
  owns the hover-in (120 ms) / hover-out grace (250 ms) + focus + Esc.
  Rail-aware classes (`group-data-[peek=closed]/rail:opacity-0`) on the
  content's label/chip/title degrade it to icon-only when collapsed and are
  inert in the full sidebar.
- **Surfaces.** `ProjectSidebar` gains a `rail` prop; `ProjectLayout` sets it,
  `RunWorkspaceShell` does not (focus shell keeps width-0).
- **Pin.** ⌘B / the topbar toggle flips `sidebarCollapsed` (rail ⇆ full,
  pushing content); hover/focus peek never writes the preference.
- **A11y.** Focus opens the peek, Esc dismisses, 250 ms grace makes it
  Hoverable (WCAG 1.4.13); `aria-keyshortcuts`/`aria-current` preserved.
- **Spec.** Amended `sidebar-and-panels.md` §1 (mini-rail allowed, peek
  transient), §2 (56/256), §3 (peek motion), §4 (icon-rail variant), §8
  (WCAG 1.4.13).
- **Tests.** `useSidebarPeek` (timers/focus/Esc), `SidebarRail`
  (collapsed default, focus-opens/Esc-closes, hover-in delay).

Out of scope for this follow-up: animating the rail⇆full *pin* width (it is
an instant swap; only the peek animates).
