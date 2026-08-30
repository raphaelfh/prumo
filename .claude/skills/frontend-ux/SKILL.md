---
name: frontend-ux
description: prumo's visual language — the *what it should look like* layer (Plane/Linear/WorkOS aesthetic). Use when deciding layout structure, density, header height, sidebar behaviour, hover affordances, empty states, loading patterns, or any "how should this screen feel" question for frontend/ pages and components. The sibling ui-styling skill is the *how* layer underneath (Tailwind/shadcn/Radix mechanics) — read this one first when designing, that one when implementing classes.
---

# Frontend UX & UI Design System (Plane/Linear/WorkOS Style)

> **Precedence.** On core product UI this skill is authoritative — reproduce the
> existing Plane/Linear language, do not invent a new one. The enabled
> `frontend-design@claude-plugins-official` plugin optimises for *distinctive
> novelty* (it bans common defaults like Inter/system fonts and pushes bold,
> one-off directions); that fights a fixed benchmark, so reserve it for
> greenfield / marketing / illustrative surfaces only. When they conflict on a
> core screen, `frontend-ux` wins.
>
> **Verify with your eyes, not the diff.** After applying these rules, close the
> loop with the `design-review` skill (`/design-review <route>`): render →
> screenshot → compare to target → fix → re-screenshot. A class string that reads
> correct still ships the wrong screen.

## Role

You are a senior UX Engineer focused on **Productivity Software**. Your goal is to create an interface that feels like a
professional tool: fast, precise, and unobtrusive.

## 1. UX Philosophy: The "Invisible UI"

| Principle               | Description                                    | Implementation                                                             |
|-------------------------|------------------------------------------------|----------------------------------------------------------------------------|
| **Velocity**            | The UI should never lag or feel heavy.         | Use `backdrop-blur`, instant hover states, and optimized SVGs.             |
| **Information Density** | Professionals prefer seeing more data at once. | `text-[13px]` for body, `py-1` or `py-2` for rows.                         |
| **Visual Hierarchy**    | Contrast is used to guide, not to decorate.    | `text-foreground` for titles, `text-muted-foreground` for everything else. |
| **Contextual Actions**  | Actions appear only when needed.               | `group-hover` for row actions, subtle dropdowns.                           |
| **Breadcrumb First**    | Navigation > Page Titles.                      | Use breadcrumbs to show location instead of huge 24px titles.              |

## 2. Header & Menu Architecture

### The "Command" Header

Headers should be thin (h-12 / 48px) and serve as a navigation anchor, not just a title holder.

- **Background:** `bg-background/80` with `backdrop-blur-md`.
- **Border:** `border-b border-border/40`.
- **Typography:** `text-[13px] font-medium`.

### The "Professional" Sidebar

Sidebars should feel integrated into the window, not like a separate drawer.

- **Background:** `bg-sidebar` — the `--sidebar-*` tokens flip per theme. Do
  **not** hardcode `bg-[#fafafa]`/`bg-[#0c0c0c]`. Note
  `components/layout/ProjectSidebar.tsx` still does; it predates this rule.
- **Active State:** A subtle `bg-muted` or `bg-primary/5`, never a heavy highlight.
- **Icons:** Always `h-4 w-4` with `strokeWidth={1.5}`.

## 3. Component Specifications

### Menus & Dropdowns (The Plane Style)

- **Shadows:** Use very soft, large shadows: `shadow-[0_8px_30px_rgb(0,0,0,0.04)]`.
- **Borders:** `border-border/50`.
- **Padding:** `p-1` for the container, `px-2 py-1.5` for items.
- **Corner Radius:** `rounded-md` (8px).

### Buttons

**Never write a height into a Button's `className`.** The scale owns height.
Overriding it is what let five different heights coexist across 254 buttons —
`sm` used to be `h-9`, which never fit this language, so half the call sites
routed around it. `scripts/fitness/check_button_scale.py` now fails the build
on a new override (and it parses the tag, so `className={cn("h-8")}` and an
`onClick={() => …}` before `className` do not hide one).

| Size | Height | Use |
|---|---|---|
| `sm` | h-7 | **The default for all product chrome** — toolbars, dialog footers, row actions, cards |
| `xs` | h-6 | Nested density only — inside a popover, inline chips |
| `default` | h-10 | CTAs only — empty states, auth, marketing |
| `icon` | h-7 w-7 | Icon-only at chrome density |
| `icon-xs` | h-6 w-6 | Icon-only nested density |

