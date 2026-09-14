/** Per-article progress for the worklists and dashboards, via the article-progress API (R15).
 * The key keeps `userId`, so an identity change never serves another user's cache (R16).
 * R17: `isLoading` = enabled && isPending (a paused offline query stays pending while
 * TanStack's isLoading is false); a DISABLED query is `isUnavailable`, never loading. */
import {useQuery} from '@tanstack/react-query';

import type {ReviewKind} from '@/lib/comparison/permissions';
import {articleExtractionValuesKeys} from '@/lib/query-keys/extraction';
import {getArticleProgress, type ArticleProgressData} from '@/services/articleProgressService';

export function useArticleExtractionValues(
  projectId: string | null | undefined,
  templateId: string | null | undefined,
  userId: string | null | undefined,
  kind: ReviewKind = 'extraction',
) {
  const enabled = !!projectId && !!templateId && !!userId;
  const query = useQuery({
    queryKey: articleExtractionValuesKeys.byTemplate(
      projectId ?? '', templateId ?? '', userId ?? '', kind),
    enabled,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<Map<string, ArticleProgressData>> => {
      const read = await getArticleProgress(projectId as string, templateId as string, kind);
      const map = new Map<string, ArticleProgressData>();
      for (const a of read.articles) {
        map.set(a.article_id, {instances: a.instances, values: a.values});
      }
      return map;
    },
  });

  return {
    valuesByArticle: query.data ?? new Map<string, ArticleProgressData>(),
    isLoading: enabled && query.isPending,
    isError: query.isError,
    isUnavailable: !enabled,
    refetch: query.refetch,
  };
}
