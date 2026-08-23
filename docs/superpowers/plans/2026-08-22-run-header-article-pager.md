---
status: approved
last_reviewed: 2026-08-22
owner: '@raphaelfh'
---

# Centered article pager for the run headers — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the extraction and quality-assessment run headers one shared,
centered previous/next article control with `J`/`K` bound on both screens, and
leave the touched files free of the dead code the change creates and the dead
code already in them.

**Architecture:** Three shared pieces replace two parallel implementations — a
restyled `RunHeader.Worklist` (two arrow buttons plus an inert counter), a
`useRunShortcuts` hook that becomes the single owner of the run-screen key
bindings, and `RunHeader.CommandPalette` mounted on QA so the searchable
article picker survives the popover's removal. Centering is a free-space split
in flex: both side tracks grow from a `0` basis, so the pager lands on the
geometric centre and slides left rather than overlapping when the right cluster
outgrows its share.

**Tech Stack:** TypeScript strict, React 19 + Vite, Tailwind container queries
(`@container/headerbar`), shadcn/Radix (`Tooltip`, `Popover`, `CommandDialog`),
Vitest + Testing Library, Playwright.

**Design spec:** `docs/superpowers/specs/2026-08-22-run-header-article-pager-design.md`

## Global Constraints

- **English only** for code, comments, commits, docs and copy keys.
- All user-facing text goes through `frontend/lib/copy/` — never hardcode
  strings in components (`.claude/rules/frontend.md`).
- **Every icon-only button exposes its description on hover** via the shadcn
  `Tooltip` with `TooltipTrigger asChild`, *and* carries an `aria-label`
  (`.claude/rules/frontend.md`). This is a rule, not a preference.
- **React Compiler runs with `panicThreshold: 'all_errors'`.** No `try/finally`
  and no `throw` inside `try` in a component or hook body — it fails the build
  *and* vitest. Effect cleanup goes through `return`.
- Frontend tooling runs from the **repo root**. Never `cd frontend && npm ...`.
  There is no `frontend/package.json`.
- `npm test` is watch mode and hangs agent sessions. Always `npm run test:run`.
- **Vitest does not typecheck.** The CI gate is `npm run typecheck`
  (`tsc -p tsconfig.app.json`). `tsconfig.app.json` has `noUnusedLocals` and
  `noUnusedParameters` on.
- Frontend-only: no backend change, no Alembic migration, no seed.
- Conventional commits. Branch off `dev`; PRs target `dev`.

---

### Task 1: Shared shortcut definitions and `useRunShortcuts`

Creates the single owner of the run-screen key bindings and makes the `?` help
panel render from the same source, so QA can no longer advertise a binding it
does not honour.

**Files:**

- Create: `frontend/lib/runs/shortcuts.ts`
- Create: `frontend/hooks/runs/useRunShortcuts.ts`
- Modify: `frontend/components/runs/header/Help.tsx` (replace the local
  `SHORTCUTS` constant)
- Test: `frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `RUN_SHORTCUTS: readonly RunShortcut[]` where
    `RunShortcut = { id: RunShortcutId; combo: string; copyKey: RunShortcutCopyKey }`
  - `ARTICLE_NEXT_KEY = 'J'` and `ARTICLE_PREV_KEY = 'K'` (display casing;
    matching is case-insensitive)
  - `useRunShortcuts(handlers: RunShortcutHandlers): void` with
    `RunShortcutHandlers = { articles: { id: string }[]; currentArticleId: string; onNavigateToArticle: (id: string) => void; onTogglePanel: () => void; onTogglePalette?: () => void; onClosePalette?: () => void }`

- [ ] **Step 1: Write the failing test**

Create `frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRunShortcuts, type RunShortcutHandlers } from '@/hooks/runs/useRunShortcuts';

const ARTICLES = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];

function Harness(props: Partial<RunShortcutHandlers>) {
  useRunShortcuts({
    articles: ARTICLES,
    currentArticleId: 'a2',
    onNavigateToArticle: vi.fn(),
    onTogglePanel: vi.fn(),
    ...props,
  });
  return <input data-testid="field" />;
}

