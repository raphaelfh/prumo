---
status: shipped
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Shipped · Last reviewed: 2026-05-24 · Owner: @raphaelfh

# Sidebar Revitalization — Design Spec

**Date:** 2026-04-27
**Status:** Draft for review
**Scope:** Visual/structural revitalization of the project sidebar (desktop + mobile), shared design-system primitives for resizable panels, keyboard navigation system, theme toggle, and restructured user menu. Placeholder routes for new sections (Overview, Members, Screening, PRISMA Report) — page content is **out of scope** and tracked as separate specs.

## 1. Goals

1. Replace the current tri-state sidebar (expanded / mini-icon / hidden) with a modern **show/hide binary** behavior plus a **resizable drag handle**.
2. Establish a **project-wide design pattern** for any side panel (sidebar, future article-detail panels, filter panels).
3. Introduce **discoverable keyboard shortcuts** (G-prefixed navigation + system actions like `⌘B`, `⌘,`, `⌘Q`).
4. Restructure the project sidebar with two sections (Project, Review) and 6 nav items, matching the provided mockups.
5. Move Settings out of the nav into a redesigned user menu; add Profile, Invite members, Help & support, Sign out.
6. Add a theme toggle (light → dark → system cycle) in the footer.
7. Maintain full mobile parity via the existing Sheet-based `MobileSidebar`, minus desktop-only affordances (resize, single-key shortcuts).

## 2. Non-goals

- Implementing the actual content of new pages (Overview, Members, Screening, PRISMA Report). They render a `<ComingSoonPanel>` placeholder.
- Adding a `current_phase` field to projects.
- Routing migration from tab-based (`activeTab` state) to subroutes.
- Internationalization beyond the existing `lib/copy/` module.
- Backend changes.

## 3. Design principles

- **Show/hide binary.** Sidebar is fully visible or `display: none`. No mini icon-only state. When hidden, main content fills 100% width; the toggle button stays in the topbar's left.
- **Resizable with limits.** A 4 px drag handle on the sidebar's right edge:
  - **Click** → toggle collapse (same effect as the topbar button and `⌘B`).
  - **Drag horizontal** → resize between **240 px (min)** and **400 px (max)**.
  - Cursor `col-resize` on hover; tooltip `Click to collapse ⌘B · Drag to resize` after 600 ms hover.
  - User-chosen width persists in `localStorage` (`prumo:sidebar:width`).
  - **Snap collapse:** if released at width < 200 px, sidebar auto-collapses (discovery without needing to know the click affordance).
- **Discoverable shortcuts.** `<KbdBadge>` next to each nav item, always visible (passive learning).
- **Keyboard model:**
  - `⌘B` toggle sidebar (industry standard: VSCode, Claude Code, Cursor, Linear).
  - `G` then `O/M/A/T/E/R` → navigate to Overview / Members / Articles / Screening / Extraction / PRISMA Report. Sequence padding 1500 ms.
  - `⌘K` opens project switcher (header dropdown).
  - `⌘,` opens settings; `⌘Q` signs out.
  - Single-letter shortcuts are reserved for future contextual actions (article selection, screening decisions etc.).
- **Persistence.** `localStorage` keys: `prumo:sidebar:collapsed`, `prumo:sidebar:width`, `prumo:theme`. Cross-tab sync via `storage` event.
- **Motion.** `transition-[width,transform] duration-200 ease-out` on resize; `duration-75` on hover. Respects `prefers-reduced-motion`.
- **Density (Linear-style).** Items 28 px (`h-7`), text 13 px, icons 16 px with `strokeWidth=1.5`.

## 4. Design system documentation

A new file `docs/superpowers/design-system/sidebar-and-panels.md` codifies the rules for **any side panel in the project**. Excerpt:

| Aspect | Rule |
|---|---|
| Default width | 280 px |
| Min / max width | 240 / 400 px |
| Drag handle | 4 px on outer edge, `col-resize`, click = toggle, snap-collapse < 200 px |
| Toggle shortcut | `⌘B` (main sidebar); secondary panels define their own |
| Persistence | `localStorage` namespaced as `prumo:<panel-id>:{width,collapsed}` |
| Header height | 48 px (`h-12`), border-bottom `border-border/40` |
| Footer | border-top `border-border/40`, padding `p-2` |
| Nav item | `h-7`, `px-2.5`, `gap-2.5`, `rounded-md` |
| Item typography | `text-[13px]` |
| Icon | 16 px (`h-4 w-4`), `strokeWidth=1.5` |
| Active item | `bg-muted text-foreground font-medium` |
| Inactive item | `text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground` |
| Section title | `text-[11px] uppercase tracking-wider text-muted-foreground/50` |
| Background | `bg-[#fafafa] dark:bg-[#0c0c0c]` |
| Width transition | `duration-200 ease-out` |
| Hover transition | `duration-75` |

