# Sidebar Revitalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revitalize the project sidebar (desktop + mobile) into a modern, resizable, keyboard-navigable shell, and codify a reusable side-panel design system.

**Architecture:** Three-phase build: (1) primitives (`KbdBadge`, `ResizablePanel`, `useKeyboardShortcuts`, `ThemeContext`); (2) sidebar building blocks composed from primitives; (3) wire-up in `ProjectLayout`, `App`, and routing. Behavior follows show/hide-binary with drag-handle resize and persistence via `localStorage`.

**Tech Stack:** React 18 + TypeScript strict, Vite, TanStack Query, Zustand-style React Context, shadcn/Radix, Tailwind, `next-themes` (already a dep), `vitest` + jsdom, `lucide-react`.

**Spec:** [`docs/superpowers/specs/2026-04-27-sidebar-revitalization-design.md`](../specs/2026-04-27-sidebar-revitalization-design.md)
**Design system:** [`docs/superpowers/design-system/sidebar-and-panels.md`](../design-system/sidebar-and-panels.md)

---

## Conventions

- All work happens in worktree `jolly-curran-eecb56` on branch `claude/jolly-curran-eecb56`.
- All new code is TypeScript strict, English identifiers, English copy keys.
- Visual components get a smoke render test; logic-heavy units (resize, shortcuts, theme cycle, persistence, storage edge cases) get proper unit tests with TDD.
- Run tests with `npm test -- <pattern>` (vitest). Lint via `npm run lint`.
- Conventional Commits, frequent.

---

## Phase 1 — Primitives

### Task 1: Platform detection helper

**Files:**
- Create: `frontend/lib/platform.ts`
- Test: `frontend/lib/platform.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/lib/platform.test.ts
import {describe, expect, it, vi, afterEach} from 'vitest';
import {isMac, modifierLabel, modifierKey} from './platform';

describe('platform', () => {
  const originalNav = navigator;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects mac via userAgent', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)'});
    expect(isMac()).toBe(true);
  });

  it('returns false for non-mac userAgent', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
    expect(isMac()).toBe(false);
  });

  it('returns ⌘ for mac modifier label', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
    expect(modifierLabel()).toBe('⌘');
  });

  it('returns Ctrl for non-mac modifier label', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Windows)'});
    expect(modifierLabel()).toBe('Ctrl');
  });

  it('returns metaKey for mac modifier event prop', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
    expect(modifierKey()).toBe('metaKey');
  });

  it('returns ctrlKey for non-mac modifier event prop', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Windows)'});
    expect(modifierKey()).toBe('ctrlKey');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/lib/platform.test.ts --run`
Expected: FAIL — module `./platform` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/lib/platform.ts
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function modifierLabel(): '⌘' | 'Ctrl' {
  return isMac() ? '⌘' : 'Ctrl';
}

export function modifierKey(): 'metaKey' | 'ctrlKey' {
  return isMac() ? 'metaKey' : 'ctrlKey';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frontend/lib/platform.test.ts --run`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/platform.ts frontend/lib/platform.test.ts
git commit -m "feat(lib): add platform detection helpers"
```

---

### Task 2: `<KbdBadge>` component

**Files:**
- Create: `frontend/components/ui/kbd-badge.tsx`
- Test: `frontend/components/ui/kbd-badge.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/ui/kbd-badge.test.tsx
import {describe, expect, it, vi, afterEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import {KbdBadge} from './kbd-badge';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KbdBadge', () => {
  it('renders single-key badge', () => {
    render(<KbdBadge keys={['A']} />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('joins keys with middle dot for sequences', () => {
    render(<KbdBadge keys={['G', 'A']} variant="sequence" />);
    expect(screen.getByText('G·A')).toBeInTheDocument();
  });

  it('renders modifier as ⌘ on mac', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
    render(<KbdBadge keys={['mod', 'B']} />);
    expect(screen.getByText('⌘B')).toBeInTheDocument();
  });

  it('renders modifier as Ctrl on non-mac', () => {
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Windows)'});
    render(<KbdBadge keys={['mod', 'B']} />);
    expect(screen.getByText('CtrlB')).toBeInTheDocument();
  });

  it('is aria-hidden by default', () => {
    const {container} = render(<KbdBadge keys={['A']} />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/components/ui/kbd-badge.test.tsx --run`
Expected: FAIL — `kbd-badge` module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/components/ui/kbd-badge.tsx
/**
 * Keyboard shortcut badge.
 * See docs/superpowers/design-system/sidebar-and-panels.md §6.
 */
import React from 'react';
import {cn} from '@/lib/utils';
import {modifierLabel} from '@/lib/platform';

export type KbdKey = 'mod' | string;

interface KbdBadgeProps {
  keys: KbdKey[];
  variant?: 'chord' | 'sequence';
  className?: string;
}

export const KbdBadge: React.FC<KbdBadgeProps> = ({keys, variant = 'chord', className}) => {
  const rendered = keys.map((k) => (k === 'mod' ? modifierLabel() : k));
  const text = variant === 'sequence' ? rendered.join('·') : rendered.join('');

  return (
    <kbd
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center rounded border border-border/40 bg-muted/40',
        'px-1 min-w-[18px] h-[18px] font-mono text-[10px] text-muted-foreground/70 leading-none',
        'select-none',
        className,
      )}
    >
      {text}
    </kbd>
  );
};

export default KbdBadge;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frontend/components/ui/kbd-badge.test.tsx --run`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/kbd-badge.tsx frontend/components/ui/kbd-badge.test.tsx
git commit -m "feat(ui): add KbdBadge component"
```

---

### Task 3: `useKeyboardShortcuts` hook

