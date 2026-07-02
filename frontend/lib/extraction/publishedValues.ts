import { extractValueFromDb } from '@/lib/validations/selectOther';
import {
  unwrapValueEnvelope,
  valueAbsentReason,
} from '@/lib/extraction/valueSemantics';
import type { PublishedStateResponse } from '@/hooks/runs/types';

/**
 * One envelope → form-value conversion shared by every stage-hydration
 * path that peels the outer envelope first (published + reviewer-state):
 * peel, sniff the double-wrapped unit ({value:{value,unit}} — the only
 * unit shape writers produce), normalize via extractValueFromDb.
 */
export function envelopeToFieldValue(raw: unknown): unknown {
  const unwrapped = unwrapValueEnvelope(raw) ?? null;
  const unit =
    typeof unwrapped === 'object' && unwrapped !== null && 'unit' in unwrapped
      ? ((unwrapped as { unit: string | null }).unit ?? null)
      : null;
  return extractValueFromDb({ value: unwrapped, unit });
}

/**
 * Resolve `runDetail.published_states` into the `${instanceId}_${fieldId}`
 * values map both session forms consume (spec 2026-07-02 D3). Published-only,
 * no reviewer-state fallback: a coord without a published row stays absent.
 *
 * Marker envelopes (`{value: null, absent_reason}`) are preserved verbatim —
 * FieldInput derives the disposition label from the raw envelope, and the
 * generic unwrap would collapse the marker to null.
 */
export function publishedStatesToValuesMap(
  rows: readonly PublishedStateResponse[] | undefined,
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    const key = `${row.instance_id}_${row.field_id}`;
    const raw: unknown = row.value;
    if (valueAbsentReason(raw) !== null) {
      map[key] = raw;
      continue;
    }
    map[key] = envelopeToFieldValue(raw);
  }
  return map;
}
