/**
 * Loads a single article's detail record (currently used for its DOI, to
 * build the PDF viewer's "Open article page" link).
 */
import {useQuery} from '@tanstack/react-query';

import {articleKeys} from '@/lib/query-keys';
import {fetchArticle} from '@/services/articlesService';

export function useArticleDetail(articleId: string | null | undefined) {
  return useQuery({
    queryKey: articleKeys.detail(articleId ?? ''),
    enabled: Boolean(articleId),
    queryFn: async () => {
      const result = await fetchArticle(articleId as string);
      if (!result.ok) throw result.error;
      return result.data;
    },
  });
}