**Files:**
- Create: `frontend/hooks/useKeyboardShortcuts.ts`
- Test: `frontend/hooks/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/hooks/useKeyboardShortcuts.test.ts
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {renderHook} from '@testing-library/react';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';

function fireKeydown(key: string, opts: {meta?: boolean; ctrl?: boolean; target?: HTMLElement} = {}) {
  const target = opts.target ?? document.body;
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {userAgent: 'Mozilla/5.0 (Macintosh)'});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('triggers chord handler with mod key', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('b', {meta: true});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not trigger when disabled', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: false}));

    fireKeydown('b', {meta: true});
    expect(handler).not.toHaveBeenCalled();
  });

  it('triggers sequence after prefix within timeout', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('g');
    fireKeydown('a');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cancels sequence after timeout', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('g');
    vi.advanceTimersByTime(1600);
    fireKeydown('a');
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores keydown when target is an input', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireKeydown('g', {target: input});
    fireKeydown('a', {target: input});
    expect(handler).not.toHaveBeenCalled();
  });

  it('still triggers chord with mod even inside input', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'chord', key: 'b', mod: true, handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireKeydown('b', {meta: true, target: input});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores when an open dialog is present', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);

    fireKeydown('g');
    fireKeydown('a');
    expect(handler).not.toHaveBeenCalled();
  });

  it('is case-insensitive on letter keys', () => {
    const handler = vi.fn();
    const bindings: Binding[] = [{type: 'sequence', prefix: 'g', key: 'a', handler}];
    renderHook(() => useKeyboardShortcuts({bindings, enabled: true}));

    fireKeydown('G');
    fireKeydown('A');
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/hooks/useKeyboardShortcuts.test.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/hooks/useKeyboardShortcuts.ts
/**
 * Generic keyboard shortcut hook with input/dialog guards.
 * See docs/superpowers/design-system/sidebar-and-panels.md §7.
 */
import {useEffect, useRef} from 'react';
import {modifierKey} from '@/lib/platform';

export type ChordBinding = {
  type: 'chord';
  key: string;          // single key, lowercase letters or symbols like ',' 'b'
  mod?: boolean;        // require ⌘ on mac / Ctrl elsewhere
  shift?: boolean;
  handler: () => void;
  allowInInputs?: boolean;
};

export type SequenceBinding = {
  type: 'sequence';
  prefix: string;       // first key, e.g. 'g'
  key: string;          // second key, e.g. 'a'
  handler: () => void;
};

export type Binding = ChordBinding | SequenceBinding;

interface UseKeyboardShortcutsOptions {
  bindings: Binding[];
  enabled: boolean;
  sequenceTimeoutMs?: number;
}

const DEFAULT_SEQUENCE_TIMEOUT = 1500;

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return true;
  return false;
}

function isDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"]');
}

export function useKeyboardShortcuts({bindings, enabled, sequenceTimeoutMs = DEFAULT_SEQUENCE_TIMEOUT}: UseKeyboardShortcutsOptions): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const pendingPrefixRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const modProp = modifierKey();

    function clearPending() {
      pendingPrefixRef.current = null;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const modActive = (e as unknown as Record<string, boolean>)[modProp] === true;

      if (isDialogOpen()) {
        clearPending();
        return;
      }

      // Chord bindings (always considered first; mod chords bypass input guard).
      for (const b of bindingsRef.current) {
        if (b.type !== 'chord') continue;
        const requireMod = !!b.mod;
        const requireShift = !!b.shift;
        if (key !== b.key.toLowerCase()) continue;
        if (requireMod !== modActive) continue;
        if (requireShift !== e.shiftKey) continue;
        if (!requireMod && !b.allowInInputs && isTypingTarget(e)) continue;
        e.preventDefault();
        clearPending();
        b.handler();
        return;
      }

      // Sequence bindings — never inside inputs, never with modifiers.
      if (modActive || e.shiftKey || e.altKey) {
        clearPending();
        return;
      }
      if (isTypingTarget(e)) {
        clearPending();
        return;
      }

      const prefix = pendingPrefixRef.current;
      if (prefix) {
        for (const b of bindingsRef.current) {
          if (b.type !== 'sequence') continue;
          if (b.prefix.toLowerCase() === prefix && b.key.toLowerCase() === key) {
            e.preventDefault();
            clearPending();
            b.handler();
            return;
          }
        }
        clearPending();
        return;
      }

      // Start a sequence if any binding uses this prefix.
      const startsSeq = bindingsRef.current.some(
        (b) => b.type === 'sequence' && b.prefix.toLowerCase() === key,
      );
      if (startsSeq) {
        pendingPrefixRef.current = key;
        pendingTimerRef.current = setTimeout(clearPending, sequenceTimeoutMs);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearPending();
    };
  }, [enabled, sequenceTimeoutMs]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frontend/hooks/useKeyboardShortcuts.test.ts --run`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/useKeyboardShortcuts.ts frontend/hooks/useKeyboardShortcuts.test.ts
git commit -m "feat(hooks): add useKeyboardShortcuts with chord+sequence bindings"
```

---

### Task 4: `<ResizablePanel>` component

**Files:**
- Create: `frontend/components/ui/resizable-panel.tsx`
- Test: `frontend/components/ui/resizable-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/ui/resizable-panel.test.tsx
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {ResizablePanel} from './resizable-panel';

const STORAGE_KEY = 'prumo:test-panel:width';

describe('ResizablePanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders children with default width', () => {
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const aside = screen.getByTestId('content').parentElement!;
    expect(aside.style.width).toBe('280px');
  });

  it('reads persisted width from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '320');
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const aside = screen.getByTestId('content').parentElement!;
    expect(aside.style.width).toBe('320px');
  });

  it('falls back to default when stored value is invalid', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage');
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const aside = screen.getByTestId('content').parentElement!;
    expect(aside.style.width).toBe('280px');
  });

  it('clamps width within min and max during drag', () => {
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const handle = screen.getByRole('separator');

    act(() => {
      fireEvent.mouseDown(handle, {clientX: 280});
    });
    act(() => {
      fireEvent.mouseMove(document, {clientX: 1000});
    });
    act(() => {
      fireEvent.mouseUp(document, {clientX: 1000});
    });

    const aside = screen.getByTestId('content').parentElement!;
    expect(aside.style.width).toBe('400px');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('400');
  });

  it('calls onCollapse when released below snap threshold', () => {
    const onCollapse = vi.fn();
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right" onCollapse={onCollapse}>
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const handle = screen.getByRole('separator');

    act(() => {
      fireEvent.mouseDown(handle, {clientX: 280});
    });
    act(() => {
      fireEvent.mouseMove(document, {clientX: 100});
    });
    act(() => {
      fireEvent.mouseUp(document, {clientX: 100});
    });

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('toggles collapse on handle click without drag', () => {
    const onCollapse = vi.fn();
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right" onCollapse={onCollapse}>
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const handle = screen.getByRole('separator');

    act(() => {
      fireEvent.mouseDown(handle, {clientX: 280});
    });
    act(() => {
      fireEvent.mouseUp(document, {clientX: 280});
    });

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('returns null when collapsed', () => {
    const {container} = render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right" collapsed>
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    expect(container.querySelector('aside')).toBeNull();
  });

  it('exposes ARIA separator attributes', () => {
    render(
      <ResizablePanel id="test-panel" defaultWidth={280} minWidth={240} maxWidth={400} snapCollapseAt={200} side="right">
        <div data-testid="content">child</div>
      </ResizablePanel>,
    );
    const handle = screen.getByRole('separator');
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuemin', '240');
    expect(handle).toHaveAttribute('aria-valuemax', '400');
    expect(handle).toHaveAttribute('aria-valuenow', '280');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/components/ui/resizable-panel.test.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/components/ui/resizable-panel.tsx
/**
 * Resizable side panel with drag handle, click-to-collapse, snap-collapse, and persistence.
 * See docs/superpowers/design-system/sidebar-and-panels.md §1.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {cn} from '@/lib/utils';

export interface ResizablePanelProps {
  id: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  snapCollapseAt: number;
  side: 'left' | 'right';
  collapsed?: boolean;
  onCollapse?: () => void;
  className?: string;
  children: React.ReactNode;
}

const DRAG_THRESHOLD_PX = 4;

function storageKey(id: string): string {
  return `prumo:${id}:width`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function readStoredWidth(id: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredWidth(id: string, w: number): void {
  try {
    localStorage.setItem(storageKey(id), String(w));
  } catch {
    /* ignore */
  }
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  id,
  defaultWidth,
  minWidth,
  maxWidth,
  snapCollapseAt,
  side,
  collapsed,
  onCollapse,
  className,
  children,
}) => {
  const [width, setWidth] = useState<number>(() => clamp(readStoredWidth(id, defaultWidth), minWidth, maxWidth));
  const dragStartRef = useRef<{startX: number; startWidth: number; moved: boolean} | null>(null);

  const persist = useCallback((w: number) => {
    writeStoredWidth(id, w);
  }, [id]);

  const onPointerMove = useCallback((e: PointerEvent | MouseEvent | TouchEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const delta = clientX - start.startX;
    const dx = side === 'right' ? delta : -delta;
    if (Math.abs(dx) >= DRAG_THRESHOLD_PX) start.moved = true;
    const next = clamp(start.startWidth + dx, minWidth, maxWidth);
    setWidth(next);
  }, [maxWidth, minWidth, side]);

  const onPointerUp = useCallback((e: PointerEvent | MouseEvent | TouchEvent) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    document.removeEventListener('mousemove', onPointerMove as EventListener);
    document.removeEventListener('mouseup', onPointerUp as EventListener);
    document.removeEventListener('touchmove', onPointerMove as EventListener);
    document.removeEventListener('touchend', onPointerUp as EventListener);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    if (!start) return;

    if (!start.moved) {
      // Pure click → toggle collapse.
      onCollapse?.();
      return;
    }

    const clientX = 'changedTouches' in e ? (e as TouchEvent).changedTouches[0].clientX : (e as MouseEvent).clientX;
    const delta = clientX - start.startX;
    const dx = side === 'right' ? delta : -delta;
    const finalWidth = clamp(start.startWidth + dx, minWidth, maxWidth);
    if (finalWidth < snapCollapseAt) {
      onCollapse?.();
      // Reset width so next expand starts at default.
      setWidth(defaultWidth);
      persist(defaultWidth);
      return;
    }
    persist(finalWidth);
  }, [defaultWidth, maxWidth, minWidth, onCollapse, onPointerMove, persist, side, snapCollapseAt]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = {startX: e.clientX, startWidth: width, moved: false};
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onPointerMove as EventListener);
    document.addEventListener('mouseup', onPointerUp as EventListener);
  }, [onPointerMove, onPointerUp, width]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartRef.current = {startX: e.touches[0].clientX, startWidth: width, moved: false};
    document.addEventListener('touchmove', onPointerMove as EventListener);
    document.addEventListener('touchend', onPointerUp as EventListener);
  }, [onPointerMove, onPointerUp, width]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onCollapse?.();
      return;
    }
    const step = 16;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = clamp(width - step, minWidth, maxWidth);
      setWidth(next);
      persist(next);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = clamp(width + step, minWidth, maxWidth);
      setWidth(next);
      persist(next);
    }
  }, [maxWidth, minWidth, onCollapse, persist, width]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== storageKey(id) || e.newValue == null) return;
      const n = Number(e.newValue);
      if (Number.isFinite(n)) setWidth(clamp(n, minWidth, maxWidth));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [id, minWidth, maxWidth]);

  if (collapsed) return null;

  return (
    <aside
      className={cn('relative flex-shrink-0 transition-[width] duration-200 ease-out motion-reduce:duration-0', className)}
      style={{width: `${width}px`}}
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        aria-controls={id}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onKeyDown={onKeyDown}
        title="Click to collapse · Drag to resize"
        className={cn(
          'absolute top-0 bottom-0 w-1 cursor-col-resize',
          side === 'right' ? '-right-0.5' : '-left-0.5',
          'hover:bg-primary/20 focus-visible:bg-primary/30 focus-visible:outline-none transition-colors',
        )}
      />
    </aside>
  );
};

