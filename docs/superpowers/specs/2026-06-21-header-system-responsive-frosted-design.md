---
status: proposed
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

> **Status:** Proposed — design brainstormed 2026-06-21. Awaiting user
> review before an implementation plan is written.

# Design: Unified header system — responsive + restrained frosted glass

**Date:** 2026-06-21

## 1. Context

The trigger was a visibly broken project `Topbar` at phone width (the
Assessment / Dashboard / Configuration switcher cramming and clipping the
left title). A read-only audit of the whole header surface showed the
defect is **architectural, not cosmetic**: there are five places that
paint a frosted `h-12` bar and they share *no* primitives, two of them
use *different responsive mental models*, and neither real header has a
working overflow strategy.

Audited surface (read-only, 2026-06-21):

- `frontend/components/navigation/Topbar.tsx` — global app chrome.
- `frontend/components/runs/header/*` (18 files) — the `RunHeader`
  compound used in focus-mode run pages.
- `frontend/components/assessment/AssessmentShell.tsx`,
  `frontend/components/runs/RunWorkspaceShell.tsx` — page shells.
- `frontend/pages/ExtractionFullScreen.tsx` (via `ExtractionHeader`) and
  `frontend/pages/QualityAssessmentFullScreen.tsx` — the two run pages
  that mount `RunHeader` (differently).
- `frontend/index.css` (`.linear-header`, orphan), `tailwind.config.ts`,
  header copy keys.

### 1.1 Root-cause findings

1. **Two responsive mental models.** `Topbar` collapses on **viewport**
   width (`sm:`/`lg:`) inside a rigid `grid-cols-[1fr_auto_1fr]` whose
   `auto` center (the switcher) never yields — so the `1fr` title column
   is crushed first. `RunHeader` collapses on **container** width
   (`@container/headerbar`, tiers `@[40/48/52rem]`). They degrade on
   different axes; "responsive as one system" is impossible today.
2. **Inverted container ownership.** `RunHeaderRoot` does *not* declare
   `@container/headerbar`; each consumer does
   (`ExtractionHeader.tsx:264`, `QualityAssessmentFullScreen.tsx:541`).
   Forgetting the wrapper silently freezes every responsive label/divider
   with no error.
3. **Copy-pasted frosted recipe.**
   `border-b border-border/40 bg-background/80 backdrop-blur-md` + `h-12`
   is hand-typed in `RunHeader.tsx:41`, `Topbar.tsx:45/60/73`, and three
   page bars — while the canonical `.linear-header` (`index.css:206`) is
   used by nobody and has already drifted (`z-50`/`px-6`/`sticky`).
4. **No working priority-plus overflow.** `Topbar`'s `SectionViewSwitcher`
   never collapses (fixed `h-7` pills). `RunHeader` has a kebab `Menu` but
   it only ever holds compare/reopen and absorbs *nothing* from the
   starving Left slot — so on phone the breadcrumb crushes to an ellipsis
   while `Worklist`, `SaveSlot`, `StageRail` keep full width.
5. **Overlays overflow the phone.** `NotificationCenter` (`w-[400px]`) and
   `Worklist` popover (`w-80`) have no viewport clamp; pinned `align`
   makes them clip at ≤480px.
6. **Duplication + drift.** The sidebar/panel toggle is re-implemented
   three times (`Topbar` inline `L99-114`, `SidebarToggle.tsx`,
   `PanelToggle.tsx`). Touch targets bypass the `Button` cva with inline
   `h-8`/`h-7` (22–32px, below the 44px guideline). Five type sizes
   (10/11/12/13/14px) coexist across two 48px bars.

## 2. Goals / non-goals

### Goals

- Both real headers (`Topbar`, `RunHeader`) behave correctly from ~320px
  (no horizontal scroll, no clipped controls) through tablet to wide
  desktop, and degrade on the **same axis** via **one** breakpoint model.
- The two headers visibly "talk to each other": one shared shell, one
  frosted surface, one overflow idiom, one touch/type scale.
- A restrained, Apple-flavored **frosted** treatment on the bars and their
  floating overlays — extending the existing `bg-background/80
  backdrop-blur-md` language, *not* full liquid glass.
- A single edit point for every frosted/layout token (no more 5× drift).

### Non-goals (this PR)

