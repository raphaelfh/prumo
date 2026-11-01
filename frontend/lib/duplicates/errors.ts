/**
 * The one wording of a duplicates failure. A mapped `ApiError.code` wins; else
 * a 403 is manager-only; else generic. A mapped key never carries a `{{…}}`
 * placeholder: this function fills nothing.
 */
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import type {duplicates} from '@/lib/copy/duplicates';

type DuplicatesCopyKey = keyof typeof duplicates;

const CODE_TO_KEY: Record<string, DuplicatesCopyKey> = {
  DUPLICATE_HAS_REVIEW_WORK: 'errHasReviewWork',
  DUPLICATE_KEPT_IS_REMOVED: 'errKeptIsRemoved',
  VALIDATION_ERROR: 'errGeneric',
};

export function duplicatesErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = CODE_TO_KEY[error.code];
    if (key) return t('duplicates', key);
    if (error.status === 403) return t('duplicates', 'errForbidden');
  }
  return t('duplicates', 'errGeneric');
}
