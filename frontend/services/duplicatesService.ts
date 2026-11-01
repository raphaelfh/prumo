/**
 * Duplicate review service. Every call routes through the typed client and
 * returns `ErrorResult<T>` — never throws across the boundary, never toasts.
 * `duplicatesErrorMessage` (`lib/duplicates/errors.ts`) words the `ApiError`.
 */

import {apiClient} from '@/integrations/api/client';
import {toResult, type ErrorResult} from '@/lib/error-utils';
import type {components} from '@/types/api/schema';

export type DuplicatesRead = components['schemas']['DuplicatesRead'];
export type DuplicateVerdictCreate = components['schemas']['DuplicateVerdictCreate'];
export type DuplicateVerdictsResult = components['schemas']['DuplicateVerdictsResult'];

export function fetchDuplicates(projectId: string): Promise<ErrorResult<DuplicatesRead>> {
  return toResult(
    () => apiClient<DuplicatesRead>(`/api/v1/projects/${projectId}/duplicates`),
    'duplicatesService.fetchDuplicates',
  );
}

/** One batch, one transaction: 409 DUPLICATE_KEPT_IS_REMOVED / DUPLICATE_HAS_REVIEW_WORK roll all of it back. */
export function postDuplicateVerdicts(
  projectId: string,
  items: DuplicateVerdictCreate[],
): Promise<ErrorResult<DuplicateVerdictsResult>> {
  return toResult(
    () =>
      apiClient<DuplicateVerdictsResult>(`/api/v1/projects/${projectId}/duplicates/verdicts`, {
        method: 'POST',
        body: {items},
      }),
    'duplicatesService.postDuplicateVerdicts',
  );
}
