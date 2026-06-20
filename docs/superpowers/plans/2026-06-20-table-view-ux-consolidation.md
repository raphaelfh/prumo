---
status: ready
last_reviewed: 2026-06-20
owner: '@raphaelfh'
---

# Table-view UX consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redundant PROGRESS/STATUS columns with a single progress-ring glyph, make the table toolbar static with a pinned header, move section view-tabs into the global top-bar (centered, with "Worklist" rename and description-as-tooltip), and collapse the duplicated selection state — across the extraction, QA/HITL, and Articles tables.

**Architecture:** Surgical edits to the three existing tables plus the global top-bar. The only new shared UI component is `StatusRing` (the one place with real duplication: `getStatusBadge` vs `renderStatus`). The static toolbar is achieved by layout (the table region owns its own vertical scroll; the toolbar sits outside it) rather than `position: sticky`; the column header (`thead`) is pinned with `sticky top-0` inside that dedicated scroll container. View-tabs render from a per-section config in a new `SectionViewSwitcher` placed in the top-bar's (currently empty) center slot.

**Tech Stack:** TypeScript strict, React 19, Vite, Tailwind, shadcn/Radix, in-house i18n (`frontend/lib/copy/`), vitest + Testing Library, Playwright E2E, `react-router-dom` (`useSearchParams`).

## Global Constraints

- All user-facing text goes through `frontend/lib/copy/` — never hardcode strings in components. English only.
- React Compiler runs with `panicThreshold: 'all_errors'`: no `try/finally` (or `throw` inside `try`) in component/hook bodies. New components here are pure render; safe.
- Preserve existing URL param **values** (`extractionTab=extraction`, `qaTab=assessment`) and existing `data-testid`s (notably `hitl-quality_assessment-tab-${value}`, `hitl-${kind}-row-${id}`, `extraction-export-button`).
- Every interactive element keeps a visible focus state (`focus-visible:ring-2 focus-visible:ring-ring`). Use `cn()` for class merges.
- Do not add `supabase.from(...)` reads or hand-mirror API types (not needed here — pure UI).
- Tests run from the **repo root**: `npm run test:run` (vitest; never bare `npm test` — it watches). Lint/typecheck/tests gate: `make quality-scan`.
- Conventional commits. Branch `claude/gallant-goodall-5e9fa9`. PR targets `dev`, squash-merged.
- Keep the existing resizable-column infrastructure (`useResizableTableColumns`, persisted widths, breakpoint visibility) intact — only the PROGRESS column is removed.

---

### Task 1: `StatusRing` shared component

**Files:**
- Create: `frontend/components/shared/list/StatusRing.tsx`
- Create: `frontend/components/shared/list/StatusRing.test.tsx`
- Modify: `frontend/components/shared/list/index.ts` (add export)
- Modify: `frontend/lib/copy/extraction.ts:301` (add one key)

**Interfaces:**
- Produces: `StatusRing({ progress: number }): JSX.Element` — a 28px progress-ring glyph. `progress` is 0–100 (clamped, rounded). not-started (0) → faint grey ring only; in-progress (1–99) → warning arc + centered number; complete (100) → success ring + check. Tooltip + `role="img"` carry the label.

- [ ] **Step 1: Add the in-progress percentage copy key**

In `frontend/lib/copy/extraction.ts`, immediately after line 301 (`listStatusInProgress: 'In progress',`) add:

```ts
    statusInProgressPct: 'In progress · {{n}}%',
```

- [ ] **Step 2: Write the failing test**

Create `frontend/components/shared/list/StatusRing.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/copy', () => ({
  t: (_ns: string, key: string) => key,
}));

import { StatusRing } from '@/components/shared/list/StatusRing';

describe('StatusRing', () => {
  it('not started (0%): empty ring, no number, not-started label', () => {
    render(<StatusRing progress={0} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'listStatusNotStarted');
    expect(screen.queryByText('0')).toBeNull();
  });

  it('in progress: shows the rounded number and the in-progress label', () => {
    render(<StatusRing progress={52.4} />);
    expect(screen.getByText('52')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'statusInProgressPct');
  });

  it('complete (100%): complete label, no number', () => {
    render(<StatusRing progress={100} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'listStatusComplete');
    expect(screen.queryByText('100')).toBeNull();
  });

  it('clamps out-of-range progress', () => {
    render(<StatusRing progress={140} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'listStatusComplete');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- StatusRing`
Expected: FAIL — cannot resolve `@/components/shared/list/StatusRing`.

- [ ] **Step 4: Implement `StatusRing`**

Create `frontend/components/shared/list/StatusRing.tsx`:

