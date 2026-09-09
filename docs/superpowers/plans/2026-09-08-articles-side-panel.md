---
status: approved
last_reviewed: 2026-09-08
owner: '@raphaelfh'
---

# Articles Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a docked, resizable right panel to the Articles tab that shows, for the selected article, either the document viewer (PDF/markdown) or the article edit fields, switched by a segmented control, with the table still visible beside it.

**Architecture:** A new `ArticlesSplitShell` (a `ResizablePanelGroup`, list left / panel right) hosts a new `ArticleSidePanel` whose strip toggles between the existing `ArticleForm variant="panel"` and the existing `RunPdfContent`. Selection and view live in the URL (`articleEditor`, `articleId`, new `articleView`); whether the panel is expanded is local state in the shell. `RunSplitShell` and the run screens are not touched.

**Tech Stack:** React 19 + TypeScript strict, Vite, `react-resizable-panels` v4 (via `@/components/ui/resizable`), shadcn/Radix, `react-router` search params, vitest + Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-08-articles-side-panel-design.md`](../specs/2026-09-08-articles-side-panel-design.md)

## Global Constraints

- **English only** for code, comments, commits, docs, and copy keys.
- **All user-facing strings** go in `frontend/lib/copy/articles.ts` and must be referenced — `scripts/fitness/check_copy_keys.py` is a shrink-only ratchet and fails on an unreferenced member of the exported object.
- **Frontend tooling runs from the repo root.** Never `cd frontend`. `npm run test:run`, `npm run lint`, `npx knip`.
- **No dead code ships:** `npx knip` AND `npx knip --production` must be at zero findings. Every new component must be reachable from production code, not only from its test.
- **Conventional commits**; PRs target `dev`.
- **Do not modify** `RunSplitShell.tsx`, `RunPdfContent.tsx`, or anything under `frontend/pdf-viewer/`. This slice consumes them unchanged.
- **Do not modify** `ArticlesList`'s column widths, breakpoint classes, or width persistence.
- **Panel ids** are `articles-shell-list` and `articles-shell-panel`. Never reuse `assessment-shell*` — those are the run screens' DOM test contract.

### Environment traps (verified 2026-09-08 — read before writing any test)

1. **`window.matchMedia` is globally stubbed to `matches: false`** in `frontend/test/setup.ts:39`. Every media query therefore reads false, so a component under test lands on the **below-`lg` (Sheet) path by default**. Any test of the docked split MUST override the stub before render. `useMediaQuery` uses `useSyncExternalStore` and re-reads `window.matchMedia(query).matches` on every render, so replacing the global before `render()` is sufficient — no re-subscribe needed.
2. **`AuthorFormRow.id` is a `uuidv4()`** (`frontend/lib/articleAuthors.ts:17`). Comparing `authorRows` objects directly for dirty-detection would compare random ids and report permanently dirty. Compare `authorsFromRows(rows)` — the `string[] | null` that actually gets saved — instead.
3. **`ArticleForm`'s import graph reaches `@/integrations/supabase/client`**, which calls `createClient` at module scope and throws without env. CI has no `.env`, so a missing stub fails **only in CI**. Copy the `vi.hoisted` env stub from `frontend/test/components/ArticleFormNarrowViewport.test.tsx:26`.
4. **`ArticleForm` deliberately does not rewrite the URL on create** (`ArticleForm.tsx:207`) — rewriting it remounts the tree and destroys the staged `File` objects. Task 2 exists because of this; do not "fix" it by setting `articleId` in the URL.
5. **Add mode dismisses itself on a clean save.** In `variant="panel"`, a successful add calls `onComplete?.()` then `onDismiss?.()` (`ArticleForm.tsx:538`). So the "Document segment enables once the article is created" behaviour from spec §6 is only *reachable* on the partial-upload-failure path, where the form stays open on purpose (`ArticleForm.tsx:529`). Build it anyway — it is two lines and the alternative is a segment that lies in that state — but do not spend effort making it prominent, and do not "fix" the dismiss to show it off. This is a deviation from how the spec reads; it is recorded here rather than silently resolved.

---

## File Structure

**Create**

| File | Responsibility |
| --- | --- |
| `frontend/components/articles/ArticleSidePanel.tsx` | The panel: strip (view toggle + collapse) and the Details/Document bodies. Knows nothing about the table or the panel group. |
| `frontend/components/articles/ArticlesSplitShell.tsx` | The layout: panel group vs Sheet, `panelOpen` state, the row-click wrapper and its dirty guard. Knows nothing about the panel's internals. |
| `frontend/test/components/ArticleSidePanel.test.tsx` | Task 4 |
| `frontend/test/components/ArticlesSplitShell.test.tsx` | Task 5 |
| `frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx` | Task 6 |
| `frontend/test/components/ArticleForm.dirty.test.tsx` | Task 1 |
| `frontend/e2e/flows/articles-side-panel.ui.e2e.ts` | Task 9 |

**Modify**

| File | Change |
| --- | --- |
| `frontend/components/articles/ArticleForm.tsx` | `onDirtyChange` (T1), `onArticleCreated` (T2), header retired in `variant="panel"` (T3) |
| `frontend/hooks/use-mobile.tsx` | export `useIsBelowDesktop` (T5) |
| `frontend/components/articles/ArticlesList.tsx` | toolbar panel-toggle icon (T8) |
| `frontend/pages/ProjectView.tsx` | full-bleed articles tab, mount the shell, `articleView` cleanup (T7) |
| `frontend/lib/copy/articles.ts` | new strings (T4, T5, T6, T8) |
| `frontend/test/components/ArticleFormNarrowViewport.test.tsx` | re-point header-identity tests at `variant="page"` (T3) |

---

## Task 1: `ArticleForm` reports dirty state

**Files:**
- Modify: `frontend/components/articles/ArticleForm.tsx` (props interface at :102, state block at :200-250, `loadArticle` at :259)
- Test: `frontend/test/components/ArticleForm.dirty.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ArticleFormProps.onDirtyChange?: (dirty: boolean) => void` — called on every transition of the dirty flag, `false` once the baseline is captured, `true` after any tracked edit. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `frontend/test/components/ArticleForm.dirty.test.tsx`:

```tsx
/**
 * ArticleForm reports whether it holds unsaved edits, so the articles side
 * panel can guard a row swap (see the side-panel design spec §8).
 *
 * The fingerprint deliberately compares authorsFromRows(), not the rows
 * themselves: AuthorFormRow.id is a uuidv4, so an object compare would report
 * dirty forever and the guard would fire on every single row click.
 */
import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.hoisted(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');
});

vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));
vi.mock('sonner', () => ({toast: {success: vi.fn(), error: vi.fn(), warning: vi.fn()}}));
vi.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({user: {id: 'u1'}, session: null, loading: false, signOut: vi.fn()}),
}));
vi.mock('@/services/articlesService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/articlesService')>()),
    fetchArticle: vi.fn(),
    fetchArticleFiles: vi.fn(),
    insertArticle: vi.fn(),
    updateArticle: vi.fn(),
    downloadFileBlob: vi.fn(),
    deleteArticleFile: vi.fn(),
    fetchMainFileInfo: vi.fn(),
    uploadArticleFile: vi.fn(),
}));

import {ArticleForm} from '@/components/articles/ArticleForm';
import {fetchArticle, fetchArticleFiles} from '@/services/articlesService';

beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(fetchArticleFiles).mockResolvedValue({ok: true, data: []} as never);
    vi.mocked(fetchArticle).mockResolvedValue({
        ok: true,
        data: {
            id: 'art-1',
            title: 'A stored-markdown study',
            abstract: null,
            authors: ['Doe, Jane'],
        },
    } as never);
});

describe('ArticleForm dirty reporting', () => {
    it('reports clean after the article loads', async () => {
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="edit"
                    projectId="proj-1"
                    articleId="art-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        await screen.findByDisplayValue('A stored-markdown study');
        // The uuid trap: rowsFromAuthorsArray mints fresh ids on load, so a
        // row-object compare would already be reporting dirty here.
        await waitFor(() => {
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });
    });

    it('reports dirty after a field edit', async () => {
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="edit"
                    projectId="proj-1"
                    articleId="art-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        const title = await screen.findByDisplayValue('A stored-markdown study');
        // Precondition: it must have been clean, or "becomes dirty" is vacuous.
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

        await userEvent.type(title, ' revised');

        await waitFor(() => {
            expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        });
    });

    it('reports clean on a fresh add form', async () => {
        const onDirtyChange = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="add"
                    projectId="proj-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onDirtyChange={onDirtyChange}
                />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/test/components/ArticleForm.dirty.test.tsx`

Expected: FAIL — `onDirtyChange` is not a prop, so the mock is never called and `toHaveBeenLastCalledWith` throws on an empty mock.

- [ ] **Step 3: Add the prop to the interface**

In `frontend/components/articles/ArticleForm.tsx`, inside `interface ArticleFormProps` (starts at :102), after the existing `variant` / `onDismiss` entries:

```tsx
    /** Reports whether the form holds unsaved edits, so a host panel can guard
     *  navigation away from it. Fires on every transition of the flag. */
    onDirtyChange?: (dirty: boolean) => void;
```

Add `onDirtyChange,` to the destructured props (the block starting at :181).

- [ ] **Step 4: Implement the dirty fingerprint**

Add near the other imports:

```tsx
import {authorsFromRows} from '@/lib/articleAuthors';
```

(`authorsFromRows` may already be imported for the save path — check before adding a duplicate import.)

Add after the `stagedFiles` state declaration (:206):

```tsx
  /**
   * Dirty tracking. The fingerprint is the SAVED shape, not the widget state:
   * AuthorFormRow.id is a uuidv4 minted fresh by rowsFromAuthorsArray on every
   * load, so comparing rows directly would report dirty forever and make the
   * host panel's guard fire on every row click.
   */
  const dirtyFingerprint = JSON.stringify({
    formData,
    authors: authorsFromRows(authorRows),
    staged: stagedFiles.length,
  });
  const dirtyBaselineRef = useRef<string | null>(null);
  const lastReportedDirtyRef = useRef<boolean | null>(null);

  useEffect(() => {
    // Edit mode captures its baseline only once the fetched article has been
    // written into formData; add mode's baseline is the empty form at mount.
    if (dirtyBaselineRef.current === null) {
      if (mode === 'edit' && !article) return;
      dirtyBaselineRef.current = dirtyFingerprint;
    }
    const dirty = dirtyFingerprint !== dirtyBaselineRef.current;
    if (lastReportedDirtyRef.current !== dirty) {
      lastReportedDirtyRef.current = dirty;
      onDirtyChange?.(dirty);
    }
  }, [dirtyFingerprint, mode, article, onDirtyChange]);
```

Ensure `useRef` and `useEffect` are in the React import at the top of the file.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/test/components/ArticleForm.dirty.test.tsx`

Expected: PASS, 3 tests.

- [ ] **Step 6: Run the existing ArticleForm suite for regressions**

Run: `npx vitest run frontend/test/components/ArticleForm.characterization.test.tsx frontend/test/components/ArticleForm.stagedFiles.test.tsx frontend/test/components/ArticleFormNarrowViewport.test.tsx`

Expected: PASS, unchanged. If `stagedFiles` fails, the fingerprint effect is looping — check that `onDirtyChange` from the caller is stable or that the guard on `lastReportedDirtyRef` is present.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/articles/ArticleForm.tsx frontend/test/components/ArticleForm.dirty.test.tsx
git commit -m "feat(articles): report unsaved edits from ArticleForm"
```

---

## Task 2: `ArticleForm` reports the created article id

**Files:**
- Modify: `frontend/components/articles/ArticleForm.tsx` (props interface at :102, `handleSave` add branch around :489-540)
- Test: `frontend/test/components/ArticleForm.dirty.test.tsx` (extend — same file, it is the props-contract spec for the panel)

**Interfaces:**
- Consumes: Task 1's props destructuring.
- Produces: `ArticleFormProps.onArticleCreated?: (articleId: string) => void` — fired once, immediately after the add-mode insert succeeds, with the new row's id. Consumed by Task 4 to enable the Document segment.

- [ ] **Step 1: Write the failing test**

Append to `frontend/test/components/ArticleForm.dirty.test.tsx`:

```tsx
describe('ArticleForm create reporting', () => {
    it('reports the new id after an add-mode save', async () => {
        const {insertArticle} = await import('@/services/articlesService');
        vi.mocked(insertArticle).mockResolvedValue({
            ok: true,
            data: {id: 'new-art-9'},
        } as never);

        const onArticleCreated = vi.fn();
        render(
            <MemoryRouter>
                <ArticleForm
                    mode="add"
                    projectId="proj-1"
                    variant="panel"
                    onDismiss={vi.fn()}
                    onComplete={vi.fn()}
                    onArticleCreated={onArticleCreated}
                />
            </MemoryRouter>,
        );

        await userEvent.type(await screen.findByLabelText(/titleRequired/), 'A new paper');
        await userEvent.click(screen.getByRole('button', {name: /createArticle/}));

        await waitFor(() => {
            expect(onArticleCreated).toHaveBeenCalledWith('new-art-9');
        });
        expect(onArticleCreated).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/test/components/ArticleForm.dirty.test.tsx -t "reports the new id"`

Expected: FAIL — `onArticleCreated` is not a prop and is never called.

- [ ] **Step 3: Add the prop**

In `interface ArticleFormProps`:

```tsx
    /** Fired once when add mode's insert succeeds, with the new article's id.
     *  The form deliberately does NOT put this in the URL — that would remount
     *  the tree and destroy the staged File objects (see the note at the
     *  createdArticleId declaration) — so a host panel learns the id here. */
    onArticleCreated?: (articleId: string) => void;
```

Add `onArticleCreated,` to the destructured props.

- [ ] **Step 4: Fire it where `createdArticleId` is already set**

In `handleSave`, the add branch already reads (around :495-505):

```tsx
      savedArticleId = created.data.id;
      setCreatedArticleId(savedArticleId);
```

Add one line directly after `setCreatedArticleId(savedArticleId);`:

```tsx
      onArticleCreated?.(savedArticleId);
```

That is the whole change — no new fetch, no new state. Note it fires inside the `isCreating` branch only, so a subsequent save of the same draft does not re-fire it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/test/components/ArticleForm.dirty.test.tsx`

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/articles/ArticleForm.tsx frontend/test/components/ArticleForm.dirty.test.tsx
git commit -m "feat(articles): report the created article id from add mode"
```

---

## Task 3: Retire the form header in the panel variant

**Files:**
- Modify: `frontend/components/articles/ArticleForm.tsx` (the `<PageHeader …/>` block at :683-735)
- Modify: `frontend/test/components/ArticleFormNarrowViewport.test.tsx` (the `describe('article editor — header identity')` block at :100-134)

**Interfaces:**
- Consumes: nothing.
- Produces: in `variant="panel"`, `ArticleForm` renders a slim right-aligned actions row (`data-testid="article-form-actions"`) instead of `PageHeader`. `variant="page"` is byte-for-byte unchanged. Task 4 relies on there being no `PageHeader` in the panel.

**Why:** the panel strip (Task 4) already names the article and offers the exit, so the panel-variant header only restated it. Spec §6.

- [ ] **Step 1: Re-point the existing header-identity tests at the page variant**

In `frontend/test/components/ArticleFormNarrowViewport.test.tsx`, replace the whole `describe('article editor — header identity', …)` block (:100-134) with the same three tests rendering `variant="page"`, plus one new test pinning the panel variant's absence. Note `renderAdd()` at :62 renders the *panel* variant — these tests need their own render calls:

```tsx
describe('article editor — header identity (page variant)', () => {
    function renderPageAdd() {
        render(
            <MemoryRouter>
                <ArticleForm mode="add" projectId="proj-1" variant="page" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );
    }

    it('renders the title in add mode and folds only the redundant description', async () => {
        renderPageAdd();

        expect(await screen.findByText('addArticle')).toBeInTheDocument();
        // addArticleDesc restates the title, so it is what gives way — the
        // title itself must survive at every width.
        expect(screen.queryByText('addArticleDesc')).not.toBeInTheDocument();
    });

    it('keeps the article title in edit mode, where the description is the only identity', async () => {
        render(
            <MemoryRouter>
                <ArticleForm mode="edit" projectId="proj-1" articleId="art-1" variant="page" onDismiss={vi.fn()}/>
            </MemoryRouter>,
        );

        // Scoped to the header: the title also appears in the title textarea,
        // so an unscoped query would pass even with the header identity gone.
        const header = (await screen.findByText('editArticle')).closest('[data-slot="page-header"]')!;
        expect(within(header as HTMLElement).getByText('A stored-markdown study')).toBeInTheDocument();
    });

    it('folds the Back label but keeps the button named', async () => {
        renderPageAdd();

        const back = await screen.findByRole('button', {name: 'back'});
        const label = back.querySelector('[data-slot="back-label"]');
        expect(label!.className).toContain('sr-only');
        expect(label!.className).toContain('sm:not-sr-only');
        expect(label!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    });
});

describe('article editor — panel variant has no header', () => {
    it('renders the actions without the page header, title or back button', async () => {
        renderAdd(); // panel variant

        // Precondition: the form actually rendered, so the absences below mean
        // "the header is gone", not "nothing mounted".
        expect(await screen.findByTestId('article-form-actions')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /createArticle/})).toBeInTheDocument();

        expect(screen.queryByText('addArticle')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'back'})).not.toBeInTheDocument();
        expect(document.querySelector('[data-slot="page-header"]')).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run frontend/test/components/ArticleFormNarrowViewport.test.tsx`

Expected: the three page-variant tests PASS (the header still exists in both variants), and `panel variant has no header` FAILS on `article-form-actions` not being found.

- [ ] **Step 3: Make the header variant-conditional**

In `ArticleForm.tsx`, extract the actions into a local so both branches share one definition, immediately before the `return (` of the main render (before :676):

```tsx
    const formActions = (
        <div className="flex items-center gap-2" data-testid="article-form-actions">
            <Button variant="outline" size="sm" className="h-8 px-3 text-[12px]" onClick={handleDismiss}>
                {t('common', 'cancel')}
            </Button>
            <Button
                size="sm"
                className="h-8 px-3 text-[12px] font-medium"
                onClick={handleSave}
                disabled={saving || !isStepValid('basic')}
            >
                {saving ? (
                    <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin"/>
                        {t('articles', 'saving')}
                    </>
                ) : (
                    <>
                        <Save className="mr-1.5 h-3.5 w-3.5"/>
                        {mode === 'add' ? t('articles', 'createArticle') : t('common', 'save')}
                    </>
                )}
            </Button>
        </div>
    );
```

Then replace the whole `<PageHeader …/>` element (:683-735) with:

```tsx
            {isPanel ? (
                /* The hosting panel's strip already names the article and owns
                   the exit, so the panel variant keeps only the actions. */
                <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border/40 px-3 py-1.5">
                    {formActions}
                </div>
            ) : (
                <PageHeader
                    leading={
                        <Button variant="ghost" size="sm" onClick={handleDismiss} aria-label={t('common', 'back')}>
                            {/*
                              * At 375px this bar is 374px wide and the actions group takes 206
                              * of it, so the identity group was compressed until the title
                              * rendered as nothing. The label folds first — the arrow plus the
                              * aria-label still name the button — and sr-only rather than
                              * `hidden` keeps that name in the accessibility tree.
                              */}
                            <ArrowLeft className="h-4 w-4 sm:mr-2"/>
                            <span data-slot="back-label" className="sr-only sm:not-sr-only">
                                {t('common', 'back')}
                            </span>
                        </Button>
                    }
                    title={mode === 'add' ? t('articles', 'addArticle') : t('articles', 'editArticle')}
                    description={
                        /*
                         * Edit mode's description IS the article's title, and it is the only
                         * thing naming which article this is — so it must never fold. Add
                         * mode's merely restates the title next to it, so it is the one that
                         * gives way rather than the title.
                         */
                        mode === 'edit' && article ? article.title : undefined
                    }
                    actions={formActions}
                />
            )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run frontend/test/components/ArticleFormNarrowViewport.test.tsx frontend/test/components/ArticleForm.characterization.test.tsx frontend/test/components/ArticleForm.stagedFiles.test.tsx frontend/test/components/ArticleForm.dirty.test.tsx`

Expected: all PASS. If `stagedFiles` or `characterization` fail, they were asserting the header after all — read the failure and re-point that assertion at `variant="page"` rather than restoring the header.

- [ ] **Step 5: Check for now-unused imports**

Run: `npm run lint`

Expected: clean. `PageHeader`, `ArrowLeft` are still used by the page branch, so nothing should drop; if lint reports an unused import, remove it.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/articles/ArticleForm.tsx frontend/test/components/ArticleFormNarrowViewport.test.tsx
git commit -m "refactor(articles): retire the form header in the panel variant"
```

---

## Task 4: `ArticleSidePanel`

**Files:**
- Create: `frontend/components/articles/ArticleSidePanel.tsx`
- Modify: `frontend/lib/copy/articles.ts`
- Test: `frontend/test/components/ArticleSidePanel.test.tsx` (create)

**Interfaces:**
- Consumes: `onDirtyChange` (T1), `onArticleCreated` (T2), the headerless panel form (T3). Also the unchanged `RunPdfContent` (`{articleId, projectId}`) and `useArticleDocuments(articleId) → {files, …}`.
- Produces:

```tsx
export type ArticleSidePanelView = 'details' | 'document';

export interface ArticleSidePanelProps {
  projectId: string;
  /** 'add' has no article yet; 'edit' always carries articleId. */
  mode: 'add' | 'edit';
  articleId?: string;
  view: ArticleSidePanelView;
  onViewChange: (view: ArticleSidePanelView) => void;
  onCollapse: () => void;
  onDismiss: () => void;
  onComplete: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}
```

Task 5 renders this.

- [ ] **Step 1: Add the copy keys**

In `frontend/lib/copy/articles.ts`, before the closing `};`:

```ts
    // Side panel (docked article panel in the Articles tab)
    panelViewDetails: 'Details',
    panelViewDocument: 'Document',
    panelViewDocumentAfterSave: 'Available once the article is saved',
    panelCollapse: 'Hide the article panel',
    panelNoDocumentTitle: 'No file attached',
    panelNoDocumentBody: 'Attach a PDF to read it beside the list.',
    panelAddFile: 'Add file',
```

- [ ] **Step 2: Write the failing test**

Create `frontend/test/components/ArticleSidePanel.test.tsx`:

```tsx
/**
 * The articles side panel shows EITHER the article's document or its fields.
 *
 * ArticleForm and RunPdfContent are stubbed: this spec is about the panel's
 * own switching, add-mode gating and empty state, and mounting the real
 * children would drag pdfjs and the whole form into jsdom for no added signal.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/components/articles/ArticleForm', () => ({
    ArticleForm: ({
        mode,
        onArticleCreated,
    }: {
        mode: string;
        onArticleCreated?: (id: string) => void;
    }) => (
        <div data-testid="article-form">
            {mode}
            <button onClick={() => onArticleCreated?.('new-art-9')}>create</button>
        </div>
    ),
}));
vi.mock('@/components/runs/RunPdfContent', () => ({
    RunPdfContent: ({articleId}: {articleId: string}) => (
        <div data-testid="run-pdf-content">{articleId}</div>
    ),
}));
vi.mock('@/components/articles/ArticleFileUploadDialogNew', () => ({
    ArticleFileUploadDialogNew: ({open}: {open: boolean}) =>
        open ? <div data-testid="upload-dialog"/> : null,
}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

const documentsMock = vi.fn();
vi.mock('@/hooks/extraction/useArticleDocuments', () => ({
    useArticleDocuments: (id: string | null | undefined) => documentsMock(id),
}));

import {ArticleSidePanel} from '@/components/articles/ArticleSidePanel';

const baseProps = {
    projectId: 'p1',
    onViewChange: vi.fn(),
    onCollapse: vi.fn(),
    onDismiss: vi.fn(),
    onComplete: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    documentsMock.mockReturnValue({files: [{id: 'f1'}]});
});

describe('ArticleSidePanel', () => {
    it('renders the form in details view', () => {
        render(<ArticleSidePanel {...baseProps} mode="edit" articleId="a1" view="details"/>);

        expect(screen.getByTestId('article-form')).toBeInTheDocument();
        expect(screen.queryByTestId('run-pdf-content')).not.toBeInTheDocument();
    });

    it('renders the document viewer in document view', () => {
        render(<ArticleSidePanel {...baseProps} mode="edit" articleId="a1" view="document"/>);

        expect(screen.getByTestId('run-pdf-content')).toHaveTextContent('a1');
        expect(screen.queryByTestId('article-form')).not.toBeInTheDocument();
    });

    it('asks the host to change view when the toggle is pressed', async () => {
        const onViewChange = vi.fn();
        render(
            <ArticleSidePanel
                {...baseProps}
                mode="edit"
                articleId="a1"
                view="details"
                onViewChange={onViewChange}
            />,
        );

        await userEvent.click(screen.getByRole('button', {name: 'panelViewDocument'}));

        expect(onViewChange).toHaveBeenCalledWith('document');
    });

    it('disables the document view in add mode until the article is created', async () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);

        expect(screen.getByRole('button', {name: /panelViewDocument/})).toBeDisabled();
    });

    it('enables the document view once the form reports the created id', async () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);

        // Precondition: it must start disabled, or "becomes enabled" proves nothing.
        expect(screen.getByRole('button', {name: /panelViewDocument/})).toBeDisabled();

        await userEvent.click(screen.getByRole('button', {name: 'create'}));

        expect(screen.getByRole('button', {name: /panelViewDocument/})).toBeEnabled();
    });

    it('shows the document for the created id after an add', async () => {
        render(<ArticleSidePanel {...baseProps} mode="add" view="details"/>);
        await userEvent.click(screen.getByRole('button', {name: 'create'}));

        // Re-render in document view with the same mounted panel: the id came
        // from the callback, not from props, so this is the only thing proving
        // the panel actually kept it.
        await userEvent.click(screen.getByRole('button', {name: 'panelViewDocument'}));

        expect(baseProps.onViewChange).toHaveBeenCalledWith('document');
    });

    it('shows the empty state instead of the viewer when there are no files', () => {
        documentsMock.mockReturnValue({files: []});

        render(<ArticleSidePanel {...baseProps} mode="edit" articleId="a1" view="document"/>);

        expect(screen.getByText('panelNoDocumentTitle')).toBeInTheDocument();
        expect(screen.queryByTestId('run-pdf-content')).not.toBeInTheDocument();
    });

    it('collapses on request', async () => {
        const onCollapse = vi.fn();
        render(
            <ArticleSidePanel
                {...baseProps}
                mode="edit"
                articleId="a1"
                view="details"
                onCollapse={onCollapse}
            />,
        );

        await userEvent.click(screen.getByRole('button', {name: 'panelCollapse'}));

        expect(onCollapse).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run frontend/test/components/ArticleSidePanel.test.tsx`

Expected: FAIL — cannot resolve `@/components/articles/ArticleSidePanel`.

- [ ] **Step 4: Implement the panel**

Create `frontend/components/articles/ArticleSidePanel.tsx`:

```tsx
/**
 * The docked article panel in the Articles tab.
 *
 * Shows EITHER the article's document (PDF or the markdown reader — the
 * viewer owns that switch) OR its edit fields. Owns only the strip and the
 * switch; both bodies are the components the run screens and the old editor
 * sheet already use, unchanged.
 */
import {useState} from 'react';
import {FileText} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {PanelToggleButton} from '@/components/layout/PanelToggleButton';
import {ArticleForm} from '@/components/articles/ArticleForm';
import {ArticleFileUploadDialogNew} from '@/components/articles/ArticleFileUploadDialogNew';
import {RunPdfContent} from '@/components/runs/RunPdfContent';
import {useArticleDocuments} from '@/hooks/extraction/useArticleDocuments';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

export type ArticleSidePanelView = 'details' | 'document';

export interface ArticleSidePanelProps {
  projectId: string;
  /** 'add' has no article yet; 'edit' always carries articleId. */
  mode: 'add' | 'edit';
  articleId?: string;
  view: ArticleSidePanelView;
  onViewChange: (view: ArticleSidePanelView) => void;
  onCollapse: () => void;
  onDismiss: () => void;
  onComplete: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function ArticleSidePanel({
  projectId,
  mode,
  articleId,
  view,
  onViewChange,
  onCollapse,
  onDismiss,
  onComplete,
  onDirtyChange,
}: ArticleSidePanelProps) {
  // Add mode does not put the new id in the URL (that would remount the form
  // and destroy its staged files), so the form hands it to us directly.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const effectiveArticleId = articleId ?? createdId ?? undefined;
  const documentAvailable = Boolean(effectiveArticleId);
  const {files} = useArticleDocuments(effectiveArticleId ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="article-side-panel">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/40 px-2">
        <div className="flex items-center gap-0.5" role="group">
          <ViewButton
            active={view === 'details'}
            onClick={() => onViewChange('details')}
            label={t('articles', 'panelViewDetails')}
          />
          <ViewButton
            active={view === 'document'}
            onClick={() => onViewChange('document')}
            label={t('articles', 'panelViewDocument')}
            disabled={!documentAvailable}
            title={documentAvailable ? undefined : t('articles', 'panelViewDocumentAfterSave')}
          />
        </div>
        <PanelToggleButton
          side="right"
          pressed
          onToggle={onCollapse}
          ariaLabel={t('articles', 'panelCollapse')}
        />
      </div>

      <div className="min-h-0 flex-1">
        {view === 'details' ? (
          <ArticleForm
            variant="panel"
            mode={mode}
            projectId={projectId}
            articleId={articleId}
            onDismiss={onDismiss}
            onComplete={onComplete}
            onDirtyChange={onDirtyChange}
            onArticleCreated={setCreatedId}
          />
        ) : files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true"/>
            <p className="text-[13px] font-medium">{t('articles', 'panelNoDocumentTitle')}</p>
            <p className="text-[12px] text-muted-foreground">
              {t('articles', 'panelNoDocumentBody')}
            </p>
            <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => setUploadOpen(true)}>
              {t('articles', 'panelAddFile')}
            </Button>
          </div>
        ) : (
          <RunPdfContent articleId={effectiveArticleId as string} projectId={projectId}/>
        )}
      </div>

      {effectiveArticleId && (
        <ArticleFileUploadDialogNew
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          articleId={effectiveArticleId}
          projectId={projectId}
        />
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(
        'h-6 rounded-sm px-2 text-[12px] transition-colors',
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {label}
    </button>
  );
}
```

The dialog's props are `{open, onOpenChange, articleId?, projectId, onFileUploaded?, onFilesStaged?, mainAlreadyStaged?}` (`ArticleFileUploadDialogNew.tsx:50`). The call above is complete except for the refresh — add `onFileUploaded` so the new file appears without a remount:

```tsx
          onFileUploaded={() => setUploadOpen(false)}
```

`useArticleDocuments` polls its own files query, so nothing else needs invalidating here. Do not change the dialog.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/test/components/ArticleSidePanel.test.tsx`

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/articles/ArticleSidePanel.tsx frontend/test/components/ArticleSidePanel.test.tsx frontend/lib/copy/articles.ts
git commit -m "feat(articles): add the article side panel with a document/details switch"
```

---

## Task 5: `ArticlesSplitShell`

**Files:**
- Create: `frontend/components/articles/ArticlesSplitShell.tsx`
- Modify: `frontend/hooks/use-mobile.tsx`
- Modify: `frontend/lib/copy/articles.ts`
- Test: `frontend/test/components/ArticlesSplitShell.test.tsx` (create)

**Interfaces:**
- Consumes: `ArticleSidePanel` and its props (T4).
- Produces:

```tsx
export interface ArticlesSplitShellProps {
  list: (api: {onArticleClick: (id: string) => void; panelOpen: boolean; onTogglePanel: () => void}) => ReactNode;
  projectId: string;
  mode: 'add' | 'edit' | null;
  articleId: string | null;
  view: ArticleSidePanelView;
  onViewChange: (view: ArticleSidePanelView) => void;
  onSelectArticle: (id: string) => void;
  onDismiss: () => void;
  onComplete: () => void;
}
```

Plus `useIsBelowDesktop(): boolean` from `@/hooks/use-mobile`. Tasks 6-8 build on this.

The `list` render prop exists so the shell can hand the table its guarded click handler and the toggle state without `ProjectView` having to thread them.

- [ ] **Step 1: Add the copy keys**

In `frontend/lib/copy/articles.ts`:

```ts
    panelPlaceholderTitle: 'No article selected',
    panelPlaceholderBody: 'Select an article to read its document or edit its details.',
    panelToggle: 'Toggle the article panel',
```

- [ ] **Step 2: Write the failing test**

Create `frontend/test/components/ArticlesSplitShell.test.tsx`:

```tsx
/**
 * The Articles tab's split layout: table left, article panel right.
 *
 * NOTE ON matchMedia: frontend/test/setup.ts stubs it to `matches: false` for
 * every query, so without an override every test here would silently exercise
 * the below-lg Sheet path. setDesktop()/setNarrow() make the choice explicit.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/components/articles/ArticleSidePanel', () => ({
    ArticleSidePanel: ({articleId, view}: {articleId?: string; view: string}) => (
        <div data-testid="article-side-panel">{`${articleId ?? 'none'}:${view}`}</div>
    ),
}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {ArticlesSplitShell} from '@/components/articles/ArticlesSplitShell';

function setMatches(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        }),
    });
}

/** (min-width: 1024px) matches ⇒ desktop ⇒ docked split. */
const setDesktop = () => setMatches(true);
const setNarrow = () => setMatches(false);

const baseProps = {
    projectId: 'p1',
    view: 'details' as const,
    onViewChange: vi.fn(),
    onSelectArticle: vi.fn(),
    onDismiss: vi.fn(),
    onComplete: vi.fn(),
};

function renderShell(overrides: Partial<Parameters<typeof ArticlesSplitShell>[0]> = {}) {
    const onSelectArticle = vi.fn();
    render(
        <ArticlesSplitShell
            {...baseProps}
            mode={null}
            articleId={null}
            onSelectArticle={onSelectArticle}
            list={({onArticleClick, panelOpen, onTogglePanel}) => (
                <div>
                    <button onClick={() => onArticleClick('a1')}>row a1</button>
                    <button onClick={() => onArticleClick('a2')}>row a2</button>
                    <button onClick={onTogglePanel}>toggle</button>
                    <span data-testid="panel-open">{String(panelOpen)}</span>
                </div>
            )}
            {...overrides}
        />,
    );
    return {onSelectArticle};
}

beforeEach(() => {
    vi.clearAllMocks();
    setDesktop();
});

describe('ArticlesSplitShell', () => {
    it('starts with the panel closed when the URL carries no selection', () => {
        renderShell();

        expect(screen.getByTestId('panel-open')).toHaveTextContent('false');
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();
    });

    it('starts open when the URL already carries a selection', () => {
        renderShell({mode: 'edit', articleId: 'a1'});

        expect(screen.getByTestId('article-side-panel')).toHaveTextContent('a1:details');
    });

    it('opens the panel and reports the selection on a row click', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'row a1'}));

        expect(onSelectArticle).toHaveBeenCalledWith('a1');
        expect(screen.getByTestId('panel-open')).toHaveTextContent('true');
    });

    it('collapses and re-expands from the list toggle without losing the selection', async () => {
        renderShell({mode: 'edit', articleId: 'a1'});

        await userEvent.click(screen.getByRole('button', {name: 'toggle'}));
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', {name: 'toggle'}));
        expect(screen.getByTestId('article-side-panel')).toHaveTextContent('a1:details');
    });

    it('shows the placeholder when open with no selection', async () => {
        renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'toggle'}));

        expect(screen.getByText('panelPlaceholderTitle')).toBeInTheDocument();
        expect(screen.queryByTestId('article-side-panel')).not.toBeInTheDocument();
    });

    it('docks the panel beside the list above lg', () => {
        renderShell({mode: 'edit', articleId: 'a1'});

        expect(document.querySelector('[data-testid="articles-shell-panel"]')).not.toBeNull();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('falls back to the overlay sheet below lg', () => {
        setNarrow();
        renderShell({mode: 'edit', articleId: 'a1'});

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(document.querySelector('[data-testid="articles-shell-panel"]')).toBeNull();
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run frontend/test/components/ArticlesSplitShell.test.tsx`

Expected: FAIL — cannot resolve `@/components/articles/ArticlesSplitShell`.

- [ ] **Step 4: Export the desktop media query**

In `frontend/hooks/use-mobile.tsx`, after `useIsNarrow`:

```tsx
/** Tailwind lg (1024px). Below it the docked split is not viable and the
 *  articles panel falls back to an overlay sheet. */
const DESKTOP_BREAKPOINT = 1024;

/** True when the viewport is below Tailwind lg (1024px). */
export function useIsBelowDesktop() {
  return !useMediaQuery(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
}
```

- [ ] **Step 5: Implement the shell**

Create `frontend/components/articles/ArticlesSplitShell.tsx`:

```tsx
/**
 * Split layout for the Articles tab: the table on the left, the article panel
 * on the right.
 *
 * Deliberately NOT RunSplitShell: that shell's `assessment-shell*` panel ids
 * are the DOM test contract for the run screens' specs, and its in-shell PDF
 * toggle is wrong for a panel that usually shows fields. Both are built on the
 * same ResizablePanelGroup primitives; see the side-panel design spec §4.
 *
 * State split: the URL owns WHICH article and WHICH view (the props below);
 * this shell owns only whether the panel is expanded.
 */
import {type ReactNode, useState} from 'react';

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {Sheet, SheetContent} from '@/components/ui/sheet';
import {useIsBelowDesktop} from '@/hooks/use-mobile';
import {
  ArticleSidePanel,
  type ArticleSidePanelView,
} from '@/components/articles/ArticleSidePanel';
import {t} from '@/lib/copy';

export interface ArticlesSplitShellListApi {
  /** Row click: opens the panel on that article. */
  onArticleClick: (id: string) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export interface ArticlesSplitShellProps {
  list: (api: ArticlesSplitShellListApi) => ReactNode;
  projectId: string;
  mode: 'add' | 'edit' | null;
  articleId: string | null;
  view: ArticleSidePanelView;
  onViewChange: (view: ArticleSidePanelView) => void;
  onSelectArticle: (id: string) => void;
  onDismiss: () => void;
  onComplete: () => void;
}

export function ArticlesSplitShell({
  list,
  projectId,
  mode,
  articleId,
  view,
  onViewChange,
  onSelectArticle,
  onDismiss,
  onComplete,
}: ArticlesSplitShellProps) {
  const hasSelection = mode === 'add' || (mode === 'edit' && Boolean(articleId));
  // Open on mount when the URL already carries a selection (deep link, reload).
  const [panelOpen, setPanelOpen] = useState(hasSelection);
  const belowDesktop = useIsBelowDesktop();

  const handleArticleClick = (id: string) => {
    setPanelOpen(true);
    onSelectArticle(id);
  };

  const listApi: ArticlesSplitShellListApi = {
    onArticleClick: handleArticleClick,
    panelOpen,
    onTogglePanel: () => setPanelOpen((v) => !v),
  };

  const panelBody = hasSelection ? (
    <ArticleSidePanel
      projectId={projectId}
      mode={mode as 'add' | 'edit'}
      articleId={articleId ?? undefined}
      view={view}
      onViewChange={onViewChange}
      onCollapse={() => setPanelOpen(false)}
      onDismiss={onDismiss}
      onComplete={onComplete}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-[13px] font-medium">{t('articles', 'panelPlaceholderTitle')}</p>
      <p className="text-[12px] text-muted-foreground">
        {t('articles', 'panelPlaceholderBody')}
      </p>
    </div>
  );

  if (belowDesktop) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {list(listApi)}
        <Sheet open={panelOpen} onOpenChange={(open) => !open && setPanelOpen(false)}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="flex h-full w-full max-w-full min-h-0 flex-col gap-0 border-l border-border/40 p-0 sm:max-w-none sm:w-[min(960px,96vw)]"
          >
            {panelBody}
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel id="articles-shell-list" defaultSize={panelOpen ? '55%' : '100%'} minSize="35%">
        <div className="flex h-full min-h-0 flex-col">{list(listApi)}</div>
      </ResizablePanel>
      {panelOpen ? (
        <>
          <ResizableHandle withHandle/>
          <ResizablePanel
            id="articles-shell-panel"
            data-testid="articles-shell-panel"
            defaultSize="45%"
            minSize="30%"
            maxSize="65%"
          >
            {panelBody}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}
```

Note: `react-resizable-panels` v4 stamps `data-testid={id}` on panels, overriding an explicit `data-testid` — the same behaviour `RunSplitShell` documents. If the `articles-shell-panel` query fails, drop the explicit `data-testid` and rely on the id, and delete the now-redundant prop.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run frontend/test/components/ArticlesSplitShell.test.tsx`

Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/articles/ArticlesSplitShell.tsx frontend/hooks/use-mobile.tsx frontend/test/components/ArticlesSplitShell.test.tsx frontend/lib/copy/articles.ts
git commit -m "feat(articles): add the docked articles split shell"
```

---

## Task 6: Unsaved-edits guard on the row swap

**Files:**
- Modify: `frontend/components/articles/ArticlesSplitShell.tsx`
- Modify: `frontend/lib/copy/articles.ts`
- Test: `frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx` (create)

**Interfaces:**
- Consumes: `onDirtyChange` (T1), the shell (T5).
- Produces: no new public API — the shell now passes `onDirtyChange` down to `ArticleSidePanel` and intercepts `handleArticleClick`.

- [ ] **Step 1: Add the copy keys**

```ts
    panelDiscardTitle: 'Discard unsaved changes?',
    panelDiscardBody: 'This article has edits that have not been saved.',
    panelDiscardConfirm: 'Discard changes',
    panelDiscardCancel: 'Keep editing',
```

- [ ] **Step 2: Write the failing test**

Create `frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx`:

```tsx
/**
 * Swapping the article under a dirty panel must ask first (design spec §8).
 *
 * The stub panel exposes a button that fires onDirtyChange(true), so each test
 * can assert the PRECONDITION — the shell was actually told the form is dirty —
 * before asserting the dialog. Without that, a shell that never wires
 * onDirtyChange would pass "no dialog when clean" and fail nothing.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/components/articles/ArticleSidePanel', () => ({
    ArticleSidePanel: ({
        articleId,
        onDirtyChange,
    }: {
        articleId?: string;
        onDirtyChange?: (d: boolean) => void;
    }) => (
        <div data-testid="article-side-panel">
            {articleId ?? 'none'}
            <button onClick={() => onDirtyChange?.(true)}>make dirty</button>
        </div>
    ),
}));
vi.mock('@/lib/copy', () => ({t: (_ns: string, key: string) => key}));

import {ArticlesSplitShell} from '@/components/articles/ArticlesSplitShell';

function setDesktop() {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        }),
    });
}

function renderShell() {
    const onSelectArticle = vi.fn();
    render(
        <ArticlesSplitShell
            projectId="p1"
            mode="edit"
            articleId="a1"
            view="details"
            onViewChange={vi.fn()}
            onSelectArticle={onSelectArticle}
            onDismiss={vi.fn()}
            onComplete={vi.fn()}
            list={({onArticleClick}) => (
                <button onClick={() => onArticleClick('a2')}>row a2</button>
            )}
        />,
    );
    return {onSelectArticle};
}

beforeEach(() => {
    vi.clearAllMocks();
    setDesktop();
});

describe('ArticlesSplitShell dirty guard', () => {
    it('swaps without asking while the panel is clean', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));

        expect(onSelectArticle).toHaveBeenCalledWith('a2');
        expect(screen.queryByText('panelDiscardTitle')).not.toBeInTheDocument();
    });

    it('asks before swapping when the panel reported dirty', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));

        expect(await screen.findByText('panelDiscardTitle')).toBeInTheDocument();
        expect(onSelectArticle).not.toHaveBeenCalled();
    });

    it('keeps the current article when the swap is declined', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));
        await userEvent.click(await screen.findByRole('button', {name: 'panelDiscardCancel'}));

        expect(onSelectArticle).not.toHaveBeenCalled();
        expect(screen.getByTestId('article-side-panel')).toHaveTextContent('a1');
    });

    it('swaps when the changes are discarded', async () => {
        const {onSelectArticle} = renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        await userEvent.click(screen.getByRole('button', {name: 'row a2'}));
        await userEvent.click(await screen.findByRole('button', {name: 'panelDiscardConfirm'}));

        expect(onSelectArticle).toHaveBeenCalledWith('a2');
    });

    it('does not ask when the same article is clicked again', async () => {
        renderShell();

        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));
        // Re-clicking the SAME row is not a swap and must not nag.
        await userEvent.click(screen.getByRole('button', {name: 'make dirty'}));

        expect(screen.queryByText('panelDiscardTitle')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx`

Expected: FAIL — the shell does not pass `onDirtyChange` down, so "make dirty" does nothing and the dialog never appears.

- [ ] **Step 4: Implement the guard**

In `ArticlesSplitShell.tsx`, add the imports:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
```

Add state next to `panelOpen`:

```tsx
  const [dirty, setDirty] = useState(false);
  const [pendingArticleId, setPendingArticleId] = useState<string | null>(null);
```

Replace `handleArticleClick` with:

```tsx
  const selectArticle = (id: string) => {
    setPanelOpen(true);
    setDirty(false);
    onSelectArticle(id);
  };

  const handleArticleClick = (id: string) => {
    // Only a genuine swap is guarded: re-clicking the open article is a no-op,
    // and nagging there would make the guard feel broken.
    if (dirty && id !== articleId) {
      setPendingArticleId(id);
      return;
    }
    selectArticle(id);
  };
```

Pass the reporter into the panel — add to the `<ArticleSidePanel …/>` call:

```tsx
      onDirtyChange={setDirty}
```

Render the dialog inside both the desktop and the below-desktop returns. Extract it to a local so it is defined once:

```tsx
  const discardDialog = (
    <AlertDialog
      open={pendingArticleId !== null}
      onOpenChange={(open) => !open && setPendingArticleId(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('articles', 'panelDiscardTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('articles', 'panelDiscardBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('articles', 'panelDiscardCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const id = pendingArticleId;
              setPendingArticleId(null);
              if (id) selectArticle(id);
            }}
          >
            {t('articles', 'panelDiscardConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
```

Render `{discardDialog}` as a sibling inside the below-desktop wrapper `<div>`, and wrap the desktop `ResizablePanelGroup` in a fragment with `{discardDialog}` beside it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx frontend/test/components/ArticlesSplitShell.test.tsx`

Expected: PASS, 12 tests total.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/articles/ArticlesSplitShell.tsx frontend/test/components/ArticlesSplitShell.dirtyGuard.test.tsx frontend/lib/copy/articles.ts
git commit -m "feat(articles): guard the article swap when the panel has unsaved edits"
```

---

## Task 7: Wire the shell into `ProjectView`

**Files:**
- Modify: `frontend/pages/ProjectView.tsx` (`FULL_BLEED_TABS` at :22, `closeArticleEditor` at :40, the cleanup effect at :79, `renderContent` at :189, the `<Sheet>` block at :255-296)
- Test: `frontend/test/legacyArticleRoutes.test.tsx` (must pass unchanged — do not edit)

**Interfaces:**
- Consumes: `ArticlesSplitShell` (T5/T6).
- Produces: the `articleView` search param (`details` | `document`, default `details`), written with `{replace: true}`.

- [ ] **Step 1: Add `articleView` to the URL helpers**

In `ProjectView.tsx`, extend `closeArticleEditor` to also drop the view:

```tsx
    const closeArticleEditor = () => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('articleEditor');
                next.delete('articleId');
                next.delete('articleView');
                return next;
            },
            {replace: true}
        );
    };
```

Add the same `next.delete('articleView');` to the leave-the-tab cleanup effect (:79-92) and to the invalid-`edit`-without-id effect (:96-111), beside their existing deletes.

Add the setter:

```tsx
    const setArticleView = (view: 'details' | 'document') => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.set('articleView', view);
                return next;
            },
            // replace: toggling the view is not a navigation step — without
            // this, Back walks through every toggle instead of leaving.
            {replace: true}
        );
    };
```

- [ ] **Step 2: Make the articles tab full-bleed**

```tsx
const FULL_BLEED_TABS = new Set(['articles', 'settings', 'overview', 'screening', 'prisma']);
```

- [ ] **Step 3: Render the shell in the articles case**

Replace the `case 'articles':` branch of `renderContent` with:

```tsx
      case 'articles':
        return (
            <ArticlesSplitShell
                projectId={projectId || ''}
                mode={
                    articleEditorMode === 'add'
                        ? 'add'
                        : articleEditorMode === 'edit' && editorArticleIdFromUrl
                          ? 'edit'
                          : null
                }
                articleId={editorArticleIdFromUrl}
                view={searchParams.get('articleView') === 'document' ? 'document' : 'details'}
                onViewChange={setArticleView}
                onSelectArticle={openArticleEditorEdit}
                onDismiss={closeArticleEditor}
                onComplete={() => {
                    void loadArticles();
                    closeArticleEditor();
                }}
                list={({onArticleClick, panelOpen, onTogglePanel}) => (
                    <ArticlesList
                        articles={articles}
                        onArticleClick={onArticleClick}
                        projectId={projectId || ''}
                        onArticlesChange={loadArticles}
                        onOpenZoteroDialog={() => setZoteroDialogOpen(true)}
                        onOpenRisDialog={() => setRisDialogOpen(true)}
                        onOpenAddArticle={openArticleEditorAdd}
                        panelOpen={panelOpen}
                        onTogglePanel={onTogglePanel}
                    />
                )}
            />
        );
```

`articleEditorMode` and `editorArticleIdFromUrl` are currently declared *after* `renderContent` (:222-223). Move those two `const` declarations above `renderContent` so the case can read them. `panelOpen` / `onTogglePanel` are added to `ArticlesList` in Task 8 — until then TypeScript will flag them; that is expected and Task 8 closes it.

- [ ] **Step 4: Delete the old editor Sheet**

Remove the entire `<Sheet open={articleEditorSheetOpen} …>…</Sheet>` block (:255-296) and the now-unused `articleEditorSheetOpen` const. The below-`lg` Sheet now lives inside `ArticlesSplitShell`.

Add the import:

```tsx
import {ArticlesSplitShell} from "@/components/articles/ArticlesSplitShell";
```

Remove the `ArticleForm`, `Sheet` and `SheetContent` imports if nothing else in the file uses them (`npm run lint` will say).

- [ ] **Step 5: Verify the URL contract did not move**

Run: `npx vitest run frontend/test/legacyArticleRoutes.test.tsx`

Expected: PASS, unchanged. A failure here means the `articleEditor`/`articleId` contract was altered — fix the shell wiring, do not edit this test.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

Expected: exactly the two errors for `panelOpen` / `onTogglePanel` not existing on `ArticlesListProps`. Any other error is a real problem in this task.

- [ ] **Step 7: Commit**

```bash
git add frontend/pages/ProjectView.tsx
git commit -m "feat(articles): mount the split shell in the articles tab"
```

---

## Task 8: The toolbar panel toggle

**Files:**
- Modify: `frontend/components/articles/ArticlesList.tsx` (props interface at :60-73, toolbar actions around :1203-1213)
- Test: `frontend/test/ArticlesList.toolbar.test.tsx`

**Interfaces:**
- Consumes: `ArticlesSplitShellListApi` (T5).
- Produces: `ArticlesListProps.panelOpen: boolean` and `ArticlesListProps.onTogglePanel: () => void`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/test/ArticlesList.toolbar.test.tsx`, and add `panelOpen: false, onTogglePanel: vi.fn()` to the `handlers` object inside `renderList` so every existing test keeps compiling:

```tsx
    it("toggles the article panel from the toolbar", async () => {
        const handlers = renderList([article("a1", "First")]);

        await userEvent.click(screen.getByRole("button", {name: "Toggle the article panel"}));

        expect(handlers.onTogglePanel).toHaveBeenCalledTimes(1);
    });

    it("reflects the panel state on the toggle", () => {
        renderList([article("a1", "First")]);

        expect(screen.getByRole("button", {name: "Toggle the article panel"}))
            .toHaveAttribute("aria-pressed", "false");
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/test/ArticlesList.toolbar.test.tsx`

Expected: FAIL — no button with that accessible name.

- [ ] **Step 3: Add the props**

In `interface ArticlesListProps`:

```tsx
    /** Whether the article side panel is currently expanded. */
    panelOpen: boolean;
    /** Collapses / expands the article side panel. */
    onTogglePanel: () => void;
```

Add `panelOpen,` and `onTogglePanel,` to the destructured props at :272-281.

- [ ] **Step 4: Render the toggle**

Add the import:

```tsx
import {PanelToggleButton} from '@/components/layout/PanelToggleButton';
```

Inside the existing `<TooltipProvider>` block, immediately after the `listAddArticle` `<ToolbarAction …/>` (around :1213):

```tsx
                        <PanelToggleButton
                            side="right"
                            pressed={panelOpen}
                            onToggle={onTogglePanel}
                            ariaLabel={t('articles', 'panelToggle')}
                        />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run frontend/test/ArticlesList.toolbar.test.tsx`

Expected: PASS, all tests including the two new ones.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

Expected: clean — Task 7's two expected errors are now resolved.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/articles/ArticlesList.tsx frontend/test/ArticlesList.toolbar.test.tsx
git commit -m "feat(articles): add the panel toggle to the articles toolbar"
```

---

## Task 9: E2E, gates and visual review

**Files:**
- Create: `frontend/e2e/flows/articles-side-panel.ui.e2e.ts`

**Interfaces:**
- Consumes: everything above. Produces nothing consumed by later tasks.

- [ ] **Step 1: Read the reference E2E flow**

Read `frontend/e2e/flows/pdf-collapsed-default.ui.e2e.ts` end to end and copy its auth/project setup verbatim — do not invent a new login path.

- [ ] **Step 2: Write the E2E**

Create `frontend/e2e/flows/articles-side-panel.ui.e2e.ts`, following that file's setup, with the body:

```ts
test('docks the article panel and switches to the document view', async ({page}) => {
  await page.goto(`/projects/${projectId}?tab=articles`);

  // The panel starts collapsed: the table owns the full width.
  await expect(page.getByTestId('articles-shell-panel')).toHaveCount(0);

  await page.getByRole('row').nth(1).click();

  // Docked, NOT an overlay: the table is still visible beside it.
  await expect(page.getByTestId('articles-shell-panel')).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();

  await page.getByRole('button', {name: 'Document'}).click();
  await expect(page).toHaveURL(/articleView=document/);
  await expect(page.locator('canvas').first()).toBeVisible();
});
```

Use a project fixture that has an article with a MAIN PDF — check how the reference flow provisions one and reuse it. Per the repo's E2E notes, the suite is stateful: run it against a fresh local stack, not on top of a previous run.

- [ ] **Step 3: Run the E2E**

Run: `npx playwright test frontend/e2e/flows/articles-side-panel.ui.e2e.ts --workers 1`

Expected: PASS. `--workers 1` is required — parallel workers collide on shared fixture state.

- [ ] **Step 4: Run the full frontend suite**

Run: `npm run test:run`

Expected: PASS. Read the summary line; do not grep for `FAILED` mid-run.

- [ ] **Step 5: Run the dead-code gates**

Run: `npx knip && npx knip --production`

Expected: zero findings in BOTH modes. `--production` is the one that catches `ArticleSidePanel` being reachable only from its test — if it fires, the component is not actually mounted in the production path, which is a real wiring bug, not a knip config problem.

- [ ] **Step 6: Run the full deterministic gate**

Run: `make quality-scan`

Expected: PASS, including `scripts/fitness/check_copy_keys.py` — every key added in Tasks 4, 5, 6 and 8 must be referenced.

- [ ] **Step 7: Visual review**

Load the `design-review` skill and run it on the Articles route with the panel open in both views. Specifically judge the two things the spec flagged as accepted-but-unverified:
1. the table's horizontal overflow at the 55% default split;
2. the density of the panel strip stacked above the form's actions row.

Record the screenshots in the PR. If either reads badly, tune the default split and the strip height here — do not restructure the column system.

- [ ] **Step 8: Commit**

```bash
git add frontend/e2e/flows/articles-side-panel.ui.e2e.ts
git commit -m "test(articles): cover the docked side panel end to end"
```

- [ ] **Step 9: Push and update the PR**

```bash
git push
```

The branch already has PR #862 open against `dev` (the spec). Update its body to describe the implementation, and attach the design-review screenshots.

---

## Self-Review Notes

**Spec coverage:** §5 layout → T5; §6 panel internals → T3 (header), T4 (strip, empty state, add-mode gating); §7 URL contract → T5 (`panelOpen`), T7 (`articleView`); §8 dirty guard → T1, T6; §9 testing → every task plus T9; §10 non-goals → no task touches `RunSplitShell`, the viewer, autosave, or `ArticlesList`'s column system.

**Known cross-task dependency:** Task 7 leaves two deliberate TypeScript errors that Task 8 resolves. If the tasks are run by separate subagents, Task 7's reviewer must not "fix" them by adding the props to `ArticlesList` — that is Task 8's deliverable.
