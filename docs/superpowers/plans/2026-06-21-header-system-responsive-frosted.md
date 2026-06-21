---
status: draft
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

# Unified Header System (Responsive + Frosted) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project `Topbar` and the Extraction/QA `RunHeader` one coherent, container-query-driven system that is responsive from ~320px to wide desktop and wears a restrained frosted-glass surface.

**Architecture:** Introduce a shared `HeaderShell` primitive that owns the frosted recipe, declares its *own* `@container/headerbar`, and carries elevation/z tokens. Both headers render through it. One breakpoint model (`compact 34rem / comfortable 48rem / spacious 64rem`) drives all collapsing — labels/dividers/switcher via CSS container queries, and interactive controls that must fold into the kebab via a narrow `useHeaderTier` hook. Shared sub-primitives (`PanelToggleButton`, a `header` Button size, `HeaderChip`, an overlay frosted+clamp class) remove the copy-paste.

**Tech Stack:** React 19 + TypeScript (strict), Vite, Tailwind (with `@tailwindcss/container-queries`, already installed), class-variance-authority, shadcn/Radix, vitest + Testing Library.

## Global Constraints

_Every task implicitly includes these._

- **English only** for all code, comments, and copy.
- **No hardcoded UI strings** — all user-facing text goes through `frontend/lib/copy/` via `t('<ns>', '<key>')`. Add keys to the matching copy file.
- **React Compiler is at `panicThreshold: 'all_errors'`** — no `try/finally` or `throw` inside component/hook bodies. `ResizeObserver`/event cleanup uses a `return () => …` from `useEffect`, never `try/finally`.
- **Tailwind `cn()` merge order matters** — variant/base classes first, caller `className` last.
- **Every interactive element keeps a visible focus ring** (inherit from `Button`/cva, never strip).
- **Frontend tooling runs from the repo ROOT.** Tests: `npm run test:run` (one-shot vitest; never bare `npm test` — it watches and hangs). Targeted: `npm run test:run -- <path>`. Lint: `npm run lint`.
- **Container queries already work** — `containerQueries` plugin is registered in `tailwind.config.ts:124`. Tier thresholds: `compact < 34rem (544px)`, `comfortable 34–48rem`, `spacious ≥ 48rem` reveals desktop helpers at `64rem`.
- **Collapse via CSS visibility (`hidden`/`sr-only`), never conditional unmount**, except the kebab-fold controls in Task 7 (those are tier-gated by design; their tests assert behavior, not static presence).
- Breakpoint numbers are **starting values** — Task 10 measures real fit points and tunes them.

---

## File structure

**New files**
- `frontend/components/layout/HeaderShell.tsx` — shared bar shell (cva + component, declares `@container/headerbar`, frosted surface, `position` + `lifted` variants, padding ramp, slot scaffold).
- `frontend/components/layout/useHeaderTier.ts` — `ResizeObserver`-based tier hook for the kebab-fold decision + a `useScrolled` helper for shadow-on-lift.
- `frontend/components/layout/PanelToggleButton.tsx` — unified left/right crossfade toggle.
- `frontend/components/layout/HeaderChip.tsx` — `headerChip` cva for header chips/pills.
- Test files alongside each (see tasks).

**Modified files**
- `frontend/index.css` — frosted/header tokens + `.frosted-header`/`.frosted-overlay` utilities + fallbacks; delete orphan `.linear-header` (206–208).
- `tailwind.config.ts` — `boxShadow.elev-header`, `zIndex.header`, header `fontSize` scale.
- `frontend/components/ui/button.tsx` — add `size: "header"` + `"header-icon"`.
- `frontend/components/ui/dropdown-menu.tsx`, `frontend/components/ui/popover.tsx` — frosted surface + viewport width clamp on content.
- `frontend/components/runs/header/RunHeader.tsx` — render through `HeaderShell`; unify slots; wire kebab as sink + focus-mode hamburger.
- `frontend/components/runs/header/SidebarToggle.tsx`, `PanelToggle.tsx` — thin wrappers over `PanelToggleButton`.
- `frontend/components/runs/header/Menu.tsx` — accept tier-gated overflow items.
- `frontend/components/navigation/Topbar.tsx` — render through `HeaderShell`; relax grid; `TruncatedText` title; use `PanelToggleButton`; shadow-on-lift.
- `frontend/components/navigation/SectionViewSwitcher.tsx` — segmented + dropdown dual-render.
- `frontend/components/navigation/NotificationCenter.tsx`, `frontend/components/runs/header/Worklist.tsx`, `Help.tsx`, `CommandPalette.tsx` — adopt the overlay frosted+clamp class.
- Copy files: `frontend/lib/copy/navigation.ts`, `frontend/lib/copy/runs.ts`.

---

## Task 1: Frosted/header design tokens + retire `.linear-header`

**Files:**
- Modify: `frontend/index.css` (add tokens near `--shadow-popover` at 84–85 and 155–156; add utilities near `.linear-header` 206–208; delete `.linear-header`)
- Modify: `tailwind.config.ts` (boxShadow 87–94; add zIndex + fontSize in `extend`)

**Interfaces:**
- Produces: CSS vars `--header-blur`, `--header-surface-alpha`, `--shadow-header`, `--z-header`; utility classes `.frosted-header`, `.frosted-overlay`; Tailwind tokens `shadow-elev-header`, `z-header`, `text-header-title|meta|micro`.

- [ ] **Step 1: Add light-mode tokens.** In `frontend/index.css`, after line 85 (`--shadow-popover: 0 8px 30px rgb(0 0 0 / 0.04);`) add:

```css
    /* Header system — frosted surface + elevation. One knob per concern;
       both real headers (Topbar, RunHeader) and floating overlays read these. */
    --header-blur: 12px;
    --header-surface-alpha: 0.82;
    --shadow-header: 0 4px 16px rgb(0 0 0 / 0.06);
    --z-header: 40;
```

- [ ] **Step 2: Add dark-mode overrides.** After line 156 (`--shadow-popover: 0 8px 30px rgb(0 0 0 / 0.35);`) add:

