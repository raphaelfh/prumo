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
  **not** hardcode `bg-[#fafafa]`/`bg-[#0c0c0c]`; the real `ui/sidebar.tsx`
  uses `bg-sidebar text-sidebar-foreground`.
- **Active State:** A subtle `bg-muted` or `bg-primary/5`, never a heavy highlight.
- **Icons:** Always `h-4 w-4` with `strokeWidth={1.5}`.

## 3. Component Specifications

### Menus & Dropdowns (The Plane Style)

- **Shadows:** Use very soft, large shadows: `shadow-[0_8px_30px_rgb(0,0,0,0.04)]`.
- **Borders:** `border-border/50`.
- **Padding:** `p-1` for the container, `px-2 py-1.5` for items.
- **Corner Radius:** `rounded-md` (8px).

### Buttons

- **Primary:** High contrast (Black in light mode, White in dark mode).
- **Secondary:** Transparent background, subtle border.
- **Ghost:** Used for all toolbar/menu items until hovered.

## 4. Interaction Patterns

1. **The "Silent" Hover:** List items should change background color instantly (`duration-0` or `duration-75`).
2. **Skeleton Strategy:** Skeletons must match the exact line-height and width of the expected text to prevent layout
   shift.
3. **Status Dots:** Small (6px), glowing for "Active", muted for "Draft".

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

## 6. Implementation Checklist

- [ ] Header height is exactly `h-12`.
- [ ] Main UI font size is `text-[13px]`.
- [ ] Borders use `border-border/40`.
- [ ] Icons are `h-4 w-4` and consistent.
- [ ] Hover states on lists use `hover:bg-muted/50`.
- [ ] Breadcrumbs are used for navigation context.
- [ ] Shadows are soft and minimal.
- [ ] Checked at a narrow width too — degrades cleanly, no overflow, touch
      actions reachable (responsive is part of "done", not a later pass).
