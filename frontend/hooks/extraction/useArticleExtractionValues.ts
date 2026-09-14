/**
 * Shared per-article extraction/QA values, TanStack-cached by
 * `(projectId, templateId, userId, kind)`. Replaces the near-identical
 * Supabase fetch the HITL list, the extraction table and the dashboard each
 * used to build per-article `{instances, values}` for progress. Scoped to the
 * current user (same `reviewer_id` / `source_user_id` filter as before).
 *
 * Run-scoping is kind-aware: for `extraction` the value reads are scoped to
 * each article's *form run* (instances persist across runs of the same
 * template+article, so a stale finalized run would otherwise mark a fresh
 * article "completed"). For `quality_assessment` there is no extraction
 * form-run, so the reads are scoped only by instance + reviewer (the prior
 * QA-list behaviour).
 */

import { useQuery } from '@tanstack/react-query';

import { articleExtractionValuesKeys } from '@/lib/query-keys/extraction';
import { loadArticleProgressData } from '@/lib/extraction/loadArticleProgressData';
import type { ArticleProgressData } from '@/lib/extraction/articleValues';
import type { ReviewKind } from '@/lib/comparison/permissions';

export function useArticleExtractionValues(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
  userId: string | null | undefined,
  kind: ReviewKind = 'extraction',
) {
  const query = useQuery({
    queryKey: articleExtractionValuesKeys.byTemplate(
      projectId ?? '',
      templateId ?? '',
      userId ?? '',
      kind,
    ),
    enabled: !!projectId && !!templateId && !!userId,
    staleTime: 30 * 1000,
    queryFn: () =>
      loadArticleProgressData(
        projectId as string,
        templateId as string,
        userId as string,
        kind,
      ),
  });

  return {
    valuesByArticle: query.data ?? new Map<string, ArticleProgressData>(),
    // isPending || isError: a disabled query or a failed fetch must not
    // read as "loaded empty" — the worklist then paints every row as
    // not-started. Consumers keep a single `isLoading` gate.
    isLoading: query.isPending || query.isError,
  };
}
