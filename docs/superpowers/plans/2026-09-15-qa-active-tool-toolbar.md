---
status: draft
last_reviewed: 2026-09-15
owner: '@raphaelfh'
---

# QA Active Tool in the List Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Quality-assessment list's Active tool control out of its own card row and into the article-table toolbar, left of search, with clean behaviour from desktop down to phone width.

**Architecture:** `HITLArticleTable` gains a `toolbarLeading` slot rendered at the start of the toolbar row, grouped with search so both share a row at every width, and kept visible in the loading, error and empty states. `HITLActiveTemplateBar` becomes a compact QA-only inline control whose "Active tool:" label folds to `sr-only` through a container query. `QualityAssessmentInterface` passes the control into the slot and drops the card row.

**Tech Stack:** TypeScript strict, React 19, Tailwind v4 (container queries), shadcn/Radix (DropdownMenu, Tooltip), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-ai-batch-runs-design.md` §12 (PR 1 of the §15 delivery order). Plans for PR 2 (backend) and PR 3 (batch UX) are separate.

## Global Constraints

- English only: code, comments, commits, docs, copy.
- Work only in the worktree `/Users/raphael/PycharmProjects/prumo/.claude/worktrees/regras-injecao-skills-669947` on branch `claude/qa-batch-selection-layout-5905b6`. Use absolute paths; never edit the main checkout. Run each `git` command on its own (the worktree session guard refuses compound shell commands containing `git`).
- Frontend tooling runs from the worktree root (`package.json`, `vitest.config.ts` live there; `node_modules` is installed). Never `cd frontend && npm …`.
- Frontend only. No backend change, no API type regeneration.
- All user-facing text through `t()`. Reuse `qa.activeTemplateLabel` ("Active tool:") and `qa.activeTemplateNone`; add no copy keys. The dead hardcoded `"Active template:"` string is deleted.
- These test ids stay byte-identical (read by `frontend/test/QualityAssessmentInterface.test.tsx` and `frontend/e2e/flows/hitl-landing-pages.ui.e2e.ts`): `hitl-quality_assessment-active-template-bar`, `hitl-quality_assessment-active-template-bar-empty`, `hitl-quality_assessment-active-template-name`, `hitl-quality_assessment-active-template-trigger`, `hitl-quality_assessment-active-template-option-<templateId>`.
- The label folds with `sr-only @[48rem]/listbar:not-sr-only`; the toolbar row carries `@container/listbar`. Never `hidden`, never an `aria-label` on the trigger (it would replace the composed name).
- Buttons use named sizes: `variant="ghost" size="sm"`. No `h-*` in a `Button` `className` (`check_button_scale.py`). No `cursor-*` classes. Never mount a `TooltipProvider` (the `Tooltip` primitive falls back to its own).
- React Compiler: no `try/finally` in component bodies.
- Load before coding: `frontend-development`, `ui-styling`, `web-testing`. Before calling it done: `design-review`, then `code-review`.
- Gates, from the worktree root: `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run deadcode`, `npm run deadcode:production`, `bash scripts/fitness/run_all.sh`.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Do not push or open a PR unless the user asks.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/components/shared/list/ListToolbarSearch.tsx` | Modify | Accept a `className` merged over its default sizing |
| `frontend/components/hitl/HITLArticleTable.tsx` | Modify | `toolbarLeading` slot: toolbar row, skeleton, error and empty states |
| `frontend/components/hitl/HITLArticleTable.test.tsx` | Modify | Slot placement and persistence tests |
| `frontend/components/hitl/HITLActiveTemplateBar.tsx` | Modify | QA-only inline control; folding label; truncation + tooltip |
| `frontend/components/hitl/HITLActiveTemplateBar.test.tsx` | Create | Control behaviour tests |
| `frontend/components/quality/QualityAssessmentInterface.tsx` | Modify | Pass the control into `toolbarLeading`; drop the card row |
| `frontend/test/QualityAssessmentInterface.test.tsx` | Modify | Placement test |

---

### Task 1: Leading toolbar slot on `HITLArticleTable`

