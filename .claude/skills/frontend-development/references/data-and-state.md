# Data and state patterns

The data layer has four layers: **service** (HTTP) → **hook** (TanStack Query) → **component** (renders). Cross-component UI state uses Zustand or Context depending on scope.

## Service — `services/{domain}Service.ts`

Services are the only place that call `apiClient`. They return `ErrorResult<T>` via `toResult` from `lib/error-utils.ts`. They never throw across the boundary, never toast, and never import Zustand or React hooks.

```typescript
// services/citationsService.ts
import { apiClient } from '@/integrations/api';
import { toResult, type ErrorResult } from '@/lib/error-utils';
import type { components } from '@/types/api/schema';

export type ArticleCitationItem = components['schemas']['ArticleCitationItem'];

export function fetchArticleCitations(
  articleId: string,
): Promise<ErrorResult<ArticleCitationItem[]>> {
  return toResult(
    () => apiClient<ArticleCitationItem[]>(`/api/v1/articles/${articleId}/citations`),
    'citationsService.fetchArticleCitations',
  );
}
```

`toResult(operation, context)` runs `operation()` in a `try/catch`: on success it returns `{ ok: true, data }`, on failure it logs and returns `{ ok: false, error }`. The context string ends up in the log line — keep it stable (it feeds dashboards).

For mutations the pattern is the same — `toResult` wraps the `apiClient` POST/PATCH/DELETE:

```typescript
// services/extractionRunService.ts
import { apiClient } from '@/integrations/api';
import { toResult, type ErrorResult } from '@/lib/error-utils';

export interface ExtractForRunRequest {
  projectId: string;
  articleId: string;
  templateId: string;
  runId: string;
}

export interface ExtractForRunResult {
  extractionRunId: string;
  totalSuggestionsCreated: number;
}

export function extractForRun(
  params: ExtractForRunRequest,
): Promise<ErrorResult<ExtractForRunResult>> {
  return toResult(
    () =>
      apiClient<ExtractForRunResult>('/api/v1/extraction/sections', {
        method: 'POST',
        body: params,
      }),
    'extractionRunService.extractForRun',
  );
}
```

## Query hook — `hooks/{domain}/use{Name}.ts`

Query hooks wrap `useQuery` (reads) or `useMutation` (writes). The `queryKey` always comes from a factory in `lib/query-keys/`. The `queryFn` calls the service and throws the error on failure — that surfaces it to TanStack's error boundary:

```typescript
// hooks/articles/useArticleCitations.ts
import { useQuery } from '@tanstack/react-query';
import { articleKeys } from '@/lib/query-keys';
import { fetchArticleCitations, type ArticleCitationItem } from '@/services/citationsService';

const STALE_MS = 5 * 60_000;

export function useArticleCitations(articleId: string | null | undefined) {
  return useQuery({
    queryKey: articleKeys.citations(articleId ?? ''),
    enabled: Boolean(articleId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<ArticleCitationItem[]> => {
      const result = await fetchArticleCitations(articleId!);
      if (!result.ok) throw result.error;   // TanStack handles the error state
      return result.data;
    },
  });
}
```

The component destructures `{ data, isLoading, error }` from the hook — it never fetches directly.

## Mutation hook — `useMutation` + invalidation

```typescript
// hooks/runs/useCreateRun.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/integrations/api';
import { extractionKeys } from '@/lib/query-keys';
import type { CreateRunRequest, RunSummaryResponse } from './types';

export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation<RunSummaryResponse, Error, CreateRunRequest>({
    mutationFn: (body) =>
      apiClient<RunSummaryResponse>('/api/v1/runs', { method: 'POST', body }),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: extractionKeys.runDetail(run.id) });
    },
  });
}
```

`onSuccess` invalidates the owning key family so lists/detail views re-fetch automatically. Stale-cache bugs are a recurring incident class — always invalidate.

Note: `useCreateRun` calls `apiClient` directly (no service wrapper) because the mutation doesn't need `ErrorResult` — `useMutation` owns the error surface. Either pattern is acceptable for mutations; use `toResult` when you want the service reusable outside a hook.

> **Hook-local key exception:** `hooks/runs/types.ts` also exports a `runsKeys` object for a handful of reviewer-availability queries that have no `lib/query-keys/` counterpart. That is a documented exception — those keys are scoped to the hooks that use them and are not re-exported. All other keys, including run-detail and extraction data, live in `lib/query-keys/` and must be imported from there.