```css
    --header-surface-alpha: 0.80;
    --shadow-header: 0 4px 16px rgb(0 0 0 / 0.45);
```

- [ ] **Step 3: Replace the orphan `.linear-header` with shared utilities.** Replace lines 206–208 (the `.linear-header { @apply … }` block) with:

```css
    /* Frosted header surface — consumed by HeaderShell. Border + translucent
       background + blur; shadow is opt-in via shadow-elev-header (shadow-on-lift). */
    .frosted-header {
        background-color: hsl(var(--background) / var(--header-surface-alpha));
        backdrop-filter: blur(var(--header-blur));
        -webkit-backdrop-filter: blur(var(--header-blur));
    }
    /* Frosted floating overlay — same surface for menus/popovers, plus the
       header elevation shadow (overlays always lift). */
    .frosted-overlay {
        background-color: hsl(var(--popover) / var(--header-surface-alpha));
        backdrop-filter: blur(var(--header-blur));
        -webkit-backdrop-filter: blur(var(--header-blur));
    }
    /* Legibility fallbacks: no backdrop-filter support, or user opts out of
       transparency. Solid surface in both cases. */
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        .frosted-header { background-color: hsl(var(--background)); }
        .frosted-overlay { background-color: hsl(var(--popover)); }
    }
    @media (prefers-reduced-transparency: reduce) {
        .frosted-header,
        .frosted-overlay {
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            background-color: hsl(var(--background));
        }
        .frosted-overlay { background-color: hsl(var(--popover)); }
    }
```

- [ ] **Step 4: Map Tailwind tokens.** In `tailwind.config.ts`, change the `boxShadow` block (87–94) to add `elev-header`, and add `zIndex` + `fontSize` to `extend`:

```ts
      boxShadow: {
        "elev-card": "var(--shadow-card)",
        "elev-popover": "var(--shadow-popover)",
        "elev-header": "var(--shadow-header)",
      },
      zIndex: {
        header: "var(--z-header)",
      },
      fontSize: {
        "header-title": ["13px", { lineHeight: "1.2" }],
        "header-meta": ["12px", { lineHeight: "1.2" }],
        "header-micro": ["11px", { lineHeight: "1.2" }],
      },
```

- [ ] **Step 5: Verify no `.linear-header` consumers remain.**

Run: `cd /Users/raphael/PycharmProjects/prumo/.claude/worktrees/awesome-mirzakhani-99a2ab && grep -rn "linear-header" frontend/ tailwind.config.ts`
Expected: no matches (confirms the orphan is safely deletable).

- [ ] **Step 6: Build sanity.**

Run: `npm run lint`
Expected: PASS (CSS/config compile; no unused-class errors).

- [ ] **Step 7: Commit.**

```bash
git add frontend/index.css tailwind.config.ts
git commit -m "feat(header): add frosted/header design tokens, retire orphan .linear-header"
```

---

## Task 2: `HeaderShell` primitive

**Files:**
- Create: `frontend/components/layout/HeaderShell.tsx`
- Test: `frontend/components/layout/HeaderShell.test.tsx`

**Interfaces:**
- Consumes: tokens from Task 1 (`frosted-header`, `z-header`, `shadow-elev-header`).
- Produces: `HeaderShell` component — props `{ position?: 'sticky' | 'relative'; lifted?: boolean; className?; children }`. Renders `<header>` with `@container/headerbar` + frosted surface, and an inner row `<div>` (`h-12`, padding ramp). Children are the slot elements.

- [ ] **Step 1: Write the failing test.** `frontend/components/layout/HeaderShell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeaderShell } from './HeaderShell';

describe('HeaderShell', () => {
  it('declares its own header container and frosted surface', () => {
    render(<HeaderShell><span>child</span></HeaderShell>);
    const header = screen.getByText('child').closest('header');
    expect(header).not.toBeNull();
    expect(header!.className).toContain('@container/headerbar');
    expect(header!.className).toContain('frosted-header');
    expect(header!.className).toContain('z-header');
  });

  it('is sticky by default and relative when asked', () => {
    const { rerender } = render(<HeaderShell><span>a</span></HeaderShell>);
    expect(screen.getByText('a').closest('header')!.className).toContain('sticky');
    rerender(<HeaderShell position="relative"><span>a</span></HeaderShell>);
    expect(screen.getByText('a').closest('header')!.className).toContain('relative');
  });

  it('adds the elevation shadow only when lifted', () => {
    const { rerender } = render(<HeaderShell><span>a</span></HeaderShell>);
    expect(screen.getByText('a').closest('header')!.className).not.toContain('shadow-elev-header');
    rerender(<HeaderShell lifted><span>a</span></HeaderShell>);
    expect(screen.getByText('a').closest('header')!.className).toContain('shadow-elev-header');
  });
});
```

- [ ] **Step 2: Run it, expect failure.**

Run: `npm run test:run -- frontend/components/layout/HeaderShell.test.tsx`
Expected: FAIL ("Cannot find module './HeaderShell'").

- [ ] **Step 3: Implement.** `frontend/components/layout/HeaderShell.tsx`:

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const headerShellVariants = cva(
  // Declares its OWN container so every responsive child keys off the header's
  // width (works identically whether or not the app sidebar is open).
  '@container/headerbar w-full border-b border-border/40 frosted-header transition-shadow duration-150 motion-reduce:transition-none',
  {
    variants: {
      position: {
        sticky: 'sticky top-0 z-header',
        relative: 'relative z-header',
      },
      lifted: {
        true: 'shadow-elev-header',
        false: '',
      },
    },
    defaultVariants: { position: 'sticky', lifted: false },
  },
);

export interface HeaderShellProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof headerShellVariants> {}