export default ResizablePanel;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frontend/components/ui/resizable-panel.test.tsx --run`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/resizable-panel.tsx frontend/components/ui/resizable-panel.test.tsx
git commit -m "feat(ui): add ResizablePanel with drag/snap/persistence"
```

---

### Task 5: ThemeProvider + `<ThemeToggle>`

**Files:**
- Create: `frontend/contexts/ThemeContext.tsx`
- Create: `frontend/components/layout/ThemeToggle.tsx`
- Test: `frontend/components/layout/ThemeToggle.test.tsx`
- Modify: `frontend/lib/copy/layout.ts`
- Modify: `frontend/App.tsx`

- [ ] **Step 1: Add new copy keys**

Edit `frontend/lib/copy/layout.ts` — append inside the `layout` object (before the final `} as const`):

```ts
    // Theme toggle
    themeToggleLight: 'Switch to dark theme',
    themeToggleDark: 'Switch to system theme',
    themeToggleSystem: 'Switch to light theme',
    themeToggleAriaLabel: 'Toggle theme',
```

- [ ] **Step 2: Write the failing ThemeToggle test**

```tsx
// frontend/components/layout/ThemeToggle.test.tsx
import {describe, it, expect} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ThemeProvider} from 'next-themes';
import {ThemeToggle} from './ThemeToggle';

function renderWithTheme(initial: 'light' | 'dark' | 'system') {
  return render(
    <ThemeProvider attribute="class" defaultTheme={initial} enableSystem storageKey="prumo:theme">
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  it('cycles light → dark → system → light', async () => {
    const user = userEvent.setup();
    renderWithTheme('light');
    const button = screen.getByRole('button', {name: /toggle theme/i});

    await user.click(button);
    expect(localStorage.getItem('prumo:theme')).toBe('dark');

    await user.click(button);
    expect(localStorage.getItem('prumo:theme')).toBe('system');

    await user.click(button);
    expect(localStorage.getItem('prumo:theme')).toBe('light');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- frontend/components/layout/ThemeToggle.test.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `ThemeContext.tsx`**

```tsx
// frontend/contexts/ThemeContext.tsx
/**
 * Re-exports next-themes provider with prumo defaults and a cycle helper.
 */
import React from 'react';
import {ThemeProvider as NextThemesProvider, useTheme as useNextTheme} from 'next-themes';

const STORAGE_KEY = 'prumo:theme';

export const ThemeProvider: React.FC<{children: React.ReactNode}> = ({children}) => (
  <NextThemesProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    storageKey={STORAGE_KEY}
    disableTransitionOnChange
  >
    {children}
  </NextThemesProvider>
);

export type ThemeMode = 'light' | 'dark' | 'system';

export function useTheme(): {theme: ThemeMode; cycle: () => void} {
  const {theme, setTheme} = useNextTheme();
  const current = (theme ?? 'system') as ThemeMode;
  const cycle = React.useCallback(() => {
    const next: ThemeMode = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
    setTheme(next);
  }, [current, setTheme]);
  return {theme: current, cycle};
}
```

- [ ] **Step 5: Implement `<ThemeToggle>`**

```tsx
// frontend/components/layout/ThemeToggle.tsx
/**
 * Footer theme toggle: cycles light → dark → system.
 */
import React from 'react';
import {Moon, Monitor, Sun} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useTheme} from '@/contexts/ThemeContext';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({className}) => {
  const {theme, cycle} = useTheme();
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={t('layout', 'themeToggleAriaLabel')}
      className={cn('h-7 w-7 hover:bg-muted/50 text-muted-foreground hover:text-foreground', className)}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </Button>
  );
};

export default ThemeToggle;
```

- [ ] **Step 6: Wrap App in ThemeProvider**

Edit `frontend/App.tsx`. Add import after the existing context imports:

```tsx
import {ThemeProvider} from './contexts/ThemeContext';
```

Wrap the existing `<TooltipProvider>` so the tree becomes:

```tsx
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            {/* …existing children… */}
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- frontend/components/layout/ThemeToggle.test.tsx --run`
Expected: PASS, 1 test.

- [ ] **Step 8: Commit**

```bash
git add frontend/contexts/ThemeContext.tsx frontend/components/layout/ThemeToggle.tsx frontend/components/layout/ThemeToggle.test.tsx frontend/lib/copy/layout.ts frontend/App.tsx
git commit -m "feat(theme): add ThemeProvider, useTheme cycle, ThemeToggle"
```

---

## Phase 2 — Sidebar building blocks

### Task 6: Update copy/layout.ts with full sidebar copy

**Files:**
- Modify: `frontend/lib/copy/layout.ts`

- [ ] **Step 1: Replace the file content**

Replace `frontend/lib/copy/layout.ts` with:

```ts
/**
 * UI copy for layout (sidebar, app shell). English only.
 */
export const layout = {
    defaultProjectName: 'Project',
    backToProjects: 'Back to projects',
    dashboard: 'Dashboard',
    settings: 'Settings',
    signOut: 'Sign out',
    profile: 'Profile',
    inviteMembers: 'Invite members',
    helpAndSupport: 'Help & support',
    projects: 'Projects',
    loadingProjects: 'Loading projects…',
    createNewProject: 'Create new project',

    // Sidebar sections (used by sidebarConfig or components)
    sectionProject: 'Project',
    sectionReview: 'Review',
    navOverview: 'Overview',
    navMembers: 'Members',
    navArticles: 'Articles',
    navScreening: 'Screening',
    navDataExtraction: 'Data extraction',
    navQualityAssessment: 'Quality assessment',
    navPrismaReport: 'PRISMA report',
    navSettings: 'Settings',

    // Coming soon placeholder
    comingSoonTitle: 'Coming soon',
    comingSoonBody: 'This area is being built and will be available shortly.',

    // Theme toggle
    themeToggleLight: 'Switch to dark theme',
    themeToggleDark: 'Switch to system theme',
    themeToggleSystem: 'Switch to light theme',
    themeToggleAriaLabel: 'Toggle theme',

    // Resize handle
    resizeHandleTooltip: 'Click to collapse · Drag to resize',

    // Sidebar toggle
    sidebarToggleAriaLabel: 'Toggle sidebar',
} as const;

