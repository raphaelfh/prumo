/**
 * TanStack Query key factory for article-scoped queries.
 */
export const articleKeys = {
  all: ['articles'] as const,
  byProject: (projectId: string, filters?: Record<string, unknown>) =>
    [...articleKeys.all, 'by-project', projectId, filters ?? null] as const,
  detail: (articleId: string) =>
    [...articleKeys.all, 'detail', articleId] as const,
  files: (articleId: string) =>
    [...articleKeys.all, 'files', articleId] as const,
  textBlocks: (articleFileId: string) =>
    [...articleKeys.all, 'text-blocks', articleFileId] as const,
} as const;
