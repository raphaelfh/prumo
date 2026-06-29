# AI-extraction popup UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two AI-suggestion popups (details + history, shared by Extraction and QA) opaque/readable, responsive, with an easy "click-the-passage" locate, and fix the broken history popover.

**Architecture:** Frontend-only. (1) Make all floating Radix surfaces (popover, dropdown) solid instead of frosted. (2) Add a thin shared `AIPopoverShell` for consistent header + sizing. (3) Details popover: solid evidence block + the cited passage becomes the locate target (keeps the popup open, marks the citation active). (4) History popover: real run identity, no truncation, no debug logs, content-aware height.

**Tech Stack:** React 19 + TS strict, Radix popover/dropdown, Tailwind v3 + shadcn, Vitest + Testing Library. Copy via `frontend/lib/copy/`.

## Global Constraints

- English only for code, comments, copy keys (CLAUDE.md hard rule).
- All user-facing text through `frontend/lib/copy/` — never hardcode strings.
- Data path unchanged (no service/hook/network changes). No backend, schema, migration.
- React Compiler `panicThreshold: all_errors`: no `try/finally` / `throw` in component/hook bodies.
- Tests run from repo root: `npm run test:run` (never `npm test` — watch mode hangs).
- **Unit-test copy convention:** the existing tests `vi.mock('@/lib/copy', () => ({ t: (_ns, key) => key }))` — so `t('extraction','X')` renders the **key** `X`, not the English string. New/updated tests MUST follow this and assert on the **key**, not English copy.
- **Locate hook mock:** mock `@/hooks/extraction/useReaderLocate` (its real path) as the existing details test does — NOT `@/pdf-viewer/core`. (`@/pdf-viewer/core` exports `ViewerProvider`, not the hook; its import chain is jsdom-safe if a test ever needs the real store, but mocking the hook is simpler and is the established pattern.)
- `cn()` merge order matters; every interactive element keeps a visible focus state.

---

### Task 1: Solid floating surfaces (popover + dropdown)

**Files:**
- Modify: `frontend/components/ui/popover.tsx:21`
- Modify: `frontend/components/ui/dropdown-menu.tsx:65`
- Modify: `frontend/index.css:220-240` (remove `.frosted-overlay` def + its two fallback rules; keep `.frosted-header`)
- Modify (test): `frontend/components/ui/overlay-frosted.test.tsx`

**Interfaces:**
- Produces: `PopoverContent` / `DropdownMenuContent` render an opaque `bg-popover` surface (no `frosted-overlay`, no `backdrop-filter`).

- [ ] **Step 1: Rewrite the surface test to assert solid, not frosted**

Replace `frontend/components/ui/overlay-frosted.test.tsx` body:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