export const HeaderShell = React.forwardRef<HTMLElement, HeaderShellProps>(
  ({ className, position, lifted, children, ...props }, ref) => (
    <header ref={ref} className={cn(headerShellVariants({ position, lifted }), className)} {...props}>
      <div className="flex h-12 items-center gap-2 px-3 @[48rem]/headerbar:gap-4 @[48rem]/headerbar:px-6">
        {children}
      </div>
    </header>
  ),
);
HeaderShell.displayName = 'HeaderShell';
```

- [ ] **Step 4: Run it, expect pass.**

Run: `npm run test:run -- frontend/components/layout/HeaderShell.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add frontend/components/layout/HeaderShell.tsx frontend/components/layout/HeaderShell.test.tsx
git commit -m "feat(header): add HeaderShell primitive (self-declared container + frosted surface)"
```

---

## Task 3: `useHeaderTier` + `useScrolled` hooks

**Files:**
- Create: `frontend/components/layout/useHeaderTier.ts`
- Test: `frontend/components/layout/useHeaderTier.test.ts`

**Interfaces:**
- Produces:
  - `type HeaderTier = 'compact' | 'comfortable' | 'spacious'`
  - `const HEADER_TIER_PX = { compact: 544, comfortable: 768 } as const`
  - `useHeaderTier(ref: React.RefObject<HTMLElement | null>): HeaderTier` — observes the element width.
  - `useScrolled(threshold?: number): boolean` — `true` once `window.scrollY > threshold` (default 0).

- [ ] **Step 1: Write the failing test.** `frontend/components/layout/useHeaderTier.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useHeaderTier } from './useHeaderTier';

let cb: (entries: { contentRect: { width: number } }[]) => void;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(c: typeof cb) { cb = c; }
      observe() {}
      disconnect() {}
    },
  );
});

describe('useHeaderTier', () => {
  it('maps observed width to a tier', () => {
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useHeaderTier(ref));
    act(() => cb([{ contentRect: { width: 400 } }]));
    expect(result.current).toBe('compact');
    act(() => cb([{ contentRect: { width: 700 } }]));
    expect(result.current).toBe('comfortable');
    act(() => cb([{ contentRect: { width: 1200 } }]));
    expect(result.current).toBe('spacious');
  });
});
```

- [ ] **Step 2: Run it, expect failure.**

Run: `npm run test:run -- frontend/components/layout/useHeaderTier.test.ts`
Expected: FAIL ("Cannot find module './useHeaderTier'").

- [ ] **Step 3: Implement.** `frontend/components/layout/useHeaderTier.ts`:

```ts
import * as React from 'react';

export type HeaderTier = 'compact' | 'comfortable' | 'spacious';

// Single source of the tier thresholds. Mirrors the CSS container-query
// cutoffs used for label/divider collapse (@[34rem] / @[48rem]) so the
// JS-gated kebab fold and the CSS-gated labels switch at the same widths.
export const HEADER_TIER_PX = { compact: 544, comfortable: 768 } as const;

function tierForWidth(w: number): HeaderTier {
  if (w < HEADER_TIER_PX.compact) return 'compact';
  if (w < HEADER_TIER_PX.comfortable) return 'comfortable';
  return 'spacious';
}