Font size lives in the size, not the base, so a dense call site never has to
override it. Every dense size carries `[@media(pointer:coarse)]:h-11` (and the
square sizes bump width too) so touch targets reach 44px — that belongs in the
scale, never at the call site. A square button takes an `icon*` size: dropping
a height while leaving `w-8` renders a 28×32 rectangle.

**This table is the target, not yet the whole truth.** ~68 buttons carry no
`size` prop at all, so they still render `default` (h-10) — dialog footers
across the app are the visible case (`Cancel` / a confirm action at 40px next
to 28px content). They are neither migrated nor caught by the ratchet, which
only sees `h-*` overrides. Give a button an explicit size when you touch one.

- **Primary:** High contrast (Black in light mode, White in dark mode).
- **Secondary:** Transparent background, subtle border.
- **Ghost:** Used for all toolbar/menu items until hovered.

## 4. Interaction Patterns

1. **The "Silent" Hover:** List items should change background color instantly (`duration-0` or `duration-75`).
2. **Skeleton Strategy:** Skeletons must match the exact line-height and width of the expected text to prevent layout
   shift.
3. **Status Dots:** Small (6px), glowing for "Active", muted for "Draft".
4. **Buttons explain themselves on hover.** Every icon-only or short-label
   control carries a `Tooltip` with its description (copy through
   `lib/copy/`); icon-only buttons also get an `aria-label`. A terse label
   like "No information" or a bare glyph must never leave the user guessing.
5. **Selected = the accepted-suggestion treatment.** A control representing a
   recorded choice (accepted suggestion, active disposition, selected version)
   shows the success ring (`ring-1 ring-success bg-success/10 text-success`,
   usually with a small `Check`) — never just a shade — plus, where the input
   itself looks blank, an explicit "recorded" hint so the state is unambiguous.
6. **Selection is not focus — they never share a vocabulary.** Focus owns the
   outline (`outline-2 outline-ring`); selection owns a tint plus a weight or
   colour shift (`bg-muted/60` on the row, `font-medium text-foreground` on its
   label). Paint both on the same element and a row that is selected *and*
   focused draws two concentric 2px rules — a stray box floating over the row —
   while a merely selected row lies about having focus. (Shipped once on the
   template-config grid: `TemplateGridFieldRow` re-used `gridCellFocus`'s
   `CELL_RING` for its selected state.) The success-ring treatment in the
   previous bullet is for a *recorded choice*, which is a different thing again
   from "the row you are pointing at".

## 5. Responsive Behaviour

The density-first language has to hold from a wide desktop down to a phone.
**Every screen is designed for at least two widths — never assume desktop.**

| Width                | What the layout does                                                                                              |
|----------------------|-------------------------------------------------------------------------------------------------------------------|
| Wide (≥`lg` 1024)    | Full layout: sidebar visible, side-by-side comparison (`lg:grid-cols-2`), all header chips with labels.           |
| Mid (`sm`–`lg`)      | Sidebar may collapse to an icon rail; two-up panels stack; low-priority header chips start dropping their labels. |
| Narrow (<`sm` 640)   | Sidebar becomes a `Sheet` drawer (`MobileSidebar`); dense tables become **card lists** (`useIsNarrow`); row actions move into an always-visible kebab. |

Principles:

- **Degrade, don't overflow.** Long strings ellipsize (`min-w-0 truncate`),
  chrome tightens its gaps, low-priority chips drop their labels — content never
  paints outside its track or forces a horizontal scrollbar. The run/extraction
  headers do this with **container queries** (they react to their *own* width, so
  they reflow even when the viewport has not crossed a breakpoint).
- **Keep density at every width.** Narrow ≠ bigger. The `h-12` header,
  `text-[13px]` body, and row height survive the shrink; you trade columns and
  labels for space, never font size.
- **Touch needs a fallback.** Hover-only affordances (`group-hover` reveal) are
  invisible on touch — at narrow widths the row is tappable and the kebab is
  always shown.
- **Tables → cards below `sm`.** Do not crush a dense table to unreadable; switch
  to the card-list layout via `useIsNarrow` (`frontend/hooks/use-mobile.tsx`).

The breakpoint scale is the Tailwind default with `2xl` overridden to **1400px**
(`tailwind.config.ts`). Wiring mechanics — breakpoint prefixes, container queries,
the `useIsMobile`/`useIsNarrow` hooks, the priority-track header — live in
`ui-styling` (§ *Responsive mechanics*).