- Migrating the ad-hoc `h-12` bars (`PageHeader.tsx`, `Dashboard.tsx`,
  `ProjectView.tsx`) and the Extraction status/consensus sub-bars onto the
  shared shell. They are left as a **fast follow-up** (decision: focused
  scope). `HeaderShell` is designed so they can adopt it later.
- `NotificationCenter` hardcoded-Portuguese-strings + emoji cleanup —
  spun off as a separate task (English-only / no-emoji hard-rule fix,
  unrelated to layout).
- Behavioral changes to run state, autosave, consensus, or AI suggestion
  logic. This is presentation + composition only.

## 3. Decisions (locked in brainstorm 2026-06-21)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope | **Two headers + their overlays.** Ad-hoc bars + sub-bars deferred. |
| D2 | Frosted intensity | **Restrained, shadow-on-lift.** One blur level; hairline border at rest; soft low-alpha shadow only on floating overlays and when a header is pinned/scrolled. Not liquid glass. |
| D3 | Phone focus-mode nav | **Add a focus-mode hamburger** to `RunHeader` at the `compact` tier that opens the `ProjectSidebar` drawer. |
| D4 | Touch targets | **Grow only on touch devices** — controls bump to ≥44px under `@media (pointer:coarse)`; stay `h-8` on mouse/desktop. |
| D5 (assumed) | Breakpoint tiers | Adopt `compact @34rem / comfortable @48rem / spacious @64rem`. |
| D6 (assumed) | Topbar overflow | `SectionViewSwitcher` collapses to a dropdown (`Select`/`DropdownMenu`) below `compact`. |
| D7 (assumed) | RunHeader Left | Unify the two consumers onto one canonical Left order; QA's kind-badge + version may fold into the kebab at `compact`. |

## 4. Architecture

### 4.1 `HeaderShell` primitive

A new `frontend/components/layout/HeaderShell.tsx` (+ a cva) is the single
source of truth for the bar chrome. It:

- Renders the frosted surface from **tokens** (§4.4), not literal classes.
- **Declares `@container/headerbar` on itself** — responsive ownership
  moves inside the shell, fixing finding #2. Consumers stop wrapping.
- Exposes a `position` variant (`sticky` default | `relative`) and a
  `pad` ramp (`px-3` → `@[48rem]:px-6`), retiring `Topbar`'s `px-4` base
  and `.linear-header`'s `px-6`.
- Carries the `--header-z` token and the shadow-on-lift behavior (D2).
- Provides the three-slot scaffold (`Left` `flex-1 min-w-0
  overflow-hidden`, `Center` `shrink min-w-0 overflow-hidden`, `Right`
  `shrink-0`) so both headers inherit the same overflow discipline.

`Topbar` and `RunHeaderRoot` both render through `HeaderShell`. The orphan
`.linear-header` is deleted. The consumer-side `@container` wrappers in
`ExtractionHeader.tsx:264` and `QualityAssessmentFullScreen.tsx:541` are
removed.

> Compiler note: `HeaderShell` and all new components are function
> components with no `try/finally`; any IO stays in services (none needed
> here — this is pure presentation). Keeps `panicThreshold: all_errors`
> happy.

### 4.2 Unified breakpoint model

One container-query scale for **both** headers, keyed off the single
`@container/headerbar` the shell declares (so it tracks the header's own
width and reacts identically whether or not the sidebar is open):

- **`compact` (base, below `@34rem` ≈ 544px)** — phone / narrow. Most
  collapsed state. The tier the audit found completely unhandled.
- **`comfortable` (`@48rem` ≈ 768px)** — tablet. Primary labels + divider
  + inline Help return; switcher returns to pills; gaps step up.