## Query-key factories — `lib/query-keys/`

All keys live in `lib/query-keys/{domain}.ts` and are exported from the barrel:

```typescript
// lib/query-keys/articles.ts
export const articleKeys = {
  all: ['articles'] as const,
  byProject: (projectId: string, filters?: Record<string, unknown>) =>
    [...articleKeys.all, 'by-project', projectId, filters ?? null] as const,
  detail: (articleId: string) =>
    [...articleKeys.all, 'detail', articleId] as const,
  files: (articleId: string) =>
    [...articleKeys.all, 'files', articleId] as const,
  citations: (articleId: string) =>
    [...articleKeys.all, 'citations', articleId] as const,
} as const;
```

```typescript
// lib/query-keys/extraction.ts
export const extractionKeys = {
  all: ['extraction'] as const,
  runsForProject: (projectId: string, filters?: Record<string, unknown>) =>
    [...extractionKeys.all, 'runs', projectId, filters ?? null] as const,
  runDetail: (runId: string) =>
    [...extractionKeys.all, 'run-detail', runId] as const,
  proposals: (runId: string) =>
    [...extractionKeys.all, 'proposals', runId] as const,
  hitlSession: (sessionId: string) =>
    [...extractionKeys.all, 'hitl-session', sessionId] as const,
} as const;
```

Import via the barrel: `import { articleKeys, extractionKeys } from '@/lib/query-keys'`. The CI gate `check_react_query_keys.py` rejects inline string arrays.

When adding a new domain, create `lib/query-keys/{domain}.ts` and add it to `lib/query-keys/index.ts`.

## Zustand stores — `stores/`

Zustand stores hold cross-component UI state that isn't server-cache (server cache = TanStack). Declare state and actions in one `create()` call. Use `devtools` middleware in dev; use `persist` only when the state genuinely survives page reload:

```typescript
// stores/useExtractionStore.ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface ExtractionState {
  showPDF: boolean;
  viewMode: 'extract' | 'compare';
  activeModelId: string | null;
}

interface ExtractionActions {
  setShowPDF: (show: boolean) => void;
  setViewMode: (mode: 'extract' | 'compare') => void;
  setActiveModelId: (id: string | null) => void;
}

export const useExtractionStore = create<ExtractionState & ExtractionActions>()(
  devtools(
    (set) => ({
      showPDF: false,
      viewMode: 'extract',
      activeModelId: null,
      setShowPDF: (show) => set({ showPDF: show }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setActiveModelId: (id) => set({ activeModelId: id }),
    }),
    { name: 'ExtractionStore' },
  ),
);
```

Stores are for UI concerns (panel visibility, active selection, view toggles). **Do not put server data in a Zustand store** — that belongs in TanStack Query.

## React Context — `contexts/`

Context is for app-wide singletons that need to be provided once at the root: Auth, Project scope, Sidebar. The existing contexts (`AuthContext`, `ProjectContext`, `SidebarContext`, `ThemeContext`) cover those slots.

When to use Context instead of Zustand:
- The value is provided by the app shell and consumed by many subtrees (not just sibling components).
- The update is infrequent and the consumer tree is large enough that a Zustand subscription would be more complex than a Context provider.

When to use Zustand instead of Context:
- State is scoped to a feature subtree (e.g. extraction panel).
- Fine-grained subscriptions matter (Zustand only re-renders components that subscribe to the changed slice).
- Don't create a new Context for feature state — that path leads to prop-drilling via provider nesting.

## `apiClient` — the one HTTP client

`apiClient<T>(endpoint, options)` in `integrations/api/client.ts`:
- Attaches the Supabase JWT automatically.
- Throws `ApiError` (carrying `.code`, `.message`, `.status`, `.traceId`) on non-2xx or `ok: false` envelope.
- Accepts `body`, `method`, `timeout` (default 60 s), `skipAuth`, and standard `RequestInit` options.
- Wraps the backend `ApiResponse<T>` envelope and returns the unwrapped `data`.

Never import `VITE_API_URL` or call `fetch()` directly outside `integrations/api/client.ts`.

```typescript
// typical service usage
const data = await apiClient<RunSummaryResponse>('/api/v1/runs', {
  method: 'POST',
  body: { project_id: projectId, article_id: articleId },
  timeout: 30_000,
});
```

For blob downloads use `apiBlobClient` from the same module (returns `{ kind: 'sync', blob, filename }` or `{ kind: 'async', job_id }`).