## 6. The Edge Budget (space belongs to content)

A dense tool earns its keep by showing more of the user's data, not more of
its own frame. Everything between the viewport edge and the first row of
content is chrome, and chrome is on a budget. Reclaiming the outer margin is
the cheapest density win available — it costs no legibility, because nothing
was there.

| Boundary                              | Budget                          | Why                                                                                                                       |
|---------------------------------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| Page gutter (viewport → workspace)    | `px-4 py-3`, `lg:px-6`          | 24px is as wide as a page band ever needs. `lg:px-10` spent 80px of a 1340px window painting nothing.                      |
| Panel / card padding                  | `p-2`–`p-3` dense, `p-4` prose  | The component owns its own inset; the parent owns the gap between components.                                              |
| Between siblings                      | `gap-3` (12px)                  | Below ~12px adjacent regions start to visually merge and the reader misreads where one ends.                               |
| Compact row (rail, menu, list item)   | `px-2 py-1`, `space-y-0.5`      | 4px vertical / 8–12px horizontal is the compact tier's floor. Tighter and the rows stop being separable at a glance.       |
| Row height in a data grid             | 30–32px                         | Already the grid's contract; the edge budget must not be paid for by squeezing rows.                                        |

Three rules follow, and they are the ones that actually get broken:

1. **One hairline per boundary, drawn by its owner.** Two adjacent regions must
   never each draw the same separator, and a card dropped inside an
   already-bordered pane must not draw a second frame around itself. Most
   regions need only a background, one hairline, and intentional spacing —
   *not* a card. Nested cards are the single most common source of the "why is
   there a 2px gutter of nothing here" look.
2. **Do not double padding.** A padded child inside a padded parent adds its
   inset to the parent's. Decide which one owns the space and zero the other.
3. **A resizable pane needs three limits, not one.** Its own `min` and `max`,
   **plus a floor under the pane it steals from** — measured live from that
   element, because a percentage floor drifts with the window (10% is 180px on
   an 1800px card and 90px on a 900px one, which is exactly the
   collapse-to-unusable it was meant to prevent). Growing stops at the floor;
   shrinking never does, so a window narrowed past it is never a trap. Ship the
   keyboard path with the drag (`role="separator"`, `aria-valuenow/min/max`,
   arrows to nudge, `Home`/`End` to the edges), let the divider BE the boundary
   hairline, and draw its hover/focus state as a pseudo-element — a focus ring
   around a 1px box renders as a slab, and widening the box shifts both panes
   every time focus lands. Reference: `template-config/PaneResizer.tsx`.
4. **Reclaimed outer space is spent inside, not banked.** Tightening a gutter is
   only a win if what it reveals is still readable: the same pass that cut this
   surface's page gutter from 40px to 24px spent part of it widening the outline
   rail and loosening its rows from 1px gaps to 2px with 4/8px padding. Density
   is *more content legibly*, never *the same content, closer together*.

**Verify by measuring, not by reading the diff.** Getting a gutter wrong is
invisible in a class string. Run the browser loop from `design-review`, and for
a density change measure the same session twice (see the density before/after
recipe): a font census over elements with their own text node, and a target
census flagging anything under 24×24.

## 7. Implementation Checklist

- [ ] Header height is exactly `h-12`.
- [ ] Main UI font size is `text-[13px]`.
- [ ] Borders use `border-border/40`.
- [ ] Icons are `h-4 w-4` and consistent (14px inside `xs` / `icon-xs`, which
      set their own `[&_svg]:size-3.5`).
- [ ] Buttons use a named size — no `h-<n>` in a Button `className`.
- [ ] Hover states on lists use `hover:bg-muted/50`.
- [ ] Breadcrumbs are used for navigation context.
- [ ] Shadows are soft and minimal.
- [ ] Checked at a narrow width too — degrades cleanly, no overflow, touch
      actions reachable (responsive is part of "done", not a later pass).
- [ ] Edge budget respected: page gutter ≤ 24px, one hairline per boundary,
      no card inside a bordered pane, no doubled padding (§6).
- [ ] Any resizable pane clamps min, max AND the floor of what it steals
      from, and its divider is keyboard-operable (§6.3).
- [ ] Selection and focus use different vocabularies — no element paints both
      an `outline-ring` and a selected state (§4.6).
