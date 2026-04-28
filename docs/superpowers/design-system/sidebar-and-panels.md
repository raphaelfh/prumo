# Side Panels — Design System

**Last updated:** 2026-04-27

This document is the **single source of truth** for any side panel in Prumo: the main project sidebar, future article-detail panels, filter panels, inspector panels, etc. All such panels MUST follow these rules to keep behavior and look consistent.

## 1. Behavior model

- **Show / hide is binary.** A panel is fully visible OR fully hidden (`display: none`). No mini icon-only state.
- **Resizable with limits.** Every persistent panel exposes a 4 px drag handle on its outer edge.
  - **Click** → toggle collapse.
  - **Drag** → resize within `[minWidth, maxWidth]`.
  - **Snap-collapse**: releasing below a snap threshold auto-collapses the panel.
  - Cursor is `col-resize` on hover.
  - Tooltip after 600 ms hover: `Click to collapse <shortcut> · Drag to resize`.
- **Keyboard:** every persistent panel has a toggle shortcut. The main sidebar uses `⌘B` (industry standard). Secondary panels define their own (e.g. `⌘\` for an inspector).
- **Persistence:** width and collapsed state persist in `localStorage` under `prumo:<panel-id>:{width,collapsed}`. Cross-tab sync via the `storage` event.

## 2. Sizing

| Panel | Default width | Min | Max | Snap-collapse |
|---|---:|---:|---:|---:|
| Main sidebar | 280 px | 240 | 400 | 150 |
| Article detail (future) | 420 px | 320 | 640 | 280 |
| Filters / inspector (future) | 280 px | 240 | 400 | 200 |

Anything new must declare these four values explicitly in its `<ResizablePanel>` props.

## 3. Visual tokens

| Aspect | Token / value |
|---|---|
| Background | `bg-[#fafafa] dark:bg-[#0c0c0c]` |
| Border | `border-border/40` |
| Header height | `h-12` (48 px) with `border-b border-border/40` |
| Footer | `border-t border-border/40`, padding `p-2` |
| Width transition | `transition-[width] duration-200 ease-out` |

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

## 5. Section title rules

- Text: `text-[11px] uppercase tracking-wider text-muted-foreground/50`
- Padding: `px-2.5 pb-1 pt-2`
- Non-selectable: `select-none`

## 6. Keyboard shortcut badges

- Component: `<KbdBadge keys={["G","A"]} />` (renders `G·A`) or `<KbdBadge keys={["⌘","B"]} />` (renders `⌘B`).
- Always visible, never hover-only — passive learning is the goal.
- Detect macOS via `lib/platform.ts#isMac()` and substitute `⌘` ↔ `Ctrl`.
- `aria-hidden="true"` (the parent item carries `aria-keyshortcuts`).

## 7. Shortcut conventions

| Class | Pattern | Example |
|---|---|---|
| Toggle a panel | `⌘<letter>` | `⌘B` (sidebar), `⌘\` (inspector) |
| Navigate to a section | `G` then `<letter>` | `G O` (overview), `G A` (articles) |
| Global action | `⌘<letter>` or `⌘<symbol>` | `⌘K` (search/switcher), `⌘,` (settings), `⌘Q` (sign out) |
| Contextual action | single letter | reserved for future (article selection, screening decisions etc.) |

All shortcut handlers MUST use the shared `useKeyboardShortcuts` hook so input-focus and dialog-open guards behave uniformly.

## 8. Accessibility

- Drag handle: `role="separator" aria-orientation="vertical" aria-controls={panelId} aria-valuemin aria-valuemax aria-valuenow`. Arrow keys adjust ±16 px when focused; Enter/Space toggles collapse.
- Focus management: collapsing via shortcut returns focus to the topbar toggle; expanding moves focus to the first nav item.
- Reduced motion: when `prefers-reduced-motion: reduce`, all transitions become `duration-0`.

## 9. When you build a new panel

1. Wrap it in `<ResizablePanel id="<unique-id>" side="left|right" defaultWidth=... minWidth=... maxWidth=... snapCollapseAt=...>`.
2. Add an entry to the table in §2.
3. Pick a `⌘<letter>` toggle shortcut not already used.
4. Use `<NavItem>` and `<SidebarSection>` for any nav inside it (or document why you can't).
5. Reference this file in your component's top-of-file comment.
