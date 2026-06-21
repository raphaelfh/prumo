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
