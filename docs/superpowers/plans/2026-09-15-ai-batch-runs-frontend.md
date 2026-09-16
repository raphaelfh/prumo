---
status: draft
last_reviewed: 2026-09-15
owner: '@raphaelfh'
---

# AI Batch Runs — Frontend (PR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer select articles on either HITL list and run AI on them as one
durable server-side batch, with per-batch status in the notification bell and a details
sheet, replacing extraction's in-browser batch loop.

**Architecture:** `component → hook (TanStack Query) → extractionBatchService → apiClient`
over the five `/api/v1/extraction/batches` routes shipped in PR #932. A new
`extractionBatchKeys` factory owns the cache; an active batch is polled every 5 s and
mirrored into the existing `useBackgroundJobs` Zustand store as a `BackgroundJob` of new
type `ai-batch`, so the bell's badge, dismissal and transition observer keep working
unchanged. The in-browser loop (`useFullAIExtraction`) and the dead progress overlay are
deleted in this same PR.

**Tech Stack:** TypeScript strict, React 19 + Vite, TanStack Query, Zustand, shadcn/Radix,
vitest + Testing Library, in-house copy at `frontend/lib/copy/`.

**Spec:** [`docs/superpowers/specs/2026-09-15-ai-batch-runs-design.md`](../specs/2026-09-15-ai-batch-runs-design.md)
(read §10–§14 before starting; §16's four frontend items are answered below).

## Global Constraints

- **English only** for code, comments, commits, copy and docs.
- Frontend tooling runs from the **repo root**. Never `cd frontend`. Commands:
  `npm run test:run`, `npm run lint`, `npm run typecheck`, `npx knip`,
  `npx knip --production`, `python3 scripts/fitness/check_copy_keys.py`.
- **Do not change the backend.** The wire contract is fixed by PR #932 and
  `frontend/types/api/schema.d.ts`. Never hand-write a batch payload type — derive
  every one from `components['schemas'][...]`.
- **The wire is `snake_case`**, not camelCase. Spec §7 says camelCase; the generated
  schema is authoritative and says `project_id`, `article_ids`,
  `skip_articles_with_ai_suggestions`, `done_with_issues`, `needs_attention`,
  `not_run`, `stop_code`, `finished_at`. Follow the generated schema.
- Every response is the `ApiResponse<T>` envelope; `apiClient<T>` already unwraps it
  and throws `ApiError(code, message, status, traceId, details)` on failure.
- All user-facing strings go through `t(ns, key)` with literal keys only (the copy
  ratchet cannot see a computed key).
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Do not push and do not open a PR.** Commit locally only.

## Spec §16 — resolved before planning (do not re-open these)

**1. Which suggestion query keys an open article screen reads (§11.4).**
**None — the open article screen's AI suggestions are not in the TanStack cache.**
`frontend/hooks/extraction/ai/useAISuggestions.ts` holds suggestions in `useState` and
loads them imperatively via `AISuggestionService.loadSuggestions(...)`; it exposes
`refresh: loadSuggestions`, consumed as `refreshAISuggestions` by
`frontend/pages/ExtractionFullScreen.tsx:425` and
`frontend/pages/QualityAssessmentFullScreen.tsx:268`. Consequence for this PR: a query
invalidation can never refresh an open article screen, so **PR 3 does not attempt to**.
Batch completion invalidates `articleExtractionValuesKeys.all` only — that is what the
list rings read (`useCallerArticleProgress`). Refreshing an article screen that is open
while its own article finishes in a batch is explicitly out of scope; the reviewer sees
the new suggestions on their next visit. Do not add a cross-screen refresh bus.

**2. How `useProjectMemberRole` exposes the viewer role (§11.2).**
`frontend/hooks/useProjectMemberRole.ts` returns
`{role: ProjectMemberRole | null, isManager: boolean, loading: boolean}`. It is
`useState`/`useEffect`-based, not a query, and `role` is `null` both while loading and
on failure — so `loading` must be checked, never `role === null` alone. There is **no
`isViewer`**. A viewer is `role === 'viewer'`; a reviewer is anything else that is not
`viewer` and not `null`. Rule for the selection bar: show Run AI only when
`!loading && role !== null && role !== 'viewer'`. Fail closed while loading.

**3. Disabling a QA tool in Configuration — delete or flag inactive? Both exist.**
`PATCH /projects/{id}/templates/{tid}` flips `is_active` via
`backend/app/services/project_template_active_service.py`, and
`backend/app/services/template_delete_service.py` hard-deletes a template (refused while
it is ACTIVE or referenced by a run/instance). So a tool can end up **inactive** or
**gone**. G7 is already correct in the merged backend:
`backend/app/services/extraction_batch_dispatcher.py:232` returns the kind only
`if template.is_active`, and both the inactive and missing cases fall through to
`NO_LONGER_AVAILABLE` (lines 294/318/322). **No frontend or backend change is needed
for G7.** The frontend duty is only to render `NO_LONGER_AVAILABLE` with copy that
covers both readings — "No longer available" / "The tool, article or run is no longer
available", never "deleted".

**4. Copy namespace registration in `frontend/lib/copy/`.**
`frontend/lib/copy/index.ts` requires three edits per namespace: an `import {x} from
'./x'`, an entry in the `const copy = {...} as const` object (this is what makes
`t('x', 'key')` typecheck), and — only if a consumer imports the namespace object
directly — an entry in the bare `export {...}` list. This PR's namespace is imported
only through `t()`, so add the import and the `copy` entry, and **not** the bare export
(an unused bare export is a knip finding).

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `frontend/lib/copy/aiBatch.ts` | Every string this feature shows |
| `frontend/lib/query-keys/extractionBatch.ts` | `extractionBatchKeys` factory |
| `frontend/types/extraction-batch.ts` | Schema-derived aliases + outcome helpers |
| `frontend/services/extractionBatchService.ts` | The five routes over `apiClient` |
| `frontend/hooks/extraction/useExtractionBatches.ts` | Query + mutation hooks, polling |
| `frontend/components/extraction/batch/BatchSelectionBar.tsx` | Shared `n selected · Run AI · Clear` bar |
| `frontend/components/extraction/batch/RunAIBatchDialog.tsx` | Confirm dialog + start mutation + error mapping |
| `frontend/components/extraction/batch/BatchDetailsSheet.tsx` | Grouped per-article outcomes + footer actions |
| `frontend/components/extraction/batch/useBatchRowStatus.ts` | articleId → `queued`/`running` for the active batch |
| `frontend/components/extraction/batch/BatchRowStatus.tsx` | Clock/spinner beside the ring |
| `frontend/hooks/useAiBatchJobSync.ts` | Mirrors active batches into `useBackgroundJobs` |
| `frontend/components/extraction/batch/__tests__/*.test.tsx` | Vitest coverage |

**Modified**

| File | Change |
|---|---|
| `frontend/lib/copy/index.ts` | Register `aiBatch` |
| `frontend/types/background-jobs.ts` | `JobType` gains `'ai-batch'`; `AiBatchJob` interface |
| `frontend/components/hitl/HITLArticleTable.tsx` | Checkbox column, card list, real shortcuts, selection bar, row status |
| `frontend/components/extraction/ArticleExtractionTable.tsx` | Selection bar replaces the Actions menu; row status; delete `handleBatchAIExtraction` |
| `frontend/components/navigation/NotificationCenter.tsx` | Mount the sync hook; render/act on `ai-batch` items |
| `frontend/pages/ExtractionFullScreen.tsx` | Delete the dead progress overlay |
| `frontend/services/extractionInstanceService.ts` | Drop exports orphaned by the deletions (knip decides) |
| `frontend/lib/copy/extraction.ts` | Delete the copy keys of the removed path |
| `scripts/fitness/check_copy_keys.baseline` | Tighten by the deleted keys |

**Deleted**

`frontend/hooks/extraction/useFullAIExtraction.ts`,
`frontend/hooks/extraction/useTopLevelSectionsExtraction.ts`,
`frontend/components/extraction/FullAIExtractionProgress.tsx`,
`frontend/components/extraction/BatchAllModelsSectionsProgress.tsx`,
`frontend/components/extraction/BatchExtractionProgress.tsx`,
`frontend/test/hooks/useFullAIExtraction.test.tsx`,
`frontend/test/hooks/useFullAIExtraction.ordering.test.tsx`,
`frontend/test/hooks/extractionPartialFailure.test.tsx` (only if it covers no surviving
hook — read it first; keep and narrow it if it also covers
`useBatchAllModelsSectionsExtraction`).

**Kept, do not touch:** `useBatchAllModelsSectionsExtraction`,
`useBatchSectionExtractionChunked`, `useRunAIExtraction` (in-article Run AI keeps its
in-page status — batches only go to the bell).

---

## Task 1: Types, copy namespace, query keys and the batch service

**Files:**
- Create: `frontend/types/extraction-batch.ts`
- Create: `frontend/lib/copy/aiBatch.ts`
- Create: `frontend/lib/query-keys/extractionBatch.ts`
- Create: `frontend/services/extractionBatchService.ts`
- Modify: `frontend/lib/copy/index.ts`
- Test: `frontend/services/__tests__/extractionBatchService.test.ts`

**Interfaces:**
- Consumes: `apiClient`, `ApiError` from `@/integrations/api/client`;
  `components['schemas']` from `@/types/api/schema`.
- Produces:
  - `ExtractionBatchSummary`, `ExtractionBatchDetail`, `ExtractionBatchItem`,
    `ExtractionBatchCounts`, `CreateExtractionBatchRequest`, `BatchOutcome`,
    `BatchState` (all from `frontend/types/extraction-batch.ts`)
  - `extractionBatchKeys.all`, `.list(filters)`, `.detail(batchId)`
  - `startExtractionBatch(request): Promise<ExtractionBatchDetail>`,
    `listExtractionBatches(params): Promise<ExtractionBatchSummary[]>`,
    `getExtractionBatch(batchId): Promise<ExtractionBatchDetail>`,
    `cancelExtractionBatch(batchId): Promise<ExtractionBatchDetail>`,
    `resumeExtractionBatch(batchId): Promise<ExtractionBatchDetail>`
  - copy namespace `aiBatch`, read as `t('aiBatch', '<key>')`

- [ ] **Step 1: Write the failing service test**

Create `frontend/services/__tests__/extractionBatchService.test.ts`:

```ts
import {describe, expect, it, vi, beforeEach} from 'vitest';

vi.mock('@/integrations/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/integrations/api/client')>(
    '@/integrations/api/client',
  );
  return {...actual, apiClient: vi.fn()};
});

import {apiClient} from '@/integrations/api/client';
import {
  cancelExtractionBatch,
  getExtractionBatch,
  listExtractionBatches,
  resumeExtractionBatch,
  startExtractionBatch,
} from '@/services/extractionBatchService';

const mocked = vi.mocked(apiClient);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue({} as never);
});

describe('extractionBatchService', () => {
  it('POSTs the snake_case start payload', async () => {
    await startExtractionBatch({
      project_id: 'p1',
      template_id: 't1',
      article_ids: ['a1', 'a2'],
      skip_articles_with_ai_suggestions: true,
    });
    expect(mocked).toHaveBeenCalledWith('/api/v1/extraction/batches', {
      method: 'POST',
      body: {
        project_id: 'p1',
        template_id: 't1',
        article_ids: ['a1', 'a2'],
        skip_articles_with_ai_suggestions: true,
      },
    });
  });

  it('lists active batches for a project with query params', async () => {
    mocked.mockResolvedValue([] as never);
    await listExtractionBatches({projectId: 'p1', active: true});
    expect(mocked).toHaveBeenCalledWith(
      '/api/v1/extraction/batches?project_id=p1&active=true',
    );
  });

  it('omits absent list params', async () => {
    mocked.mockResolvedValue([] as never);
    await listExtractionBatches({});
    expect(mocked).toHaveBeenCalledWith('/api/v1/extraction/batches');
  });

  it('encodes the batch id on detail, cancel and resume', async () => {
    await getExtractionBatch('b/1');
    expect(mocked).toHaveBeenLastCalledWith('/api/v1/extraction/batches/b%2F1');
    await cancelExtractionBatch('b1');
    expect(mocked).toHaveBeenLastCalledWith('/api/v1/extraction/batches/b1/cancel', {
      method: 'POST',
    });
    await resumeExtractionBatch('b1');
    expect(mocked).toHaveBeenLastCalledWith('/api/v1/extraction/batches/b1/resume', {
      method: 'POST',
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:run -- frontend/services/__tests__/extractionBatchService.test.ts`
Expected: FAIL — cannot resolve `@/services/extractionBatchService`.

- [ ] **Step 3: Create the schema-derived types**

`frontend/types/extraction-batch.ts`:

```ts
/**
 * AI batch runs (spec 2026-09-15 §7) — every type is derived from the
 * generated OpenAPI schema, never hand-written: the wire is snake_case and
 * the backend owns it.
 */
import type {components} from '@/types/api/schema';

export type ExtractionBatchSummary = components['schemas']['ExtractionBatchSummary'];
export type ExtractionBatchDetail = components['schemas']['ExtractionBatchDetail'];
export type ExtractionBatchItem = components['schemas']['ExtractionBatchItemView'];
export type ExtractionBatchCounts = components['schemas']['ExtractionBatchCounts'];
export type CreateExtractionBatchRequest =
  components['schemas']['CreateExtractionBatchRequest'];

export type BatchState = ExtractionBatchSummary['state'];
export type BatchOutcome = ExtractionBatchItem['outcome'];

/** A batch the dispatcher may still advance. */
export function isBatchActive(batch: {state: BatchState}): boolean {
  return batch.state === 'active';
}

/** Articles the batch has finished with, in any way. */
export function finishedCount(counts: ExtractionBatchCounts): number {
  return (
    counts.done +
    counts.done_with_issues +
    counts.needs_attention +
    counts.skipped +
    counts.not_run
  );
}
```

- [ ] **Step 4: Create the copy namespace**

`frontend/lib/copy/aiBatch.ts` — a flat `as const` literal, same shape as its siblings.
Keys (values are the English copy; `{{n}}`-style placeholders are replaced with
`.replace()` at the call site, matching `extraction.ts`):

```ts
/** Copy for AI batch runs (spec 2026-09-15 §10–§11). */
export const aiBatch = {
  // Selection bar
  selectedCount: '{{n}} selected',
  runAI: 'Run AI',
  clearSelection: 'Clear',
  tooManySelected: 'Up to 100 articles per run',
  batchRunningChip: 'AI running · {{done}}/{{total}}',
  view: 'View',

  // Confirm dialog
  confirmTitle: 'Run AI on {{n}} articles?',
  confirmTitleOne: 'Run AI on 1 article?',
  confirmEngineLine: 'Model: {{engine}}',
  confirmKeepsHumanAnswers: 'Answers a person already gave are kept.',
  confirmSkipLabel: 'Skip articles that already have AI suggestions',
  confirmCancel: 'Cancel',
  confirmRun: 'Run AI',
  startedToast: 'AI started for {{n}} articles',
  startedToastOne: 'AI started for 1 article',

  // Start errors (§10 F1/F3/F4)
  startEngineProblemTitle: 'AI is not configured',
  startEngineAction: 'Choose engine',
  startQueueDownTitle: 'The AI queue is unavailable',
  startQueueDownDescription: 'Nothing was queued. Please try again.',
  startTryAgain: 'Try again',
  startAlreadyActiveTitle: 'An AI batch is already running for this tool',
  startFailedTitle: 'Could not start the AI batch',

  // Bell item
  bellTitleExtraction: 'AI extraction · {{template}}',
  bellTitleAssessment: 'AI assessment · {{template}}',
  bellProgress: '{{done}}/{{total}}',
  bellCancel: 'Cancel',
  bellDetails: 'Details',
  bellFinished: '{{done}} done',
  bellNeedsAttention: '{{n}} need attention',
  bellNeedsAttentionOne: '1 needs attention',
  bellStoppedEngine: 'Stopped: engine problem',
  bellCancelled: 'Cancelled: {{done}} done, {{notRun}} not run',
  bellStalled: 'No progress for 15 minutes',

  // Details sheet
  sheetTitle: 'AI batch',
  sheetGroupNeedsAttention: 'Needs attention',
  sheetGroupSkipped: 'Skipped',
  sheetGroupNotRun: 'Not run',
  sheetGroupDone: 'Done',
  sheetOpenArticle: 'Open article',
  sheetCancel: 'Cancel batch',
  sheetResume: 'Resume',
  sheetRetryFailed: 'Retry failed',
  sheetRunRemaining: 'Run remaining',
  sheetUntitled: 'Untitled article',

  // Per-article reasons (§10)
  reasonRunFinalized: 'Finalized — reopen it to run AI',
  reasonRunNotEditable: 'Not editable right now',
  reasonAlreadyHasAiSuggestions: 'Already has AI suggestions',
  reasonAiAlreadyRunning: 'AI is already running on it',
  reasonNoLongerAvailable: 'The tool, article or run is no longer available',
  reasonCancelled: 'Not run',
  reasonStoppedEngineError: 'Not run — the batch stopped',
  reasonPdfNotFound: 'No PDF',
  reasonExtractionFailed: 'Extraction failed',
  reasonSectionsFailed: '{{failed}} of {{total}} sections failed',
  reasonUnknown: 'Unavailable',

  // Row status
  rowQueued: 'Queued for AI',
  rowRunning: 'AI is running',
} as const;
```

- [ ] **Step 5: Register the namespace**

In `frontend/lib/copy/index.ts`, add `import {aiBatch} from './aiBatch';` beside the
other imports and `aiBatch,` inside the `const copy = {...} as const` object. Do **not**
add it to the bare `export {...}` list (nothing imports the object directly; an unused
export is a knip finding).

- [ ] **Step 6: Create the query-key factory**

`frontend/lib/query-keys/extractionBatch.ts`:

```ts
/**
 * TanStack Query keys for AI batch runs. Start/cancel/resume invalidate
 * `.all` — a batch can change which list entry and which detail are correct,
 * and the sets are small.
 */
export const extractionBatchKeys = {
  all: ['extraction-batches'] as const,
  list: (projectId: string | null, activeOnly: boolean) =>
    [...extractionBatchKeys.all, 'list', projectId, activeOnly] as const,
  detail: (batchId: string) =>
    [...extractionBatchKeys.all, 'detail', batchId] as const,
} as const;
```

- [ ] **Step 7: Write the service**

`frontend/services/extractionBatchService.ts`. No raw `fetch`, no
`import.meta.env.VITE_API_URL`, no `supabase.auth` — `apiClient` only (frontend
data-access rule). Errors propagate as `ApiError`; callers map the code.

```ts
/**
 * AI batch runs API client (spec 2026-09-15 §7). The wire is snake_case and
 * the payload types come from the generated schema.
 */
import {apiClient} from '@/integrations/api/client';
import type {
  CreateExtractionBatchRequest,
  ExtractionBatchDetail,
  ExtractionBatchSummary,
} from '@/types/extraction-batch';

const BASE = '/api/v1/extraction/batches';

export async function startExtractionBatch(
  request: CreateExtractionBatchRequest,
): Promise<ExtractionBatchDetail> {
  return apiClient<ExtractionBatchDetail>(BASE, {method: 'POST', body: request});
}

export async function listExtractionBatches(params: {
  projectId?: string;
  active?: boolean;
}): Promise<ExtractionBatchSummary[]> {
  const search = new URLSearchParams();
  if (params.projectId) search.set('project_id', params.projectId);
  if (params.active) search.set('active', 'true');
  const query = search.toString();
  return apiClient<ExtractionBatchSummary[]>(query ? `${BASE}?${query}` : BASE);
}

export async function getExtractionBatch(batchId: string): Promise<ExtractionBatchDetail> {
  return apiClient<ExtractionBatchDetail>(`${BASE}/${encodeURIComponent(batchId)}`);
}

export async function cancelExtractionBatch(batchId: string): Promise<ExtractionBatchDetail> {
  return apiClient<ExtractionBatchDetail>(`${BASE}/${encodeURIComponent(batchId)}/cancel`, {
    method: 'POST',
  });
}

export async function resumeExtractionBatch(batchId: string): Promise<ExtractionBatchDetail> {
  return apiClient<ExtractionBatchDetail>(`${BASE}/${encodeURIComponent(batchId)}/resume`, {
    method: 'POST',
  });
}
```

- [ ] **Step 8: Run the test and the typecheck**

Run: `npm run test:run -- frontend/services/__tests__/extractionBatchService.test.ts`
Expected: PASS (4 tests).
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/types/extraction-batch.ts frontend/lib/copy/aiBatch.ts frontend/lib/copy/index.ts frontend/lib/query-keys/extractionBatch.ts frontend/services/extractionBatchService.ts frontend/services/__tests__/extractionBatchService.test.ts
git commit -m "$(cat <<'MSG'
feat(extraction): batch service, types, query keys and copy namespace

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: TanStack Query hooks with polling and invalidation

**Files:**
- Create: `frontend/hooks/extraction/useExtractionBatches.ts`
- Test: `frontend/test/hooks/useExtractionBatches.test.tsx`

**Interfaces:**
- Consumes: Task 1's service, `extractionBatchKeys`, `isBatchActive`,
  `articleExtractionValuesKeys` from `@/lib/query-keys/extraction`.
- Produces:
  - `useActiveBatches(projectId: string | null)` →
    `{data: ExtractionBatchSummary[] | undefined, isLoading: boolean}`
  - `useBatchDetail(batchId: string | null)` →
    `{data: ExtractionBatchDetail | undefined, isLoading: boolean}`
  - `useStartBatch()` → `UseMutationResult<ExtractionBatchDetail, unknown, CreateExtractionBatchRequest>`
  - `useCancelBatch()`, `useResumeBatch()` → `UseMutationResult<ExtractionBatchDetail, unknown, string>`
  - `ACTIVE_BATCH_POLL_MS = 5000`

Polling rules (spec §11.5): both queries use `refetchInterval` returning
`ACTIVE_BATCH_POLL_MS` only while the data shows something active, else `false`;
`refetchIntervalInBackground: false` (TanStack already stops the interval when the tab
is hidden, which is exactly the "tab is visible" requirement);
`refetchOnWindowFocus: true`.

Ring refresh (spec §11.4): `useBatchDetail` keeps the previous `done + done_with_issues`
in a ref and, when it grows, calls
`queryClient.invalidateQueries({queryKey: articleExtractionValuesKeys.all})`. Do it in
an effect, never during render.

- [ ] **Step 1: Write the failing hook test**

Create `frontend/test/hooks/useExtractionBatches.test.tsx`:

```tsx
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {ReactNode} from 'react';

vi.mock('@/services/extractionBatchService', () => ({
  listExtractionBatches: vi.fn(),
  getExtractionBatch: vi.fn(),
  startExtractionBatch: vi.fn(),
  cancelExtractionBatch: vi.fn(),
  resumeExtractionBatch: vi.fn(),
}));

import {getExtractionBatch, listExtractionBatches} from '@/services/extractionBatchService';
import {articleExtractionValuesKeys} from '@/lib/query-keys/extraction';
import {useActiveBatches, useBatchDetail} from '@/hooks/extraction/useExtractionBatches';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {client, wrapper};
}

const counts = {
  total: 2,
  queued: 1,
  running: 1,
  done: 0,
  done_with_issues: 0,
  needs_attention: 0,
  skipped: 0,
  not_run: 0,
};

beforeEach(() => {
  vi.mocked(listExtractionBatches).mockReset();
  vi.mocked(getExtractionBatch).mockReset();
});

describe('useActiveBatches', () => {
  it('does not fetch without a project', async () => {
    const {wrapper} = makeWrapper();
    renderHook(() => useActiveBatches(null), {wrapper});
    expect(listExtractionBatches).not.toHaveBeenCalled();
  });

  it('asks only for active batches of the project', async () => {
    vi.mocked(listExtractionBatches).mockResolvedValue([]);
    const {wrapper} = makeWrapper();
    renderHook(() => useActiveBatches('p1'), {wrapper});
    await waitFor(() =>
      expect(listExtractionBatches).toHaveBeenCalledWith({projectId: 'p1', active: true}),
    );
  });
});

describe('useBatchDetail', () => {
  it('invalidates the article values when the done count grows', async () => {
    const detail = {
      id: 'b1',
      project_id: 'p1',
      project_name: 'P',
      template_id: 't1',
      template_name: 'T',
      kind: 'extraction',
      state: 'active' as const,
      stalled: false,
      stop_code: null,
      stop_message: null,
      created_at: '2026-09-15T00:00:00Z',
      finished_at: null,
      counts,
      items: [],
    };
    vi.mocked(getExtractionBatch).mockResolvedValueOnce(detail);
    const {client, wrapper} = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const {rerender} = renderHook(() => useBatchDetail('b1'), {wrapper});
    await waitFor(() => expect(getExtractionBatch).toHaveBeenCalled());

    invalidate.mockClear();
    vi.mocked(getExtractionBatch).mockResolvedValue({
      ...detail,
      counts: {...counts, queued: 0, running: 1, done: 1},
    });
    await client.invalidateQueries();
    rerender();

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: articleExtractionValuesKeys.all,
      }),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:run -- frontend/test/hooks/useExtractionBatches.test.tsx`
Expected: FAIL — cannot resolve `@/hooks/extraction/useExtractionBatches`.

- [ ] **Step 3: Write the hooks**

`frontend/hooks/extraction/useExtractionBatches.ts`:

```ts
/**
 * TanStack Query access to AI batch runs (spec 2026-09-15 §11.1).
 *
 * The server is the source of truth: the hooks poll while a batch is active
 * and stop the moment it is not, so a finished batch costs nothing.
 */
import {useEffect, useRef} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {extractionBatchKeys} from '@/lib/query-keys/extractionBatch';
import {articleExtractionValuesKeys} from '@/lib/query-keys/extraction';
import {
  cancelExtractionBatch,
  getExtractionBatch,
  listExtractionBatches,
  resumeExtractionBatch,
  startExtractionBatch,
} from '@/services/extractionBatchService';
import type {
  CreateExtractionBatchRequest,
  ExtractionBatchDetail,
  ExtractionBatchSummary,
} from '@/types/extraction-batch';
import {isBatchActive} from '@/types/extraction-batch';

export const ACTIVE_BATCH_POLL_MS = 5000;

export function useActiveBatches(projectId: string | null) {
  return useQuery({
    queryKey: extractionBatchKeys.list(projectId, true),
    queryFn: () => listExtractionBatches({projectId: projectId ?? undefined, active: true}),
    enabled: Boolean(projectId),
    // Poll only while something is actually running; TanStack already pauses
    // the interval while the tab is hidden.
    refetchInterval: (query) =>
      (query.state.data as ExtractionBatchSummary[] | undefined)?.some(isBatchActive)
        ? ACTIVE_BATCH_POLL_MS
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useBatchDetail(batchId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: extractionBatchKeys.detail(batchId ?? ''),
    queryFn: () => getExtractionBatch(batchId as string),
    enabled: Boolean(batchId),
    refetchInterval: (q) =>
      (q.state.data as ExtractionBatchDetail | undefined)?.state === 'active'
        ? ACTIVE_BATCH_POLL_MS
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // §11.4: when an article finishes, the list rings are stale.
  const lastDoneRef = useRef(0);
  const counts = query.data?.counts;
  const done = counts ? counts.done + counts.done_with_issues : 0;
  useEffect(() => {
    if (done > lastDoneRef.current) {
      lastDoneRef.current = done;
      void queryClient.invalidateQueries({queryKey: articleExtractionValuesKeys.all});
    }
  }, [done, queryClient]);

  return query;
}

function useBatchMutation<TVariables>(
  fn: (variables: TVariables) => Promise<ExtractionBatchDetail>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: extractionBatchKeys.all});
    },
  });
}

export function useStartBatch() {
  return useBatchMutation<CreateExtractionBatchRequest>(startExtractionBatch);
}

export function useCancelBatch() {
  return useBatchMutation<string>(cancelExtractionBatch);
}

export function useResumeBatch() {
  return useBatchMutation<string>(resumeExtractionBatch);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:run -- frontend/test/hooks/useExtractionBatches.test.tsx`
Expected: PASS (3 tests). If the invalidation assertion is flaky because the second
fetch has not landed, extend the `waitFor` rather than weakening the assertion.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/extraction/useExtractionBatches.ts frontend/test/hooks/useExtractionBatches.test.tsx
git commit -m "$(cat <<'MSG'
feat(extraction): TanStack hooks for AI batches with active-only polling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: Selection bar and confirm dialog

**Files:**
- Create: `frontend/components/extraction/batch/BatchSelectionBar.tsx`
- Create: `frontend/components/extraction/batch/RunAIBatchDialog.tsx`
- Test: `frontend/components/extraction/batch/__tests__/BatchSelectionBar.test.tsx`
- Test: `frontend/components/extraction/batch/__tests__/RunAIBatchDialog.test.tsx`

**Interfaces:**
- Consumes: `useStartBatch` (Task 2), `useProjectMemberRole`, `aiBatch` copy,
  `ApiError`.
- Produces:
  - `MAX_BATCH_ARTICLES = 100`
  - ```ts
    interface BatchSelectionBarProps {
      projectId: string;
      templateId: string;
      selectedIds: Set<string>;
      onClear: () => void;
      activeBatch: ExtractionBatchSummary | null;
      onViewBatch: (batchId: string) => void;
    }
    export function BatchSelectionBar(props: BatchSelectionBarProps): JSX.Element | null
    ```
  - ```ts
    interface RunAIBatchDialogProps {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      projectId: string;
      templateId: string;
      articleIds: string[];
      /** §10: Retry failed / Run remaining reopen with the skip option off. */
      defaultSkipExisting?: boolean;
      onStarted: (batch: ExtractionBatchDetail) => void;
    }
    export function RunAIBatchDialog(props: RunAIBatchDialogProps): JSX.Element
    ```

Behaviour the tests pin (spec §11.2, §11.3, §10 F1/F3/F4):
- Zero selected → the bar renders `null` (the caller keeps showing its `ListCount`).
- 1..100 selected → `{{n}} selected`, a `Run AI` button and a `Clear` button.
- More than 100 → `Run AI` is `disabled` with `title` = `t('aiBatch','tooManySelected')`.
- `role === 'viewer'` or `loading` → no `Run AI` (Clear stays).
- `activeBatch` non-null → `Run AI` is replaced by the `AI running · d/t` chip plus a
  `View` button calling `onViewBatch(activeBatch.id)`.
- Dialog: the title uses the singular key at `n === 1`; the skip checkbox starts at
  `defaultSkipExisting ?? true`; `Run AI` fires `useStartBatch().mutate` with exactly
  `{project_id, template_id, article_ids, skip_articles_with_ai_suggestions}`.
- On success: close, `onStarted(batch)`, `toast.success` with a `View` action.
- On `ApiError`: `LLM_ENGINE_RETIRED` / `MISSING_API_KEY` /
  `LLM_ENDPOINT_UNAVAILABLE` → error toast titled `startEngineProblemTitle`;
  `SERVICE_UNAVAILABLE` (or status 503) → `startQueueDownTitle`;
  `AI_BATCH_ALREADY_ACTIVE` → `startAlreadyActiveTitle` (the id is in
  `error.details.batch_id`); anything else → `startFailedTitle` with the message as the
  description. The dialog stays open on error so the reviewer can retry.
- The engine line: read the project engine the same way `EngineGear` does; if that
  read is unavailable, omit the line entirely rather than inventing text. Read
  `frontend/components/extraction/EngineGear.tsx` first and reuse its hook.

- [ ] **Step 1: Write the failing selection-bar test**

Create `frontend/components/extraction/batch/__tests__/BatchSelectionBar.test.tsx`
covering the five states above. Mock `@/hooks/useProjectMemberRole` per test:

```tsx
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

const role = {current: {role: 'reviewer', isManager: false, loading: false}};
vi.mock('@/hooks/useProjectMemberRole', () => ({
  useProjectMemberRole: () => role.current,
}));

import {BatchSelectionBar} from '@/components/extraction/batch/BatchSelectionBar';

const base = {
  projectId: 'p1',
  templateId: 't1',
  onClear: vi.fn(),
  activeBatch: null,
  onViewBatch: vi.fn(),
};

function ids(n: number) {
  return new Set(Array.from({length: n}, (_, i) => `a${i}`));
}

describe('BatchSelectionBar', () => {
  it('renders nothing with no selection', () => {
    const {container} = render(<BatchSelectionBar {...base} selectedIds={ids(0)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Run AI for a reviewer with a selection', async () => {
    render(<BatchSelectionBar {...base} selectedIds={ids(3)} />);
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Run AI'})).toBeEnabled();
  });

  it('disables Run AI above 100 selected', () => {
    render(<BatchSelectionBar {...base} selectedIds={ids(101)} />);
    expect(screen.getByRole('button', {name: 'Run AI'})).toBeDisabled();
  });

  it('hides Run AI from a viewer', () => {
    role.current = {role: 'viewer', isManager: false, loading: false};
    render(<BatchSelectionBar {...base} selectedIds={ids(3)} />);
    expect(screen.queryByRole('button', {name: 'Run AI'})).not.toBeInTheDocument();
    role.current = {role: 'reviewer', isManager: false, loading: false};
  });

  it('shows the running chip and View while a batch is active', async () => {
    const activeBatch = {
      id: 'b1',
      counts: {total: 11, queued: 4, running: 0, done: 7, done_with_issues: 0,
        needs_attention: 0, skipped: 0, not_run: 0},
    } as never;
    const onViewBatch = vi.fn();
    render(
      <BatchSelectionBar {...base} selectedIds={ids(3)} activeBatch={activeBatch}
        onViewBatch={onViewBatch} />,
    );
    expect(screen.getByText('AI running · 7/11')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', {name: 'View'}));
    expect(onViewBatch).toHaveBeenCalledWith('b1');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:run -- frontend/components/extraction/batch/__tests__/BatchSelectionBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BatchSelectionBar`**

A `div` with `flex items-center gap-2 animate-in fade-in duration-200`, mirroring the
markup extraction's current selected-count block uses
(`frontend/components/extraction/ArticleExtractionTable.tsx`, the `selectedCount === 0`
ternary) so the two lists look identical. Run AI is
`<Button variant="ghost" size="sm" className="gap-1.5 text-[12px]">` with a
`<Sparkles className="h-4 w-4"/>`; Clear is the same but plain text. The bar owns the
`RunAIBatchDialog` open state and renders the dialog itself.

Derive `done` for the chip as `counts.done + counts.done_with_issues`.

- [ ] **Step 4: Run the selection-bar test**

Run: `npm run test:run -- frontend/components/extraction/batch/__tests__/BatchSelectionBar.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing dialog test**

Create `frontend/components/extraction/batch/__tests__/RunAIBatchDialog.test.tsx`
asserting: the payload sent on confirm (including
`skip_articles_with_ai_suggestions: true` by default and `false` when
`defaultSkipExisting={false}`), and one test per error branch (F1, F3, F4) checking the
toast title. Mock `@/hooks/extraction/useExtractionBatches` so `useStartBatch` returns a
controllable `mutateAsync`, and mock `sonner`'s `toast`.

- [ ] **Step 6: Run it and watch it fail**

Run: `npm run test:run -- frontend/components/extraction/batch/__tests__/RunAIBatchDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `RunAIBatchDialog`**

`AlertDialog` from `@/components/ui/alert-dialog`, size `sm`. Body: the engine line,
`confirmKeepsHumanAnswers`, and a `Checkbox` + label bound to local state seeded from
`defaultSkipExisting ?? true`. Footer: `AlertDialogCancel` and an
`AlertDialogAction` that calls `mutateAsync` and is disabled while pending.

- [ ] **Step 8: Run both tests, lint and typecheck**

Run: `npm run test:run -- frontend/components/extraction/batch`
Expected: PASS.
Run: `npm run typecheck && npm run lint`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/extraction/batch
git commit -m "$(cat <<'MSG'
feat(extraction): shared batch selection bar and Run AI confirm dialog

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 4: Row status indicators for an active batch

**Files:**
- Create: `frontend/components/extraction/batch/useBatchRowStatus.ts`
- Create: `frontend/components/extraction/batch/BatchRowStatus.tsx`
- Test: `frontend/components/extraction/batch/__tests__/BatchRowStatus.test.tsx`

**Interfaces:**
- Consumes: `useActiveBatches`, `useBatchDetail` (Task 2).
- Produces:
  - ```ts
    /** The caller's active batch for this tool, and its per-article state. */
    export function useBatchRowStatus(
      projectId: string,
      templateId: string,
    ): {
      activeBatch: ExtractionBatchSummary | null;
      rowStatus: Map<string, 'queued' | 'running'>;
    }
    ```
  - `export function BatchRowStatus({status}: {status: 'queued' | 'running' | undefined}): JSX.Element | null`

`useBatchRowStatus` picks the first summary whose `template_id === templateId` and whose
`state === 'active'`, then feeds its id to `useBatchDetail` and builds the map from the
detail's `items` where `outcome` is `queued` or `running`. When there is no active
batch it passes `null` to `useBatchDetail`, which disables that query.

`BatchRowStatus` renders `null` for `undefined`, a `<Clock className="h-3 w-3 text-muted-foreground"/>`
for `queued` and a `<Loader2 className="h-3 w-3 animate-spin text-info"/>` for
`running`, each wrapped in a `Tooltip` whose content is `t('aiBatch','rowQueued')` /
`t('aiBatch','rowRunning')`, and with the same string as an `aria-label` so the test can
find it without hovering.

- [ ] **Step 1: Write the failing test**

Assert: `undefined` renders nothing; `queued` and `running` each render an element whose
accessible name is the matching copy string. Then a `renderHook` test for
`useBatchRowStatus` with `useActiveBatches`/`useBatchDetail` mocked: it returns the
active batch for the given template (ignoring a batch of another template) and a map
holding only the `queued`/`running` articles.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:run -- frontend/components/extraction/batch/__tests__/BatchRowStatus.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both modules**

- [ ] **Step 4: Run the test**

Run: `npm run test:run -- frontend/components/extraction/batch/__tests__/BatchRowStatus.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/batch
git commit -m "$(cat <<'MSG'
feat(extraction): per-row queued/running indicators from the active batch

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 5: QA list — checkbox selection, card list and real shortcuts

**Files:**
- Modify: `frontend/components/hitl/HITLArticleTable.tsx`
- Test: `frontend/components/hitl/HITLArticleTable.test.tsx` (extend)

**Interfaces:**
- Consumes: `useArticleSelection` (`@/hooks/extraction/useArticleSelection`),
  `useListKeyboardShortcuts`, `BatchSelectionBar` (Task 3),
  `useBatchRowStatus` + `BatchRowStatus` (Task 4), `ResponsiveList`, `ListRowCard`,
  `Checkbox`, `useIsNarrow` (`@/hooks/use-mobile`).
- Produces: no new exports.

Changes, all inside `HITLArticleTable`:

1. Wire the real selection:
   ```ts
   const {
     selectedIds, isAllSelected, isIndeterminate, selectedCount,
     toggleArticle, selectAll, selectFiltered, deselectAll, isSelected, hasActiveFilters,
   } = useArticleSelection({
     allArticleIds: articles.map(a => a.id),
     visibleArticleIds: filteredAndSorted.map(a => a.id),
   });
   ```
2. Replace the four no-ops in the existing `useListKeyboardShortcuts({...})` call with
   `deselectAll`, `selectedCount`, `selectAll`, `selectFiltered`. Leave
   `hasActiveFilters: activeFiltersCount > 0` as it is — the shortcut hook's
   `hasActiveFilters` means "the list is filtered", which is what that expression says;
   `useArticleSelection`'s same-named field is a different thing and must not be
   substituted.
3. Add the leading checkbox column, copying extraction's markup: a
   `TableHead` of `w-[40px] min-w-[40px]` holding a header checkbox with
   `checked={isAllSelected}` and the indeterminate dash, and a `TableCell` per row with
   `checked={isSelected(article.id)}` / `onCheckedChange={() => toggleArticle(article.id)}`
   and `aria-label={t('extraction','tableSelectArticleAria').replace('{{title}}', title)}`.
   The cell needs `relative z-10` so it sits above the row's stretched open control.
   Rebalance the existing percentage widths so they still sum to 100 with the new column.
4. Wrap the table in `ResponsiveList` with `isNarrow={useIsNarrow()}` and a
   `cardContent` built from `ListRowCard` with a leading `Checkbox`, exactly as
   `ArticleExtractionTable` does (read lines ~955–1000 of that file and mirror them).
5. In the toolbar's trailing group, render `<BatchSelectionBar .../>` when
   `selectedCount > 0` and the existing `<ListCount .../>` otherwise. Feed it
   `activeBatch` from `useBatchRowStatus(projectId, templateId)` and an `onViewBatch`
   that opens the details sheet (Task 7 wires the sheet; until then pass a callback that
   sets a `batchIdForSheet` state this task introduces and renders nothing — Task 7
   fills in the sheet at that seam).
6. In the status cell, render `<BatchRowStatus status={rowStatus.get(article.id)} />`
   beside the `<StatusRing/>` inside a `flex items-center justify-center gap-1` wrapper.

- [ ] **Step 1: Write the failing table tests**

Extend `frontend/components/hitl/HITLArticleTable.test.tsx` with:
- selecting a row's checkbox shows `1 selected` and a `Run AI` button;
- the header checkbox selects every visible row;
- `Escape` clears the selection (the shortcut is no longer a no-op);
- a row whose article is `running` in the active batch renders the running indicator.

Follow the file's existing mocking style (it already stubs the services and progress
hooks); add mocks for `@/hooks/extraction/useExtractionBatches` and
`@/hooks/useProjectMemberRole`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:run -- frontend/components/hitl/HITLArticleTable.test.tsx`
Expected: FAIL — no checkbox in the table.

- [ ] **Step 3: Apply the six changes above**

- [ ] **Step 4: Run the tests**

Run: `npm run test:run -- frontend/components/hitl/HITLArticleTable.test.tsx`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/hitl/HITLArticleTable.tsx frontend/components/hitl/HITLArticleTable.test.tsx
git commit -m "$(cat <<'MSG'
feat(qa): checkbox selection, card list and Run AI on the assessment list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: Extraction list — server batch replaces the in-browser loop

**Files:**
- Modify: `frontend/components/extraction/ArticleExtractionTable.tsx`
- Test: `frontend/components/extraction/ArticleExtractionTable.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 3's `BatchSelectionBar`, Task 4's `useBatchRowStatus` /
  `BatchRowStatus`.
- Produces: no new exports. **Removes** `handleBatchAIExtraction` and the
  `useFullAIExtraction` import.

Changes:

1. Delete `handleBatchAIExtraction` and the whole `DropdownMenu` "Actions ▾" block in
   the `selectedCount > 0` branch (lines ~456–488 and ~712–730), and the
   `useFullAIExtraction` import and its destructured `extractFullAI` / `isExtracting`.
   Every `isExtracting` reference in the toolbar goes with it.
2. Put `<BatchSelectionBar .../>` in that branch's place, with the same props as QA.
3. Add `<BatchRowStatus .../>` beside the row's `StatusRing`, in both the table and the
   card `meta`.
4. Remove any now-unused imports (`MoreHorizontal`, `DropdownMenu*`, `Sparkles` if the
   bar owns it) — `npm run lint` will name them.

- [ ] **Step 1: Write the failing test**

Extend `frontend/components/extraction/ArticleExtractionTable.test.tsx`: selecting rows
shows the shared `Run AI` button and **no** `Actions` menu; confirming the dialog calls
`startExtractionBatch` once with all selected ids (not once per article).

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:run -- frontend/components/extraction/ArticleExtractionTable.test.tsx`
Expected: FAIL — the Actions menu is still there.

- [ ] **Step 3: Apply the four changes**

- [ ] **Step 4: Run the test and the lint**

Run: `npm run test:run -- frontend/components/extraction/ArticleExtractionTable.test.tsx`
Expected: PASS.
Run: `npm run lint`
Expected: exit 0 (no unused imports left behind).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/extraction/ArticleExtractionTable.tsx frontend/components/extraction/ArticleExtractionTable.test.tsx
git commit -m "$(cat <<'MSG'
feat(extraction): the article list runs AI through the server batch

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 7: Notification bell — one entry per batch, and the details sheet

**Files:**
- Modify: `frontend/types/background-jobs.ts`
- Create: `frontend/hooks/useAiBatchJobSync.ts`
- Create: `frontend/components/extraction/batch/BatchDetailsSheet.tsx`
- Modify: `frontend/components/navigation/NotificationCenter.tsx`
- Modify: `frontend/components/hitl/HITLArticleTable.tsx` and
  `frontend/components/extraction/ArticleExtractionTable.tsx` (render the sheet at the
  `onViewBatch` seam Task 5/6 left)
- Test: `frontend/test/hooks/useAiBatchJobSync.test.tsx`
- Test: `frontend/components/extraction/batch/__tests__/BatchDetailsSheet.test.tsx`

**Interfaces:**
- Consumes: `useActiveBatches` (with `projectId = null`, i.e. every project),
  `useBackgroundJobs`, `useBatchDetail`, `useCancelBatch`, `useResumeBatch`.
- Produces:
  - `AiBatchJob` in `frontend/types/background-jobs.ts`:
    ```ts
    export interface AiBatchJob extends BackgroundJob {
      type: 'ai-batch';
      metadata: {
        batchId: string;
        projectId: string;
        projectName: string;
        templateId: string;
        templateName: string;
        kind: string;
        state: BatchState;
        stalled: boolean;
        stopCode: string | null;
        counts: ExtractionBatchCounts;
      };
    }
    ```
    plus `'ai-batch'` in the `JobType` union. `id` is `` `ai-batch-${batchId}` ``.
  - `export function useAiBatchJobSync(): void`
  - ```ts
    interface BatchDetailsSheetProps {
      batchId: string | null;
      onOpenChange: (open: boolean) => void;
    }
    export function BatchDetailsSheet(props: BatchDetailsSheetProps): JSX.Element
    ```

`useAiBatchJobSync` rules (spec §11.5):
- It calls `useActiveBatches(null)` — the list endpoint already scopes to the caller and
  the last 7 days.
- For each summary it upserts a job: `addJob` when `getJob(id)` is undefined, else
  `updateJob`. The status mapping is
  `active → 'running'`, `finished → 'completed'`, `stopped → 'failed'`,
  `cancelled → 'cancelled'`; `completedAt` is set only on a terminal state, and only
  once (do not restamp it on every poll — `useBackgroundJobPolling` keys the toast off
  the status transition, but `countUnreadJobs` keys the badge off `completedAt`).
- `progress` is `{phase: state, current: finishedCount(counts), total: counts.total, message: ''}`.
- The server is the source of truth, so a job the server no longer lists is left alone
  (it has already reached a terminal status locally); never remove jobs here.
- Mount it from `NotificationCenter`, beside `useBackgroundJobPolling`.

`NotificationCenter` changes:
- Render `ai-batch` items: the title from `bellTitleExtraction` / `bellTitleAssessment`
  keyed on `metadata.kind`, the project name as the subtitle, the existing `Progress`
  bar plus `bellProgress`, a `Cancel` button while `state === 'active'`, and the
  finished summary line otherwise (`bellFinished`, plus `bellNeedsAttention` when
  `counts.needs_attention > 0`, `bellStoppedEngine` when `stopCode` is set,
  `bellCancelled` when cancelled, `bellStalled` when `stalled`).
- Clicking an `ai-batch` item opens `BatchDetailsSheet` for its `batchId` (add local
  state in `NotificationCenter`), and closes the dropdown.
- Extend the existing `useBackgroundJobPolling` callbacks: for an `ai-batch` job,
  `onJobComplete` toasts success — or, when `counts.needs_attention > 0`, a
  `toast.warning` with a `Details` action opening the sheet — and `onJobFailed` toasts
  `bellStoppedEngine` with a `Choose engine` action. Reuse the existing action-shaped
  ternary style in that file; the React Compiler restriction noted in its comments
  (no value-blocks inside try/catch) still applies.

`BatchDetailsSheet` (spec §11.6):
- `Sheet` at the default width, open when `batchId !== null`, feeding `useBatchDetail`.
- Summary counts at the top, then `items` grouped in this order: Needs attention →
  Skipped → Not run → Done (fold `done_with_issues` into Done with its
  `reasonSectionsFailed` line). Empty groups are omitted.
- Each row: title (or `sheetUntitled`), its reason line, and an `Open article` link to
  `/projects/{project_id}/extraction/{article_id}` for kind `extraction` and
  `/projects/{project_id}/articles/{article_id}/quality-assessment/{template_id}` for
  quality assessment.
- Reason copy: prefer `extractionErrorToast(reason_code, message)?.title` when that
  helper maps the code (it maps `MISSING_API_KEY`, `PDF_NOT_FOUND`,
  `MISSING_ENTITY_KEY`); otherwise use the `aiBatch` `reason*` key for the code, and
  `reasonUnknown` for an unmapped one. Never render a raw code.
- Footer, only the applicable actions: `Cancel batch` while active; `Resume` while
  `stalled`; `Retry failed` when any item is `needs_attention`; `Run remaining` when
  any is `not_run`. The last two open `RunAIBatchDialog` with those article ids and
  `defaultSkipExisting={false}` (§10).

- [ ] **Step 1: Write the failing sync test**

`frontend/test/hooks/useAiBatchJobSync.test.tsx`: with `useActiveBatches` mocked to
return one active summary, the store gains a job with id `ai-batch-b1`, type
`'ai-batch'` and status `'running'`; re-rendering with the same batch now `finished`
updates that job to `'completed'` with a `completedAt`, and a second re-render does not
change `completedAt`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:run -- frontend/test/hooks/useAiBatchJobSync.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Extend the job types and write the sync hook**

- [ ] **Step 4: Run the sync test**

Run: `npm run test:run -- frontend/test/hooks/useAiBatchJobSync.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing details-sheet test**

`BatchDetailsSheet.test.tsx`: with a mocked detail holding one item per outcome, the
sheet renders the four group headings in order, each item's reason line, and exactly the
expected footer buttons for an active-and-stalled batch (`Cancel batch`, `Resume`,
`Retry failed`). A second case: a finished batch with only `done` items shows no footer
action. A third: `Retry failed` opens the dialog with the failed ids and the skip
checkbox unchecked.

- [ ] **Step 6: Run it and watch it fail**

Run: `npm run test:run -- frontend/components/extraction/batch/__tests__/BatchDetailsSheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `BatchDetailsSheet`, wire the bell and the two tables**

Mount `BatchDetailsSheet` in `NotificationCenter` and at the `onViewBatch` seam in both
tables.

- [ ] **Step 8: Run the full suite for the touched areas**

Run: `npm run test:run -- frontend/components/extraction/batch frontend/test/hooks/useAiBatchJobSync.test.tsx frontend/components/navigation`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add frontend/types/background-jobs.ts frontend/hooks/useAiBatchJobSync.ts frontend/components/extraction/batch frontend/components/navigation/NotificationCenter.tsx frontend/components/hitl/HITLArticleTable.tsx frontend/components/extraction/ArticleExtractionTable.tsx frontend/test/hooks/useAiBatchJobSync.test.tsx
git commit -m "$(cat <<'MSG'
feat(extraction): AI batches in the notification bell with a details sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 8: Delete the in-browser batch path and its copy keys

**Files:**
- Delete: `frontend/hooks/extraction/useFullAIExtraction.ts`,
  `frontend/hooks/extraction/useTopLevelSectionsExtraction.ts`,
  `frontend/components/extraction/FullAIExtractionProgress.tsx`,
  `frontend/components/extraction/BatchAllModelsSectionsProgress.tsx`,
  `frontend/components/extraction/BatchExtractionProgress.tsx`,
  `frontend/test/hooks/useFullAIExtraction.test.tsx`,
  `frontend/test/hooks/useFullAIExtraction.ordering.test.tsx`
- Modify: `frontend/pages/ExtractionFullScreen.tsx` (the dead progress overlay),
  `frontend/services/extractionInstanceService.ts`,
  `frontend/lib/copy/extraction.ts`,
  `scripts/fitness/check_copy_keys.baseline`
- Read first, then decide: `frontend/test/hooks/extractionPartialFailure.test.tsx`,
  `frontend/components/extraction/__tests__/ExtractionHeader.exports.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing. This task only removes.

The overlay in `ExtractionFullScreen` is dead because its state is only ever set to
`null` — confirm that with `grep -n "FullAIExtractionProgress\|setFullAIProgress"
frontend/pages/ExtractionFullScreen.tsx` before deleting, and delete the state, its
setter and the JSX together.

**Do not delete** `useBatchAllModelsSectionsExtraction`,
`useBatchSectionExtractionChunked` or `useRunAIExtraction`.

- [ ] **Step 1: Delete the files and their references**

```bash
git rm frontend/hooks/extraction/useFullAIExtraction.ts \
       frontend/hooks/extraction/useTopLevelSectionsExtraction.ts \
       frontend/components/extraction/FullAIExtractionProgress.tsx \
       frontend/components/extraction/BatchAllModelsSectionsProgress.tsx \
       frontend/components/extraction/BatchExtractionProgress.tsx \
       frontend/test/hooks/useFullAIExtraction.test.tsx \
       frontend/test/hooks/useFullAIExtraction.ordering.test.tsx
```

Then remove the overlay from `ExtractionFullScreen.tsx` and fix every import the
typecheck names.

- [ ] **Step 2: Let the compiler and knip find what is now orphaned**

Run: `npm run typecheck`
Expected: exit 0 after the imports are cleaned.
Run: `npx knip`
Expected: zero findings.
Run: `npx knip --production`
Expected: zero findings. A `--production`-only finding is **not** automatically "delete
it" — triage per
`.claude/skills/frontend-development/references/dead-code.md`.

- [ ] **Step 3: Delete the orphaned copy keys**

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: it names the now-unreferenced keys in `frontend/lib/copy/extraction.ts`
(`tableBatchAIStarting`, `processingArticle`, `tableErrorProcessAI`,
`tableBatchActionsLabel`, `tableAIExtraction`, `tableSelectAtLeastOne` and whatever else
the run reports). Delete each reported key from `extraction.ts` — do **not** baseline
them.

- [ ] **Step 4: Tighten the ratchet and re-run it**

Run: `python3 scripts/fitness/check_copy_keys.py`
Expected: PASS. If it reports baseline entries as tightenable **that this PR made live
or deleted**, tighten only those lines in
`scripts/fitness/check_copy_keys.baseline` — never `--update-baseline`, which rewrites
every entry.

- [ ] **Step 5: Full local gate**

Run: `npm run test:run`
Expected: PASS, no unhandled rejections.
Run: `npm run lint && npm run typecheck && npx knip && npx knip --production`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'MSG'
refactor(extraction): remove the in-browser AI batch loop and dead progress overlay

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 9: Final verification

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Run the whole frontend gate from the repo root**

```bash
npm run lint && npm run typecheck && npm run test:run && npx knip && npx knip --production && python3 scripts/fitness/check_copy_keys.py
```

Expected: every command exits 0. Paste the tail of each into the report — the Iron Law
is evidence before "done".

- [ ] **Step 2: Confirm nothing backend changed**

Run: `git diff --stat origin/dev -- backend/ supabase/ frontend/types/api/`
Expected: empty output. If it is not, revert those files — the wire contract is fixed.

- [ ] **Step 3: Report**

State what passed, what is untested (real AI execution end to end; the visual
`design-review` pass at 1440/768/375 px, which is a separate manual step per spec §14),
and stop. **Do not push and do not open a PR.**

---

## Self-review notes

- **Spec coverage.** §11.1 → Tasks 1–2. §11.2 → Tasks 3, 5, 6. §11.3 → Task 3.
  §11.4 → Tasks 2 (ring invalidation) and 4 (row indicators); the open-article-screen
  refresh is explicitly out of scope, justified under §16 item 1. §11.5 → Task 7.
  §11.6 → Task 7. §13 → Task 8. §14 frontend table → the tests in Tasks 3–7.
  §12 (QA toolbar) shipped in PR #929 and is **not** in scope here.
- **Deliberate deviation from the spec.** §7 says camelCase on the wire; the merged
  backend and the generated schema say snake_case. The generated schema wins.
- **Not covered by automated tests, by design:** real AI execution (needs a live LLM,
  spec §3 non-goal) and the visual pass (spec §14 "Visual").