export type LayoutCopy = typeof layout;
```

- [ ] **Step 2: Verify type check passes**

Run: `npm run lint -- frontend/lib/copy/layout.ts || true`
Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | head -40`
Expected: no errors related to `layout`.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/copy/layout.ts
git commit -m "feat(copy): add new sidebar/menu/theme copy keys"
```

---

### Task 7: Update `sidebarConfig.ts` with new structure

**Files:**
- Modify: `frontend/components/layout/sidebarConfig.ts`

- [ ] **Step 1: Replace file content**

```ts
// frontend/components/layout/sidebarConfig.ts
/**
 * Shared sidebar navigation config: sections, labels, icons, and shortcuts.
 * Used by ProjectSidebar, MobileSidebar, useNavigationShortcuts, and Topbar.
 */
import type {LucideIcon} from 'lucide-react';
import {
    BarChart3,
    ClipboardCheck,
    FileBarChart,
    FileText,
    LayoutDashboard,
    ListChecks,
    Users,
} from 'lucide-react';
import {t} from '@/lib/copy';

export type SidebarTabId =
    | 'overview'
    | 'members'
    | 'articles'
    | 'screening'
    | 'extraction'
    | 'assessment'
    | 'prisma';

export interface SidebarNavItem {
    id: SidebarTabId;
    label: string;
    icon: LucideIcon;
    /** Single uppercase letter triggered after the `G` prefix. */
    shortcut: string;
    /** Whether this tab renders a ComingSoonPanel placeholder. */
    comingSoon?: boolean;
}

export interface SidebarSection {
    title: string;
    items: SidebarNavItem[];
}

export const sidebarSections: SidebarSection[] = [
    {
        title: t('layout', 'sectionProject'),
        items: [
            {id: 'overview', label: t('layout', 'navOverview'), icon: LayoutDashboard, shortcut: 'O', comingSoon: true},
            {id: 'members', label: t('layout', 'navMembers'), icon: Users, shortcut: 'M', comingSoon: true},
        ],
    },
    {
        title: t('layout', 'sectionReview'),
        items: [
            {id: 'articles', label: t('layout', 'navArticles'), icon: FileText, shortcut: 'A'},
            {id: 'screening', label: t('layout', 'navScreening'), icon: ListChecks, shortcut: 'T', comingSoon: true},
            {id: 'extraction', label: t('layout', 'navDataExtraction'), icon: ClipboardCheck, shortcut: 'E'},
            {id: 'prisma', label: t('layout', 'navPrismaReport'), icon: FileBarChart, shortcut: 'R', comingSoon: true},
        ],
    },
];

/** Flat list of items for shortcut wiring. */
export const sidebarItems: SidebarNavItem[] = sidebarSections.flatMap((s) => s.items);

/** Map tab id -> display label for Topbar and other consumers. */
export const tabIdToLabel: Record<SidebarTabId | 'assessment' | 'settings', string> = {
    overview: t('layout', 'navOverview'),
    members: t('layout', 'navMembers'),
    articles: t('layout', 'navArticles'),
    screening: t('layout', 'navScreening'),
    extraction: t('layout', 'navDataExtraction'),
    assessment: t('layout', 'navQualityAssessment'),
    prisma: t('layout', 'navPrismaReport'),
    settings: t('layout', 'navSettings'),
};

export const VALID_TAB_IDS: SidebarTabId[] = sidebarItems.map((i) => i.id);
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep "sidebarConfig\|tabIdToLabel" | head -20`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/layout/sidebarConfig.ts
git commit -m "feat(layout): expand sidebarConfig with new tabs and shortcuts"
```

---

### Task 8: Extend `SidebarContext` with width + persistence

**Files:**
- Modify: `frontend/contexts/SidebarContext.tsx`
- Test: `frontend/contexts/SidebarContext.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/contexts/SidebarContext.test.tsx
import {describe, it, expect, beforeEach} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {SidebarProvider, useSidebar} from './SidebarContext';

const wrapper = ({children}: {children: React.ReactNode}) => <SidebarProvider>{children}</SidebarProvider>;

describe('SidebarContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads initial collapsed from localStorage', () => {
    localStorage.setItem('prumo:sidebar:collapsed', 'true');
    const {result} = renderHook(() => useSidebar(), {wrapper});
    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it('persists toggle to localStorage', () => {
    const {result} = renderHook(() => useSidebar(), {wrapper});
    act(() => result.current.toggleSidebar());
    expect(localStorage.getItem('prumo:sidebar:collapsed')).toBe('true');
    act(() => result.current.toggleSidebar());
    expect(localStorage.getItem('prumo:sidebar:collapsed')).toBe('false');
  });

  it('falls back to default when stored collapsed is invalid', () => {
    localStorage.setItem('prumo:sidebar:collapsed', 'garbage');
    const {result} = renderHook(() => useSidebar(), {wrapper});
    expect(result.current.sidebarCollapsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/contexts/SidebarContext.test.tsx --run`
Expected: FAIL — initial collapsed not persisted.

- [ ] **Step 3: Update implementation**

Replace `frontend/contexts/SidebarContext.tsx`:

```tsx
import {createContext, ReactNode, useContext, useEffect, useState} from 'react';

interface SidebarContextType {
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
    mobileOpen: boolean;
    toggleMobile: () => void;
    setMobileOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

const STORAGE_KEY = 'prumo:sidebar:collapsed';

function readInitialCollapsed(fallback: boolean): boolean {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        return fallback;
    } catch {
        return fallback;
    }
}

interface SidebarProviderProps {
    children: ReactNode;
    defaultCollapsed?: boolean;
}

export function SidebarProvider({children, defaultCollapsed = false}: SidebarProviderProps) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readInitialCollapsed(defaultCollapsed));
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, String(sidebarCollapsed));
        } catch {
            /* ignore */
        }
    }, [sidebarCollapsed]);

    useEffect(() => {
        function onStorage(e: StorageEvent) {
            if (e.key !== STORAGE_KEY || e.newValue == null) return;
            if (e.newValue === 'true') setSidebarCollapsed(true);
            else if (e.newValue === 'false') setSidebarCollapsed(false);
        }
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const toggleSidebar = () => setSidebarCollapsed((p) => !p);
    const toggleMobile = () => setMobileOpen((p) => !p);

    return (
        <SidebarContext.Provider
            value={{sidebarCollapsed, toggleSidebar, setSidebarCollapsed, mobileOpen, toggleMobile, setMobileOpen}}
        >
            {children}
        </SidebarContext.Provider>
    );
}

export function useSidebar() {
    const ctx = useContext(SidebarContext);
    if (ctx === undefined) throw new Error('useSidebar must be used within a SidebarProvider');
    return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frontend/contexts/SidebarContext.test.tsx --run`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/contexts/SidebarContext.tsx frontend/contexts/SidebarContext.test.tsx