- **`spacious` (`@64rem` ≈ 1024px)** — desktop. Secondary helpers (e.g.
  `PrimaryAction`'s "X of Y" gate reason), roomier padding.

The `Topbar` viewport `sm:`/`lg:` queries are dropped. The one legitimate
viewport concern (hamburger vs desktop sidebar toggle) keys off sidebar
collapsibility / route, not screen size, so it does not need a viewport
breakpoint.

**Rules that travel with the model:**

1. Collapse via CSS visibility (`hidden` / `sr-only`), **never**
   conditional unmount — existing tests (e.g. `StageRail.test.tsx`,
   suffix/helper presence assertions) depend on label text staying in the
   DOM.
2. Slot priority is fixed (Left flexes, Center shrinks, Right is rigid)
   with the overflow `Menu` as the documented sink.
3. Padding ramp unified to `px-3` → `@[48rem]:px-6` for both headers.
4. Touch sizing (D4) is orthogonal to the width tiers — a separate
   `@media (pointer:coarse)` bump.

### 4.3 One overflow idiom (priority-plus)

A shared collapse contract used by both headers below `compact`:

- **Topbar:** `SectionViewSwitcher` renders two representations from one
  data source — the segmented pill group (`hidden @[34rem]/headerbar:flex`)
  and a labeled dropdown showing the active view + chevron
  (`flex @[34rem]/headerbar:hidden`). `display:none` keeps only one in the
  a11y tree (no duplicate `tablist`). The grid is replaced/relaxed so the
  left title can `min-w-0 truncate`.
- **RunHeader:** the kebab `Menu` becomes the genuine Left/Right sink it
  lacks. Below `compact`, `Help`, `SaveSlot` (as a "Saved" item), AI
  suggestions, `Reviewers`, `RoleChip`, and compare/reopen fold into it
  (kebab shows a dot when it holds actionable items). `Breadcrumb` shows
  back + last crumb only; `StageRail` degrades to label-less dots;
  `PrimaryAction` stays visible (it is the CTA); `PanelToggle` stays.
- A **focus-mode hamburger** (D3) is added to the RunHeader Left at
  `compact`, opening the `ProjectSidebar` mobile drawer
  (`RunWorkspaceShell` currently drops the `Topbar`, stranding phone
  users with only a back button).

### 4.4 Frosted-glass tokens (D2)

New CSS variables (in `index.css`, mapped in `tailwind.config.ts`),
tuned per light/dark mode:

- `--header-blur` — one backdrop-blur level, reconciling the current
  `md` (headers) vs `sm` (accordions) split.
- `--header-surface-alpha` — surface opacity kept high enough (~0.82) to
  hold **AA** text contrast over busy content.
- `--shadow-header` — restrained soft drop shadow (hairline border + low
  alpha), distinct from the existing `shadow-elev-popover`. Applied to
  floating overlays always, and to a header **only when pinned/scrolled**
  (a `data-scrolled` / `:has` or IntersectionObserver-driven state).
- `--header-z` — single z-index token replacing the arbitrary
  `z-40`/`z-10`/`z-50` literals.

**Guardrails (mandatory):**

- `@supports not (backdrop-filter: blur(1px))` → solid `bg-popover` /
  `bg-background` fallback (the real headers currently omit this; some
  accordions already include it — make it uniform).
- `@media (prefers-reduced-transparency: reduce)` → solid surface.
- `@media (prefers-reduced-motion: reduce)` → no crossfade on the
  toggle / no shadow transition.
- No specular highlights, gradients, or `saturate`/`brightness` boosts on
  data surfaces. Glass is for floating chrome only.

### 4.5 Shared sub-primitives

- **`PanelToggleButton` (`side: 'left' | 'right'`)** — one component for
  the 3 duplicated opacity-crossfade toggles; owns the two icons,
  `duration-150` crossfade, `aria-pressed`, `aria-keyshortcuts`
  (`Meta+B` / `\`). Consumed by both headers.
- **`HeaderButton` / `HeaderChip`** — a `Button` `size="header"` variant
  (single `h-8` token, `→ ≥44px` under `pointer:coarse`) replacing every
  inline `h-8`/`h-7` override; one `HeaderChip` cva
  (radius/padding/focus-ring/min-touch/type) replacing the hand-rolled
  pills in `AIActions`, `Reviewers`, `RoleChip`, and the Topbar brand
  badge.
- **Overlay width clamp** — a shared content class applying the frosted
  surface + `--shadow-header` + `w-[min(<desired>,calc(100vw-1rem))]` +
  Radix collision padding. Adopted by `NotificationCenter`, `Worklist`,
  `CommandPalette`, `Help`, and the kebab `Menu`.
- **Header type scale** — 3 steps: `header-title 13px` / `header-meta
  12px` / `header-micro 11px` (floor). 10px banned in interactive /
  informational header text.
- **`TruncatedText` everywhere** — reuse the existing tooltip-on-overflow
  primitive for the Topbar section title (currently plain `truncate`) and
  the QA badge/version, enforcing the documented "every crumb needs
  `min-w-0 truncate`" rule uniformly.

## 5. Per-tier behavior (RunHeader, QA example)

| Element | `compact` (≤34rem) | `comfortable` (48rem) | `spacious` (64rem) |
|---|---|---|---|
| Nav | focus-mode hamburger + back | sidebar toggle + back | sidebar toggle + back |
| Breadcrumb | last crumb, truncate | full chain | full chain |
| Kind badge / version | in kebab | badge visible, version trims | badge + version |
| StageRail | label-less dots | dots + stage labels | dots + labels + revision |
| Save | "Saved" in kebab | inline icon + text | inline icon + text |
| Reviewers / Role | in kebab (or avatar+count) | avatars + "N differ" | full |
| AI actions | icon only (in kebab if tight) | icon + count | icon + "AI · N" |
| PrimaryAction | visible (CTA) | visible | visible + gate reason |
| Help | in kebab | inline + divider | inline + divider |
| PDF panel toggle | visible | visible | visible |

The Topbar mirrors this: switcher → dropdown at `compact`, pills at
`comfortable`+; title truncates; bell + feedback stay as icons; their
overlays clamp to the viewport.

## 6. Accessibility

- Frosted surfaces hold AA contrast (alpha ≥ ~0.82) + solid fallbacks for
  `backdrop-filter` absence, reduced-transparency, reduced-motion.
- Collapsed switcher uses `display:none` so only one control is in the
  a11y tree; the dropdown trigger is a labeled `button` with the active
  view name.
- Every header control keeps a visible focus ring (via `HeaderButton` /
  `HeaderChip`, not per-call-site).
- Touch targets ≥44px under `pointer:coarse` (D4).
- Keyboard parity preserved: `Meta+B` (sidebar), `\` (PDF panel), command
  palette unchanged.

## 7. Testing

- **Vitest:** extend `SectionViewSwitcher.test.tsx` (both representations
  present; `select` fires from the dropdown). Add `HeaderShell` tests
  (renders `@container`, applies tokens, `position` variant). Keep
  collapse-via-visibility so existing `RunHeader` DOM-presence assertions
  pass; update only where composition is intentionally unified (D7 — note
  the QA badge test asserts the text *exists*, not that it is always
  visible; verify before allowing it to fold).
- **Factor shared test utils:** the duplicated `base` value object +
  `vi.mock('@/lib/copy')` stub into one helper.
- **Visual harness (the layer no jsdom test covers):** a throwaway
  DEV-only route mounting both headers with mock props; measure
  bounding-rects at **320 / 480 / 700 / 900 / 1280** for overlap / clip /
  overflow; then run `/design-review` on the live routes. Delete the
  harness after. (Per the run-view visual-verification approach already
  used in this repo.)
- **Breakpoints are measured, not guessed:** the `34/48/64rem` values are
  starting points; confirm the actual fit points in the harness and
  adjust before locking.

## 8. Sequencing (for the implementation plan)

1. Tokens + `HeaderShell` + `PanelToggleButton` + `HeaderButton`/
   `HeaderChip` + type scale (no behavior change yet).
2. Migrate `RunHeader` onto `HeaderShell`; move `@container` inside; unify
   the two consumers' Left composition (D7); wire the kebab as the real
   overflow sink + focus-mode hamburger (D3).
3. Migrate `Topbar` onto `HeaderShell`; relax the grid; collapse
   `SectionViewSwitcher` to a dropdown (D6); `TruncatedText` title.
4. Overlay width-clamp + frosted treatment on `NotificationCenter`,
   `Worklist`, `Help`, `CommandPalette`, `Menu`.
5. Visual harness pass at all widths; `/design-review` on
   `/projects/:id?qaTab=...` and the extraction route; tune tokens.

## 9. Out of scope / follow-ups

- Migrate `PageHeader`/`Dashboard`/`ProjectView` + Extraction sub-bars
  onto `HeaderShell` (deferred per D1).
- `NotificationCenter` PT-strings + emoji cleanup (separate task).
- `RunWorkspaceShell` `h-screen` → `dvh/svh` (mobile viewport) — fold in
  opportunistically if it touches the same lines, else follow-up.

## 10. Risks

- **Container-query reliance** — already used in `RunHeader`, well
  supported; the shell declaring its own container removes the current
  footgun rather than adding one.
- **Test churn** — mitigated by collapse-via-visibility (DOM presence
  preserved) and by unifying composition only where decided (D7).
- **Frosted legibility on dense data** — mitigated by high surface alpha,
  AA check, and the solid fallbacks; glass restricted to floating chrome.
