/** Article progress (R15): the caller's per-article instances + merged values. The
 * backend owns the merge and the form-run scoping. Throws; TanStack owns errors. */
import {apiClient} from '@/integrations/api';
import type {ReviewKind} from '@/lib/comparison/permissions';
import type {components} from '@/types/api/schema';

export type ArticleProgressRead = components['schemas']['ArticleProgressRead'];

export type ArticleProgressData = Pick<
  components['schemas']['ArticleProgressItemRead'],
  'instances' | 'values'
>;

export function getArticleProgress(
  projectId: string,
  templateId: string,
  kind: ReviewKind,
): Promise<ArticleProgressRead> {
  return apiClient<ArticleProgressRead>(
    `/api/v1/projects/${projectId}/templates/${templateId}/article-progress?kind=${kind}`,
  );
}
