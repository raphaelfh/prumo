/**
 * The human-readable label for a coded `absent_reason` disposition marker
 * (ADR-0016) — the single shared display helper used by the reviewer-comparison
 * and consensus surfaces so a disposition renders legibly ("No information")
 * instead of a bare `null` / raw JSON.
 *
 * The resolved strings MUST match the backend export labels
 * (`value_semantics.ABSENT_REASON_LABELS`), so an on-screen reviewer cell and the
 * exported cell can never disagree — a FE/BE parity test (`absentReasonLabel.test.ts`)
 * locks the two sides. Copy still flows through `lib/copy` (the `extraction`
 * disposition keys), keeping user-facing text centralized.
 */

import { t } from '@/lib/copy';
import { valueAbsentReason } from '@/lib/extraction/valueSemantics';

const ABSENT_REASON_COPY_KEY = {
  no_information: 'dispositionNoInformation',
  not_applicable: 'dispositionNotApplicable',
  not_evaluated: 'dispositionNotEvaluated',
} as const;

/**
 * The disposition label for a coded marker `{ value: null, absent_reason: <code> }`,
 * or `null` when `raw` carries no resolved marker (a real value / bare null /
 * out-of-vocabulary code). The marker validation is delegated to the shared
 * `valueAbsentReason` predicate.
 */
export function absentReasonLabel(raw: unknown): string | null {
  const code = valueAbsentReason(raw);
  if (code === null) return null;
  const key = ABSENT_REASON_COPY_KEY[code as keyof typeof ABSENT_REASON_COPY_KEY];
  return key ? t('extraction', key) : null;
}