describe('floating overlays', () => {
  it('renders dropdown content with a solid surface and viewport clamp', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const content = screen.getByText('item').closest('[role="menu"]')!;
    expect(content.className).toContain('bg-popover');
    expect(content.className).not.toContain('frosted-overlay');
    expect(content.className).toContain('shadow-elev-header');
    expect(content.className).toContain('max-w-[calc(100vw-1rem)]');
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npm run test:run -- overlay-frosted`
Expected: FAIL — content still contains `frosted-overlay`.

- [ ] **Step 3: Make popover + dropdown solid**

In `popover.tsx:21` replace the token `frosted-overlay` with `bg-popover` (leave every other class). In `dropdown-menu.tsx:65` replace `frosted-overlay` with `bg-popover`.

- [ ] **Step 4: Remove the now-unused frosted-overlay CSS (precise)**

In `frontend/index.css`:
- Delete the comment + block at lines ~220-225 (`/* Frosted floating overlay ... */` and `.frosted-overlay { ... }`).
- In the `@supports not (...)` block, delete only the line `.frosted-overlay { background-color: hsl(var(--popover)); }` (keep `.frosted-header { ... }`).
- In the `@media (prefers-reduced-transparency: reduce)` block, **split the grouped selector**: change `.frosted-header, .frosted-overlay {` to just `.frosted-header {` (keep its body), and delete the trailing `.frosted-overlay { background-color: hsl(var(--popover)); }` line.

Then verify nothing references it:

Run: `grep -rn "frosted-overlay" frontend/`
Expected: no matches. Also confirm `.frosted-header` survived: `grep -rn "frosted-header" frontend/index.css` → expect 3 matches.

- [ ] **Step 5: Run the test, verify it PASSES**

Run: `npm run test:run -- overlay-frosted`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ui/popover.tsx frontend/components/ui/dropdown-menu.tsx frontend/index.css frontend/components/ui/overlay-frosted.test.tsx
git commit -m "fix(ui): make floating popover/dropdown surfaces solid (no frosted transparency)"
```

---

### Task 2: Shared AIPopoverShell

**Files:**
- Create: `frontend/components/extraction/ai/shared/AIPopoverShell.tsx`
- Test: `frontend/components/extraction/ai/shared/AIPopoverShell.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface AIPopoverShellProps {
    icon: React.ReactNode;        // leading header icon (Sparkles / Clock)
    title: string;
    count?: string;               // optional subtitle/count line under title
    align?: 'start' | 'center' | 'end';  // default 'start'
    className?: string;           // extra classes for PopoverContent
    children: React.ReactNode;    // body (caller owns inner padding)
  }
  ```
  Renders a `PopoverContent` with `w-[min(380px,calc(100vw-1.5rem))] overflow-hidden p-0`, a `border-b` header (icon + title + optional count), and a scrollable body region `max-h-[min(70vh,32rem)] overflow-y-auto`. Caller wraps it in `<Popover>` + `<PopoverTrigger>`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { AIPopoverShell } from './AIPopoverShell';

describe('AIPopoverShell', () => {
  it('renders a solid, responsive shell with header + body', () => {
    render(
      <Popover defaultOpen>
        <PopoverTrigger>open</PopoverTrigger>
        <AIPopoverShell icon={<span>i</span>} title="Suggestion details" count="3 found">
          <p>body content</p>
        </AIPopoverShell>
      </Popover>,
    );
    const popover = document.querySelector('.bg-popover') as HTMLElement;
    expect(popover).not.toBeNull();
    expect(popover.className).toContain('w-[min(380px,calc(100vw-1.5rem))]');
    expect(popover.textContent).toContain('Suggestion details');
    expect(popover.textContent).toContain('3 found');
    expect(popover.textContent).toContain('body content');
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npm run test:run -- AIPopoverShell`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AIPopoverShell**

```tsx
/**
 * Shared shell for the AI-suggestion popovers (details + history).
 * Owns the solid surface, consistent header, responsive width, and a single
 * scrollable body region so the two popovers don't drift on chrome.
 */
import {PopoverContent} from '@/components/ui/popover';

interface AIPopoverShellProps {
  icon: React.ReactNode;
  title: string;
  count?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: React.ReactNode;
}

export function AIPopoverShell({
  icon,
  title,
  count,
  align = 'start',
  className,
  children,
}: AIPopoverShellProps) {
  return (
    <PopoverContent
      align={align}
      side="bottom"
      className={`w-[min(380px,calc(100vw-1.5rem))] overflow-hidden p-0 ${className ?? ''}`}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ai">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          {count != null && (
            <div className="text-xs text-muted-foreground">{count}</div>
          )}
        </div>
      </div>
      <div className="max-h-[min(70vh,32rem)] overflow-y-auto">{children}</div>
    </PopoverContent>
  );
}
```

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `npm run test:run -- AIPopoverShell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/ai/shared/AIPopoverShell.tsx frontend/components/extraction/ai/shared/AIPopoverShell.test.tsx
git commit -m "feat(extraction): shared AIPopoverShell (solid, responsive, consistent header)"
```

---

### Task 3: Details popover — solid evidence + click-the-passage locate (option A)

**Files:**
- Modify: `frontend/components/extraction/ai/AISuggestionEvidence.tsx`
- Modify: `frontend/components/extraction/ai/shared/AISuggestionDetailsPopover.tsx`
- Modify: `frontend/lib/copy/extraction.ts`
- Modify (existing): `frontend/components/extraction/ai/AISuggestionEvidence.test.tsx`
- Modify (existing): `frontend/components/extraction/ai/shared/AISuggestionDetailsPopover.test.tsx`

**Interfaces:**
- Consumes: `AIPopoverShell` (Task 2).
- Produces: `AISuggestionEvidence` accepts `activeRank?: number | null`; when `onLocate` is provided the cited passage is a `button` (aria-label `evidenceLocate`, or `evidenceLocatedInReader` when active) carrying `data-active-citation` + a ring when active. `AISuggestionDetailsPopover` no longer closes on locate; it tracks `activeRank`.

**Key reuse decision:** the new clickable passage keeps the existing `evidenceLocate` aria-label, so the existing `AISuggestionEvidence` scenario-(a) tests and the details-popover locate query (`getByRole('button',{name:'evidenceLocate'})`) keep working. The standalone map-pin Button in the row header is removed.

- [ ] **Step 1: Add copy key**

In `frontend/lib/copy/extraction.ts` add (English only): `evidenceLocatedInReader: 'Highlighted in the reader'`. Keep `evidenceLocate: 'Locate in document'` (reused). Do NOT add `evidenceShowInDocument`.

- [ ] **Step 2: Add the new failing tests (extend the existing file)**

Append to `frontend/components/extraction/ai/AISuggestionEvidence.test.tsx` a new scenario (keep all existing scenarios a–g intact):

```tsx
  describe('(h) active citation ring', () => {
    it('marks the cited passage active when activeRank matches its rank', () => {
      const { container } = render(
        <AISuggestionEvidence evidence={singleCitation} onLocate={vi.fn()} activeRank={0} />,
        { wrapper: Wrapper },
      );
      expect(container.querySelector('[data-active-citation="true"]')).not.toBeNull();
    });

    it('does not mark active when activeRank differs', () => {
      const { container } = render(
        <AISuggestionEvidence evidence={singleCitation} onLocate={vi.fn()} activeRank={5} />,
        { wrapper: Wrapper },
      );
      expect(container.querySelector('[data-active-citation="true"]')).toBeNull();
    });
  });
```

- [ ] **Step 3: Run, verify FAIL**

Run: `npm run test:run -- AISuggestionEvidence`
Expected: FAIL on scenario (h) — no `data-active-citation` yet. (a)–(g) still pass.

- [ ] **Step 4: Implement evidence changes**

In `AISuggestionEvidence.tsx`:
- Container `bg-muted/50` → `bg-muted` (line ~193).
- Add `activeRank?: number | null` to `AISuggestionEvidenceProps`; thread `isActive={citation.rank === activeRank}` into each `CitationRow`.
- Remove the map-pin locate `Button` from the row-header action cluster (keep the Copy button, page badge, attribution badge, FileText icon).
- Replace the `blockquote` with: when `onLocate` is provided, a full-width `button`; else the existing `blockquote`:

```tsx
{onLocate ? (
  <button
    type="button"
    data-active-citation={isActive ? 'true' : undefined}
    aria-label={isActive ? t('extraction', 'evidenceLocatedInReader') : t('extraction', 'evidenceLocate')}
    onClick={(e) => { e.stopPropagation(); onLocate(citation.rank); }}
    className={cn(
      'group block w-full rounded-md border-l-2 pl-3 sm:pl-5 py-1 text-left transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      borderClass,
      isActive ? 'bg-primary/5 ring-2 ring-primary/40' : 'hover:bg-muted-foreground/5',
    )}
  >
    <span className="block text-sm italic text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
      "{citation.text}"
    </span>
    <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
      <MapPin className="h-3.5 w-3.5" aria-hidden />
      {isActive ? t('extraction', 'evidenceLocatedInReader') : t('extraction', 'evidenceLocate')}
    </span>
  </button>
) : (
  <blockquote className={cn('text-sm text-foreground/90 italic pl-3 sm:pl-5 border-l-2 whitespace-pre-wrap break-words leading-relaxed', borderClass)}>
    "{citation.text}"
  </blockquote>
)}
```

`CitationRow` gains an `isActive?: boolean` prop; remove the now-unused `onLocate` handling in the row header (the passage owns the click).

- [ ] **Step 5: Run, verify PASS (all scenarios)**

Run: `npm run test:run -- AISuggestionEvidence`
Expected: PASS — (a)–(h). Note (a) still finds the passage by `evidenceLocate` aria-label and gets `onLocate(0)`.

- [ ] **Step 6: Wire keep-open + activeRank in the details popover**

In `AISuggestionDetailsPopover.tsx`:
- Replace the hand-rolled `PopoverContent` + header with `AIPopoverShell` (icon `<Sparkles className="h-4 w-4" />`, title `t('extraction','aiSuggestionDetailsTitle')`); move rationale + evidence into the body (keep the `space-y-4 p-4` wrapper as the body child).
- Add `const [activeRank, setActiveRank] = useState<number | null>(null);`.
- In `EvidenceSection`, the locate handler becomes `(rank) => { const c = evidence.find(e => e.rank === rank) ?? evidence[0]; onActivate(rank); locate(c.text, c.pageNumber ?? null, c.blockIds ?? []); }` — **no `onClose()`**. Pass `activeRank` + `onActivate={setActiveRank}` from the parent; pass `activeRank` into `AISuggestionEvidence`.
- Remove the now-unused `onClose` prop from `EvidenceSection`.

- [ ] **Step 7: Update the existing details test (keep-open, not close)**

In `frontend/components/extraction/ai/shared/AISuggestionDetailsPopover.test.tsx`, rewrite the second test (was "…then closes the popover"):

```tsx
  it('locate calls reader-locate with text + page and keeps the popover open + marks active', async () => {
    const user = userEvent.setup();
    render(
      <AISuggestionDetailsPopover suggestion={suggestion} trigger={<button>Open</button>} />,
      {wrapper: Wrapper},
    );

    await user.click(screen.getByRole('button', {name: 'Open'}));
    const passage = await screen.findByRole('button', {name: 'evidenceLocate'});

    await user.click(passage);
    expect(locateSpy).toHaveBeenCalledOnce();
    expect(locateSpy).toHaveBeenCalledWith('test evidence', 2, [5]);

    // Popover stays open; the citation is now marked active.
    expect(screen.getByText(/test evidence/)).toBeInTheDocument();
    expect(document.querySelector('[data-active-citation="true"]')).not.toBeNull();
  });
```

Keep tests 1 ("opens and shows rationale + evidence") and 3 ("no viewer → no locate button") unchanged — test 3 still passes because with `isAvailable=false` the passage is a plain `blockquote` (no button named `evidenceLocate`).

- [ ] **Step 8: Run, verify PASS**

Run: `npm run test:run -- AISuggestionEvidence AISuggestionDetailsPopover`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/extraction/ai/AISuggestionEvidence.tsx frontend/components/extraction/ai/shared/AISuggestionDetailsPopover.tsx frontend/lib/copy/extraction.ts frontend/components/extraction/ai/AISuggestionEvidence.test.tsx frontend/components/extraction/ai/shared/AISuggestionDetailsPopover.test.tsx
git commit -m "feat(extraction): solid evidence + click-the-passage locate that keeps the details popup open"
```

---

### Task 4: History popover — real run identity, no truncation, no debug logs

**Files:**
- Modify: `frontend/components/extraction/ai/AISuggestionHistoryPopover.tsx`
- Modify: `frontend/lib/copy/extraction.ts`
- Create: `frontend/components/extraction/ai/AISuggestionHistoryPopover.test.tsx`

**Interfaces:**
- Consumes: `AIPopoverShell` (Task 2), `AISuggestionHistoryItem` (existing).
- Produces: history popover inside the shared shell; run-group header = existing `formatTimestamp(...)` (NOT a new relative-time helper) with a `Current` pill on the run holding `currentSuggestionId`; non-truncated `line-clamp-2` values with full value in `title`; typed `formatValue(value: unknown)`; no `console.warn`; content-aware height.

**Simplicity note:** do NOT add a `formatRunAge`/relative-time helper. The reported defect is the misleading positional `Extraction #N`. Dropping `#N` and reusing the existing `formatTimestamp` (already invalid-date-guarded, already used in this file) fixes it with no new code.

- [ ] **Step 1: Copy keys**

In `frontend/lib/copy/extraction.ts`: add `historyCurrentRun: 'Current'`; **remove** the now-unused `historyExtractionRun` key (its only consumer is deleted in Step 4 — clean-in-touched-code).

- [ ] **Step 2: Write the failing tests**

Create `frontend/components/extraction/ai/AISuggestionHistoryPopover.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

import { AISuggestionHistoryPopover } from './AISuggestionHistoryPopover';
import type { AISuggestionHistoryItem } from '@/hooks/extraction/ai/useAISuggestions';

const longValue =
  'Randomized controlled trial with a very long extracted value that clearly exceeds fifty characters of text';
const items: AISuggestionHistoryItem[] = [
  { id: 'cur', runId: 'r2', value: longValue, confidence: 0.9, reasoning: 'r', status: 'pending', timestamp: new Date('2026-06-27T10:00:00'), evidence: [] },
  { id: 'old', runId: 'r1', value: 'Cohort', confidence: 0.4, reasoning: 'r', status: 'rejected', timestamp: new Date('2026-06-20T09:00:00'), evidence: [] },
];

async function open() {
  const user = userEvent.setup();
  render(
    <AISuggestionHistoryPopover
      instanceId="i" fieldId="f" currentSuggestionId="cur"
      getHistory={async () => items}
      trigger={<button>open</button>}
    />,
  );
  await user.click(screen.getByText('open'));
}

describe('AISuggestionHistoryPopover', () => {
  it('shows the full (untruncated) value', async () => {
    await open();
    await waitFor(() => expect(screen.getByText(longValue)).toBeInTheDocument());
  });

  it('marks the run holding the current suggestion with the Current key', async () => {
    await open();
    await waitFor(() => expect(screen.getByText('historyCurrentRun')).toBeInTheDocument());
  });

  it('does not label runs by positional index', async () => {
    await open();
    await waitFor(() => expect(screen.getByText(longValue)).toBeInTheDocument());
    expect(screen.queryByText(/#\s*\d/)).toBeNull();
  });

  it('does not emit console.warn debug logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    await waitFor(() => expect(screen.getByText(longValue)).toBeInTheDocument());
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

Run: `npm run test:run -- AISuggestionHistoryPopover`
Expected: FAIL — value truncated / no `historyCurrentRun` / `#N` present / `console.warn` called.

- [ ] **Step 4: Implement the history changes**

In `AISuggestionHistoryPopover.tsx`:
- Render inside `AIPopoverShell` (icon `<Clock className="h-4 w-4" />`, title `t('extraction','historySuggestionsTitle')`, `count={`${history.length} ${t('extraction','historySuggestionsCount')}`}`); drop the hand-rolled `PopoverContent` + header and the `ScrollArea h-[400px]` (the shell provides the scroll region). Keep the loading / empty / list branches as the shell body.
- Remove the three `console.warn` calls (lines 68, 73, 80); keep the `console.error` in the `.catch`.
- Translate `// Agrupar por runId` → `// Group by run id`; `// Header do Run` → `// Run header`.
- `formatValue(value: unknown)`: object → `JSON.stringify(value)`; null/undefined → `t('extraction','emptyValue')`; else `String(value)`. **Remove** the 50-char truncation.
- Value cell: `<p className="text-sm font-medium line-clamp-2 break-words" title={formatValue(suggestion.value)}>{formatValue(suggestion.value)}</p>`.
- Run-group header: delete `{t('extraction','historyExtractionRun')} #{runIndex + 1}`. Render `formatTimestamp(suggestions[0].timestamp, invalidDateLabel)` as the label. If any suggestion in the group has `id === currentSuggestionId`, render a `Current` pill: `<span className="rounded bg-ai/10 border border-ai/30 px-1.5 py-0.5 text-xs text-ai">{t('extraction','historyCurrentRun')}</span>`.

- [ ] **Step 5: Run, verify PASS**

Run: `npm run test:run -- AISuggestionHistoryPopover`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/extraction/ai/AISuggestionHistoryPopover.tsx frontend/lib/copy/extraction.ts frontend/components/extraction/ai/AISuggestionHistoryPopover.test.tsx
git commit -m "fix(extraction): history popover — real run identity, no truncation, no debug logs, content-aware height"
```

---

### Task 5: Remove the throwaway design-review harness

**Files:**
- Delete: `frontend/pages/_DevAiPopupReview.tsx`
- Modify: `frontend/App.tsx` (remove the DEV-only lazy import + route)

- [ ] **Step 1: Delete the harness page + route**

Remove `frontend/pages/_DevAiPopupReview.tsx`; in `frontend/App.tsx` remove the `DevAiPopupReview` lazy import (~line 50) and the `import.meta.env.DEV && <Route path="/dev/ai-popup-review" .../>` block.

- [ ] **Step 2: Verify no references remain + build is clean**

Run: `grep -rn "DevAiPopupReview\|_DevAiPopupReview\|ai-popup-review" frontend/` → expect no matches.
Run: `npm run build` → expect success.

- [ ] **Step 3: Commit**

```bash
git add -A frontend/App.tsx frontend/pages
git commit -m "chore(extraction): remove throwaway AI-popup design-review harness"
```

---

## Self-Review

- **Spec coverage:** D1 shell → Task 2; D2 solid surfaces → Task 1; D3 locate option A (keep-open + active ring) → Task 3; D4 history fixes → Task 4; solid evidence block → Task 3; copy keys → Tasks 3-4; harness removal → Task 5. No gaps.
- **Panel blockers resolved:** (1) import constraint fixed (mock `@/hooks/extraction/useReaderLocate`); (2) existing details "closes" test rewritten to keep-open in Task 3 Step 7; (3) existing evidence tests preserved by reusing the `evidenceLocate` aria-label (only scenario (h) added); (4) spec/plan contradictions reconciled — `line-clamp-2` (kept), reuse `evidenceLocate` (no `evidenceShowInDocument`), tests assert copy **keys** not English; `formatRunAge` cut (reuse `formatTimestamp`); orphan `historyExtractionRun` removed; CSS grouped-selector split made precise.
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `activeRank?: number | null` consistent (evidence + details); `formatValue(value: unknown)`; `AIPopoverShellProps` (`count?: string`) matches consumers.