```tsx
import { CheckCircle2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

const SIZE = 28;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export interface StatusRingProps {
  /** Completion percentage 0–100. Clamped and rounded for display. */
  progress: number;
  className?: string;
}

export function StatusRing({ progress, className }: StatusRingProps) {
  const rounded = Math.max(0, Math.min(100, Math.round(progress)));
  const status = rounded >= 100 ? 'complete' : rounded > 0 ? 'in_progress' : 'not_started';
  const label =
    status === 'complete'
      ? t('extraction', 'listStatusComplete')
      : status === 'in_progress'
        ? t('extraction', 'statusInProgressPct').replace('{{n}}', String(rounded))
        : t('extraction', 'listStatusNotStarted');
  const dashOffset = CIRC * (1 - rounded / 100);
  const arcColor = status === 'complete' ? 'text-success' : 'text-warning';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={label}
            className={cn('relative inline-flex h-7 w-7 items-center justify-center', className)}
          >
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                strokeWidth={STROKE}
                stroke="currentColor"
                className="text-muted-foreground/20"
              />
              {status !== 'not_started' && (
                <circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  stroke="currentColor"
                  strokeDasharray={CIRC}
                  strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  className={arcColor}
                />
              )}
            </svg>
            <span className="absolute inset-0 flex items-center justify-center">
              {status === 'complete' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : status === 'in_progress' ? (
                <span className="text-[9px] font-semibold leading-none tabular-nums text-warning">
                  {rounded}
                </span>
              ) : null}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

- [ ] **Step 5: Export it**

In `frontend/components/shared/list/index.ts`, after the `SortIconHeader` export line add:

```ts
export {StatusRing, type StatusRingProps} from './StatusRing';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:run -- StatusRing`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/shared/list/StatusRing.tsx frontend/components/shared/list/StatusRing.test.tsx frontend/components/shared/list/index.ts frontend/lib/copy/extraction.ts
git commit -m "feat(list): add shared StatusRing glyph"
```

---

### Task 2: Adopt `StatusRing` + drop PROGRESS column in `ArticleExtractionTable`

**Files:**
- Modify: `frontend/components/extraction/ArticleExtractionTable.tsx`

**Interfaces:**
- Consumes: `StatusRing` from `@/components/shared/list`; existing `getProgress(article)`.

- [ ] **Step 1: Import `StatusRing`**

In `ArticleExtractionTable.tsx`, inside the `from '@/components/shared/list'` import block (starts line 54), add `StatusRing` to the named imports (e.g. after `ListCount,`).

- [ ] **Step 2: Remove `progress` from column width config**

In `EXTRACTION_DEFAULT_COLUMN_WIDTHS` (line 146-153) delete the line `progress: 170,`. In `RESIZABLE_COLUMN_ORDER` (line 154) change to:

```ts
const RESIZABLE_COLUMN_ORDER = ['title', 'authors', 'year', 'status', 'actions'] as const;
```

- [ ] **Step 3: Delete the PROGRESS column header**

Remove the entire `<TableHead ref={(el) => registerHeaderRef('progress', el)} …>…</TableHead>` block (lines 947-964).

- [ ] **Step 4: Point the STATUS header sort at the progress value**

In the STATUS `<TableHead>` (line 965-1013), change the `SortIconHeader` (line 969-973) to sort by `extraction_progress` (the exact-percentage comparator) so the single remaining sort orders 52% > 6% > 3%:

```tsx
                                  <SortIconHeader
                                      label={t('extraction', 'tableColumnStatus')}
                                      direction={sortField === 'extraction_progress' ? sortDirection : null}
                                      onSort={() => handleSort('extraction_progress')}
                                  />
```

Leave the Info legend tooltip (lines 974-1002) as-is.

- [ ] **Step 5: Delete the PROGRESS body cell**

Remove the entire progress `<TableCell …>` block (lines 1093-1108: the `hasInstances ? <Progress…> : <Database…>` cell).

- [ ] **Step 6: Render `StatusRing` in the STATUS cell**

Replace the status cell body (line 1109-1111) so it reads:

```tsx
                      <TableCell className={`${TABLE_CELL_CLASS} text-center`} style={getColumnStyle('status')}>
                    <StatusRing progress={getProgress(article)} />
                  </TableCell>
```

- [ ] **Step 7: Render `StatusRing` in the card-mode meta**

In the `cardContent` `ListRowCard` `meta` (line 1192-1197), replace `{getStatusBadge(article)}` with `<StatusRing progress={progress} />`. The surrounding `meta` becomes:

```tsx
                                  meta={
                                      <>
                                          {article.publication_year != null && <span>{article.publication_year}</span>}
                                          <StatusRing progress={progress} />
                                      </>
                                  }
```

- [ ] **Step 8: Delete the now-unused `getStatusBadge`**

Remove the entire `getStatusBadge` function (lines 547-611).

- [ ] **Step 9: Collapse the two progress/status sort options into one**

In the `ListDisplaySortPopover` `sortOptions` array (lines 779-785), remove the `status` option and relabel `extraction_progress` to the Status column label. The array becomes:

