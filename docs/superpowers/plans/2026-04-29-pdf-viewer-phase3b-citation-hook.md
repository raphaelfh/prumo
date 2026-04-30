# PDF Viewer — Phase 3b: Citation hook + viewer integration

> **Status:** Pending — backend + DB are ready, awaits frontend design decision.
> **Predecessors:** Phase 3 read-side endpoint (commit `7b49725`), Phase 2b
> viewer with TextLayer + search.
> **Successor:** any feature that needs to render evidence-grounded
> citations in the viewer.

## Why it's pending

The endpoint [`GET /api/v1/articles/{article_id}/citations`](../../../backend/app/api/v1/endpoints/citations.py)
ships rows in v1 wire format aligned with
[`frontend/pdf-viewer/core/citation.ts:Citation`](../../../frontend/pdf-viewer/core/citation.ts).
The viewer already exposes `viewer.actions.addCitation()` /
`removeCitation()` per [`core/state.ts`]. What's missing is a hook that
fetches and pipes them into a viewer instance, and a few design choices
that the implementer needs from the product side.

## Open questions (need human decisions)

| # | Question | Recommended default |
|---|---|---|
| 1 | Render citations on the **extraction** page, the **QA** page, or both? | Both — same component (`useArticleCitations`) mounted in `ExtractionPDFPanel` and the QA full-screen page. |
| 2 | Show all citations at once, or filter to the field/instance currently in focus? | Both modes; default to "active field only" to avoid visual noise. Toggle via a viewer toolbar action. |
| 3 | Click on a citation in the form panel — should it scroll the viewer to the page + flash the highlight? | Yes; reuse the `style.ephemeral = true` flash already supported by [`core/citation.ts:65`](../../../frontend/pdf-viewer/core/citation.ts:65). |
| 4 | Should highlighted text be selectable? | Yes — TextLayer overlays already are; citation overlay should be `pointer-events: none` over text for selection to work. |
| 5 | Stale data — refetch on `extractionRunId` change, on focus, or never? | Refetch on `extractionRunId` change + 30s stale time via TanStack Query. |

These can land as defaults; the implementer should expose props for #2
and #3 so a follow-up can flip them without redeploying.

## Scope

### Files to create

| Path | Purpose |
|---|---|
| `frontend/hooks/extraction/useArticleCitations.ts` | TanStack Query hook → `GET /articles/{id}/citations`, returns `Citation[]` |
| `frontend/pdf-viewer/integrations/citations.ts` | Adapter: wires a `Citation[]` source into a viewer instance via the store API |
| `frontend/pdf-viewer/__tests__/integrations.citations.test.tsx` | Smoke test with mock engine |

### Files to modify

| Path | Change |
|---|---|
| `frontend/components/extraction/ExtractionPDFPanel.tsx` | Read `articleId`, call `useArticleCitations`, hand the list to `<PrumoPdfViewer>` via a new optional prop. |
| `frontend/pages/QualityAssessmentFullScreen.tsx` | Same. |
| `frontend/pdf-viewer/PrumoPdfViewer.tsx` | Accept optional `citations?: Citation[]` and dispatch `addCitation` for each via the integration adapter. |
| `frontend/pdf-viewer/index.ts` | Re-export `useArticleCitations` and the integration helper. |

## Hook contract (pre-baked)

```ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/integrations/api/client';
import type { Citation } from '@prumo/pdf-viewer';

interface ApiCitation {
  id: string;
  anchor: Citation['anchor'];
  metadata?: { pageNumber?: number; textContent?: string; source?: 'ai' | 'human' | 'review'; fieldId?: string };
}

export function useArticleCitations(articleId: string | null | undefined) {
  return useQuery({
    queryKey: ['article-citations', articleId],
    enabled: Boolean(articleId),
    staleTime: 30_000,
    queryFn: async (): Promise<Citation[]> => {
      const res = await apiClient.get<ApiCitation[]>(`/api/v1/articles/${articleId}/citations`);
      return res.data.map((c) => ({
        id: c.id,
        anchor: c.anchor,
        metadata: c.metadata
          ? { fieldId: c.metadata.fieldId, source: c.metadata.source }
          : undefined,
      }));
    },
  });
}
```

The hook returns the runtime `Citation` shape directly — no wrapper. `pageNumber` and `textContent` come from the API for query convenience but the viewer reads them off `anchor` / `anchor.quote` so they're not exported on `Citation.metadata`.

## Integration adapter (pre-baked)

```ts
// frontend/pdf-viewer/integrations/citations.ts
import { useEffect } from 'react';
import { useViewerStoreApi } from '@prumo/pdf-viewer';
import type { Citation } from '@prumo/pdf-viewer';

export function useSyncCitations(citations: readonly Citation[] | undefined): void {
  const store = useViewerStoreApi();
  useEffect(() => {
    if (!citations) return;
    const { addCitation, removeCitation, getCitations } = store.getState().actions;
    const seen = new Set<string>();
    for (const c of citations) {
      seen.add(c.id);
      addCitation(c); // additive; impl is idempotent on id
    }
    // Drop any citations that disappeared from the API response.
    for (const existing of getCitations()) {
      if (!seen.has(existing.id)) removeCitation(existing.id);
    }
  }, [citations, store]);
}
```

Mounting it once inside `<PrumoPdfViewer>` is enough — the store updates trigger rerenders of the citation overlay.

## Tasks (in order)

1. Add `useArticleCitations` and unit-test with mocked `apiClient`.
2. Add `integrations/citations.ts` and unit-test with `createMockEngine`.
3. Extend `<PrumoPdfViewer>` with `citations?: readonly Citation[]`; mount `useSyncCitations` when the prop is provided.
4. Wire `ExtractionPDFPanel` and `QualityAssessmentFullScreen` to call the hook and pass the result down.
5. Add a smoke e2e: open the QA page, inject one v1-anchor row via admin client, expect a highlight to appear over the matching span on the rendered TextLayer.

## Verification

- Hook returns `[]` for an article with no v1-shape evidence rows.
- Hook returns the full list for the article we seeded a hybrid anchor on (see `backend/app/api/v1/endpoints/citations.py` smoke).
- Visiting the extraction page with citations attached shows highlights only on the relevant pages, not all pages.
- Switching `articleId` prop refetches; closing the page cancels the in-flight request via TanStack Query cancellation.
- E2E suite still 41-42 passing, 0 failed.

## Out of scope (defer to a follow-up)

- Citation authoring UI (user-drawn highlights → POST citations) — that's the write path of Phase 3, distinct work.
- Filtering by `metadata.source` (AI vs human vs review) — the field is already returned by the API; UI filter is a one-line addition once the basic render is in.
- Performance: more than ~200 citations on a page may need virtualization; defer until measured.
