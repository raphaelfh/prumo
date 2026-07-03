/**
 * Article-files service — typed IO for an article's linked documents.
 * Throws ApiError on failure (the apiClient contract) — callers handle it.
 */
import { apiClient } from '@/integrations/api';
import type { components } from '@/types/api/schema';

export type ArticleFileListItem = components['schemas']['ArticleFileListItem'];

/**
 * List an article's files (MAIN first, then supplements) — the document
 * switcher's data source. Returns `[]` when the article has no files.
 */
export async function listArticleFiles(
  articleId: string,
): Promise<ArticleFileListItem[]> {
  const files = await apiClient<ArticleFileListItem[]>(
    `/api/v1/articles/${articleId}/files`,
  );
  return files ?? [];
}

export interface ArticleContentMarkdown {
  fileName: string | null;
  contentMarkdown: string | null;
}

/**
 * The stored block-projection markdown for an article's MAIN file — the exact
 * text the LLM received (ADR-0013), for the review popover's generation dialog.
 * The endpoint returns a camelCase envelope, so the payload is read straight
 * through. Throws ApiError on failure (the apiClient contract); the query hook
 * surfaces it as an error state.
 *
 * Lives here (not in articlesService) so the dialog's import chain stays free of
 * the Supabase client — importing that module at test time throws when the
 * VITE_SUPABASE_* env is absent (e.g. CI unit tests).
 */
export async function getArticleContentMarkdown(
  articleId: string,
): Promise<ArticleContentMarkdown> {
  const data = await apiClient<ArticleContentMarkdown>(
    `/api/v1/articles/${articleId}/content-markdown`,
  );
  return {
    fileName: data?.fileName ?? null,
    contentMarkdown: data?.contentMarkdown ?? null,
  };
}