```tsx
                      sortOptions={[
                          {value: 'title', label: t('extraction', 'tableColumnTitle')},
                          {value: 'publication_year', label: t('extraction', 'tableColumnYear')},
                          {value: 'extraction_progress', label: t('extraction', 'tableColumnStatus')},
                          {value: 'created_at', label: t('extraction', 'tableColumnCreatedAt')},
                      ]}
```

- [ ] **Step 10: Remove the dead `status` sort branch and type member**

In the `SortField` type (line 105) remove `'status'`:

```ts
type SortField = 'title' | 'publication_year' | 'extraction_progress' | 'created_at';
```

In the sort `switch` (line 420-447) delete the entire `case 'status': { … break; }` block (lines 433-443). The `extraction_progress` case (429-432) stays.

- [ ] **Step 11: Remove now-unused imports**

Delete `Progress` (line 16) and `Database` (line 23) imports. Keep `Circle` and `CheckCircle2` (still used by the Info legend, lines 988/996). Keep `Badge` only if still referenced elsewhere — if lint flags it, remove it too.

- [ ] **Step 12: Typecheck + lint + tests**

Run: `npm run lint && npm run test:run -- ArticleExtractionTable`
Expected: PASS, no unused-symbol or type errors. (The existing regression test stays green — it renders only the skeleton branch.)

- [ ] **Step 13: Commit**

```bash
git add frontend/components/extraction/ArticleExtractionTable.tsx
git commit -m "feat(extraction): status ring replaces PROGRESS+STATUS columns"
```

---

### Task 3: Adopt `StatusRing` + drop PROGRESS column in `HITLArticleTable`

**Files:**
- Modify: `frontend/components/hitl/HITLArticleTable.tsx`

- [ ] **Step 1: Import `StatusRing`**

Add `StatusRing` to the `@/components/shared/list` import block in `HITLArticleTable.tsx`.

- [ ] **Step 2: Delete the PROGRESS column header**

Remove the PROGRESS `<TableHead className={`${TABLE_CELL_CLASS} w-[16%]`}>…</TableHead>` block (lines 567-573).

- [ ] **Step 3: Widen the remaining columns**

Update the STATUS header width so the freed space is reabsorbed: change `<TableHead className={`${TABLE_CELL_CLASS} w-[8%]`}>` (line 574) to `w-[18%]` and the title header `w-[40%]` (line 548) to `w-[46%]`.

- [ ] **Step 4: Point the STATUS header sort at progress**

