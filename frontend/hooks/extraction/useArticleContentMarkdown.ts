/**
 * Lazily fetches the stored block-projection markdown for an article — the text
 * the extraction prompt is built from; the prompt adds block refs, which this
 * markdown omits (ADR-0013). Powers the "view text sent" expand inside the
 * review popover's generation-details dialog, so it only fetches when the user
 * opens that block (`enabled`).
 */

import {useQuery} from '@tanstack/react-query';

import {articleKeys} from '@/lib/query-keys/articles';
import {
  getArticleContentMarkdown,
  type ArticleContentMarkdown,
} from '@/services/articleFilesService';

export function useArticleContentMarkdown(
  articleId: string | undefined,
  opts: {enabled: boolean},
) {
  return useQuery<ArticleContentMarkdown>({
    queryKey: articleId
      ? articleKeys.contentMarkdown(articleId)
      : [...articleKeys.all, 'content-markdown', 'disabled'],
    // The service throws on failure (apiClient contract); TanStack turns that
    // into the query's error state.
    queryFn: () => getArticleContentMarkdown(articleId!),
    enabled: opts.enabled && Boolean(articleId),
    staleTime: 5 * 60_000,
  });
}
