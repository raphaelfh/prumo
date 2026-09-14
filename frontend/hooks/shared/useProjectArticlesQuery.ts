/**
 * The project's article list for the extraction and QA dashboards: one query
 * definition over one cache entry (`articleKeys.byProject`).
 */
import {useQuery} from '@tanstack/react-query';

import {articleKeys} from '@/lib/query-keys';
import {fetchProjectArticles} from '@/services/articlesService';

export function useProjectArticlesQuery(projectId: string, {enabled = true}: {enabled?: boolean} = {}) {
  return useQuery({
    queryKey: articleKeys.byProject(projectId),
    enabled: enabled && !!projectId,
    // Replaces loaders that reloaded on every mount, and no article writer
    // (import, create, delete) invalidates this key: under the app's 5-minute
    // staleTime a remount would otherwise keep a pre-import or pre-delete list.
    refetchOnMount: 'always',
    queryFn: async () => {
      const result = await fetchProjectArticles(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