In the STATUS header `SortIconHeader` (lines 575-579) change the sort field from `status` to `progress` (HITL's exact-progress comparator key):

```tsx
                <SortIconHeader
                  label={t("extraction", "tableColumnStatus")}
                  direction={sortField === "progress" ? sortDirection : null}
                  onSort={() => handleSort("progress")}
                />
```

- [ ] **Step 5: Delete the PROGRESS body cell**

Remove the progress `<TableCell className={TABLE_CELL_CLASS}>…</TableCell>` block (lines 613-631: the custom bar + `{progress}%`).

- [ ] **Step 6: Render `StatusRing` in the STATUS cell**

Replace the status cell (lines 632-634) with:

```tsx
                  <TableCell className={TABLE_CELL_CLASS}>
                    <StatusRing progress={getProgress(article)} />
                  </TableCell>
```

- [ ] **Step 7: Delete the now-unused `renderStatus`**

Remove the entire `renderStatus` function (lines 363-428).

- [ ] **Step 8: Remove the now-dead `status` sort branch**

Locate the HITL sort `switch` (search `sortField`) and remove the `case "status"` branch if present; keep the `case "progress"` branch. Remove `"status"` from HITL's `SortField` union if it has one. Remove now-unused imports (`Badge`, `Circle`, `CheckCircle2`) if lint flags them.

- [ ] **Step 9: Lint + tests**

Run: `npm run lint && npm run test:run -- HITL`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend/components/hitl/HITLArticleTable.tsx
git commit -m "feat(qa): status ring replaces PROGRESS+STATUS in HITL table"
```

---

### Task 4: Static toolbar + pinned header — extraction worklist

**Files:**
- Modify: `frontend/pages/ProjectView.tsx:417-425`
- Modify: `frontend/components/extraction/ExtractionInterface.tsx:485-518`
- Modify: `frontend/components/extraction/ArticleExtractionTable.tsx:755,857,859`

**Why:** Today the page scroller (`ProjectView.tsx:420`, `flex-1 overflow-y-auto px-6 py-4`) scrolls the whole content including the table toolbar. We move vertical scroll into the table region so the toolbar is static by layout and the `thead` is pinned within that region.

- [ ] **Step 1: ProjectView — give extraction/quality a non-scrolling, full-height content frame**

Replace the content-area block (lines 417-425) with a branch that keeps the scrolling padded container for most tabs but gives extraction/quality a full-height flex frame whose child owns the scroll:

```tsx
      {isFullBleed ? (
          <div className="flex-1 overflow-y-auto">{renderContent()}</div>
      ) : activeTab === 'extraction' || activeTab === 'quality' ? (
          <div className="flex-1 min-h-0 flex flex-col px-6 py-4 lg:px-10">
              <div className="w-full max-w-[1800px] mx-auto flex flex-1 min-h-0 flex-col">
                  {renderContent()}
              </div>
          </div>
      ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 lg:px-10">
              <div className="w-full max-w-[1800px] mx-auto">
            {renderContent()}
          </div>
        </div>
      )}
```

- [ ] **Step 2: ExtractionInterface — fill height; scroll only non-worklist sub-views**

In `ExtractionInterface.tsx`, change the root return wrapper (line 486 `<div className="space-y-4">` and line 487 `<div className="mt-6">`) so the interface fills the frame and only the worklist sub-view delegates scroll to the table. Replace lines 486-518 region's outer wrappers with:

```tsx
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
                {templatesLoading ? (
                    <div className="space-y-4 px-0 py-2" aria-busy="true" aria-label={t('extraction', 'loadingTemplates')}>
```

(keep the existing skeleton markup), and wrap the `renderTabContent()` call so the worklist fills height while dashboard/config scroll:

```tsx
                ) : activeTab === 'extraction' ? (
                    <div className="flex min-h-0 flex-1 flex-col">{renderTabContent()}</div>
                ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto pb-4">{renderTabContent()}</div>
                )}
```

Close the wrapper `</div>` count to match. (The local `activeTab` here is the extraction sub-tab.)

- [ ] **Step 3: ArticleExtractionTable — toolbar static, table region scrolls, header pinned**

In `ArticleExtractionTable.tsx`:

- Change the ready-state root (line 755) from `<div className="space-y-2">` to:

```tsx
      <div className="flex h-full min-h-0 flex-col gap-2">
```

- The toolbar block stays directly inside; add `shrink-0` to its outer wrapper. Change line 757 `<div className="flex flex-col gap-2">` to `<div className="flex shrink-0 flex-col gap-2">`.

- Wrap the `ResponsiveList` (line 854) in a scrolling region. Immediately before `<ResponsiveList` open a `<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">` and close it after the `/>` (line 1250). The empty-state block (lines 1252-1261) stays after the close, inside the flex column.

- Pin the header: on the table-mode `<TableHeader className="bg-transparent">` (line 859) change to:

```tsx
                  <TableHeader className="sticky top-0 z-10 bg-background">
```

(The `DataTableWrapper` at line 857 already clips; the new scroll parent makes `sticky top-0` stick the header to the top of the scrolling table region.)

- [ ] **Step 4: Verify scroll behaviour (manual + design-review)**

Run the dev server, open the extraction worklist with enough rows to scroll. Confirm: the search/filter toolbar stays fixed, the column header stays visible, only the rows scroll; switching to Dashboard/Configuration scrolls normally. Capture a screenshot mid-scroll.

- [ ] **Step 5: Lint + tests**

Run: `npm run lint && npm run test:run -- ArticleExtractionTable`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/pages/ProjectView.tsx frontend/components/extraction/ExtractionInterface.tsx frontend/components/extraction/ArticleExtractionTable.tsx
git commit -m "feat(extraction): static toolbar + pinned header by layout"
```

---

### Task 5: Static toolbar + pinned header — QA (HITL) and Articles

**Files:**
- Modify: `frontend/components/quality/QualityAssessmentInterface.tsx` (assessment sub-view wrapper)
- Modify: `frontend/components/hitl/HITLArticleTable.tsx:~474,544,546`
- Modify: `frontend/pages/ProjectView.tsx:418` (articles frame)
- Modify: `frontend/components/articles/ArticlesList.tsx` (root + toolbar + thead)

- [ ] **Step 1: QualityAssessmentInterface — fill height; scroll only non-assessment sub-views**

Mirror Task 4 Step 2 in `QualityAssessmentInterface.tsx`: wrap its root content in `<div className="flex h-full min-h-0 flex-col">`, render the `assessment` sub-view inside `<div className="flex min-h-0 flex-1 flex-col">`, and dashboard/configuration inside `<div className="min-h-0 flex-1 overflow-y-auto pb-4">`. (Read the file's render switch first to place these around the `HITLArticleTable` branch.)

- [ ] **Step 2: HITLArticleTable — toolbar static, table region scrolls, header pinned**

In `HITLArticleTable.tsx`:
- Change the ready-state root container (the wrapper around the toolbar `<div className="space-y-2">` near line 474) to `<div className="flex h-full min-h-0 flex-col gap-2">` and mark the toolbar block `shrink-0`.
- Wrap the `DataTableWrapper` (line 544) in `<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">…</div>`.
- Pin the header: change `<TableHeader className="bg-transparent">` (line 546) to `<TableHeader className="sticky top-0 z-10 bg-background">`.

- [ ] **Step 3: ProjectView — give the articles tab a full-height frame**

Change the `isFullBleed` branch is unrelated; the Articles tab is non-fullbleed. Extend the Task 4 Step 1 condition to include articles so its list owns scroll:

```tsx
      ) : activeTab === 'extraction' || activeTab === 'quality' || activeTab === 'articles' ? (
```

(Articles' import-action band is the separate `shrink-0` block above and is unaffected.)

- [ ] **Step 4: ArticlesList — toolbar static, table region scrolls, header pinned**

In `ArticlesList.tsx`:
- Make the component root a `flex h-full min-h-0 flex-col gap-2` column; mark the toolbar block (the `<div>` containing `ListToolbarSearch`/`FilterButtonWithPopover`/`ListCount`, ending at the `ActiveFilterChips` close, line 1267) `shrink-0`.
- Wrap `{bodyContent}` (line 1270) in `<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{bodyContent}</div>`.
- Find the Articles table `<TableHeader>` (search for `TableHeader` in the file) and add `sticky top-0 z-10 bg-background` to its className.

- [ ] **Step 5: Verify + lint + tests**

Run the dev server; confirm QA assessment list and Articles list both keep toolbar + header fixed while rows scroll. Then:
Run: `npm run lint && npm run test:run -- "HITL|ArticlesList"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/quality/QualityAssessmentInterface.tsx frontend/components/hitl/HITLArticleTable.tsx frontend/pages/ProjectView.tsx frontend/components/articles/ArticlesList.tsx
git commit -m "feat(tables): static toolbar + pinned header for QA and Articles"
```

---

### Task 6: `sectionViews` config + `SectionViewSwitcher` component

**Files:**
- Create: `frontend/components/layout/sectionViews.ts`
- Create: `frontend/components/navigation/SectionViewSwitcher.tsx`
- Create: `frontend/components/navigation/SectionViewSwitcher.test.tsx`
- Modify: `frontend/lib/copy/extraction.ts` (add `tabWorklist`)
- Modify: `frontend/lib/copy/navigation.ts` (add view aria labels)

**Interfaces:**
- Produces: `getSectionViews(sectionId: string): SectionView[]` where `SectionView = { value: string; label: string; urlParam: string; managerOnly?: boolean }`.
- Produces: `SectionViewSwitcher(): JSX.Element | null` — reads the active section from `ProjectContext.activeTab`, the project id from `ProjectContext.project?.id`, the role from `useProjectMemberRole`, and the current sub-tab from `useSearchParams`; renders a centered segmented control and writes the section's `urlParam` on click. Returns `null` for sections without views.

- [ ] **Step 1: Add copy keys**

In `frontend/lib/copy/extraction.ts`, after line 39 (`tabExtraction: 'Extraction',`) add:

```ts
    tabWorklist: 'Worklist',
```

In `frontend/lib/copy/navigation.ts`, inside the `navigation` object add:

```ts
    viewsExtractionAria: 'Extraction views',
    viewsQualityAria: 'Quality assessment views',
    sectionDescriptionExtraction: 'Extract structured data using standard templates',
    sectionDescriptionQuality: 'Assess article quality with PROBAST, QUADAS-2, and other risk-of-bias tools',
```

- [ ] **Step 2: Create the section-views config**

Create `frontend/components/layout/sectionViews.ts`:

```ts
import { t } from '@/lib/copy';

export interface SectionView {
  value: string;
  label: string;
  urlParam: string;
  managerOnly?: boolean;
}

const sectionViews: Record<string, SectionView[]> = {
  extraction: [
    { value: 'extraction', label: t('extraction', 'tabWorklist'), urlParam: 'extractionTab' },
    { value: 'dashboard', label: t('extraction', 'tabDashboard'), urlParam: 'extractionTab' },
    { value: 'configuration', label: t('extraction', 'tabConfiguration'), urlParam: 'extractionTab', managerOnly: true },
  ],
  quality: [
    { value: 'assessment', label: t('qa', 'tabAssessment'), urlParam: 'qaTab' },
    { value: 'dashboard', label: t('qa', 'tabDashboard'), urlParam: 'qaTab' },
    { value: 'configuration', label: t('qa', 'tabConfiguration'), urlParam: 'qaTab', managerOnly: true },
  ],
};

export function getSectionViews(sectionId: string): SectionView[] {
  return sectionViews[sectionId] ?? [];
}

export const sectionDescriptionKey: Record<string, string> = {
  extraction: 'sectionDescriptionExtraction',
  quality: 'sectionDescriptionQuality',
};
```

- [ ] **Step 3: Write the failing test**

Create `frontend/components/navigation/SectionViewSwitcher.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProjectContext } from '@/contexts/ProjectContext';

vi.mock('@/lib/copy', () => ({ t: (_ns: string, key: string) => key }));

const roleMock = vi.fn();
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => roleMock(),
}));

import { SectionViewSwitcher } from '@/components/navigation/SectionViewSwitcher';

function renderWith(activeTab: string, initialEntries = ['/projects/p1?tab=extraction']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ProjectContext.Provider
        value={{ project: { id: 'p1' } as never, setProject: vi.fn(), activeTab, changeTab: vi.fn() } as never}
      >
        <SectionViewSwitcher />
      </ProjectContext.Provider>
    </MemoryRouter>,
  );
}

describe('SectionViewSwitcher', () => {
  it('renders nothing for a section without views', () => {
    roleMock.mockReturnValue({ isManager: false, role: null, loading: false });
    const { container } = renderWith('articles');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders Worklist/Dashboard for non-managers (no Configuration)', () => {
    roleMock.mockReturnValue({ isManager: false, role: 'extractor', loading: false });
    renderWith('extraction');
    expect(screen.getByRole('tab', { name: 'tabWorklist' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'tabDashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'tabConfiguration' })).toBeNull();
  });

  it('shows Configuration for managers', () => {
    roleMock.mockReturnValue({ isManager: true, role: 'manager', loading: false });
    renderWith('extraction');
    expect(screen.getByRole('tab', { name: 'tabConfiguration' })).toBeInTheDocument();
  });

  it('preserves the QA data-testid', () => {
    roleMock.mockReturnValue({ isManager: false, role: 'reviewer', loading: false });
    renderWith('quality', ['/projects/p1?tab=quality']);
    expect(screen.getByTestId('hitl-quality_assessment-tab-assessment')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:run -- SectionViewSwitcher`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 5: Implement the component**

Create `frontend/components/navigation/SectionViewSwitcher.tsx`:

```tsx
import { useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProjectContext } from '@/contexts/ProjectContext';
import { useProjectMemberRole } from '@/hooks/useProjectMemberRole';
import { getSectionViews } from '@/components/layout/sectionViews';
import { cn } from '@/lib/utils';
import { t } from '@/lib/copy';

export function SectionViewSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectContext = useContext(ProjectContext);
  const activeSection = projectContext?.activeTab ?? '';
  const projectId = projectContext?.project?.id ?? '';
  const hasViews = activeSection === 'extraction' || activeSection === 'quality';
  const { isManager } = useProjectMemberRole(hasViews ? projectId : '');

  const views = getSectionViews(activeSection).filter((v) => !v.managerOnly || isManager);
  if (views.length === 0) return null;

  const urlParam = views[0].urlParam;
  const fromUrl = searchParams.get(urlParam);
  const active = views.some((v) => v.value === fromUrl) ? (fromUrl as string) : views[0].value;

  const select = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(urlParam, value);
    setSearchParams(next, { replace: true });
  };

  return (
    <div
      role="tablist"
      aria-label={activeSection === 'quality' ? t('navigation', 'viewsQualityAria') : t('navigation', 'viewsExtractionAria')}
      className="flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5"
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
            'h-7 rounded px-3 text-[12px] font-medium transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:run -- SectionViewSwitcher`
Expected: PASS (4 tests). If `ProjectContext`'s value type rejects the test cast, adjust the test's provider value object to match the real `ProjectContextType` shape (it has `activeTab`, `changeTab`, `project`, `setProject`).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/layout/sectionViews.ts frontend/components/navigation/SectionViewSwitcher.tsx frontend/components/navigation/SectionViewSwitcher.test.tsx frontend/lib/copy/extraction.ts frontend/lib/copy/navigation.ts
git commit -m "feat(nav): section view-switcher + config"
```

---

### Task 7: Mount the switcher in the top-bar; remove the description+tabs band

**Files:**
- Modify: `frontend/components/navigation/Topbar.tsx:68-137`
- Modify: `frontend/pages/ProjectView.tsx:30-33,286-348`

**Interfaces:**
- Consumes: `SectionViewSwitcher` from `@/components/navigation/SectionViewSwitcher`; `sectionDescriptionKey` from `@/components/layout/sectionViews`.

- [ ] **Step 1: Top-bar — three-column grid with centered switcher and title tooltip**

In `Topbar.tsx`, import at top:

```tsx
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SectionViewSwitcher } from '@/components/navigation/SectionViewSwitcher';
import { sectionDescriptionKey } from '@/components/layout/sectionViews';
```

Change the main bar container (line 71) from `flex … justify-between` to a 3-column grid:

```tsx
          <div className="grid grid-cols-[1fr_auto_1fr] h-12 w-full items-center px-4 sm:px-6 shrink-0">
```

Keep the existing left section (toggle + title) as the first grid cell. Append an `(i)` description tooltip to the project-page title (replace the title `<span>` at lines 123-127) with:

```tsx
                  ) : (
                      <span className="flex items-center gap-1.5 min-w-0 px-2">
                        <span className="text-[13px] font-medium text-foreground truncate">
                          {tabIdToLabel[projectContext?.activeTab ?? ''] ?? t('layout', 'defaultProjectName')}
                        </span>
                        {sectionDescriptionKey[projectContext?.activeTab ?? ''] && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="text-muted-foreground/60 hover:text-foreground transition-colors" aria-label={t('navigation', sectionDescriptionKey[projectContext?.activeTab ?? ''])}>
                                  <Info className="h-3.5 w-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{t('navigation', sectionDescriptionKey[projectContext?.activeTab ?? ''])}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                  )}
```

Insert the centered switcher as the second grid cell, right after the left section's closing `</div>` (line 129):

```tsx
        <div className="flex items-center justify-center">
          {isProjectPage && <SectionViewSwitcher />}
        </div>
```

Wrap the existing right section (notifications + feedback, lines 132-135) so it right-aligns in the third grid cell:

```tsx
              <div className="flex items-center justify-end gap-1.5 shrink-0">
          <NotificationCenter />
          <FeedbackButton />
        </div>
```

- [ ] **Step 2: ProjectView — drop the band for extraction/quality (keep it for Articles)**

In `ProjectView.tsx`, change the band guard (line 286) from `{!isFullBleed && (` to render only when the tab has band content (Articles):

```tsx
        {activeTab === 'articles' && (
```

Then delete the now-unreachable extraction (`:294-320`) and quality (`:321-348`) tab `<div role="tablist">` blocks and the leading description `<span>` (`:289-293`) — the band body now contains only the Articles actions. (Read the resulting JSX and adjust the description `<span>` so Articles still shows its `'Articles'` label, or move that label into the Articles actions row.)

- [ ] **Step 3: Remove the dead `TAB_DESCRIPTIONS` constant**

Delete `TAB_DESCRIPTIONS` (lines 30-33) — its strings now live in `navigation` copy. Remove any remaining references.

- [ ] **Step 4: Verify + lint + tests**

Run the dev server: confirm the top-bar shows the centered switcher; switching views updates the URL and content; the `(i)` tooltip shows the description; Articles still shows its import band; deep-linking `?extractionTab=dashboard` selects Dashboard. Then:
Run: `npm run lint && npm run test:run`
Expected: PASS. Update any test that asserted the old in-`ProjectView` tab markup.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/navigation/Topbar.tsx frontend/pages/ProjectView.tsx
git commit -m "feat(nav): centered top-bar view-switcher; drop content tab band"
```

---

### Task 8: Selection cleanup — `ArticleExtractionTable`

**Files:**
- Modify: `frontend/components/extraction/ArticleExtractionTable.tsx:797-840`
- Modify: `frontend/lib/copy/extraction.ts` (add `tableSelectedCount`)

- [ ] **Step 1: Add the compact selection copy key**

In `frontend/lib/copy/extraction.ts`, after `tableArticlesSelected` (line 437) add:

```ts
    tableSelectedCount: '{{n}} selected',
```

- [ ] **Step 2: Collapse the count/selection block**

Replace the count + selection block (lines 797-840) so the idle count shows only when nothing is selected, the selected state is a single compact `"{{n}} selected"` + Actions, and the "Clear selection" button is gone:

```tsx
                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                      {selectedCount === 0 ? (
                          <ListCount
                              visible={filteredAndSortedArticles.length}
                              total={articles.length}
                              label={t('extraction', 'tableArticlesCount')}
                          />
                      ) : (
                          <div className="flex items-center gap-2 animate-in fade-in duration-200">
                              <span className="text-[11px] font-medium text-foreground tabular-nums">
                                  {t('extraction', 'tableSelectedCount').replace('{{n}}', String(selectedCount))}
                              </span>
                              <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]"
                                              disabled={isExtracting}>
                                          <MoreHorizontal className="h-4 w-4"/>
                                          {t('extraction', 'tableActions')}
                                      </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end"
                                                       className="w-56 border-border/50 shadow-elev-popover">
                                      <DropdownMenuLabel>{t('extraction', 'tableBatchActionsLabel')}</DropdownMenuLabel>
                                      <DropdownMenuSeparator/>
                                      <DropdownMenuItem onClick={handleBatchAIExtraction} disabled={isExtracting}
                                                        className="gap-2">
                                          <Sparkles className="h-4 w-4"/>
                                          <span className="text-[13px]">{t('extraction', 'tableAIExtraction')}</span>
                                      </DropdownMenuItem>
                                  </DropdownMenuContent>
                              </DropdownMenu>
                          </div>
                      )}
                  </div>
```

The header master checkbox (lines 866-881) already clears the selection when unchecked — no separate control needed. The `X` icon import and `tableClearSelection` key are now unused.

- [ ] **Step 3: Remove the now-unused `X` import and copy key**

If `X` (line 33) is unused elsewhere, remove it from the lucide import. Remove `tableClearSelection` (extraction.ts:443) once unreferenced (grep first: `grep -rn "tableClearSelection" frontend`).

- [ ] **Step 4: Lint + tests**

Run: `npm run lint && npm run test:run -- ArticleExtractionTable`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/ArticleExtractionTable.tsx frontend/lib/copy/extraction.ts
git commit -m "feat(extraction): collapse duplicated selection state"
```

---

### Task 9: Selection cleanup — `ArticlesList`

**Files:**
- Modify: `frontend/components/articles/ArticlesList.tsx:1236-1259`
- Modify: `frontend/lib/copy/articles.ts` (add `listSelectedCount`)

- [ ] **Step 1: Add the compact key**

In `frontend/lib/copy/articles.ts`, after `listSelected` (line 250) add:

```ts
    listSelectedCount: '{{n}} selected',
```

- [ ] **Step 2: Show the idle count only when nothing is selected**

Replace the count slot (lines 1236-1259) so the idle `ListCount` hides during a selection and the compact `"{{n}} selected"` + Delete action stands alone:

```tsx
                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                        {selectedArticles.size === 0 ? (
                            <ListCount
                                visible={filteredArticles.length}
                                total={articles.length}
                                label={articles.length === 1 ? t('articles', 'listArticle') : t('articles', 'listArticles')}
                            />
                        ) : (
                            <div className="flex items-center gap-2 animate-in fade-in duration-200">
                                <span className="text-[11px] font-medium text-foreground tabular-nums">
                                    {t('articles', 'listSelectedCount').replace('{{n}}', String(selectedArticles.size))}
                                </span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setBulkDeleteDialogOpen(true)}
                                    disabled={deleting}
                                    className="h-6 text-[11px] text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                    <Trash2 className="mr-1 h-3 w-3"/>
                                    {t('articles', 'listDelete')}
                                </Button>
                            </div>
                        )}
                    </div>
```

- [ ] **Step 3: Lint + tests**

Run: `npm run lint && npm run test:run -- ArticlesList`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/articles/ArticlesList.tsx frontend/lib/copy/articles.ts
git commit -m "feat(articles): collapse duplicated selection count"
```

---

### Task 10: Full gate + visual review

**Files:** none (verification only)

- [ ] **Step 1: Run the full quality gate**

Run: `make quality-scan`
Expected: lint + typecheck + vitest + architectural fitness all PASS. Fix anything flagged (e.g. residual unused imports) and amend the relevant commit.

- [ ] **Step 2: Visual design-review on the extraction route**

Run the `design-review` loop on the extraction worklist route: render → screenshot → compare to the Plane/Linear target (centered switcher, static toolbar, pinned header, progress ring, single selection indicator) → fix any drift → re-screenshot. Repeat for the QA assessment and Articles routes.

- [ ] **Step 3: E2E smoke (optional, if E2E env available)**

Run: `npm run test:e2e:local -- --grep "extraction|quality"`
Expected: PASS — view switching from the top-bar and the preserved `hitl-quality_assessment-tab-*` test ids keep working.

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin claude/gallant-goodall-5e9fa9
gh pr create --base dev --title "feat(tables): table-view UX consolidation" --body "Implements docs/superpowers/specs/2026-06-20-table-view-ux-design.md"
```

---

## Self-Review

**Spec coverage:** D1 status ring → Tasks 1-3. D2 static toolbar + pinned thead → Tasks 4-5. D3 centered top-bar switcher + Worklist rename + description tooltip → Tasks 6-7. D4 selection cleanup → Tasks 8-9. A1 surgical + shared-only-StatusRing → reflected throughout (only `StatusRing` and `SectionViewSwitcher`/`sectionViews` are new; no toolbar/DataTableWrapper abstraction). Copy changes → Tasks 1, 6, 8, 9. Testing → Tasks 1, 6 (unit) + per-task lint/vitest + Task 10 (gate + visual + E2E). Card-mode ring → Task 2 Step 7. URL/test-id preservation → Task 6 (data-testid) + Global Constraints.

**Placeholder scan:** No "TBD/TODO/handle edge cases". Two steps intentionally say "read the file first then place wrappers" (Task 5 Step 1, Task 7 Step 2) because the exact surrounding JSX of `QualityAssessmentInterface` and the post-deletion Articles band must be read at edit time; both give exact classes/conditions to apply.

**Type consistency:** `StatusRing({progress})`, `getSectionViews → SectionView[]`, `SectionView.{value,label,urlParam,managerOnly}`, copy keys (`statusInProgressPct`, `tabWorklist`, `tableSelectedCount`, `listSelectedCount`, `viewsExtractionAria`, `viewsQualityAria`, `sectionDescription*`) are used identically wherever referenced. Sort: extraction keeps `extraction_progress` (exact %), drops `status`; HITL keeps `progress`, drops `status`.
