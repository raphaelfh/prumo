---
status: stable
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-06-21 · Owner: @raphaelfh

# Side Panels — Design System

**Last updated:** 2026-04-27

This document is the **single source of truth** for any side panel in Prumo: the main project sidebar, future article-detail panels, filter panels, inspector panels, etc. All such panels MUST follow these rules to keep behavior and look consistent.

## 1. Behavior model

- **Show / hide is binary for the persisted preference.** The saved state is just
  open/closed. The **main sidebar** additionally renders, while collapsed, a
  **56 px mini-rail with a hover/focus peek** that overlays content at the full
  256 px width. The peek is **transient** — never persisted, never cross-tab
  synced — and is rendered by a separate `SidebarRail` sibling, not by
  `ResizablePanel` (whose collapsed state stays a true unmount,
  `display:none`-equivalent). Pinning open (⌘B) is the normal expand; it pushes
  content, the peek only overlays. Secondary panels and the per-article focus
  shell stay strictly binary — the shell collapses to width 0 for max canvas.
- **Resizable with limits.** Every persistent panel exposes a 4 px drag handle on its outer edge.
  - **Click** → toggle collapse.
  - **Drag** → resize within `[minWidth, maxWidth]`.
  - **Snap-collapse**: releasing below a snap threshold auto-collapses the panel.
  - Cursor is `col-resize` on hover.
  - Shared Radix tooltip (not a native `title`) on hover **and** keyboard focus,
    ~400 ms delay: `Click to collapse · Drag to resize` plus the toggle shortcut
    chip (e.g. `⌘B`). The label is supplied by the caller via copy.