git commit -m "feat(context): persist sidebar collapsed state to localStorage"
```

---

### Task 9: `<SidebarNavItem>` component

**Files:**
- Create: `frontend/components/layout/SidebarNavItem.tsx`
- Test: `frontend/components/layout/SidebarNavItem.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/layout/SidebarNavItem.test.tsx
import {describe, it, expect, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {FileText} from 'lucide-react';
import {SidebarNavItem} from './SidebarNavItem';

describe('SidebarNavItem', () => {
  it('renders label and shortcut badge', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active={false} onClick={vi.fn()} />);
    expect(screen.getByText('Articles')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('marks active item with aria-current', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'page');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes aria-keyshortcuts as G then letter', () => {
    render(<SidebarNavItem icon={FileText} label="Articles" shortcut="A" active={false} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'G A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/components/layout/SidebarNavItem.test.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementation**

```tsx
// frontend/components/layout/SidebarNavItem.tsx
/**
 * Sidebar nav item: icon + label + shortcut badge.
 * See docs/superpowers/design-system/sidebar-and-panels.md §4.
 */
import React from 'react';
import type {LucideIcon} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {cn} from '@/lib/utils';

interface SidebarNavItemProps {
  icon: LucideIcon;
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
}

export const SidebarNavItem: React.FC<SidebarNavItemProps> = ({icon: Icon, label, shortcut, active, onClick}) => (
  <Button
    variant="ghost"
    aria-current={active ? 'page' : undefined}
    aria-keyshortcuts={`G ${shortcut}`}
    onClick={onClick}
    className={cn(
      'w-full justify-start gap-2.5 h-7 px-2.5 rounded-md transition-colors duration-75 group',
      active
        ? 'bg-muted text-foreground font-medium'
        : 'text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground',
    )}
  >
    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-foreground' : 'group-hover:text-foreground/80')} strokeWidth={1.5} />
    <span className="text-[13px] flex-1 text-left truncate">{label}</span>
    <KbdBadge keys={[shortcut]} className="opacity-60 group-hover:opacity-100" />
  </Button>
);

export default SidebarNavItem;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frontend/components/layout/SidebarNavItem.test.tsx --run`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/layout/SidebarNavItem.tsx frontend/components/layout/SidebarNavItem.test.tsx
git commit -m "feat(layout): add SidebarNavItem with shortcut badge"
```

---

### Task 10: `<SidebarSection>` component

**Files:**
- Create: `frontend/components/layout/SidebarSection.tsx`

- [ ] **Step 1: Implementation (no test — pure layout wrapper)**

```tsx
// frontend/components/layout/SidebarSection.tsx
/**
 * Sidebar section: uppercase title + items.
 * See docs/superpowers/design-system/sidebar-and-panels.md §5.
 */
import React from 'react';

interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

export const SidebarSection: React.FC<SidebarSectionProps> = ({title, children}) => (
  <div>
    <div className="px-2.5 pb-1 pt-2">
      <span className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider select-none">
        {title}
      </span>
    </div>
    {children}
  </div>
);

export default SidebarSection;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/layout/SidebarSection.tsx
git commit -m "feat(layout): add SidebarSection wrapper"
```

---

### Task 11: `<SidebarHeader>` (project switcher)

**Files:**
- Create: `frontend/components/layout/SidebarHeader.tsx`

- [ ] **Step 1: Implementation**

Note: extracts the existing project-switcher logic from `ProjectSidebar.tsx` (lines 113–180), keeps the same RPC creation flow, and adds an `open`/`onOpenChange` controlled prop for the `⌘K` shortcut.

```tsx
// frontend/components/layout/SidebarHeader.tsx
/**
 * Project switcher in the sidebar header.
 * Controlled `open` state allows external triggers (⌘K).
 */
import React, {useState} from 'react';
import {ChevronDown, Loader2, Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useProjectsList} from '@/hooks/useProjectsList';
import {useAuth} from '@/contexts/AuthContext';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {AddProjectDialog} from '@/components/project/AddProjectDialog';
import {t} from '@/lib/copy';

interface SidebarHeaderProps {
  projectName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({projectName, open, onOpenChange}) => {
  const {user} = useAuth();
  const {projects, loading, switchProject, loadProjects} = useProjectsList();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateProject = async (data: {name: string; description?: string}) => {
    if (!user?.id) {
      toast.error(t('pages', 'dashboardAuthRequired'));
      return;
    }
    setIsCreating(true);
    try {
      const {data: projectId, error} = await supabase.rpc(
        'create_project_with_member' as any,
        {p_name: data.name, p_description: data.description || undefined, p_review_title: undefined},
      );
      if (error) {
        toast.error(`${t('pages', 'dashboardErrorCreating')}: ${error.message}`);
        return;
      }
      if (!projectId || typeof projectId !== 'string') {
        toast.error(t('pages', 'dashboardErrorProjectIdNotReturned'));
        return;
      }
      toast.success(t('pages', 'dashboardProjectCreated'));
      setShowAddDialog(false);
      await loadProjects();
      switchProject(projectId);
    } catch {
      toast.error(t('pages', 'dashboardUnexpectedError'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="h-12 flex items-center px-3 border-b border-border/40">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 h-8 px-2 rounded-md hover:bg-muted/50 transition-colors group"
          >
            <div className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15">
              <span className="text-[10px] font-semibold text-primary leading-none">
                {(projectName || 'P')[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1 text-left">
              <h2 className="text-[13px] font-medium truncate text-foreground/80">
                {projectName || t('layout', 'defaultProjectName')}
              </h2>
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground/50" />
            <KbdBadge keys={['K']} className="ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[260px] p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border/50">
          {loading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => switchProject(project.id)}
                  className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60"
                >
                  <div className="h-4 w-4 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15 mr-2">
                    <span className="text-[9px] font-semibold text-primary leading-none">
                      {project.name[0].toUpperCase()}
                    </span>
                  </div>
                  <span className="truncate">{project.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border/30" />
              <DropdownMenuItem
                onClick={() => setShowAddDialog(true)}
                className="px-2 py-1.5 rounded-md text-[13px] text-primary focus:bg-primary/5 focus:text-primary"
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                <span>{t('layout', 'createNewProject')}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AddProjectDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onProjectCreate={handleCreateProject}
        isCreating={isCreating}
      />
    </div>
  );
};

export default SidebarHeader;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/layout/SidebarHeader.tsx
git commit -m "feat(layout): extract SidebarHeader with controlled project switcher"
```

---

### Task 12: `<UserMenu>` dropdown

**Files:**
- Create: `frontend/components/layout/UserMenu.tsx`
- Test: `frontend/components/layout/UserMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/layout/UserMenu.test.tsx
import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {UserMenu} from './UserMenu';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({signOut: vi.fn().mockResolvedValue(undefined)}),
}));
vi.mock('@/hooks/useNavigation', () => ({
  useUserProfile: () => ({user: {name: 'Raphael', email: 'r@x.dev', avatar: '', initials: 'R'}}),
}));

describe('UserMenu', () => {
  it('renders user name and opens menu with Profile/Settings/Sign out', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', {name: /Raphael/i}));
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Invite members')).toBeInTheDocument();
    expect(screen.getByText('Help & support')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- frontend/components/layout/UserMenu.test.tsx --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementation**

```tsx
// frontend/components/layout/UserMenu.tsx
/**
 * Sidebar footer user menu: avatar + dropdown with Profile/Settings/Invite/Help/Sign out.
 * Placeholder items show a toast until backed by real flows.
 */
import React from 'react';
import {ChevronDown, HelpCircle, LogOut, Settings, UserPlus, User as UserIcon} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {KbdBadge} from '@/components/ui/kbd-badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {useAuth} from '@/contexts/AuthContext';
import {useUserProfile} from '@/hooks/useNavigation';
import {t} from '@/lib/copy';

interface UserMenuProps {
  collapsed?: boolean;
}

export const UserMenu: React.FC<UserMenuProps> = ({collapsed}) => {
  const {signOut} = useAuth();
  const {user} = useUserProfile();
  const navigate = useNavigate();

  if (!user) return null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const showPlaceholder = (label: string) => toast.info(`${label}: ${t('layout', 'comingSoonTitle').toLowerCase()}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-haspopup="menu"
          className="flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors duration-75"
        >
          <Avatar className="h-6 w-6 flex-shrink-0 border border-border/40">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="text-[9px] bg-muted">{user.initials}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <span className="text-[13px] truncate flex-1 min-w-0">{user.name}</span>
              <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground/50 flex-shrink-0" strokeWidth={1.5} />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-64 p-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-border/50">
        <DropdownMenuLabel className="font-normal px-2 py-1.5 flex items-center gap-2">
          <Avatar className="h-7 w-7 border border-border/40">
            <AvatarImage src={user.avatar} alt={user.name} />
            <AvatarFallback className="text-[10px] bg-muted">{user.initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-tight text-foreground truncate">{user.name}</p>
            <p className="text-[12px] leading-tight text-muted-foreground truncate">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border/30" />
        <DropdownMenuItem onClick={() => showPlaceholder(t('layout', 'profile'))} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <UserIcon className="mr-2 h-4 w-4" strokeWidth={1.5} />
          {t('layout', 'profile')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate('/settings')} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <Settings className="mr-2 h-4 w-4" strokeWidth={1.5} />
          <span className="flex-1">{t('layout', 'settings')}</span>
          <KbdBadge keys={['mod', ',']} />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => showPlaceholder(t('layout', 'inviteMembers'))} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <UserPlus className="mr-2 h-4 w-4" strokeWidth={1.5} />
          {t('layout', 'inviteMembers')}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border/30" />
        <DropdownMenuItem onClick={() => showPlaceholder(t('layout', 'helpAndSupport'))} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <HelpCircle className="mr-2 h-4 w-4" strokeWidth={1.5} />
          {t('layout', 'helpAndSupport')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut} className="px-2 py-1.5 rounded-md text-[13px] focus:bg-muted/60">
          <LogOut className="mr-2 h-4 w-4" strokeWidth={1.5} />
          <span className="flex-1">{t('layout', 'signOut')}</span>
          <KbdBadge keys={['mod', 'Q']} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserMenu;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- frontend/components/layout/UserMenu.test.tsx --run`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/layout/UserMenu.tsx frontend/components/layout/UserMenu.test.tsx
git commit -m "feat(layout): add UserMenu dropdown with Profile/Settings/Invite/Help/SignOut"
```

---

### Task 13: `<SidebarFooter>`

**Files:**
- Create: `frontend/components/layout/SidebarFooter.tsx`

- [ ] **Step 1: Implementation**

```tsx
// frontend/components/layout/SidebarFooter.tsx
/**
 * Sidebar footer: user menu (left, fills) + theme toggle (right).
 */
import React from 'react';
import {ThemeToggle} from './ThemeToggle';
import {UserMenu} from './UserMenu';

export const SidebarFooter: React.FC = () => (
  <div className="border-t border-border/40 p-2 flex items-center gap-1">
    <div className="flex-1 min-w-0">
      <UserMenu />
    </div>
    <ThemeToggle />
  </div>
);

export default SidebarFooter;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/layout/SidebarFooter.tsx
git commit -m "feat(layout): add SidebarFooter combining UserMenu + ThemeToggle"
```

---

### Task 14: `<ComingSoonPanel>` placeholder

**Files:**
- Create: `frontend/components/layout/ComingSoonPanel.tsx`

- [ ] **Step 1: Implementation**

```tsx
// frontend/components/layout/ComingSoonPanel.tsx
/**
 * Generic placeholder for tabs whose page hasn't been implemented yet.
 */
import React from 'react';
import type {LucideIcon} from 'lucide-react';
import {Sparkles} from 'lucide-react';
import {t} from '@/lib/copy';

interface ComingSoonPanelProps {
  title: string;
  icon?: LucideIcon;
  description?: string;
}

export const ComingSoonPanel: React.FC<ComingSoonPanelProps> = ({title, icon: Icon = Sparkles, description}) => (
  <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
    <div className="h-12 w-12 rounded-full bg-muted/40 flex items-center justify-center mb-4 border border-border/40">
      <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
    </div>
    <h2 className="text-[15px] font-medium text-foreground mb-1">{title}</h2>
    <p className="text-[13px] text-muted-foreground max-w-sm">
      {description ?? t('layout', 'comingSoonBody')}
    </p>
  </div>
);

export default ComingSoonPanel;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/layout/ComingSoonPanel.tsx
git commit -m "feat(layout): add ComingSoonPanel placeholder"
```

---

## Phase 3 — Wire it together

### Task 15: Refactor `ProjectSidebar` to compose new pieces

**Files:**
- Modify: `frontend/components/layout/ProjectSidebar.tsx`

- [ ] **Step 1: Replace file content**

```tsx
// frontend/components/layout/ProjectSidebar.tsx
/**
 * Project sidebar: header (project switcher) + sections + footer.
 * Uses ResizablePanel for show/hide-binary + drag resize.
 * See docs/superpowers/design-system/sidebar-and-panels.md
 */
import React from 'react';
import {ResizablePanel} from '@/components/ui/resizable-panel';
import {SidebarHeader} from './SidebarHeader';
import {SidebarSection} from './SidebarSection';
import {SidebarNavItem} from './SidebarNavItem';
import {SidebarFooter} from './SidebarFooter';
import {sidebarSections, type SidebarTabId} from './sidebarConfig';
import {useSidebar} from '@/contexts/SidebarContext';
import {cn} from '@/lib/utils';

interface ProjectSidebarProps {
  activeTab: string;
  onTabChange: (tab: SidebarTabId) => void;
  projectName?: string;
  switcherOpen?: boolean;
  onSwitcherOpenChange?: (open: boolean) => void;
  className?: string;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  activeTab,
  onTabChange,
  projectName,
  switcherOpen,
  onSwitcherOpenChange,
  className,
}) => {
  const {sidebarCollapsed, toggleSidebar} = useSidebar();

  return (
    <ResizablePanel
      id="sidebar"
      side="right"
      defaultWidth={280}
      minWidth={240}
      maxWidth={400}
      snapCollapseAt={200}
      collapsed={sidebarCollapsed}
      onCollapse={toggleSidebar}
      className={cn(
        'bg-[#fafafa] dark:bg-[#0c0c0c] border-r border-border/40 hidden lg:block',
        className,
      )}
    >
      <div className="flex flex-col h-full">
        <SidebarHeader projectName={projectName} open={switcherOpen} onOpenChange={onSwitcherOpenChange} />
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {sidebarSections.map((section) => (
            <SidebarSection key={section.title} title={section.title}>
              {section.items.map((item) => (
                <SidebarNavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  shortcut={item.shortcut}
                  active={activeTab === item.id}
                  onClick={() => onTabChange(item.id)}
                />
              ))}
            </SidebarSection>
          ))}
        </nav>
        <SidebarFooter />
      </div>
    </ResizablePanel>
  );
};

export default ProjectSidebar;
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "ProjectSidebar|sidebarSections" | head -20`
Expected: no errors in this file (other unrelated errors are tracked separately).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/layout/ProjectSidebar.tsx
git commit -m "refactor(layout): rebuild ProjectSidebar from new primitives"
```

---

### Task 16: Refactor `MobileSidebar` for parity

**Files:**
- Modify: `frontend/components/layout/MobileSidebar.tsx`

- [ ] **Step 1: Replace file content**

```tsx
// frontend/components/layout/MobileSidebar.tsx
/**
 * Mobile sidebar (Sheet): same sections as desktop, no badges, no resize.
 */
import React from 'react';
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {Button} from '@/components/ui/button';
import {ChevronDown} from 'lucide-react';
import {SidebarSection} from './SidebarSection';
import {SidebarFooter} from './SidebarFooter';
import {sidebarSections, type SidebarTabId} from './sidebarConfig';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: string;
  onTabChange: (tab: SidebarTabId) => void;
  projectName?: string;
}

export const MobileSidebar: React.FC<MobileSidebarProps> = ({open, onOpenChange, activeTab, onTabChange, projectName}) => {
  const handleTabChange = (tab: SidebarTabId) => {
    onTabChange(tab);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[280px] max-w-[85vw] p-0">
        <div className="flex flex-col h-full">
          <SheetHeader className="px-3 py-3 pr-12 border-b border-border/40 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-5 w-5 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 border border-primary/15">
                <span className="text-[10px] font-semibold text-primary leading-none">
                  {(projectName || 'P')[0].toUpperCase()}
                </span>
              </div>
              <SheetTitle className="flex-1 text-left text-[13px] font-medium truncate text-foreground">
                {projectName || t('layout', 'defaultProjectName')}
              </SheetTitle>
            </div>
          </SheetHeader>

          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {sidebarSections.map((section) => (
              <SidebarSection key={section.title} title={section.title}>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      onClick={() => handleTabChange(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'w-full justify-start gap-2.5 h-8 px-2.5 rounded-md transition-colors duration-75',
                        active
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 flex-shrink-0', active && 'text-foreground')} strokeWidth={1.5} />
                      <span className="text-[13px]">{item.label}</span>
                    </Button>
                  );
                })}
              </SidebarSection>
            ))}
          </nav>

          <SidebarFooter />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileSidebar;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/layout/MobileSidebar.tsx
git commit -m "refactor(layout): rebuild MobileSidebar from new primitives"
```

---

### Task 17: `useNavigationShortcuts` hook

**Files:**
- Create: `frontend/hooks/useNavigationShortcuts.ts`

- [ ] **Step 1: Implementation**

```ts
// frontend/hooks/useNavigationShortcuts.ts
/**
 * Project-shell shortcuts: G+letter for nav, ⌘B for sidebar, ⌘K for project switcher.
 */
import {useMemo} from 'react';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';
import {sidebarItems, type SidebarTabId} from '@/components/layout/sidebarConfig';

interface UseNavigationShortcutsOptions {
  enabled: boolean;
  onNavigate: (tab: SidebarTabId) => void;
  onToggleSidebar: () => void;
  onOpenProjectSwitcher: () => void;
}

export function useNavigationShortcuts({enabled, onNavigate, onToggleSidebar, onOpenProjectSwitcher}: UseNavigationShortcutsOptions): void {
  const bindings: Binding[] = useMemo(() => {
    const navBindings: Binding[] = sidebarItems.map((item) => ({
      type: 'sequence',
      prefix: 'g',
      key: item.shortcut.toLowerCase(),
      handler: () => onNavigate(item.id),
    }));
    const chordBindings: Binding[] = [
      {type: 'chord', key: 'b', mod: true, handler: onToggleSidebar},
      {type: 'chord', key: 'k', mod: true, handler: onOpenProjectSwitcher},
    ];
    return [...navBindings, ...chordBindings];
  }, [onNavigate, onToggleSidebar, onOpenProjectSwitcher]);

  useKeyboardShortcuts({bindings, enabled});
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/hooks/useNavigationShortcuts.ts
git commit -m "feat(hooks): add useNavigationShortcuts wiring G+letter, ⌘B, ⌘K"
```

---

### Task 18: Update `ProjectLayout` to wire shortcuts and switcher state

**Files:**
- Modify: `frontend/components/layout/AppLayout.tsx`

- [ ] **Step 1: Replace `ProjectLayout` block**

Open `frontend/components/layout/AppLayout.tsx`. Replace the entire `ProjectLayout` export (the `export const ProjectLayout` block) with:

```tsx
export const ProjectLayout: React.FC<AppLayoutProps> = ({children, className}) => {
  const {project, activeTab, changeTab} = useProject();
  const {sidebarCollapsed, toggleSidebar, mobileOpen, setMobileOpen} = useSidebar();
  const [switcherOpen, setSwitcherOpen] = React.useState(false);

  useNavigationShortcuts({
    enabled: true,
    onNavigate: (tab) => changeTab(tab),
    onToggleSidebar: toggleSidebar,
    onOpenProjectSwitcher: () => setSwitcherOpen(true),
  });

  return (
    <div className={cn('h-screen flex flex-col overflow-hidden bg-background', className)}>
      <div className="flex-shrink-0">
        <Topbar />
      </div>

      <MobileSidebar
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        activeTab={activeTab}
        onTabChange={changeTab}
        projectName={project?.name}
      />

      <div className="flex flex-1 overflow-hidden">
        <ProjectSidebar
          activeTab={activeTab}
          onTabChange={changeTab}
          projectName={project?.name}
          switcherOpen={switcherOpen}
          onSwitcherOpenChange={setSwitcherOpen}
        />
        <main className="flex-1 overflow-y-auto">
          {children || <Outlet />}
        </main>
      </div>
    </div>
  );
};
```

Add to imports at top of file:

```tsx
import React from 'react';
import {useNavigationShortcuts} from '@/hooks/useNavigationShortcuts';
```

(Adjust the existing `import React from 'react';` if it already exists — keep one.)

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "AppLayout|ProjectLayout" | head -20`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/layout/AppLayout.tsx
git commit -m "refactor(layout): wire navigation shortcuts and switcher state in ProjectLayout"
```

---

### Task 19: Wire global shortcuts (⌘, and ⌘Q) in `App.tsx`

**Files:**
- Modify: `frontend/App.tsx`
- Create: `frontend/hooks/useGlobalShortcuts.ts`

- [ ] **Step 1: Create the hook**

```ts
// frontend/hooks/useGlobalShortcuts.ts
/**
 * App-wide shortcuts that work on any page: ⌘, (settings), ⌘Q (sign out).
 */
import {useNavigate} from 'react-router-dom';
import {useKeyboardShortcuts, type Binding} from './useKeyboardShortcuts';
import {useAuth} from '@/contexts/AuthContext';

export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const {signOut} = useAuth();

  const bindings: Binding[] = [
    {type: 'chord', key: ',', mod: true, handler: () => navigate('/settings'), allowInInputs: true},
    {
      type: 'chord',
      key: 'q',
      mod: true,
      shift: true, // ⌘⇧Q to avoid conflict with browser quit; mockup shows ⌘Q but browser intercepts that on macOS
      handler: async () => {
        await signOut();
        navigate('/auth');
      },
      allowInInputs: true,
    },
  ];

  useKeyboardShortcuts({bindings, enabled: true});
}
```

> Note: The spec shows `⌘Q` but on macOS Chrome/Safari intercepts that. We use `⌘⇧Q` and update the badge accordingly. (The `<KbdBadge>` in `UserMenu` should be updated in Step 3 below.)

- [ ] **Step 2: Mount the hook in `App.tsx`**

Add inside the existing `<AuthProvider>` subtree (after `<Suspense>` opens, before `<Routes>`). Create a small wrapper component because hooks need `useNavigate` (router context) and `useAuth`:

In `frontend/App.tsx`, add at top (with other imports):

```tsx
import {useGlobalShortcuts} from './hooks/useGlobalShortcuts';
```

Add this component right above `const App = () => {`:

```tsx
const GlobalShortcuts: React.FC<{children: React.ReactNode}> = ({children}) => {
  useGlobalShortcuts();
  return <>{children}</>;
};
```

Add `import React from 'react';` to the top if not present. Wrap the `<Suspense>` block:

```tsx
                  <Suspense fallback={<PageLoader />}>
                    <GlobalShortcuts>
                      <Routes>
                        {/* …existing routes… */}
                      </Routes>
                    </GlobalShortcuts>
                  </Suspense>
```

- [ ] **Step 3: Update `UserMenu` ⌘Q badge to ⌘⇧Q**

Edit `frontend/components/layout/UserMenu.tsx`. Replace:

```tsx
          <KbdBadge keys={['mod', 'Q']} />
```

with:

```tsx
          <KbdBadge keys={['mod', '⇧', 'Q']} />
```

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useGlobalShortcuts.ts frontend/App.tsx frontend/components/layout/UserMenu.tsx
git commit -m "feat(shortcuts): add ⌘, and ⌘⇧Q global shortcuts"
```

---

### Task 20: Update `ProjectContext` to accept new tab IDs

**Files:**
- Modify: `frontend/contexts/ProjectContext.tsx`

- [ ] **Step 1: Replace the valid-tab list**

Find both occurrences of:

```ts
['articles', 'extraction', 'assessment', 'settings'].includes(tabFromUrl)
```

Replace each with:

```ts
['articles', 'extraction', 'assessment', 'settings', 'overview', 'members', 'screening', 'prisma'].includes(tabFromUrl)
```

(Two occurrences total — initial read and the `useEffect`.)

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep ProjectContext | head -20`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/contexts/ProjectContext.tsx
git commit -m "feat(context): accept new sidebar tab IDs in ProjectContext"
```

---

### Task 21: Render new tabs in `ProjectView`

**Files:**
- Modify: `frontend/pages/ProjectView.tsx`

- [ ] **Step 1: Locate the tab rendering switch**

Run: `grep -n "activeTab ===\|activeTab ==" frontend/pages/ProjectView.tsx | head -20`

Identify the JSX block that renders tab content based on `activeTab` (typically a series of conditional renders or a switch).

- [ ] **Step 2: Add ComingSoonPanel imports**

Add to imports at top of `frontend/pages/ProjectView.tsx`:

```tsx
import {ComingSoonPanel} from "@/components/layout/ComingSoonPanel";
import {FileBarChart, LayoutDashboard, ListChecks, Users} from "lucide-react";
import {t} from "@/lib/copy"; // verify it's already imported; if so skip
```

- [ ] **Step 3: Add new tab cases**

Inside the JSX where existing `activeTab === 'articles'` etc. are rendered, add four new conditional renders alongside the existing ones. Use the pattern that already exists in the file — do not refactor unrelated structure. Example (insert near the existing tab branches):

```tsx
{activeTab === 'overview' && (
  <ComingSoonPanel title={t('layout', 'navOverview')} icon={LayoutDashboard} />
)}
{activeTab === 'members' && (
  <ComingSoonPanel title={t('layout', 'navMembers')} icon={Users} />
)}
{activeTab === 'screening' && (
  <ComingSoonPanel title={t('layout', 'navScreening')} icon={ListChecks} />
)}
{activeTab === 'prisma' && (
  <ComingSoonPanel title={t('layout', 'navPrismaReport')} icon={FileBarChart} />
)}
```

- [ ] **Step 4: Type check + smoke test**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep ProjectView | head -20`
Expected: no errors in this file.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/ProjectView.tsx
git commit -m "feat(pages): render ComingSoonPanel for overview/members/screening/prisma tabs"
```

---

### Task 22: Update `Topbar` toggle semantics

**Files:**
- Modify: `frontend/components/navigation/Topbar.tsx`

- [ ] **Step 1: Update aria-label and copy**

In `frontend/components/navigation/Topbar.tsx`, find the desktop sidebar toggle (around lines 88–98). Replace its `aria-label` to use the new key:

```tsx
              aria-label={t('layout', 'sidebarToggleAriaLabel')}
```

Remove the `t('navigation', 'ariaExpandSidebar')` and `t('navigation', 'ariaCollapseSidebar')` calls (they were used to convey the previous mini→expanded distinction; now the meaning is binary).

- [ ] **Step 2: Behavior unchanged but icon swaps**

The existing `PanelLeft` icon stays. Behavior of `toggleSidebar` is now binary (handled by the updated `SidebarContext` and `ProjectSidebar`'s `ResizablePanel`).

- [ ] **Step 3: Type check + visual check**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep Topbar | head -20`
Expected: no errors related to this change.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/navigation/Topbar.tsx
git commit -m "refactor(topbar): align sidebar toggle aria-label with new binary semantics"
```

---

## Phase 4 — Documentation, lint, and manual QA

### Task 23: Update CLAUDE.md / changelog snippet

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append a recent-changes line**

Open `CLAUDE.md`. Under `## Recent Changes`, prepend:

```text
- 2026-04-27: Sidebar revitalization — show/hide-binary sidebar with drag resize, G-prefixed nav shortcuts, theme toggle, restructured user menu, mobile parity. See docs/superpowers/specs/2026-04-27-sidebar-revitalization-design.md and docs/superpowers/design-system/sidebar-and-panels.md.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): note sidebar revitalization changes"
```

---

### Task 24: Lint + type-check sweep

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: passes (or only pre-existing warnings).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | tail -40`
Expected: no new errors introduced by this work.

- [ ] **Step 3: Run full test suite**

Run: `npm test -- --run`
Expected: all new tests pass; existing tests unaffected. If existing tests fail because they referenced old `sidebarConfig` shape, update them in a follow-up task and add a commit.

- [ ] **Step 4: Manual QA checklist (mark each)**

  - [ ] Desktop, light: sidebar visible at default 280 px; nav items render with badges.
  - [ ] Desktop, light: drag handle resizes between 240–400 px; releasing < 200 px collapses.
  - [ ] Desktop, light: clicking handle without drag toggles collapse.
  - [ ] Desktop: `⌘B` toggles collapse from any focus state.
  - [ ] Desktop: `G` then `A` navigates to Articles; `G` then `T` to Screening (placeholder), etc.
  - [ ] Desktop: typing `g` in a text input does NOT start a sequence.
  - [ ] Desktop: `⌘K` opens project switcher dropdown.
  - [ ] Desktop: `⌘,` navigates to /settings.
  - [ ] Desktop: `⌘⇧Q` signs out.
  - [ ] Theme toggle cycles light → dark → system → light; persists across reload.
  - [ ] User menu shows Profile/Settings/Invite/Help/Sign out; placeholders show toast.
  - [ ] Mobile (`< lg`): hamburger in topbar opens Sheet with same sections; tapping closes Sheet and switches tab.
  - [ ] Settings page is reachable via the user menu and not present in the sidebar nav.
  - [ ] `prefers-reduced-motion`: width transitions are immediate.
  - [ ] Cross-tab: collapse in one tab updates the other (within ~1 s).

- [ ] **Step 5: Final commit if any QA fixes applied**

If you found and fixed a small UI issue during QA, commit it:

```bash
git add <files>
git commit -m "fix(layout): <short description>"
```

---

## Spec coverage map

| Spec section | Tasks |
|---|---|
| §3 Show/hide binary | 4 (ResizablePanel `collapsed`), 8 (persist), 15 (compose), 22 (topbar) |
| §3 Resizable + snap | 4 |
| §3 Discoverable shortcuts (KbdBadge) | 2, 9 |
| §3 ⌘B / G-letter / ⌘K / ⌘, / ⌘Q | 3, 17, 19 |
| §3 Persistence | 4, 5, 8 |
| §3 Motion / reduced-motion | 4 |
| §3 Density (Linear) | 9 (NavItem), design system §4 |
| §4 Design system doc | committed in spec phase |
| §5 Architecture | 1–22 |
| §6 sidebarConfig | 7 |
| §7 SidebarContext / Theme / shortcuts / resize | 5, 8, 3, 4 |
| §8 User menu | 12, 13 |
| §9 Mobile | 16 |
| §10 a11y (separator, current page, focus) | 4, 9 |
| §11 Tests | 1, 2, 3, 4, 5, 8, 9, 12 |
| §12 Migration order | task numbering |
| §13 Open questions | tracked in spec, no plan tasks |

## Notes on TDD coverage

Visual-only components (`SidebarSection`, `SidebarHeader`, `SidebarFooter`, `ComingSoonPanel`, `ProjectSidebar`, `MobileSidebar`) have no dedicated unit test. They compose tested primitives and are validated via the Phase 4 manual QA checklist. Adding them later is straightforward should regressions emerge.
