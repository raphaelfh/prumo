/**
 * The project's article list for the extraction and QA dashboards: one query
 * definition over one cache entry (`articleKeys.byProject`).
 */
import {useQuery} from '@tanstack/react-query';

import {t} from '@/lib/copy';
import {articleKeys} from '@/lib/query-keys';
import {fetchProjectArticles, type ArticleListItem} from '@/services/articlesService';

interface UseProjectArticlesQueryOptions<TData> {
  enabled?: boolean;
  /** Narrows the cached rows for one reader. Module-level, so the observer's
   * `select` identity is stable across renders. */
  select?: (rows: ArticleListItem[]) => TData;
}

export function useProjectArticlesQuery<TData = ArticleListItem[]>(
  projectId: string,
  {enabled = true, select}: UseProjectArticlesQueryOptions<TData> = {},
) {
  return useQuery<ArticleListItem[], Error, TData>({
    queryKey: articleKeys.byProject(projectId),
    enabled: enabled && !!projectId,
    // Replaces loaders that reloaded on every mount, and no article writer
    // (import, create, delete) invalidates this key: under the app's 5-minute
    // staleTime a remount would otherwise keep a pre-import or pre-delete list.
    refetchOnMount: 'always',
    select,
    queryFn: async () => {
      const result = await fetchProjectArticles(projectId);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}

/** What the run headers' article pager and ⌘K palette navigate by. */
export interface WorklistItem {
  id: string;
  title: string;
}

// `articles.title` is nullable in the schema. The pager and the palette both
// NAME the article they navigate to, so an untitled row gets the same
// placeholder the QA article table already shows it under.
const TO_WORKLIST = (rows: ArticleListItem[]): WorklistItem[] =>
  rows.map((a) => ({id: a.id, title: a.title ?? t('qa', 'untitledArticle')}));

const EMPTY_WORKLIST: WorklistItem[] = [];

/**
 * The project's article worklist for both run screens and the QA tab, in the
 * order the article tables list it (`created_at` desc) — so "next article"
 * after finishing a form means the next row down.
 *
 * A failed read resolves to an empty list and never toasts: the worklist is
 * navigation garnish, and losing it must not disturb finishing a form — the
 * caller falls back to its end-of-queue destination and the header pager
 * (which self-guards below two articles) renders nothing. The error and the
 * loading flag are still exposed for a screen whose bootstrap reads the list;
 * `error` means "no list": a failed background refetch keeps the rows already
 * loaded and reports none.
 */
export function useProjectWorklist(projectId: string | undefined) {
  const query = useProjectArticlesQuery(projectId ?? '', {select: TO_WORKLIST});
  return {
    worklist: query.data ?? EMPTY_WORKLIST,
    isLoading: query.isLoading,
    error: query.data === undefined ? query.error : null,
  };
}