**Files:**
- Modify: `frontend/components/shared/list/ListToolbarSearch.tsx`
- Modify: `frontend/components/hitl/HITLArticleTable.tsx:117-147` (props), `:365-412` (non-ready states), `:414-470` (toolbar row)
- Test: `frontend/components/hitl/HITLArticleTable.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `HITLArticleTable` prop `toolbarLeading?: ReactNode`; toolbar row test id `hitl-${kind}-toolbar`; `ListToolbarSearch` prop `className?: string`.

- [ ] **Step 1: Make the article mock switchable and write the failing tests**

In `frontend/components/hitl/HITLArticleTable.test.tsx`, replace the hoisted block and the `articlesService` mock (lines 16-32) with:

```tsx
const { progressById, useAuthMock, structure, values, structureRefetch, valuesRefetch, articleList } = vi.hoisted(() => ({
  progressById: new Map<string, number>(), useAuthMock: vi.fn(), structureRefetch: vi.fn(), valuesRefetch: vi.fn(),
  structure: { isLoading: false, isError: false }, values: { isLoading: false, isError: false },
  articleList: { empty: false },
}));
const AUTH_USER = { user: { id: 'user-1' }, loading: false };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }));

vi.mock('@/services/articlesService', () => ({
  fetchProjectArticles: async () => ({
    ok: true,
    data: articleList.empty
      ? []
      : [
          { id: 'a-new', title: 'Fresh article', authors: [], publication_year: null, created_at: '2026-01-03T00:00:00Z' },
          { id: 'a-wip', title: 'Half done', authors: ['Doe'], publication_year: 2024, created_at: '2026-01-02T00:00:00Z' },
          { id: 'a-done', title: 'All done', authors: ['Roe'], publication_year: 2023, created_at: '2026-01-01T00:00:00Z' },
        ],
  }),
}));
```

Replace `renderTable` (lines 60-72) with:

```tsx
function renderTable(toolbarActions?: ReactNode, toolbarLeading?: ReactNode) {
  const ui = () => (
    <MemoryRouter initialEntries={['/list']}>
      <Routes>
        <Route path="/list" element={<HITLArticleTable kind="quality_assessment" projectId="p1" templateId="t1"
          rowActionHref={(articleId, templateId) => `/qa/${articleId}/${templateId}`}
          toolbarActions={toolbarActions} toolbarLeading={toolbarLeading} />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(ui());
  return { rerender: () => view.rerender(ui()) };
}
```

In `beforeEach`, add `articleList.empty = false;` after `progressById.clear();`.

Append at the end of the file:

```tsx
describe('HITLArticleTable leading toolbar slot', () => {
  const LEADING = <span data-testid="leading">tool</span>;
  const SEARCH = t('extraction', 'tableSearchPlaceholderShortcut');

  it('renders the leading slot in the toolbar row, before search', async () => {
    renderTable(undefined, LEADING);
    await openControl('Half done');

    const toolbar = screen.getByTestId('hitl-quality_assessment-toolbar');
    const leading = within(toolbar).getByTestId('leading');
    const search = within(toolbar).getByPlaceholderText(SEARCH);
    expect(leading.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Search shares the row with the slot: its full-width default is replaced.
    const searchWrapper = search.closest('.group');
    expect(searchWrapper).toHaveClass('flex-1', 'min-w-0', 'w-auto');
    expect(searchWrapper).not.toHaveClass('w-full');
  });

  it('keeps the leading slot beside the toolbar actions while progress loads', async () => {
    values.isLoading = true;
    renderTable(<button type="button">toolbar-action</button>, LEADING);
    expect(screen.getByTestId('hitl-quality_assessment-table-loading')).toBeInTheDocument();
    expect(screen.getByTestId('leading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'toolbar-action' })).toBeInTheDocument();
  });

  it('keeps the leading slot when progress fails', async () => {
    values.isError = true;
    renderTable(undefined, LEADING);
    expect(await screen.findByText(t('extraction', 'errorLoadProgress'))).toBeInTheDocument();
    expect(screen.getByTestId('leading')).toBeInTheDocument();
  });

  it('keeps the leading slot when the project has no articles', async () => {
    articleList.empty = true;
    renderTable(undefined, LEADING);
    expect(await screen.findByTestId('hitl-quality_assessment-table-empty')).toBeInTheDocument();
    expect(screen.getByTestId('leading')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run frontend/components/hitl/HITLArticleTable.test.tsx`
Expected: the four new tests FAIL (`Unable to find an element by: [data-testid="hitl-quality_assessment-toolbar"]` / `[data-testid="leading"]`); every pre-existing test still PASSES.

- [ ] **Step 3: Add `className` to `ListToolbarSearch`**

Replace the whole of `frontend/components/shared/list/ListToolbarSearch.tsx` with:

```tsx
import * as React from 'react';
import {Input} from '@/components/ui/input';
import {Search} from 'lucide-react';
import {cn} from '@/lib/utils';

interface ListToolbarSearchProps {
    ref?: React.RefObject<HTMLInputElement | null>;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    /** Merged over the wrapper's default sizing (full width below `md`). */
    className?: string;
}

export const ListToolbarSearch = React.forwardRef<
    HTMLInputElement,
    ListToolbarSearchProps
>(function ListToolbarSearch({placeholder, value, onChange, className}, ref) {
    return (
        <div className={cn('w-full md:flex-1 md:min-w-[200px] group', className)}>
            <div className="relative">
                <Search
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground transition-colors group-focus-within:text-foreground"/>
                <Input
                    ref={ref}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="pl-8 h-8 bg-muted/40 border-transparent focus:bg-background focus:ring-0 focus:border-border/60 focus:shadow-xs transition-all text-sm rounded-md"
                />
            </div>
        </div>
    );
});
```

- [ ] **Step 4: Add the prop to `HITLArticleTable`**

In `frontend/components/hitl/HITLArticleTable.tsx`, inside `interface Props`, directly above the `toolbarActions` doc comment, add:

```tsx
  /**
   * Rendered at the start of the toolbar, grouped with search so the two
   * share a row at every width (QA mounts its Active tool control here). It
   * also renders in the loading, error and empty states: switching tools is
   * how a user leaves an empty or failing list.
   */
  toolbarLeading?: ReactNode;
```

Add `toolbarLeading,` to the destructured parameters, after `emptyDescription,`.

- [ ] **Step 5: Keep the slot in every non-ready state**

Replace the block from `const gate = resolveProgressGate(progress, structure);` through the end of the `if (articles.length === 0) { … }` block (lines 365-412) with:

```tsx
  const leadingRow = toolbarLeading ? (
    <div className="flex shrink-0 items-center gap-2">{toolbarLeading}</div>
  ) : null;
  const withLeading = (content: ReactNode) =>
    leadingRow ? (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {leadingRow}
        {content}
      </div>
    ) : (
      content
    );

  const gate = resolveProgressGate(progress, structure); // R19, in the ONE shared order (R37)
  if (gate.state === "signedOut") return withLeading(<ErrorState message={t("extraction", "progressUnavailable")} />);
  if (gate.state === "error") return withLeading(<ErrorState message={t("extraction", "errorLoadProgress")} onRetry={gate.retry} />);
  if (gate.state !== "ready" || loading) {
    return (
      <div className="space-y-3" data-testid={`hitl-${kind}-table-loading`}>
        {(toolbarLeading || toolbarActions) && (
          <div className="flex items-center gap-2">
            {toolbarLeading}
            {toolbarActions && <div className="ml-auto flex items-center gap-2">{toolbarActions}</div>}
          </div>
        )}
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return withLeading(
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <div className="flex items-center gap-3 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <div>
            <p className="font-medium">
              {t("extraction", "tableErrorLoadArticles")}
            </p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        </div>
      </div>,
    );
  }

  if (articles.length === 0) {
    return withLeading(
      <div
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/40 bg-muted/10 px-4 py-24"
        data-testid={`hitl-${kind}-table-empty`}
      >
        <FileText
          className="mb-4 h-10 w-10 text-muted-foreground/30"
          strokeWidth={1.2}
        />
        <h3 className="mb-1.5 text-center text-base font-medium text-foreground">
          {emptyTitle ?? t("extraction", "listNoArticles")}
        </h3>
        <p className="mx-auto max-w-xs text-center text-[13px] text-muted-foreground">
          {emptyDescription ?? t("extraction", "listNoArticlesDesc")}
        </p>
      </div>,
    );
  }
```

- [ ] **Step 6: Group the slot with search in the toolbar row**

Replace the opening of the toolbar row and the `ListToolbarSearch` element (lines 417-423):

```tsx
        <div className="flex flex-wrap items-center gap-2 w-full">
          <ListToolbarSearch
            ref={searchInputRef}
            placeholder={t("extraction", "tableSearchPlaceholderShortcut")}
            value={globalFilter}
            onChange={setGlobalFilter}
          />
```

with:

```tsx
        <div
          data-testid={`hitl-${kind}-toolbar`}
          className="@container/listbar flex w-full flex-wrap items-center gap-2"
        >
          {/* Leading control + search share one row at every width; below
              `md` the filter/display/actions wrap onto the next row. */}
          <div className="flex min-w-0 basis-full items-center gap-2 md:flex-1">
            {toolbarLeading}
            <ListToolbarSearch
              ref={searchInputRef}
              className="w-auto min-w-0 flex-1"
              placeholder={t("extraction", "tableSearchPlaceholderShortcut")}
              value={globalFilter}
              onChange={setGlobalFilter}
            />
          </div>
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run frontend/components/hitl/HITLArticleTable.test.tsx`
Expected: all tests PASS.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/shared/list/ListToolbarSearch.tsx frontend/components/hitl/HITLArticleTable.tsx frontend/components/hitl/HITLArticleTable.test.tsx
```

```bash
git commit -m "feat(qa): leading toolbar slot on the HITL article table

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Inline Active tool control

**Files:**
- Modify: `frontend/components/hitl/HITLActiveTemplateBar.tsx:1-112` (everything above `useActiveTemplateSelection`)
- Modify: `frontend/components/quality/QualityAssessmentInterface.tsx` (drop the `kind` prop at both call sites)
- Test: `frontend/components/hitl/HITLActiveTemplateBar.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `HITLActiveTemplateBar({ templates, activeTemplate, onSelect }: { templates: ProjectTemplate[]; activeTemplate: ProjectTemplate | null; onSelect: (templateId: string) => void })`. The `kind` and `emptyHint` props are removed. `useActiveTemplateSelection` is unchanged.

- [ ] **Step 1: Write the failing tests**

Create `frontend/components/hitl/HITLActiveTemplateBar.test.tsx`:

```tsx
/**
 * The QA Active tool control (spec 2026-09-15 §12): static for one tool, a
 * menu for several, and a folding label that never leaves the accessible name.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HITLActiveTemplateBar } from '@/components/hitl/HITLActiveTemplateBar';
import type { ProjectTemplate } from '@/hooks/hitl/useProjectTemplates';
import { t } from '@/lib/copy';

const tool = (id: string, name: string, version = '1.0.0') =>
  ({ id, name, version, kind: 'quality_assessment', is_active: true }) as ProjectTemplate;

const PROBAST = tool('tpl-probast', 'PROBAST+AI', '2.0.0');
const QUADAS = tool('tpl-quadas', 'QUADAS-2');
const BAR = 'hitl-quality_assessment-active-template-bar';
const NAME = 'hitl-quality_assessment-active-template-name';
const TRIGGER = 'hitl-quality_assessment-active-template-trigger';

describe('HITLActiveTemplateBar', () => {
  it('shows a single tool as static text reading "Active tool: <name>"', () => {
    render(<HITLActiveTemplateBar templates={[PROBAST]} activeTemplate={PROBAST} onSelect={vi.fn()} />);

    expect(screen.getByTestId(BAR)).toHaveTextContent(`${t('qa', 'activeTemplateLabel')} PROBAST+AI`);
    expect(screen.getByTestId(NAME)).toHaveTextContent('PROBAST+AI');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('folds the label to sr-only on a narrow toolbar and keeps it in the trigger name', () => {
    render(<HITLActiveTemplateBar templates={[PROBAST, QUADAS]} activeTemplate={PROBAST} onSelect={vi.fn()} />);

    const label = screen.getByText(t('qa', 'activeTemplateLabel'));
    expect(label).toHaveClass('sr-only', '@[48rem]/listbar:not-sr-only');
    expect(label).not.toHaveClass('hidden');
    expect(screen.getByRole('button', { name: /Active tool:\s*PROBAST\+AI/ })).toBeInTheDocument();
  });

  it('switches tools from the menu', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HITLActiveTemplateBar templates={[PROBAST, QUADAS]} activeTemplate={PROBAST} onSelect={onSelect} />);

    await user.click(screen.getByTestId(TRIGGER));
    await user.click(await screen.findByTestId('hitl-quality_assessment-active-template-option-tpl-quadas'));

    expect(onSelect).toHaveBeenCalledWith('tpl-quadas');
  });

  it('truncates a long name and carries the full name in a tooltip', async () => {
    const user = userEvent.setup();
    const long = tool('tpl-long', 'A very long quality assessment tool name for prediction models');
    render(<HITLActiveTemplateBar templates={[long, QUADAS]} activeTemplate={long} onSelect={vi.fn()} />);

    expect(screen.getByTestId(NAME)).toHaveClass('truncate', 'min-w-0');
    await user.hover(screen.getByTestId(TRIGGER));
    // The visible (truncated) name plus the tooltip copy.
    expect((await screen.findAllByText(long.name)).length).toBeGreaterThan(1);
  });

  it('shows the dashed hint when no tool is enabled', () => {
    render(<HITLActiveTemplateBar templates={[]} activeTemplate={null} onSelect={vi.fn()} />);

    expect(screen.getByTestId('hitl-quality_assessment-active-template-bar-empty'))
      .toHaveTextContent(t('qa', 'activeTemplateNone'));
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run frontend/components/hitl/HITLActiveTemplateBar.test.tsx`
Expected: FAIL on the single-tool text (no space between label and name), the `sr-only` label, the truncation/tooltip, and the empty hint (without `kind` the current test ids render as `hitl-undefined-…`). "switches tools from the menu" may already pass; it stays as a regression guard.

- [ ] **Step 3: Rewrite the component**

Replace everything in `frontend/components/hitl/HITLActiveTemplateBar.tsx` above the `useActiveTemplateSelection` doc comment (lines 1-112) with:

```tsx
/**
 * The Quality-assessment list's Active tool control: which tool the article
 * table shows and, when more than one is enabled, a menu to switch. It sits
 * in the list toolbar, left of search (``HITLArticleTable``'s
 * ``toolbarLeading`` slot).
 *
 * The selection lives in a ``?template=<uuid>`` URL query param so a page
 * reload keeps the view. With no tool enabled it renders the dashed hint
 * instead.
 *
 * The "Active tool:" label folds to ``sr-only`` when the toolbar
 * (``@container/listbar``) is narrow, so the accessible name always reads
 * "Active tool: <name>". The name truncates; its tooltip carries it whole.
 */

import { useSearchParams } from "react-router";
import { ChevronDown, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/lib/copy";
import type { ProjectTemplate } from "@/hooks/hitl/useHITLProjectTemplates";

interface Props {
  templates: ProjectTemplate[];
  activeTemplate: ProjectTemplate | null;
  onSelect: (templateId: string) => void;
}

const TEST_ID = "hitl-quality_assessment-active-template";

export function HITLActiveTemplateBar({ templates, activeTemplate, onSelect }: Props) {
  if (templates.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        data-testid={`${TEST_ID}-bar-empty`}
      >
        <ShieldCheck className="h-4 w-4 text-warning" />
        <span>{t("qa", "activeTemplateNone")}</span>
      </div>
    );
  }

  const name = activeTemplate?.name ?? templates[0].name;
  const content = (
    <>
      <ShieldCheck className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="sr-only @[48rem]/listbar:not-sr-only text-muted-foreground">
        {t("qa", "activeTemplateLabel")}
      </span>{" "}
      <span className="min-w-0 truncate font-medium" data-testid={`${TEST_ID}-name`}>
        {name}
      </span>
    </>
  );

  return (
    <div
      className="flex min-w-0 max-w-[50%] shrink-0 items-center md:max-w-xs"
      data-testid={`${TEST_ID}-bar`}
    >
      {templates.length === 1 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 items-center gap-1.5 px-2 text-[13px]">{content}</div>
          </TooltipTrigger>
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 max-w-full gap-1.5 text-[13px]"
                  data-testid={`${TEST_ID}-trigger`}
                >
                  {content}
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            {templates.map((tpl) => (
              <DropdownMenuItem
                key={tpl.id}
                onSelect={() => onSelect(tpl.id)}
                data-testid={`${TEST_ID}-option-${tpl.id}`}
              >
                <ShieldCheck className="mr-2 h-3.5 w-3.5 text-warning" />
                <span className="text-sm">{tpl.name}</span>
                <span className="ml-2 text-[10px] text-muted-foreground">v{tpl.version}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Drop the removed `kind` prop at both call sites**

In `frontend/components/quality/QualityAssessmentInterface.tsx`, delete the line `kind="quality_assessment"` from both `<HITLActiveTemplateBar …>` elements (the no-template branch near line 196 and the assessment branch near line 220). Leave `<HITLArticleTable kind="quality_assessment" …>` untouched.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run frontend/components/hitl/HITLActiveTemplateBar.test.tsx frontend/test/QualityAssessmentInterface.test.tsx`
Expected: all tests PASS.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/hitl/HITLActiveTemplateBar.tsx frontend/components/hitl/HITLActiveTemplateBar.test.tsx frontend/components/quality/QualityAssessmentInterface.tsx
```

```bash
git commit -m "feat(qa): compact Active tool control with a folding label

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Mount the control in the toolbar

**Files:**
- Modify: `frontend/components/quality/QualityAssessmentInterface.tsx:1-16` (doc comment), `:216-252` (assessment branch)
- Test: `frontend/test/QualityAssessmentInterface.test.tsx`

**Interfaces:**
- Consumes: `HITLArticleTable` prop `toolbarLeading` and test id `hitl-quality_assessment-toolbar` (Task 1); `HITLActiveTemplateBar({ templates, activeTemplate, onSelect })` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

In `frontend/test/QualityAssessmentInterface.test.tsx`, change the first import to:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
```

Inside `describe('QualityAssessmentInterface', …)`, after the first test, add:

```tsx
  it('places the active tool in the article table toolbar, left of search', async () => {
    renderInterface();
    await screen.findByText(/A predictive model for X/); // past the loading skeleton

    const toolbar = screen.getByTestId('hitl-quality_assessment-toolbar');
    const bar = within(toolbar).getByTestId('hitl-quality_assessment-active-template-bar');
    const search = within(toolbar).getByPlaceholderText(t('extraction', 'tableSearchPlaceholderShortcut'));
    expect(bar.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Exactly one control: the old card row above the table is gone.
    expect(screen.getAllByTestId('hitl-quality_assessment-active-template-bar')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx`
Expected: the new test FAILS (`Unable to find an element by: [data-testid="hitl-quality_assessment-active-template-bar"]` inside the toolbar); the others PASS.

- [ ] **Step 3: Move the control into the slot**

Replace the assessment-branch `return` (from `return (` after the `if (!activeTemplate) { … }` block through the closing `</div>` of `flex min-h-0 flex-1 flex-col p-2`, lines 216-252) with:

```tsx
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="hitl-quality_assessment-interface">
      <div className="flex min-h-0 flex-1 flex-col p-2">
        <HITLArticleTable
          kind="quality_assessment"
          projectId={projectId}
          templateId={activeTemplate.id}
          templateSchema={activeTemplate.schema}
          rowActionHref={(articleId, templateId) =>
            `/projects/${projectId}/articles/${articleId}/quality-assessment/${templateId}`
          }
          emptyTitle={t("qa", "noArticlesForListTitle")}
          emptyDescription={t("qa", "noArticlesForListDesc")}
          toolbarLeading={
            <HITLActiveTemplateBar
              templates={templates}
              activeTemplate={activeTemplate}
              onSelect={selectTemplate}
            />
          }
          toolbarActions={
            <>
              <IconButton
                label={t("extraction", "exportButton")}
                onClick={() => setShowExportDialog(true)}
                disabled={worklist.length === 0}
                data-testid="qa-export-button"
                icon={<FileUp strokeWidth={1.5} />}
              />
              <EngineGear projectId={projectId} />
            </>
          }
        />
      </div>
```

Keep the `HITLExportDialog` element and the closing `</div>` and `);` that follow unchanged.

- [ ] **Step 4: Update the doc comment**

In the file's top doc comment, replace item 1:

```tsx
 * 1. ``assessment``: ``HITLActiveTemplateBar`` (switch between PROBAST /
 *    QUADAS-2 / future tools enabled in Configuration) + ``HITLArticleTable``
 *    showing every article with progress and status against the active tool.
```

with:

```tsx
 * 1. ``assessment``: ``HITLArticleTable`` showing every article with progress
 *    and status against the active tool; ``HITLActiveTemplateBar`` (switch
 *    between the tools enabled in Configuration) sits in its toolbar, left
 *    of search.
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run frontend/test/QualityAssessmentInterface.test.tsx frontend/components/hitl/HITLArticleTable.test.tsx frontend/components/hitl/HITLActiveTemplateBar.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/quality/QualityAssessmentInterface.tsx frontend/test/QualityAssessmentInterface.test.tsx
```

```bash
git commit -m "feat(qa): move the Active tool beside search in the list toolbar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Gates and visual verification

**Files:**
- No source changes expected. Fix inside the task that owns the file if a gate fails, then re-run.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: gate output and screenshots for the PR body.

- [ ] **Step 1: Run every frontend gate**

Run each from the worktree root and read the output:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test -- --run
```

```bash
npm run deadcode
```

```bash
npm run deadcode:production
```

```bash
bash scripts/fitness/run_all.sh
```

Expected: each exits 0. `run_all.sh` includes `check_copy_keys.py`, `check_button_scale.py` and `check_ui_primitives.py`.

- [ ] **Step 2: Start this worktree's own dev server**

1. Confirm the main checkout's env files point at the local stack before copying them: `grep -nE "SUPABASE_ENV|127\.0\.0\.1|localhost" /Users/raphael/PycharmProjects/prumo/.env`. If they point anywhere else, stop and ask the user.
2. `cp /Users/raphael/PycharmProjects/prumo/.env /Users/raphael/PycharmProjects/prumo/.claude/worktrees/regras-injecao-skills-669947/.env` (gitignored; never commit it).
3. Check the API answers: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/health`. Expected `200`. Otherwise stop and ask the user before starting anything: one local Supabase stack is shared by every session.
4. Start Vite on a port no peer uses, as a background command: `npm run dev -- --port 8097 --strictPort`. Confirm the listener is this worktree: `lsof -a -p "$(lsof -ti tcp:8097 -sTCP:LISTEN | head -1)" -d cwd -Fn` prints the worktree path. (`preview_start` by name reads the main checkout's config, so it cannot start this server.)
5. Open the Browser pane with `preview_start({ url: "http://127.0.0.1:8097" })`. Log in with the local test account (memory `reference_test_account.md`) and open a project's `?tab=quality`.

- [ ] **Step 3: Load `design-review` and check the screen**

With a project that has one enabled tool, then two (enable a second in the QA Configuration tab; restore it afterwards), check at `resize_window` 1440×900, 768×1024 and 375×812, each with `colorScheme` light and dark:

1. ≥ 768 px: tool control, search, filter, display, export, engine and count are on one row.
2. 375 px: row 1 is the tool control and search; row 2 holds the icon controls with the count right-aligned.
3. The label is visible at 1440 and visually hidden at 375: `javascript_tool` → `getComputedStyle(document.querySelector('[data-testid="hitl-quality_assessment-active-template-bar"] .sr-only')).position` reads `static` at 1440 and `absolute` at 375.
4. No horizontal page scroll: `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at every width.
5. Long name (inspection only): set the name element's `textContent` to a 70-character string with `javascript_tool`; the name ellipsizes, the toolbar does not overflow, and hovering shows the tooltip.
6. With two tools: the menu opens, lists names and versions, and choosing one updates `?template=` and the table.
7. No console errors (`read_console_messages`, `onlyErrors: true`).

Take a screenshot of each width in dark mode for the PR body. Then `resize_window({ preset: "desktop" })` and stop the background Vite command.

- [ ] **Step 4: Review before hand-off**

Load `code-review` and run it on `git diff origin/dev...HEAD`. Report the gate results, screenshots and any finding to the user. Push and open the PR only when the user asks.