export function useHeaderTier(ref: React.RefObject<HTMLElement | null>): HeaderTier {
  const [tier, setTier] = React.useState<HeaderTier>('spacious');
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setTier((prev) => {
        const next = tierForWidth(width);
        return prev === next ? prev : next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return tier;
}

export function useScrolled(threshold = 0): boolean {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}
```

- [ ] **Step 4: Run it, expect pass.**

Run: `npm run test:run -- frontend/components/layout/useHeaderTier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add frontend/components/layout/useHeaderTier.ts frontend/components/layout/useHeaderTier.test.ts
git commit -m "feat(header): add useHeaderTier + useScrolled hooks"
```

---

## Task 4: `PanelToggleButton` + refactor the two run-header toggles onto it

**Files:**
- Create: `frontend/components/layout/PanelToggleButton.tsx`
- Test: `frontend/components/layout/PanelToggleButton.test.tsx`
- Modify: `frontend/components/runs/header/SidebarToggle.tsx`, `frontend/components/runs/header/PanelToggle.tsx`

**Interfaces:**
- Consumes: `Button` (existing), `t('runs', …)`.
- Produces: `PanelToggleButton({ side, pressed, onToggle, ariaLabel })` where `side: 'left' | 'right'`. `left` → `PanelLeftClose/Open` + `aria-keyshortcuts="Meta+B"`; `right` → `PanelRightClose/Open` + `aria-keyshortcuts="\\"`. `pressed` = open.

- [ ] **Step 1: Write the failing test.** `frontend/components/layout/PanelToggleButton.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelToggleButton } from './PanelToggleButton';

describe('PanelToggleButton', () => {
  it('wires the left variant shortcut + pressed state and fires onToggle', () => {
    const onToggle = vi.fn();
    render(<PanelToggleButton side="left" pressed onToggle={onToggle} ariaLabel="Toggle nav" />);
    const btn = screen.getByRole('button', { name: 'Toggle nav' });
    expect(btn).toHaveAttribute('aria-keyshortcuts', 'Meta+B');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('uses the backslash shortcut for the right variant', () => {
    render(<PanelToggleButton side="right" pressed={false} onToggle={() => {}} ariaLabel="Toggle panel" />);
    expect(screen.getByRole('button', { name: 'Toggle panel' })).toHaveAttribute('aria-keyshortcuts', '\\');
  });
});
```

- [ ] **Step 2: Run it, expect failure.**

Run: `npm run test:run -- frontend/components/layout/PanelToggleButton.test.tsx`
Expected: FAIL ("Cannot find module './PanelToggleButton'").

- [ ] **Step 3: Implement.** `frontend/components/layout/PanelToggleButton.tsx`:

```tsx
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PanelToggleButtonProps {
  side: 'left' | 'right';
  pressed: boolean;
  onToggle: () => void;
  ariaLabel: string;
}

// One component for the three previously-duplicated header toggles (Topbar
// sidebar toggle, RunHeader SidebarToggle, RunHeader PanelToggle). `pressed`
// = panel/sidebar OPEN; the "Close" glyph shows when open.
export function PanelToggleButton({ side, pressed, onToggle, ariaLabel }: PanelToggleButtonProps) {
  const Close = side === 'left' ? PanelLeftClose : PanelRightClose;
  const Open = side === 'left' ? PanelLeftOpen : PanelRightOpen;
  return (
    <Button
      size="header-icon"
      variant="ghost"
      onClick={onToggle}
      aria-pressed={pressed}
      aria-keyshortcuts={side === 'left' ? 'Meta+B' : '\\'}
      aria-label={ariaLabel}
      className="relative shrink-0 p-0 text-muted-foreground transition-colors duration-75 hover:bg-muted/50"
    >
      <span className="relative block h-4 w-4">
        <Close
          className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-100' : 'opacity-0')}
          aria-hidden="true"
        />
        <Open
          className={cn('absolute inset-0 h-4 w-4 transition-opacity duration-150 ease-out motion-reduce:duration-0', pressed ? 'opacity-0' : 'opacity-100')}
          aria-hidden="true"
        />
      </span>
    </Button>
  );
}
```

> Note: `size="header-icon"` is added in Task 5. If executing strictly in order, temporarily use `size="icon" className="h-8 w-8 …"` and switch to `header-icon` at the end of Task 5. (Recommended: do Task 5 first, then return — they are adjacent.)

- [ ] **Step 4: Run it, expect pass.**

Run: `npm run test:run -- frontend/components/layout/PanelToggleButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Refactor `SidebarToggle.tsx` to delegate.** Replace the whole body of `frontend/components/runs/header/SidebarToggle.tsx` with:

```tsx
import { PanelToggleButton } from '@/components/layout/PanelToggleButton';
import { t } from '@/lib/copy';

/** Left app-navigation toggle. Prop-driven; renders nothing when unwired. */
export function SidebarToggle({ pressed, onToggle }: { pressed?: boolean; onToggle?: () => void }) {
  if (!onToggle) return null;
  return <PanelToggleButton side="left" pressed={!!pressed} onToggle={onToggle} ariaLabel={t('runs', 'sidebarToggle')} />;
}
```

- [ ] **Step 6: Refactor `PanelToggle.tsx` to delegate.** Replace the whole body of `frontend/components/runs/header/PanelToggle.tsx` with:

```tsx
import { PanelToggleButton } from '@/components/layout/PanelToggleButton';
import { t } from '@/lib/copy';

/** Right-hand source-panel (PDF) toggle. `pressed` = panel OPEN. */
export function PanelToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return <PanelToggleButton side="right" pressed={pressed} onToggle={onToggle} ariaLabel={t('runs', 'togglePanel')} />;
}
```

- [ ] **Step 7: Run the run-header tests to confirm no regression.**

Run: `npm run test:run -- frontend/components/runs/header`
Expected: PASS (existing header tests still green).

- [ ] **Step 8: Commit.**

```bash
git add frontend/components/layout/PanelToggleButton.tsx frontend/components/layout/PanelToggleButton.test.tsx frontend/components/runs/header/SidebarToggle.tsx frontend/components/runs/header/PanelToggle.tsx
git commit -m "feat(header): unify the 3 panel toggles into PanelToggleButton"
```

---

## Task 5: `Button` `header` sizes + `HeaderChip` primitive

**Files:**
- Modify: `frontend/components/ui/button.tsx:19-24` (size variants)
- Create: `frontend/components/layout/HeaderChip.tsx`
- Test: `frontend/components/layout/HeaderChip.test.tsx`

**Interfaces:**
- Produces:
  - `Button` sizes `header` (`h-8 px-2`, grows to `h-11` on coarse pointers) and `header-icon` (`h-8 w-8`, grows to `h-11 w-11`).
  - `headerChip` cva from `HeaderChip.tsx` — base chip class at the 13px/12px header type floor with focus ring and coarse-pointer min height.

- [ ] **Step 1: Add the Button sizes.** In `frontend/components/ui/button.tsx`, change the `size` block (19–24) to:

```ts
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        header: "h-8 rounded-md px-2 text-header-meta [@media(pointer:coarse)]:h-11",
        "header-icon": "h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
      },
```

- [ ] **Step 2: Write the failing HeaderChip test.** `frontend/components/layout/HeaderChip.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { headerChip } from './HeaderChip';

describe('headerChip', () => {
  it('emits a focusable, header-scale chip class with a coarse-pointer touch floor', () => {
    const cls = headerChip();
    expect(cls).toContain('text-header-meta');
    expect(cls).toContain('focus-visible:ring');
    expect(cls).toContain('[@media(pointer:coarse)]:h-11');
  });

  it('supports an interactive variant with hover affordance', () => {
    expect(headerChip({ interactive: true })).toContain('hover:bg-muted/60');
  });
});
```

- [ ] **Step 3: Run it, expect failure.**

Run: `npm run test:run -- frontend/components/layout/HeaderChip.test.tsx`
Expected: FAIL ("Cannot find module './HeaderChip'").

- [ ] **Step 4: Implement.** `frontend/components/layout/HeaderChip.tsx`:

```tsx
import { cva, type VariantProps } from 'class-variance-authority';

// Shared chip/pill for header metadata (AI count, reviewers divergence, role,
// kind badge). Replaces the hand-rolled per-call-site pills so radius / focus
// ring / type floor / touch target are defined once.
export const headerChip = cva(
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border/50 px-2 text-header-meta text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11',
  {
    variants: {
      interactive: {
        true: 'cursor-pointer transition-colors hover:bg-muted/60 hover:text-foreground',
        false: '',
      },
    },
    defaultVariants: { interactive: false },
  },
);

export type HeaderChipVariants = VariantProps<typeof headerChip>;
```

- [ ] **Step 5: Run it, expect pass.**

Run: `npm run test:run -- frontend/components/layout/HeaderChip.test.tsx`
Expected: PASS.

- [ ] **Step 6: If Task 4 used the temporary `size="icon"`, switch `PanelToggleButton` to `size="header-icon"` now and drop the `h-8 w-8` from its className. Re-run** `npm run test:run -- frontend/components/layout/PanelToggleButton.test.tsx` (PASS).

- [ ] **Step 7: Commit.**

```bash
git add frontend/components/ui/button.tsx frontend/components/layout/HeaderChip.tsx frontend/components/layout/HeaderChip.test.tsx frontend/components/layout/PanelToggleButton.tsx
git commit -m "feat(header): add Button header sizes + HeaderChip primitive"
```

---

## Task 6: Frosted + viewport-clamped floating overlays

**Files:**
- Modify: `frontend/components/ui/dropdown-menu.tsx:64` (`DropdownMenuContent` class)
- Modify: `frontend/components/ui/popover.tsx:20` (`PopoverContent` class)
- Test: `frontend/components/ui/overlay-frosted.test.tsx`

**Interfaces:**
- Produces: dropdown/popover content surfaces that use `.frosted-overlay` + `shadow-elev-header` and never exceed the viewport (`max-w-[calc(100vw-1rem)]`). Existing `bg-popover`/`shadow-elev-popover` are replaced by the frosted equivalents on these shared primitives, so every consumer inherits the fix.

- [ ] **Step 1: Write the failing test.** `frontend/components/ui/overlay-frosted.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

describe('frosted overlays', () => {
  it('renders dropdown content with a frosted surface and viewport clamp', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const content = screen.getByText('item').closest('[role="menu"]')!;
    expect(content.className).toContain('frosted-overlay');
    expect(content.className).toContain('shadow-elev-header');
    expect(content.className).toContain('max-w-[calc(100vw-1rem)]');
  });
});
```

- [ ] **Step 2: Run it, expect failure.**

Run: `npm run test:run -- frontend/components/ui/overlay-frosted.test.tsx`
Expected: FAIL (`frosted-overlay` not present).

- [ ] **Step 3: Update `DropdownMenuContent`.** In `frontend/components/ui/dropdown-menu.tsx:64`, replace `bg-popover` with `frosted-overlay` and `shadow-elev-popover` with `shadow-elev-header`, and add the clamp. The class string becomes:

```
"z-50 min-w-[8rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-border/50 frosted-overlay p-1 text-popover-foreground shadow-elev-header data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
```

Also add `collisionPadding={8}` to the `DropdownMenuPrimitive.Content` props (alongside `sideOffset`) so it never pins flush to a phone edge.

- [ ] **Step 4: Update `PopoverContent`.** In `frontend/components/ui/popover.tsx:20`, replace `bg-popover` with `frosted-overlay`, `shadow-md` with `shadow-elev-header`, and add the clamp to the `w-72`:

```
"z-50 w-72 max-w-[calc(100vw-1rem)] rounded-md border frosted-overlay p-4 text-popover-foreground shadow-elev-header outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
```

Add `collisionPadding={8}` to `PopoverPrimitive.Content` props.

- [ ] **Step 5: Run it, expect pass + no overlay regressions.**

Run: `npm run test:run -- frontend/components/ui/overlay-frosted.test.tsx && npm run test:run -- frontend/components/runs/header`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add frontend/components/ui/dropdown-menu.tsx frontend/components/ui/popover.tsx frontend/components/ui/overlay-frosted.test.tsx
git commit -m "feat(header): frosted + viewport-clamped dropdown/popover surfaces"
```

---

## Task 7: Migrate `RunHeader` onto `HeaderShell` + kebab sink + focus-mode hamburger

**Files:**
- Modify: `frontend/components/runs/header/RunHeader.tsx`
- Modify: `frontend/components/runs/header/Menu.tsx`
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx:540-641` (remove the consumer `@container/headerbar` wrapper; add focus-mode nav + tier-driven kebab items)
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (the `ExtractionHeader` consumer — remove its `@container/headerbar` wrapper at ~264, mirror the composition)
- Test: extend `frontend/components/runs/header/__tests__/` (RunHeader composition)

**Interfaces:**
- Consumes: `HeaderShell` (Task 2), `useHeaderTier` (Task 3), `Menu`/`MenuItem`.
- Produces: `RunHeaderRoot` renders through `HeaderShell` (so `@container/headerbar` lives in the shell, not the page). `Menu` accepts arbitrary children (already does) so the page folds `Help`/save-state/compare/reopen into it at `compact`.

- [ ] **Step 1: Render `RunHeaderRoot` through `HeaderShell`.** In `frontend/components/runs/header/RunHeader.tsx`, replace the `RunHeaderRoot` function (37–47) with:

```tsx
import { HeaderShell } from '@/components/layout/HeaderShell';
// …existing imports…

function RunHeaderRoot({ value, children }: { value: RunHeaderValue; children: ReactNode }) {
  return (
    <RunHeaderProvider value={value}>
      <TooltipProvider delayDuration={200}>
        {/* relative (not sticky): run pages don't scroll the header out — the
            body is a fixed-height panel split. Shadow stays off (border-only). */}
        <HeaderShell position="relative">{children}</HeaderShell>
      </TooltipProvider>
    </RunHeaderProvider>
  );
}
```

Delete the old inline `<header className="relative z-10 border-b …">` + inner `<div className="flex h-12 …">`. The `Left/Center/Right` slot functions stay as-is (their `@[48rem]/headerbar:` queries now resolve against the shell's container).

- [ ] **Step 2: Remove the consumer container wrapper (QA).** In `frontend/pages/QualityAssessmentFullScreen.tsx`, the `header` JSX (≈540) wraps `<RunHeader>` in `<div className="@container/headerbar">`. Remove that wrapper div (keep `<RunHeader …>` as the top node) — the shell now owns the container:

```tsx
  const header = (
    <RunHeader
      value={{ /* …unchanged… */ }}
    >
      {/* …unchanged slots… */}
    </RunHeader>
  );
```

- [ ] **Step 3: Remove the consumer container wrapper (Extraction).** In `frontend/pages/ExtractionFullScreen.tsx` (the `ExtractionHeader` definition, container wrapper ≈264), do the same — drop the `@container/headerbar` wrapper around `<RunHeader>`.

- [ ] **Step 4: Add the focus-mode hamburger to QA at `compact`.** In `QualityAssessmentFullScreen.tsx`, the page already has `toggleSidebar`/`sidebarCollapsed` from `useSidebar()`. Inside `RunHeader.Left`, before `SidebarToggle`, add a hamburger visible only at `compact` that opens the project nav drawer. (The desktop `SidebarToggle` stays, hidden at compact.) Use container-query visibility:

```tsx
<RunHeader.Left>
  {/* Phone focus-mode nav — opens the project sidebar drawer. */}
  <span className="@[34rem]/headerbar:hidden">
    <Button
      size="header-icon"
      variant="ghost"
      onClick={toggleSidebar}
      aria-label={t('runs', 'openProjectNav')}
      className="shrink-0 p-0 text-muted-foreground hover:bg-muted/50"
    >
      <Menu className="h-4 w-4" aria-hidden="true" />
    </Button>
  </span>
  <span className="hidden @[34rem]/headerbar:inline-flex">
    <RunHeader.SidebarToggle pressed={!sidebarCollapsed} onToggle={toggleSidebar} />
  </span>
  {/* …rest of Left unchanged… */}
</RunHeader.Left>
```

Add the copy key (Step 6). Import `Menu as MenuIcon` from `lucide-react` to avoid colliding with `RunHeader.Menu` (rename the import accordingly).

- [ ] **Step 5: Fold non-essential controls into the kebab at `compact`.** In `QualityAssessmentFullScreen.tsx`, add a tier read at the top of the component:

```tsx
import { useRef } from 'react';
import { useHeaderTier } from '@/components/layout/useHeaderTier';
// …
const headerRef = useRef<HTMLElement>(null);
const tier = useHeaderTier(headerRef);
const compact = tier === 'compact';
```

Pass the ref to the shell via `RunHeader` (add an optional `rootRef` prop threaded to `HeaderShell ref`), and in `RunHeader.Right`, gate `Help` inline vs in-menu and add the folded items:

```tsx
<RunHeader.Right>
  <RunHeader.AIActions … />
  <RunHeader.PrimaryAction />
  <span className="mx-1 hidden h-5 w-px bg-border/60 @[48rem]/headerbar:block" aria-hidden="true" />
  {!compact && (
    <span className="hidden @[48rem]/headerbar:inline-flex"><RunHeader.Help /></span>
  )}
  <RunHeader.Menu>
    {compact && <RunHeader.MenuItem onSelect={() => helpOpen()}>{t('runs', 'help')}</RunHeader.MenuItem>}
    {canCompare && (
      <RunHeader.MenuItem onSelect={() => setViewMode((m) => (m === 'assess' ? 'compare' : 'assess'))}>
        {effectiveViewMode === 'assess' ? t('qa', 'compareToggle') : t('qa', 'assessToggle')}
      </RunHeader.MenuItem>
    )}
    {finalized && (
      <RunHeader.MenuItem onSelect={() => void handleReopen()}>
        {reopening ? t('qa', 'reopenProgress') : t('qa', 'reopenButton')}
      </RunHeader.MenuItem>
    )}
  </RunHeader.Menu>
  <RunHeader.PanelToggle pressed={pdfPanelState.isOpen} onToggle={pdfPanelState.toggle} />
</RunHeader.Right>
```

> The `Menu` (Task: `Menu.tsx`) already null-renders when it has zero children, so above `compact` with no compare/reopen it stays invisible — unchanged behavior. The QA always-on `Badge`+version (Left slot) gets `@[34rem]/headerbar:inline-flex hidden` so they fold at compact too (D7); confirm the existing `qa-kind-badge`/`qa-template-name` tests assert presence, not visibility, before hiding — if they assert visibility, switch them to query the DOM node, not a visible-rect.

- [ ] **Step 6: Add copy keys.** In `frontend/lib/copy/runs.ts`, add `openProjectNav: 'Open project navigation'` and (if not present) `help: 'Help'`.

- [ ] **Step 7: Write/extend a composition test.** Add `frontend/components/runs/header/__tests__/RunHeader.shell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunHeader } from '../RunHeader';

const base = { kind: 'qa', stage: 'proposal', isRevision: false, role: 'reviewer', isBlind: false, canReveal: false, onReveal: () => {}, progress: { completed: 0, total: 0, pct: 0 }, reviewers: { count: 0, required: 0, divergent: 0 }, transition: { label: '', onClick: () => {}, disabled: true }, submitting: false } as const;

describe('RunHeader through HeaderShell', () => {
  it('renders the header inside a self-declared container', () => {
    render(<RunHeader value={base as never}><RunHeader.Left><span>L</span></RunHeader.Left></RunHeader>);
    const header = screen.getByText('L').closest('header')!;
    expect(header.className).toContain('@container/headerbar');
    expect(header.className).toContain('frosted-header');
  });
});
```

(Reuse the shared `base`/copy mock from Task 10's util once it exists; inline here is fine until then.)

- [ ] **Step 8: Run header + page tests.**

Run: `npm run test:run -- frontend/components/runs/header && npm run test:run -- frontend/test/QualityAssessmentFullScreen.test.tsx frontend/test/QualityAssessmentInterface.test.tsx`
Expected: PASS (update any test that asserted the old inline `relative z-10` wrapper or badge visibility).

- [ ] **Step 9: Commit.**

```bash
git add frontend/components/runs/header/RunHeader.tsx frontend/components/runs/header/Menu.tsx frontend/pages/QualityAssessmentFullScreen.tsx frontend/pages/ExtractionFullScreen.tsx frontend/lib/copy/runs.ts frontend/components/runs/header/__tests__/RunHeader.shell.test.tsx
git commit -m "feat(header): RunHeader on HeaderShell — kebab sink + focus-mode nav, container owned by shell"
```

---

## Task 8: Migrate `Topbar` onto `HeaderShell` + relax grid + collapse the switcher

**Files:**
- Modify: `frontend/components/navigation/Topbar.tsx`
- Modify: `frontend/components/navigation/SectionViewSwitcher.tsx`
- Test: `frontend/components/navigation/SectionViewSwitcher.test.tsx` (extend), `frontend/test/Topbar.test.tsx` (create if absent)
- Modify: `frontend/lib/copy/navigation.ts` (switcher dropdown label)

**Interfaces:**
- Consumes: `HeaderShell`, `PanelToggleButton`, `useScrolled`, `TruncatedText` (`frontend/components/runs/header/TruncatedText.tsx`).
- Produces: `SectionViewSwitcher` renders BOTH a segmented `role="tablist"` (visible `@[34rem]/headerbar:flex`, hidden below) and a `DropdownMenu` trigger showing the active view (visible below `@[34rem]`, hidden above). Only one is in the a11y tree at a time (`display:none`).

- [ ] **Step 1: Extend the switcher test (failing).** In `frontend/components/navigation/SectionViewSwitcher.test.tsx` add:

```tsx
it('renders both a tablist and a collapsed dropdown trigger', () => {
  // …existing render setup with quality section + views…
  // segmented control:
  expect(screen.getByRole('tablist')).toBeInTheDocument();
  // collapsed trigger shows the active view label:
  expect(screen.getByRole('button', { name: /assessment/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, expect failure.**

Run: `npm run test:run -- frontend/components/navigation/SectionViewSwitcher.test.tsx`
Expected: FAIL (no dropdown trigger yet).

- [ ] **Step 3: Implement the dual-render switcher.** In `frontend/components/navigation/SectionViewSwitcher.tsx`, keep the data logic (lines 9–28) and replace the returned JSX (30–55) with a segmented group + a dropdown, gated by the shared container query. Add imports for `DropdownMenu*` and `ChevronDown`:

```tsx
  const activeLabel = views.find((v) => v.value === active)?.label ?? views[0].label;

  return (
    <>
      {/* Segmented control — comfortable and up */}
      <div
        role="tablist"
        aria-label={activeSection === 'quality' ? t('navigation', 'viewsQualityAria') : t('navigation', 'viewsExtractionAria')}
        className="hidden items-center gap-0.5 rounded-md bg-muted/40 p-0.5 @[34rem]/headerbar:flex"
      >
        {views.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active === value}
            data-testid={activeSection === 'quality' ? `hitl-quality_assessment-tab-${value}` : undefined}
            onClick={() => select(value)}
            className={cn(
              'h-7 rounded px-3 text-header-meta font-medium transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11',
              active === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Collapsed dropdown — compact only */}
      <div className="@[34rem]/headerbar:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="header" variant="outline" className="gap-1.5">
              {activeLabel}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {views.map(({ value, label }) => (
              <DropdownMenuItem key={value} onSelect={() => select(value)} aria-current={active === value}>
                {label}
                {active === value && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
```

Add imports at top: `import { Button } from '@/components/ui/button';`, `import { Check, ChevronDown } from 'lucide-react';`, and the `DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger` from `@/components/ui/dropdown-menu`.

- [ ] **Step 4: Run it, expect pass.**

Run: `npm run test:run -- frontend/components/navigation/SectionViewSwitcher.test.tsx`
Expected: PASS.

- [ ] **Step 5: Migrate the `Topbar` main branch onto `HeaderShell`.** In `frontend/components/navigation/Topbar.tsx`, the authed `return` (71–162): replace the outer `<header className="z-40 …">` + inner `<div className="grid grid-cols-[1fr_auto_1fr] h-12 …">` with `HeaderShell` + a relaxed flex row. The shell provides `h-12`/padding/frosted/sticky; inside, use three flex groups so the center can yield:

```tsx
  const scrolled = useScrolled();
  return (
    <HeaderShell lifted={scrolled} className={className}>
      {/* Left */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {sidebarContext && isProjectPage && (
          <PanelToggleButton
            side="left"
            pressed={!sidebarContext.sidebarCollapsed}
            onToggle={sidebarContext.toggleSidebar}
            ariaLabel={t('layout', 'sidebarToggleAriaLabel')}
          />
        )}
        {/* hamburger for mobile drawer stays as-is, class flex lg:hidden */}
        {/* title via TruncatedText */}
        <span className="flex min-w-0 items-center gap-1.5 px-2">
          <TruncatedText className="text-header-title font-medium text-foreground">
            {tabIdToLabel[projectContext?.activeTab ?? ''] ?? t('layout', 'defaultProjectName')}
          </TruncatedText>
          {/* …Info tooltip unchanged, add `hidden @[34rem]/headerbar:inline-flex` to it… */}
        </span>
      </div>
      {/* Center */}
      <div className="flex shrink-0 items-center justify-center">
        {isProjectPage && <SectionViewSwitcher />}
      </div>
      {/* Right */}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <NotificationCenter />
        <FeedbackButton />
      </div>
    </HeaderShell>
  );
```

Keep the loading/no-user branches but route them through `HeaderShell` too (so the skeleton matches final chrome). Replace the inline desktop sidebar-toggle button (89–115) with `PanelToggleButton` (above). Remove the now-unused `PanelLeftClose/Open` imports; keep `Menu` (hamburger) and `Info`. Add `useScrolled`, `HeaderShell`, `PanelToggleButton`, `TruncatedText` imports.

- [ ] **Step 6: Add the switcher dropdown aria label key.** In `frontend/lib/copy/navigation.ts`, add `viewSwitcherTrigger: 'Switch view'` (used as the dropdown trigger `aria-label` if the visible label is an icon-only fallback; with a text label it is optional — include for completeness).

- [ ] **Step 7: Run navigation + smoke tests.**

Run: `npm run test:run -- frontend/components/navigation frontend/test/spinner-fix.e2e.test.tsx`
Expected: PASS (update any assertion tied to the old `grid-cols-[1fr_auto_1fr]` / `z-40`).

- [ ] **Step 8: Commit.**

```bash
git add frontend/components/navigation/Topbar.tsx frontend/components/navigation/SectionViewSwitcher.tsx frontend/components/navigation/SectionViewSwitcher.test.tsx frontend/lib/copy/navigation.ts
git commit -m "feat(header): Topbar on HeaderShell — flex slots, collapsible switcher, truncating title, shadow-on-lift"
```

---

## Task 9: Adopt the frosted+clamp overlay surface in the header overlays

**Files:**
- Modify: `frontend/components/navigation/NotificationCenter.tsx:256` (`DropdownMenuContent w-[400px]`)
- Modify: `frontend/components/runs/header/Worklist.tsx:73` (`PopoverContent w-80`)
- Modify: `frontend/components/runs/header/Help.tsx`, `frontend/components/runs/header/CommandPalette.tsx` (confirm they ride the shared content components)

**Interfaces:**
- Consumes: the frosted+clamped `DropdownMenuContent`/`PopoverContent` from Task 6 — most overlays inherit automatically. This task only fixes the ones that **hardcode widths** so the clamp actually engages.

- [ ] **Step 1: Clamp NotificationCenter.** In `frontend/components/navigation/NotificationCenter.tsx:256`, change `className="w-[400px]"` (or similar) on `DropdownMenuContent` to `className="w-[min(400px,calc(100vw-1rem))]"`. (The frosted surface + shadow now come from Task 6's base class.)

- [ ] **Step 2: Clamp Worklist.** In `frontend/components/runs/header/Worklist.tsx:73`, change the `PopoverContent` `className="w-80"` to `className="w-[min(20rem,calc(100vw-1rem))]"`.

- [ ] **Step 3: Audit Help + CommandPalette.** Confirm `Help.tsx` (popover) and `CommandPalette.tsx` (dialog/command) render through the shared `PopoverContent`/dialog; if either hardcodes a width without a `min(…, calc(100vw-1rem))` clamp, apply the same pattern. (CommandPalette is a centered dialog — ensure `max-w-[calc(100vw-2rem)]`.)

- [ ] **Step 4: Verify overlays at phone width (visual — deferred to Task 10 harness).** For now run the existing tests to confirm no regressions.

Run: `npm run test:run -- frontend/components/navigation frontend/components/runs/header`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add frontend/components/navigation/NotificationCenter.tsx frontend/components/runs/header/Worklist.tsx frontend/components/runs/header/Help.tsx frontend/components/runs/header/CommandPalette.tsx
git commit -m "fix(header): viewport-clamp the hardcoded-width header overlays"
```

---

## Task 10: Visual verification harness, breakpoint tuning, shared test utils

**Files:**
- Create (throwaway): `frontend/pages/_dev/HeaderHarness.tsx` + a temporary dev route
- Create: `frontend/components/runs/header/__tests__/_headerTestUtils.tsx`
- Modify: tier thresholds in `frontend/components/layout/useHeaderTier.ts` + container-query literals, if measurement shows different fit points

**Interfaces:**
- Produces: a confirmed breakpoint set + a reusable test util `{ baseRunHeaderValue, mockCopy() }`.

- [ ] **Step 1: Factor shared test utils.** Create `frontend/components/runs/header/__tests__/_headerTestUtils.tsx` exporting the `base` `RunHeaderValue` object (currently duplicated across header tests) and a `mockCopy()` helper wrapping the repeated `vi.mock('@/lib/copy')`. Update Task 7's test + existing header tests to import it. Run `npm run test:run -- frontend/components/runs/header` → PASS.

- [ ] **Step 2: Build the harness.** Create a DEV-only route mounting `Topbar` and a `RunHeader` (with realistic mock props for QA + extraction) inside fixed-width containers. Follow the repo's existing run-view visual-verification pattern (mock props, no auth/back-end). Reference: the project has done this before for RunHeader/PDF-split layout.

- [ ] **Step 3: Measure at each width.** Start the dev server (`npm run dev` from repo root) and load the harness. For widths **320 / 480 / 700 / 900 / 1280**, screenshot and measure bounding-rects (via the preview tooling) for: no horizontal scroll; no control clipped; left title truncates with ellipsis (not crushed); switcher is a dropdown ≤544px and pills above; RunHeader kebab holds the folded controls ≤544px; overlays (NotificationCenter, Worklist) stay within the viewport at 320/360.

- [ ] **Step 4: Tune thresholds if needed.** If the segmented switcher or RunHeader Right cluster actually stops fitting at a width different from 544/768, update `HEADER_TIER_PX` in `useHeaderTier.ts` AND the matching `@[34rem]/@[48rem]` container-query literals together (keep JS + CSS thresholds equal). Re-measure.

- [ ] **Step 5: Run `/design-review` on the live routes.** Run the design-review loop on the project view (`?qaTab=assessment`) and the extraction route at phone + desktop: render → screenshot → compare to the Plane/Linear target → confirm the frosted surface reads correctly in light AND dark mode (and with `prefers-reduced-transparency` forced on → solid fallback).

- [ ] **Step 6: Delete the harness + route.** Remove `frontend/pages/_dev/HeaderHarness.tsx` and the temporary route.

- [ ] **Step 7: Full gate.**

Run: `npm run lint && npm run test:run`
Expected: PASS. (If touching backend nothing changes; this is FE-only.)

- [ ] **Step 8: Commit.**

```bash
git add frontend/components/runs/header/__tests__/_headerTestUtils.tsx frontend/components/layout/useHeaderTier.ts
git commit -m "test(header): shared header test utils + tuned breakpoints from visual harness"
```

---

## Self-review notes (author)

- **Spec coverage:** HeaderShell+tokens (Tasks 1–2) → spec §4.1/§4.4; breakpoint model (Tasks 2,3,7,8) → §4.2; overflow idiom (Tasks 7,8) → §4.3; frosted tokens+guardrails (Task 1) → §4.4; sub-primitives PanelToggleButton/HeaderButton/HeaderChip/overlay-clamp/TruncatedText (Tasks 4,5,6,8) → §4.5; per-tier behavior (Tasks 7,8,10) → §5; a11y (Tasks 1,4,5,7) → §6; testing+harness (Task 10) → §7; sequencing → §8. Non-goals (PageHeader/Dashboard/ProjectView, sub-bars, NotificationCenter i18n) intentionally excluded → §9.
- **Type consistency:** `HeaderTier`, `HEADER_TIER_PX`, `PanelToggleButton({side,pressed,onToggle,ariaLabel})`, Button sizes `header`/`header-icon`, `headerChip()`, `.frosted-header`/`.frosted-overlay`, `shadow-elev-header`, `z-header`, `text-header-title|meta|micro` are used identically wherever referenced.
- **Known dependency:** Task 4 references `size="header-icon"` from Task 5 — flagged inline with a do-Task-5-first note.
