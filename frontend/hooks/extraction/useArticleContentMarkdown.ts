/**
 * Lazily fetches the stored block-projection markdown for an article — the exact
 * text the LLM received (ADR-0013). Powers the "view text sent" expand inside the
 * review popover's generation-details dialog, so it only fetches when the user
 * opens that block (`enabled`).
 */

import {useQuery} from '@tanstack/react-query';

import {articleKeys} from '@/lib/query-keys/articles';
import {
  getArticleContentMarkdown,
  type ArticleContentMarkdown,
} from '@/services/articlesService';

export function useArticleContentMarkdown(
  articleId: string | undefined,
  opts: {enabled: boolean},
) {
  return useQuery<ArticleContentMarkdown>({
    queryKey: articleId
      ? articleKeys.contentMarkdown(articleId)
      : [...articleKeys.all, 'content-markdown', 'disabled'],
    queryFn: async () => {
      const result = await getArticleContentMarkdown(articleId!);
      if (!result.ok) throw result.error;
      return result.data;
    },
    enabled: opts.enabled && Boolean(articleId),
    staleTime: 5 * 60_000,
  });
}
