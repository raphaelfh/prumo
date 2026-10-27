// frontend/services/articleListService.ts
/**
 * Article list service — IO for the project article list.
 *
 * Deletion goes through the API (`apiClient`): the server deletes the rows
 * before removing the PDFs from storage, and answers with how many of each
 * it removed.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. Toasts are the
 * caller's job.
 */
import {apiClient} from '@/integrations/api/client';
import type {components} from '@/types/api/schema';
import {toResult, type ErrorResult} from '@/lib/error-utils';

export type ArticleSelection = components['schemas']['ArticleDeleteRequest']['selection'];
type ArticleDeleteRead = components['schemas']['ArticleDeleteRead'];
type ArticleDeleteRequest = components['schemas']['ArticleDeleteRequest'];

/**
 * Delete the selected articles (`POST /api/v1/projects/{id}/articles/delete`,
 * manager-gated). A non-manager's attempt comes back as an ApiError 403; a
 * non-member, a missing project or any foreign/missing id as a 404.
 *
 * NOTE: toast messages are handled by the caller (ArticlesList).
 */
export function deleteArticles(
  projectId: string,
  selection: ArticleSelection,
): Promise<ErrorResult<ArticleDeleteRead>> {
  const body: ArticleDeleteRequest = {selection};
  return toResult(
    () => apiClient<ArticleDeleteRead>(`/api/v1/projects/${projectId}/articles/delete`, {method: 'POST', body}),
    'articleListService.deleteArticles',
  );
}
