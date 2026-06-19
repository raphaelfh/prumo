/**
 * Fetches the citation list for an article.
 *
 * Used by the PDF viewer's reviewer-highlight feature to resolve AI evidence
 * quotes to backend-stored citation anchors. Returns an empty array when the
 * article has no citations or when the query is disabled.
 */
import {useQuery} from '@tanstack/react-query';

import {articleKeys} from '@/lib/query-keys';
import {fetchArticleCitations, type ArticleCitationItem} from '@/services/citationsService';

const STALE_MS = 5 * 60_000;

export function useArticleCitations(articleId: string | null | undefined) {
  return useQuery({
    queryKey: articleKeys.citations(articleId ?? ''),
    enabled: Boolean(articleId),
    staleTime: STALE_MS,
    queryFn: async (): Promise<ArticleCitationItem[]> => {
      const result = await fetchArticleCitations(articleId!);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
  });
}