This doc is the single source of truth — `ProjectSidebar` and any future panel must reference it.

## 5. Component architecture

```
frontend/
├── components/
│   ├── ui/
│   │   ├── kbd-badge.tsx           [new] <KbdBadge keys={["G","A"]} />
│   │   └── resizable-panel.tsx     [new] <ResizablePanel id="sidebar" ...>
│   ├── layout/
│   │   ├── ProjectSidebar.tsx      [refactor] uses ResizablePanel + new sections
│   │   ├── MobileSidebar.tsx       [refactor] new sections (no badges, no resize)
│   │   ├── sidebarConfig.ts        [refactor] adds shortcut + route id per item
│   │   ├── SidebarSection.tsx      [new] renders title + items
│   │   ├── SidebarNavItem.tsx      [new] icon + label + KbdBadge + active state
│   │   ├── SidebarHeader.tsx       [new] project switcher (extracted)
│   │   ├── SidebarFooter.tsx       [new] ThemeToggle + UserMenu
│   │   ├── ThemeToggle.tsx         [new] cycle light → dark → system
│   │   ├── UserMenu.tsx            [new] redesigned dropdown
│   │   └── ComingSoonPanel.tsx     [new] placeholder for new tabs
│   └── navigation/
│       └── Topbar.tsx              [edit] semantics of toggle button (hide vs mini)
├── contexts/
│   ├── SidebarContext.tsx          [edit] adds width + persistence
│   └── ThemeContext.tsx            [new] wraps next-themes; cycle helper
├── hooks/
│   ├── useKeyboardShortcuts.ts     [new] generic G-sequence + modifier handler
│   └── useNavigationShortcuts.ts   [new] consumes the above for the project shell
├── lib/
│   ├── platform.ts                 [new] isMac() helper
│   └── copy/layout.ts              [edit] new labels + shortcut tooltips
└── pages/
    └── ProjectView.tsx             [edit] cases for overview/members/screening/prisma
```

## 6. Updated `sidebarConfig`

```ts
export interface SidebarNavItem {
  id: 'overview' | 'members' | 'articles' | 'screening' | 'extraction' | 'prisma';
  label: string;
  icon: LucideIcon;
  shortcut: string;       // single letter, used after G prefix
  comingSoon?: boolean;   // shows ComingSoonPanel when active
}

sidebarSections = [
  { title: 'PROJECT', items: [
    { id: 'overview',   label: 'Overview', icon: LayoutDashboard, shortcut: 'O', comingSoon: true },
    { id: 'members',    label: 'Members',  icon: Users,           shortcut: 'M', comingSoon: true },
  ]},
  { title: 'REVIEW', items: [
    { id: 'articles',   label: 'Articles',        icon: FileText,        shortcut: 'A' },
    { id: 'screening',  label: 'Screening',       icon: ListChecks,      shortcut: 'T', comingSoon: true },
    { id: 'extraction', label: 'Extraction',      icon: ClipboardCheck,  shortcut: 'E' },
    { id: 'prisma',     label: 'PRISMA Report',   icon: FileBarChart,    shortcut: 'R', comingSoon: true },
  ]},
];
```

(Labels rendered via `t('layout', '...')` from copy module — English keys, localized values.)

## 7. Data flow

### Sidebar state (`SidebarContext`)

```ts
{
  collapsed: boolean;
  width: number;            // px, clamped to [240, 400]
  toggleCollapsed: () => void;
  setWidth: (w: number) => void;
  mobileOpen: boolean;
  setMobileOpen: (o: boolean) => void;
}
```

- Init from `localStorage` lazily (inside `useState` initializer).
- `useEffect` writes on change.
- `window.addEventListener('storage')` syncs across tabs.
- Invalid / corrupt storage values fall back to defaults silently (try/catch + `Number.isFinite`).

### Theme state (`ThemeContext`)

Wraps `next-themes` (already a dependency, used by `sonner`). Adds a `cycleTheme()` helper: `light → dark → system → light`. Persists to `prumo:theme`.

### Keyboard shortcuts

`useKeyboardShortcuts({ bindings, enabled })` registers a `keydown` listener on `window`.

```ts
type Binding =
  | { type: 'chord';    key: string; modifiers: Modifier[]; handler: () => void }
  | { type: 'sequence'; prefix: string; key: string;        handler: () => void };

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable
    || !!document.querySelector('[role="dialog"][data-state="open"]');
}
```

- `useNavigationShortcuts()` registered inside `ProjectLayout`: G-sequences for nav + `⌘B` for sidebar.
- `⌘,` and `⌘Q` registered globally inside `App.tsx` (work on any page).
- Sequence state machine: after `G` keydown, set `awaitingSecondKey = true` and start a 1500 ms timer; next key resolves or cancels.