describe('useRunShortcuts', () => {
  it('J navigates to the next article', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('j');
    expect(onNavigateToArticle).toHaveBeenCalledWith('a3');
  });

  it('K navigates to the previous article', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('k');
    expect(onNavigateToArticle).toHaveBeenCalledWith('a1');
  });

  it('is case-insensitive', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('J');
    expect(onNavigateToArticle).toHaveBeenCalledWith('a3');
  });

  it('does not navigate past the ends', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness currentArticleId="a1" onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('k');
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('ignores J/K while the user is typing in a field', async () => {
    const onNavigateToArticle = vi.fn();
    const { getByTestId } = render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    (getByTestId('field') as HTMLInputElement).focus();
    await userEvent.keyboard('j');
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('ignores J/K when a modifier is held', async () => {
    const onNavigateToArticle = vi.fn();
    render(<Harness onNavigateToArticle={onNavigateToArticle} />);
    await userEvent.keyboard('{Alt>}j{/Alt}');
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('is inert with fewer than two articles', async () => {
    const onNavigateToArticle = vi.fn();
    render(
      <Harness articles={[{ id: 'a1' }]} currentArticleId="a1" onNavigateToArticle={onNavigateToArticle} />,
    );
    await userEvent.keyboard('j');
    expect(onNavigateToArticle).not.toHaveBeenCalled();
  });

  it('backslash toggles the source panel', async () => {
    const onTogglePanel = vi.fn();
    render(<Harness onTogglePanel={onTogglePanel} />);
    await userEvent.keyboard('\\');
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });

  it('mod+K toggles the palette and Escape closes it', async () => {
    const onTogglePalette = vi.fn();
    const onClosePalette = vi.fn();
    render(<Harness onTogglePalette={onTogglePalette} onClosePalette={onClosePalette} />);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(onTogglePalette).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClosePalette).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx`

Expected: FAIL — `Failed to resolve import "@/hooks/runs/useRunShortcuts"`.

- [ ] **Step 3: Write the shared shortcut definitions**

Create `frontend/lib/runs/shortcuts.ts`:

```ts
/**
 * The run screens' keyboard bindings, in ONE place.
 *
 * `useRunShortcuts` binds from here and `RunHeader.Help` renders from here, so
 * a binding cannot exist on one screen while the help panel advertises
 * something else — which is exactly what happened before this file: the help
 * panel promised J/K on both run screens while only extraction bound them.
 */

export type RunShortcutId = 'palette' | 'nextPrev' | 'togglePdf' | 'sidebar' | 'esc';

export type RunShortcutCopyKey =
  | 'shortcutPalette'
  | 'shortcutNextPrev'
  | 'shortcutTogglePdf'
  | 'shortcutSidebar'
  | 'shortcutEsc';

export interface RunShortcut {
  id: RunShortcutId;
  /** Display combo, rendered by KbdBadge. */
  combo: string;
  /** Key in the `runs` copy namespace describing what the shortcut does. */
  copyKey: RunShortcutCopyKey;
}

/** Display casing. Matching is case-insensitive (see `useRunShortcuts`). */
export const ARTICLE_NEXT_KEY = 'J';
export const ARTICLE_PREV_KEY = 'K';

export const RUN_SHORTCUTS: readonly RunShortcut[] = [
  { id: 'palette', combo: '⌘K', copyKey: 'shortcutPalette' },
  { id: 'nextPrev', combo: `${ARTICLE_NEXT_KEY} / ${ARTICLE_PREV_KEY}`, copyKey: 'shortcutNextPrev' },
  { id: 'togglePdf', combo: '\\', copyKey: 'shortcutTogglePdf' },
  { id: 'sidebar', combo: '⌘B', copyKey: 'shortcutSidebar' },
  { id: 'esc', combo: 'Esc', copyKey: 'shortcutEsc' },
];
```

- [ ] **Step 4: Write the hook**

Create `frontend/hooks/runs/useRunShortcuts.ts`:

```ts
import { useEffect, useRef } from 'react';
import { ARTICLE_NEXT_KEY, ARTICLE_PREV_KEY } from '@/lib/runs/shortcuts';

export interface RunShortcutHandlers {
  /** The run's article worklist. Fewer than two makes J/K inert. */
  articles: { id: string }[];
  currentArticleId: string;
  onNavigateToArticle: (id: string) => void;
  /** "\" — the source (PDF) panel. */
  onTogglePanel: () => void;
  /** ⌘K / Ctrl+K. Omit on a screen with no palette. */
  onTogglePalette?: () => void;
  /** Escape. Omit on a screen with no palette. */
  onClosePalette?: () => void;
}

/**
 * The single owner of the run screens' keyboard bindings (extraction + QA).
 *
 * The listener registers ONCE (empty deps) and reads the changing callbacks
 * through a ref, so it does not re-bind on every render. Cleanup goes through
 * `return`, never `try/finally` — the React Compiler runs with
 * `panicThreshold: 'all_errors'` and rejects the latter in a hook body.
 *
 * ⌘B (sidebar) is deliberately absent: it is owned by RunWorkspaceShell, and
 * appears in `RUN_SHORTCUTS` only so the help panel can document it.
 */
export function useRunShortcuts(handlers: RunShortcutHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = ref.current;
      const target = e.target as HTMLElement | null;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        !!target?.isContentEditable;

      // ⌘K / Ctrl+K — toggle the command palette.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isEditing) return;
        e.preventDefault();
        h.onTogglePalette?.();
        return;
      }

      // Everything below is an unmodified single key, never while typing.
      if (e.metaKey || e.ctrlKey || e.altKey || isEditing) return;

      if (e.key === 'Escape') {
        h.onClosePalette?.();
        return;
      }
      if (e.key === '\\') {
        e.preventDefault();
        h.onTogglePanel();
        return;
      }

      if (h.articles.length < 2) return;
      const i = h.articles.findIndex((a) => a.id === h.currentArticleId);
      if (i < 0) return;
      const key = e.key.toLowerCase();
      if (key === ARTICLE_NEXT_KEY.toLowerCase()) {
        if (i < h.articles.length - 1) h.onNavigateToArticle(h.articles[i + 1].id);
        return;
      }
      if (key === ARTICLE_PREV_KEY.toLowerCase()) {
        if (i > 0) h.onNavigateToArticle(h.articles[i - 1].id);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx`

Expected: PASS, 9 tests.

- [ ] **Step 6: Point the help panel at the shared definitions**

In `frontend/components/runs/header/Help.tsx`, delete the local `SHORTCUTS`
constant and its inline type, add
`import { RUN_SHORTCUTS } from '@/lib/runs/shortcuts';`, and replace the list
body:

```tsx
      <ul className="mb-3 space-y-1">
        {RUN_SHORTCUTS.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('runs', s.copyKey)}</span>
            <KbdBadge keys={[s.combo]} />
          </li>
        ))}
      </ul>
```

- [ ] **Step 7: Run the header tests and the typecheck**

Run: `npm run test:run -- frontend/components/runs/header && npm run typecheck`

Expected: PASS. `Help.test.tsx` asserts on the rendered shortcut rows; the
rendered output is unchanged because `RUN_SHORTCUTS` reproduces the previous
list verbatim. If it fails on ordering, the constant's order is wrong — fix the
constant, not the test.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/runs/shortcuts.ts frontend/hooks/runs/useRunShortcuts.ts frontend/hooks/runs/__tests__/useRunShortcuts.test.tsx frontend/components/runs/header/Help.tsx
git commit -m "feat(runs): single owner for the run-screen keyboard shortcuts"
```

---

### Task 2: Restyle `RunHeader.Worklist` into two buttons plus an inert counter

**Files:**

- Modify: `frontend/components/runs/header/Worklist.tsx` (full rewrite)
- Modify: `frontend/components/runs/header/__tests__/Worklist.test.tsx`
- Modify: `frontend/lib/copy/runs.ts` (reword `worklistPositionLabel`)

**Interfaces:**

- Consumes: `ARTICLE_NEXT_KEY`, `ARTICLE_PREV_KEY` from Task 1.
- Produces: `Worklist` keeps its existing prop shape —
  `{ articles: { id: string; title: string }[]; currentId: string; onNavigate: (id: string) => void }` —
  and now returns `null` when `articles.length < 2` or `currentId` is not in
  the list, so callers no longer guard.

- [ ] **Step 1: Reword the accessible-name copy key**

In `frontend/lib/copy/runs.ts`, replace the `worklistPositionLabel` line. It is
now the `<nav>` accessible name, not a popover trigger's label, so the "open
list" clause is a lie:

```ts
  worklistPositionLabel: 'Article {{n}} of {{m}}',
```

Leave `worklistSearch` and `worklistPosition` in place for now — Task 8 deletes
them, after the compiler has proved nothing reads them.

- [ ] **Step 2: Rewrite the test file**

Replace the whole body of
`frontend/components/runs/header/__tests__/Worklist.test.tsx`. The popover is
gone, so the `scrollIntoView` stub and the two popover cases go with it; the
`TooltipProvider` wrapper is new (tooltips crash without it).

```tsx
// frontend/components/runs/header/__tests__/Worklist.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Worklist } from '@/components/runs/header/Worklist';

vi.mock('@/lib/copy', () => ({ t: (_n: string, k: string) => k }));

const articles = [
  { id: 'a1', title: 'Article One' },
  { id: 'a2', title: 'Article Two' },
  { id: 'a3', title: 'Article Three' },
];

function renderWorklist(props: Partial<React.ComponentProps<typeof Worklist>> = {}) {
  return render(
    <TooltipProvider>
      <Worklist articles={articles} currentId="a2" onNavigate={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

describe('RunHeader.Worklist', () => {
  it('renders exactly two buttons — the counter is not interactive', () => {
    renderWorklist();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows the position as text', () => {
    renderWorklist();
    expect(screen.getByRole('navigation')).toHaveTextContent('2 / 3');
  });

  it('names the nav with the position for assistive tech', () => {
    renderWorklist();
    expect(screen.getByRole('navigation', { name: 'worklistPositionLabel' })).toBeInTheDocument();
  });

  it('calls onNavigate with the previous article id', async () => {
    const onNavigate = vi.fn();
    renderWorklist({ onNavigate });
    await userEvent.click(screen.getByRole('button', { name: 'articlePrevious' }));
    expect(onNavigate).toHaveBeenCalledWith('a1');
  });

  it('calls onNavigate with the next article id', async () => {
    const onNavigate = vi.fn();
    renderWorklist({ onNavigate });
    await userEvent.click(screen.getByRole('button', { name: 'articleNext' }));
    expect(onNavigate).toHaveBeenCalledWith('a3');
  });

  it('disables prev at the first article without removing it', () => {
    renderWorklist({ currentId: 'a1' });
    expect(screen.getByRole('button', { name: 'articlePrevious' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'articleNext' })).not.toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('disables next at the last article without removing it', () => {
    renderWorklist({ currentId: 'a3' });
    expect(screen.getByRole('button', { name: 'articleNext' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'articlePrevious' })).not.toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('renders nothing for a single-article worklist', () => {
    const { container } = render(
      <TooltipProvider>
        <Worklist articles={[articles[0]]} currentId="a1" onNavigate={vi.fn()} />
      </TooltipProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the current article is not in the worklist', () => {
    const { container } = render(
      <TooltipProvider>
        <Worklist articles={articles} currentId="missing" onNavigate={vi.fn()} />
      </TooltipProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/Worklist.test.tsx`

Expected: FAIL — the current component renders three buttons (the counter is
still a `PopoverTrigger`) and has no `navigation` role.

- [ ] **Step 4: Rewrite the component**

Replace the whole of `frontend/components/runs/header/Worklist.tsx`:

```tsx
/**
 * RunHeader.Worklist — the centered article pager.
 *
 * Two arrow buttons with an INERT counter between them. The searchable
 * article picker that used to hang off the counter now lives in the ⌘K command
 * palette (`RunHeader.CommandPalette`), which both run screens mount.
 *
 * The arrows are DISABLED at the ends rather than hidden: hiding one changes
 * the block's width and would displace the header's centre by half an arrow.
 *
 * TODO(plan-future): per-article status is not shown — the `articles` prop
 * carries only id + title, and a batch runs endpoint would be needed. The list
 * this refers to now lives in CommandPalette.tsx.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HeaderIconButton } from '@/components/layout/HeaderIconButton';
import { KbdBadge } from '@/components/ui/kbd-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/copy';
import { ARTICLE_NEXT_KEY, ARTICLE_PREV_KEY } from '@/lib/runs/shortcuts';

// =================== TYPES ===================

export interface WorklistProps {
  articles: { id: string; title: string }[];
  currentId: string;
  onNavigate: (id: string) => void;
}

// =================== COMPONENT ===================

export function Worklist({ articles, currentId, onNavigate }: WorklistProps) {
  const idx = articles.findIndex((a) => a.id === currentId);
  // Self-guarding: callers used to wrap this in `articles.length > 1 &&`, and
  // only one of the two run screens remembered to.
  if (articles.length < 2 || idx < 0) return null;

  const hasPrev = idx > 0;
  const hasNext = idx < articles.length - 1;

  const total = String(articles.length);
  // Pad with FIGURE SPACE (U+2007), which is exactly one digit wide. With
  // `tabular-nums` this keeps "9 / 12" and "10 / 12" the same width, so the
  // pager cannot shift the header's centre as you page through. Written as an
  // escape on purpose — a literal U+2007 in source is invisible to the next
  // reader.
  const current = String(idx + 1).padStart(total.length, '\u2007');

  const positionLabel = t('runs', 'worklistPositionLabel')
    .replace('{{n}}', String(idx + 1))
    .replace('{{m}}', total);

  return (
    <nav className="flex shrink-0 items-center gap-0.5" aria-label={positionLabel}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HeaderIconButton
            aria-label={t('runs', 'articlePrevious')}
            disabled={!hasPrev}
            onClick={() => hasPrev && onNavigate(articles[idx - 1].id)}
          >
            <ChevronLeft strokeWidth={1.5} aria-hidden="true" />
          </HeaderIconButton>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          {t('runs', 'articlePrevious')}
          <KbdBadge keys={[ARTICLE_PREV_KEY]} />
        </TooltipContent>
      </Tooltip>

      {/* Inert on purpose — the position is announced by the <nav> label. */}
      <span
        className="whitespace-pre text-[11px] tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        {current} / {total}
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <HeaderIconButton
            aria-label={t('runs', 'articleNext')}
            disabled={!hasNext}
            onClick={() => hasNext && onNavigate(articles[idx + 1].id)}
          >
            <ChevronRight strokeWidth={1.5} aria-hidden="true" />
          </HeaderIconButton>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          {t('runs', 'articleNext')}
          <KbdBadge keys={[ARTICLE_NEXT_KEY]} />
        </TooltipContent>
      </Tooltip>
    </nav>
  );
}
```

Note `whitespace-pre` on the counter: without it, the figure-space padding is
collapsed by HTML whitespace handling and the width stabilisation is lost.

`HeaderIconButton` already carries the 44px touch target via its `header-icon`
size, so the hand-rolled `[@media(pointer:coarse)]` classes the old component
had are no longer needed.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/Worklist.test.tsx`

Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/runs/header/Worklist.tsx frontend/components/runs/header/__tests__/Worklist.test.tsx frontend/lib/copy/runs.ts
git commit -m "feat(runs): two-button article pager with an inert counter"
```

---

### Task 3: Centre the middle track

**Files:**

- Modify: `frontend/components/runs/header/RunHeader.tsx` (the `Left`,
  `Center`, `Right` track components and the responsive-cascade comment)
- Test: `frontend/components/runs/header/__tests__/RunHeader.shell.test.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces: `RunHeader.Center` is now the pager's track. Its rendered element
  keeps `data-testid="run-header-center"` (added in this task) so the harness
  in Task 6 and the shell test can measure it.

- [ ] **Step 1: Write the failing test**

Append to `frontend/components/runs/header/__tests__/RunHeader.shell.test.tsx`
(inside the existing top-level `describe`):

```tsx
  it('gives both side tracks an equal share so the centre track is centred', () => {
    render(
      <RunHeader value={base}>
        <RunHeader.Left>left</RunHeader.Left>
        <RunHeader.Center>centre</RunHeader.Center>
        <RunHeader.Right>right</RunHeader.Right>
      </RunHeader>,
    );
    const left = screen.getByText('left');
    const centre = screen.getByTestId('run-header-center');
    const right = screen.getByText('right').closest('div')!;

    // Both side tracks grow from a 0 basis with weight 1 — that is what puts
    // the centre track on the geometric centre.
    expect(left).toHaveClass('flex-1', 'min-w-0');
    expect(right).toHaveClass('flex-1', 'justify-end');
    // Right must NOT get min-w-0: its automatic min-content floor is what
    // keeps PrimaryAction from ever being clipped.
    expect(right).not.toHaveClass('min-w-0');
    // ml-auto is gone — it would pin Right and break the even split.
    expect(right).not.toHaveClass('ml-auto');
    expect(centre).toHaveClass('shrink-0');
  });
```

The file already defines the `base: RunHeaderValue` constant at module scope —
reuse it, do not add a second one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- frontend/components/runs/header/__tests__/RunHeader.shell.test.tsx`

Expected: FAIL — `Left` still has `shrink` not `flex-1`, `Right` still has
`ml-auto`, and there is no `run-header-center` testid.

- [ ] **Step 3: Change the tracks**

In `frontend/components/runs/header/RunHeader.tsx`, replace the three track
components:

```tsx
function Left({ children }: { children: ReactNode }) {
  // Identity track. Grows from a 0 basis with weight 1 (see Center), and keeps
  // `overflow-hidden` ONLY as an anti-overlap backstop: its leaves are
  // `whitespace-nowrap`, so without it a shrunk track would paint its text on
  // top of the next slot. The article title is the flex cushion — it truncates
  // and never drops.
  return <div className={cn('flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden @[48rem]/headerbar:gap-3')}>{children}</div>;
}
function Center({ children }: { children: ReactNode }) {
  // Navigation track (the article pager). `shrink-0` so it is never clipped.
  // Left and Right both have `flex-basis: 0` and `flex-grow: 1`, so the free
  // space either side of this track is split evenly — that is what centres it.
  return <div data-testid="run-header-center" className={cn('flex shrink-0 items-center gap-2')}>{children}</div>;
}
function Right({ children }: { children: ReactNode }) {
  // Controls + status track. Grows symmetrically with Left, `justify-end` to
  // pin its content right. Deliberately WITHOUT `min-w-0`: the automatic
  // `min-width: auto` floors it at min-content, which is what guarantees
  // PrimaryAction is never clipped. When the cluster genuinely outgrows its
  // half, it pushes and the pager slides left rather than overlapping.
  return <div className={cn('flex flex-1 items-center justify-end gap-1 @[48rem]/headerbar:gap-2')}>{children}</div>;
}
```

- [ ] **Step 4: Replace the responsive-cascade comment**

Still in `RunHeader.tsx`, replace the block comment above `Left` with the
cascade from spec §6.3:

```tsx
/**
 * LAYOUT — Identity | Navigation | Controls & Status.
 *
 * Centring is a free-space split: `Left` and `Right` are both
 * `flex: 1 1 0%`, so the space either side of the `shrink-0` `Center` track is
 * even and the article pager lands on the geometric centre. `Right` has no
 * `min-w-0`, so it floors at min-content: when the control cluster genuinely
 * outgrows its half it pushes, and the pager slides left. Nothing here is
 * absolutely positioned, so overlap is impossible by construction.
 *
 * RESPONSIVE CASCADE, by header container width:
 *
 *   >= 64rem  everything visible; pager on the exact centre.
 *   48-64rem  RunStatus reviewer avatars drop (RunStatus.tsx) — they can only
 *             hide, never shrink, so they fold first in the packed consensus
 *             config.
 *   42-48rem  Breadcrumb back arrow drops (Breadcrumb.tsx). The stage chip
 *             folds to its dot < 58rem but NEVER drops — it is the status
 *             anchor.
 *   < 42rem   The pager stays INTACT — it is the highest-priority navigation.
 *             The article title truncates; it is the designated flex cushion.
 *
 *   Single-article worklist: Worklist renders null and the centre is empty.
 */
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- frontend/components/runs/header && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/runs/header/RunHeader.tsx frontend/components/runs/header/__tests__/RunHeader.shell.test.tsx
git commit -m "feat(runs): centre the run-header navigation track"
```

---

### Task 4: Adopt the pager and the shortcut hook in the extraction header

**Files:**

- Modify: `frontend/components/extraction/ExtractionHeader.tsx`
- Test: `frontend/components/runs/header/__tests__/RunHeader.test.tsx` (only if
  it asserts on the old slot placement — check, do not assume)

**Interfaces:**

- Consumes: `useRunShortcuts` (Task 1), the self-guarding `Worklist` (Task 2),
  the centred `Center` track (Task 3).
- Produces: no new exports. `ExtractionHeaderProps` is unchanged in this task —
  Task 8 prunes it.

- [ ] **Step 1: Replace the hand-rolled keydown effect**

Delete the `kbdRef` declaration, the effect that syncs it, and the whole
`useEffect` that registers `handleKeyDown` (roughly the block from
`const kbdRef = useRef({...})` to the end of that effect). Replace with:

```tsx
  useRunShortcuts({
    articles,
    currentArticleId,
    onNavigateToArticle,
    onTogglePanel: onTogglePDF,
    onTogglePalette: () => setPaletteOpen((prev) => !prev),
    onClosePalette: () => setPaletteOpen(false),
  });
```

Update the imports: drop `useEffect` and `useRef` from the `react` import if
nothing else in the file uses them (the compiler will tell you — `noUnusedLocals`
is on), and add:

```tsx
import { useRunShortcuts } from '@/hooks/runs/useRunShortcuts';
```

- [ ] **Step 2: Move the pager into the centre and RunStatus to the right**

In the JSX, delete the standalone pager block that sits between
`</RunHeader.Left>` and `<RunHeader.Center>` — including its
`{articles.length > 1 && (...)}` guard and the comment above it — and make the
`Center` track hold the pager:

```tsx
          <RunHeader.Center>
            <RunHeader.Worklist
              articles={articles}
              currentId={currentArticleId}
              onNavigate={onNavigateToArticle}
            />
          </RunHeader.Center>

          <RunHeader.Right>
            {stage != null && <RunHeader.RunStatus open={statusOpen} onOpenChange={setStatusOpen} />}
            {hasComparison && (
```

The rest of the `Right` track is unchanged.

- [ ] **Step 3: Run the extraction and header tests**

Run: `npm run test:run -- frontend/components/extraction frontend/components/runs/header && npm run typecheck`

Expected: PASS. If a test asserts the pager is a sibling of `RunHeader.Left`,
update the test — the placement change is the intent of this task. If a test
asserts on `RunStatus` being inside the centre track, likewise.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/extraction/ExtractionHeader.tsx frontend/components/runs/header/__tests__
git commit -m "feat(extraction): centre the article pager and share the shortcut hook"
```

---

### Task 5: Bring QA to parity — pager, palette and shortcuts

This is where the user-visible gap closes: QA gains previous/next navigation,
`J`/`K`, and a `⌘K` palette it never had.

**Files:**

- Modify: `frontend/hooks/qa/useQAWorklist.ts` (carry `title`)
- Modify: `frontend/pages/QualityAssessmentFullScreen.tsx`
- Test: `frontend/hooks/qa/__tests__/useQAWorklist.test.ts` (create if the
  directory has no test for this hook yet)

**Interfaces:**

- Consumes: `useRunShortcuts` (Task 1), `Worklist` (Task 2), the centred
  `Center` track (Task 3).
- Produces: `useQAWorklist(projectId: string | undefined): { id: string; title: string }[]`

- [ ] **Step 1: Write the failing hook test**

Create `frontend/hooks/qa/__tests__/useQAWorklist.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchProjectArticles = vi.fn();
vi.mock('@/services/articlesService', () => ({
  fetchProjectArticles: (...args: unknown[]) => fetchProjectArticles(...args),
}));

import { useQAWorklist } from '@/hooks/qa/useQAWorklist';

describe('useQAWorklist', () => {
  beforeEach(() => {
    fetchProjectArticles.mockReset();
  });

  it('carries the article title through, not just the id', async () => {
    fetchProjectArticles.mockResolvedValue({
      ok: true,
      data: [{ id: 'a1', title: 'First' }, { id: 'a2', title: 'Second' }],
    });
    const { result } = renderHook(() => useQAWorklist('p1'));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0]).toEqual({ id: 'a1', title: 'First' });
  });

  it('resolves to an empty list on a failed read without throwing', async () => {
    fetchProjectArticles.mockResolvedValue({ ok: false, error: { message: 'boom' } });
    const { result } = renderHook(() => useQAWorklist('p1'));
    await waitFor(() => expect(fetchProjectArticles).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- frontend/hooks/qa/__tests__/useQAWorklist.test.ts`

Expected: FAIL on the first case — the hook's state type is `{ id: string }[]`
and the title is dropped by the type, so the deep-equal assertion fails.

- [ ] **Step 3: Widen the hook**

In `frontend/hooks/qa/useQAWorklist.ts`, change both the state type and the
return type, and update the docblock's last paragraph:

```ts
export interface QAWorklistItem {
  id: string;
  title: string;
}

export function useQAWorklist(projectId: string | undefined): QAWorklistItem[] {
  const [articles, setArticles] = useState<QAWorklistItem[]>([]);
```

The body is otherwise unchanged: `fetchProjectArticles` already selects
`title`, the hook was only discarding it via the narrower type.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- frontend/hooks/qa/__tests__/useQAWorklist.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Add a shared route builder and the palette state in the QA page**

In `frontend/pages/QualityAssessmentFullScreen.tsx`, just above
`goToNextArticle`, add the route builder and reuse it in both places:

```tsx
  // ONE place that knows the QA route shape. The :templateId segment is
  // carried through verbatim — it may name either a project or a global
  // template (see resolveQATemplateKind above).
  const qaArticleRoute = (targetArticleId: string) =>
    `/projects/${projectId}/articles/${targetArticleId}/quality-assessment/${templateId}`;

  const goToArticle = (targetArticleId: string) => navigate(qaArticleRoute(targetArticleId));
```

and rewrite `goToNextArticle` to use it:

```tsx
  const goToNextArticle = () => {
    const nextId = nextArticleTarget(worklist, articleId ?? '');
    navigate(nextId ? qaArticleRoute(nextId) : `/projects/${projectId}?tab=quality`);
  };
```

Add the palette + status state next to the other `useState` calls:

```tsx
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
```

- [ ] **Step 6: Replace the hand-rolled keydown effect**

Delete the `togglePdfRef` declaration, the effect that syncs it, the `onKey`
effect, and the stale comment above them (`// "\" toggles the source (PDF)
panel. No J/K — QA has a single article.`). Replace with:

```tsx
  useRunShortcuts({
    articles: worklist,
    currentArticleId: articleId ?? '',
    onNavigateToArticle: goToArticle,
    onTogglePanel: pdfPanelState.toggle,
    onTogglePalette: () => setPaletteOpen((prev) => !prev),
    onClosePalette: () => setPaletteOpen(false),
  });
```

Add `import { useRunShortcuts } from '@/hooks/runs/useRunShortcuts';`.

- [ ] **Step 7: Mount the pager, move RunStatus, mount the palette**

Replace the `Center` track and the head of the `Right` track:

```tsx
        <RunHeader.Center>
          <RunHeader.Worklist
            articles={worklist}
            currentId={articleId ?? ''}
            onNavigate={goToArticle}
          />
        </RunHeader.Center>

        <RunHeader.Right>
          {runStage != null && <RunHeader.RunStatus open={statusOpen} onOpenChange={setStatusOpen} />}
          {/* D6: no dead toggle during consensus (the resolve table always renders there). */}
          {canCompare && !inConsensusStage && (
```

Then, immediately after the closing `</RunHeader>` inside the `header` value,
wrap it so the palette is a sibling of the header (it must render above it):

```tsx
  const header = (
    <>
      <RunHeader value={{ /* unchanged */ }}>
        {/* unchanged children */}
      </RunHeader>

      <RunHeader.CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={paletteActions}
        articles={worklist.length > 1 ? worklist : undefined}
        onNavigate={worklist.length > 1 ? goToArticle : undefined}
      />
    </>
  );
```

and build `paletteActions` above `const header = (`, mirroring the extraction
screen so both palettes offer the same vocabulary:

```tsx
  const paletteActions: { id: string; label: string; run: () => void }[] = [];
  if (canCompare && !inConsensusStage) {
    paletteActions.push({
      id: 'compare',
      label: t('runs', 'compareToggleLabel'),
      run: () => setViewMode((m) => (m === 'assess' ? 'compare' : 'assess')),
    });
  }
  paletteActions.push({
    id: 'panel',
    label: t('runs', 'togglePanel'),
    run: () => pdfPanelState.toggle(),
  });
  if (canReveal && onReveal) {
    paletteActions.push({ id: 'reveal', label: t('runs', 'reveal'), run: () => onReveal() });
  }
  if (runStage != null) {
    paletteActions.push({
      id: 'status',
      label: t('runs', 'viewRunStatus'),
      run: () => setStatusOpen(true),
    });
  }
```

- [ ] **Step 8: Run the QA tests and the typecheck**

Run: `npm run test:run -- frontend/pages frontend/hooks/qa && npm run typecheck`

Expected: PASS. Per the #475 postmortem, QA screen tests are order-sensitive:
if a later `describe` fails on a missing `apiClient` implementation, a
`vi.restoreAllMocks()` in an earlier `describe` wiped the module factory — make
the later `describe` self-contained rather than reordering. The test harness
also needs the app-level `TooltipProvider` mirrored, which the new pager's
tooltips now depend on.

- [ ] **Step 9: Commit**

```bash
git add frontend/hooks/qa frontend/pages/QualityAssessmentFullScreen.tsx
git commit -m "feat(qa): article pager, command palette and J/K parity with extraction"
```

---

### Task 6: Prove the geometry by measurement

**This is the gate.** Unit tests do not measure layout — that blind spot is
exactly how the #450 starvation bug reached production, where the identity
track got 270px at 1280px and the pager, title and stage rail were all clipped.

**Files:**

- Create (throwaway, **never committed**):
  `frontend/pages/__dev/HeaderHarness.tsx` and a DEV-only route for it
- Modify: nothing permanent

- [ ] **Step 1: Add the throwaway harness route**

Create a page that mounts the real `ExtractionHeader` with mock props inside
fixed-width wrappers. The header keys off its own `@container/headerbar`, so
fixed-width wrappers exercise the whole cascade without auth or viewport
resizing:

```tsx
// frontend/pages/__dev/HeaderHarness.tsx — DELETE BEFORE COMMITTING
const WIDTHS = [1280, 1024, 900, 768, 700, 560, 480, 375];
const ARTICLES = Array.from({ length: 12 }, (_, i) => ({
  id: `a${i + 1}`,
  title: `A deliberately long article title to exercise truncation ${i + 1}`,
}));

export default function HeaderHarness() {
  return (
    <div className="space-y-6 p-4">
      {WIDTHS.map((w) => (
        <div key={w} data-harness-width={w} style={{ width: w }} className="border">
          <ExtractionHeader
            articleTitle={ARTICLES[3].title}
            onBack={() => {}}
            articles={ARTICLES}
            currentArticleId="a4"
            onNavigateToArticle={() => {}}
            completedFields={4}
            totalFields={12}
            completionPercentage={33}
            showPDF
            onTogglePDF={() => {}}
            viewMode="extract"
            onViewModeChange={() => {}}
            hasComparison
            isComplete={false}
            stage="consensus"
            userRole="manager"
            reviewers={{ count: 3, required: 3, divergent: 2 }}
            canReveal
            onReveal={() => {}}
          />
        </div>
      ))}
    </div>
  );
}
```

Register it in `frontend/App.tsx`. Add the lazy import next to the others
(around line 40) and the route next to the extraction route (around line 111).
It is unauthenticated on purpose — mock props mean no session is needed, which
is the whole reason this harness exists (see
`reference_run_view_visual_verification_harness`: the local backend rejects the
browser's authenticated preflight, so no real run view is reachable):

```tsx
const HeaderHarness = lazy(() => import("./pages/__dev/HeaderHarness"));
```

```tsx
                  {import.meta.env.DEV && (
                    <Route path="/__dev/header-harness" element={<HeaderHarness />} />
                  )}
```

- [ ] **Step 2: Start the preview and open the harness**

Use `preview_start` with the project's dev-server launch config, then navigate
to `/__dev/header-harness`. Do not run the dev server through Bash.

- [ ] **Step 3: Measure**

Evaluate in the page and record the result:

```js
[...document.querySelectorAll('[data-harness-width]')].map((row) => {
  const header = row.querySelector('header');
  const centre = row.querySelector('[data-testid="run-header-center"]');
  const tracks = [...header.querySelectorAll(':scope > div > div')];
  const h = header.getBoundingClientRect();
  const c = centre.getBoundingClientRect();
  const rects = tracks.map((t) => t.getBoundingClientRect());
  const overlaps = rects.flatMap((a, i) =>
    rects.slice(i + 1).filter((b) => a.right > b.left + 0.5 && b.right > a.left + 0.5),
  );
  return {
    width: row.dataset.harnessWidth,
    headerCentre: h.left + h.width / 2,
    pagerCentre: c.left + c.width / 2,
    drift: Math.abs(h.left + h.width / 2 - (c.left + c.width / 2)),
    overlaps: overlaps.length,
    titleWidth: header.querySelector('nav[aria-label="breadcrumb"] span')?.getBoundingClientRect().width,
  };
});
```

- [ ] **Step 4: Judge the numbers against the spec**

Three assertions, at **every** width:

1. `overlaps === 0`. Any overlap is a hard failure.
2. `drift` is ~0 while the right cluster fits its share, and non-zero drift
   only ever moves the pager **left**. Rightward drift means the split is
   wrong.
3. The `PrimaryAction` rect is fully inside the header rect.

Additionally record `titleWidth`. Spec §6.2 names the failure mode to watch
for: if the title is crushed at a real width (the #475 measurement found ~21px
at 900px in the packed consensus config), **do not tune magic numbers** — fall
back to approach B from the brainstorm (absolute centring above `@[64rem]`,
flow below) and re-run this task.

- [ ] **Step 5: Screenshot 1280 / 768 / 375 and report the numbers to the user**

Report the actual measured table. Do not claim the layout is correct without
pasting the numbers.

- [ ] **Step 6: Delete the harness**

```bash
git status --short   # must show NO __dev files
```

Remove `frontend/pages/__dev/HeaderHarness.tsx`, its import, and its route
entry. The harness is never committed. Verify with `git status --short` that
nothing under `__dev/` remains.

---

### Task 7: Characterise autosave across a keyboard article change

Article navigation is a **route-param** change on the same route element, so
the `useAutoSaveProposals` unmount flush does not obviously fire. Making
navigation keyboard-cheap on a second screen widens the exposure. This task
finds out what actually happens; per spec §3, fixing it is out of scope.

**Files:**

- Create: `frontend/e2e/flows/extraction-article-pager.ui.e2e.ts`

- [ ] **Step 1: Write the test**

Create `frontend/e2e/flows/extraction-article-pager.ui.e2e.ts`. Note the naming:
this suite uses `*.e2e.ts` under `frontend/e2e/flows/`, **not** `*.spec.ts`.

```ts
/**
 * Characterisation test: does a pending (un-debounced) edit survive a keyboard
 * article change?
 *
 * Article navigation is a route-PARAM change on the same route element, so the
 * `useAutoSaveProposals` unmount flush does not obviously fire. The sibling
 * `extraction-edit.ui.e2e.ts` deliberately waits out the 3s debounce; this one
 * deliberately does not.
 */

import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const REQUIRED = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID", "E2E_ARTICLE_ID"];

test.describe.configure({ mode: "serial" });

test.describe("Extraction article pager", () => {
  test("J moves to the next article and a pending edit is not lost", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);

    // The pager renders null on a single-article project — that is a valid
    // fixture state, not a failure.
    const nextButton = page.getByRole("button", { name: /next article/i });
    await expect(page.getByRole("button", { name: /^back$/i }).first()).toBeVisible({ timeout: 15000 });
    const pagerCount = await nextButton.count();
    test.skip(pagerCount === 0, "Project has a single article — no pager to exercise");
    test.skip(await nextButton.isDisabled(), "Already on the last article");

    // Same field-discovery approach as extraction-edit.ui.e2e.ts.
    const textFields = page.locator("form input[type='text']");
    const fieldCount = await textFields.count();
    test.skip(fieldCount === 0, "No free-text field on the page to probe with");

    const probe = `pager-probe-${Date.now()}`;
    const field = textFields.first();
    await field.fill(probe);

    // Deliberately do NOT wait out the 3s autosave debounce.
    const urlBefore = page.url();
    await page.keyboard.press("j");
    await expect.poll(() => page.url(), { timeout: 10000 }).not.toBe(urlBefore);
    expect(page.url()).toContain("/extraction/");

    // Back to the original article: the probe must still be there.
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);
    await expect(page.getByRole("button", { name: /^back$/i }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator("form input[type='text']").first()).toHaveValue(probe, { timeout: 15000 });
  });

  test("the pager renders two buttons and an inert counter", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);
    await expect(page.getByRole("button", { name: /^back$/i }).first()).toBeVisible({ timeout: 15000 });

    const pager = page.getByRole("navigation", { name: /article \d+ of \d+/i });
    test.skip((await pager.count()) === 0, "Project has a single article — no pager to exercise");
    await expect(pager.getByRole("button")).toHaveCount(2);
    await expect(pager).toContainText(/\d+\s*\/\s*\d+/);
  });
});
```

The `E2E_*` env carries one article id, so on a single-article fixture project
both tests skip rather than fail. If you want them to actually run, add a second
article to the fixture project first — do not weaken the assertions to make a
one-article project pass.

- [ ] **Step 2: Run it**

Run: `npm run test:e2e:local -- extraction-article-pager`

(The Playwright filter matches on path, so the `.ui.e2e.ts` suffix is fine.)

The local E2E suite is stateful and reruns lie — a second run fails a
*different* test each time. Run `make db-fresh`, then **one** run.

- [ ] **Step 3: Record the outcome**

- **Passes:** commit the test as a regression guard.
- **Fails:** that is a pre-existing defect, not something this change
  introduced. Commit the test with `test.fail()` and an explanatory comment
  naming the mechanism (route-param change does not unmount, so the
  `useAutoSaveProposals` cleanup does not run), and report it to the user as a
  follow-up. Do **not** widen this plan to fix it.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/flows/extraction-article-pager.ui.e2e.ts
git commit -m "test(e2e): characterise autosave across a keyboard article change"
```

---

### Task 8: Dead-code cleanup

Spec §10. Runs **last**, in its **own commit**, so it can be reverted without
losing the feature. Scoped to the files this change already touches.

**Files:**

- Modify: `frontend/lib/copy/runs.ts`
- Modify: `frontend/components/extraction/ExtractionHeader.tsx`
- Modify: `frontend/pages/ExtractionFullScreen.tsx`
- Modify: `frontend/test/extractionReveal.test.tsx`
- Modify: `frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx`
- Modify: `frontend/components/runs/header/CommandPalette.tsx` (receives the
  relocated `TODO(plan-future)` — already moved in Task 2's docblock; add it
  here if Task 2 left it only in `Worklist.tsx`)

- [ ] **Step 1: Delete the copy keys that are now dead**

In `frontend/lib/copy/runs.ts`, delete three lines and the now-orphaned
`// Worklist popover` comment:

- `worklistSearch: 'Go to article…',` — was the removed popover's
  `CommandInput` placeholder. The palette ships `commandPlaceholder` and
  `commandGoToArticle`.
- `worklistPosition: '{{n}} of {{m}}',` — its only consumer was the popover's
  position line.
- `keyboardShortcuts: 'Keyboard shortcuts',` — referenced from nowhere in
  `frontend/`; dead before this change, deleted because the same file is being
  edited.

- [ ] **Step 2: Verify nothing reads them**

```bash
grep -rn "worklistSearch\|worklistPosition\b\|keyboardShortcuts" frontend
```

Expected: no output. `worklistPositionLabel` must survive — the `\b` in the
pattern is what keeps the grep from matching it.

- [ ] **Step 3: Delete the 11 never-referenced `ExtractionHeaderProps`**

Delete these from the `ExtractionHeaderProps` interface in
`frontend/components/extraction/ExtractionHeader.tsx`. All 11 were verified on
2026-08-22 to have zero references in the component body:

`onFinalize`, `finalizeLabel`, `isComplete`, `hasUnsavedChanges`, `templateId`,
`templateName`, `runId`, `aiSuggestions`, `onExtractionComplete`,
`onRefreshInstances`, `onExtractionStateChange`.

This includes the `@deprecated … full removal is HITL Phase 3` pair
(`onFinalize`, `finalizeLabel`). Removing them from this header **is** that
removal for this surface. It does not touch the unrelated, live `onFinalize`
on `ConsensusResolutionPanel` — leave that alone.

- [ ] **Step 4: Delete the matching call-site attributes**

In `frontend/pages/ExtractionFullScreen.tsx`, delete the ten JSX attributes on
`<ExtractionHeader …>` that pass the props above (`finalizeLabel` is not
passed). Then delete the corresponding keys from the two test fixtures in
`frontend/test/extractionReveal.test.tsx` and
`frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx`.

- [ ] **Step 5: Let the compiler terminate the cascade**

```bash
npm run typecheck
```

`noUnusedLocals` is on, so it reports anything in `ExtractionFullScreen.tsx`
that just became unused. Delete what it names, re-run, repeat until quiet.

**Stop there.** Do not follow a symbol out into unrelated page logic by hand.
If something looks dead but the compiler does not say so, flag it to the user
and leave it — the project rule is *flag unrelated dead code, don't delete it*.

- [ ] **Step 6: Fix the two comments that are now false**

A false comment is worse than dead code: it actively misleads.

- `frontend/pages/QualityAssessmentFullScreen.tsx` — if Task 5 step 6 left it
  behind, delete `// "\" toggles the source (PDF) panel. No J/K — QA has a
  single article.`
- `frontend/components/runs/header/RunHeader.tsx` — Task 3 step 4 already
  replaced the cascade block. Confirm no stray reference to the pager's "own
  protected `shrink-0` slot" survives:

```bash
grep -rn "protected" frontend/components/runs/header/RunHeader.tsx
```

Expected: no output.

- [ ] **Step 7: Full gate**

```bash
npm run lint && npm run typecheck && npm run test:run
```

Expected: all green. The Task 6 harness measurement does **not** need re-running
— nothing in this task changes rendered geometry. If a deletion changes
behaviour, that is proof it was not dead: revert that one deletion and keep the
rest.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(runs): drop dead header props, copy keys and stale comments"
```

---

## Done criteria

- Both run screens show the same centred two-button pager with an inert
  counter, and both honour `J`/`K`.
- The `?` panel and the bound keys come from one constant.
- QA has a `⌘K` palette with the searchable article list.
- Task 6's measured table is reported with real numbers: zero overlaps and no
  clipped `PrimaryAction` at 1280 / 1024 / 900 / 768 / 700 / 560 / 480 / 375.
- Task 7's outcome is reported — passing guard, or a named pre-existing defect.
- `npm run lint`, `npm run typecheck` and `npm run test:run` are green, with
  output pasted rather than asserted.