- **Keyboard:** every persistent panel has a toggle shortcut. The main sidebar uses `⌘B` (industry standard). Secondary panels define their own (e.g. `⌘\` for an inspector).
- **Persistence:** width and collapsed state persist in `localStorage` under `prumo:<panel-id>:{width,collapsed}`. Cross-tab sync via the `storage` event.

## 2. Sizing

| Panel | Default width | Min | Max | Snap-collapse |
|---|---:|---:|---:|---:|
| Main sidebar | 280 px | 240 | 400 | 150 |
| Article detail (future) | 420 px | 320 | 640 | 280 |
| Filters / inspector (future) | 280 px | 240 | 400 | 200 |

Anything new must declare these four values explicitly in its `<ResizablePanel>` props.

The main sidebar's collapsed **mini-rail is 56 px** (`w-14`); its hover/focus
**peek overlays at 256 px** (`w-64`). These are not `ResizablePanel` widths — the
rail is a separate `SidebarRail` component (see §1, §4).

## 3. Visual tokens

| Aspect | Token / value |
|---|---|
| Background | `bg-[#fafafa] dark:bg-[#0c0c0c]` |
| Border | `border-border/40` |
| Header height | `h-12` (48 px) with `border-b border-border/40` |
| Footer | `border-t border-border/40`, padding `p-2` |
| Panel motion | Symmetric on **both** expand and collapse — the same motion in reverse. Width leads on the `aside` (`transition-[width] duration-200 ease-out`); the content fades on the inner wrapper (`duration-150 delay-75` on expand so it trails the width, `duration-100` on collapse so it leads). The inner content keeps a fixed width (= open width) and is clipped by `overflow-hidden`, so rows slide/clip cleanly instead of squishing. `motion-reduce:duration-0` both ways; no entry animation on first mount. |
| Mini-rail / peek | Rail 56 px (`w-14`); peek 256 px (`w-64`) overlay with `shadow-elev-popover`, `transition-[width,box-shadow] duration-[180ms] ease-out`. The 56 px aside clips a fixed 256 px inner (`overflow-hidden`) so rows never reflow; labels/titles reveal via `group-data-[peek=closed]/rail:opacity-0` on the shared content. Hover-in 120 ms, hover-out grace 250 ms; `motion-reduce:duration-0`. |

## 4. Nav item rules

| Aspect | Value |
|---|---|
| Height | `h-7` (28 px) |
| Padding | `px-2.5` |
| Gap | `gap-2.5` |
| Radius | `rounded-md` |
| Typography | `text-[13px]` |
| Icon | 16 px (`h-4 w-4`), `strokeWidth={1.5}` |
| Active | `bg-muted text-foreground font-medium` |
| Inactive | `text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground` |
| Hover transition | `duration-75` |
| Active state aria | `aria-current="page"` |

**Collapsed mini-rail variant:** the same nav rows render icon-only at 56 px —
icon at the left gutter; label, shortcut chip, and section titles hidden via
`group-data-[peek=closed]/rail:opacity-0` and revealed on peek. It reuses the
shared `SidebarContent` (one set of focusable buttons — the peek does not
duplicate the nav), so active-state, copy, and shortcut wiring never drift.

## 5. Section title rules

- Text: `text-[11px] uppercase tracking-wider text-muted-foreground/50`
- Padding: `px-2.5 pb-1 pt-2`
- Non-selectable: `select-none`

## 6. Keyboard shortcut badges

- Component:
  - **Chord** (keys pressed simultaneously): `<KbdBadge keys={["mod","B"]} />` renders as a single chip `⌘B`.
  - **Sequence** (keys pressed one after the other): `<KbdBadge keys={["G","A"]} variant="sequence" />` renders as two adjacent chips `[G] [A]` (Linear/Plane style — no separator).
- **Goal: passive learning** — shortcuts stay discoverable without cluttering the rail.
- **Mechanism (primary nav rail): reveal on hover *and* keyboard focus.** The chip
  is hidden at rest (`opacity-0`) and revealed via `group-hover:opacity-100
  group-focus-visible:opacity-100 transition-opacity duration-75`. Focus parity is
  mandatory — `:hover` alone strands keyboard users; never hide the binding from
  assistive tech (the item keeps `aria-keyshortcuts`). This is the 2025–26
  Linear/Plane/WorkOS default; always-visible inline chips read as toolbar-era.
- **Always-on surface: the command palette.** Echo each binding right-aligned in
  ⌘K results so users who never hover still learn it. (This is what keeps passive
  learning alive after moving the rail chips to reveal-on-hover.)
- Apply ONE chip-visibility rule across `SidebarNavItem`, `UserMenu`, and
  `SidebarHeader`; persistent-context chips outside the scrollable nav rail (the
  switcher and footer) may stay visible since they are not row-dense.
- Detect macOS via `lib/platform.ts#isMac()` and substitute `⌘` ↔ `Ctrl`.
- `aria-hidden="true"` (the parent item carries `aria-keyshortcuts`, e.g. `"G P"` for a sequence).

## 7. Shortcut conventions

| Class | Pattern | Example |
|---|---|---|
| Toggle a panel | `⌘<letter>` | `⌘B` (sidebar), `⌘\` (inspector) |
| Navigate to a section / open switcher | `G` then `<letter>` | `G O` (overview), `G A` (articles), `G P` (project switcher) |
| Global action | `⌘<letter>` or `⌘<symbol>` | `⌘,` (settings), `⌘⇧Q` (sign out) |
| Contextual action | single letter | reserved for future (article selection, screening decisions etc.) |

All shortcut handlers MUST use the shared `useKeyboardShortcuts` hook so input-focus and dialog-open guards behave uniformly.

## 8. Accessibility

- Drag handle: `role="separator" aria-orientation="vertical" aria-controls={panelId} aria-valuemin aria-valuemax aria-valuenow`. Arrow keys adjust ±16 px when focused; Enter/Space toggles collapse.
- Focus management: collapsing via shortcut returns focus to the topbar toggle; expanding moves focus to the first nav item.
- Reduced motion: when `prefers-reduced-motion: reduce`, all transitions become `duration-0`.
- Mini-rail peek (WCAG 1.4.13): keyboard **focus** within the rail opens the peek
  (focus parity — never hover-only); **Esc** dismisses it without moving the
  pointer (Dismissable); the 250 ms hover-out grace lets the cursor travel from
  the rail into the floating panel without it vanishing (Hoverable/Persistent).
  Collapsed rail glyphs keep `aria-current` and `aria-keyshortcuts`.

## 9. When you build a new panel

1. Wrap it in `<ResizablePanel id="<unique-id>" side="left|right" defaultWidth=... minWidth=... maxWidth=... snapCollapseAt=...>`.
2. Add an entry to the table in §2.
3. Pick a `⌘<letter>` toggle shortcut not already used.
4. Use `<NavItem>` and `<SidebarSection>` for any nav inside it (or document why you can't).
5. Reference this file in your component's top-of-file comment.