### Resize (`ResizablePanel`)

```ts
<ResizablePanel
  id="sidebar"               // namespaces localStorage
  side="right"               // handle position
  defaultWidth={280}
  minWidth={240}
  maxWidth={400}
  snapCollapseAt={200}
  onCollapse={() => sidebar.toggleCollapsed()}
  collapsed={sidebar.collapsed}
>
  {/* sidebar content */}
</ResizablePanel>
```

- `onMouseDown` on handle adds `mousemove` / `mouseup` listeners on `document`.
- `mousemove`: `width = clamp(startWidth + dx * sideMultiplier, min, max)` → state + storage.
- `mouseup`: if `width < snapCollapseAt`, call `onCollapse()` and reset width to `defaultWidth` for next expand.
- Touch parity via `touchstart/move/end`.
- Keyboard parity: when handle is focused, `←/→` adjust ±16 px; `Enter`/`Space` toggles collapse.

## 8. User menu

```
┌──────────────────────────────┐
│ [RF] Raphael Federicci       │  header (avatar 28px + name + email)
│      raphael@prumo.dev       │
├──────────────────────────────┤
│ 👤 Profile                    │  → /settings#profile (placeholder toast)
│ ⚙  Settings              ⌘,  │  → /settings (existing route)
│ 👥 Invite members             │  → toast (placeholder)
├──────────────────────────────┤
│ ❓ Help & support             │  → toast (placeholder)
│ 🚪 Sign out              ⌘Q  │  → signOut + /auth
└──────────────────────────────┘
```

Placeholder items render `toast.info(t('layout', 'comingSoon'))` so they're visible without breaking the flow.

## 9. Mobile (`MobileSidebar`)

Same `sidebarConfig` source of truth, rendered inside the existing `Sheet`:

- Header: project switcher (no `K` badge — irrelevant on touch).
- Sections: identical to desktop, **without** `<KbdBadge>` (no keyboard).
- Footer: `<ThemeToggle>` + `<UserMenu>`.
- No drag handle, no `⌘B`. Hamburger button in Topbar (already wired) opens the Sheet.

## 10. Error handling & accessibility

- **ResizablePanel handle**: `role="separator" aria-orientation="vertical" aria-valuemin aria-valuemax aria-valuenow`; arrow keys when focused; `aria-controls={panelId}`.
- **KbdBadge**: `aria-hidden="true"` (shortcut already announced via `aria-keyshortcuts` on the parent NavItem).
- **NavItem**: `aria-current="page"` when active.
- **Focus management**: collapsing via `⌘B` returns focus to the topbar toggle; expanding moves focus to the first nav item.
- **Storage robustness**: invalid values silently fall back to defaults; never throw.
- **Reduced motion**: when `prefers-reduced-motion: reduce`, transitions become `duration-0`.

## 11. Testing

- `kbd-badge.test.tsx` — render, mac vs windows symbol detection.
- `resizable-panel.test.tsx` — drag clamps to min/max, snap-collapse, persistence, keyboard arrows.
- `useKeyboardShortcuts.test.ts` — G+A sequence, modifier chords, input-focus guard, dialog-open guard, sequence timeout.
- `ProjectSidebar.test.tsx` — section rendering, active state, collapse/expand, footer.
- `ThemeToggle.test.tsx` — cycle light→dark→system, storage persistence.
- `UserMenu.test.tsx` — items, signOut flow, placeholder toasts.
- Update existing `MobileSidebar` tests for new items.

## 12. Migration & rollout

1. Add primitives (`KbdBadge`, `ResizablePanel`, `useKeyboardShortcuts`, `ThemeContext`).
2. Document the design system file.
3. Refactor `SidebarContext` (add width, persist).
4. Build new sub-components (`SidebarHeader`, `SidebarSection`, `SidebarNavItem`, `SidebarFooter`, `ThemeToggle`, `UserMenu`).
5. Refactor `ProjectSidebar` to compose them via `ResizablePanel`.
6. Update `MobileSidebar` for parity.
7. Update `ProjectView` with new tab cases + `ComingSoonPanel`.
8. Update `Topbar` toggle semantics (hide vs mini).
9. Wire shortcuts in `ProjectLayout` and `App.tsx`.
10. Tests + manual QA across Chrome/Safari/Firefox, light/dark, desktop/mobile widths.

## 13. Open questions

None blocking. Future specs will own:
- Overview, Members, Screening, PRISMA Report page implementations.
- Invite members flow (backend + UI).
- Help & support destination (in-app docs vs external).
- `/settings#profile` deep-link section.
