/**
 * The one wording of a screening failure. A mapped `ApiError.code` wins; else
 * the status decides. A mapped key never carries a `{{…}}` placeholder: this
 * function fills nothing, so a placeholder would reach the user literally.
 */
import {ApiError} from '@/integrations/api/client';
import {t} from '@/lib/copy';
import type {screening} from '@/lib/copy/screening';

type ScreeningCopyKey = keyof typeof screening;

// Every screening 422 (config, decision, arbitration, import) shares
// `errorValidation`: generic on purpose.
const CODE_TO_KEY: Record<string, ScreeningCopyKey> = {
  SCREENING_CONFIG_FROZEN: 'errorConfigFrozen',
  SCREENING_TOO_FEW_REVIEWERS: 'errorTooFewReviewers',
  VALIDATION_ERROR: 'errorValidation',
  NCBI_EMAIL_NOT_CONFIGURED: 'errNcbiEmailMissing',
  SERVICE_UNAVAILABLE: 'errQueueUnavailable',
  SCREENING_REVIEWER_CAP: 'errReviewerCap',
  SCREENING_UNKNOWN_EXCLUSION_REASON: 'errReasonsChanged',
  SCREENING_NOT_CONFIGURED: 'errNotConfigured',
  SCREENING_STALE_DECISIONS: 'errStaleDecisions',
  SCREENING_NOT_IN_CONFLICT: 'errNotInConflict',
  SCREENING_DECISION_FINAL: 'errDecisionFinal',
  SCREENING_SELF_ARBITRATION: 'errSelfArbitration',
};

export function screeningErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = CODE_TO_KEY[error.code];
    if (key) return t('screening', key);
    if (error.status === 403) return t('screening', 'errorForbidden');
    if (error.status === 404) return t('screening', 'errorNotFound');
  }
  return t('screening', 'errorGeneric');
}
